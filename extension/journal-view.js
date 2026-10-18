import { validVideoId } from './store.js';

export const JOURNAL_TIME_RANGES = Object.freeze([
  Object.freeze({ id: 'week', label: 'This week' }),
  Object.freeze({ id: 'month', label: 'This month' }),
  Object.freeze({ id: 'all', label: 'All time' }),
]);

const MAX_DATE = 8.64e15;
const KINDS = ['knowledge', 'entertainment', 'unknown'];
const rangeIds = new Set(JOURNAL_TIME_RANGES.map(range => range.id));
const validTime = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_DATE ? value : null;
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const kindFor = entry => KINDS.includes(entry.kind) ? entry.kind : 'unknown';

// Import time is deliberately absent: importing an old page does not make it a
// new viewing activity. Undated records remain undated.
export function journalEntryTime(entry) {
  return validTime(entry?.lastActivityAt) ?? validTime(entry?.visitedAt);
}

export function journalTimeBounds(range = 'all', now = Date.now()) {
  if (!rangeIds.has(range) || range === 'all') return null;
  const end = validTime(now);
  if (end === null) return { start: null, end: null };
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  if (range === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  else start.setDate(1);
  const startTime = start.getTime();
  return Number.isFinite(startTime) ? { start: startTime, end } : { start: null, end: null };
}

function compareEntries(a, b) {
  const aTime = journalEntryTime(a), bTime = journalEntryTime(b);
  if (aTime !== bTime) {
    if (aTime === null) return 1;
    if (bTime === null) return -1;
    return bTime - aTime;
  }
  return compareText(a.videoId, b.videoId);
}

function entriesFrom(journal) {
  return (Array.isArray(journal?.entries) ? journal.entries : [])
    .filter(entry => entry && typeof entry === 'object' && validVideoId(entry.videoId)).slice().sort(compareEntries);
}

function counts(entries) {
  return {
    watched: entries.filter(entry => entry.hasPlayback === true).length,
    imported: entries.filter(entry => entry.imported === true).length,
    learning: entries.filter(entry => entry.learningStarted === true).length,
    checkedTasks: entries.reduce((total, entry) => total + (Number.isSafeInteger(entry.checkedTasks) && entry.checkedTasks >= 0 ? entry.checkedTasks : 0), 0),
  };
}

function topicFor(entry, combineKinds) {
  const kind = kindFor(entry);
  const sourceId = typeof entry.topicId === 'string' && entry.topicId.trim() ? entry.topicId.trim() : `other:${kind}`;
  const baseId = sourceId.replace(/:(?:knowledge|entertainment|unknown)$/, '') || 'other';
  return { id: combineKinds ? baseId : sourceId,
    label: typeof entry.topicLabel === 'string' && entry.topicLabel.trim() ? entry.topicLabel.trim() : 'Other topics', kind };
}

function groupsFrom(entries, combineKinds) {
  const byTopic = new Map();
  for (const entry of entries) {
    const topic = topicFor(entry, combineKinds);
    let group = byTopic.get(topic.id);
    if (!group) {
      group = { id: topic.id, label: topic.label, ...(combineKinds ? { kinds: [] } : { kind: topic.kind }), entries: [] };
      byTopic.set(topic.id, group);
    }
    group.entries.push(entry);
    if (combineKinds && !group.kinds.includes(topic.kind)) group.kinds.push(topic.kind);
  }
  return [...byTopic.values()].map(group => ({ ...group,
    ...(combineKinds ? { kinds: KINDS.filter(kind => group.kinds.includes(kind)) } : {}), ...counts(group.entries),
  })).sort((a, b) => compareEntries(a.entries[0], b.entries[0]) || compareText(a.id, b.id));
}

// This selects videos by their latest activity. Their recorded playback and
// checked evidence stay cumulative; it does not bin playback into this period.
export function filterJournalByTime(journal, range = 'all', now = Date.now()) {
  const bounds = journalTimeBounds(range, now);
  const entries = entriesFrom(journal).filter(entry => {
    if (bounds === null) return true;
    const time = journalEntryTime(entry);
    return time !== null && bounds.start !== null && bounds.end !== null && time >= bounds.start && time <= bounds.end;
  });
  return { entries, groups: groupsFrom(entries, false), summary: { videos: entries.length, ...counts(entries) } };
}

// One planet per source topic, even when that topic contains tutorials,
// entertainment and unclassified videos. No topic limit or overflow omission.
export function groupJournalTopics(journal) {
  return groupsFrom(entriesFrom(journal), true);
}
