import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORE_KEY, applyRecording, createRepository, emptyData, mergeIntervals,
  normalizeData, validVideoId, isYouTubeUrl, youtubeVideoId,
} from './store.js';

const firstId = 'En5cSXgGvZM';
const secondId = 'bxBzsSsqQAM';
const sample = (overrides = {}) => ({ videoId: firstId, title: 'A real video', duration: 120, ranges: [[10, 20]], ...overrides });

function memoryStorage(initial = {}) {
  let values = structuredClone(initial);
  let failure = null;
  return {
    async get(key) { return structuredClone({ [key]: values[key] }); },
    async set(update) {
      if (failure) { const error = failure; failure = null; throw error; }
      values = { ...values, ...structuredClone(update) };
    },
    failNextSet(error = Error('disk unavailable')) { failure = error; },
    snapshot() { return structuredClone(values); },
  };
}

test('fresh or unsupported storage is empty and never seeds the three prototype videos', () => {
  for (const value of [undefined, null, {}, { schemaVersion: 2, videos: { [firstId]: sample() } }]) {
    assert.deepEqual(normalizeData(value), { schemaVersion: 1, recordingEnabled: true, recordingEpoch: 0, goal: '', videos: {} });
  }
  const first = emptyData();
  first.videos[firstId] = sample();
  assert.deepEqual(emptyData().videos, {}, 'fresh instances must not share history');
});

test('interval union clips to real duration, preserves gaps and counts replay once without mutating input', () => {
  const ranges = [[45, 70], [10, 20], [-10, 3], [19, 30], [30, 35], [50, 60], [90, 110], [4, 4], [8, 7], [NaN, 15], [0, Infinity], ['1', 2], [1]];
  const original = structuredClone(ranges);
  assert.deepEqual(mergeIntervals(ranges, 100), [[0, 3], [10, 35], [45, 70], [90, 100]]);
  assert.deepEqual(ranges, original);
  assert.deepEqual(mergeIntervals(null), []);
});

test('normalization keeps arbitrary valid video IDs while dropping corrupt records and unsafe keys', () => {
  const arbitraryId = 'aB_cD-eF123';
  const videos = JSON.parse('{"__proto__":{"duration":100},"invalid":{"duration":100}}');
  videos[arbitraryId] = { title: 'x'.repeat(400), duration: 100, ranges: [[-2, 10], [5, 15], [95, 110]], updatedAt: 42 };
  videos[firstId] = { title: 'broken', duration: Infinity, ranges: [[0, 10]] };
  videos[secondId] = null;
  const data = normalizeData({ schemaVersion: 1, recordingEnabled: false, goal: 'g'.repeat(250), videos });
  assert.deepEqual(Object.keys(data.videos), [arbitraryId]);
  assert.deepEqual(data.videos[arbitraryId], { videoId: arbitraryId, title: 'x'.repeat(300), duration: 100, ranges: [[0, 15], [95, 100]], updatedAt: 42 });
  assert.equal(data.goal.length, 200);
  assert.equal(data.recordingEnabled, false);
  assert.equal(Object.prototype.polluted, undefined);
});

test('normalization preserves a saved recording epoch and defaults old data to epoch zero', () => {
  assert.equal(normalizeData({ schemaVersion: 1, recordingEpoch: 12 }).recordingEpoch, 12);
  assert.equal(normalizeData({ schemaVersion: 1 }).recordingEpoch, 0);
  for (const invalid of [-1, Infinity, NaN, 1.5, '12']) {
    assert.equal(normalizeData({ schemaVersion: 1, recordingEpoch: invalid }).recordingEpoch, 0);
  }
});

test('recording merges watched ranges, preserves unseen gaps and makes a duplicate replay a no-op', () => {
  const original = emptyData();
  const first = applyRecording(original, sample(), 100);
  const second = applyRecording(first, sample({ ranges: [[15, 25], [60, 130]] }), 200);
  assert.deepEqual(second.videos[firstId].ranges, [[10, 25], [60, 120]]);
  assert.equal(second.videos[firstId].updatedAt, 200);
  assert.deepEqual(original.videos, {});
  assert.equal(applyRecording(second, sample({ ranges: [[12, 20], [60, 120]] }), 300), second);
  assert.equal(applyRecording(second, sample({ ranges: [[0, 0]] }), 300), second);
});

test('disabled, invalid and unavailable recordings never fabricate a watched video', () => {
  const initial = emptyData();
  for (const change of [{ videoId: null }, { videoId: 'bad' }, { duration: 0 }, { duration: -1 }, { duration: Infinity }, { duration: NaN }, { ranges: [] }]) {
    assert.equal(applyRecording(initial, sample(change)), initial);
  }
  const paused = { ...initial, recordingEnabled: false };
  assert.equal(applyRecording(paused, sample()), paused);
});

test('YouTube parsing accepts only HTTPS www.youtube.com watch IDs and rejects origin lookalikes', () => {
  assert.equal(validVideoId(firstId), true);
  assert.equal(validVideoId('aB_cD-eF123'), true);
  assert.equal(youtubeVideoId(`https://www.youtube.com/watch?v=${firstId}&t=60s`), firstId);
  assert.equal(isYouTubeUrl('https://www.youtube.com/'), true);
  for (const url of [`http://www.youtube.com/watch?v=${firstId}`, `https://www.youtube.com.evil.test/watch?v=${firstId}`, `https://www.youtube.com@evil.test/watch?v=${firstId}`, `https://m.youtube.com/watch?v=${firstId}`, 'not a URL']) {
    assert.equal(isYouTubeUrl(url), false, url);
    assert.equal(youtubeVideoId(url), null, url);
  }
  assert.equal(youtubeVideoId(`https://www.youtube.com/shorts/${firstId}`), null);
  assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=bad'), null);
});

test('serialized simultaneous writes preserve both videos and settings rather than losing an update', async () => {
  const storage = memoryStorage();
  const repository = createRepository(storage, () => 42);
  const updates = [
    repository.update((before, now) => applyRecording(before, sample(), now)),
    repository.update((before, now) => applyRecording(before, sample({ videoId: secondId, ranges: [[30, 40]] }), now)),
    repository.update((before) => ({ ...before, goal: '了解 AI 產品護城河' })),
    repository.update((before, now) => applyRecording(before, sample({ ranges: [[18, 25]] }), now)),
  ];
  await Promise.all(updates);
  const data = await repository.read();
  assert.deepEqual(Object.keys(data.videos).sort(), [firstId, secondId].sort());
  assert.deepEqual(data.videos[firstId].ranges, [[10, 25]]);
  assert.deepEqual(data.videos[secondId].ranges, [[30, 40]]);
  assert.equal(data.goal, '了解 AI 產品護城河');
  assert.deepEqual(storage.snapshot()[STORE_KEY], data);
});

test('a fresh repository instance reloads persisted intervals and settings after worker restart', async () => {
  const storage = memoryStorage();
  const firstWorker = createRepository(storage, () => 123);
  await firstWorker.update((before, now) => applyRecording(before, sample(), now));
  await firstWorker.update((before) => ({ ...before, goal: 'Make a product', recordingEnabled: false }));
  const restartedWorker = createRepository(storage);
  assert.deepEqual(await restartedWorker.read(), {
    schemaVersion: 1, recordingEnabled: false, recordingEpoch: 0, goal: 'Make a product',
    videos: { [firstId]: { videoId: firstId, title: 'A real video', duration: 120, ranges: [[10, 20]], updatedAt: 123 } },
  });
});

test('a failed save rejects, leaves persisted history unchanged and does not poison later writes', async () => {
  const storage = memoryStorage();
  const repository = createRepository(storage, () => 10);
  await repository.update((before, now) => applyRecording(before, sample(), now));
  storage.failNextSet();
  await assert.rejects(repository.update((before, now) => applyRecording(before, sample({ ranges: [[20, 30]] }), now)), /disk unavailable/);
  assert.deepEqual((await repository.read()).videos[firstId].ranges, [[10, 20]]);
  await repository.update((before, now) => applyRecording(before, sample({ videoId: secondId }), now));
  const data = await repository.read();
  assert.deepEqual(data.videos[firstId].ranges, [[10, 20]]);
  assert.deepEqual(data.videos[secondId].ranges, [[10, 20]]);
});
