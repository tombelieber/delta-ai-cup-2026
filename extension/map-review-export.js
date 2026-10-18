import { validVideoId } from './store.js';
import { normalizeMapClassifications } from './map-model.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const MAX_DATE = 8.64e15;
const timestamp = value => Number.isFinite(value) && value >= 0 && value <= MAX_DATE;
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

function reviewRecord(entry) {
  if (!object(entry) || !validVideoId(entry.videoId)) throw new TypeError('A saved video record is invalid. Nothing was exported.');
  const result = { videoId: entry.videoId, title: typeof entry.title === 'string' ? entry.title : 'YouTube video',
    url: `https://www.youtube.com/watch?v=${entry.videoId}` };
  if (typeof entry.channel === 'string' && entry.channel) result.channel = entry.channel;
  if (entry.date !== undefined) {
    if (!(entry.date === null || day(entry.date))) throw new TypeError('A saved history date is invalid. Nothing was exported.');
    result.date = entry.date;
  }
  if (Array.isArray(entry.historyDates)) result.historyDates = entry.historyDates.map(item => {
    if (!object(item) || !(item.date === null || day(item.date))) throw new TypeError('A saved history date is invalid. Nothing was exported.');
    return { date: item.date, ...(typeof item.dateLabel === 'string' ? { dateLabel: item.dateLabel } : {}),
      ...(item.datePrecision === 'day' || item.datePrecision === 'unknown' ? { datePrecision: item.datePrecision } : {}) };
  });
  for (const field of ['lastActivityAt', 'visitedAt']) {
    if (entry[field] === null || timestamp(entry[field])) result[field] = entry[field];
  }
  for (const field of ['hasPlayback', 'imported', 'accountHistory', 'learningStarted', 'hasLesson']) {
    if (typeof entry[field] === 'boolean') result[field] = entry[field];
  }
  if (Number.isFinite(entry.watchedSeconds) && entry.watchedSeconds >= 0) result.watchedSeconds = entry.watchedSeconds;
  if (Number.isSafeInteger(entry.checkedTasks) && entry.checkedTasks >= 0) result.checkedTasks = entry.checkedTasks;
  return result;
}

// A deliberate private download, never a storage dump. Preserve every journal
// row and its order while excluding account identity, settings and workspaces.
export function createMapReviewExport(journal, { classifications, now = Date.now() } = {}) {
  if (!object(journal) || !Array.isArray(journal.entries)) throw new TypeError('Saved history is unavailable. Nothing was exported.');
  if (!timestamp(now) || now === 0) throw new TypeError('The export date is unavailable. Nothing was exported.');
  const records = journal.entries.map(reviewRecord), ids = new Set(records.map(record => record.videoId));
  const normalized = normalizeMapClassifications(classifications);
  const assignments = Object.fromEntries(Object.entries(normalized.assignments).filter(([videoId]) => ids.has(videoId)));
  const reviews = Object.fromEntries(Object.entries(normalized.reviews || {}).filter(([videoId]) => ids.has(videoId)));
  return { schemaVersion: 1, kind: 'delta-map-review', capturedAt: new Date(now).toISOString(), source: 'delta-extension-journal',
    coverageNote: 'Private snapshot of records already saved in this Chrome profile at export time. It is not a complete lifetime YouTube export or a live sync. Keep this file private.',
    records, classifications: { schemaVersion: 1, assignments, reviews,
      updatedAt: Math.max(Object.values(assignments).reduce((latest, assignment) => Math.max(latest, assignment.classifiedAt), 0),
        Object.values(reviews).reduce((latest, review) => Math.max(latest, review.reviewedAt), 0)) || null } };
}

export function mapReviewExportFilename(capturedAt, nonce = globalThis.crypto.randomUUID()) {
  const date = new Date(capturedAt);
  if (!Number.isFinite(date.getTime()) || typeof nonce !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(nonce)) throw new TypeError('A private export filename could not be prepared.');
  return `delta-private-map-review-${date.toISOString().replace(/[:.]/g, '-')}-${nonce}.json`;
}

export function downloadMapReviewExport(snapshot) {
  if (!object(snapshot) || snapshot.kind !== 'delta-map-review' || !Array.isArray(snapshot.records)) throw new TypeError('A private map review snapshot is required.');
  const filename = mapReviewExportFilename(snapshot.capturedAt);
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}
