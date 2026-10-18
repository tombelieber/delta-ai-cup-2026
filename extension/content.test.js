import test from 'node:test';
import assert from 'node:assert/strict';
import { createYouTubeRecorder } from './content.js';
import { emptyData, applyRecording } from './store.js';

const A = 'En5cSXgGvZM', B = 'bxBzsSsqQAM';
const settle = () => new Promise(setImmediate);
async function harness() {
  let now = 0, data = emptyData(), fail = false, gate = null;
  const video = Object.assign(new EventTarget(), { currentTime: 0, duration: 600, playbackRate: 1, readyState: 4, paused: true, seeking: false, ended: false });
  const doc = Object.assign(new EventTarget(), { title: 'Actual video - YouTube', hidden: false, watchId: A, ad: false, isLive: false, video });
  const player = { querySelector: () => doc.video, classList: { contains: (name) => doc.ad && name === 'ad-showing' || doc.isLive && name === 'ytp-live' } };
  doc.querySelector = (selector) => selector === '#movie_player' ? player : selector === 'ytd-watch-flexy[video-id]' ? { getAttribute: () => doc.watchId } : selector === 'ytd-watch-metadata h1' ? { textContent: 'Actual video' } : null;
  const win = Object.assign(new EventTarget(), { location: { href: `https://www.youtube.com/watch?v=${A}` }, setInterval: () => 1, clearInterval: () => {} });
  const messages = [];
  const runtime = { async sendMessage(message) {
    messages.push(structuredClone(message));
    if (gate) { const waiting = gate; gate = null; await waiting; }
    if (fail) throw Error('storage unavailable');
    if (message.sample.epoch === data.recordingEpoch) data = applyRecording(data, message.sample, now);
    return { ok: true, enabled: data.recordingEnabled, epoch: data.recordingEpoch };
  } };
  const recorder = createYouTubeRecorder({ document: doc, window: win, runtime, clock: () => now });
  await settle();
  return { doc, win, video, recorder, messages, get data() { return data; }, setData: (value) => { data = value; }, setFailure: (value) => { fail = value; },
    holdNext() { let release; gate = new Promise((resolve) => { release = resolve; }); return release; },
    async advance(ms, position) { now += ms; doc.video.currentTime = position; recorder.tick(); await settle(); },
    async event(type, target = doc.video) { target.dispatchEvent(new Event(type)); await settle(); },
    async flush() { await recorder.flush(); await settle(); } };
}

test('real adapter records playback, final pause tail, and reload reads persisted ranges', async () => {
  const h = await harness();
  assert.deepEqual(h.data.videos, {});
  h.video.paused = false; await h.event('play');
  await h.advance(500, .5); await h.advance(500, 1); await h.advance(500, 1.5);
  h.video.currentTime = 1.6; await h.advance(100, 1.6); h.video.paused = true; await h.event('pause'); await h.flush();
  assert.deepEqual(h.data.videos[A].ranges, [[0, 1.6]]);
  const persisted = JSON.parse(JSON.stringify(h.data));
  h.recorder.stop();
  const reopened = await harness(); reopened.setData(persisted);
  await reopened.advance(1000, 0); await reopened.flush();
  assert.deepEqual(reopened.data.videos[A].ranges, [[0, 1.6]]);
  reopened.recorder.stop();
});

test('seek gaps stay missing and replay does not increase union coverage', async () => {
  const h = await harness(); h.video.paused = false; await h.event('play');
  await h.advance(1000, 1); await h.flush();
  h.video.seeking = true; h.video.currentTime = 50; await h.event('seeking');
  h.video.seeking = false; await h.event('seeked');
  await h.advance(1000, 51); await h.flush();
  assert.deepEqual(h.data.videos[A].ranges, [[0, 1], [50, 51]]);
  h.video.seeking = true; h.video.currentTime = 0; await h.event('seeking');
  h.video.seeking = false; await h.event('seeked');
  await h.advance(1000, 1); await h.flush();
  assert.deepEqual(h.data.videos[A].ranges, [[0, 1], [50, 51]]);
  h.recorder.stop();
});

test('SPA with reused video waits for new metadata and never assigns old timeline to new ID', async () => {
  const h = await harness(); h.video.paused = false; await h.event('play');
  await h.advance(1000, 1); await h.flush();
  await h.event('yt-navigate-start', h.doc);
  h.win.location.href = `https://www.youtube.com/watch?v=${B}`; h.doc.watchId = B;
  await h.event('yt-navigate-finish', h.doc);
  await h.advance(1000, 2); await h.flush();
  assert.equal(h.data.videos[B], undefined);
  h.video.currentTime = 0; h.video.duration = 300; await h.event('loadedmetadata');
  await h.advance(1000, 1); await h.flush();
  assert.deepEqual(h.data.videos[B].ranges, [[0, 1]]);
  h.recorder.stop();
});

test('metadata before SPA URL update is retained rather than waiting forever', async () => {
  const h = await harness(); h.video.paused = false; await h.event('play');
  await h.event('yt-navigate-start', h.doc);
  h.video.currentTime = 0; h.video.duration = 300; await h.event('loadedmetadata');
  h.win.location.href = `https://www.youtube.com/watch?v=${B}`; h.doc.watchId = B;
  await h.event('yt-navigate-finish', h.doc);
  await h.advance(1000, 1); await h.flush();
  assert.deepEqual(h.data.videos[B].ranges, [[0, 1]]);
  h.recorder.stop();
});

test('same-video timestamp navigation resumes without requiring new metadata', async () => {
  const h = await harness(); h.video.paused = false; await h.event('play');
  await h.advance(1000, 1); await h.flush();
  await h.event('yt-navigate-start', h.doc);
  h.win.location.href += '&t=50'; h.video.currentTime = 50;
  await h.event('yt-navigate-finish', h.doc);
  await h.advance(1000, 51); await h.flush();
  assert.deepEqual(h.data.videos[A].ranges, [[0, 1], [50, 51]]);
  h.recorder.stop();
});

test('ads and buffering excluded; background podcast playback remains enabled', async () => {
  const h = await harness(); h.video.paused = false; await h.event('play');
  await h.advance(1000, 1);
  h.doc.ad = true; h.video.duration = 30; await h.advance(500, 0); await h.advance(1000, 1);
  h.doc.ad = false; h.video.duration = 600; await h.advance(500, 1); await h.advance(1000, 2);
  h.video.readyState = 2; await h.advance(500, 2); await h.advance(1000, 3);
  h.video.readyState = 4; await h.advance(500, 3);
  h.doc.hidden = true; await h.event('visibilitychange', h.doc);
  await h.advance(1000, 4); await h.flush();
  assert.deepEqual(h.data.videos[A].ranges, [[0, 2], [3, 4]]);
  h.recorder.stop();
});

test('recording off stops persisted coverage and resume starts with a fresh baseline', async () => {
  const h = await harness(); h.video.paused = false; await h.event('play');
  await h.advance(1000, 1); await h.flush();
  h.setData({ ...h.data, recordingEnabled: false });
  await h.advance(1000, 2); await h.advance(1000, 3); await h.flush();
  assert.deepEqual(h.data.videos[A].ranges, [[0, 1]]);
  h.setData({ ...h.data, recordingEnabled: true });
  await h.advance(1000, 4); await h.advance(1000, 5); await h.advance(1000, 6); await h.flush();
  assert.deepEqual(h.data.videos[A].ranges, [[0, 1], [5, 6]]);
  h.recorder.stop();
});

test('failed write retains pending intervals for an acknowledged retry', async () => {
  const h = await harness(); h.video.paused = false; await h.event('play');
  h.setFailure(true); await h.advance(1000, 1); await h.flush();
  assert.equal(h.data.videos[A], undefined);
  h.setFailure(false); await h.advance(1000, 2); await h.flush();
  assert.deepEqual(h.data.videos[A].ranges, [[0, 2]]);
  h.recorder.stop();
});

test('pagehide drains a final tail while an earlier storage acknowledgement is pending', async () => {
  const h = await harness(); h.video.paused = false; await h.event('play');
  const release = h.holdNext();
  await h.advance(1000, 1); await h.advance(500, 1.5);
  await h.event('pagehide', h.win);
  release(); await settle(); await h.flush();
  assert.deepEqual(h.data.videos[A].ranges, [[0, 1.5]]);
  h.recorder.stop();
});

test('fast off/on rejects stale batches from the previous recording generation', async () => {
  const h = await harness(); h.video.paused = false; await h.event('play');
  await h.advance(1000, 1); await h.flush();
  h.setData({ ...h.data, recordingEpoch: 2 }); // off then on before the next handshake
  await h.advance(1000, 2); await h.flush();
  assert.deepEqual(h.data.videos[A].ranges, [[0, 1]]);
  await h.advance(1000, 3); await h.advance(1000, 4); await h.flush();
  assert.deepEqual(h.data.videos[A].ranges, [[0, 1], [3, 4]]);
  h.recorder.stop();
});

test('YouTube home hover preview does not become a watched video', async () => {
  const h = await harness(); h.win.location.href = 'https://www.youtube.com/';
  h.video.paused = false; await h.advance(1000, 1); await h.advance(1000, 2); await h.flush();
  assert.deepEqual(h.data.videos, {}); assert.equal(h.recorder.getLive().videoId, null);
  h.recorder.stop();
});

test('DVR live player is excluded even when it exposes a finite duration', async () => {
  const h = await harness(); h.doc.isLive = true; h.video.paused = false;
  await h.event('play'); await h.advance(1000, 1); await h.advance(1000, 2); await h.flush();
  assert.deepEqual(h.data.videos, {}); assert.equal(h.recorder.getLive().status, 'unavailable');
  h.recorder.stop();
});
