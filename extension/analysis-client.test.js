import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, applyRecording } from './store.js';
import { ANALYSIS_CHAPTERS, analysisPayload, analysisFingerprint, normalizeApiEndpoint, endpointPermission,
  validateAnalysisResponse, fetchAnalysis, savedAnalysisView } from './analysis-client.js';

const videoId = 'En5cSXgGvZM';
const citation = (start = 2325, end = 2340) => ({ unitId: `unit:${start}:${end}`, videoId, start, end,
  url: `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(start)}s` });
export const responseFixture = () => ({ schemaVersion: 1, status: 'ready', reason: null, generatedAt: '2026-10-17T00:00:00.000Z',
  source: { method: 'gemini_youtube_video', model: 'test-model', indexVersion: 'test-index', verification: 'ai_derived_not_human_verified',
    chapters: ANALYSIS_CHAPTERS.map((item) => ({ ...item, status: 'ready' })) },
  memory: [{ id: 'memory:1', summary: 'Test paraphrase', conditions: ['Test condition'], source: citation() }],
  recommendation: { id: 'next:1', title: 'Test next segment', summary: 'Test summary', relation: 'new_example', adds: 'A different test example',
    reason: 'Test reason', usefulness: 'unknown', candidateSource: citation(2350, 2380), comparedTo: [{ memoryId: 'memory:1', source: citation() }] },
  limitations: ['Test fixture, not episode evidence'] });
const watched = { schemaVersion: 1, watched: [{ videoId, ranges: [[2325, 2340]] }] };

test('analysis payload clips to the selected chapters and omits every other title, range and metadata', () => {
  let data = applyRecording(emptyData(), { videoId, title: 'Private title', duration: 4000, ranges: [[100, 200], [2320, 2340], [2350, 2400], [2700, 3000]] }, 123);
  data = applyRecording(data, { videoId: 'abcdefghijk', title: 'Private other history', duration: 3000, ranges: [[100, 200]] }, 456);
  data.goal = '  Optional goal  ';
  const payload = analysisPayload(data);
  assert.deepEqual(payload, { schemaVersion: 1, goal: 'Optional goal', watched: [{ videoId, ranges: [[2325, 2340], [2350, 2400], [2700, 2776]] }] });
  assert.equal(JSON.stringify(payload).includes('Private'), false);
  assert.equal(JSON.stringify(payload).includes('abcdefghijk'), false);
  assert.deepEqual(analysisPayload(emptyData()), { schemaVersion: 1, watched: [] });
});

test('watch fingerprint ignores unrelated viewing and replay but changes with selected coverage or goal', () => {
  let data = applyRecording(emptyData(), { videoId, duration: 4000, ranges: [[2325, 2340]] }, 1);
  const baseline = analysisFingerprint(data);
  data = applyRecording(data, { videoId, duration: 4000, ranges: [[2326, 2330], [0, 100]] }, 2);
  data = applyRecording(data, { videoId: 'abcdefghijk', duration: 4000, ranges: [[0, 100]] }, 3);
  assert.equal(analysisFingerprint(data), baseline);
  assert.notEqual(analysisFingerprint({ ...data, goal: 'A new goal' }), baseline);
  data = applyRecording(data, { videoId, duration: 4000, ranges: [[2340, 2350]] }, 4);
  assert.notEqual(analysisFingerprint(data), baseline);
});

test('endpoint requires an exact HTTPS origin or local HTTP, never credentials, paths or redirects', async () => {
  assert.equal(normalizeApiEndpoint(' https://api.example.com/ '), 'https://api.example.com');
  assert.equal(normalizeApiEndpoint('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  assert.equal(endpointPermission('http://127.0.0.1:8787'), 'http://127.0.0.1/*');
  for (const invalid of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com?key=secret', 'https://example.com/#hash', 'javascript:alert(1)', '', null]) assert.throws(() => normalizeApiEndpoint(invalid));
  let request;
  await fetchAnalysis('https://api.example.com', watched, { fetcher: async (url, options) => {
    request = { url, options };
    return { ok: true, text: async () => JSON.stringify(responseFixture()) };
  } });
  assert.equal(request.url, 'https://api.example.com/api/recommendations');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.referrerPolicy, 'no-referrer');
  assert.deepEqual(JSON.parse(request.options.body), watched);
});

test('response source validation enforces actual watched ranges, comparison references and untouched candidate ranges', () => {
  assert.equal(validateAnalysisResponse(responseFixture(), watched).status, 'ready');
  const unknown = responseFixture(); unknown.recommendation.relation = 'unknown'; unknown.recommendation.comparedTo = [];
  assert.equal(validateAnalysisResponse(unknown, watched).recommendation.relation, 'unknown', 'an honest unknown comparison does not invent a reference');
  const mutations = [
    (value) => { value.memory[0].source.start = 2324; },
    (value) => { value.memory[0].source.end = 2341; },
    (value) => { value.memory[0].source.videoId = 'abcdefghijk'; },
    (value) => { value.recommendation.candidateSource.start = 2339; },
    (value) => { value.recommendation.comparedTo[0].memoryId = 'nonexistent'; },
    (value) => { value.recommendation.comparedTo[0].source.end = 2339; },
    (value) => { value.recommendation.comparedTo = []; },
    (value) => { value.source.chapters[0].end = 3000; },
    (value) => { value.generatedAt = 'not-date'; },
  ];
  for (const mutate of mutations) { const value = responseFixture(); mutate(value); assert.throws(() => validateAnalysisResponse(value, watched)); }
  const splitBasis = { schemaVersion: 1, watched: [{ videoId, ranges: [[2325, 2330], [2335, 2340]] }] };
  assert.throws(() => validateAnalysisResponse(responseFixture(), splitBasis), /unplayed/);
  const forgedUrl = responseFixture();
  forgedUrl.memory[0].source.url = 'https://evil.example/';
  assert.equal(validateAnalysisResponse(forgedUrl, watched).memory[0].source.url, citation().url, 'only canonical YouTube URLs leave the client validator');
});

test('only the two supported analysis methods are accepted and local Gemma keeps identical evidence requirements', () => {
  for (const method of ['gemini_youtube_video', 'local_gemma_transcript']) {
    const value = responseFixture(); value.source.method = method;
    value.source.model = method === 'local_gemma_transcript' ? 'gemma4:12b' : 'gemini-2.5-flash';
    const result = validateAnalysisResponse(value, watched);
    assert.equal(result.source.method, method);
    assert.equal(result.source.model, value.source.model);
    assert.equal(result.source.verification, 'ai_derived_not_human_verified');
    value.memory[0].source.end = 2341;
    assert.throws(() => validateAnalysisResponse(value, watched), /unplayed/);
  }
  for (const method of ['local_gemma', 'arbitrary_provider', '', null, undefined]) {
    const value = responseFixture(); value.source.method = method;
    assert.throws(() => validateAnalysisResponse(value, watched), /format/);
  }
  const verified = responseFixture(); verified.source.method = 'local_gemma_transcript'; verified.source.verification = 'human_verified';
  assert.throws(() => validateAnalysisResponse(verified, watched), /format/);
});

test('cold start never claims personal novelty and failed comparison can retain grounded memory without a recommendation', () => {
  const value = responseFixture();
  value.status = 'no_history'; value.memory = []; value.recommendation.comparedTo = []; value.recommendation.relation = 'unknown';
  assert.equal(validateAnalysisResponse(value, { watched: [] }).status, 'no_history');
  value.recommendation.relation = 'new_idea';
  assert.throws(() => validateAnalysisResponse(value, { watched: [] }), /watched baseline/);
  const unavailable = responseFixture(); unavailable.status = 'unavailable';
  assert.throws(() => validateAnalysisResponse(unavailable, watched), /incomplete/);
  unavailable.recommendation = null;
  assert.equal(validateAnalysisResponse(unavailable, watched).memory.length, 1, 'grounded memory can survive a later comparison failure');
});

test('stored analysis stays readable after history evolves and clearly becomes stale; endpoint changes hide old service results', () => {
  const data = applyRecording(emptyData(), { videoId, duration: 4000, ranges: [[2325, 2340]] });
  const saved = { schemaVersion: 1, endpoint: 'https://api.example.com', fingerprint: analysisFingerprint(data), result: responseFixture() };
  assert.equal(savedAnalysisView(saved, data, saved.endpoint).stale, false);
  const changed = applyRecording(data, { videoId, duration: 4000, ranges: [[2340, 2350]] });
  assert.equal(savedAnalysisView(saved, changed, saved.endpoint).stale, true);
  assert.equal(savedAnalysisView(saved, data, 'https://other.example.com'), null);
  assert.equal(savedAnalysisView({ ...saved, fingerprint: 'broken' }, data, saved.endpoint), null);
  const local = { ...saved, result: responseFixture() }; local.result.source.method = 'local_gemma_transcript'; local.result.source.model = 'gemma4:12b';
  assert.equal(savedAnalysisView(local, data, saved.endpoint).source.method, 'local_gemma_transcript');
});

test('network errors, rate limits, invalid replies and cancellation never produce a successful result', async () => {
  let sent = false;
  await assert.rejects(fetchAnalysis('https://api.example.com', { watched: [{ videoId, ranges: Array.from({ length: 161 }, (_, index) => [2325 + index, 2325.5 + index]) }] }, { fetcher: async () => { sent = true; } }), /160 ranges/);
  assert.equal(sent, false, 'an unsupported oversized payload never leaves the extension and is never silently truncated');
  await assert.rejects(fetchAnalysis('https://api.example.com', watched, { fetcher: async () => ({ ok: false, status: 429 }) }), /busy/);
  await assert.rejects(fetchAnalysis('https://api.example.com', watched, { fetcher: async () => ({ ok: true, text: async () => 'not-json' }) }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchAnalysis('https://api.example.com', watched, { signal: controller.signal, fetcher: async (_url, options) => {
    assert.equal(options.signal.aborted, true); throw Object.assign(Error('aborted'), { name: 'AbortError' });
  } }), /stopped/);
  await assert.rejects(fetchAnalysis('https://api.example.com', watched, { timeoutMs: 5, fetcher: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })))) }), /timed out/);
});
