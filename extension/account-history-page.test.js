import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHistoryDate, readHistoryRows, installAccountHistoryPage } from './account-history-page.js';

const NOW = new Date(2026, 9, 18, 12).getTime();
const HEADER = ':scope > #header > ytd-item-section-header-renderer h2#title';
const CARDS = 'yt-lockup-view-model, ytm-shorts-lockup-view-model, ytd-video-renderer';
const NEXT = 'button[aria-label="下一批"], button[aria-label="Next batch"]';
class Element {
  constructor(text = '', attributes = {}) { this.textContent = text; this.attributes = attributes; this.queries = new Map(); this.hidden = false; this.disabled = false; this.value = ''; this.clicks = 0; this.scrolls = 0; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { const result = this.queries.get(selector) || []; return typeof result === 'function' ? result() : result; }
  set(selector, elements) { this.queries.set(selector, elements); return this; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  closest(selector) { return selector.includes('horizontal') ? this.shelf || null : selector === 'ytd-browse' ? this.browse || null : null; }
  click() { this.clicks += 1; this.onClick?.(); }
  scrollIntoView() { this.scrolls += 1; this.onScroll?.(); }
}
function card(id, title, { short = false, legacy = false } = {}) {
  const anchor = new Element(title, { href: short ? `/shorts/${id}?feature=share` : `/watch?v=${id}&tracking=discard`, title });
  const heading = new Element(title, { title }).set('a[href]', [anchor]);
  const element = new Element().set('h3[title], h3', legacy ? [] : [heading]).set('a#video-title[href]', legacy ? [anchor] : []);
  return element;
}
function section(label, entries) {
  return new Element().set(HEADER, [new Element(label)]).set(':scope > #contents', [new Element().set(CARDS, entries)]);
}
function fixture({ sections = [section('今天', [card('abcdefghijk', 'Synthetic tutorial')])], keepGoing = false } = {}) {
  let menuOpen = false, messageListener;
  const root = new Element().set('ytd-item-section-renderer', sections);
  const tab = new Element('全部', { 'aria-label': '全部', 'aria-selected': 'true' });
  root.set('[role="tab"][aria-selected="true"]', [tab]);
  const search = new Element();
  const guide = new Element('Your channel', { href: '/@demo-channel', title: '你的頻道' });
  const header = new Element().set('#account-name', [new Element('Demo learner')]).set('#channel-handle', [new Element('@demo-channel')]);
  const avatar = new Element(); avatar.onClick = () => { menuOpen = !menuOpen; };
  const listeners = new Map(), messages = [], timers = new Set();
  const document = new Element().set('ytd-browse[page-subtype="history"]', [root]).set('input[name="query"]', [search])
    .set('ytd-guide-renderer a[href]', [guide]).set('button#avatar-btn', [avatar])
    .set('ytd-active-account-header-renderer', () => menuOpen ? [header] : []);
  document.addEventListener = (type, callback) => listeners.set(type, callback);
  document.removeEventListener = type => listeners.delete(type);
  const window = {
    location: { href: 'https://www.youtube.com/feed/history' }, innerHeight: 700, scrollBy() {},
    performance: { elapsed: 0, now() { return this.elapsed; } },
    setTimeout(callback, ms) { const id = setTimeout(() => { timers.delete(id); callback(); }, ms >= 180000 ? 1000 : ms >= 5000 ? 500 : 0); timers.add(id); return id; },
    clearTimeout(id) { timers.delete(id); clearTimeout(id); },
    addEventListener(type, callback) { listeners.set(type, callback); }, removeEventListener(type) { listeners.delete(type); },
  };
  const runtime = { id: 'delta-test', getURL: path => `chrome-extension://delta-test/${path}`,
    onMessage: { addListener(callback) { messageListener = callback; }, removeListener(callback) { if (messageListener === callback) messageListener = null; } },
    async sendMessage(message) { messages.push(message); await runtime.onSend?.(message); return { ok: true, keepGoing }; },
  };
  const installed = installAccountHistoryPage({ document, window, runtime, now: () => NOW });
  const native = { id: runtime.id, url: runtime.getURL('background.js') };
  const send = (message, sender = native) => new Promise(resolve => messageListener(message, sender, resolve));
  const dispatch = (message, respond, sender = native) => messageListener(message, sender, respond);
  async function start(overrides = {}) {
    const probe = await send({ type: 'DELTA_ACCOUNT_HISTORY_PROBE' }); assert.equal(probe.ready, true);
    return send({ type: 'DELTA_ACCOUNT_HISTORY_START', jobId: 'job-one', account: probe.account, range: 'all', ...overrides });
  }
  async function finished() {
    for (let count = 0; count < 200; count += 1) {
      const finish = messages.find(message => message.type === 'ACCOUNT_HISTORY_FINISH');
      if (finish) return finish;
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    assert.fail('collector did not finish within the test bound');
  }
  return { document, window, runtime, root, tab, search, guide, header, avatar, messages, timers, listeners, send, dispatch, start, finished,
    close() { installed.stop(); for (const id of timers) clearTimeout(id); } };
}

test('English and Chinese day headings resolve to local calendar days, retaining unknown labels', () => {
  const cases = { Today: '2026-10-18', Yesterday: '2026-10-17', Friday: '2026-10-16', Sunday: '2026-10-11', '今天': '2026-10-18', '昨天': '2026-10-17', '星期五': '2026-10-16', '週五': '2026-10-16', '周日': '2026-10-11', '10月11日': '2026-10-11', '2025年12月31日': '2025-12-31', 'October 11': '2026-10-11', 'Oct 11, 2025': '2025-10-11', '11 October 2025': '2025-10-11', 'December 31': '2025-12-31' };
  for (const [label, date] of Object.entries(cases)) assert.deepEqual(parseHistoryDate(label, NOW), { dateLabel: label, date, datePrecision: 'day' });
  for (const label of ['Long ago', '2/3', '2026年2月30日', 'October 99', 'October 1 2027', '2026年2月29日']) assert.deepEqual(parseHistoryDate(label, NOW), { dateLabel: label, date: null, datePrecision: 'unknown' });
});

test('DOM projection is scoped to history sections, canonical, deduplicated per video/day, and keeps Shorts and unknown dates', () => {
  const same = 'abcdefghijk', f = fixture({ sections: [section('今天', [card(same, 'First'), card(same, 'Duplicate')]), section('昨天', [card(same, 'Repeated yesterday', { legacy: true }), card('lmnopqrstuv', 'Short video', { short: true })]), section('A heading we cannot date', [card('ZYXWVUTSRQP', 'Unknown day')])] });
  try {
    f.document.set(CARDS, [card('00000000000', 'Not a history card')]);
    const rows = readHistoryRows(f.document, NOW);
    assert.equal(rows.length, 4); assert.equal(rows[0].url, `https://www.youtube.com/watch?v=${same}`);
    assert.equal(rows[1].date, '2026-10-17'); assert.equal(rows[2].kind, 'short'); assert.equal(rows[3].date, null);
    assert.equal(JSON.stringify(rows).includes('tracking'), false);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['videoId', 'url', 'title', 'dateLabel', 'date', 'datePrecision', 'kind'].sort());
    assert.equal(f.messages.length, 0); assert.equal(f.avatar.clicks, 0);
  } finally { f.close(); }
});

test('install and probe send no rows; each probe freshly opens and closes only its account button', async () => {
  const f = fixture();
  try {
    f.document.set('ytd-guide-renderer a[href]', [f.guide, ...Array.from({ length: 7 }, (_, i) => new Element('Subscription', { href: `/@subscription-${i}`, title: `Subscribed channel ${i}` }))]);
    assert.equal(f.messages.length, 0);
    for (let i = 0; i < 2; i += 1) {
      const response = await f.send({ type: 'DELTA_ACCOUNT_HISTORY_PROBE' });
      assert.deepEqual(response.account, { key: 'channel:@demo-channel', label: 'Demo learner (@demo-channel)' });
    }
    assert.equal(f.avatar.clicks, 4); assert.equal(f.messages.length, 0);
    const rejected = await f.send({ type: 'DELTA_ACCOUNT_HISTORY_START', jobId: 'x', account: { key: 'channel:@other' }, range: 'all' });
    assert.equal(rejected.ok, false); assert.equal(f.messages.length, 0);
  } finally { f.close(); }
});

test('foreign, content-page, missing-URL, filtered and search-active probes fail closed', async () => {
  const f = fixture();
  try {
    for (const sender of [{ id: 'other', url: 'chrome-extension://delta-test/panel.html' }, { id: 'delta-test', url: 'https://www.youtube.com/feed/history', tab: { id: 1 } }, { id: 'delta-test' }]) {
      assert.equal((await f.send({ type: 'DELTA_ACCOUNT_HISTORY_PROBE' }, sender)).ok, false);
    }
    f.search.value = 'narrow query'; assert.equal((await f.send({ type: 'DELTA_ACCOUNT_HISTORY_PROBE' })).ready, false);
    f.search.value = ''; f.tab.attributes['aria-label'] = 'Shorts'; assert.equal((await f.send({ type: 'DELTA_ACCOUNT_HISTORY_PROBE' })).ready, false);
    f.tab.attributes['aria-label'] = '全部'; f.window.location.href += '?search_query=restricted'; assert.equal((await f.send({ type: 'DELTA_ACCOUNT_HISTORY_PROBE' })).ready, false);
    assert.equal(f.avatar.clicks, 0); assert.equal(f.messages.length, 0);
  } finally { f.close(); }
});

test('START acknowledges before the first batch; background pause keeps acknowledged rows and stops', async () => {
  const f = fixture();
  try {
    const probe = await f.send({ type: 'DELTA_ACCOUNT_HISTORY_PROBE' });
    let acknowledged = false;
    f.runtime.onSend = () => assert.equal(acknowledged, true);
    f.dispatch({ type: 'DELTA_ACCOUNT_HISTORY_START', jobId: 'job-one', account: probe.account, range: 'all' }, response => { acknowledged = response.started; });
    assert.equal(acknowledged, true);
    const finish = await f.finished(); assert.equal(finish.reason, 'paused');
    assert.equal(f.messages.filter(m => m.type === 'ACCOUNT_HISTORY_BATCH').length, 1);
  } finally { f.close(); }
});

test('account/filter changes after one acknowledged batch stop before further page controls or rows', async () => {
  for (const change of ['account', 'filter']) {
    const f = fixture({ keepGoing: true });
    try {
      f.runtime.onSend = message => { if (message.type === 'ACCOUNT_HISTORY_BATCH') {
        if (change === 'account') f.guide.attributes.href = '/@different-channel'; else f.search.value = 'changed';
      } };
      assert.equal((await f.start()).started, true);
      assert.equal((await f.finished()).reason, change === 'account' ? 'account' : 'paused');
      assert.equal(f.messages.filter(m => m.type === 'ACCOUNT_HISTORY_BATCH').length, 1);
    } finally { f.close(); }
  }
});

test('known range boundary is distinct from stable scrolling and explicit end text', async () => {
  for (const mode of ['range', 'stalled', 'end']) {
    const f = fixture({ sections: [section(mode === 'range' ? '2025年10月11日' : '今天', [card('abcdefghijk', 'Synthetic example')])], keepGoing: true });
    try {
      if (mode === 'end') f.root.set('ytd-message-renderer, yt-formatted-string#message', [new Element('No more videos')]);
      await f.start(mode === 'range' ? { range: 'week', startDate: '2026-10-11' } : {});
      assert.equal((await f.finished()).reason, mode);
      if (mode === 'range') assert.equal(f.messages.flatMap(m => m.rows || []).length, 0);
    } finally { f.close(); }
  }
});

test('Shorts next batch uses only the known native next button and preserves new rendered cards', async () => {
  const first = card('abcdefghijk', 'First short', { short: true }), second = card('lmnopqrstuv', 'Next short', { short: true });
  const group = section('今天', [first]), f = fixture({ sections: [group], keepGoing: true });
  try {
    const button = new Element('', { 'aria-label': '下一批' }), shelf = new Element().set('ytm-shorts-lockup-view-model', [first]).set('h3 a[href]', [new Element('', { href: '/shorts/abcdefghijk' })]);
    button.shelf = shelf; group.set(NEXT, [button]);
    button.onClick = () => { group.querySelector(':scope > #contents').set(CARDS, [first, second]); shelf.set('h3 a[href]', [new Element('', { href: '/shorts/lmnopqrstuv' })]); button.disabled = true; };
    f.root.set('ytd-message-renderer, yt-formatted-string#message', [new Element('No more videos')]);
    await f.start(); assert.equal((await f.finished()).reason, 'end');
    assert.equal(button.clicks, 1); assert.equal(f.messages.flatMap(m => m.rows || []).length, 2);
  } finally { f.close(); }
});

test('unmoving enabled Shorts continuation reports stalled, never a complete end', async () => {
  const first = card('abcdefghijk', 'Short', { short: true }), group = section('今天', [first]);
  const f = fixture({ sections: [group], keepGoing: true });
  try {
    const button = new Element('', { 'aria-label': 'Next batch' }); button.shelf = new Element().set('ytm-shorts-lockup-view-model', [first]); group.set(NEXT, [button]);
    f.root.set('ytd-message-renderer, yt-formatted-string#message', [new Element('No more videos')]);
    await f.start(); assert.equal((await f.finished()).reason, 'stalled'); assert.equal(button.clicks, 1);
  } finally { f.close(); }
});

test('a blocked Shorts shelf does not prevent collecting older regular history', async () => {
  const short = card('abcdefghijk', 'Short', { short: true }), group = section('今天', [short]);
  const f = fixture({ sections: [group], keepGoing: true });
  try {
    f.runtime.onSend = message => { if (message.type === 'ACCOUNT_HISTORY_BATCH' && message.rows.length) f.window.performance.elapsed += 180001; };
    const button = new Element('', { 'aria-label': 'Next batch' }); button.shelf = new Element().set('ytm-shorts-lockup-view-model', [short]); group.set(NEXT, [button]);
    f.window.scrollBy = () => {
      f.root.set('ytd-item-section-renderer', [group, section('昨天', [card('lmnopqrstuv', 'Older regular video')])]);
      f.root.set('ytd-message-renderer, yt-formatted-string#message', [new Element('No more videos')]);
    };
    await f.start(); assert.equal((await f.finished()).reason, 'stalled');
    assert.equal(button.clicks, 1); assert.equal(f.messages.flatMap(m => m.rows || []).length, 2);
  } finally { f.close(); }
});

test('three-minute slice checkpoints retain one consent and acknowledged rows without pause or reprobe', async () => {
  const today = section('今天', [card('abcdefghijk', 'First video')]);
  const f = fixture({ sections: [today], keepGoing: true });
  try {
    f.runtime.onSend = message => {
      if (message.type === 'ACCOUNT_HISTORY_BATCH' && message.rows.length) f.window.performance.elapsed += 180001;
    };
    f.window.scrollBy = () => {
      f.root.set('ytd-item-section-renderer', [today, section('昨天', [card('lmnopqrstuv', 'Older video')])]);
      f.root.set('ytd-message-renderer, yt-formatted-string#message', [new Element('No more videos')]);
    };
    assert.equal((await f.start()).started, true);
    assert.equal((await f.finished()).reason, 'end');
    assert.equal(f.avatar.clicks, 2, 'only the original probe opened and closed the account menu');
    assert.equal(f.messages.filter(message => message.type === 'ACCOUNT_HISTORY_FINISH').length, 1);
    const rows = f.messages.flatMap(message => message.rows || []);
    assert.equal(rows.length, 2, 'acknowledged first-slice rows are not resent');
    assert.deepEqual(rows.map(row => row.videoId), ['abcdefghijk', 'lmnopqrstuv']);
    assert.equal(f.messages.every(message => message.jobId === 'job-one'), true);
  } finally { f.close(); }
});

test('slice boundary still rejects an account change before reading another slice', async () => {
  const f = fixture({ keepGoing: true });
  try {
    f.runtime.onSend = message => {
      if (message.type === 'ACCOUNT_HISTORY_BATCH') {
        f.window.performance.elapsed += 180001;
        f.guide.attributes.href = '/@changed-account';
      }
    };
    await f.start(); assert.equal((await f.finished()).reason, 'account');
    assert.equal(f.messages.filter(message => message.type === 'ACCOUNT_HISTORY_BATCH').length, 1);
    assert.equal(f.avatar.clicks, 2);
  } finally { f.close(); }
});

test('inactivity watchdog interrupts a hung acknowledgement without retrying the failed batch', async () => {
  const f = fixture({ keepGoing: true });
  try {
    // Advance the monotonic clock without waiting 45 real seconds. Fixture
    // timers are compressed; the earlier watchdog interrupts the pending ACK.
    f.runtime.onSend = message => {
      if (message.type === 'ACCOUNT_HISTORY_BATCH') {
        f.window.performance.elapsed += 45001;
        return new Promise(() => {});
      }
    };
    await f.start();
    for (let i = 0; i < 300 && !f.messages.some(m => m.type === 'ACCOUNT_HISTORY_FINISH'); i += 1) await new Promise(resolve => setTimeout(resolve, 2));
    assert.equal(f.messages.find(m => m.type === 'ACCOUNT_HISTORY_FINISH')?.reason, 'timeout');
    assert.equal(f.messages.filter(m => m.type === 'ACCOUNT_HISTORY_BATCH').length, 1);
  } finally { f.close(); }
});

test('STOP releases the active slot before an old FINISH message completes', async () => {
  const f = fixture({ keepGoing: true }); let release;
  try {
    f.runtime.onSend = message => message.type === 'ACCOUNT_HISTORY_FINISH' ? new Promise(resolve => { release = resolve; }) : undefined;
    await f.start();
    assert.equal((await f.send({ type: 'DELTA_ACCOUNT_HISTORY_STOP', jobId: 'job-one' })).stopped, true);
    const probe = await f.send({ type: 'DELTA_ACCOUNT_HISTORY_PROBE' });
    assert.equal(probe.ready, true, 'a fresh probe must not wait for the prior background finish handler');
    for (let n = 0; n < 20 && !release; n += 1) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(typeof release, 'function'); release();
  } finally { release?.(); f.close(); }
});

test('large rendered history is delivered in batches no larger than 500 rows', async () => {
  const entries = Array.from({ length: 1001 }, (_, i) => card(String(i).padStart(11, '0'), `Synthetic video ${i}`));
  const f = fixture({ sections: [section('今天', entries)], keepGoing: true });
  try {
    f.root.set('ytd-message-renderer, yt-formatted-string#message', [new Element('No more videos')]);
    await f.start(); assert.equal((await f.finished()).reason, 'end');
    const batches = f.messages.filter(message => message.type === 'ACCOUNT_HISTORY_BATCH');
    assert.equal(batches.reduce((sum, message) => sum + message.rows.length, 0), 1001);
    assert.equal(Math.max(...batches.map(message => message.rows.length)), 500);
  } finally { f.close(); }
});

test('navigation cancels promptly and stop removes task-owned event/message listeners', async () => {
  const f = fixture({ keepGoing: true });
  try {
    f.runtime.onSend = message => { if (message.type === 'ACCOUNT_HISTORY_BATCH') f.listeners.get('yt-navigate-start')(); };
    await f.start(); assert.equal((await f.finished()).reason, 'navigation');
  } finally { f.close(); }
  assert.equal(f.listeners.size, 0); assert.equal(f.timers.size, 0);
});


test('latest-ten stops at ten distinct rendered videos in page order without reading later cards or scrolling', async () => {
  const values=Array.from({length:10},(_,i)=>card(String(9-i).padStart(11,'0'),`Visible video ${i}`));
  const forbidden=card('zzzzzzzzzzz','Must not read');forbidden.querySelector=()=>assert.fail('Latest ten must not inspect an eleventh card.');
  const f=fixture({sections:[section('今天',[values[0],values[0],...values.slice(1),forbidden])],keepGoing:true});
  try {
    f.window.scrollBy=()=>assert.fail('Latest ten must not scroll the history page.');
    for(const value of values)value.scrollIntoView=()=>assert.fail('Latest ten must not scroll cards.');
    await f.start({range:'latest10'});
    assert.equal((await f.finished()).reason,'limit');
    const batches=f.messages.filter(message=>message.type==='ACCOUNT_HISTORY_BATCH');
    assert.equal(batches.length,1);
    assert.deepEqual(batches[0].rows.map(row=>row.videoId),Array.from({length:10},(_,i)=>String(9-i).padStart(11,'0')));
    assert.deepEqual(batches[0].rows.map(row=>row.pageOrder),Array.from({length:10},(_,i)=>i));
    assert.ok(batches[0].rows.every(row=>!Object.hasOwn(row,'watchedSeconds')));
    assert.equal(f.avatar.clicks,2);
  } finally { f.close(); }
});

test('latest-ten reports fewer visible videos honestly, retains unknown dates, and never opens another Shorts shelf', async () => {
  const first=card('abcdefghijk','First'),second=card('lmnopqrstuv','Second');
  const group=section('An unrecognized date',[first,second]),f=fixture({sections:[group],keepGoing:true});
  try {
    const button=new Element('',{'aria-label':'Next batch'});button.onClick=()=>assert.fail('Latest ten must not open a Shorts continuation.');
    group.set(NEXT,[button]);f.window.scrollBy=()=>assert.fail('Latest ten must not fill missing rows by scrolling.');
    await f.start({range:'latest10'});
    assert.equal((await f.finished()).reason,'visible');
    const rows=f.messages.flatMap(message=>message.rows||[]);
    assert.equal(rows.length,2);assert.ok(rows.every(row=>row.date===null));assert.equal(button.clicks,0);
  } finally { f.close(); }
});

test('latest-ten still stops on an account change after acknowledgement before claiming completion', async () => {
  const f=fixture({keepGoing:true});
  try {
    f.runtime.onSend=message=>{if(message.type==='ACCOUNT_HISTORY_BATCH')f.guide.attributes.href='/@changed-account';};
    await f.start({range:'latest10'});
    assert.equal((await f.finished()).reason,'account');
    assert.equal(f.messages.filter(message=>message.type==='ACCOUNT_HISTORY_BATCH').length,1);
  } finally { f.close(); }
});


test('maximum100 stops before card101 and sends four25-row batches in observed order',async()=>{
  const entries=Array.from({length:100},(_,i)=>card(String(i).padStart(11,'0'),`Rendered video ${i}`));
  const extra=card('zzzzzzzzzzz','Must not inspect');extra.querySelector=()=>assert.fail('Maximum100 must never inspect card101.');
  const f=fixture({sections:[section('今天',[entries[0],entries[0],...entries.slice(1),extra])],keepGoing:true});
  try{
    f.window.scrollBy=()=>assert.fail('100 already rendered videos need no scrolling.');
    await f.start({range:'latest100'});assert.equal((await f.finished()).reason,'limit');
    const batches=f.messages.filter(message=>message.type==='ACCOUNT_HISTORY_BATCH');
    assert.deepEqual(batches.map(message=>message.rows.length),[25,25,25,25]);
    assert.deepEqual(batches.flatMap(message=>message.rows.map(row=>row.pageOrder)),Array.from({length:100},(_,i)=>i));
    assert.equal(f.avatar.clicks,2);
  }finally{f.close();}
});

test('maximum100 loads bounded later rendered batches without activating Shorts continuation',async()=>{
  const entries=Array.from({length:101},(_,i)=>card(String(i).padStart(11,'0'),`Rendered video ${i}`));
  const group=section('Unknown date',entries.slice(0,30)),f=fixture({sections:[group],keepGoing:true});
  try{
    let scrolls=0;
    const button=new Element('',{'aria-label':'Next batch'});button.onClick=()=>assert.fail('Bounded100 must not open a Shorts shelf.');group.set(NEXT,[button]);
    f.window.scrollBy=()=>{scrolls++;group.querySelector(':scope > #contents').set(CARDS,entries.slice(0,Math.min(101,30+scrolls*25)));};
    await f.start({range:'latest100'});assert.equal((await f.finished()).reason,'limit');
    const rows=f.messages.flatMap(message=>message.rows||[]);assert.equal(rows.length,100);assert.equal(scrolls,3);
    assert.ok(rows.every(row=>row.date===null&&!Object.hasOwn(row,'watchedSeconds')));assert.equal(button.clicks,0);
  }finally{f.close();}
});

test('maximum100 deadline saves only acknowledged partial data and stops before another scroll or batch',async()=>{
  const entries=Array.from({length:75},(_,i)=>card(String(i).padStart(11,'0'),`Rendered video ${i}`));
  const f=fixture({sections:[section('今天',entries)],keepGoing:true});
  try{
    f.window.scrollBy=()=>assert.fail('An expired100-video import must not scroll again.');
    f.runtime.onSend=message=>{if(message.type==='ACCOUNT_HISTORY_BATCH')f.window.performance.elapsed=15001;};
    await f.start({range:'latest100'});assert.equal((await f.finished()).reason,'timeout');
    assert.equal(f.messages.filter(message=>message.type==='ACCOUNT_HISTORY_BATCH').length,1);
    assert.equal(f.messages.flatMap(message=>message.rows||[]).length,25);
  }finally{f.close();}
});

test('maximum100 account changes after one acknowledgement stop before a second batch',async()=>{
  const entries=Array.from({length:75},(_,i)=>card(String(i).padStart(11,'0'),`Rendered video ${i}`));
  const f=fixture({sections:[section('今天',entries)],keepGoing:true});
  try{
    f.runtime.onSend=message=>{if(message.type==='ACCOUNT_HISTORY_BATCH')f.guide.attributes.href='/@different-account';};
    await f.start({range:'latest100'});assert.equal((await f.finished()).reason,'account');
    assert.equal(f.messages.flatMap(message=>message.rows||[]).length,25);
  }finally{f.close();}
});

test('maximum100 reaches its12-scroll bound with honest partial completion instead of running forever',async()=>{
  const entries=[card('00000000000','First')],group=section('今天',entries),f=fixture({sections:[group],keepGoing:true});
  try{
    let scrolls=0;f.window.scrollBy=()=>{scrolls++;entries.push(card(String(scrolls).padStart(11,'0'),`Later video ${scrolls}`));group.querySelector(':scope > #contents').set(CARDS,[...entries]);};
    await f.start({range:'latest100'});assert.equal((await f.finished()).reason,'budget');
    assert.equal(scrolls,12);assert.equal(f.messages.flatMap(message=>message.rows||[]).length,13);
  }finally{f.close();}
});

test('modern nested lockup metadata keeps its rendered title while unknown layouts never claim a zero-video success',async()=>{
  const anchor=new Element('A real rendered title',{'href':'/watch?v=abcdefghijk','aria-label':'A real rendered title by Example creator 100 views'});
  const heading=new Element().set('a[href]',[anchor]);
  const lockup=new Element().set('h3[title], h3',[heading]);
  const f=fixture({sections:[section('今天',[lockup])],keepGoing:true});
  try{
    f.root.set('ytd-message-renderer, yt-formatted-string#message',[new Element('No more videos')]);
    await f.start({range:'latest100'});assert.equal((await f.finished()).reason,'end');
    assert.equal(f.messages.find(message=>message.type==='ACCOUNT_HISTORY_BATCH').rows[0].title,'A real rendered title');
  }finally{f.close();}
  for(const range of ['latest10','latest100']){
    const unknown=fixture({sections:[],keepGoing:true});
    try{
      unknown.window.scrollBy=()=>assert.fail('Unknown history structure must fail before scrolling.');
      await unknown.start({range});assert.equal((await unknown.finished()).reason,'unsupported');
      assert.equal(unknown.messages.some(message=>message.type==='ACCOUNT_HISTORY_BATCH'),false);
    }finally{unknown.close();}
  }
});
