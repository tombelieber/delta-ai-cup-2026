import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningHandler, LEARNING_STORE_PREFIX, normalizeLearningPayload, interestSuggestions } from './learning-protocol.js';
import { HISTORY_IMPORT_KEY } from './history-import.js';
import { createExtensionLearningAdapter } from './learning-client.js';
import { SKILLS_STORE_KEY, emptySkills, setFamiliarity } from '../src/learning/skill-records.mjs';

const videoId = 'En5cSXgGvZM', otherId = 'bxBzsSsqQAM';
const endpoint = 'https://delta-assistant-613646062582.us-central1.run.app';
const panel = { id: 'this', url: 'chrome-extension://this/panel.html' };
const content = { id: 'this', url: `https://www.youtube.com/watch?v=${videoId}`, frameId: 0, tab: { id: 7 } };
const payload = () => ({ source: { videoUrl: `https://www.youtube.com/watch?v=${videoId}`, title: 'SUMIF example', start: 10, end: 190 }, profile: { interests: ['AI 產品與創業'], level: 'beginner', language: 'zh-HK' } });
function fixture({ granted = true, fetchImpl = null } = {}) {
  const saved = {}, requests = [];
  let activeEndpoint = endpoint;
  const api = { storage: { local: { async get(key) { return { [key]: structuredClone(saved[key]) }; }, async set(value) { Object.assign(saved, structuredClone(value)); } } }, permissions: { async contains(value) { assert.deepEqual(value, { origins: [`${endpoint}/*`] }); return granted; } } };
  const handler = createLearningHandler({ api, repository: { async read() { return { goal: 'private', videos: { [videoId]: { title: 'AI product startup', ranges: [[10, 20]] }, [otherId]: { title: 'Private cat story', ranges: [[2, 6]] }, ignored: { title: 'Gaming unplayed', ranges: [] } } }; } },
    readEndpoint: async () => activeEndpoint,
    panelSender: (sender) => sender.id === 'this' && sender.url === panel.url,
    contentSender: (sender) => sender.id === 'this' && sender.frameId === 0 && Number.isInteger(sender.tab?.id) && /^https:\/\/www.youtube.com\/watch\?/.test(sender.url),
    fetchImpl: async (url, options) => { requests.push({ url, options }); return fetchImpl ? fetchImpl(url, options) : new Response(JSON.stringify({ lessonToken: 'signed-token', lesson: { title: 'Lesson' } }), { status: 200 }); },
  });
  return { saved, requests, handler, changeEndpoint(value) { activeEndpoint = value; }, send(message, sender = content) { return handler({ expectedEndpoint: endpoint, expectedRevision: 0, writerId: 'test-window', ...message, videoId: message.videoId ?? videoId }, sender); } };
}
test('learning messages reject foreign extension, subframe, non-YouTube and cross-video requests', async () => {
  const { send, requests, saved } = fixture();
  for (const sender of [{ ...content, id: 'other' }, { ...content, frameId: 1 }, { ...content, url: 'https://example.com/' }, { ...panel, url: 'chrome-extension://this.evil/panel.html' }]) {
    await assert.rejects(send({ type: 'LEARNING_REQUEST', action: 'generate', payload: payload() }, sender));
    await assert.rejects(send({ type: 'LEARNING_STATE_GET' }, sender));
    await assert.rejects(send({ type: 'LEARNING_INTERESTS' }, sender));
  }
  await assert.rejects(send({ type: 'LEARNING_STATE_GET', videoId: otherId }));
  await assert.rejects(send({ type: 'LEARNING_REQUEST', action: 'generate', payload: { ...payload(), source: { ...payload().source, videoUrl: `https://www.youtube.com/watch?v=${otherId}` } } }));
  assert.deepEqual(requests, []); assert.deepEqual(saved, {});
});
test('only bounded whitelisted learning payload reaches exact granted configured origin', async () => {
  const { send, requests } = fixture();
  await send({ type: 'LEARNING_REQUEST', action: 'generate', url: 'https://evil.test', payload: { ...payload(), rawHistory: 'do not forward' } });
  assert.equal(requests[0].url, `${endpoint}/api/learning/generate`);
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.deepEqual(JSON.parse(requests[0].options.body), payload());
  for (const change of [{ action: '../admin' }, { action: 'generate', payload: { ...payload(), source: { ...payload().source, end: 400 } } }, { action: 'validate', payload: { lessonToken: 'signed', formula: 'x'.repeat(1001) } }]) await assert.rejects(send({ type: 'LEARNING_REQUEST', action: 'generate', payload: payload(), ...change }));
  const denied = fixture({ granted: false });
  await assert.rejects(denied.send({ type: 'LEARNING_REQUEST', action: 'generate', payload: payload() }), /native sidebar/);
  assert.equal(denied.requests.length, 0);
});
test('learning state survives worker adapter recreation without touching watch history and is endpoint/video scoped', async () => {
  const { send, saved, changeEndpoint } = fixture();
  const value = { lessonToken: 'signed', source: { ...payload().source, start: '10', end: '190' }, draft: '=SUM(B2:B5)', profile: { interests: ['AI'], level: 'beginner' }, slide: 2, understood: false, passed: false };
  await send({ type: 'LEARNING_STATE_SET', value });
  assert.deepEqual(Object.keys(saved), [`${LEARNING_STORE_PREFIX}${videoId}`]);
  assert.deepEqual((await send({ type: 'LEARNING_STATE_GET' })).value, value);
  assert.equal((await send({ type: 'LEARNING_STATE_GET', videoId: otherId }, panel)).value, null);
  changeEndpoint('https://other.example.com');
  await assert.rejects(send({ type: 'LEARNING_STATE_GET' }), /settings changed/);
  assert.equal((await send({ type: 'LEARNING_STATE_GET', expectedEndpoint: 'https://other.example.com' })).value, null);
  await assert.rejects(send({ type: 'LEARNING_STATE_SET', value }), /settings changed/);
  await assert.rejects(send({ type: 'LEARNING_STATE_SET', value: { huge: 'x'.repeat(250001) } }));
  await assert.rejects(send({ type: 'LEARNING_STATE_SET', value: { profile: { interests: ['a', 'b', 'c', 'd', 'e', 'f'] } } }));
  await assert.rejects(send({ type: 'LEARNING_STATE_SET', value: { source: { ...payload().source, end: 400 } } }));
  assert.equal(saved[`${LEARNING_STORE_PREFIX}${videoId}`].value.draft, value.draft);
});
test('concurrent native and in-page snapshots cannot erase a newer lesson, and external revision recovers it', async () => {
  const f = fixture();
  const runtime = { async sendMessage(message) { return f.handler(message, content); } };
  const native = createExtensionLearningAdapter({ runtime, videoId, endpoint });
  const inPage = createExtensionLearningAdapter({ runtime, videoId, endpoint });
  await native.storage.get(); await inPage.storage.get();
  const notices = [];
  const unsubscribe = inPage.storage.subscribe((notice) => notices.push(notice));
  const lesson = { lessonToken: 'signed', lesson: { title: 'New lesson A' }, formula: '', profile: { interests: ['AI'], level: 'beginner', language: 'en' } };
  const staleEmpty = { lesson: null, lessonToken: '', formula: '', profile: { interests: ['Cats'], level: 'beginner', language: 'en' } };
  const results = await Promise.allSettled([native.storage.set('ignored', lesson), inPage.storage.set('ignored', staleEmpty)]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.equal(f.saved[`${LEARNING_STORE_PREFIX}${videoId}`].value.lesson.title, 'New lesson A');
  assert.equal(notices[0].reason, 'conflict');
  assert.deepEqual(await inPage.storage.get(), lesson);
  const recovered = { ...lesson, formula: '=SUM(B2:B5)' };
  await inPage.storage.set('ignored', recovered);
  assert.equal(f.saved[`${LEARNING_STORE_PREFIX}${videoId}`].value.formula, '=SUM(B2:B5)');
  unsubscribe();
});
test('own writes never reload the editor; external revisions hydrate once and stale origin writes stay rejected', async () => {
  const f = fixture();
  const runtime = { async sendMessage(message) { return f.handler(message, content); } };
  const a = createExtensionLearningAdapter({ runtime, videoId, endpoint });
  const b = createExtensionLearningAdapter({ runtime, videoId, endpoint });
  await a.storage.get(); await b.storage.get();
  const ownNotices = [], externalNotices = [];
  a.storage.subscribe((notice) => ownNotices.push(notice)); b.storage.subscribe((notice) => externalNotices.push(notice));
  await a.storage.set('ignored', { lesson: { title: 'PPT A' }, formula: 'draft', feedback: { passed: true } });
  await a.storage.set('ignored', { lesson: { title: 'PPT A' }, formula: 'draft', feedback: { passed: true } });
  const saved = f.saved[`${LEARNING_STORE_PREFIX}${videoId}`];
  assert.equal(saved.revision, 1, 'identical hydration snapshots cannot create a notification loop');
  const context = { videoId, learningEndpoint: endpoint, learningRevision: saved.revision, learningWriterId: saved.writerId };
  a.observeContext(context); b.observeContext(context); b.observeContext(context);
  assert.equal(ownNotices.length, 0); assert.equal(externalNotices.length, 1);
  assert.equal((await b.storage.get()).lesson.title, 'PPT A');
  f.changeEndpoint('https://new.example.com');
  await assert.rejects(a.storage.set('ignored', { lesson: { title: 'Old service overwrite' }, feedback: { passed: true } }), /settings changed/);
  assert.equal(f.saved[`${LEARNING_STORE_PREFIX}${videoId}`].endpoint, endpoint);
  const fresh = await f.send({ type: 'LEARNING_STATE_GET', expectedEndpoint: 'https://new.example.com' });
  assert.equal(fresh.value, null); assert.equal(fresh.revision, 0);
});
test('an in-flight old-service lesson response is discarded after the configured origin changes', async () => {
  let release, started;
  const waiting = new Promise((resolve) => { started = resolve; });
  const f = fixture({ fetchImpl: async () => { started(); await new Promise((resolve) => { release = resolve; }); return new Response(JSON.stringify({ lesson: { title: 'Late old lesson' }, lessonToken: 'late' }), { status: 200 }); } });
  const request = f.send({ type: 'LEARNING_REQUEST', action: 'generate', payload: payload() });
  await waiting;
  f.changeEndpoint('https://new.example.com'); release();
  await assert.rejects(request, /previous service result/);
  assert.deepEqual(f.saved, {});
});
test('explicit interest suggestion returns only local labels/counts, no raw private history or upload', async () => {
  const { send, requests } = fixture();
  const response = await send({ type: 'LEARNING_INTERESTS' });
  assert.equal(response.result.source, 'delta-observed');
  assert.deepEqual(response.result.suggestions, [{ label: 'Technology', count: 1 }, { label: 'Cats', count: 1 }]);
  assert.equal(JSON.stringify(response).includes('Private cat story'), false);
  assert.equal(JSON.stringify(response).includes(otherId), false);
  assert.equal(JSON.stringify(response).includes('private'), false);
  assert.equal(requests.length, 0);
});
test('native adapter permission request runs only on explicit generation; in-page adapter never requests it', async () => {
  const messages = [], grants = [];
  const runtime = { async sendMessage(message) { messages.push(message); return { ok: true, result: { lesson: { title: 'Lesson' }, lessonToken: 'signed' }, value: { draft: 'saved' } }; } };
  const adapter = createExtensionLearningAdapter({ runtime, videoId, endpoint, permissions: { async request(value) { grants.push(value); return true; } } });
  assert.equal(grants.length, 0);
  assert.deepEqual(await adapter.storage.get('ignored'), { draft: 'saved' });
  await adapter.client.generate(payload());
  assert.deepEqual(grants, [{ origins: [`${endpoint}/*`] }]);
  await adapter.client.validate({ lessonToken: 'signed', formula: '1200' });
  assert.equal(grants.length, 1);
  const page = createExtensionLearningAdapter({ runtime, videoId, endpoint });
  await page.client.generate(payload());
  assert.equal(grants.length, 1);
  assert.equal(messages.at(-1).type, 'LEARNING_REQUEST');
});
test('payload strips noncanonical URL parameters and rejects arbitrary URLs and oversized tokens', () => {
  assert.equal(normalizeLearningPayload('generate', { ...payload(), source: { ...payload().source, videoUrl: `https://www.youtube.com/watch?v=${videoId}&list=private` } }).source.videoUrl, `https://www.youtube.com/watch?v=${videoId}`);
  assert.throws(() => normalizeLearningPayload('generate', { ...payload(), source: { ...payload().source, videoUrl: `https://youtube.com.evil.test/watch?v=${videoId}` } }));
  assert.throws(() => normalizeLearningPayload('validate', { lessonToken: 'x'.repeat(100001), formula: '=SUM(B2:B5)' }));
  assert.throws(() => normalizeLearningPayload('generate', { ...payload(), profile: { ...payload().profile, interests: ['a', 'b', 'c', 'd', 'e', 'f'] } }));
  assert.throws(() => normalizeLearningPayload('generate', { ...payload(), source: { ...payload().source, start: 86300, end: 86401 } }));
});


test('practice requests forward only bounded optional task IDs for validation and hints', async () => {
  const { send, requests } = fixture();
  for (const action of ['validate', 'reteach']) {
    const request = { lessonToken: 'signed', formula: '=SUMIF(A2:A5,D2,B2:B5)', taskId: 'sumif-practice-taipei-v1' };
    await send({ type: 'LEARNING_REQUEST', action, payload: { ...request, task: { answer: 7 }, rows: [], expectedTotal: 7, passed: true } });
    assert.deepEqual(JSON.parse(requests.at(-1).options.body), request);
    const legacy = { lessonToken: 'signed', formula: '' };
    assert.deepEqual(normalizeLearningPayload(action, legacy), legacy);
    for (const taskId of ['', 'x'.repeat(101), null, {}, 1, 'bad\u0000task']) {
      assert.throws(() => normalizeLearningPayload(action, { ...legacy, taskId }));
    }
  }
  assert.deepEqual(normalizeLearningPayload('pptx', { lessonToken: 'signed', taskId: 'ignored' }), { lessonToken: 'signed' });
});

test('global skill familiarity survives videos, worker adapters and endpoint changes independently of lesson/watch records', async () => {
  const f = fixture();
  assert.equal((await f.send({ type: 'LEARNING_SKILLS_GET' })).value, null);
  const record = setFamiliarity(emptySkills(), 'excel-column-total', true, '2026-10-17T09:00:00.000Z');
  await f.send({ type: 'LEARNING_SKILLS_SET', value: record });
  assert.deepEqual(Object.keys(f.saved), [SKILLS_STORE_KEY]);
  assert.deepEqual((await f.send({ type: 'LEARNING_SKILLS_GET', videoId: otherId }, panel)).value, record);
  f.changeEndpoint('https://new.example.com');
  assert.deepEqual((await f.send({ type: 'LEARNING_SKILLS_GET', expectedEndpoint: 'https://new.example.com' })).value, record);
  await assert.rejects(f.send({ type: 'LEARNING_SKILLS_SET', value: emptySkills(), expectedRevision: 1 }), /settings changed/);
  const response = await f.send({ type: 'LEARNING_SKILLS_SET', value: emptySkills(), expectedRevision: 1, expectedEndpoint: 'https://new.example.com' });
  assert.equal(response.revision, 2);
  assert.deepEqual((await f.send({ type: 'LEARNING_SKILLS_GET', expectedEndpoint: 'https://new.example.com' })).value, emptySkills(), 'an explicit clear stays present so legacy feedback is not reimported');
  assert.equal(f.requests.length, 0, 'local skills never invoke fetch or ask for provider permission');
});

test('global skill CAS prevents stale views erasing familiarity and notifies independently of lesson hydration', async () => {
  const f = fixture();
  const runtime = { async sendMessage(message) { return f.handler(message, panel); } };
  const a = createExtensionLearningAdapter({ runtime, videoId, endpoint });
  const b = createExtensionLearningAdapter({ runtime, videoId: otherId, endpoint });
  assert.equal(a.client.evidenceOrigin, endpoint);
  assert.equal(await a.storage.skills.get(SKILLS_STORE_KEY), null);
  assert.equal(await b.storage.skills.get(SKILLS_STORE_KEY), null);
  const notices = [], lessonNotices = [];
  const unsubscribe = b.storage.skills.subscribe(notice => notices.push(notice));
  b.storage.subscribe(notice => lessonNotices.push(notice));
  const record = setFamiliarity(emptySkills(), 'excel-column-total', true, '2026-10-17T09:00:00.000Z');
  const results = await Promise.allSettled([a.storage.skills.set(SKILLS_STORE_KEY, record), b.storage.skills.set(SKILLS_STORE_KEY, emptySkills())]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.equal(notices.length, 1); assert.equal(notices[0].reason, 'conflict');
  assert.deepEqual(lessonNotices, [], 'skill conflicts cannot reload lesson/formula drafts');
  assert.deepEqual(await b.storage.skills.get(SKILLS_STORE_KEY), record);
  await a.storage.skills.set(SKILLS_STORE_KEY, { ...record, activity: { } });
  assert.equal(f.saved[SKILLS_STORE_KEY].revision, 1, 'identical snapshots do not publish revisions');
  const next = setFamiliarity(record, 'sumif-text-equality', true, '2026-10-17T09:01:00.000Z');
  await a.storage.skills.set(SKILLS_STORE_KEY, next);
  const saved = f.saved[SKILLS_STORE_KEY];
  const context = { skillsRevision: saved.revision, skillsWriterId: saved.writerId };
  a.observeContext(context); b.observeContext(context); b.observeContext(context);
  assert.equal(notices.length, 2); assert.equal(notices[1].reason, 'external');
  assert.deepEqual(await b.storage.skills.get(SKILLS_STORE_KEY), next);
  unsubscribe();
});

test('global skills reject unauthorized, malformed, oversized and unhydrated writes; read failure never overwrites progress', async () => {
  const f = fixture();
  for (const sender of [{ ...content, id: 'other' }, { ...content, frameId: 1 }, { ...content, url: 'https://example.com/' }])
    for (const type of ['LEARNING_SKILLS_GET', 'LEARNING_SKILLS_SET']) await assert.rejects(f.send({ type, value: emptySkills() }, sender));
  for (const value of [null, [], { schemaVersion: 99 }, { ...emptySkills(), huge: 'x'.repeat(50_001) }])
    await assert.rejects(f.send({ type: 'LEARNING_SKILLS_SET', value }));
  await assert.rejects(f.send({ type: 'LEARNING_SKILLS_SET', value: emptySkills(), expectedRevision: -1 }));
  const messages = [];
  const adapter = createExtensionLearningAdapter({ videoId, endpoint, runtime: { async sendMessage(message) { messages.push(message); throw Error('storage unavailable'); } } });
  await assert.rejects(adapter.storage.skills.get(SKILLS_STORE_KEY), /storage unavailable/);
  await assert.rejects(adapter.storage.skills.set(SKILLS_STORE_KEY, emptySkills()), /have not finished loading/);
  assert.equal(messages.length, 1); assert.deepEqual(f.saved, {});
  let failRead = false;
  const previouslyHydrated = createExtensionLearningAdapter({ videoId, endpoint, runtime: { async sendMessage() {
    if (failRead) throw Error('storage unavailable');
    return { ok: true, revision: 1, value: emptySkills() };
  } } });
  await previouslyHydrated.storage.skills.get(SKILLS_STORE_KEY); failRead = true;
  await assert.rejects(previouslyHydrated.storage.skills.get(SKILLS_STORE_KEY), /storage unavailable/);
  await assert.rejects(previouslyHydrated.storage.skills.set(SKILLS_STORE_KEY, emptySkills()), /have not finished loading/, 'a later read failure revokes write readiness too');
});


test('explicit interest suggestions combine imported title hints locally, dedupe videos and never return visit metadata', async () => {
  const f = fixture(), now = Date.now() - 1000;
  const visit = (id, title) => ({ videoId: id, url: `https://www.youtube.com/watch?v=${id}`, title, lastVisitTime: now, importedAt: now });
  const excelId = 'DKrBGOFs0GY';
  f.saved[HISTORY_IMPORT_KEY] = { schemaVersion: 1, updatedAt: now, visits: [visit(videoId, 'Private Excel duplicate'), visit(excelId, 'Private Excel lesson'), visit(excelId, 'Private Excel duplicate'), { ...visit('abcdefghijk', 'Excel forged'), url: 'https://evil.example/' }] };
  const before = structuredClone(f.saved);
  const response = await f.send({ type: 'LEARNING_INTERESTS' });
  assert.equal(response.result.source, 'delta-observed-and-imported');
  assert.deepEqual(response.result.suggestions, [{ label: 'Technology', count: 1 }, { label: 'Cats', count: 1 }, { label: 'Spreadsheets', count: 1 }]);
  assert.match(response.result.message, /Imported visits do not prove playback or skills/);
  assert.doesNotMatch(JSON.stringify(response), /Private|https:|lastVisitTime|importedAt|DKrBGOFs0GY/);
  assert.deepEqual(f.saved, before);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(interestSuggestions({}, [{ videoId: excelId, title: 'Excel' }, { videoId: excelId, title: 'Excel' }, { videoId: 'invalid', title: 'Excel' }]).suggestions, [{ label: 'Spreadsheets', count: 1 }]);
  assert.equal(interestSuggestions({}, [{ videoId: excelId, title: 'Excel' }]).source, 'imported-visits');
  assert.match(interestSuggestions({}).message, /without filling in interests/);
});

test('adapter reports English disconnect fallback and preserves actionable storage conflict errors', async () => {
  const disconnected = createExtensionLearningAdapter({ videoId, endpoint, runtime: { async sendMessage() {} } });
  await assert.rejects(disconnected.client.interests(), /Delta disconnected. Reload the extension/);
  const conflict = createExtensionLearningAdapter({ videoId, endpoint, runtime: { async sendMessage() { return { ok: false, conflict: true, revision: 2, error: 'Another Delta view updated this lesson. Reloading the latest progress.' }; } } });
  const notices = [];
  conflict.storage.subscribe((notice) => notices.push(notice));
  await assert.rejects(conflict.storage.get(), /Another Delta view updated/);
  assert.deepEqual(notices, [{ reason: 'conflict', revision: 2 }]);
});
