import test from 'node:test';
import assert from 'node:assert/strict';
import { JOURNAL_TIME_RANGES, filterJournalByTime, groupJournalTopics, journalEntryTime, journalTimeBounds } from './journal-view.js';

const at = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime();
const now = at(2026, 10, 18, 16, 30); // Sunday in the browser's local calendar.
const monday = at(2026, 10, 12), monthStart = at(2026, 10, 1);
const id = number => `video${String(number).padStart(6, '0')}`;
function entry(number, activity, overrides = {}) {
  return { videoId: id(number), title: `Recorded title ${number}`, url: `https://www.youtube.com/watch?v=${id(number)}`,
    topicId: 'technology:unknown', topicLabel: 'Technology', kind: 'unknown', watchedSeconds: 0, hasPlayback: false,
    imported: false, visitedAt: null, learningStarted: false, hasLesson: false, tasks: [], checkedTasks: 0,
    lastActivityAt: activity, ...overrides };
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('the shared range labels use local Monday and month-start calendar boundaries', () => {
  assert.deepEqual(JOURNAL_TIME_RANGES, [{ id: 'week', label: 'This week' }, { id: 'month', label: 'This month' }, { id: 'all', label: 'All time' }]);
  assert.deepEqual(journalTimeBounds('week', now), { start: monday, end: now });
  assert.deepEqual(journalTimeBounds('month', now), { start: monthStart, end: now });
  const nextMonday = at(2026, 10, 19);
  assert.deepEqual(journalTimeBounds('week', nextMonday), { start: nextMonday, end: nextMonday });
  const newYear = at(2027, 1, 1, 9);
  assert.deepEqual(journalTimeBounds('month', newYear), { start: at(2027, 1, 1), end: newYear });
  assert.equal(journalTimeBounds('all', now), null);
});

test('calendar boundaries remain local midnights across a daylight-saving transition week', () => {
  // These local constructors work in both DST and non-DST browser time zones;
  // the implementation must not approximate this start by subtracting 7*24h.
  const sunday = at(2026, 11, 1, 18);
  assert.deepEqual(journalTimeBounds('week', sunday), { start: at(2026, 10, 26), end: sunday });
  assert.deepEqual(journalTimeBounds('month', sunday), { start: at(2026, 11, 1), end: sunday });
});

test('this week includes its start and the current instant, excluding older, unknown and future activity', () => {
  const journal = { entries: [entry(1, monday - 1), entry(2, monday), entry(3, now), entry(4, now + 1),
    entry(5, 0), entry(6, null), entry(7, NaN, { visitedAt: now - 1 }), entry(8, now - 2)] };
  const result = filterJournalByTime(journal, 'week', now);
  assert.deepEqual(result.entries.map(item => item.videoId), [id(3), id(7), id(8), id(2)]);
  assert.equal(result.summary.videos, 4);
});

test('this month keeps earlier weeks of this month and excludes the previous month', () => {
  const journal = { entries: [entry(1, monthStart - 1), entry(2, monthStart), entry(3, monday - 1), entry(4, now + 1), entry(5, 0)] };
  const result = filterJournalByTime(journal, 'month', now);
  assert.deepEqual(result.entries.map(item => item.videoId), [id(3), id(2)]);
  assert.equal(filterJournalByTime(journal, 'week', now).entries.length, 0);
});

test('all time retains undated records without substituting import time or inventing dates', () => {
  const undated = entry(1, 0, { visitedAt: null, importedAt: now, imported: true });
  const journal = { entries: [undated, entry(2, monday), entry(3, now + 1)] };
  const result = filterJournalByTime(journal, 'all', now);
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries.at(-1), undated);
  assert.equal(journalEntryTime(undated), null);
  assert.equal(result.entries.at(-1).lastActivityAt, 0);
  assert.equal(filterJournalByTime(journal, 'week', now).entries.includes(undated), false);
});

test('latest activity is authoritative, and only a missing or invalid activity falls back to the original visit', () => {
  const old = entry(1, monthStart - 1, { visitedAt: now, importedAt: now });
  const fallback = entry(2, Infinity, { visitedAt: monday, importedAt: now });
  const future = entry(3, now + 1, { visitedAt: monday });
  assert.equal(journalEntryTime(old), monthStart - 1);
  assert.equal(journalEntryTime(fallback), monday);
  assert.deepEqual(filterJournalByTime({ entries: [old, fallback, future] }, 'week', now).entries, [fallback]);
});

test('filtering recomputes all counts while preserving cumulative playback and checked evidence exactly', () => {
  const task = { taskId: 'tokyo', total: 900, checkedAt: new Date(now - 1000).toISOString(), formula: '=SUMIF(A2:A5,D2,B2:B5)' };
  const watched = entry(1, now, { watchedSeconds: 3600, hasPlayback: true, imported: true, learningStarted: true, hasLesson: true,
    tasks: [task, { ...task, taskId: 'taipei', total: 650 }], checkedTasks: 2 });
  const visited = entry(2, monday, { imported: true });
  const source = freeze({ entries: [watched, visited, entry(3, monthStart - 1, { hasPlayback: true, checkedTasks: 3 })],
    groups: [{ id: 'stale', watched: 99 }], summary: { videos: 99, watched: 99, imported: 99, learning: 99, checkedTasks: 99 } });
  const before = structuredClone(source);
  const result = filterJournalByTime(source, 'week', now);
  assert.deepEqual(result.summary, { videos: 2, watched: 1, imported: 2, learning: 1, checkedTasks: 2 });
  assert.equal(result.entries[0], watched, 'the view keeps the original entry and its cumulative evidence');
  assert.equal(result.entries[0].watchedSeconds, 3600);
  assert.equal(result.entries[0].tasks, watched.tasks);
  assert.deepEqual(result.groups.map(group => ({ id: group.id, watched: group.watched, imported: group.imported, learning: group.learning, checkedTasks: group.checkedTasks })),
    [{ id: 'technology:unknown', watched: 1, imported: 2, learning: 1, checkedTasks: 2 }]);
  assert.deepEqual(source, before, 'filtering never changes the journal, recorded playback or checked answers');
});

test('one topic planet combines knowledge, entertainment and unknown entries without changing their evidence kinds', () => {
  const source = { entries: [
    entry(1, now - 1, { topicId: 'travel:knowledge', topicLabel: 'Travel', kind: 'knowledge', hasPlayback: true }),
    entry(2, now, { topicId: 'travel:entertainment', topicLabel: 'Travel', kind: 'entertainment', imported: true }),
    entry(3, monday, { topicId: 'travel:unknown', topicLabel: 'Travel', kind: 'unknown', imported: true }),
    entry(4, monday - 1, { topicId: 'coffee:knowledge', topicLabel: 'Coffee', kind: 'knowledge', learningStarted: true, checkedTasks: 1 }),
  ] };
  const groups = groupJournalTopics(source);
  assert.deepEqual(groups.map(group => group.id), ['travel', 'coffee']);
  assert.deepEqual(groups[0].kinds, ['knowledge', 'entertainment', 'unknown']);
  assert.deepEqual(groups[0].entries.map(item => item.videoId), [id(2), id(1), id(3)]);
  assert.deepEqual({ watched: groups[0].watched, imported: groups[0].imported, learning: groups[0].learning, checkedTasks: groups[0].checkedTasks },
    { watched: 1, imported: 2, learning: 0, checkedTasks: 0 });
  assert.equal(groups[0].entries[0].kind, 'entertainment');
  assert.equal(groups[0].entries[1].kind, 'knowledge');
  const selected = filterJournalByTime(source, 'week', now);
  assert.equal(groupJournalTopics(selected).length, 1, 'map and timeline can consume the identical filtered journal');
});

test('every real entry belongs to exactly one topic and no overflow topic is discarded', () => {
  const entries = Array.from({ length: 35 }, (_, index) => entry(index, now - index, {
    topicId: `topic-${index}:unknown`, topicLabel: `Topic ${index}`, imported: true,
  }));
  const groups = groupJournalTopics({ entries });
  assert.equal(groups.length, 35);
  assert.equal(groups.flatMap(group => group.entries).length, entries.length);
  assert.deepEqual(new Set(groups.flatMap(group => group.entries.map(item => item.videoId))), new Set(entries.map(item => item.videoId)));
  assert.equal(groups.every(group => group.imported === 1), true);
});

test('ties, undated records and topic ordering are deterministic without sorting the input arrays', () => {
  const entries = [entry(3, null, { topicId: 'cats:unknown', topicLabel: 'Cats' }),
    entry(2, now, { topicId: 'music:entertainment', topicLabel: 'Music', kind: 'entertainment' }),
    entry(1, now, { topicId: 'coffee:knowledge', topicLabel: 'Coffee', kind: 'knowledge' }), entry(4, null)];
  const before = entries.map(item => item.videoId);
  const result = filterJournalByTime({ entries }, 'all', now);
  assert.deepEqual(result.entries.map(item => item.videoId), [id(1), id(2), id(3), id(4)]);
  assert.deepEqual(groupJournalTopics({ entries }).map(group => group.id), ['coffee', 'music', 'cats', 'technology']);
  assert.deepEqual(entries.map(item => item.videoId), before);
});

test('empty real input stays empty, and invalid restricted bounds never widen the selected period', () => {
  const empty = { entries: [], groups: [], summary: { videos: 0, watched: 0, imported: 0, learning: 0, checkedTasks: 0 } };
  assert.deepEqual(filterJournalByTime(undefined), empty);
  assert.deepEqual(groupJournalTopics(undefined), []);
  assert.deepEqual(filterJournalByTime({ entries: [entry(1, now)] }, 'week', NaN), empty);
});
