import test from 'node:test';
import assert from 'node:assert/strict';
import { installBackground } from './background.js';
import { STORE_KEY, LIVE_PREFIX } from './store.js';
import { ANALYSIS_CHAPTERS, ANALYSIS_RESULT_KEY, DEFAULT_API_ENDPOINT } from './analysis-client.js';
import { ANALYSIS_PREPARED_KEY } from './background.js';
import { SKILLS_STORE_KEY, emptySkills, setFamiliarity } from '../src/learning/skill-records.mjs';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const videoId = 'En5cSXgGvZM';
const otherId = 'bxBzsSsqQAM';
const panelSender = { id: extensionId, url: `chrome-extension://${extensionId}/panel.html` };
const contentSender = { id: extensionId, url: `https://www.youtube.com/watch?v=${videoId}`, frameId: 0, tab: { id: 7 } };
const recorder = (overrides = {}) => ({ type: 'RECORDER_SAMPLE', sample: { videoId, title: 'A real video', duration: 120, currentTime: 20, status: 'playing', epoch: 0, ranges: [[10, 20]], ...overrides } });

function event() {
  const listeners = [];
  return { listeners, addListener(listener) { listeners.push(listener); } };
}

function storageArea() {
  let values = {};
  let nextError = null;
  return {
    async get(key) { return structuredClone({ [key]: values[key] }); },
    async set(update) {
      if (nextError) { const error = nextError; nextError = null; throw error; }
      values = { ...values, ...structuredClone(update) };
    },
    async remove(key) { delete values[key]; },
    async setAccessLevel() {},
    failNextSet() { nextError = Error('storage offline'); },
    snapshot() { return structuredClone(values); },
  };
}

function fixture({ permissionGranted = true } = {}) {
  const openedTabs = [];
  const panelOptions = [];
  const api = {
    runtime: { id: extensionId, getURL: (path) => `chrome-extension://${extensionId}/${path}`, onMessage: event(), onInstalled: event(), onStartup: event() },
    storage: { local: storageArea(), session: storageArea() },
    tabs: { async create(tab) { openedTabs.push(tab); }, async query() { return []; }, onUpdated: event(), onRemoved: event() },
    sidePanel: { async setOptions(options) { panelOptions.push(options); }, async setPanelBehavior() {} },
    permissions: { async contains() { return permissionGranted; } },
  };
  const background = installBackground(api, () => 42);
  return { api, background, openedTabs, panelOptions, send: (message, sender = panelSender) => background.handle(message, sender) };
}

test('global skill revisions reach recorder views without exposing the skill record or changing watched ranges', async () => {
  const { send, api } = fixture();
  await send(recorder(), contentSender);
  const watched = structuredClone(api.storage.local.snapshot()[STORE_KEY]);
  const value = setFamiliarity(emptySkills(), 'excel-column-total', true, '2026-10-17T09:00:00.000Z');
  await send({ type: 'LEARNING_SKILLS_SET', expectedEndpoint: DEFAULT_API_ENDPOINT, value, expectedRevision: 0, writerId: 'skills-writer' });
  const response = await send(recorder({ ranges: [] }), contentSender);
  assert.equal(response.view.skillsRevision, 1);
  assert.equal(response.view.skillsWriterId, 'skills-writer');
  assert.equal(JSON.stringify(response.view).includes('excel-column-total'), false, 'recorder only receives compact synchronization metadata');
  assert.deepEqual(api.storage.local.snapshot()[STORE_KEY], watched);
  const restarted = installBackground(api, () => 42);
  const restored = await restarted.handle({ type: 'LEARNING_SKILLS_GET', expectedEndpoint: DEFAULT_API_ENDPOINT }, panelSender);
  assert.deepEqual(restored.value, value);
  assert.equal(restored.revision, 1);
  assert.deepEqual(api.storage.local.snapshot()[SKILLS_STORE_KEY].value, value);
});

test('only this extension content script in the top YouTube frame can report playback', async () => {
  const { send, api } = fixture();
  const invalidSenders = [
    { ...contentSender, id: 'another-extension' },
    { ...contentSender, frameId: 1 },
    { ...contentSender, frameId: undefined },
    { ...contentSender, tab: { id: '7' } },
    { ...contentSender, tab: undefined },
    { ...contentSender, url: 'https://www.youtube.com.evil.test/watch?v=En5cSXgGvZM' },
    { ...contentSender, url: 'http://www.youtube.com/watch?v=En5cSXgGvZM' },
    { ...contentSender, url: 'https://example.com/' },
    panelSender,
  ];
  for (const sender of invalidSenders) await assert.rejects(send(recorder(), sender));
  assert.deepEqual(api.storage.local.snapshot(), {});
  assert.deepEqual(api.storage.session.snapshot(), {});
  const response = await send(recorder(), contentSender);
  assert.deepEqual(Object.keys(response).sort(), ['ok', 'enabled', 'epoch', 'view'].sort());
  assert.equal(response.ok, true);
  assert.equal(response.enabled, true);
  assert.equal(response.epoch, 0);
  assert.equal(response.view.videoId, videoId);
  assert.deepEqual(response.view.ranges, [[10, 20]]);
  assert.equal(response.view.updatedAt, 42);
  assert.deepEqual(api.storage.local.snapshot()[STORE_KEY].videos[videoId].ranges, [[10, 20]]);
});

test('recorder acknowledgement exposes current persisted coverage without private goal or unrelated history', async () => {
  const { send, api } = fixture();
  const privateId = 'abcdefghijk';
  await send({ type: 'SET_GOAL', goal: 'Private learning goal' });
  await send(recorder({ videoId: privateId, title: 'Private unrelated video', ranges: [[30, 35]] }), { ...contentSender, tab: { id: 8 } });
  await send(recorder(), contentSender);
  const response = await send(recorder({ currentTime: 100, ranges: [] }), contentSender);
  assert.equal(response.view.videoId, videoId);
  assert.equal(response.view.currentTime, 100, 'live playhead is shown independently of persisted coverage');
  assert.deepEqual(response.view.ranges, [[10, 20]], 'a heartbeat cannot turn an earlier skipped range into watched history');
  assert.deepEqual(response.view.ranges, api.storage.local.snapshot()[STORE_KEY].videos[videoId].ranges);
  assert.equal(response.view.loading, false);
  assert.equal(response.view.error, '');
  assert.equal(Object.hasOwn(response, 'data'), false, 'content acknowledgement does not expose the full private store');
  assert.equal(Object.hasOwn(response.view, 'videos'), false);
  assert.equal(Object.hasOwn(response.view, 'goal'), false);
  assert.equal(JSON.stringify(response).includes(privateId), false);
  assert.equal(JSON.stringify(response).includes('Private'), false);
  const native = await send({ type: 'GET_STATE', tabId: 7 });
  assert.equal(native.data.goal, 'Private learning goal', 'the native extension panel keeps its private state API');
  assert.equal(native.data.videos[privateId].title, 'Private unrelated video');
});

test('panel commands are restricted to this extension and cannot be sent by webpage content', async () => {
  const { send } = fixture();
  for (const sender of [contentSender, { ...panelSender, id: 'another-extension' }, { ...panelSender, url: 'https://www.youtube.com/' }, { ...panelSender, url: `chrome-extension://${extensionId}.evil/panel.html` }]) {
    await assert.rejects(send({ type: 'SET_RECORDING', enabled: false }, sender));
    await assert.rejects(send({ type: 'GET_STATE', tabId: 7 }, sender));
  }
  assert.equal((await send({ type: 'GET_STATE', tabId: 7 })).data.recordingEnabled, true);
});

test('GET_STATE returns durable history and only the requested tab live session', async () => {
  const { send } = fixture();
  const initial = await send({ type: 'GET_STATE', tabId: 7 });
  assert.deepEqual(initial.data.videos, {});
  assert.equal(initial.live, null);
  await send(recorder(), contentSender);
  await send(recorder({ videoId: otherId, title: 'Other video', currentTime: 35, ranges: [[30, 35]] }), { ...contentSender, tab: { id: 8 } });
  const first = await send({ type: 'GET_STATE', tabId: 7 });
  assert.equal(first.live.videoId, videoId);
  assert.equal(first.live.currentTime, 20);
  assert.equal(first.live.updatedAt, 42);
  assert.equal(first.error, '');
  assert.equal((await send({ type: 'GET_STATE', tabId: 8 })).live.videoId, otherId);
  assert.equal((await send({ type: 'GET_STATE', tabId: 999 })).live, null);
  assert.equal((await send({ type: 'GET_STATE' })).live, null);
  assert.deepEqual(Object.keys(first.data.videos).sort(), [videoId, otherId].sort());
});

test('pausing recording persists the switch and blocks future ranges while retaining live position', async () => {
  const { send } = fixture();
  await send(recorder(), contentSender);
  assert.equal((await send({ type: 'SET_RECORDING', enabled: false })).data.recordingEnabled, false);
  const disabled = await send(recorder({ currentTime: 40, ranges: [[30, 40]], epoch: 1 }), contentSender);
  assert.equal(disabled.ok, true);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.epoch, 1);
  assert.equal(disabled.view.recordingEnabled, false);
  assert.equal(disabled.view.currentTime, 40);
  assert.deepEqual(disabled.view.ranges, [[10, 20]], 'disabled recording retains the previously saved in-page snapshot');
  const paused = await send({ type: 'GET_STATE', tabId: 7 });
  assert.deepEqual(paused.data.videos[videoId].ranges, [[10, 20]]);
  assert.equal(paused.live.currentTime, 40);
  await send({ type: 'SET_RECORDING', enabled: true });
  await send(recorder({ currentTime: 45, ranges: [[40, 45]], epoch: 2 }), contentSender);
  assert.deepEqual((await send({ type: 'GET_STATE', tabId: 7 })).data.videos[videoId].ranges, [[10, 20], [40, 45]]);
});

test('a quick recording off/on cycle rejects buffered intervals from the previous recording epoch', async () => {
  const { send } = fixture();
  await send(recorder(), contentSender);
  const disabled = await send({ type: 'SET_RECORDING', enabled: false });
  const enabled = await send({ type: 'SET_RECORDING', enabled: true });
  assert.equal(disabled.data.recordingEpoch, 1);
  assert.equal(enabled.data.recordingEpoch, 2);
  assert.equal((await send({ type: 'SET_RECORDING', enabled: true })).data.recordingEpoch, 2, 'repeating the current setting must not invalidate an active recorder');
  const stale = await send(recorder({ currentTime: 30, ranges: [[20, 30]], epoch: 0 }), contentSender);
  assert.equal(stale.ok, true);
  assert.equal(stale.enabled, true);
  assert.equal(stale.epoch, 2);
  assert.equal(stale.view.recordingEnabled, true);
  assert.equal(stale.view.currentTime, 30);
  assert.deepEqual(stale.view.ranges, [[10, 20]], 'stale-epoch ranges are never presented as saved');
  assert.deepEqual((await send({ type: 'GET_STATE', tabId: 7 })).data.videos[videoId].ranges, [[10, 20]]);
  await send(recorder({ currentTime: 35, ranges: [[30, 35]], epoch: 2 }), contentSender);
  assert.deepEqual((await send({ type: 'GET_STATE', tabId: 7 })).data.videos[videoId].ranges, [[10, 20], [30, 35]]);
});

test('worker restart reloads durable watch history and recording preference', async () => {
  const { send, api } = fixture();
  await send(recorder(), contentSender);
  await send({ type: 'SET_GOAL', goal: '  了解產品護城河  ' });
  await send({ type: 'SET_RECORDING', enabled: false });
  const restarted = installBackground(api);
  const state = await restarted.handle({ type: 'GET_STATE', tabId: 7 }, panelSender);
  assert.deepEqual(state.data.videos[videoId].ranges, [[10, 20]]);
  assert.equal(state.data.goal, '了解產品護城河');
  assert.equal(state.data.recordingEnabled, false);
  assert.equal(state.live.videoId, videoId);
});

test('save failure exposes an error, never claims unsaved ranges, and clears the error after recovery', async () => {
  const { send, api } = fixture();
  await send(recorder(), contentSender);
  api.storage.local.failNextSet();
  const failed = await send(recorder({ currentTime: 30, ranges: [[20, 30]] }), contentSender);
  assert.equal(failed.ok, false);
  assert.ok(failed.error);
  assert.equal(Object.hasOwn(failed, 'view'), false, 'a failed save cannot acknowledge an updated in-page view');
  const state = await send({ type: 'GET_STATE', tabId: 7 });
  assert.deepEqual(state.data.videos[videoId].ranges, [[10, 20]]);
  assert.equal(state.live.error, failed.error);
  assert.equal(state.error, failed.error);
  assert.equal(state.live.currentTime, 30, 'live playhead must not be confused with durable watched ranges');
  const recoveredResponse = await send(recorder({ currentTime: 35, ranges: [[30, 35]] }), contentSender);
  assert.equal(recoveredResponse.ok, true);
  assert.deepEqual(recoveredResponse.view.ranges, [[10, 20], [30, 35]]);
  assert.equal(recoveredResponse.view.error, '');
  const recovered = await send({ type: 'GET_STATE', tabId: 7 });
  assert.equal(recovered.error, '');
  assert.deepEqual(recovered.data.videos[videoId].ranges, [[10, 20], [30, 35]]);
});

test('invalid samples cannot save history; unavailable state can update live status without creating history', async () => {
  const { send } = fixture();
  await assert.rejects(send({ type: 'RECORDER_SAMPLE' }, contentSender));
  await assert.rejects(send(recorder({ videoId: '<script>' }), contentSender));
  await send(recorder({ videoId: null, title: '', duration: Infinity, currentTime: NaN, status: 'unavailable', ranges: [] }), contentSender);
  const state = await send({ type: 'GET_STATE', tabId: 7 });
  assert.deepEqual(state.data.videos, {});
  assert.equal(state.live.videoId, null);
  assert.equal(state.live.duration, 0);
  assert.equal(state.live.currentTime, 0);
  assert.equal(state.live.status, 'unavailable');
});

test('OPEN_VIDEO accepts only a valid ID and finite nonnegative time and creates a timestamped YouTube URL', async () => {
  const { send, openedTabs } = fixture();
  for (const change of [{ videoId: 'bad' }, { videoId: `${videoId}&evil=1` }, { time: -1 }, { time: NaN }, { time: Infinity }, { time: '20' }]) {
    await assert.rejects(send({ type: 'OPEN_VIDEO', videoId, time: 10, ...change }));
  }
  assert.deepEqual(openedTabs, []);
  assert.deepEqual(await send({ type: 'OPEN_VIDEO', videoId, time: 12.9 }), { ok: true });
  assert.deepEqual(openedTabs, [{ url: `https://www.youtube.com/watch?v=${videoId}&t=12s` }]);
});

test('invalid setting commands are rejected and runtime listeners return errors through asynchronous responses', async () => {
  const { send, api } = fixture();
  await assert.rejects(send({ type: 'SET_RECORDING', enabled: 'false' }));
  await assert.rejects(send({ type: 'SET_GOAL', goal: 'g'.repeat(201) }));
  await assert.rejects(send({ type: 'SET_GOAL', goal: null }));
  const listener = api.runtime.onMessage.listeners[0];
  const response = await new Promise((resolve) => {
    assert.equal(listener({ type: 'GET_STATE' }, { ...panelSender, id: 'wrong' }, resolve), true);
  });
  assert.equal(response.ok, false);
  assert.equal(typeof response.error, 'string');
});

test('tab removal drops ephemeral playhead state while keeping durable watch history', async () => {
  const { send, api } = fixture();
  await send(recorder(), contentSender);
  api.tabs.onRemoved.listeners[0](7);
  assert.equal(api.storage.session.snapshot()[`${LIVE_PREFIX}7`], undefined);
  const state = await send({ type: 'GET_STATE', tabId: 7 });
  assert.equal(state.live, null);
  assert.deepEqual(state.data.videos[videoId].ranges, [[10, 20]]);
});

const analysisResult = () => {
  const source = { unitId: 'cursor:2325:2340', videoId, start: 2325, end: 2340, url: `https://www.youtube.com/watch?v=${videoId}&t=2325s` };
  return { schemaVersion: 1, status: 'ready', reason: null, generatedAt: '2026-10-17T00:00:00.000Z',
    source: { method: 'gemini_youtube_video', model: 'test-model', indexVersion: 'test-index', verification: 'ai_derived_not_human_verified', chapters: ANALYSIS_CHAPTERS.map((item) => ({ ...item, status: 'ready' })) },
    memory: [{ id: 'memory:1', summary: 'Private test memory', conditions: [], source }], recommendation: { id: 'next:1', title: 'Test candidate',
      summary: 'Private test comparison', relation: 'new_example', adds: 'Test added value', reason: 'Test next reason', usefulness: 'unknown',
      candidateSource: { ...source, unitId: 'cursor:2350:2380', start: 2350, end: 2380, url: `https://www.youtube.com/watch?v=${videoId}&t=2350s` },
      comparedTo: [{ memoryId: 'memory:1', source }] }, limitations: ['Test fixture only'] };
};

test('analysis is native-panel only, permission gated and prepares only the supported ranges', async () => {
  const { send, api } = fixture();
  assert.equal((await send({ type: 'GET_STATE' })).apiEndpoint, DEFAULT_API_ENDPOINT);
  await assert.rejects(send({ type: 'PREPARE_ANALYSIS' }, contentSender));
  await assert.rejects(send({ type: 'SET_API_ENDPOINT', endpoint: 'https://api.example.com' }, contentSender));
  await send(recorder({ duration: 4000, ranges: [[0, 100], [2320, 2340]], currentTime: 2340 }), contentSender);
  await send(recorder({ videoId: 'abcdefghijk', duration: 4000, title: 'Private unrelated video', ranges: [[0, 100]] }), contentSender);
  const prepared = await send({ type: 'PREPARE_ANALYSIS' });
  assert.deepEqual(prepared.payload, { schemaVersion: 1, watched: [{ videoId, ranges: [[2325, 2340]] }] });
  assert.equal(typeof prepared.token, 'string');
  assert.equal(prepared.endpoint, DEFAULT_API_ENDPOINT);
  assert.equal(JSON.stringify(prepared).includes('Private'), false);
  const denied = fixture({ permissionGranted: false });
  await assert.rejects(denied.send({ type: 'PREPARE_ANALYSIS' }), /Allow access/);
  assert.equal(denied.api.storage.session.snapshot()[ANALYSIS_PREPARED_KEY], undefined);
  assert.equal(api.storage.local.snapshot()[ANALYSIS_RESULT_KEY], undefined, 'preparation itself never fabricates an AI result');
});

test('analysis persistence survives worker restarts, tracks stale watched basis, and never leaks into recorder acknowledgements', async () => {
  const { send, api } = fixture();
  await send(recorder({ duration: 4000, ranges: [[2325, 2340]], currentTime: 2340 }), contentSender);
  const prepared = await send({ type: 'PREPARE_ANALYSIS' });
  // Recording remains independent while the native panel awaits the API.
  await send(recorder({ duration: 4000, ranges: [[2340, 2345]], currentTime: 2345 }), contentSender);
  const saved = await send({ type: 'SAVE_ANALYSIS', token: prepared.token, result: analysisResult() });
  assert.equal(saved.analysis.stale, true);
  assert.equal(api.storage.session.snapshot()[ANALYSIS_PREPARED_KEY], undefined);
  const restarted = installBackground(api);
  const restored = await restarted.handle({ type: 'GET_STATE', tabId: 7 }, panelSender);
  assert.equal(restored.analysis.memory[0].summary, 'Private test memory');
  assert.equal(restored.analysis.stale, true);
  assert.deepEqual(restored.data.videos[videoId].ranges, [[2325, 2345]]);
  const content = await send(recorder({ duration: 4000, ranges: [], currentTime: 2345 }), contentSender);
  assert.equal(JSON.stringify(content).includes('Private test'), false);
  assert.equal(Object.hasOwn(content, 'analysis'), false);
});

test('forged analysis, absent or reused preparation tokens and changed endpoints cannot overwrite saved analysis', async () => {
  const { send, api } = fixture();
  await send(recorder({ duration: 4000, ranges: [[2325, 2340]] }), contentSender);
  await assert.rejects(send({ type: 'SAVE_ANALYSIS', token: 'fake', result: analysisResult() }));
  const prepared = await send({ type: 'PREPARE_ANALYSIS' });
  const forged = analysisResult(); forged.memory[0].source.end = 2341;
  await assert.rejects(send({ type: 'SAVE_ANALYSIS', token: prepared.token, result: forged }), /unplayed/);
  assert.equal(api.storage.local.snapshot()[ANALYSIS_RESULT_KEY], undefined);
  await send({ type: 'SAVE_ANALYSIS', token: prepared.token, result: analysisResult() });
  await assert.rejects(send({ type: 'SAVE_ANALYSIS', token: prepared.token, result: analysisResult() }));
  const changed = await send({ type: 'PREPARE_ANALYSIS' });
  await send({ type: 'SET_API_ENDPOINT', endpoint: 'https://other.example.com' });
  await assert.rejects(send({ type: 'SAVE_ANALYSIS', token: changed.token, result: analysisResult() }));
  assert.equal((await send({ type: 'GET_STATE' })).analysis, null, 'another service never inherits the old service result');
  await assert.rejects(send({ type: 'SET_API_ENDPOINT', endpoint: 'https://name:secret@api.example.com/path' }));
});

test('learning storage survives background restart independently of watched ranges and blocks cross-video content access', async () => {
  const { send, api } = fixture();
  await send(recorder(), contentSender);
  const value = { lessonToken: 'signed-lesson', formula: '=SUM(B2:B5)', slideIndex: 2, feedback: { passed: false }, profile: { interests: ['AI'], level: 'beginner', language: 'en' } };
  await send({ type: 'LEARNING_STATE_SET', videoId, value, expectedEndpoint: DEFAULT_API_ENDPOINT, expectedRevision: 0, writerId: 'test-window' }, contentSender);
  const restarted = installBackground(api);
  assert.deepEqual((await restarted.handle({ type: 'LEARNING_STATE_GET', videoId, expectedEndpoint: DEFAULT_API_ENDPOINT }, contentSender)).value, value);
  const watched = await restarted.handle({ type: 'GET_STATE', tabId: 7 }, panelSender);
  assert.deepEqual(watched.data.videos[videoId].ranges, [[10, 20]]);
  assert.equal(Object.hasOwn(watched.data, 'lessonToken'), false);
  await assert.rejects(restarted.handle({ type: 'LEARNING_STATE_GET', videoId: otherId }, contentSender));
  await assert.rejects(restarted.handle({ type: 'LEARNING_STATE_SET', videoId, value }, { ...contentSender, frameId: 1 }));
  const acknowledgement = await send(recorder({ currentTime: 21, ranges: [[20, 21]] }), contentSender);
  assert.equal(JSON.stringify(acknowledgement).includes('signed-lesson'), false);
});

test('recorder heartbeat publishes only current service revision and invalidates old-service learning writes', async () => {
  const { send } = fixture();
  const value = { lessonToken: 'private-signed', lesson: { title: 'Old service lesson' }, feedback: { passed: true } };
  await send({ type: 'LEARNING_STATE_SET', videoId, value, expectedEndpoint: DEFAULT_API_ENDPOINT, expectedRevision: 0, writerId: 'native-view' });
  const first = await send(recorder(), contentSender);
  assert.equal(first.view.learningEndpoint, DEFAULT_API_ENDPOINT);
  assert.equal(first.view.learningRevision, 1);
  assert.equal(first.view.learningWriterId, 'native-view');
  assert.equal(JSON.stringify(first).includes('private-signed'), false);
  await send({ type: 'SET_API_ENDPOINT', endpoint: 'https://new.example.com' });
  const changed = await send(recorder({ currentTime: 21, ranges: [[20, 21]] }), contentSender);
  assert.equal(changed.view.learningEndpoint, 'https://new.example.com');
  assert.equal(changed.view.learningRevision, 0);
  assert.equal(changed.view.learningWriterId, '');
  await assert.rejects(send({ type: 'LEARNING_STATE_SET', videoId, value, expectedEndpoint: DEFAULT_API_ENDPOINT, expectedRevision: 1, writerId: 'native-view' }));
  assert.equal((await send({ type: 'LEARNING_STATE_GET', videoId, expectedEndpoint: 'https://new.example.com' }, contentSender)).value, null);
});
