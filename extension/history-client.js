const permission = () => ({ permissions: ['history'] });
const daysAllowed = new Set([7, 30, 90]);
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

export class HistoryImportError extends Error {
  constructor(message, code = 'history_error') {
    super(message);
    this.name = 'HistoryImportError';
    this.code = code;
  }
}

export function isHistoryClientAvailable({ runtime, permissions } = {}) {
  return typeof runtime?.sendMessage === 'function' && typeof permissions?.request === 'function';
}

// Do not turn response URLs into links without checking the worker's canonical form.
function visitsFrom(response) {
  if (!Array.isArray(response.visits)) throw new HistoryImportError('Chrome history returned an invalid response. Please try again.', 'invalid_response');
  const seen = new Set();
  return response.visits.map((visit) => {
    if (!videoIdPattern.test(visit?.videoId || '') || visit.url !== `https://www.youtube.com/watch?v=${visit.videoId}` ||
      !Number.isFinite(visit.lastVisitTime) || visit.lastVisitTime < 0 || seen.has(visit.videoId)) {
      throw new HistoryImportError('Chrome history returned an invalid video link. Please try again.', 'invalid_response');
    }
    seen.add(visit.videoId);
    return { videoId: visit.videoId, url: visit.url, title: typeof visit.title === 'string' ? visit.title.slice(0, 300) : 'YouTube video',
      lastVisitTime: visit.lastVisitTime, ...(Number.isFinite(visit.importedAt) ? { importedAt: visit.importedAt } : {}) };
  });
}

export function createHistoryClient({ runtime, permissions } = {}) {
  const available = isHistoryClientAvailable({ runtime, permissions });
  let generation = 0;
  function ensureAvailable() {
    if (!available) throw new HistoryImportError('Open Delta in Chrome’s side panel to import past visits. You can keep learning without importing.', 'unavailable');
  }
  async function request(message) {
    ensureAvailable();
    let response;
    try { response = await runtime.sendMessage(message); }
    catch { throw new HistoryImportError('Delta could not reach Chrome history. Reload the extension and try again.', 'connection_error'); }
    if (!response?.ok) {
      const message = typeof response?.error === 'string' && /^[\x20-\x7e\n’–—]+$/.test(response.error) ? response.error.slice(0, 300) : 'Chrome history could not complete this action. Please try again.';
      throw new HistoryImportError(message, response?.code || 'history_error');
    }
    return response;
  }
  function snapshot(response) {
    return { ...response, granted: response.granted === true, visits: visitsFrom(response) };
  }
  function assertCurrent(expected) {
    if (generation !== expected) throw new HistoryImportError('History import was cancelled.', 'cancelled');
  }
  return {
    available,
    async status() { return snapshot(await request({ type: 'HISTORY_STATUS' })); },
    async preview(days = 30) {
      ensureAvailable();
      if (!daysAllowed.has(days)) throw new HistoryImportError('Choose the last 7, 30 or 90 days.', 'invalid_days');
      const expected = ++generation;
      // This call must happen in the button's synchronous user-gesture turn.
      // Never await a permission check, status request or storage read before it.
      let permissionResult;
      try { permissionResult = permissions.request(permission()); }
      catch { throw new HistoryImportError('Chrome could not show the history permission prompt. Please try the button again.', 'permission_error'); }
      let granted;
      try { granted = await permissionResult; }
      catch { throw new HistoryImportError('Chrome could not show the history permission prompt. Please try the button again.', 'permission_error'); }
      assertCurrent(expected);
      if (!granted) throw new HistoryImportError('History access was not allowed. You can keep using lessons, practice and saved learning.', 'permission_denied');
      const response = await request({ type: 'HISTORY_PREVIEW', days });
      assertCurrent(expected);
      if (typeof response.token !== 'string' || !response.token) throw new HistoryImportError('The history review expired. Please scan again.', 'invalid_response');
      return { ...response, visits: visitsFrom(response) };
    },
    async importSelected(token, videoIds) {
      if (typeof token !== 'string' || !token || !Array.isArray(videoIds) || !videoIds.length || videoIds.length > 200 || videoIds.some((id) => !videoIdPattern.test(id))) {
        throw new HistoryImportError('Select at least one video from the current review.', 'invalid_selection');
      }
      const expected = generation;
      const response = await request({ type: 'HISTORY_IMPORT', token, videoIds: [...new Set(videoIds)] });
      assertCurrent(expected);
      return snapshot(response);
    },
    async clear() { generation += 1; return snapshot(await request({ type: 'HISTORY_CLEAR' })); },
    async disconnect() { generation += 1; return snapshot(await request({ type: 'HISTORY_DISCONNECT' })); },
    async cancel() { generation += 1; return request({ type: 'HISTORY_CANCEL' }); },
  };
}
