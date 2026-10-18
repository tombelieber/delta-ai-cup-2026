import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SHARED_TOPICS, canShareUniverseFile, createShareSummary, shareableTopics, shareUniverseFile, universeCardFilename } from './share-universe.js';

const video = (videoId, extra = {}) => ({ videoId, title: `Private title ${videoId}`, url: `https://youtube.com/watch?v=${videoId}`,
  account: 'private@example.com', date: '2026-10-18', watchedSeconds: 999, ...extra });
const node = (id, label, records, children = [], extra = {}) => ({ id, label, records, children, count: 99999, ...extra });

test('public summary is an aggregate allowlist and never contains history or account details', () => {
  const record = video('abcdefghijk', { tasks: [{ taskId: 'task-a', total: 900, formula: 'private formula', checkedAt: '2026-10-18T01:00:00Z' }] });
  const map = { account: 'Private account', records: [record], children: [node('ai', 'AI tools', [record])] };
  const summary = createShareSummary(map, { includePractice: true, timeRangeLabel: 'This month' });
  assert.deepEqual(summary, { schemaVersion: 1, title: 'My YouTube Universe', timeRangeLabel: 'This month',
    videosExplored: 1, topicCount: 1, topics: [{ label: 'AI tools', videosExplored: 1 }], checkedPractice: 1 });
  for (const privateValue of ['abcdefghijk', 'Private title', 'private@example.com', 'Private account', 'youtube.com', '2026-10-18', 'private formula', 'task-a', 'watchedSeconds']) assert.equal(JSON.stringify(summary).includes(privateValue), false);
  assert.equal(Object.hasOwn(summary.topics[0], 'id'), false);
  assert.equal(Object.hasOwn(createShareSummary(map), 'checkedPractice'), false, 'practice is opt-in');
});

test('default selection keeps actual ranking, excludes unresolved records and caps six topics', () => {
  const children = [node('unresolved', 'More to explore', [video('unclassified')]),
    ...Array.from({ length: 8 }, (_, index) => node(`topic-${index}`, `Topic ${index}`, [video(`video-${index}`)]))];
  const map = { children };
  assert.equal(shareableTopics(map).length, 8);
  const summary = createShareSummary(map);
  assert.equal(summary.topicCount, MAX_SHARED_TOPICS);
  assert.deepEqual(summary.topics.map(item => item.label), Array.from({ length: 6 }, (_, index) => `Topic ${index}`));
  assert.equal(summary.videosExplored, 6, 'does not use fabricated node.count or the full root history count');
  assert.equal(createShareSummary(map, { selectedIds: ['unresolved'] }).videosExplored, 0);
});

test('explicit topic and subtopic selections deduplicate records and overlapping task evidence', () => {
  const a = video('video-a', { checkedTasks: 1, tasks: [{ taskId: 'a', total: 900 }] });
  const aDuplicate = video('video-a', { checkedTasks: 1, tasks: [{ taskId: 'a', total: 900 }, { taskId: 'b', total: 650 }] });
  const b = video('video-b');
  const child = node('claude', 'Claude Code', [aDuplicate]);
  const parent = node('ai', 'AI tools', [a, b], [child]);
  const map = { children: [parent], nodes: [parent, child], records: [a, b] };
  const summary = createShareSummary(map, { selectedIds: ['ai', 'claude', 'ai', 'missing'], includePractice: true });
  assert.equal(summary.topicCount, 2); assert.equal(summary.videosExplored, 2); assert.equal(summary.checkedPractice, 2);
  assert.deepEqual(summary.topics, [{ label: 'AI tools', videosExplored: 2 }, { label: 'Claude Code', videosExplored: 1 }]);
  assert.deepEqual(parent.records, [a, b], 'does not mutate the map');
});

test('no evidence means no learning claim; numeric checked counts and valid task evidence are scoped', () => {
  const records = [video('a', { learningStarted: true, hasLesson: true, passed: true }),
    video('b', { tasks: [{ taskId: 'unfinished' }, { taskId: 'failed', total: 0, passed: false }, { taskId: 'flag-only', passed: true }] }),
    video('c', { checkedTasks: -2 }), video('d', { checkedTasks: 1.2 })];
  const map = { children: [node('topic', 'Curiosity', records)] };
  assert.equal(Object.hasOwn(createShareSummary(map, { includePractice: true }), 'checkedPractice'), false);
  map.children[0].records.push(video('e', { checkedTasks: 2 }), video('f', { tasks: [{ taskId: 'checked', total: 0 }] }));
  assert.equal(createShareSummary(map, { includePractice: true }).checkedPractice, 3);
});

test('empty, invalid and explicitly cleared selections never fall back to sharing the whole history', () => {
  assert.equal(createShareSummary(null).videosExplored, 0);
  const map = { children: [node('topic', 'Topic', [video('private')])] };
  assert.equal(createShareSummary(map, { selectedIds: [] }).topicCount, 0);
  assert.equal(createShareSummary(map, { selectedIds: null }).topicCount, 0);
  assert.equal(createShareSummary(map, { selectedIds: ['missing'] }).topicCount, 0);
  assert.equal(createShareSummary({ children: [node('hidden', 'Something else', [video('x')], [], { unresolved: true })] }).topicCount, 0);
});

test('native share receives only the prepared image and title after a deliberate call', async () => {
  const file = { name: 'my-youtube-universe-square.png' }, calls = [];
  const nav = { canShare: value => value.files[0] === file, share: async value => calls.push(value) };
  assert.equal(canShareUniverseFile(file, nav), true); assert.equal(calls.length, 0);
  await shareUniverseFile(file, { navigator: nav });
  assert.deepEqual(calls, [{ files: [file], title: 'My YouTube Universe' }]);
  assert.equal(canShareUniverseFile(file, { canShare() { throw new Error('unsupported'); }, share() {} }), false);
  await assert.rejects(shareUniverseFile(file, { navigator: {} }), /Download image/);
  assert.equal(universeCardFilename('story'), 'my-youtube-universe-story.png');
  assert.equal(universeCardFilename('invalid'), 'my-youtube-universe-square.png');
});
