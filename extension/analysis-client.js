import { mergeIntervals, normalizeData } from './store.js';

export const ANALYSIS_SETTINGS_KEY = 'zhixin.analysis.settings.v1';
export const ANALYSIS_RESULT_KEY = 'zhixin.analysis.result.v1';
export const DEFAULT_API_ENDPOINT = 'https://delta-assistant-613646062582.us-central1.run.app';
export const ANALYSIS_SOURCE_METHODS = Object.freeze(['gemini_youtube_video', 'local_gemma_transcript']);
// Metadata only: the authored prototype summaries are never analysis evidence.
export const ANALYSIS_CHAPTERS = [
  { videoId: 'En5cSXgGvZM', start: 2325, end: 2776 },
  { videoId: 'bxBzsSsqQAM', start: 1170, end: 1884 },
  { videoId: 'DKrBGOFs0GY', start: 2836, end: 3123 },
];

export function normalizeApiEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) throw Error('Enter the API service URL.');
  let url;
  try { url = new URL(value.trim()); } catch { throw Error('Enter a valid API service URL.'); }
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (!(url.protocol === 'https:' || local && url.protocol === 'http:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw Error('Use an HTTPS domain, or localhost HTTP for local development. Omit paths, credentials, and parameters.');
  }
  return url.origin;
}

// Chrome host permission patterns cover a host's ports. Network requests still
// use the exact validated origin, including its port, and reject redirects.
export const endpointPermission = (endpoint) => {
  const url = new URL(normalizeApiEndpoint(endpoint));
  return `${url.protocol}//${url.hostname}/*`;
};
export function analysisPayload(data) {
  const stored = normalizeData(data);
  const watched = ANALYSIS_CHAPTERS.map(({ videoId, start, end }) => ({ videoId,
    ranges: mergeIntervals((stored.videos[videoId]?.ranges || []).map(([from, to]) => [Math.max(start, from), Math.min(end, to)])),
  })).filter((item) => item.ranges.length);
  const goal = stored.goal.trim();
  return { schemaVersion: 1, ...(goal ? { goal } : {}), watched };
}
export const analysisFingerprint = (data) => JSON.stringify(analysisPayload(data));

const text = (value, max = 4000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error('Invalid analysis service response format.');
  return value;
};
const covered = (source, payload) => (payload.watched.find((item) => item.videoId === source.videoId)?.ranges || [])
  .some(([start, end]) => start <= source.start && end >= source.end);
const overlaps = (source, payload) => (payload.watched.find((item) => item.videoId === source.videoId)?.ranges || [])
  .some(([start, end]) => start < source.end && end > source.start);
function source(value) {
  const chapter = ANALYSIS_CHAPTERS.find((item) => item.videoId === value?.videoId);
  if (!chapter || !Number.isFinite(value.start) || !Number.isFinite(value.end) || value.start < chapter.start || value.end > chapter.end || value.end <= value.start) {
    throw Error('Analysis source is outside the supported chapters.');
  }
  return { unitId: text(value.unitId, 200), videoId: chapter.videoId, start: value.start, end: value.end,
    url: `https://www.youtube.com/watch?v=${chapter.videoId}&t=${Math.floor(value.start)}s` };
}
export function validateAnalysisResponse(value, payload) {
  if (!value || value.schemaVersion !== 1 || !['ready', 'no_history', 'insufficient_source', 'unavailable'].includes(value.status)
    || !Array.isArray(value.memory) || value.memory.length > 100 || !Array.isArray(value.limitations) || value.limitations.length > 30
    || !Number.isFinite(Date.parse(value.generatedAt)) || !value.source || !ANALYSIS_SOURCE_METHODS.includes(value.source.method)
    || value.source.verification !== 'ai_derived_not_human_verified' || !Array.isArray(value.source.chapters) || value.source.chapters.length > 3) {
    throw Error('Invalid analysis service response format.');
  }
  const memory = value.memory.map((item) => {
    const citation = source(item.source);
    if (!covered(citation, payload)) throw Error('Analysis memory cites an unplayed range.');
    if (!Array.isArray(item.conditions) || item.conditions.length > 20) throw Error('Invalid analysis service response format.');
    return { id: text(item.id, 200), summary: text(item.summary), conditions: item.conditions.map((item) => text(item)), source: citation };
  });
  if (new Set(memory.map((item) => item.id)).size !== memory.length) throw Error('Duplicate analysis memory IDs.');
  if (value.status === 'no_history' && memory.length) throw Error('A watched baseline is required to claim personal added value.');
  let recommendation = null;
  if (value.recommendation !== null) {
    const item = value.recommendation;
    if (!item || !['repeated', 'new_example', 'new_idea', 'opposing', 'unknown'].includes(item.relation)
      || !['relevant', 'limited', 'unknown'].includes(item.usefulness) || !Array.isArray(item.comparedTo) || item.comparedTo.length > 100) throw Error('Invalid analysis service response format.');
    const candidateSource = source(item.candidateSource);
    if (overlaps(candidateSource, payload)) throw Error('The recommended clip includes a played range. Run the analysis again.');
    const comparedTo = item.comparedTo.map((comparison) => {
      const baseline = memory.find((entry) => entry.id === comparison.memoryId);
      const citation = source(comparison.source);
      if (!baseline || JSON.stringify(baseline.source) !== JSON.stringify(citation)) throw Error('The comparison baseline has no matching watched memory.');
      return { memoryId: baseline.id, source: citation };
    });
    if (value.status === 'no_history' && (memory.length || comparedTo.length || item.relation !== 'unknown')) throw Error('A watched baseline is required to claim personal added value.');
    if (item.relation !== 'unknown' && !comparedTo.length) throw Error('The added-value classification is missing a watched source.');
    recommendation = { id: text(item.id, 200), title: text(item.title, 500), summary: text(item.summary), relation: item.relation,
      adds: text(item.adds), reason: text(item.reason), usefulness: item.usefulness, candidateSource, comparedTo };
  }
  if (value.status === 'ready' && (!memory.length || !recommendation)) throw Error('The personal comparison is missing a watched source.');
  if (value.status === 'unavailable' && recommendation) throw Error('An incomplete comparison cannot return a recommendation.');
  return { schemaVersion: 1, status: value.status, reason: value.reason === null ? null : text(value.reason, 100), generatedAt: value.generatedAt,
    source: { method: value.source.method, model: value.source.model === null ? null : text(value.source.model, 200),
      indexVersion: text(value.source.indexVersion, 200), verification: value.source.verification,
      chapters: value.source.chapters.map((chapter) => {
        const allowed = ANALYSIS_CHAPTERS.find((item) => item.videoId === chapter.videoId);
        if (!allowed || chapter.start !== allowed.start || chapter.end !== allowed.end || !['ready', 'unavailable'].includes(chapter.status)) throw Error('Invalid analysis chapter source.');
        return { ...allowed, status: chapter.status };
      }) }, memory, recommendation, limitations: value.limitations.map((item) => text(item)) };
}

export async function fetchAnalysis(endpoint, payload, { fetcher = globalThis.fetch, timeoutMs = 300000, signal } = {}) {
  const origin = normalizeApiEndpoint(endpoint);
  const body = JSON.stringify(payload);
  if (payload.watched.some((item) => item.ranges.length > 160) || new TextEncoder().encode(body).length > 16384) {
    throw Error('Watch segments exceed the MVP limit of 160 ranges per video or 16 KB per analysis. Your local watch history is saved.');
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${origin}/api/recommendations`, { method: 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal });
    if (!response.ok) throw Error(response.status === 429 ? 'The analysis service is busy. Try again later.' : 'The analysis service could not complete the request. Your watch history is saved.');
    const raw = await response.text();
    if (raw.length > 300000) throw Error('The analysis response is too large. Try again.');
    return validateAnalysisResponse(JSON.parse(raw), payload);
  } catch (error) {
    if (signal?.aborted) throw Error('Analysis stopped. Your watch history is saved.');
    if (error.name === 'AbortError') throw Error('Analysis timed out. Try again later. Your watch history is saved.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export function savedAnalysisView(saved, data, endpoint) {
  if (!saved || saved.schemaVersion !== 1 || saved.endpoint !== endpoint || typeof saved.fingerprint !== 'string' || !saved.result) return null;
  try {
    const payload = JSON.parse(saved.fingerprint);
    const result = validateAnalysisResponse(saved.result, payload);
    return { ...result, stale: saved.fingerprint !== analysisFingerprint(data) };
  } catch { return null; }
}
