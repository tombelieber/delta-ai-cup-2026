import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStudySource } from '../server/study/source.mjs';
import { parseTranscriptRows, readTranscriptRows, installYouTubeTranscript } from './youtube-transcript.js';

const VIDEO = 'abcdefghijk', OTHER = 'lmnopqrstuv';
const rows = [{ time: '0:00', text: 'Revenue records a sale.' }, { time: '0:10', text: 'Cash may arrive later.' },
  { time: '0:20', text: 'Compare profit with cash flow.' }, { time: '5:00', text: 'Outside the selected clip.' }];
class Element {
  constructor(text = '', attrs = {}) { this.textContent = text; this.attrs = attrs; this.queries = new Map(); this.hidden = false; this.clicks = 0; }
  set(selector, values) { this.queries.set(selector, values); return this; }
  querySelectorAll(selector) { return this.queries.get(selector) || []; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  closest() { return null; }
  click() { this.clicks++; this.onClick?.(); }
}
const segment = row => new Element().set('.segment-timestamp', [new Element(row.time)]).set('.segment-text', [new Element(row.text)]);
function fixture({ opened = true, suppliedRows = rows } = {}) {
  const doc = Object.assign(new EventTarget(), new Element());
  doc.queries = new Map(); doc.title = 'Cash flow tutorial - YouTube'; doc.documentElement = new Element();
  for (const name of ['set', 'querySelectorAll', 'querySelector']) doc[name] = Element.prototype[name];
  const watch = new Element('', { 'video-id': VIDEO });
  const video = { duration: 600, readyState: 4 };
  const player = new Element().set('video.html5-main-video', [video]); player.classList = { contains: () => false };
  const root = new Element().set('ytd-transcript-segment-renderer', suppliedRows.map(segment));
  const button = new Element('Show transcript', { 'aria-label': 'Show transcript' });
  doc.set('ytd-watch-flexy[video-id]', [watch]).set('#movie_player', [player])
    .set('ytd-watch-metadata h1', [new Element('Cash flow tutorial')])
    .set('ytd-transcript-renderer', opened ? [root] : [])
    .set('ytd-video-description-transcript-section-renderer button, button[aria-label="Show transcript"], button[aria-label="顯示轉錄稿"], button[aria-label="显示文字稿"]', [button]);
  const observers = new Set(), timers = new Set();
  class Observer {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  }
  const win = Object.assign(new EventTarget(), { location: { href: `https://www.youtube.com/watch?v=${VIDEO}` }, MutationObserver: Observer,
    setTimeout(callback, delay) { const id = setTimeout(() => { timers.delete(id); callback(); }, delay === 10000 ? 30 : delay); timers.add(id); return id; },
    clearTimeout(id) { timers.delete(id); clearTimeout(id); } });
  let listener;
  const runtime = { id: 'delta-test', getURL: path => `chrome-extension://delta-test/${path}`,
    onMessage: { addListener(value) { listener = value; }, removeListener(value) { if (listener === value) listener = null; } } };
  const installed = installYouTubeTranscript({ document: doc, window: win, runtime });
  const emit = () => { for (const observer of [...observers]) observer.callback([]); };
  const sender = { id: runtime.id, url: runtime.getURL('background.js') };
  return { doc, win, root, watch, player, video, button, observers, timers, emit,
    send(message = {}, from = sender) { return new Promise(resolve => listener({ type: 'DELTA_CAPTURE_TRANSCRIPT', videoId: VIDEO, ...message }, from, resolve)); },
    close() { installed.stop(); for (const id of timers) clearTimeout(id); } };
}

test('timestamped excerpt keeps real caption boundaries and excludes out-of-clip text', () => {
  const result = parseTranscriptRows({ videoId: VIDEO, title: 'Cash flow\nlesson', rows, duration: 600 });
  assert.equal(result.start, 0); assert.equal(result.end, 300); assert.equal(result.title, 'Cash flow lesson');
  assert.equal(result.transcript.includes('Outside the selected clip.'), false);
  const source = parseStudySource({ ...result, text: result.transcript });
  assert.equal(source.anchors.map(a => a.text).join(' '), 'Revenue records a sale. Cash may arrive later. Compare profit with cash flow.');
  assert.equal(source.anchors.at(-1).end, 300);
});

test('custom clip preserves full cue boundaries and never includes a cue crossing its end', () => {
  const result = parseTranscriptRows({ videoId: VIDEO, title: 'Clip', duration: 600, start: 35, end: 186,
    rows: [{ time: '0:30', text: 'Before.' }, { time: '0:35', text: 'First.' }, { time: '1:00', text: 'Second.' }, { time: '2:50', text: 'Crosses selected end.' }, { time: '3:10', text: 'After.' }] });
  const source = parseStudySource({ ...result, text: result.transcript });
  assert.deepEqual(source.anchors.map(a => [a.start, a.end, a.text]), [[35, 60, 'First.'], [60, 170, 'Second.']]);
  assert.equal(result.transcript.includes('Crosses selected end.'), false);
});

test('malformed, unordered, conflicting same-time, sparse and oversized captions fail closed', () => {
  const invalid = [
    [{ time: '0:75', text: 'Bad time.' }, ...rows.slice(1)],
    [rows[1], rows[0], rows[2]],
    [rows[0], { time: '0:00', text: 'Conflicting caption.' }, ...rows.slice(1)],
    [rows[0]],
    [{ time: '0:00', text: 'x'.repeat(18001) }, ...rows.slice(1)],
  ];
  for (const values of invalid) assert.throws(() => parseTranscriptRows({ videoId: VIDEO, title: 'Clip', duration: 600, rows: values }));
  for (const limits of [{ start: 0, end: 301 }, { start: -1, end: 3 }, { start: 5, end: 5 }, { start: 0, end: 700 }, { start: 1.5, end: 10 }]) {
    assert.throws(() => parseTranscriptRows({ videoId: VIDEO, title: 'Clip', duration: 600, rows, ...limits }));
  }
});

test('transcript reader uses transcript-owned segments and refuses ambiguous visible panels', () => {
  const f = fixture();
  try {
    f.doc.set('ytd-transcript-segment-renderer', [segment({ time: '0:00', text: 'Unrelated outside panel.' })]);
    assert.deepEqual(readTranscriptRows(f.doc), rows);
    f.doc.set('ytd-transcript-renderer', [f.root, new Element()]);
    assert.throws(() => readTranscriptRows(f.doc), /transcript/i);
  } finally { f.close(); }
});

test('explicit trusted capture returns the current video without opening an existing transcript', async () => {
  const f = fixture();
  try {
    const value = await f.send();
    assert.equal(value.ok, true); assert.equal(value.videoId, VIDEO); assert.equal(value.url, `https://www.youtube.com/watch?v=${VIDEO}`);
    assert.equal(f.button.clicks, 0); assert.equal(f.observers.size, 0); assert.equal(f.timers.size, 0);
  } finally { f.close(); }
});

test('closed transcript opens only its visible native control and waits for a DOM mutation', async () => {
  const f = fixture({ opened: false });
  try {
    f.button.onClick = () => { queueMicrotask(() => { f.doc.set('ytd-transcript-renderer', [f.root]); f.emit(); }); };
    const result = await f.send();
    assert.equal(result.ok, true); assert.equal(f.button.clicks, 1); assert.equal(f.observers.size, 0); assert.equal(f.timers.size, 0);
  } finally { f.close(); }
});

test('foreign, content-script and missing sender identities cannot read or click transcript', async () => {
  const f = fixture({ opened: false });
  try {
    const senders = [{ id: 'foreign', url: 'chrome-extension://delta-test/panel.html' }, { id: 'delta-test', url: 'https://www.youtube.com/watch?v=abcdefghijk', tab: { id: 1 } }, { id: 'delta-test' }, { id: 'delta-test', url: 'chrome-extension://delta-test.evil/panel.html' }];
    for (const from of senders) assert.equal((await f.send({}, from)).ok, false);
    assert.equal(f.button.clicks, 0); assert.equal(f.observers.size, 0);
  } finally { f.close(); }
});

test('mismatched watch identity, duplicate video query and ads reject before native controls', async () => {
  for (const mutate of [f => { f.watch.attrs['video-id'] = OTHER; }, f => { f.win.location.href += `&v=${OTHER}`; }, f => { f.player.classList.contains = name => name === 'ad-showing'; }]) {
    const f = fixture({ opened: false });
    try { mutate(f); assert.equal((await f.send()).ok, false); assert.equal(f.button.clicks, 0); }
    finally { f.close(); }
  }
});

test('navigation while transcript loads aborts without returning captions or retaining observers', async () => {
  const f = fixture({ opened: false });
  try {
    const pending = f.send();
    f.win.location.href = `https://www.youtube.com/watch?v=${OTHER}`;
    f.doc.dispatchEvent(new Event('yt-navigate-start'));
    const value = await pending;
    assert.equal(value.ok, false); assert.equal(value.code, 'transcript_navigation'); assert.equal(value.transcript, undefined);
    assert.equal(f.observers.size, 0); assert.equal(f.timers.size, 0);
  } finally { f.close(); }
});

test('missing controls, timed-out rows and runtime disposal fail with no caption payload', async () => {
  for (const mode of ['missing', 'timeout', 'stop']) {
    const f = fixture({ opened: false });
    try {
      if (mode === 'missing') f.button.hidden = true;
      const pending = f.send();
      if (mode === 'stop') f.close();
      const value = await pending;
      assert.equal(value.ok, false); assert.equal(value.transcript, undefined); assert.equal(f.observers.size, 0); assert.equal(f.timers.size, 0);
    } finally { f.close(); }
  }
});
