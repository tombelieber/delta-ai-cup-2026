import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLearningJournal, topicForVideo } from './learning-journal.js';
import { LEARNING_PILOT } from './learning-source.js';
import { filterJournalByTime } from './journal-view.js';

const pilot = LEARNING_PILOT.videoId, other = 'En5cSXgGvZM', third = 'bxBzsSsqQAM';
const url = videoId => `https://www.youtube.com/watch?v=${videoId}`;
const time = Date.UTC(2026, 9, 17, 9);
const visit = (videoId, title, overrides = {}) => ({ videoId, title, url: url(videoId), lastVisitTime: time - 2000, importedAt: time - 1000, ...overrides });
const playback = (videoId, title, overrides = {}) => ({ videoId, title, duration: 100, ranges: [[0, 10]], updatedAt: time - 3000, ...overrides });
const task = (taskId, overrides = {}) => ({ taskId, total: 900, formula: '=SUMIF(A2:A5,D2,B2:B5)', checkedAt: '2026-10-17T09:00:00.000Z', ...overrides });

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('account history preserves displayed days without awarding playback or learning', () => {
  const account = (date, extra = {}) => ({ videoId: other, title: 'Python tutorial', url: url(other), date,
    dateLabel: date || 'Unrecognised date', datePrecision: date ? 'day' : 'unknown', kind: 'video', importedAt: time, ...extra });
  const result = buildLearningJournal({ accountEntries: [account('2026-10-15'), account('2026-10-16'), account('2026-10-16'), account(null), account('2026-02-30')] });
  assert.equal(result.entries.length, 1);
  const entry = result.entries[0];
  assert.equal(entry.accountHistory, true);
  assert.equal(entry.hasPlayback, false);
  assert.equal(entry.watchedSeconds, 0);
  assert.equal(entry.imported, false, 'account history is not a Chrome page visit');
  assert.equal(entry.learningStarted, false);
  assert.equal(entry.checkedTasks, 0);
  assert.deepEqual(entry.historyDates.map(item => item.date), ['2026-10-16', '2026-10-15', null]);
  assert.equal(entry.lastActivityAt, new Date(2026, 9, 16).getTime());
  assert.equal(filterJournalByTime(result, 'week', new Date(2026, 9, 18, 12).getTime()).entries.length, 1);
  const unknown = buildLearningJournal({ accountEntries: [account(null)] });
  assert.equal(unknown.entries[0].lastActivityAt, 0, 'import time never becomes watch time');
  assert.equal(filterJournalByTime(unknown, 'week', time).entries.length, 0);
  assert.equal(filterJournalByTime(unknown, 'all', time).entries.length, 1);
});

test('account history is not silently limited to 2000 videos and overlaps keep existing evidence', () => {
  const accountEntries = Array.from({ length: 2101 }, (_, index) => {
    const videoId = String(index).padStart(11, '0');
    return { videoId, title: 'A video', url: url(videoId), date: '2026-10-01', dateLabel: 'Oct 1', datePrecision: 'day', importedAt: time };
  });
  accountEntries.push({ videoId: pilot, title: 'SUMIF', url: url(pilot), date: '2026-10-16', dateLabel: 'Oct 16', datePrecision: 'day', importedAt: time });
  const result = buildLearningJournal({ accountEntries, data: { videos: { [pilot]: playback(pilot, 'SUMIF recorded') } },
    items: [{ videoId: pilot, tasks: [task('tokyo')] }] });
  assert.equal(result.entries.length, 2102);
  const overlap = result.entries.find(entry => entry.videoId === pilot);
  assert.equal(overlap.accountHistory, true);
  assert.equal(overlap.watchedSeconds, 10);
  assert.equal(overlap.checkedTasks, 1);
  assert.equal(overlap.title, 'SUMIF recorded');
});

test('watch, imported and learning overlap becomes one canonical row with distinct evidence', () => {
  const source = freeze({
    data: { goal: 'private goal', profile: 'private profile', videos: { [pilot]: playback(pilot, 'Watched SUMIF tutorial', { ranges: [[0, 10], [5, 20], [40, 50], [99, 150]], snapshot: 'private snapshot' }) } },
    visits: [visit(pilot, 'Imported title', { rawUrl: 'private tracking', token: 'private token' })],
    items: [{ videoId: pilot, title: 'Saved title', enrolledAt: time - 500, hasLesson: true, lessonToken: 'private lesson token',
      tasks: [task('tokyo'), task('tokyo', { formula: '=SUMIF(A2:A5,"Tokyo",B2:B5)' }), task('taipei', { total: 650 })] }],
  });
  const before = structuredClone(source);
  const result = buildLearningJournal(source);
  assert.deepEqual(source, before);
  assert.deepEqual(result.summary, { videos: 1, watched: 1, imported: 1, learning: 1, checkedTasks: 2 });
  assert.equal(result.entries.length, 1);
  const entry = result.entries[0];
  assert.equal(entry.title, 'Watched SUMIF tutorial');
  assert.equal(entry.url, url(pilot));
  assert.equal(entry.watchedSeconds, 31, 'overlapping and out-of-duration ranges cannot inflate watched time');
  assert.equal(entry.hasPlayback, true);
  assert.equal(entry.imported, true);
  assert.equal(entry.visitedAt, time - 2000);
  assert.equal(entry.learningStarted, true);
  assert.equal(entry.hasLesson, true);
  assert.equal(entry.lastActivityAt, time);
  assert.equal(entry.checkedTasks, 2);
  assert.equal(result.groups[0].id, entry.topicId);
  assert.equal(result.groups[0].checkedTasks, 2);
  assert.equal(result.groups[0].kind, 'knowledge');
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.deepEqual(buildLearningJournal(source), result, 'aggregation is deterministic and has no wall-clock dependency');
  entry.tasks[0].formula = 'changed output';
  assert.deepEqual(source, before, 'output records never alias task input objects');
});

test('imported-only videos remain visited rather than watched, learnt or checked', () => {
  const result = buildLearningJournal({ visits: [visit(other, 'Funny cats compilation')] });
  assert.deepEqual(result.summary, { videos: 1, watched: 0, imported: 1, learning: 0, checkedTasks: 0 });
  assert.deepEqual(result.entries[0], {
    videoId: other, title: 'Funny cats compilation', url: url(other), topicId: 'cats:entertainment', topicLabel: 'Cats', kind: 'entertainment',
    watchedSeconds: 0, hasPlayback: false, imported: true, visitedAt: time - 2000, learningStarted: false,
    hasLesson: false, tasks: [], checkedTasks: 0, lastActivityAt: time - 2000,
  });
});

test('knowledge, entertainment and unknown titles stay separate even within the same source topic', () => {
  const result = buildLearningJournal({ visits: [visit(pilot, 'SUMIF'), visit(other, 'Tokyo travel guide'), visit(third, 'Tokyo travel vlog'), visit('abcdefghijk', 'Tokyo skyline')] });
  assert.deepEqual(new Set(result.groups.map(group => group.id)), new Set(['spreadsheets:knowledge', 'travel:knowledge', 'travel:entertainment', 'travel:unknown']));
  assert.equal(result.groups.every(group => group.entries.every(entry => entry.kind === group.kind && entry.topicId === group.id)), true);
  assert.equal(result.summary.learning, 0, 'a teaching cue labels a source, not an assessed learning outcome');
});

test('topic classification uses explicit teaching cues and avoids broad personal inferences', () => {
  assert.deepEqual(topicForVideo({ videoId: pilot, title: '' }), { id: 'spreadsheets:knowledge', label: 'Spreadsheets', kind: 'knowledge' });
  assert.deepEqual(topicForVideo({ title: 'Excel feature preview' }), { id: 'spreadsheets:unknown', label: 'Spreadsheets', kind: 'unknown' });
  assert.equal(topicForVideo({ title: 'Excel memes explained' }).kind, 'entertainment', 'entertainment cues take precedence over teaching words');
  assert.equal(topicForVideo({ title: 'How to use Python dictionaries' }).id, 'technology:knowledge');
  assert.equal(topicForVideo({ title: 'Music theory lesson' }).id, 'music:knowledge');
  assert.equal(topicForVideo({ title: 'Football highlights' }).id, 'sports:entertainment');
  assert.equal(topicForVideo({ title: 'Minecraft tutorial' }).id, 'gaming:knowledge');
  assert.equal(topicForVideo({ title: 'Fitness update' }).kind, 'unknown');
  assert.equal(topicForVideo({ title: 'Coffee tasting tutorial' }).label, 'Coffee', 'coffee is not bundled into a cat interest');
  assert.equal(topicForVideo({ title: 'A personal update' }).id, 'other:unknown');
});

test('specific source topics beat incidental AI tags and modest domain cues stay conservative', () => {
  const examples = [
    ['小貓咪跳舞 #AI 只是素材標籤', 'cats:entertainment'],
    ['Minecraft gameplay #AI', 'gaming:entertainment'],
    ['JR Pass explained', 'travel:knowledge'],
    ['Rail Pass overview', 'travel:unknown'],
    ['九州 由布院 新幹線 travel vlog', 'travel:entertainment'],
    ['Live session — piano performance', 'music:entertainment'],
    ['Fancam 演唱會', 'music:entertainment'],
    ['亞運 劍擊比賽精華', 'sports:entertainment'],
    ['游泳技巧教學', 'sports:knowledge'],
    ['Personal finance budget guide', 'finance:knowledge'],
    ['Espresso extraction tutorial', 'coffee:knowledge'],
    ['Python programming tutorial', 'technology:knowledge'],
  ];
  for (const [title, expected] of examples) assert.equal(topicForVideo({ title }).id, expected, title);
});

test('importing old visits today preserves their original activity chronology', () => {
  const result = buildLearningJournal({ visits: [
    visit(other, 'Older visit', { lastVisitTime: time - 100_000, importedAt: time }),
    visit(third, 'Recent visit', { lastVisitTime: time - 2000, importedAt: time - 1000 }),
    visit(other, 'Old duplicate title', { lastVisitTime: time - 200_000, importedAt: time }),
  ] });
  assert.equal(result.entries[0].videoId, third);
  assert.equal(result.entries[1].lastActivityAt, time - 100_000);
  assert.equal(result.entries[1].title, 'Older visit');
});

test('only actual positive playback ranges add a watched video and valid watch titles win', () => {
  const result = buildLearningJournal({ data: { videos: {
    [other]: playback(other, 'Python tutorial', { ranges: [[10, 10], [20, 5], [NaN, 30]] }),
    [third]: playback(third, '  A valid\u0000 watch title  ', { ranges: [[-5, 15]] }),
    abcdefghijk: playback('abcdefghijk', '', { ranges: [[0, 5]] }),
  } }, visits: [visit(other, 'Imported only'), visit(third, 'New imported title'), visit('abcdefghijk', 'Useful imported title')] });
  assert.equal(result.entries.find(entry => entry.videoId === other).hasPlayback, false);
  assert.equal(result.entries.find(entry => entry.videoId === third).title, 'A valid  watch title');
  assert.equal(result.entries.find(entry => entry.videoId === third).watchedSeconds, 15);
  assert.equal(result.entries.find(entry => entry.videoId === 'abcdefghijk').title, 'Useful imported title');
  assert.equal(result.summary.watched, 2);
});

test('task IDs deduplicate across regenerated lessons and invalid task evidence cannot earn a count', () => {
  const result = buildLearningJournal({ items: [
    { videoId: pilot, title: 'Saved lesson', hasLesson: false, enrolledAt: time - 1000, tasks: [task('tokyo', { total: 1, checkedAt: '2026-10-16T09:00:00.000Z' })] },
    { videoId: pilot, hasLesson: true, tasks: [task('tokyo'), task('bad-date', { checkedAt: 'yesterday' }), task('not-finite', { total: Infinity }), task('bad\u0000id')] },
  ] });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].learningStarted, true);
  assert.equal(result.entries[0].hasLesson, true);
  assert.deepEqual(result.entries[0].tasks, [task('tokyo')]);
  assert.equal(result.summary.checkedTasks, 1);
});

test('malformed source rows are rejected and all result objects use a safe field whitelist', () => {
  const result = buildLearningJournal({ data: { videos: {
    bad: playback('bad', 'invalid ID'),
    [pilot]: playback(other, 'mismatched ID'),
    [third]: playback(third, 'invalid duration', { duration: Infinity }),
  } }, visits: [
    visit(other, 'hostile', { url: `https://www.youtube.com.evil.test/watch?v=${other}` }),
    visit(other, 'uncommitted', { importedAt: null }),
    visit(third, 'invalid time', { lastVisitTime: Infinity }),
  ], items: [{ videoId: 'bad', tasks: [task('invalid')] }, { videoId: 'abcdefghijk', title: 'x'.repeat(500), hasLesson: false, url: 'javascript:alert(1)', profile: 'private', token: 'private', raw: 'private' }] });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].title.length, 300);
  assert.equal(result.entries[0].url, url('abcdefghijk'));
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.deepEqual(Object.keys(result.entries[0]).sort(), ['videoId', 'title', 'url', 'topicId', 'topicLabel', 'kind', 'watchedSeconds', 'hasPlayback', 'imported', 'visitedAt', 'learningStarted', 'hasLesson', 'tasks', 'checkedTasks', 'lastActivityAt'].sort());
});

test('empty and malformed inputs produce a usable empty journal', () => {
  const empty = { entries: [], groups: [], summary: { videos: 0, watched: 0, imported: 0, learning: 0, checkedTasks: 0 } };
  assert.deepEqual(buildLearningJournal(), empty);
  assert.deepEqual(buildLearningJournal({ data: { videos: [] }, visits: {}, items: 'no' }), empty);
});
