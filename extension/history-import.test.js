import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryImportHandler, HISTORY_IMPORT_KEY, HISTORY_PREVIEW_KEY } from './history-import.js';
import { STORE_KEY } from './store.js';
import { SKILLS_STORE_KEY } from '../src/learning/skill-records.mjs';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const panel = { id: extensionId, url: `chrome-extension://${extensionId}/panel.html`, documentId: 'panel-document' };
const content = { id: extensionId, url: 'https://www.youtube.com/watch?v=dI8w0utjUc0', tab: { id: 3 }, frameId: 0 };
const time = Date.UTC(2026, 9, 17, 9);
const day = 86_400_000;
const videoId = 'dI8w0utjUc0', otherId = 'En5cSXgGvZM';
const generatedId = (number) => `video${String(number).padStart(6, '0')}`;
const row = (id = videoId, overrides = {}) => ({ url: `https://www.youtube.com/watch?v=${id}`, title: 'An Excel lesson', lastVisitTime: time - day, ...overrides });

function storageArea() {
  const values = {};
  let nextSetError = false;
  return {
    async get(key) { return structuredClone({ [key]: values[key] }); },
    async set(update) {
      if (nextSetError) { nextSetError = false; throw Error('private storage error'); }
      Object.assign(values, structuredClone(update));
    },
    async remove(key) { delete values[key]; },
    failNextSet() { nextSetError = true; },
    snapshot() { return structuredClone(values); },
  };
}

function fixture({ permission = true, rows = [row()], admitImports = async input => ({...input,added:0,imports:{limit:10,used:0,remaining:10}}) } = {}) {
  const queries = [], permissionChecks = [], removedPermissions = [];
  let clock = time, access = permission, searchImpl = async ({ text }) => text === 'youtube.com' ? structuredClone(rows) : [];
  const api = {
    runtime: { id: extensionId, getURL: (path) => `chrome-extension://${extensionId}/${path}` },
    storage: { local: storageArea(), session: storageArea() },
    permissions: {
      async contains(request) { permissionChecks.push(request); assert.deepEqual(request, { permissions: ['history'] }); return access; },
      async remove(request) { removedPermissions.push(request); assert.deepEqual(request, { permissions: ['history'] }); access = false; return true; },
      request() { assert.fail('The backend must never request a permission.'); },
    },
    history: {
      async search(query) { queries.push(query); return searchImpl(query); },
      deleteAll() { assert.fail('Chrome history must never be modified.'); },
      deleteUrl() { assert.fail('Chrome history must never be modified.'); },
      onVisited: { addListener() { assert.fail('No ongoing history scan may be installed.'); } },
    },
  };
  const makeHandler = () => createHistoryImportHandler({ api, admitImports, panelSender: (sender) => sender.url === panel.url, now: () => clock });
  let handle = makeHandler();
  return { api, queries, permissionChecks, removedPermissions, send: (message, sender = panel) => handle(message, sender),
    advance: (ms) => { clock += ms; }, revoke: () => { access = false; }, restart: () => { handle = makeHandler(); },
    setSearch: (fn) => { searchImpl = fn; } };
}

test('history access stays optional: no search without a grant and no request from the backend', async () => {
  const f = fixture({ permission: false });
  assert.deepEqual(await f.send({ type: 'HISTORY_STATUS' }), { ok: true, granted: false, visits: [], updatedAt: null });
  await assert.rejects(f.send({ type: 'HISTORY_PREVIEW', days: 30 }), /access is off/);
  assert.equal(f.queries.length, 0);
  assert.deepEqual(f.api.storage.local.snapshot(), {});
  assert.deepEqual(f.api.storage.session.snapshot(), {});
  await f.send({ type: 'HISTORY_CLEAR' });
  await f.send({ type: 'HISTORY_CANCEL' });
  assert.equal(f.queries.length, 0);
});

test('every history action rejects content scripts and other extension origins before reading data', async () => {
  const f = fixture();
  for (const type of ['HISTORY_STATUS', 'HISTORY_PREVIEW', 'HISTORY_IMPORT', 'HISTORY_CLEAR', 'HISTORY_DISCONNECT', 'HISTORY_CANCEL']) {
    for (const sender of [content, { ...panel, id: 'other' }, { ...panel, url: `${panel.url}.evil` },
      { ...panel, url: 'chrome-extension://another/panel.html' }, { ...panel, url: `https://${extensionId}/panel.html` }, null]) {
      await assert.rejects(f.send({ type, days: 30 }, sender), /only in the Delta extension panel/);
    }
  }
  assert.equal(f.queries.length, 0);
  assert.equal(f.permissionChecks.length, 0);
  assert.deepEqual(f.api.storage.local.snapshot(), {});
});

test('preview queries only bounded YouTube text searches and canonicalizes valid video visits', async () => {
  const f = fixture({ rows: [
    row(videoId, { title: 'old', lastVisitTime: time - 3 * day }),
    row(videoId, { url: `https://m.youtube.com/watch?v=${videoId}&list=private&t=38`, title: 'New\u0000 title'.repeat(40) }),
    row(otherId, { url: `https://youtu.be/${otherId}?si=secret`, title: '' }),
    row(generatedId(1), { url: `https://www.youtube.com/shorts/${generatedId(1)}` }),
    row(generatedId(2), { url: `http://music.youtube.com/live/${generatedId(2)}` }),
    ...[
      `https://www.youtube.com.evil.test/watch?v=${generatedId(3)}`,
      `https://evil.test/?next=https://www.youtube.com/watch?v=${generatedId(4)}`,
      `https://www.youtube.com@evil.test/watch?v=${generatedId(5)}`,
      `https://user:secret@www.youtube.com/watch?v=${generatedId(6)}`,
      `https://www.youtube.com:8443/watch?v=${generatedId(7)}`,
      `https://www.youtube.com/watch?v=${generatedId(8)}&v=${generatedId(9)}`,
      'https://www.youtube.com/results?search_query=private',
      'https://www.youtube.com/@private-channel',
      'javascript:alert(1)',
    ].map((url) => row(generatedId(10), { url })),
    row(generatedId(11), { lastVisitTime: time + 1 }),
    row(generatedId(12), { lastVisitTime: time - 31 * day }),
    row(generatedId(13), { lastVisitTime: NaN }),
  ] });
  const result = await f.send({ type: 'HISTORY_PREVIEW', days: 30 });
  assert.equal(result.ok, true);
  assert.equal(result.days, 30);
  assert.equal(result.truncated, false);
  assert.equal(result.visits.length, 4);
  assert.equal(result.visits.find((visit) => visit.videoId === videoId).title.length, 300);
  assert.equal(result.visits.some((visit) => /\u0000|secret|private/.test(JSON.stringify(visit))), false);
  for (const visit of result.visits) assert.equal(visit.url, `https://www.youtube.com/watch?v=${visit.videoId}`);
  assert.match(result.token, /^[a-f0-9-]{36}$/);
  assert.deepEqual(f.queries.map((query) => query.text), ['youtube.com', 'youtu.be']);
  for (const query of f.queries) assert.deepEqual(query, { text: query.text, startTime: time - 30 * day, endTime: time, maxResults: 1000 });
  assert.deepEqual(f.api.storage.local.snapshot(), {}, 'an unselected preview must never become a saved record');
  assert.equal(f.api.storage.session.snapshot()[HISTORY_PREVIEW_KEY].token, result.token);
  assert.equal(f.api.storage.session.snapshot()[HISTORY_PREVIEW_KEY].expiresAt, time + 600_000);
});

test('preview caps at 200, marks bounded search truncation, and rejects unsupported ranges', async () => {
  const f = fixture({ rows: Array.from({ length: 1000 }, (_, index) => row(generatedId(index))) });
  for (const days of [0, 1, 365, '30', undefined]) await assert.rejects(f.send({ type: 'HISTORY_PREVIEW', days }), /7, 30 or 90/);
  assert.equal(f.queries.length, 0);
  const result = await f.send({ type: 'HISTORY_PREVIEW', days: 90 });
  assert.equal(result.visits.length, 200);
  assert.equal(result.truncated, true);
  assert.equal(f.api.storage.session.snapshot()[HISTORY_PREVIEW_KEY].visits.length, 200);
});

test('import commits only selected current preview rows, is idempotent, and survives worker restart', async () => {
  const f = fixture({ rows: [row(), row(otherId)] });
  await f.api.storage.local.set({ [STORE_KEY]: { private: 'observed playback' }, [SKILLS_STORE_KEY]: { private: 'checked skill' } });
  const preview = await f.send({ type: 'HISTORY_PREVIEW', days: 7 });
  await assert.rejects(f.send({ type: 'HISTORY_IMPORT', token: preview.token, videoIds: [videoId, generatedId(1)] }), /does not match/);
  await assert.rejects(f.send({ type: 'HISTORY_IMPORT', token: preview.token, videoIds: [] }), /Choose valid videos/);
  assert.equal(f.api.storage.local.snapshot()[HISTORY_IMPORT_KEY], undefined);
  f.restart();
  const result = await f.send({ type: 'HISTORY_IMPORT', token: preview.token, videoIds: [videoId] });
  assert.deepEqual(result.visits, [{ videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title: 'An Excel lesson', lastVisitTime: time - day, importedAt: time }]);
  const committed = f.api.storage.local.snapshot();
  f.advance(1000);
  assert.deepEqual(await f.send({ type: 'HISTORY_IMPORT', token: preview.token, videoIds: [videoId, videoId] }), result);
  f.restart();
  assert.deepEqual(await f.send({ type: 'HISTORY_STATUS' }), result);
  assert.deepEqual(f.api.storage.local.snapshot(), committed);
  assert.deepEqual(committed[STORE_KEY], { private: 'observed playback' });
  assert.deepEqual(committed[SKILLS_STORE_KEY], { private: 'checked skill' });
});

test('expired, replaced, foreign-panel and malformed preview tokens cannot be committed', async () => {
  for (const kind of ['expired', 'replaced', 'foreign-panel', 'malformed']) {
    const f = fixture();
    const preview = await f.send({ type: 'HISTORY_PREVIEW', days: 30 });
    if (kind === 'expired') f.advance(600_000);
    if (kind === 'replaced') await f.send({ type: 'HISTORY_PREVIEW', days: 7 });
    if (kind === 'malformed') {
      const saved = f.api.storage.session.snapshot()[HISTORY_PREVIEW_KEY];
      await f.api.storage.session.set({ [HISTORY_PREVIEW_KEY]: { ...saved, expiresAt: time + 99_000_000 } });
    }
    await assert.rejects(f.send({ type: 'HISTORY_IMPORT', token: preview.token, videoIds: [videoId] },
      kind === 'foreign-panel' ? { ...panel, documentId: 'another-panel' } : panel), /expired or changed/);
    assert.deepEqual(f.api.storage.local.snapshot(), {});
    assert.equal(f.api.storage.session.snapshot()[HISTORY_PREVIEW_KEY], undefined);
  }
});

test('a failed storage commit preserves old imports and later operations recover from the rejected queue', async () => {
  const f = fixture({ rows: [row(), row(otherId)] });
  const preview = await f.send({ type: 'HISTORY_PREVIEW', days: 30 });
  await f.send({ type: 'HISTORY_IMPORT', token: preview.token, videoIds: [videoId] });
  const before = f.api.storage.local.snapshot();
  f.api.storage.local.failNextSet();
  await assert.rejects(f.send({ type: 'HISTORY_IMPORT', token: preview.token, videoIds: [otherId] }), (error) => {
    assert.match(error.message, /could not be completed/);
    assert.equal(error.message.includes('private storage error'), false);
    return true;
  });
  assert.deepEqual(f.api.storage.local.snapshot(), before);
  const result = await f.send({ type: 'HISTORY_IMPORT', token: preview.token, videoIds: [otherId] });
  assert.equal(result.visits.length, 2);
});

test('overlapping imports serialize read-modify-write operations without losing either selection', async () => {
  const f = fixture({ rows: [row(), row(otherId)] });
  const preview = await f.send({ type: 'HISTORY_PREVIEW', days: 30 });
  await Promise.all([
    f.send({ type: 'HISTORY_IMPORT', token: preview.token, videoIds: [videoId] }),
    f.send({ type: 'HISTORY_IMPORT', token: preview.token, videoIds: [otherId] }),
  ]);
  const status = await f.send({ type: 'HISTORY_STATUS' });
  assert.deepEqual(new Set(status.visits.map((visit) => visit.videoId)), new Set([videoId, otherId]));
});

test('revocation clears pending previews without scanning or deleting saved imports', async () => {
  const f = fixture();
  const preview = await f.send({ type: 'HISTORY_PREVIEW', days: 30 });
  const saved = await f.send({ type: 'HISTORY_IMPORT', token: preview.token, videoIds: [videoId] });
  f.revoke();
  await assert.rejects(f.send({ type: 'HISTORY_IMPORT', token: preview.token, videoIds: [videoId] }), /access is off/);
  assert.equal(f.api.storage.session.snapshot()[HISTORY_PREVIEW_KEY], undefined);
  assert.deepEqual(await f.send({ type: 'HISTORY_STATUS' }), { ...saved, granted: false });
  assert.equal(f.queries.length, 2);
});

test('clear, cancel and disconnect have distinct effects and preserve unrelated storage', async () => {
  const f = fixture();
  await f.api.storage.local.set({ [STORE_KEY]: { recorder: true }, [SKILLS_STORE_KEY]: { skills: true }, unrelated: 'keep' });
  await f.api.storage.session.set({ unrelatedSession: 'keep' });
  let preview = await f.send({ type: 'HISTORY_PREVIEW', days: 30 });
  await f.send({ type: 'HISTORY_CANCEL' });
  assert.deepEqual(f.api.storage.session.snapshot(), { unrelatedSession: 'keep' });
  preview = await f.send({ type: 'HISTORY_PREVIEW', days: 30 });
  const imported = await f.send({ type: 'HISTORY_IMPORT', token: preview.token, videoIds: [videoId] });
  const disconnected = await f.send({ type: 'HISTORY_DISCONNECT' });
  assert.deepEqual(disconnected, { ...imported, granted: false });
  assert.equal(f.removedPermissions.length, 1);
  assert.deepEqual(f.api.storage.session.snapshot(), { unrelatedSession: 'keep' });
  assert.equal(f.queries.length, 4);
  assert.deepEqual(await f.send({ type: 'HISTORY_CLEAR' }), { ok: true, granted: false, visits: [], updatedAt: null });
  assert.deepEqual(f.api.storage.local.snapshot(), { [STORE_KEY]: { recorder: true }, [SKILLS_STORE_KEY]: { skills: true }, unrelated: 'keep' });
});

test('saved imports are sanitized and bounded again when read, and merging preserves the 1000-row cap', async () => {
  const f = fixture();
  const imports = Array.from({ length: 1000 }, (_, index) => ({ ...row(generatedId(index), { lastVisitTime: time - 2 * day - index }), videoId: generatedId(index), importedAt: time - day }));
  await f.api.storage.local.set({ [HISTORY_IMPORT_KEY]: { schemaVersion: 1, updatedAt: time - day, visits: [
    { ...row(), videoId, importedAt: time - day, secret: 'not returned', title: 'x'.repeat(500) },
    { ...row(otherId), videoId: otherId, importedAt: time + 1 },
    { ...row(), videoId: generatedId(1001), importedAt: time - day },
    ...imports,
  ] } });
  const status = await f.send({ type: 'HISTORY_STATUS' });
  assert.equal(status.visits.length, 1000);
  assert.equal(status.visits[0].title.length, 300);
  assert.deepEqual(Object.keys(status.visits[0]).sort(), ['videoId', 'url', 'title', 'lastVisitTime', 'importedAt'].sort());
  assert.equal(status.visits.some((visit) => visit.videoId === otherId || visit.videoId === generatedId(1001)), false);
  const preview = await f.send({ type: 'HISTORY_PREVIEW', days: 30 });
  const result = await f.send({ type: 'HISTORY_IMPORT', token: preview.token, videoIds: [videoId] });
  assert.equal(result.visits.length, 1000);
  assert.equal(f.api.storage.local.snapshot()[HISTORY_IMPORT_KEY].visits.length, 1000);
  assert.equal(JSON.stringify(f.api.storage.local.snapshot()[HISTORY_IMPORT_KEY]).includes('not returned'), false);
  assert.equal(f.queries.length, 2, 'status does not scan history');
});

test('cancel during an in-flight preview removes the late preview before cancellation completes', async () => {
  const f = fixture();
  let resolveSearch, started;
  const searching = new Promise((resolve) => { started = resolve; });
  const blocked = new Promise((resolve) => { resolveSearch = resolve; });
  f.setSearch(async ({ text }) => {
    if (text === 'youtube.com') { started(); return blocked; }
    return [];
  });
  const preview = f.send({ type: 'HISTORY_PREVIEW', days: 30 });
  await searching;
  const cancel = f.send({ type: 'HISTORY_CANCEL' });
  resolveSearch([row()]);
  const result = await preview;
  assert.deepEqual(await cancel, { ok: true });
  assert.deepEqual(f.api.storage.session.snapshot(), {});
  await assert.rejects(f.send({ type: 'HISTORY_IMPORT', token: result.token, videoIds: [videoId] }), /expired or changed/);
});

test('permission revoked during a query prevents a preview token from being saved', async () => {
  const f = fixture();
  f.setSearch(async () => { f.revoke(); return [row()]; });
  await assert.rejects(f.send({ type: 'HISTORY_PREVIEW', days: 30 }), /access is off/);
  assert.deepEqual(f.api.storage.session.snapshot(), {});
  assert.deepEqual(f.api.storage.local.snapshot(), {});
});


test('Chrome history admission is required before any local history write',async()=>{
  let requested;const f=fixture({admitImports:async input=>{requested=input;throw Object.assign(Error('Your ten free history imports are used.'),{code:'QUOTA'});}});
  const preview=await f.send({type:'HISTORY_PREVIEW',days:30});
  await assert.rejects(f.send({type:'HISTORY_IMPORT',token:preview.token,videoIds:[videoId]}),/free history imports/);
  assert.deepEqual(requested.videoIds,[videoId]);assert.equal(f.api.storage.local.snapshot()[HISTORY_IMPORT_KEY],undefined);
});
test('revoked permission during hosted admission prevents local persistence',async()=>{
  const f=fixture({admitImports:async input=>{f.revoke();return {...input,added:0,imports:{limit:10,used:0,remaining:10}};}});
  const preview=await f.send({type:'HISTORY_PREVIEW',days:30});
  await assert.rejects(f.send({type:'HISTORY_IMPORT',token:preview.token,videoIds:[videoId]}),/access is off/);
  assert.equal(f.api.storage.local.snapshot()[HISTORY_IMPORT_KEY],undefined);
});

test('native cancel aborts hosted admission and clears the preview without persisting data',async()=>{
  let began;const ready=new Promise(resolve=>{began=resolve;});
  const f=fixture({admitImports:(_input,{signal})=>new Promise((resolve,reject)=>{began();signal.addEventListener('abort',()=>reject(Object.assign(Error('Import stopped. Your saved records are kept.'),{code:'CANCELLED'})),{once:true});})});
  const preview=await f.send({type:'HISTORY_PREVIEW',days:30}),saving=f.send({type:'HISTORY_IMPORT',token:preview.token,videoIds:[videoId]});
  const failed=assert.rejects(saving,/stopped/);await ready;await f.send({type:'HISTORY_CANCEL'});await failed;
  assert.equal(f.api.storage.local.snapshot()[HISTORY_IMPORT_KEY],undefined);assert.equal(f.api.storage.session.snapshot()[HISTORY_PREVIEW_KEY],undefined);
});
