import { validVideoId } from './store.js';

// Imported visits are kept apart from observed playback and checked learning results.
export const HISTORY_IMPORT_KEY = 'delta.history.imported.v1';
export const HISTORY_PREVIEW_KEY = 'delta.history.preview.v1';

const DAY_MS = 86_400_000;
const PREVIEW_TTL_MS = 10 * 60_000;
const MAX_QUERY_RESULTS = 1000;
const MAX_PREVIEW_ROWS = 200;
const MAX_IMPORTED_ROWS = 1000;
const HISTORY_PERMISSION = Object.freeze({ permissions: ['history'] });
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const MESSAGE_TYPES = new Set(['HISTORY_STATUS', 'HISTORY_PREVIEW', 'HISTORY_IMPORT', 'HISTORY_CANCEL', 'HISTORY_CLEAR', 'HISTORY_DISCONNECT']);

class HistoryImportError extends Error {}
const reject = (message) => { throw new HistoryImportError(message); };

function timestamp(value, currentTime) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= currentTime ? value : null;
}

function videoFromUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    let videoId = null;
    if (YOUTUBE_HOSTS.has(url.hostname)) {
      if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) videoId = url.searchParams.get('v');
      else videoId = /^\/(?:shorts|live)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
    } else if (url.hostname === 'youtu.be') videoId = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
    return validVideoId(videoId) ? videoId : null;
  } catch { return null; }
}

function cleanVisit(value, currentTime, { startTime = 0, committed = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const videoId = videoFromUrl(value.url);
  const lastVisitTime = timestamp(value.lastVisitTime, currentTime);
  if (!videoId || value.videoId != null && value.videoId !== videoId || !lastVisitTime || lastVisitTime < startTime) return null;
  const title = typeof value.title === 'string' ? value.title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300) : '';
  const visit = { videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title: title || 'YouTube video', lastVisitTime };
  if (committed) {
    const importedAt = timestamp(value.importedAt, currentTime);
    if (!importedAt) return null;
    visit.importedAt = importedAt;
  }
  return visit;
}

function cleanVisits(values, currentTime, options = {}) {
  const byVideo = new Map();
  // Bound reads as well as writes, including malformed data left by an older installation.
  if (!Array.isArray(values)) return [];
  for (const value of values.slice(0, MAX_QUERY_RESULTS * 2)) {
    const visit = cleanVisit(value, currentTime, options);
    if (!visit) continue;
    const previous = byVideo.get(visit.videoId);
    if (!previous || visit.lastVisitTime > previous.lastVisitTime) byVideo.set(visit.videoId, visit);
  }
  return [...byVideo.values()].sort((a, b) => b.lastVisitTime - a.lastVisitTime || a.videoId.localeCompare(b.videoId));
}

export function normalizeImportedHistory(value, currentTime = Date.now()) {
  if (!value || value.schemaVersion !== 1) return { visits: [], updatedAt: null };
  return { visits: cleanVisits(value.visits, currentTime, { committed: true }).slice(0, MAX_IMPORTED_ROWS),
    updatedAt: timestamp(value.updatedAt, currentTime) };
}

function trustedPanel(api, panelSender, sender) {
  if (!sender || sender.id !== api.runtime.id || typeof panelSender !== 'function' || !panelSender(sender)) return false;
  try {
    const url = new URL(sender.url), extension = new URL(api.runtime.getURL(''));
    return url.protocol === 'chrome-extension:' && url.host === extension.host && !url.username && !url.password && !url.port;
  } catch { return false; }
}

export function createHistoryImportHandler({ api, panelSender, now = Date.now }) {
  // The queue only serializes active events. All durable data and pending tokens live in storage.
  let writes = Promise.resolve();
  const run = (operation) => {
    const result = writes.then(operation, operation);
    writes = result.catch(() => {});
    return result;
  };
  const currentTime = () => {
    const value = now();
    if (!Number.isFinite(value) || value <= 0 || value > 8.64e15) reject('The current time is unavailable. Please try again.');
    return value;
  };
  const granted = async () => Boolean(await api.permissions.contains(HISTORY_PERMISSION));
  const clearPreview = async () => api.storage.session.remove(HISTORY_PREVIEW_KEY);
  const requirePermission = async () => {
    if (await granted()) return;
    await clearPreview();
    reject('Chrome history access is off. You can continue learning without importing.');
  };
  const status = async () => {
    const permission = await granted();
    if (!permission) await clearPreview();
    const value = (await api.storage.local.get(HISTORY_IMPORT_KEY))[HISTORY_IMPORT_KEY];
    return { ok: true, granted: permission, ...normalizeImportedHistory(value, currentTime()) };
  };

  return async function handleHistoryImport(message, sender) {
    if (!trustedPanel(api, panelSender, sender)) reject('History import is available only in the Delta extension panel.');
    if (!MESSAGE_TYPES.has(message?.type)) reject('This history import action is not supported.');
    return run(async () => {
      try {
        if (message.type === 'HISTORY_STATUS') return await status();
        if (message.type === 'HISTORY_CANCEL') {
          await clearPreview();
          return { ok: true };
        }
        if (message.type === 'HISTORY_CLEAR') {
          await clearPreview();
          await api.storage.local.remove(HISTORY_IMPORT_KEY);
          return await status();
        }
        if (message.type === 'HISTORY_DISCONNECT') {
          await api.permissions.remove(HISTORY_PERMISSION);
          await clearPreview();
          if (await granted()) reject('Chrome history access could not be disconnected. Please try again.');
          return await status();
        }
        if (message.type === 'HISTORY_PREVIEW') {
          if (![7, 30, 90].includes(message.days)) reject('Choose a history range of 7, 30 or 90 days.');
          await requirePermission();
          // Invalidate any earlier selection before starting a new, explicitly requested scan.
          await clearPreview();
          const endTime = currentTime(), startTime = Math.max(0, endTime - message.days * DAY_MS);
          const results = await Promise.all(['youtube.com', 'youtu.be'].map((text) => api.history.search({ text, startTime, endTime, maxResults: MAX_QUERY_RESULTS })));
          if (results.some((items) => !Array.isArray(items) || items.length > MAX_QUERY_RESULTS)) reject('Chrome returned an invalid history response. Please try again.');
          await requirePermission();
          const rows = cleanVisits(results.flat(), endTime, { startTime });
          const visits = rows.slice(0, MAX_PREVIEW_ROWS);
          const token = globalThis.crypto.randomUUID();
          const truncated = rows.length > MAX_PREVIEW_ROWS || results.some((items) => items.length === MAX_QUERY_RESULTS);
          await api.storage.session.set({ [HISTORY_PREVIEW_KEY]: { schemaVersion: 1, token, owner: typeof sender.documentId === 'string' ? sender.documentId : null, createdAt: endTime,
            expiresAt: endTime + PREVIEW_TTL_MS, days: message.days, visits, truncated } });
          return { ok: true, token, visits, truncated, days: message.days };
        }
        await requirePermission();
        const time = currentTime();
        const preview = (await api.storage.session.get(HISTORY_PREVIEW_KEY))[HISTORY_PREVIEW_KEY];
        if (!preview || preview.schemaVersion !== 1 || typeof message.token !== 'string' || message.token !== preview.token
          || (preview.owner ?? null) !== (typeof sender.documentId === 'string' ? sender.documentId : null)
          || !timestamp(preview.createdAt, time) || preview.expiresAt !== preview.createdAt + PREVIEW_TTL_MS
          || time >= preview.expiresAt || ![7, 30, 90].includes(preview.days)) {
          await clearPreview();
          reject('This history preview has expired or changed. Preview your visits again.');
        }
        if (!Array.isArray(message.videoIds) || !message.videoIds.length || message.videoIds.length > MAX_PREVIEW_ROWS
          || message.videoIds.some((videoId) => !validVideoId(videoId))) reject('Choose valid videos from the current history preview.');
        const previewRows = cleanVisits(preview.visits, preview.createdAt, { startTime: Math.max(0, preview.createdAt - preview.days * DAY_MS) }).slice(0, MAX_PREVIEW_ROWS);
        const selected = new Set(message.videoIds);
        if ([...selected].some((videoId) => !previewRows.some((visit) => visit.videoId === videoId))) reject('The selection does not match this history preview. Preview your visits again.');
        const saved = (await api.storage.local.get(HISTORY_IMPORT_KEY))[HISTORY_IMPORT_KEY];
        const before = normalizeImportedHistory(saved, time);
        const merged = new Map(before.visits.map((visit) => [visit.videoId, visit]));
        for (const visit of previewRows) {
          if (!selected.has(visit.videoId)) continue;
          const previous = merged.get(visit.videoId);
          if (!previous || visit.lastVisitTime > previous.lastVisitTime) merged.set(visit.videoId, { ...visit, importedAt: time });
        }
        const visits = [...merged.values()].sort((a, b) => b.lastVisitTime - a.lastVisitTime || a.videoId.localeCompare(b.videoId)).slice(0, MAX_IMPORTED_ROWS);
        // Recheck immediately before committing in case access was revoked while storage was read.
        await requirePermission();
        const changed = JSON.stringify(visits) !== JSON.stringify(before.visits)
          || JSON.stringify(saved) !== JSON.stringify({ schemaVersion: 1, visits: before.visits, updatedAt: before.updatedAt });
        const updatedAt = changed ? time : before.updatedAt;
        if (changed) await api.storage.local.set({ [HISTORY_IMPORT_KEY]: { schemaVersion: 1, visits, updatedAt } });
        return { ok: true, granted: true, visits, updatedAt };
      } catch (error) {
        if (error instanceof HistoryImportError) throw error;
        throw new HistoryImportError('Chrome history import could not be completed. Please try again; you can continue learning without importing.');
      }
    });
  };
}
