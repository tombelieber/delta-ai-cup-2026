import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_HISTORY_KEY, ACCOUNT_HISTORY_SESSION_KEY, createAccountHistoryHandler, normalizeAccountHistory } from './account-history.js';
import { ACCOUNT_HISTORY_IMPORT_SCOPES, DEFAULT_ACCOUNT_HISTORY_RANGE } from './account-history-scope.js';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const historyUrl = 'https://www.youtube.com/feed/history';
const native = { id: extensionId, url: `chrome-extension://${extensionId}/panel.html` };
const identity = { key: 'channel:@example', label: 'Example (@example)' };
const otherIdentity = { key: 'channel:@other', label: 'Other (@other)' };
const currentTime = new Date(2026, 9, 18, 14, 30).getTime();
const videoId = number => `video${String(number).padStart(6, '0')}`;
const visibleRow = (number = 1, date = '2026-10-17', overrides = {}) => ({ videoId: videoId(number), url: `https://www.youtube.com/watch?v=${videoId(number)}&t=10`,
  title: `Visible history title ${number}`, date, dateLabel: date || 'Date not shown', datePrecision: date ? 'day' : 'unknown', kind: 'video', ...overrides });
const content = tabId => ({ id: extensionId, url: historyUrl, frameId: 0, tab: { id: tabId } });

function area(values) {
  let failSet = false, waitSet = null, setCount = 0;
  return {
    async get(key) { return structuredClone({ [key]: values[key] }); },
    async set(value) {
      if (waitSet) { const pending = waitSet; waitSet = null; await pending; }
      if (failSet) { failSet = false; throw Error('private storage diagnostic'); }
      Object.assign(values, structuredClone(value));
      setCount++;
    },
    failNextSet() { failSet = true; },
    holdNextSet(promise) { waitSet = promise; },
    get setCount() { return setCount; },
  };
}
function fixture({admitImports = async input => ({...input,added:0,imports:{limit:10,used:0,remaining:10}})} = {}) {
  const values = {}, sessions = {}, sent = [], tabs = new Map();
  let clock = currentTime, nextTab = 10, visibleAccount = identity;
  const forbidden = () => assert.fail('History import must not use permissions, browser history, cookies or model calls.');
  const api = {
    runtime: { id: extensionId, getURL: path => `chrome-extension://${extensionId}/${path}` },
    storage: { local: area(values), session: area(sessions) },
    permissions: { request: forbidden, contains: forbidden }, history: { search: forbidden }, cookies: { getAll: forbidden },
    tabs: {
      async create(options) { assert.deepEqual(options, { url: historyUrl, active: true }); const tab = { id: ++nextTab, url: options.url, status: 'complete' }; tabs.set(tab.id, tab); return tab; },
      async get(id) { if (!tabs.has(id)) throw Error('closed'); return tabs.get(id); },
      async sendMessage(tabId, message, options) {
        sent.push({ tabId, ...structuredClone(message) });
        assert.deepEqual(options, { frameId: 0 });
        if (message.type === 'DELTA_ACCOUNT_HISTORY_PROBE') return { ok: true, ready: true, account: visibleAccount };
        return { ok: true };
      },
    },
  };
  const make = () => createAccountHistoryHandler({ api, admitImports, panelSender: sender => sender?.url === native.url, now: () => clock });
  let handle = make();
  return { api, values, sessions, sent, tabs, send: (message, sender = native) => handle(message, sender),
    restart: () => { handle = make(); }, advance: ms => { clock += ms; }, account: value => { visibleAccount = value; },
    removed: tabId => handle.handleTabRemoved(tabId), navigated: (tabId, url) => handle.handleTabUpdated(tabId, url) };
}
async function start(f, range = 'all') {
  await f.send({ type: 'ACCOUNT_HISTORY_OPEN', range });
  const confirmed = await f.send({ type: 'ACCOUNT_HISTORY_STATUS' });
  assert.equal(confirmed.session.phase, 'confirm');
  return f.send({ type: 'ACCOUNT_HISTORY_CONFIRM', jobId: confirmed.session.id, accountKey: identity.key });
}
const batch = (session, rows) => ({ type: 'ACCOUNT_HISTORY_BATCH', jobId: session.id, accountKey: identity.key, rows, progress: { oldestDate: '2026-10-17', dateLabel: 'Yesterday' } });

test('status never grants permission or starts collection; visible opening requires fresh account confirmation', async () => {
  const f = fixture();
  assert.deepEqual(await f.send({ type: 'ACCOUNT_HISTORY_STATUS' }), { ok: true, session: null, account: null, entryCount: 0, videoCount: 0, accountCount: 0 });
  assert.equal(f.sent.length, 0);
  const opened = await f.send({ type: 'ACCOUNT_HISTORY_OPEN', range: 'all' });
  assert.equal(opened.session.phase, 'opening');
  assert.equal(opened.session.startDate, null);
  assert.equal(opened.session.endDate, '2026-10-18');
  assert.equal(f.sent.length, 0);
  const status = await f.send({ type: 'ACCOUNT_HISTORY_STATUS' });
  assert.equal(status.session.phase, 'confirm');
  assert.deepEqual(status.account, identity);
  assert.equal(f.sent.some(message => message.type === 'DELTA_ACCOUNT_HISTORY_START'), false);
  await f.send({ type: 'ACCOUNT_HISTORY_CONFIRM', jobId: status.session.id, accountKey: identity.key });
  assert.equal(f.sent.filter(message => message.type === 'DELTA_ACCOUNT_HISTORY_PROBE').length, 2);
  const command = f.sent.find(message => message.type === 'DELTA_ACCOUNT_HISTORY_START');
  assert.equal(command.jobId, status.session.id);
  assert.equal(command.range, 'all');
  assert.deepEqual(command.account, identity);
});

test('rolling date windows include today; bounded imports count unknown and excluded days', async () => {
  for (const [range, expected] of [['week', '2026-10-12'], ['month', '2026-09-19'], ['year', '2025-10-19']]) {
    const f = fixture();
    const state = await start(f, range);
    assert.equal(state.session.startDate, expected);
  }
  const f = fixture(), state = await start(f, 'week');
  await f.send(batch(state.session, [visibleRow(1, '2026-10-12'), visibleRow(2, '2026-10-11'), visibleRow(3, null)]), content(state.session.tabId));
  const status = await f.send({ type: 'ACCOUNT_HISTORY_STATUS' });
  assert.equal(status.entryCount, 1);
  assert.equal(status.session.skippedUnknown, 1);
  assert.equal(status.session.skippedOutOfRange, 1);
});

test('native and content authority is scoped to the owned top history tab, nonce and account', async () => {
  const f = fixture(), state = await start(f), s = state.session;
  for (const sender of [content(s.tabId), { ...native, id: 'other' }]) await assert.rejects(f.send({ type: 'ACCOUNT_HISTORY_STATUS' }, sender), /not available/);
  for (const sender of [{ ...content(s.tabId), frameId: 1 }, { ...content(s.tabId), id: 'other' }, content(s.tabId + 1),
    { ...content(s.tabId), url: `${historyUrl}?search_query=private` }, { ...content(s.tabId), url: 'https://www.youtube.com.evil.test/feed/history' }]) {
    await assert.rejects(f.send(batch(s, [visibleRow()]), sender));
  }
  await assert.rejects(f.send({ ...batch(s, [visibleRow()]), jobId: 'stale' }, content(s.tabId)), /changed/);
  assert.equal((await f.send({ type: 'ACCOUNT_HISTORY_STATUS' })).session.phase, 'running', 'an obsolete nonce cannot stop the current job');
  await assert.rejects(f.send({ ...batch(s, [visibleRow()]), accountKey: otherIdentity.key }, content(s.tabId)), /account changed/);
  assert.equal((await f.send({ type: 'ACCOUNT_HISTORY_STATUS' })).session.phase, 'paused');
  assert.equal(f.values[ACCOUNT_HISTORY_KEY].accounts[identity.key].entries.length, 0);
});

test('day-level repeats and unknown dates survive without playback claims, secret fields or a 2000-entry truncation', async () => {
  const f = fixture(), state = await start(f), s = state.session;
  const prior = Array.from({ length: 2200 }, (_, index) => ({ ...visibleRow(index + 1), url: `https://www.youtube.com/watch?v=${videoId(index + 1)}`, importedAt: currentTime - 1000 }));
  f.values[ACCOUNT_HISTORY_KEY] = { schemaVersion: 1, activeAccountKey: identity.key, accounts: { [identity.key]: { account: identity, entries: prior, updatedAt: currentTime - 1000 } } };
  const rows = [visibleRow(1, '2026-10-16'), visibleRow(3000, null, { kind: 'short', url: `https://www.youtube.com/shorts/${videoId(3000)}`, cookie: 'private', watchedSeconds: 999 })];
  await f.send(batch(s, rows), content(s.tabId));
  await f.send(batch(s, rows), content(s.tabId));
  const normalized = normalizeAccountHistory(f.values[ACCOUNT_HISTORY_KEY], currentTime);
  assert.equal(normalized.accounts[identity.key].entries.length, 2202);
  assert.equal(normalized.accounts[identity.key].entries.filter(entry => entry.videoId === videoId(1)).length, 2);
  const short = normalized.accounts[identity.key].entries.find(entry => entry.videoId === videoId(3000));
  assert.equal(short.date, null); assert.equal(short.datePrecision, 'unknown'); assert.equal(short.kind, 'short');
  assert.equal(short.url, `https://www.youtube.com/watch?v=${videoId(3000)}`);
  assert.equal(JSON.stringify(normalized).includes('private'), false);
  assert.equal(Object.hasOwn(short, 'watchedSeconds'), false);
  const status = await f.send({ type: 'ACCOUNT_HISTORY_STATUS' });
  assert.equal(status.entryCount, 2202); assert.equal(status.videoCount, 2201);
  assert.equal(JSON.stringify(status).includes('Visible history title'), false, 'status never returns stored history entries');
});

test('pause serializes against a pending batch, and resume changes nonce and always asks for confirmation', async () => {
  const f = fixture(), state = await start(f), s = state.session;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  f.api.storage.local.holdNextSet(held);
  const pending = f.send(batch(s, [visibleRow()]), content(s.tabId));
  const paused = f.send({ type: 'ACCOUNT_HISTORY_PAUSE', jobId: s.id });
  release();
  await pending; await paused;
  await assert.rejects(f.send(batch(s, [visibleRow(2)]), content(s.tabId)), /paused/);
  const continued = await f.send({ type: 'ACCOUNT_HISTORY_CONTINUE' });
  assert.equal(continued.session.phase, 'confirm');
  assert.notEqual(continued.session.id, s.id);
  assert.equal(f.sent.filter(message => message.type === 'DELTA_ACCOUNT_HISTORY_START').length, 1);
  await assert.rejects(f.send(batch(s, [visibleRow(2)]), content(s.tabId)), /changed/);
  f.restart();
  await f.send({ type: 'ACCOUNT_HISTORY_CONFIRM', jobId: continued.session.id, accountKey: identity.key });
  await f.send(batch(continued.session, [visibleRow(2)]), content(s.tabId));
  assert.equal((await f.send({ type: 'ACCOUNT_HISTORY_STATUS' })).entryCount, 2);
});

test('empty heartbeats and unchanged canonical rows update progress without rewriting the account dataset', async () => {
  const f = fixture(), state = await start(f), s = state.session;
  await f.send(batch(s, [visibleRow()]), content(s.tabId));
  const writes = f.api.storage.local.setCount;
  const before = structuredClone(f.values[ACCOUNT_HISTORY_KEY]);
  f.advance(1000);
  await f.send(batch(s, []), content(s.tabId));
  await f.send(batch(s, [visibleRow()]), content(s.tabId));
  assert.equal(f.api.storage.local.setCount, writes);
  assert.deepEqual(f.values[ACCOUNT_HISTORY_KEY], before);
  assert.equal(f.sessions[ACCOUNT_HISTORY_SESSION_KEY].lastProgressAt, currentTime + 1000);
  await f.send(batch(s, [visibleRow(2)]), content(s.tabId));
  assert.equal(f.api.storage.local.setCount, writes + 1);
});

test('a changed visible account cannot resume into another account dataset', async () => {
  const f = fixture(), state = await start(f), s = state.session;
  await f.send(batch(s, [visibleRow()]), content(s.tabId));
  f.account(otherIdentity);
  await assert.rejects(f.send({ type: 'ACCOUNT_HISTORY_CONTINUE', jobId: s.id }), /account changed/);
  assert.equal(f.sent.filter(message => message.type === 'DELTA_ACCOUNT_HISTORY_START').length, 1);
  assert.equal(f.values[ACCOUNT_HISTORY_KEY].accounts[identity.key].entries.length, 1);
  assert.equal(f.values[ACCOUNT_HISTORY_KEY].accounts[otherIdentity.key], undefined);
});

test('quota or malformed-batch failure pauses collection and preserves earlier committed batches', async () => {
  for (const failure of ['quota', 'invalid']) {
    const f = fixture(), state = await start(f), s = state.session;
    await f.send(batch(s, [visibleRow()]), content(s.tabId));
    const before = structuredClone(f.values[ACCOUNT_HISTORY_KEY]);
    if (failure === 'quota') f.api.storage.local.failNextSet();
    const next = failure === 'quota' ? visibleRow(2) : visibleRow(2, '2026-02-30');
    await assert.rejects(f.send(batch(s, [next]), content(s.tabId)), error => !error.message.includes('private storage diagnostic'));
    assert.deepEqual(f.values[ACCOUNT_HISTORY_KEY], before);
    assert.equal((await f.send({ type: 'ACCOUNT_HISTORY_STATUS' })).session.phase, 'paused');
    assert.equal(f.sent.at(-1).type, 'DELTA_ACCOUNT_HISTORY_STOP');
  }
});

test('only a bounded range can complete; page end and a stalled scroll remain distinct honest states', async () => {
  for (const [range, reason, phase] of [['all', 'stalled', 'paused'], ['all', 'end', 'complete'], ['week', 'range', 'complete']]) {
    const f = fixture(), state = await start(f, range), s = state.session;
    await f.send({ type: 'ACCOUNT_HISTORY_FINISH', jobId: s.id, accountKey: identity.key, reason }, content(s.tabId));
    const status = await f.send({ type: 'ACCOUNT_HISTORY_STATUS' });
    assert.equal(status.session.phase, phase);
    assert.equal(status.session.rangeComplete, reason === 'range');
    assert.equal(status.session.availablePageEnd, reason === 'end');
    if (reason === 'end') assert.match(status.session.message, /does not prove complete/);
  }
  const f = fixture(), state = await start(f);
  await assert.rejects(f.send({ type: 'ACCOUNT_HISTORY_FINISH', jobId: state.session.id, accountKey: identity.key, reason: 'range' }, content(state.session.tabId)), /unverified completion/);
});

test('closed, navigated and stale owned tabs pause without restarting collection', async () => {
  for (const change of ['closed', 'navigation', 'stale']) {
    const f = fixture(), state = await start(f), s = state.session;
    if (change === 'closed') { f.tabs.delete(s.tabId); await f.removed(s.tabId); }
    if (change === 'navigation') { f.tabs.set(s.tabId, { id: s.tabId, url: 'https://www.youtube.com/' }); await f.navigated(s.tabId, 'https://www.youtube.com/'); }
    if (change === 'stale') f.advance(45_001);
    assert.equal((await f.send({ type: 'ACCOUNT_HISTORY_STATUS' })).session.phase, 'paused');
    assert.equal(f.sent.filter(message => message.type === 'DELTA_ACCOUNT_HISTORY_START').length, 1);
  }
});

test('clear invalidates the job and removes only the exact active local account dataset', async () => {
  const f = fixture(), state = await start(f), s = state.session;
  await f.send(batch(s, [visibleRow()]), content(s.tabId));
  f.values[ACCOUNT_HISTORY_KEY].accounts[otherIdentity.key] = { account: otherIdentity, entries: [{ ...visibleRow(2), importedAt: currentTime }], updatedAt: currentTime };
  f.values['zhixin.watch.v1'] = { recordingEnabled: true };
  f.values['delta-skill-tree-v1'] = { evidence: 'keep' };
  await assert.rejects(f.send({ type: 'ACCOUNT_HISTORY_CLEAR', accountKey: otherIdentity.key }), /currently active/);
  const cleared = await f.send({ type: 'ACCOUNT_HISTORY_CLEAR', accountKey: identity.key });
  assert.equal(cleared.entryCount, 0); assert.equal(cleared.accountCount, 1);
  assert.notEqual(cleared.session.id, s.id);
  assert.equal(f.values[ACCOUNT_HISTORY_KEY].accounts[identity.key], undefined);
  assert.equal(f.values[ACCOUNT_HISTORY_KEY].accounts[otherIdentity.key].entries.length, 1);
  assert.deepEqual(f.values['zhixin.watch.v1'], { recordingEnabled: true });
  assert.deepEqual(f.values['delta-skill-tree-v1'], { evidence: 'keep' });
  await assert.rejects(f.send(batch(s, [visibleRow(3)]), content(s.tabId)), /changed/);
});


test('latest-ten import keeps strict confirmation and adds only ten selected videos without replacing existing accounts', async () => {
  const f = fixture(), state = await start(f, 'latest10'), s = state.session;
  assert.equal(s.startDate, null);
  assert.equal(f.sent.find(message => message.type === 'DELTA_ACCOUNT_HISTORY_START').range, 'latest10');
  const old = { ...visibleRow(500, '2026-10-01'), importedAt: currentTime - 1000 };
  f.values[ACCOUNT_HISTORY_KEY] = {schemaVersion:1,activeAccountKey:identity.key,accounts:{
    [identity.key]:{account:identity,entries:[old],updatedAt:currentTime-1000},
    [otherIdentity.key]:{account:otherIdentity,entries:[{...visibleRow(600),importedAt:currentTime-1000}],updatedAt:currentTime-1000},
  }};
  const rows=Array.from({length:10},(_,i)=>visibleRow(10-i,i===0?null:'2026-10-17',{pageOrder:i}));
  await f.send(batch(s,rows),content(s.tabId));
  await f.send(batch(s,rows),content(s.tabId));
  const saved=normalizeAccountHistory(f.values[ACCOUNT_HISTORY_KEY],currentTime);
  assert.equal(saved.accounts[identity.key].entries.length,11);
  assert.equal(saved.accounts[otherIdentity.key].entries.length,1);
  const selected=saved.accounts[identity.key].entries.filter(row=>row.pageOrder!=null).sort((a,b)=>a.pageOrder-b.pageOrder);
  assert.deepEqual(selected.map(row=>row.videoId),rows.map(row=>row.videoId));
  assert.ok(selected.every(row=>row.pageObservedAt===currentTime&&!Object.hasOwn(row,'watchedSeconds')));
  await f.send({type:'ACCOUNT_HISTORY_FINISH',jobId:s.id,accountKey:identity.key,reason:'limit'},content(s.tabId));
  const status=await f.send({type:'ACCOUNT_HISTORY_STATUS'});
  assert.equal(status.session.phase,'complete');
  assert.equal(status.session.selectedVideoIds.length,10);
});

test('latest-ten background bound rejects an oversized batch before saving and never accepts an eleventh video across batches', async () => {
  const f=fixture(),state=await start(f,'latest10'),s=state.session;
  const rows=Array.from({length:11},(_,i)=>visibleRow(i+1,'2026-10-17',{pageOrder:i}));
  await assert.rejects(f.send(batch(s,rows),content(s.tabId)),/ten|10/i);
  assert.equal(f.values[ACCOUNT_HISTORY_KEY].accounts[identity.key].entries.length,0);
  const next=fixture(),started=await start(next,'latest10'),job=started.session;
  await next.send(batch(job,rows.slice(0,10)),content(job.tabId));
  await assert.rejects(next.send(batch(job,[visibleRow(99,'2026-10-17',{pageOrder:0})]),content(job.tabId)),/ten|10/i);
  assert.equal(next.values[ACCOUNT_HISTORY_KEY].accounts[identity.key].entries.length,10);
});

test('latest-ten visible-only completion is explicit and full imports cannot claim a ten-video limit', async () => {
  const f=fixture(),state=await start(f,'latest10'),s=state.session;
  await f.send(batch(s,[visibleRow(1,'2026-10-17',{pageOrder:0})]),content(s.tabId));
  await f.send({type:'ACCOUNT_HISTORY_FINISH',jobId:s.id,accountKey:identity.key,reason:'visible'},content(s.tabId));
  const status=await f.send({type:'ACCOUNT_HISTORY_STATUS'});
  assert.equal(status.session.phase,'complete');
  assert.match(status.session.message,/no.*scroll|without.*scroll/i);
  const full=fixture(),all=await start(full);
  await assert.rejects(full.send({type:'ACCOUNT_HISTORY_FINISH',jobId:all.session.id,accountKey:identity.key,reason:'limit'},content(all.session.tabId)),/unverified/);
});


test('latest-ten rejects reordered ordinal claims before saving and later full imports preserve observed order metadata', async () => {
  const f=fixture(),state=await start(f,'latest10'),s=state.session;
  await assert.rejects(f.send(batch(s,[visibleRow(1,'2026-10-17',{pageOrder:8})]),content(s.tabId)),/page order/);
  assert.equal(f.values[ACCOUNT_HISTORY_KEY].accounts[identity.key].entries.length,0);
  const next=fixture(),selected=await start(next,'latest10');
  await next.send(batch(selected.session,[visibleRow(1,'2026-10-17',{pageOrder:0})]),content(selected.session.tabId));
  const full=await start(next,'all');
  await next.send(batch(full.session,[visibleRow(1,'2026-10-17')]),content(full.session.tabId));
  const row=next.values[ACCOUNT_HISTORY_KEY].accounts[identity.key].entries[0];
  assert.equal(row.pageOrder,0);assert.equal(row.pageObservedAt,currentTime);
});


test('omitted import scope defaults to latest ten while explicit latest10 and full history remain available', async () => {
  const f=fixture();
  assert.equal(DEFAULT_ACCOUNT_HISTORY_RANGE,'latest10');
  assert.ok(ACCOUNT_HISTORY_IMPORT_SCOPES.some(scope=>scope.id==='all'));
  assert.ok(ACCOUNT_HISTORY_IMPORT_SCOPES.some(scope=>scope.id==='latest10'));
  const opened=await f.send({type:'ACCOUNT_HISTORY_OPEN'});
  assert.equal(opened.session.range,'latest10');assert.equal(opened.session.startDate,null);
  assert.equal(f.sent.some(message=>message.type==='DELTA_ACCOUNT_HISTORY_START'),false);
  assert.equal(f.values[ACCOUNT_HISTORY_KEY],undefined);
});

test('maximum100 persists four bounded batches, replay and ordinal99 without replacing old records',async()=>{
  const f=fixture(),state=await start(f,'latest100'),s=state.session;
  f.values[ACCOUNT_HISTORY_KEY].accounts[identity.key].entries=[{...visibleRow(900,'2026-10-01'),importedAt:currentTime-1000}];
  const rows=Array.from({length:100},(_,i)=>visibleRow(i+1,i%2?null:'2026-10-17',{pageOrder:i}));
  for(let offset=0;offset<100;offset+=25)await f.send(batch(s,rows.slice(offset,offset+25)),content(s.tabId));
  f.restart();await f.send(batch(s,rows.slice(0,25)),content(s.tabId));
  const stored=normalizeAccountHistory(f.values[ACCOUNT_HISTORY_KEY],currentTime).accounts[identity.key].entries;
  assert.equal(stored.length,101);assert.equal(stored.find(row=>row.videoId===videoId(100)).pageOrder,99);
  assert.ok(stored.every(row=>!Object.hasOwn(row,'watchedSeconds')));
  await f.send({type:'ACCOUNT_HISTORY_FINISH',jobId:s.id,accountKey:identity.key,reason:'limit'},content(s.tabId));
  const status=await f.send({type:'ACCOUNT_HISTORY_STATUS'});assert.equal(status.session.phase,'complete');
  assert.equal(status.session.selectedVideoIds.length,100);assert.match(status.session.message,/100/);
});

test('maximum100 refuses101 before writing and serialized concurrent tail batches cannot exceed100',async()=>{
  const oversized=fixture(),first=await start(oversized,'latest100');
  const rows=Array.from({length:101},(_,i)=>visibleRow(i+1,'2026-10-17',{pageOrder:i}));
  await assert.rejects(oversized.send(batch(first.session,rows),content(first.session.tabId)),/100/);
  assert.equal(oversized.values[ACCOUNT_HISTORY_KEY].accounts[identity.key].entries.length,0);
  const f=fixture(),state=await start(f,'latest100'),s=state.session;
  await f.send(batch(s,rows.slice(0,75)),content(s.tabId));
  const outcomes=await Promise.allSettled([
    f.send(batch(s,rows.slice(75,100)),content(s.tabId)),
    f.send(batch(s,Array.from({length:25},(_,i)=>visibleRow(i+501,'2026-10-17',{pageOrder:i+75}))),content(s.tabId)),
  ]);
  assert.deepEqual(outcomes.map(result=>result.status),['fulfilled','rejected']);
  assert.equal(f.values[ACCOUNT_HISTORY_KEY].accounts[identity.key].entries.length,100);
  assert.equal(new Set(f.sessions[ACCOUNT_HISTORY_SESSION_KEY].selectedVideoIds).size,100);
});

test('maximum100 timeout and round budget retain partial rows and cannot claim a full limit',async()=>{
  for(const reason of ['timeout','budget']){
    const f=fixture(),state=await start(f,'latest100'),s=state.session;
    await f.send(batch(s,Array.from({length:25},(_,i)=>visibleRow(i+1,'2026-10-17',{pageOrder:i}))),content(s.tabId));
    await f.send({type:'ACCOUNT_HISTORY_FINISH',jobId:s.id,accountKey:identity.key,reason},content(s.tabId));
    const status=await f.send({type:'ACCOUNT_HISTORY_STATUS'});
    assert.equal(status.session.phase,'paused');assert.match(status.session.message,/partial/);assert.match(status.session.message,/25/);
    assert.equal(f.values[ACCOUNT_HISTORY_KEY].accounts[identity.key].entries.length,25);
  }
  const f=fixture(),state=await start(f,'latest100');
  await assert.rejects(f.send({type:'ACCOUNT_HISTORY_FINISH',jobId:state.session.id,accountKey:identity.key,reason:'limit'},content(state.session.tabId)),/unverified/);
});


test('account history cannot persist a batch before account admission; denied data stays absent', async()=>{
  let requested;
  const f=fixture({admitImports:async input=>{requested=input;throw Object.assign(Error('Your ten free history imports are used.'),{code:'QUOTA'});}});
  const started=await start(f,'latest10');
  await assert.rejects(f.send(batch(started.session,[visibleRow(1,null,{pageOrder:0})]),content(started.session.tabId)),/free history imports/);
  assert.deepEqual(requested.videoIds,[videoId(1)]);assert.equal(f.values[ACCOUNT_HISTORY_KEY].accounts[identity.key].entries.length,0);
});
test('account change while hosted admission is open prevents local persistence',async()=>{
  const f=fixture({admitImports:async input=>{f.account(otherIdentity);return {...input,added:0,imports:{limit:10,used:0,remaining:10}};}});
  const started=await start(f,'latest10');
  await assert.rejects(f.send(batch(started.session,[visibleRow(1,null,{pageOrder:0})]),content(started.session.tabId)),/account changed/i);
  assert.equal(f.values[ACCOUNT_HISTORY_KEY].accounts[identity.key].entries.length,0);
});

test('native pause cancels a waiting admission immediately without committing the batch',async()=>{
  let began;const ready=new Promise(resolve=>{began=resolve;});
  const f=fixture({admitImports:(_input,{signal})=>new Promise((resolve,reject)=>{began();signal.addEventListener('abort',()=>reject(Object.assign(Error('Import stopped. Your saved records are kept.'),{code:'CANCELLED'})),{once:true});})});
  const started=await start(f,'latest10'),saving=f.send(batch(started.session,[visibleRow(1,null,{pageOrder:0})]),content(started.session.tabId));
  const failed=assert.rejects(saving,/stopped/);await ready;
  await f.send({type:'ACCOUNT_HISTORY_PAUSE',jobId:started.session.id});await failed;
  assert.equal(f.values[ACCOUNT_HISTORY_KEY].accounts[identity.key].entries.length,0);
});
