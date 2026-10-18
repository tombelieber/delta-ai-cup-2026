import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackTracker } from './tracker.js';

const base = {
  videoId: 'En5cSXgGvZM', currentTime: 10, duration: 100,
  playbackRate: 1, paused: false, seeking: false, ended: false,
  readyState: 4, ad: false, now: 1_000,
};

function fixture() {
  const ranges = [];
  const tracker = createPlaybackTracker({ onRange: (range) => ranges.push(range) });
  const sample = (overrides = {}) => tracker.sample({ ...base, ...overrides });
  return { tracker, sample, ranges };
}

test('continuous playback emits only observed content time, including final pause tail', () => {
  const { sample, ranges } = fixture();
  assert.equal(sample(), null);
  assert.deepEqual(sample({ currentTime: 10.5, now: 1_500 }), { videoId: base.videoId, start: 10, end: 10.5 });
  sample({ currentTime: 10.8, now: 1_800, paused: true });
  sample({ currentTime: 10.8, now: 5_000, paused: true });
  sample({ currentTime: 10.8, now: 5_100 });
  sample({ currentTime: 11.3, now: 5_600 });
  assert.deepEqual(ranges.map(({ start, end }) => [start, end]), [[10, 10.5], [10.5, 10.8], [10.8, 11.3]]);
});

test('seek events and silent forward/backward jumps never fill their gaps', () => {
  const { sample, ranges } = fixture();
  sample();
  sample({ currentTime: 40, now: 1_200, seeking: true });
  sample({ currentTime: 40, now: 1_300 });
  sample({ currentTime: 40.5, now: 1_800 });
  sample({ currentTime: 80, now: 2_300 });
  sample({ currentTime: 80.5, now: 2_800 });
  sample({ currentTime: 5, now: 3_300 });
  sample({ currentTime: 5.5, now: 3_800 });
  assert.deepEqual(ranges.map(({ start, end }) => [start, end]), [[40, 40.5], [80, 80.5], [5, 5.5]]);
});

test('reset on a discontinuity establishes a fresh baseline', () => {
  const { sample, ranges, tracker } = fixture();
  sample();
  tracker.reset();
  sample({ currentTime: 10.6, now: 1_500 });
  sample({ currentTime: 11.1, now: 2_000 });
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].start, 10.6);
});

test('2x counts video seconds, while a rate transition itself contributes no gap', () => {
  const { sample, ranges } = fixture();
  sample({ playbackRate: 2 });
  sample({ playbackRate: 2, currentTime: 11, now: 1_500 });
  sample({ playbackRate: 1, currentTime: 11.5, now: 2_000 });
  sample({ playbackRate: 1, currentTime: 12, now: 2_500 });
  assert.deepEqual(ranges.map(({ start, end }) => [start, end]), [[10, 11], [11.5, 12]]);
});

test('buffering and insufficient readyState break continuity without counting stalled time', () => {
  const { sample, ranges } = fixture();
  sample();
  sample({ currentTime: 10.2, now: 1_500, readyState: 2 });
  sample({ currentTime: 10.2, now: 2_000, readyState: 2 });
  sample({ currentTime: 10.2, now: 2_500 });
  sample({ currentTime: 10.7, now: 3_000 });
  sample({ currentTime: 10.7, now: 3_500 });
  assert.deepEqual(ranges.map(({ start, end }) => [start, end]), [[10.2, 10.7]]);
});

test('ad boundaries do not record the advertisement or connect its playhead to content', () => {
  const { sample, ranges } = fixture();
  sample();
  sample({ currentTime: 0, duration: 15, ad: true, now: 1_500 });
  sample({ currentTime: 0.5, duration: 15, ad: true, now: 2_000 });
  sample({ currentTime: 10, now: 2_500 });
  sample({ currentTime: 10.5, now: 3_000 });
  assert.deepEqual(ranges.map(({ start, end }) => [start, end]), [[10, 10.5]]);
});

test('navigation changes the video ID without connecting two videos', () => {
  const { sample, ranges } = fixture();
  sample();
  sample({ videoId: 'bxBzsSsqQAM', currentTime: 10.5, now: 1_500 });
  sample({ videoId: 'bxBzsSsqQAM', currentTime: 11, now: 2_000 });
  assert.deepEqual(ranges, [{ videoId: 'bxBzsSsqQAM', start: 10.5, end: 11 }]);
});

test('same-ID player metadata replacement starts a new observation', () => {
  const { sample, ranges } = fixture();
  sample();
  sample({ duration: 200, currentTime: 10.5, now: 1_500 });
  sample({ duration: 200, currentTime: 11, now: 2_000 });
  assert.deepEqual(ranges.map(({ start, end }) => [start, end]), [[10.5, 11]]);
});

test('long timer suspension, nonmonotonic clocks, and duplicate timestamps do not fabricate ranges', () => {
  const { sample, ranges } = fixture();
  sample();
  sample({ currentTime: 40, now: 31_000 });
  sample({ currentTime: 40.5, now: 31_500 });
  sample({ currentTime: 41, now: 31_500 });
  sample({ currentTime: 41.5, now: 31_400 });
  sample({ currentTime: 42, now: 31_900 });
  assert.deepEqual(ranges.map(({ start, end }) => [start, end]), [[40, 40.5], [41.5, 42]]);
});

test('invalid/live duration and corrupt observations clear the baseline', () => {
  for (const invalid of [{ duration: Infinity }, { duration: 0 }, { duration: NaN },
    { currentTime: NaN }, { currentTime: -1 }, { videoId: '' }, { now: NaN }, { playbackRate: 0 }]) {
    const { sample, ranges } = fixture();
    sample();
    sample({ ...invalid, now: invalid.now ?? 1_250 });
    sample({ currentTime: 10.5, now: 1_500 });
    sample({ currentTime: 11, now: 2_000 });
    assert.deepEqual(ranges.map(({ start, end }) => [start, end]), [[10.5, 11]], JSON.stringify(invalid));
  }
});

test('duration is a hard upper bound and ended closes the last observed tail', () => {
  const { sample, ranges } = fixture();
  sample({ currentTime: 99.7 });
  sample({ currentTime: 100.2, now: 1_500, paused: true, ended: true });
  sample({ currentTime: 100.2, now: 2_000, paused: true, ended: true });
  assert.deepEqual(ranges.map(({ start, end }) => [start, end]), [[99.7, 100]]);
});

test('replayed intervals are emitted for storage union, never manufactured from unseen gaps', () => {
  const { sample, ranges } = fixture();
  sample();
  sample({ currentTime: 10.5, now: 1_500 });
  sample({ currentTime: 10, now: 2_000 });
  sample({ currentTime: 10.5, now: 2_500 });
  assert.deepEqual(ranges.map(({ start, end }) => [start, end]), [[10, 10.5], [10, 10.5]]);
});

test('background playback has the same observations and requires no document visibility input', () => {
  const { sample, ranges } = fixture();
  sample({ hidden: true });
  sample({ currentTime: 10.5, now: 1_500, hidden: true });
  assert.equal(ranges.length, 1);
});
