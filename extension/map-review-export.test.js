import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapReviewExport, mapReviewExportFilename } from './map-review-export.js';
import { buildPersonalMap, mapMetadataFingerprint, mergeMapClassifications } from './map-model.js';
import { createShareSummary } from './share-universe.js';

const now = Date.parse('2026-10-18T08:00:00.000Z');
const video = (index, extra = {}) => ({ videoId: String(index).padStart(11, '0'), title: `Original video ${index}`, lastActivityAt: now - index * 86400000, ...extra });
function classifications(records) {
  return mergeMapClassifications(null, records.map(record => ({ videoId: record.videoId, path: ['AI tools', 'Coding agents'],
    confidence: 'high', contentType: 'knowledge' })), { records, now, endpoint: 'https://map.example.com', model: 'test-fixture' });
}
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); for (const item of Object.values(value)) freeze(item); } return value; }

test('private review export is an explicit allowlist without identity, settings, tasks or capabilities', () => {
  const entry = video(1, { title: '原本影片標題 — Claude Code', channel: 'Original creator',
    url: 'https://youtube.com/watch?v=00000000001&access_code=URL_SECRET', date: '2026-10-17',
    historyDates: [{ date: '2026-10-17', datePrecision: 'day', dateLabel: 'Yesterday', account: 'DATE_SECRET' }],
    hasPlayback: true, watchedSeconds: 26.75, imported: true, accountHistory: true, visitedAt: now - 1000,
    learningStarted: true, hasLesson: true, checkedTasks: 2, tasks: [{ taskId: 'TASK_SECRET', total: 3, formula: 'FORMULA_SECRET' }],
    account: 'ENTRY_ACCOUNT_SECRET', notes: 'NOTE_SECRET', workspace: { lessonToken: 'LESSON_SECRET' }, accessCode: 'ENTRY_ACCESS_SECRET' });
  const store = classifications([entry]); store.accessToken = 'STORE_ACCESS_SECRET';
  const journal = freeze({ entries: [entry], account: { email: 'JOURNAL_ACCOUNT_SECRET' }, settings: { token: 'SETTINGS_SECRET' } });
  const result = createMapReviewExport(journal, { classifications: store, now });
  assert.deepEqual(Object.keys(result), ['schemaVersion', 'kind', 'capturedAt', 'source', 'coverageNote', 'records', 'classifications']);
  assert.equal(result.kind, 'delta-map-review'); assert.equal(result.source, 'delta-extension-journal');
  assert.equal(result.capturedAt, '2026-10-18T08:00:00.000Z');
  assert.deepEqual(result.records[0], { videoId: entry.videoId, title: entry.title, url: 'https://www.youtube.com/watch?v=00000000001',
    channel: entry.channel, date: '2026-10-17', historyDates: [{ date: '2026-10-17', dateLabel: 'Yesterday', datePrecision: 'day' }],
    lastActivityAt: entry.lastActivityAt, visitedAt: entry.visitedAt, hasPlayback: true, imported: true, accountHistory: true,
    learningStarted: true, hasLesson: true, watchedSeconds: 26.75, checkedTasks: 2 });
  const serialized = JSON.stringify(result);
  for (const secret of ['URL_SECRET','DATE_SECRET','TASK_SECRET','FORMULA_SECRET','ENTRY_ACCOUNT_SECRET','NOTE_SECRET','LESSON_SECRET','ENTRY_ACCESS_SECRET','STORE_ACCESS_SECRET','JOURNAL_ACCOUNT_SECRET','SETTINGS_SECRET']) assert.equal(serialized.includes(secret), false, secret);
  assert.equal(Object.hasOwn(result.records[0], 'tasks'), false);
  assert.equal(entry.url.includes('URL_SECRET'), true, 'source metadata is not mutated');
});

test('every record is retained in source order beyond legacy per-source limits', () => {
  const entries = Array.from({ length: 5003 }, (_, index) => video(index));
  const result = createMapReviewExport(freeze({ entries }), { now });
  assert.equal(result.records.length, entries.length);
  assert.deepEqual(result.records.map(record => record.videoId), entries.map(record => record.videoId));
  assert.equal(createMapReviewExport({ entries: [] }, { now }).records.length, 0, 'empty is an honest snapshot');
});

test('classifications are normalized and limited to the exported inventory', () => {
  const entries = [video(1), video(2)], outside = video(3), store = classifications([...entries, outside]);
  store.assignments.invalid = { privateToken: 'INVALID_SECRET' };
  const result = createMapReviewExport({ entries }, { classifications: store, now });
  assert.deepEqual(Object.keys(result.classifications.assignments), entries.map(entry => entry.videoId));
  assert.equal(result.classifications.updatedAt, now);
  assert.equal(Object.hasOwn(result.classifications.assignments, outside.videoId), false);
  assert.equal(Object.hasOwn(store.assignments, outside.videoId), true);
});

test('metadata-bound reviews survive private export only for the exported inventory', () => {
  const inside = video(1), outside = video(2), store = classifications([inside, outside]);
  const review = record => ({ videoId: record.videoId, metadataFingerprint: mapMetadataFingerprint(record),
    reviewedAt: now - 1000, endpoint: 'https://map.example.com', model: 'test-fixture', accessCode: 'REVIEW_SECRET' });
  store.reviews = { [inside.videoId]: review(inside), [outside.videoId]: review(outside) };
  const result = createMapReviewExport({ entries: [inside] }, { classifications: store, now });
  assert.deepEqual(Object.keys(result.classifications.reviews), [inside.videoId]);
  assert.equal(result.classifications.reviews[inside.videoId].metadataFingerprint, mapMetadataFingerprint(inside));
  assert.equal(result.classifications.reviews[inside.videoId].reviewedAt, now - 1000);
  assert.equal(JSON.stringify(result).includes('REVIEW_SECRET'), false);
  assert.equal(Object.hasOwn(store.reviews, outside.videoId), true);
});

test('exported records reproduce hierarchy, time filters and checked aggregate evidence', () => {
  const entries = [video(1, { channel: 'Creator', watchedSeconds: 23.5, hasPlayback: true, checkedTasks: 2,
    tasks: [{ taskId: 'a', total: 5 }, { taskId: 'b', total: 9 }], historyDates: [{ date: '2026-10-17', datePrecision: 'day' }] }),
    video(15, { imported: true, visitedAt: now - 15 * 86400000 }), video(90, { lastActivityAt: 0, historyDates: [{ date: null, datePrecision: 'unknown' }] })];
  const store = classifications(entries), snapshot = createMapReviewExport({ entries }, { classifications: store, now });
  for (const range of ['all', 'week', 'month']) {
    const original = buildPersonalMap(entries, { classifications: store, now, range });
    const exported = buildPersonalMap(snapshot.records, { classifications: snapshot.classifications, now, range });
    const project = root => ({ count: root.count, total: root.total, classified: root.classified, unresolved: root.unresolved,
      nodes: root.nodes.map(node => ({ id: node.id, count: node.count, lastActive: node.lastActive, recentCount: node.recentCount, videos: node.records.map(record => record.videoId) })) });
    assert.deepEqual(project(exported), project(original), range);
    assert.deepEqual(createShareSummary(exported, { includePractice: true }), createShareSummary(original, { includePractice: true }), range);
  }
});

test('invalid records fail explicitly and private filenames are unique without user identity', () => {
  assert.throws(() => createMapReviewExport({ entries: [video(1), { videoId: 'bad' }] }, { now }), /Nothing was exported/);
  assert.throws(() => createMapReviewExport({ entries: [video(1, { historyDates: [{ date: '2026-02-30' }] })] }, { now }), /Nothing was exported/);
  assert.throws(() => createMapReviewExport({ entries: [] }, { now: NaN }), /Nothing was exported/);
  const names = Array.from({ length: 20 }, () => mapReviewExportFilename(new Date(now).toISOString()));
  assert.equal(new Set(names).size, names.length);
  assert.match(names[0], /^delta-private-map-review-2026-10-18T08-00-00-000Z-[a-z0-9-]+\.json$/);
  assert.throws(() => mapReviewExportFilename('invalid'), /filename/);
});
