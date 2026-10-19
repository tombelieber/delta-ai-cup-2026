import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapPanelController, MAP_ACCESS_KEY } from './map-panel-controller.js';
import { MAP_CLASSIFICATION_KEY, mapMetadataFingerprint, mergeMapClassifications, markMapReviewed } from './map-model.js';

const endpoint = 'https://map.example.com';
const now = new Date(2026, 9, 19, 12).getTime();
const token = 'owner_private_capability_1234567890';
const video = n => ({ videoId: `v${String(n).padStart(10, '0')}`, title: `Actual video ${n}`, date: '2026-10-19', watchedSeconds: 25, notes: 'Private note' });
const assignment = entry => ({ videoId: entry.videoId, path: ['AI tools', 'Coding agents', 'Claude Code'], confidence: 'high', contentType: 'knowledge', metadataFingerprint: mapMetadataFingerprint(entry) });
const stored = entries => mergeMapClassifications(null, entries.map(assignment), { endpoint, model: 'approved-free-model', now });
function harness({ entries = [video(1)], fetchImpl, initial = {}, request = () => Promise.resolve(true), selectedEndpoint = endpoint, openHostedAction } = {}) {
  const data = structuredClone(initial), calls = [], writes = [];
  let currentEndpoint = selectedEndpoint;
  const storage = {
    async get(key) { calls.push(`get:${key}`); return { [key]: structuredClone(data[key]) }; },
    async set(value) { writes.push(structuredClone(value)); Object.assign(data, structuredClone(value)); },
  };
  const controller = createMapPanelController({ storage, permissions: { request(value) { calls.push(`permission:${value.origins[0]}`); return request(value); } },
    libraryClient: { async list() { calls.push('library'); return { journal: { entries } }; } }, readEndpoint: () => currentEndpoint, now: () => now, openHostedAction,
    fetchImpl: fetchImpl || (async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(`fetch:${body.videos.length}`);
      return { ok: true, text: async () => JSON.stringify({ schemaVersion: 1, items: body.videos.map(assignment), cached: 0, model: 'approved-free-model' }) };
    }) });
  return { controller, data, calls, writes, entries, setEndpoint: value => { currentEndpoint = value; } };
}

const publicEndpoint = 'https://delta-assistant-613646062582.us-central1.run.app';
const enabledConfig = () => ({ ok: true, text: async () => JSON.stringify({ enabled: true }) });

test('public map needs no owner code and requests only its exact host before checking Google configuration', async () => {
  const fetches = [], hosted = [];
  const { controller, data, calls } = harness({ selectedEndpoint: publicEndpoint, fetchImpl: async (url, options) => { fetches.push({ url, options }); return enabledConfig(); },
    openHostedAction: async options => { hosted.push(options); return { schemaVersion: 1, model: 'approved-free-model', cached: 0, items: options.payload.videos.map(assignment) }; } });
  const initial = await controller.get();
  assert.equal(initial.accessMode, 'google'); assert.equal(initial.accessConfigured, false); assert.equal(fetches.length, 0);
  await assert.rejects(controller.setAccessToken(token), issue => issue.code === 'GOOGLE_SIGN_IN_REQUIRED');
  assert.equal(Object.hasOwn(data, MAP_ACCESS_KEY), false);
  calls.length = 0;
  const beginning = controller.begin();
  assert.deepEqual(calls, ['permission:https://delta-assistant-613646062582.us-central1.run.app/*']);
  await beginning; const result = await controller.classifyNext();
  assert.equal(fetches.length, 1); assert.equal(fetches[0].url, `${publicEndpoint}/api/study/auth-config`);
  assert.equal(hosted.length, 1); assert.equal(hosted[0].action, 'classify');
  assert.equal(JSON.stringify(hosted[0].payload).includes('Private note'), false);
  assert.equal(result.status.processed, 1); assert.equal(result.status.pending, 0);
});

test('public queue uses bounded ten-video batches and saves partial results without resubmitting unresolved metadata', async () => {
  const sizes = [];
  const { controller, data } = harness({ selectedEndpoint: publicEndpoint, entries: Array.from({ length: 25 }, (_, n) => video(n)), fetchImpl: async () => enabledConfig(),
    openHostedAction: async ({ payload }) => {
      sizes.push(payload.videos.length);
      return { schemaVersion: 1, model: 'approved-free-model', cached: 0, items: payload.videos.slice(1).map(assignment), unresolvedIds: [payload.videos[0].videoId] };
    } });
  await controller.begin();
  let result;
  for (let n = 0; n < 3; n++) result = await controller.classifyNext();
  assert.deepEqual(sizes, [10, 10, 5]);
  assert.equal(result.status.pending, 0); assert.equal(result.status.reviewed, 25); assert.equal(result.status.processed, 22);
  assert.equal(Object.keys(data[MAP_CLASSIFICATION_KEY].reviews).length, 25);
  assert.equal((await controller.classifyNext()).batch.submitted, 0); assert.equal(sizes.length, 3);
});

test('public auth configuration failure pauses before any hosted action and preserves existing map results', async () => {
  let hosted = 0;
  const prior = stored([video(2)]);
  const { controller, data } = harness({ selectedEndpoint: publicEndpoint, initial: { [MAP_CLASSIFICATION_KEY]: prior },
    fetchImpl: async () => ({ ok: true, text: async () => '{"enabled":false}' }), openHostedAction: async () => { hosted++; } });
  await assert.rejects(controller.begin(), issue => issue.code === 'AUTH_UNAVAILABLE');
  await assert.rejects(controller.classifyNext(), issue => issue.code === 'PERMISSION_REQUIRED');
  assert.deepEqual(data[MAP_CLASSIFICATION_KEY], prior); assert.equal(hosted, 0);
});

test('public map hides older uncertain assignments without deleting private local classifications', async () => {
  const prior = stored([video(1)]); prior.assignments[video(1).videoId].confidence = 'medium';
  const { controller, data } = harness({ selectedEndpoint: publicEndpoint, initial: { [MAP_CLASSIFICATION_KEY]: prior } });
  const snapshot = await controller.get();
  assert.equal(snapshot.status.processed, 0); assert.equal(snapshot.status.unresolved, 1);
  assert.deepEqual(snapshot.classifications.assignments, {});
  assert.equal(data[MAP_CLASSIFICATION_KEY].assignments[video(1).videoId].confidence, 'medium');
});

test('a stale or cancelled hosted result never marks newly changed metadata as reviewed', async () => {
  let resolveHosted, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const { controller, entries, data } = harness({ selectedEndpoint: publicEndpoint, fetchImpl: async () => enabledConfig(),
    openHostedAction: ({ payload }) => { started(payload); return new Promise(resolve => { resolveHosted = resolve; }); } });
  await controller.begin(); const work = controller.classifyNext(); const submitted = await waiting;
  entries[0].title = 'A changed title'; controller.cancel();
  resolveHosted({ schemaVersion: 1, model: 'approved-free-model', cached: 0, items: submitted.videos.map(assignment) });
  await assert.rejects(work, issue => issue.code === 'CANCELLED');
  assert.equal(Object.hasOwn(data, MAP_CLASSIFICATION_KEY), false);
  assert.equal((await controller.get()).status.pending, 1);
});

test('opening, getting state and storing owner capability never request permission or start analysis', async () => {
  const { controller, data, calls } = harness();
  const first = await controller.get();
  assert.deepEqual(first.status, { state: 'idle', processed: 0, reviewed: 0, pending: 1, unresolved: 1, total: 1 });
  assert.equal(first.accessConfigured, false);
  assert.equal(calls.some(call => call.startsWith('fetch:') || call.startsWith('permission:')), false);
  await controller.setAccessToken(token);
  assert.deepEqual(data[MAP_ACCESS_KEY], { schemaVersion: 1, endpoint, token });
  assert.equal((await controller.get()).accessConfigured, true);
  assert.equal(Object.hasOwn(data, MAP_CLASSIFICATION_KEY), false);
  await controller.setAccessToken('');
  assert.equal((await controller.get()).accessConfigured, false);
});

test('begin requests only the selected host synchronously in the button gesture, and decline preserves prior records/results', async () => {
  const prior = stored([video(1)]);
  const { controller, calls, data } = harness({ request: () => Promise.resolve(false), initial: { [MAP_CLASSIFICATION_KEY]: prior } });
  const beginning = controller.begin();
  assert.deepEqual(calls, ['permission:https://map.example.com/*']);
  await assert.rejects(beginning, issue => issue.code === 'PERMISSION_DENIED');
  assert.deepEqual(data[MAP_CLASSIFICATION_KEY], prior);
  assert.equal((await controller.get()).status.state, 'paused');
  assert.equal(calls.some(call => call.startsWith('fetch:')), false);
});

test('native queue classifies at most 300 real records per request, serializes duplicate calls, and retains every batch', async () => {
  const entries = Array.from({ length: 603 }, (_, index) => video(index));
  let requests = 0;
  const { controller, data } = harness({ entries, fetchImpl: async (_url, options) => {
    requests++; const body = JSON.parse(options.body);
    assert.equal(options.headers['x-delta-map-token'], token);
    assert.equal(body.videos.length <= 300, true);
    assert.equal(options.body.includes('Private note'), false);
    assert.equal(body.videos.some(entry => Object.hasOwn(entry, 'date') || Object.hasOwn(entry, 'watchedSeconds')), false);
    return { ok: true, text: async () => JSON.stringify({ schemaVersion: 1, items: body.videos.map(assignment), cached: 0, model: 'approved-free-model' }) };
  } });
  await controller.setAccessToken(token); await controller.begin();
  const first = controller.classifyNext(), duplicate = controller.classifyNext();
  assert.equal(first, duplicate);
  assert.equal((await first).batch.submitted, 300);
  assert.equal((await controller.get()).status.processed, 300);
  assert.equal((await controller.classifyNext()).batch.submitted, 300);
  const last = await controller.classifyNext();
  assert.equal(last.batch.submitted, 3); assert.equal(last.status.processed, 603); assert.equal(last.status.pending, 0);
  assert.equal(Object.keys(data[MAP_CLASSIFICATION_KEY].assignments).length, 603);
  assert.equal(Object.keys(data[MAP_CLASSIFICATION_KEY].reviews).length, 603);
  assert.equal(last.status.reviewed, 603);
  assert.equal((await controller.classifyNext()).batch.submitted, 0);
  assert.equal(requests, 3, 'reaching the end never submits an empty or repeated request');
});

test('omitted results persist as reviewed across begin and reopen without repeatedly consuming quota', async () => {
  let requests = 0;
  const { controller, data } = harness({ fetchImpl: async () => { requests++; return { ok: true, text: async () => JSON.stringify({ schemaVersion: 1, items: [], unresolvedIds: [video(1).videoId], cached: 0, model: 'approved-free-model' }) }; } });
  await controller.setAccessToken(token); await controller.begin();
  const result = await controller.classifyNext();
  assert.equal(result.status.unresolved, 1); assert.equal(result.status.pending, 0); assert.equal(result.status.reviewed, 1);
  assert.equal(result.status.processed, 0);
  assert.deepEqual(data[MAP_CLASSIFICATION_KEY].assignments, {});
  assert.equal(data[MAP_CLASSIFICATION_KEY].reviews[video(1).videoId].metadataFingerprint, mapMetadataFingerprint(video(1)));
  assert.equal((await controller.classifyNext()).batch.submitted, 0); assert.equal(requests, 1);
  await controller.begin(); await controller.classifyNext();
  assert.equal(requests, 1);
  controller.destroy();
  const reopened = harness({ initial: data });
  const snapshot = await reopened.controller.get();
  assert.equal(snapshot.status.reviewed, 1); assert.equal(snapshot.status.pending, 0); assert.equal(snapshot.status.processed, 0);
  await reopened.controller.begin();
  assert.equal((await reopened.controller.classifyNext()).batch.submitted, 0);
  assert.equal(reopened.calls.some(call => call.startsWith('fetch:')), false);
});

test('a changed title after an unresolved review becomes pending again while private activity edits do not', async () => {
  const reviewed = markMapReviewed(null, [video(1)], { now, endpoint, model: 'approved-free-model' });
  const { controller, entries } = harness({ initial: { [MAP_CLASSIFICATION_KEY]: reviewed } });
  assert.equal((await controller.get()).status.pending, 0);
  entries[0].notes = 'Another private note'; entries[0].watchedSeconds = 80;
  assert.equal((await controller.get()).status.pending, 0);
  entries[0].title = 'A newly informative source title';
  assert.equal((await controller.get()).status.pending, 1);
  assert.equal((await controller.get()).status.reviewed, 0);
  await controller.setAccessToken(token); await controller.begin();
  const result = await controller.classifyNext();
  assert.equal(result.batch.submitted, 1); assert.equal(result.status.reviewed, 1); assert.equal(result.status.processed, 1);
});

test('get honors title changes but accepts missing creator enrichment from the ordinary extension journal', async () => {
  const original = { ...video(1), channel: 'Known source' };
  const { controller, entries } = harness({ entries: [video(1)], initial: { [MAP_CLASSIFICATION_KEY]: stored([original]) } });
  assert.equal((await controller.get()).status.processed, 1);
  assert.equal((await controller.get()).status.reviewed, 1, 'legacy assignments count as reviewed without requiring a new model call');
  entries[0].title = 'Changed source title';
  assert.equal((await controller.get()).status.processed, 0);
  assert.equal((await controller.get()).status.pending, 1);
});

test('private results imports validate every assignment and merge without replacing newer existing assignments or touching history', async () => {
  const existing = stored([video(1)]), incoming = stored([video(2)]);
  const { controller, data, writes } = harness({ entries: [video(1), video(2)], initial: { [MAP_CLASSIFICATION_KEY]: existing, 'delta.youtube-history.v1': { privateHistory: true } } });
  const invalid = structuredClone(incoming); invalid.assignments[video(2).videoId].path = ['人工智能', 'Agents'];
  await assert.rejects(controller.importResults(invalid), issue => issue.code === 'INVALID_IMPORT');
  assert.equal(writes.length, 0);
  const result = await controller.importResults(incoming);
  assert.equal(Object.keys(result.classifications.assignments).length, 2);
  assert.deepEqual(data['delta.youtube-history.v1'], { privateHistory: true });
  assert.equal(writes.every(write => Object.keys(write).every(key => key === MAP_CLASSIFICATION_KEY)), true);
});

test('review imports validate every mark, preserve newer and legacy backups, and count only matching current inventory', async () => {
  const existing = markMapReviewed(null, [video(1)], { now: now + 100, endpoint, model: 'approved-free-model' });
  const incoming = markMapReviewed(null, [video(2), video(99)], { now, endpoint, model: 'approved-free-model' });
  const { controller, data, writes } = harness({ entries: [video(1), video(2), video(3)], initial: { [MAP_CLASSIFICATION_KEY]: existing, 'delta.youtube-history.v1': { privateHistory: true } } });
  const invalid = structuredClone(incoming); invalid.reviews[video(2).videoId].metadataFingerprint = 'bad';
  await assert.rejects(controller.importResults(invalid), issue => issue.code === 'INVALID_IMPORT');
  await assert.rejects(controller.importResults({ schemaVersion: 1, assignments: {}, reviews: [] }), issue => issue.code === 'INVALID_IMPORT');
  assert.equal(writes.length, 0);
  const imported = await controller.importResults(incoming);
  assert.equal(Object.keys(imported.classifications.reviews).length, 3);
  assert.equal(imported.status.reviewed, 2); assert.equal(imported.status.pending, 1); assert.equal(imported.status.processed, 0);
  assert.equal(imported.status.unresolved, 3);
  const oldReview = markMapReviewed(null, [video(1)], { now: now - 1, endpoint, model: 'older-model' });
  await controller.importResults(oldReview);
  await controller.importResults({ schemaVersion: 1, assignments: {}, updatedAt: now });
  assert.equal(data[MAP_CLASSIFICATION_KEY].reviews[video(1).videoId].reviewedAt, now + 100);
  assert.equal(Object.keys(data[MAP_CLASSIFICATION_KEY].reviews).length, 3);
  assert.deepEqual(data[MAP_CLASSIFICATION_KEY].assignments, {});
  assert.deepEqual(data['delta.youtube-history.v1'], { privateHistory: true });
});

test('invalid or failed provider responses never mark submitted records as reviewed', async () => {
  for (const fetchImpl of [async () => { throw Error('Unavailable'); }, async () => ({ ok: false, status: 429, text: async () => '{}' }),
    async () => ({ ok: true, text: async () => JSON.stringify({ schemaVersion: 1, items: [assignment(video(99))], cached: 0, model: 'approved-free-model' }) })]) {
    const { controller, data } = harness({ fetchImpl });
    await controller.setAccessToken(token); await controller.begin();
    await assert.rejects(controller.classifyNext());
    assert.equal(Object.hasOwn(data, MAP_CLASSIFICATION_KEY), false);
    const state = (await controller.get()).status;
    assert.equal(state.reviewed, 0); assert.equal(state.pending, 1);
  }
});

test('quota, missing access and endpoint changes pause honestly without retrying, uploading to another origin or losing cached results', async () => {
  let requests = 0;
  const prior = stored([video(1)]);
  const { controller, data, setEndpoint } = harness({ entries: [video(1), video(2)], initial: { [MAP_CLASSIFICATION_KEY]: prior }, fetchImpl: async () => {
    requests++; return { ok: false, status: 429, text: async () => JSON.stringify({ error: 'free_tier_quota_exhausted', retryAfterSeconds: 60 }) };
  } });
  await assert.rejects(controller.classifyNext(), issue => issue.code === 'PERMISSION_REQUIRED');
  await controller.begin();
  await assert.rejects(controller.classifyNext(), issue => issue.code === 'ACCESS_REQUIRED');
  await controller.setAccessToken(token); await controller.begin();
  await assert.rejects(controller.classifyNext(), issue => issue.code === 'free_tier_quota_exhausted');
  assert.equal((await controller.get()).status.retryAfter, now + 60000);
  assert.deepEqual(data[MAP_CLASSIFICATION_KEY], prior); assert.equal(requests, 1);
  setEndpoint('https://another.example.com');
  assert.equal((await controller.get()).accessConfigured, false);
  await assert.rejects(controller.classifyNext(), issue => issue.code === 'PERMISSION_REQUIRED');
  assert.equal(requests, 1);
});

test('concurrent imported results and endpoint edits cannot erase a validated network batch', async () => {
  let resolveFetch;
  const held = new Promise(resolve => { resolveFetch = resolve; });
  const { controller, data, setEndpoint } = harness({ entries: [video(1)], fetchImpl: async () => held });
  await controller.setAccessToken(token); await controller.begin();
  const work = controller.classifyNext();
  await new Promise(resolve => setTimeout(resolve, 0));
  await controller.importResults(stored([video(2)]));
  setEndpoint('https://new.example.com');
  resolveFetch({ ok: true, text: async () => JSON.stringify({ schemaVersion: 1, items: [assignment(video(1))], cached: 0, model: 'approved-free-model' }) });
  const result = await work;
  assert.equal(Object.keys(data[MAP_CLASSIFICATION_KEY].assignments).length, 2);
  assert.equal(data[MAP_CLASSIFICATION_KEY].assignments[video(1).videoId].endpoint, endpoint);
  assert.equal(result.accessConfigured, false);
});

test('panel closure aborts owned network work and retains earlier batches; nothing auto-starts on reopen', async () => {
  const prior = stored([video(2)]);
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const { controller, data } = harness({ entries: [video(1), video(2)], initial: { [MAP_CLASSIFICATION_KEY]: prior }, fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
    started(); options.signal.addEventListener('abort', () => reject(Object.assign(Error('Aborted'), { name: 'AbortError' })));
  }) });
  await controller.setAccessToken(token); await controller.begin();
  const work = controller.classifyNext(); await startedPromise;
  controller.destroy();
  await assert.rejects(work, issue => issue.code === 'CANCELLED');
  assert.deepEqual(data[MAP_CLASSIFICATION_KEY], prior);
  const reopened = harness({ entries: [video(1), video(2)], initial: data });
  assert.equal((await reopened.controller.get()).status.processed, 1);
  assert.equal(reopened.calls.some(call => call.startsWith('fetch:')), false);
});
