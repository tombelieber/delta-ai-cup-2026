import { MAP_CLASSIFICATION_KEY, normalizeMapClassifications, metadataForMap,
  mapAssignmentMatches, mapReviewMatches, markMapReviewed } from './map-model.js';
import { createMapAnalysisClient, normalizeMapEndpoint, MapAnalysisError, usesHostedMap, MAP_HOSTED_BATCH_SIZE } from './map-analysis-client.js';

export const MAP_ACCESS_KEY = 'delta.map.access.v1';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{20,256}$/.test(value);
const error = (message, code) => new MapAnalysisError(message, { code });
const permissionFor = endpoint => {
  const url = new URL(endpoint);
  return { origins: [`${url.protocol}//${url.hostname}/*`] };
};

function accessFrom(value, endpoint) {
  return object(value) && value.schemaVersion === 1 && value.endpoint === endpoint && validToken(value.token) ? value.token : null;
}

function mergeStores(current, incoming) {
  const result = normalizeMapClassifications(current);
  for (const [videoId, assignment] of Object.entries(incoming.assignments)) {
    if (!result.assignments[videoId] || assignment.classifiedAt >= result.assignments[videoId].classifiedAt) result.assignments[videoId] = assignment;
  }
  for (const [videoId, review] of Object.entries(incoming.reviews)) {
    if (!result.reviews[videoId] || review.reviewedAt >= result.reviews[videoId].reviewedAt) result.reviews[videoId] = review;
  }
  let updatedAt = result.updatedAt || 0;
  for (const assignment of Object.values(result.assignments)) updatedAt = Math.max(updatedAt, assignment.classifiedAt);
  for (const review of Object.values(result.reviews)) updatedAt = Math.max(updatedAt, review.reviewedAt);
  result.updatedAt = updatedAt || null;
  return result;
}

// Native side-panel owner only. No runtime/content-message handler exposes the
// capability, and network work ends when the owning panel destroys this client.
export function createMapPanelController({ storage, permissions, libraryClient, readEndpoint, fetchImpl, openHostedAction, now = Date.now } = {}) {
  if (typeof storage?.get !== 'function' || typeof storage?.set !== 'function' || typeof permissions?.request !== 'function'
    || typeof libraryClient?.list !== 'function' || typeof readEndpoint !== 'function') throw new TypeError('Native map panel dependencies are required.');
  const client = createMapAnalysisClient({ ...(fetchImpl ? { fetchImpl } : {}), ...(openHostedAction ? { openHostedAction } : {}) });
  const listeners = new Set();
  let writes = Promise.resolve(), inFlight = null, controller = null, disposed = false, generation = 0, grantedEndpoint = null;
  let status = { state: 'idle', processed: 0, reviewed: 0, pending: 0 };
  const serialize = operation => {
    const result = writes.then(operation, operation);
    writes = result.catch(() => {});
    return result;
  };
  const notify = () => { if (!disposed) for (const listener of listeners) { try { listener(); } catch { /* An observer cannot break persisted work. */ } } };
  const update = patch => { status = { ...status, ...patch }; notify(); };
  const ensureOpen = () => { if (disposed) throw error('The map panel has closed. Saved results are kept.', 'PANEL_CLOSED'); };
  const endpointNow = () => normalizeMapEndpoint(readEndpoint());
  const readStore = async () => normalizeMapClassifications((await storage.get(MAP_CLASSIFICATION_KEY))[MAP_CLASSIFICATION_KEY]);
  const readRecords = async () => {
    const library = await libraryClient.list();
    if (!library?.journal || !Array.isArray(library.journal.entries)) throw error('Delta could not read your local records.', 'RECORDS_UNAVAILABLE');
    return library.journal.entries;
  };
  const pendingFor = (videos, classifications) => videos.filter(video => !mapAssignmentMatches(classifications.assignments[video.videoId], video)
    && !mapReviewMatches(classifications.reviews[video.videoId], video));
  async function get() {
    ensureOpen();
    await writes;
    const endpoint = endpointNow();
    const [classifications, entries, storedAccess] = await Promise.all([readStore(), readRecords(), storage.get(MAP_ACCESS_KEY)]);
    const hosted = usesHostedMap(endpoint), videos = metadataForMap(entries);
    // Older private backups remain intact, but a public map never presents an
    // uncertain assignment as a topic. A completed review is not mastery.
    const visible = hosted ? { ...classifications, assignments: Object.fromEntries(Object.entries(classifications.assignments).filter(([, item]) => item.confidence === 'high')) } : classifications;
    const processed = videos.filter(video => mapAssignmentMatches(visible.assignments[video.videoId], video)).length;
    const pending = pendingFor(videos, classifications).length;
    const snapshotStatus = { ...status, processed, reviewed: videos.length - pending, pending, unresolved: videos.length - processed, total: videos.length };
    return { classifications: visible, status: snapshotStatus, accessMode: hosted ? 'google' : 'private',
      accessConfigured: !hosted && Boolean(accessFrom(storedAccess[MAP_ACCESS_KEY], endpoint)) };
  }

  function pause(reason) {
    const issue = reason instanceof MapAnalysisError ? reason : error('Map analysis stopped. Your records and previous results are saved.', 'MAP_UNAVAILABLE');
    update({ state: 'paused', error: issue.message, code: issue.code, ...(issue.retryAfterMs == null ? { retryAfter: null } : { retryAfter: now() + issue.retryAfterMs }) });
    return issue;
  }

  return {
    get,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('A map status listener is required.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Call directly in a native click handler, before awaiting get(), storage,
    // or a server response. This preserves Chrome's user-gesture permission.
    begin() {
      ensureOpen();
      const endpoint = endpointNow(), expected = ++generation;
      let grant;
      try { grant = permissions.request(permissionFor(endpoint)); }
      catch { return Promise.reject(pause(error('Chrome could not request map service access. Try the button again.', 'PERMISSION_ERROR'))); }
      return Promise.resolve(grant).then(async allowed => {
        ensureOpen();
        if (generation !== expected) throw error('Map analysis stopped. Your records are saved.', 'CANCELLED');
        if (!allowed) throw error('Map service access was declined. Your local records are still available.', 'PERMISSION_DENIED');
        if (endpointNow() !== endpoint) throw error('The map service changed. Start again to use its new address.', 'ENDPOINT_CHANGED');
        if (usesHostedMap(endpoint)) await client.verifyHostedAccess(endpoint);
        if (generation !== expected || disposed) throw error('Map analysis stopped. Your records are saved.', 'CANCELLED');
        if (endpointNow() !== endpoint) throw error('The map service changed. Start again to use its new address.', 'ENDPOINT_CHANGED');
        grantedEndpoint = endpoint;
        update({ state: 'idle', error: null, code: null, retryAfter: null });
        return get();
      }).catch(reason => { throw pause(reason); });
    },
    async setAccessToken(token) {
      ensureOpen();
      const endpoint = endpointNow();
      if (usesHostedMap(endpoint)) throw error('Use Google sign-in in the Delta website. No private access code is needed.', 'GOOGLE_SIGN_IN_REQUIRED');
      if (token !== '' && !validToken(token)) throw error('Enter a valid private map access token.', 'INVALID_ACCESS_TOKEN');
      await serialize(() => storage.set({ [MAP_ACCESS_KEY]: token ? { schemaVersion: 1, endpoint, token } : null }));
      update({ error: null, code: null, retryAfter: null });
      return get();
    },
    async importResults(value) {
      ensureOpen();
      if (!object(value) || value.schemaVersion !== 1 || !object(value.assignments)) throw error('Choose a valid Delta map classification file.', 'INVALID_IMPORT');
      if (Object.hasOwn(value, 'reviews') && !object(value.reviews)) throw error('This classification file contains invalid reviews. Nothing was imported.', 'INVALID_IMPORT');
      const imported = normalizeMapClassifications(value);
      if (Object.keys(imported.assignments).length !== Object.keys(value.assignments).length) throw error('This classification file contains invalid assignments. Nothing was imported.', 'INVALID_IMPORT');
      if (Object.keys(imported.reviews).length !== Object.keys(value.reviews || {}).length) throw error('This classification file contains invalid reviews. Nothing was imported.', 'INVALID_IMPORT');
      await serialize(async () => {
        const classifications = mergeStores(await readStore(), imported);
        await storage.set({ [MAP_CLASSIFICATION_KEY]: classifications });
      });
      update({ error: null, code: null, retryAfter: null });
      return get();
    },
    classifyNext({ signal } = {}) {
      ensureOpen();
      if (inFlight) return inFlight;
      const endpoint = endpointNow();
      if (endpoint !== grantedEndpoint) return Promise.reject(pause(error('Start map analysis to grant access to this service.', 'PERMISSION_REQUIRED')));
      controller = new AbortController();
      const active = controller;
      const abort = () => active.abort();
      if (signal?.aborted) active.abort();
      signal?.addEventListener('abort', abort, { once: true });
      update({ state: 'running', error: null, code: null, retryAfter: null });
      inFlight = (async () => {
        try {
          await writes;
          const [classifications, entries, storedAccess] = await Promise.all([readStore(), readRecords(), storage.get(MAP_ACCESS_KEY)]);
          if (active.signal.aborted || disposed) throw error('Map analysis stopped. Your records are saved.', 'CANCELLED');
          const hosted = usesHostedMap(endpoint), accessToken = hosted ? null : accessFrom(storedAccess[MAP_ACCESS_KEY], endpoint);
          if (!hosted && !accessToken) throw error('Connect your private map access before analyzing records.', 'ACCESS_REQUIRED');
          if (endpointNow() !== endpoint) throw error('The map service changed. Start again to use its new address.', 'ENDPOINT_CHANGED');
          const videos = pendingFor(metadataForMap(entries), classifications).slice(0, hosted ? MAP_HOSTED_BATCH_SIZE : 300);
          if (!videos.length) {
            update({ state: 'idle' });
            return { ...(await get()), batch: { submitted: 0, classified: 0, unresolved: 0, cached: 0 } };
          }
          const pathCounts = new Map();
          for (const assignment of Object.values(classifications.assignments)) {
            const key = JSON.stringify(assignment.path);
            pathCounts.set(key, (pathCounts.get(key) || 0) + 1);
          }
          const existingPaths = [...pathCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en')).slice(0, 80).map(([key]) => JSON.parse(key));
          const result = await client.classify(endpoint, { videos, existingPaths }, { accessToken, signal: active.signal });
          // Once the response is validated, persist it even if a later UI action
          // changes the endpoint. Its recorded route stays the actual source.
          await serialize(async () => {
            const at = now();
            const assignments = Object.fromEntries(result.items.map(item => [item.videoId, { ...item, classifiedAt: at, endpoint, model: result.model }]));
            const imported = normalizeMapClassifications({ schemaVersion: 1, assignments, updatedAt: at });
            const merged = markMapReviewed(mergeStores(await readStore(), imported), videos, { now: at, endpoint, model: result.model });
            await storage.set({ [MAP_CLASSIFICATION_KEY]: merged });
          });
          update({ state: active.signal.aborted || disposed ? 'paused' : 'idle', ...(active.signal.aborted ? { error: 'Map analysis stopped. Saved results are kept.', code: 'CANCELLED' } : {}) });
          if (disposed) return { classifications: await readStore(), status: { ...status }, accessConfigured: false,
            batch: { submitted: videos.length, classified: result.items.length, unresolved: result.unresolvedIds.length, cached: result.cached } };
          return { ...(await get()), batch: { submitted: videos.length, classified: result.items.length, unresolved: result.unresolvedIds.length, cached: result.cached } };
        } catch (reason) { throw pause(reason); }
        finally {
          signal?.removeEventListener('abort', abort);
          if (controller === active) controller = null;
          inFlight = null;
        }
      })();
      return inFlight;
    },
    cancel() {
      generation++; controller?.abort(); grantedEndpoint = null;
      update({ state: 'paused', error: 'Map analysis stopped. Saved results are kept.', code: 'CANCELLED', retryAfter: null });
    },
    destroy() {
      disposed = true; generation++; controller?.abort(); grantedEndpoint = null; listeners.clear();
    },
  };
}
