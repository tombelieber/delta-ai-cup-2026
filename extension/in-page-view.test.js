import test from 'node:test';
import assert from 'node:assert/strict';
import { projectInPageView } from './in-page-view.js';
import { emptyData } from './store.js';

const cursorId = 'En5cSXgGvZM';
const ycId = 'bxBzsSsqQAM';
const otherId = 'abcdefghijk';
const video = (videoId, ranges, overrides = {}) => ({ videoId, title: `Stored ${videoId}`, duration: 4000, ranges, updatedAt: 123, ...overrides });
const dataWith = (...videos) => ({ ...emptyData(), videos: Object.fromEntries(videos.map((item) => [item.videoId, item])) });

test('blank durable storage never seeds fixture coverage or a current video', () => {
  const view = projectInPageView(undefined, null);
  assert.equal(view.videoId, null);
  assert.equal(view.title, '');
  assert.equal(view.duration, 0);
  assert.equal(view.currentTime, 0);
  assert.equal(view.updatedAt, 0);
  assert.deepEqual(view.ranges, []);
  assert.equal(view.recordingEnabled, true);
  assert.equal(view.status, 'waiting');
  assert.equal(view.loading, false);
  assert.equal(view.error, '');
  assert.equal(view.route.watchedSeconds, 0);
  assert.equal(view.route.completedSteps, 0);
  assert.equal(view.route.next.episodeId, 'cursor');
});

test('current durable ranges merge and clip to content duration while skipped gaps remain', () => {
  const data = dataWith(video(cursorId, [[-5, 8], [3, 12], [40, 50], [45, 70], [100, 110], [5, 5], [NaN, 20]]));
  const view = projectInPageView(data, { videoId: cursorId, duration: 60, currentTime: 55, title: ' Live title ', status: 'playing', updatedAt: 999 });
  assert.deepEqual(view.ranges, [[0, 12], [40, 60]]);
  assert.equal(view.title, 'Live title');
  assert.equal(view.duration, 60);
  assert.equal(view.currentTime, 55);
  assert.equal(view.updatedAt, 123, 'a live heartbeat is not a saved-record timestamp');
  assert.equal(view.status, 'playing');
});

test('a live playhead and incoming ranges cannot fabricate durable watched intervals', () => {
  const view = projectInPageView(emptyData(), { videoId: cursorId, duration: 4000, currentTime: 2500, status: 'playing', ranges: [[0, 2500]], updatedAt: 999 });
  assert.deepEqual(view.ranges, []);
  assert.equal(view.route.watchedSeconds, 0);
  assert.equal(view.updatedAt, 0);
  assert.equal(view.currentTime, 2500);
});

test('only current metadata and fixed-route coverage are exposed, never unrelated history or goals', () => {
  const data = { ...dataWith(video(cursorId, [[2325, 2335]]), video(ycId, [[1170, 1200]]), video(otherId, [[0, 1000]], { title: 'Private unrelated title' })), goal: 'Private learning goal' };
  const view = projectInPageView(data, { videoId: cursorId, status: 'paused' });
  assert.deepEqual(Object.keys(view).sort(), ['videoId', 'title', 'duration', 'ranges', 'recordingEnabled', 'status', 'currentTime', 'updatedAt', 'error', 'loading', 'route'].sort());
  assert.equal(view.route.watchedSeconds, 40);
  assert.deepEqual(Object.keys(view.route).sort(), ['totalSeconds', 'watchedSeconds', 'remainingSeconds', 'completedSteps', 'totalSteps', 'percent', 'complete', 'next'].sort());
  assert.equal('steps' in view.route, false, 'route must not expose other videos exact covered ranges or gaps');
  assert.equal(view.route.next.time, 2335);
  assert.equal(JSON.stringify(view).includes('Private'), false);
  assert.equal(JSON.stringify(view).includes(otherId), false);
  const withoutOther = dataWith(data.videos[cursorId], data.videos[ycId]);
  assert.deepEqual(view.route, projectInPageView(withoutOther, null).route);
});

test('an unknown current video can show its own saved intervals without adding route coverage', () => {
  const data = dataWith(video(otherId, [[10, 20]]), video(cursorId, [[100, 200]]));
  const view = projectInPageView(data, { videoId: otherId, status: 'paused' });
  assert.equal(view.videoId, otherId);
  assert.deepEqual(view.ranges, [[10, 20]]);
  assert.equal(view.route.watchedSeconds, 0);
  assert.equal(JSON.stringify(view).includes(cursorId), false);
});

test('invalid and absent live IDs never select stored history or leak current metadata', () => {
  const data = dataWith(video(cursorId, [[2325, 2335]]));
  for (const videoId of [null, undefined, '', cursorId + '/other', {}, 12]) {
    const view = projectInPageView(data, { videoId, title: 'Invalid title', duration: 100, currentTime: 20 });
    assert.equal(view.videoId, null);
    assert.equal(view.title, '');
    assert.equal(view.duration, 0);
    assert.equal(view.currentTime, 0);
    assert.equal(view.updatedAt, 0);
    assert.deepEqual(view.ranges, []);
    assert.equal(view.route.watchedSeconds, 10, 'route is independently derived from durable fixed chapters');
  }
});

test('ads and unavailable playback preserve content duration and saved ranges', () => {
  const data = dataWith(video(cursorId, [[2325, 2335], [2400, 2410]], { duration: 5000 }));
  for (const status of ['ad', 'unavailable']) {
    const view = projectInPageView(data, { videoId: cursorId, status, duration: 30, currentTime: 2 });
    assert.equal(view.duration, 5000);
    assert.deepEqual(view.ranges, [[2325, 2335], [2400, 2410]]);
    assert.equal(view.route.watchedSeconds, 20);
  }
  assert.equal(projectInPageView(emptyData(), { videoId: cursorId, status: 'ad', duration: 30 }).duration, 0);
});

test('malformed presentation values are sanitized and valid saved metadata is used as fallback', () => {
  const data = { ...dataWith(video(cursorId, [[10, 20]], { title: 'Stored fallback' })), recordingEnabled: false };
  const view = projectInPageView(data, { videoId: cursorId, title: '  ', duration: NaN, currentTime: -30, status: 'made-up' });
  assert.equal(view.title, 'Stored fallback');
  assert.equal(view.duration, 4000);
  assert.equal(view.currentTime, 0);
  assert.equal(view.status, 'waiting');
  assert.equal(view.recordingEnabled, false);
  assert.equal(projectInPageView(data, { videoId: cursorId, duration: 50, currentTime: 99, title: 'x'.repeat(500) }).title.length, 300);
  assert.equal(projectInPageView(data, { videoId: cursorId, duration: 50, currentTime: 99 }).currentTime, 50);
});

test('projection does not mutate input and output interval changes cannot mutate saved history', () => {
  const data = dataWith(video(cursorId, [[2340, 2350], [2325, 2345]]));
  const live = { videoId: cursorId, status: 'playing', currentTime: 2350, duration: 4000 };
  const before = structuredClone({ data, live });
  const view = projectInPageView(data, live);
  assert.deepEqual({ data, live }, before);
  view.ranges[0][0] = 0;
  view.route.next.time = 0;
  assert.deepEqual({ data, live }, before);
});
