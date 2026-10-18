import { metadataForMap, mapMetadataFingerprint, normalizeMapPath, validMapLabel, MAP_CONTENT_TYPES, MAP_CONFIDENCE_LEVELS } from './map-model.js';
import { DEFAULT_API_ENDPOINT } from './analysis-client.js';

export const MAP_HOSTED_ENDPOINT = DEFAULT_API_ENDPOINT;
export const MAP_HOSTED_BATCH_SIZE = 12;
export const usesHostedMap = endpoint => endpoint === MAP_HOSTED_ENDPOINT;

export class MapAnalysisError extends Error {
  constructor(message, { code = 'SERVICE_UNAVAILABLE', status = null, paused = true, retryAfterMs = null } = {}) {
    super(message); this.name = 'MapAnalysisError'; this.code = code; this.status = status; this.paused = paused; this.retryAfterMs = retryAfterMs;
  }
}

export function normalizeMapEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new MapAnalysisError('Enter the map service URL.', { code: 'INVALID_ENDPOINT' });
  let url;
  try { url = new URL(value.trim()); } catch { throw new MapAnalysisError('Enter a valid map service URL.', { code: 'INVALID_ENDPOINT' }); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || local && url.protocol === 'http:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new MapAnalysisError('Use an HTTPS origin, or localhost HTTP for development.', { code: 'INVALID_ENDPOINT' });
  }
  return url.origin;
}

function invalidResponse() { return new MapAnalysisError('The map service returned an invalid result. Your records are saved.', { code: 'INVALID_RESPONSE' }); }

export function validateMapAnalysisResponse(value, videos) {
  const submitted = new Map(videos.map(video => [video.videoId, video]));
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.items) || value.items.length > submitted.size
    || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 160
    || !Number.isSafeInteger(value.cached) || value.cached < 0 || value.cached > submitted.size) throw invalidResponse();
  const seen = new Set();
  const items = value.items.map(item => {
    const path = normalizeMapPath(item?.path);
    if (!item || !submitted.has(item.videoId) || seen.has(item.videoId) || !path || !MAP_CONFIDENCE_LEVELS.includes(item.confidence)
      || !MAP_CONTENT_TYPES.includes(item.contentType)) throw invalidResponse();
    seen.add(item.videoId);
    return { videoId: item.videoId, path, confidence: item.confidence, contentType: item.contentType,
      metadataFingerprint: mapMetadataFingerprint(submitted.get(item.videoId)) };
  });
  let unresolved;
  const unresolvedValues = value.unresolvedIds ?? value.unresolved;
  if (unresolvedValues != null) {
    if (!Array.isArray(unresolvedValues) || unresolvedValues.length > submitted.size) throw invalidResponse();
    unresolved = unresolvedValues.map(item => {
      const videoId = typeof item === 'string' ? item : item?.videoId;
      if (!submitted.has(videoId) || seen.has(videoId)) throw invalidResponse();
      seen.add(videoId);
      return { videoId, reason: typeof item?.reason === 'string' ? item.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200) : 'Insufficient context' };
    });
  }
  // Omissions are honest unresolved records, never successful classifications.
  unresolved ||= [];
  for (const videoId of submitted.keys()) if (!seen.has(videoId)) unresolved.push({ videoId, reason: 'No classification returned' });
  return { schemaVersion: 1, items, cached: value.cached, model: value.model.trim(), unresolved,
    unresolvedIds: unresolved.map(item => item.videoId) };
}

function retryAfter(value) {
  if (typeof value !== 'string') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(86400000, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(86400000, Math.max(0, date - Date.now())) : null;
}

export function createMapAnalysisClient({ fetchImpl = globalThis.fetch, timeoutMs = 120000,
  openHostedAction = options => import('./hosted-action-client.js').then(module => module.openHostedAction(options)) } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  let verifiedHosted = false;
  async function verifyHostedAccess(endpoint, { signal } = {}) {
    const origin = normalizeMapEndpoint(endpoint);
    if (!usesHostedMap(origin)) return 'private';
    if (signal?.aborted) throw new MapAnalysisError('Map analysis stopped. Your records are saved.', { code: 'CANCELLED' });
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, Math.min(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000, 15000));
    verifiedHosted = false;
    try {
      const response = await fetchImpl(`${origin}/api/study/auth-config`, { method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (!response.ok) throw new Error('Unavailable');
      const raw = await response.text();
      if (controller.signal.aborted || signal?.aborted) throw new Error('Aborted');
      if (raw.length > 16000 || JSON.parse(raw)?.enabled !== true) throw new Error('Invalid configuration');
      verifiedHosted = true;
      return 'google';
    } catch {
      if (signal?.aborted) throw new MapAnalysisError('Map analysis stopped. Your records are saved.', { code: 'CANCELLED' });
      throw new MapAnalysisError('Google sign-in is unavailable. Map analysis is paused; saved records are kept.', { code: 'AUTH_UNAVAILABLE' });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  return {
    verifyHostedAccess,
    async classify(endpoint, { videos, existingPaths = [], signal: payloadSignal } = {}, { accessToken, signal: requestSignal } = {}) {
      const signal = requestSignal ?? payloadSignal;
      const origin = normalizeMapEndpoint(endpoint);
      const metadata = metadataForMap(videos);
      if (!metadata.length) return { schemaVersion: 1, items: [], cached: 0, model: 'none', unresolved: [], unresolvedIds: [] };
      const hosted = usesHostedMap(origin);
      if (!hosted && accessToken != null && (typeof accessToken !== 'string' || !/^[A-Za-z0-9_-]{20,256}$/.test(accessToken))) {
        throw new MapAnalysisError('The private map access token is invalid.', { code: 'INVALID_ACCESS_TOKEN' });
      }
      if (metadata.length > 300) throw new MapAnalysisError('Analyze at most 300 videos per batch. Your records are saved.', { code: 'INVALID_REQUEST' });
      if (hosted && metadata.length > MAP_HOSTED_BATCH_SIZE) throw new MapAnalysisError('Analyze at most 12 videos per signed-in batch. Your records are saved.', { code: 'INVALID_REQUEST' });
      if (!Array.isArray(existingPaths) || existingPaths.length > 80) throw new MapAnalysisError('Existing map paths are invalid.', { code: 'INVALID_REQUEST' });
      const paths = [...new Map(existingPaths.map(path => {
        if (!Array.isArray(path) || path.length < 1 || path.length > 4 || !path.every(validMapLabel)) throw new MapAnalysisError('Existing map paths are invalid.', { code: 'INVALID_REQUEST' });
        const normalized = path.map(label => label.normalize('NFC').replace(/\s+/g, ' '));
        return [JSON.stringify(normalized), normalized];
      })).values()];
      if (signal?.aborted) throw new MapAnalysisError('Map analysis stopped. Your records are saved.', { code: 'CANCELLED' });
      if (hosted) {
        if (!verifiedHosted) await verifyHostedAccess(origin, { signal });
        try {
          const value = await openHostedAction({ action: 'classify', endpoint: origin, payload: { videos: metadata, existingPaths: paths }, signal });
          if (signal?.aborted) throw new MapAnalysisError('Map analysis stopped. Your records are saved.', { code: 'CANCELLED' });
          const result = validateMapAnalysisResponse(value, metadata);
          const uncertain = result.items.filter(item => item.confidence !== 'high').map(item => ({ videoId: item.videoId, reason: 'More context is needed' }));
          return { ...result, items: result.items.filter(item => item.confidence === 'high'),
            unresolved: [...result.unresolved, ...uncertain], unresolvedIds: [...result.unresolvedIds, ...uncertain.map(item => item.videoId)] };
        } catch (issue) {
          if (signal?.aborted) throw new MapAnalysisError('Map analysis stopped. Your records are saved.', { code: 'CANCELLED' });
          if (issue instanceof MapAnalysisError) throw issue;
          const code = typeof issue?.code === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(issue.code) ? issue.code : 'HOSTED_UNAVAILABLE';
          const status = Number.isSafeInteger(issue?.status) && issue.status >= 400 && issue.status <= 599 ? issue.status : null;
          throw new MapAnalysisError(code === 'free_tier_quota_exhausted' ? 'Gemini provider quota has been reached. Map analysis is paused; your saved records are kept.'
            : code === 'project_budget_exhausted' ? 'Delta’s shared project AI budget is used or reserved. Your saved records are kept.'
            : status === 429 ? 'Your free AI allowance is unavailable or used up. Map analysis is paused; saved records are kept.'
            : code === 'CANCELLED' ? 'Map analysis stopped. Your records are saved.' : 'Map analysis could not finish in the Delta website. Your records and previous results are saved.', { code, status });
        }
      }
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000;
      const timer = setTimeout(abort, duration);
      try {
        const response = await fetchImpl(`${origin}/api/map/classify`, { method: 'POST', credentials: 'omit', redirect: 'error',
          referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', ...(accessToken ? { 'x-delta-map-token': accessToken } : {}) },
          body: JSON.stringify({ videos: metadata, existingPaths: paths }), signal: controller.signal });
        if (!response.ok) {
          const status = response.status;
          let body = null;
          try {
            const raw = await response.text();
            if (raw.length < 16000) body = JSON.parse(raw);
          } catch { /* A non-JSON failure still pauses the queue. */ }
          const source = body?.error && typeof body.error === 'object' ? body.error : body;
          const candidateCode = typeof body?.error === 'string' ? body.error : source?.code;
          const code = typeof candidateCode === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(candidateCode) ? candidateCode
            : status === 429 ? 'QUOTA' : status === 403 ? 'FORBIDDEN' : 'SERVICE_UNAVAILABLE';
          const retry = Number.isFinite(source?.retryAfterSeconds) && source.retryAfterSeconds >= 0
            ? Math.min(86400000, source.retryAfterSeconds * 1000) : retryAfter(response.headers?.get?.('retry-after'));
          throw new MapAnalysisError(code === 'classification_busy' ? 'Map analysis is busy and has paused. Your records are saved.'
            : status === 429 ? 'Free model quota reached. Map analysis is paused; your records are saved.'
            : status === 403 ? 'Map analysis is not allowed. Your records are saved.'
              : 'Map analysis is unavailable. Your records are saved.',
          { code, status, retryAfterMs: retry });
        }
        const raw = await response.text();
        if (controller.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
        if (raw.length > 2000000) throw invalidResponse();
        let value;
        try { value = JSON.parse(raw); } catch { throw invalidResponse(); }
        return validateMapAnalysisResponse(value, metadata);
      } catch (error) {
        if (signal?.aborted) throw new MapAnalysisError('Map analysis stopped. Your records are saved.', { code: 'CANCELLED' });
        if (error?.name === 'AbortError' || controller.signal.aborted) throw new MapAnalysisError('Map analysis timed out. Your records are saved.', { code: 'TIMEOUT' });
        if (error instanceof MapAnalysisError) throw error;
        throw new MapAnalysisError('Map analysis could not connect. Your records are saved.', { code: 'NETWORK' });
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    },
  };
}
