import test from 'node:test';
import assert from 'node:assert/strict';
import { installBackground } from './background.js';
import { STORE_KEY } from './store.js';
import { LEARNING_PILOT } from './learning-source.js';
import { LEARNING_LIBRARY_KEY, PANEL_INTENT_KEY } from './learning-library.js';
import { HISTORY_IMPORT_KEY } from './history-import.js';
import { ACCOUNT_HISTORY_KEY } from './account-history.js';
import { LEARNING_STORE_PREFIX, SKILLS_STORE_KEY } from './learning-protocol.js';
import { DEFAULT_API_ENDPOINT } from './analysis-client.js';
import { LEARNING_SOURCE_REGISTRY_VERSION } from '../server/learning-sources.mjs';

const id = 'abcdefghijklmnopabcdefghijklmnop', videoId = LEARNING_PILOT.videoId;
const native = { id, url: `chrome-extension://${id}/panel.html`, documentId: 'native' };
const content = { id, url: `https://www.youtube.com/watch?v=${videoId}`, frameId: 0, tab: { id: 7 } };
function fixture() {
  const calls = [], values = {}, sessions = {};
  const area = (data, name) => ({ async get(key) { calls.push(`${name}.get`); return structuredClone({ [key]: data[key] }); },
    async set(next) { calls.push(`${name}.set`); Object.assign(data, structuredClone(next)); }, async remove(key) { delete data[key]; } });
  const event = () => ({ addListener() {} });
  const api = { runtime: { id, getURL: path => `chrome-extension://${id}/${path}`, onMessage: event(), onInstalled: event(), onStartup: event() },
    storage: { local: area(values,'local'), session: area(sessions,'session') },
    permissions: { async contains() { calls.push('permissions.contains'); return false; }, request() { assert.fail('Listing saved records must never request permission.'); } },
    history: { async search() { calls.push('history.search'); throw Error('History must not be queried in a declined flow.'); } },
    sidePanel: { open(options) { calls.push(['open',options]); return Promise.resolve(); }, async setOptions() {}, async setPanelBehavior() {} },
    tabs: { async query() { return []; }, onUpdated: event(), onRemoved: event() } };
  const background = installBackground(api, () => 1_792_000_000_000, async () => { assert.fail('Listing saved records must never contact a model service.'); });
  return { api, background, calls, values, sessions, send: (message, sender=native) => background.handle(message,sender) };
}

test('learning nudge opens the native panel before any asynchronous work and records intent without inventing enrollment', async () => {
  const f=fixture();
  const opened=f.send({ type:'OPEN_LEARNING_PANEL',videoId },content);
  assert.deepEqual(f.calls[0],['open',{tabId:7}], 'sidePanel.open must run in the original message gesture');
  await opened;
  assert.equal(f.sessions[PANEL_INTENT_KEY].videoId,videoId);
  assert.equal(f.values[LEARNING_LIBRARY_KEY],undefined);
  assert.equal(f.values[STORE_KEY],undefined);
  assert.equal(f.values[SKILLS_STORE_KEY],undefined);
  assert.equal(f.values[HISTORY_IMPORT_KEY],undefined);
  const list=await f.send({type:'LEARNING_LIBRARY_GET'});
  assert.equal(list.items.length,0);
  const restarted=installBackground(f.api,()=>1_792_000_000_001);
  assert.equal((await restarted.handle({type:'LEARNING_LIBRARY_GET'},native)).items.length,0);
});

test('another real YouTube video opens the canonical learning intent without a pilot allowlist',async()=>{
  const f=fixture(),other='733mgqrzNKs';await f.send({type:'OPEN_LEARNING_PANEL',videoId:other},{...content,url:`https://www.youtube.com/watch?v=${other}`});
  assert.equal(f.sessions[PANEL_INTENT_KEY].videoId,other);assert.equal(f.values[LEARNING_LIBRARY_KEY],undefined);
});

test('declining history does not prevent saved learning or playback and never exposes imports to YouTube', async () => {
  const f=fixture();
  const privateVisit={schemaVersion:1,visits:[{title:'private visit',url:'https://www.youtube.com/watch?v=En5cSXgGvZM'}]};
  f.values[HISTORY_IMPORT_KEY]=privateVisit;
  await assert.rejects(f.send({type:'HISTORY_PREVIEW',days:30}),/access is off/);
  await assert.rejects(f.send({type:'HISTORY_STATUS'},content),/extension panel/);
  await f.send({type:'LEARNING_LIBRARY_SAVE',videoId});
  const state=await f.send({type:'GET_STATE',tabId:7});
  assert.equal(JSON.stringify(state).includes('private visit'),false);
  const response=await f.send({type:'RECORDER_SAMPLE',sample:{videoId,title:'SUMIF',duration:459,currentTime:40,status:'playing',epoch:0,ranges:[[35,40]]}},content);
  assert.equal(response.ok,true); assert.equal(response.view.learningEnrolled,true);
  assert.equal(JSON.stringify(response.view).includes('private visit'),false);
  assert.deepEqual(f.values[HISTORY_IMPORT_KEY],privateVisit);
  assert.deepEqual(f.values[STORE_KEY].videos[videoId].ranges,[[35,40]]);
});

test('dismissal persists without enrolling, and foreign/cross-video panel requests cannot open a panel', async () => {
  const f=fixture();
  await f.send({type:'DISMISS_LEARNING_NUDGE',videoId},content);
  assert.equal((await f.send({type:'LEARNING_LIBRARY_GET'})).items.length,0);
  for(const sender of [{...content,id:'other'}, {...content,frameId:1}, {...content,url:'https://www.youtube.com/watch?v=En5cSXgGvZM'},native]) {
    await assert.rejects(f.send({type:'OPEN_LEARNING_PANEL',videoId},sender));
  }
  assert.equal(f.calls.some(call=>Array.isArray(call)&&call[0]==='open'),false);
  const response=await f.send({type:'RECORDER_SAMPLE',sample:{videoId,title:'SUMIF',duration:459,currentTime:35,status:'paused',epoch:0,ranges:[]}},content);
  assert.equal(response.view.learningDismissed,true); assert.equal(response.view.learningEnrolled,false);
});

test('native intent is scoped to the clicked tab and existing lessons migrate without exposing tokens', async () => {
  const f=fixture();
  f.values[`${LEARNING_STORE_PREFIX}${videoId}`]={endpoint:DEFAULT_API_ENDPOINT,value:{lesson:{title:'Existing lesson'},lessonToken:'private signed token',profile:{interests:['private interest']}}};
  const library=await f.send({type:'LEARNING_LIBRARY_GET'});
  assert.equal(library.items.length,1); assert.equal(library.items[0].hasLesson,true);
  assert.equal(JSON.stringify(library).includes('private'),false);
  assert.equal((await f.send({type:'GET_STATE'})).entryIntent,null);
  await f.send({type:'OPEN_LEARNING_PANEL',videoId},content);
  assert.equal((await f.send({type:'GET_STATE',tabId:8})).entryIntent,null);
  assert.equal((await f.send({type:'GET_STATE',tabId:7})).entryIntent.videoId,videoId);
  assert.equal(f.values[`${LEARNING_STORE_PREFIX}${videoId}`].value.lessonToken,'private signed token');
});

const observedAt = 1_791_999_000_000;
const evidence = (taskId, lessonId = 'lesson-one') => ({ skillId: 'sumif-text-equality', lessonId, taskId,
  formula: '=SUMIF(A2:A5,D2,B2:B5)', source: { videoUrl: `https://www.youtube.com/watch?v=${videoId}`, start: 35, end: 186 },
  registryVersion: LEARNING_SOURCE_REGISTRY_VERSION, origin: DEFAULT_API_ENDPOINT,
  checkedAt: new Date(observedAt + 1000).toISOString(), actualTotal: 900 });

test('native record journal merges playback, committed imports and checked learning without scans, grants, writes or uploads', async () => {
  const f = fixture(), watchedId = 'En5cSXgGvZM', importedOnly = 'bxBzsSsqQAM';
  f.values[STORE_KEY] = { schemaVersion: 1, recordingEnabled: true, recordingEpoch: 0, goal: 'private goal marker', videos: {
    [videoId]: { videoId, title: 'SUMIF watched title', duration: 459, ranges: [[35, 40], [38, 45]], updatedAt: observedAt },
    [watchedId]: { videoId: watchedId, title: 'Python tutorial', duration: 100, ranges: [[0, 12]], updatedAt: observedAt - 1000 },
  } };
  f.values[LEARNING_LIBRARY_KEY] = { schemaVersion: 1, items: {
    [videoId]: { title: 'Saved SUMIF title', enrolledAt: observedAt - 1000 },
    [importedOnly]: { title: 'Unsupported fake lesson', enrolledAt: observedAt },
  }, dismissed: [] };
  f.values[`${LEARNING_STORE_PREFIX}${videoId}`] = { endpoint: DEFAULT_API_ENDPOINT, value: {
    lesson: { title: 'Saved lesson' }, lessonToken: 'private token marker', profile: { interests: ['private profile marker'] }, rawSnapshot: 'private snapshot marker',
  } };
  f.values[SKILLS_STORE_KEY] = { value: { schemaVersion: 1, familiarity: {}, activity: {}, evidence: [evidence('tokyo'), evidence('tokyo', 'regenerated-lesson')] } };
  f.values[HISTORY_IMPORT_KEY] = { schemaVersion: 1, updatedAt: observedAt + 1000, visits: [
    { videoId, title: 'Imported SUMIF title', url: `https://www.youtube.com/watch?v=${videoId}`, lastVisitTime: observedAt - 2000, importedAt: observedAt + 1000 },
    { videoId: importedOnly, title: 'Funny cats compilation', url: `https://www.youtube.com/watch?v=${importedOnly}`, lastVisitTime: observedAt - 3000, importedAt: observedAt + 1000, rawSnapshot: 'private visit snapshot marker' },
    { videoId: 'abcdefghijk', title: 'Bad imported URL', url: 'https://evil.test/', lastVisitTime: observedAt, importedAt: observedAt },
  ] };
  const before = structuredClone(f.values);
  const response = await f.send({ type: 'LEARNING_LIBRARY_GET' });
  assert.deepEqual(response.journal.summary, { videos: 3, watched: 2, imported: 2, learning: 1, checkedTasks: 1 });
  assert.equal(response.items.length, 1, 'the supported lesson list is unchanged');
  assert.equal(response.items[0].tasks.length, 2, 'the existing item contract keeps its full checked evidence');
  const learnt = response.journal.entries.find(entry => entry.videoId === videoId);
  assert.equal(learnt.title, 'SUMIF watched title');
  assert.equal(learnt.watchedSeconds, 10);
  assert.equal(learnt.hasLesson, true);
  assert.equal(learnt.checkedTasks, 1, 'repeating a stable task after regeneration is one checked task');
  const imported = response.journal.entries.find(entry => entry.videoId === importedOnly);
  assert.equal(imported.imported, true);
  assert.equal(imported.hasPlayback, false);
  assert.equal(imported.learningStarted, false, 'unsupported raw library items cannot create learning evidence');
  assert.equal(imported.lastActivityAt, observedAt - 3000, 'import time does not replace the original visit chronology');
  assert.equal(imported.kind, 'entertainment');
  assert.equal(JSON.stringify(response).includes('private'), false);
  assert.equal(f.calls.some(call => typeof call === 'string' && /\.set$|permissions\.|history\./.test(call)), false);
  assert.deepEqual(f.values, before, 'listing is read-only and does not seed playback or skills');
});

test('the journal remains native-only and rejects foreign/content readers before accessing storage', async () => {
  const f = fixture();
  for (const sender of [content, { ...native, id: 'another-extension' }, { ...content, frameId: 1 }]) {
    await assert.rejects(f.send({ type: 'LEARNING_LIBRARY_GET' }, sender), /only available in Delta/);
  }
  assert.deepEqual(f.calls, []);
});

test('existing checked tasks remain in the journal when their old lesson workspace is absent', async () => {
  const f = fixture();
  f.values[SKILLS_STORE_KEY] = { value: { schemaVersion: 1, familiarity: {}, activity: {}, evidence: [evidence('tokyo')] } };
  const response = await f.send({ type: 'LEARNING_LIBRARY_GET' });
  assert.deepEqual(response.items, [], 'journal aggregation does not implicitly enrol a lesson');
  assert.equal(response.journal.entries[0].videoId, videoId);
  assert.equal(response.journal.entries[0].learningStarted, true);
  assert.equal(response.journal.entries[0].hasLesson, false);
  assert.equal(response.journal.entries[0].checkedTasks, 1);
  assert.equal(f.values[LEARNING_LIBRARY_KEY], undefined);
});

test('account history contributes only the active account to native map/history and local topic hints', async () => {
  const f = fixture(), activeId = 'En5cSXgGvZM', otherId = 'bxBzsSsqQAM';
  const history = (key, id, title) => ({ account: { key, label: key.slice(8) }, updatedAt: observedAt,
    entries: [{ videoId: id, url: `https://www.youtube.com/watch?v=${id}`, title, date: '2026-10-01', dateLabel: 'Oct 1',
      datePrecision: 'day', kind: 'video', importedAt: observedAt }] });
  f.values[ACCOUNT_HISTORY_KEY] = { schemaVersion: 1, activeAccountKey: 'channel:@first', accounts: {
    'channel:@first': history('channel:@first', activeId, 'Python tutorial'),
    'channel:@second': history('channel:@second', otherId, 'private-other-account-marker'),
  } };
  const before = structuredClone(f.values);
  const response = await f.send({ type: 'LEARNING_LIBRARY_GET' });
  assert.equal(response.journal.account.key, 'channel:@first');
  assert.equal(response.journal.entries.length, 1);
  assert.equal(response.journal.entries[0].videoId, activeId);
  assert.equal(response.journal.entries[0].accountHistory, true);
  assert.equal(response.journal.entries[0].hasPlayback, false);
  assert.equal(response.journal.entries[0].checkedTasks, 0);
  const hints = await f.send({ type: 'LEARNING_INTERESTS' });
  assert.deepEqual(hints.result.suggestions, [{ label: 'Technology', count: 1 }]);
  assert.equal(JSON.stringify(hints).includes('Python tutorial'), false, 'interest messages expose labels, not history rows');
  assert.equal(JSON.stringify(response).includes('private-other-account-marker'), false);
  await assert.rejects(f.send({ type: 'LEARNING_LIBRARY_GET' }, content), /only available in Delta/);
  assert.deepEqual(f.values, before, 'listing and suggesting do not start collection or modify records');
  assert.equal(f.calls.some(call => typeof call === 'string' && /\.set$|permissions\.|history\./.test(call)), false);
});
