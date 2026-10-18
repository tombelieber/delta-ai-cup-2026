import test from 'node:test';
import assert from 'node:assert/strict';
import { LEARNING_PILOT, learningSourceVideo } from './learning-source.js';

test('reviewed SUMIF lesson starts at the verified clip even when actual playback has reached another topic', () => {
  const video = { videoId: LEARNING_PILOT.videoId, url: LEARNING_PILOT.url, title: 'SUMIF and SUMIFS', currentTime: 700, duration: 900, watchedRanges: [[680, 700]] };
  const source = learningSourceVideo(video);
  assert.equal(source.start, 35); assert.equal(source.end, 186);
  assert.equal(source.currentTime, 700);
  assert.deepEqual(source.watchedRanges, [[680, 700]]);
  assert.equal(Object.hasOwn(video, 'start'), false, 'lesson defaults must not mutate the tracking view');
});
test('unsupported video metadata and observed ranges are retained without substituting pilot playback', () => {
  const video = { videoId: 'En5cSXgGvZM', url: 'https://www.youtube.com/watch?v=En5cSXgGvZM', currentTime: 42, duration: 4000, watchedRanges: [[10, 20], [40, 42]] };
  assert.deepEqual(learningSourceVideo(video), video);
  assert.deepEqual(learningSourceVideo(null), {});
});
