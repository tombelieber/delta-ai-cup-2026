import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_CLASSIFICATION_KEY, metadataForMap, mapMetadataFingerprint, normalizeMapClassifications,
  mergeMapClassifications, markMapReviewed, normalizeMapPath, buildPersonalMap, mapEntryTime, mapPathId, mapAssignmentMatches, mapReviewMatches } from './map-model.js';

const endpoint = 'https://map.example.com';
const now = new Date(2026, 9, 19, 14).getTime();
const id = n => `v${String(n).padStart(10, '0')}`;
const record = (n, extra = {}) => ({ videoId: id(n), title: `Real title ${n}`, date: '2026-10-19', ...extra });
const item = (entry, path = ['AI tools', 'Coding agents', 'Claude Code']) => ({ videoId: entry.videoId, path, confidence: 'high', contentType: 'knowledge', metadataFingerprint: mapMetadataFingerprint(entry) });
const store = (records, paths) => mergeMapClassifications(null, records.map((entry, i) => item(entry, paths?.[i])), { now, endpoint, model: 'approved-free-model' });

test('metadata boundary contains only deduped source title, ID and optional creator; metadata fingerprints ignore private activity', () => {
  const source = record(1, { title: '  真實\n影片  ', channel: ' A creator ', account: 'private@example.com', watchedSeconds: 31,
    tasks: [{ taskId: 'private' }], note: 'private note', importedAt: now });
  assert.deepEqual(metadataForMap([source, source, null, { videoId: 'bad', title: 'Bad' }]), [{ videoId: id(1), title: '真實 影片', channel: 'A creator' }]);
  assert.equal(mapMetadataFingerprint(source), mapMetadataFingerprint({ ...source, date: null, watchedSeconds: 900, account: 'other', note: 'another' }));
  assert.notEqual(mapMetadataFingerprint(source), mapMetadataFingerprint({ ...source, title: 'Different title' }));
  assert.notEqual(mapMetadataFingerprint(source), mapMetadataFingerprint({ ...source, channel: 'Another creator' }));
  assert.equal(metadataForMap([record(2, { title: 'x'.repeat(800), channel: 'y'.repeat(800) })])[0].title.length, 400);
  assert.equal(metadataForMap([record(2, { title: 'x'.repeat(800), channel: 'y'.repeat(800) })])[0].channel.length, 160);
  assert.deepEqual(metadataForMap([record(2, { title: ' ' })]), []);
});

test('classification storage validates English dynamic paths and keeps the nonsecret service route and exact submitted metadata', () => {
  const entry = record(1);
  const saved = store([entry]);
  assert.equal(MAP_CLASSIFICATION_KEY, 'delta.map.classifications.v1');
  assert.deepEqual(saved.assignments[id(1)].path, ['AI tools', 'Coding agents', 'Claude Code']);
  assert.equal(saved.assignments[id(1)].endpoint, endpoint);
  assert.equal(saved.assignments[id(1)].model, 'approved-free-model');
  assert.equal(saved.assignments[id(1)].metadataFingerprint, mapMetadataFingerprint(entry));
  assert.equal(saved.assignments[id(1)].source, 'ai');
  assert.deepEqual(normalizeMapClassifications(JSON.parse(JSON.stringify(saved))), saved);
  const invalid = structuredClone(saved); invalid.assignments[id(1)].path = ['人工智能', 'Coding agents'];
  assert.equal(Object.keys(normalizeMapClassifications(invalid).assignments).length, 0);
  const invalidRoute = structuredClone(saved); invalidRoute.assignments[id(1)].endpoint = 'https://map.example.com/?key=secret';
  assert.equal(Object.keys(normalizeMapClassifications(invalidRoute).assignments).length, 0);
  for (const path of [['AI tools'], ['AI tools', 'Coding agents', 'Claude Code', 'Setup', 'More'], ['AI tools', '<script>'], ['AI tools', 'https://evil.example'], ['AI tools', 'AI tools'], ['More to explore', 'Unknown']]) assert.equal(normalizeMapPath(path), null);
  assert.deepEqual(normalizeMapPath(['Gaming', 'Pokémon']), ['Gaming', 'Pokémon']);
});

test('batch merging can take submitted records but never replaces a newer classification or invents a fingerprint', () => {
  const entry = record(1);
  const noFingerprint = { ...item(entry), metadataFingerprint: undefined };
  assert.equal(Object.keys(mergeMapClassifications(null, [noFingerprint], { endpoint, model: 'free', now }).assignments).length, 0);
  const saved = mergeMapClassifications(null, [noFingerprint], { endpoint, model: 'free', now, records: [entry] });
  assert.equal(saved.assignments[id(1)].metadataFingerprint, mapMetadataFingerprint(entry));
  const older = mergeMapClassifications(saved, [item(entry, ['Software', 'Editors'])], { endpoint, model: 'free', now: now - 1 });
  assert.deepEqual(older, saved);
  const changed = mergeMapClassifications(saved, [item(entry, ['Software', 'Editors'])], { endpoint, model: 'free', now: now + 1 });
  assert.deepEqual(changed.assignments[id(1)].path, ['Software', 'Editors']);
  assert.equal(changed.updatedAt, now + 1);
});

test('creator metadata enrichment alone does not invalidate the same video/title; conflicting known creators and title changes remain stale', () => {
  const entry = record(1, { channel: 'Known creator' });
  const saved = store([entry]).assignments[id(1)];
  assert.equal(mapAssignmentMatches(saved, entry), true);
  assert.equal(mapAssignmentMatches(saved, record(1)), true);
  assert.equal(mapAssignmentMatches(store([record(1)]).assignments[id(1)], entry), true);
  assert.equal(mapAssignmentMatches(saved, record(1, { channel: 'Different creator' })), false);
  assert.equal(mapAssignmentMatches(saved, { ...entry, title: 'Changed title' }), false);
  assert.equal(mapAssignmentMatches(saved, { ...entry, videoId: id(2) }), false);
  assert.equal(buildPersonalMap([record(1)], { classifications: store([entry]), now }).classified, 1);
});

test('persisted reviews validate metadata and provenance without creating assignments, topics or learning evidence', () => {
  const entry = record(1, { channel: 'A creator', notes: 'PRIVATE_NOTES', tasks: [{ taskId: 'private-task' }] });
  const reviewed = markMapReviewed(null, [entry], { now, endpoint, model: 'approved-free-model' });
  assert.deepEqual(reviewed.assignments, {});
  assert.deepEqual(reviewed.reviews[id(1)], { videoId: id(1), metadataFingerprint: mapMetadataFingerprint(entry), reviewedAt: now, endpoint, model: 'approved-free-model' });
  assert.equal(JSON.stringify(reviewed).includes('PRIVATE_NOTES'), false);
  assert.equal(JSON.stringify(reviewed).includes('private-task'), false);
  const map = buildPersonalMap([record(1)], { classifications: reviewed, now });
  assert.equal(map.classified, 0); assert.equal(map.unresolved, 1);
  assert.equal(map.children[0].label, 'More to explore');
  assert.equal(map.records.some(value => Object.hasOwn(value, 'learningStarted')), false);
  assert.deepEqual(normalizeMapClassifications({ schemaVersion: 1, assignments: {} }).reviews, {});
  const invalid = structuredClone(reviewed);
  invalid.reviews[id(2)] = { ...reviewed.reviews[id(1)], videoId: id(2), metadataFingerprint: 'bad' };
  invalid.reviews[id(3)] = { ...reviewed.reviews[id(1)], videoId: id(3), endpoint: 'https://map.example.com/?key=secret' };
  invalid.reviews[id(4)] = { ...reviewed.reviews[id(1)], videoId: id(4), reviewedAt: 0 };
  assert.deepEqual(Object.keys(normalizeMapClassifications(invalid).reviews), [id(1)]);
  assert.equal(mapReviewMatches(invalid.reviews[id(2)], record(2)), false);
});

test('review metadata changes become eligible and newer reviews survive older marks or assignment merges', () => {
  const entry = record(1, { channel: 'Known creator' });
  const reviewed = markMapReviewed(null, [entry], { now, endpoint, model: 'approved-free-model' });
  assert.equal(mapReviewMatches(reviewed.reviews[id(1)], entry), true);
  assert.equal(mapReviewMatches(reviewed.reviews[id(1)], record(1)), true);
  assert.equal(mapReviewMatches(reviewed.reviews[id(1)], { ...entry, title: 'Changed title' }), false);
  assert.equal(mapReviewMatches(reviewed.reviews[id(1)], { ...entry, channel: 'Different known creator' }), false);
  const older = markMapReviewed(reviewed, [{ ...entry, title: 'Old source' }], { now: now - 1, endpoint, model: 'older-model' });
  assert.deepEqual(older, reviewed);
  const refreshed = markMapReviewed(reviewed, [{ ...entry, title: 'Changed title' }], { now: now + 100, endpoint, model: 'approved-free-model' });
  assert.equal(refreshed.reviews[id(1)].reviewedAt, now + 100);
  assert.equal(mapReviewMatches(refreshed.reviews[id(1)], { ...entry, title: 'Changed title' }), true);
  const merged = mergeMapClassifications(refreshed, [item(entry)], { now, endpoint, model: 'approved-free-model' });
  assert.deepEqual(merged.reviews, refreshed.reviews);
  assert.equal(merged.updatedAt, now + 100);
});

test('unbounded dynamic hierarchy preserves every real video and checked/watch evidence without creating learning claims', () => {
  const records = Array.from({ length: 75 }, (_, index) => record(index, { kind: 'short', watchedSeconds: index, checkedTasks: index === 0 ? 1 : 0 }));
  const paths = records.map((entry, index) => [`Topic ${index}`, `Subtopic ${index}`, `Tool ${index}`, `Workflow ${index}`]);
  const map = buildPersonalMap(records, { classifications: store(records, paths), now });
  assert.equal(map.total, 75); assert.equal(map.count, 75); assert.equal(map.classified, 75); assert.equal(map.unresolved, 0);
  assert.equal(map.children.length, 75, 'there is no fixed ten-topic taxonomy or visible data cap');
  assert.equal(map.nodes.length, 300);
  const leaves = map.nodes.filter(node => !node.children.length);
  assert.equal(leaves.flatMap(node => node.records).length, 75);
  assert.deepEqual(map.records.find(entry => entry.videoId === id(0)), { ...records[0], topicLabel: 'Workflow 0' });
  assert.equal(map.records.some(entry => Object.hasOwn(entry, 'learningStarted')), false);
  assert.equal(map.nodes.find(node => node.path.length === 4).id, mapPathId(map.nodes.find(node => node.path.length === 4).path));
  assert.equal(mapPathId(['AI tools', 'Claude Code']), mapPathId(['ai tools', 'CLAUDE CODE']));
});

test('map video labels use the fresh AI leaf without changing source journal labels or watch/learning evidence', () => {
  const source = record(1, { title: 'Claude Code tutorial', topicLabel: 'Other topics', watchedSeconds: 55, checkedTasks: 1,
    tasks: [{ taskId: 'real-task', total: 650, checkedAt: '2026-10-19T02:00:00Z' }] });
  const original = structuredClone(source);
  const classifications = store([source]);
  const savedClassifications = structuredClone(classifications);
  const map = buildPersonalMap([source], { classifications, now });
  const view = map.records[0];
  assert.equal(view.topicLabel, 'Claude Code');
  assert.notEqual(view, source);
  assert.deepEqual(view, { ...original, topicLabel: 'Claude Code' });
  for (const node of map.nodes) {
    assert.equal(node.records[0], view);
    if (!node.children.length) assert.equal(node.directRecords[0], view);
  }
  assert.deepEqual(source, original);
  assert.deepEqual(classifications, savedClassifications);
  const changed = { ...source, title: 'A changed title' };
  const stale = buildPersonalMap([changed], { classifications, now });
  assert.equal(stale.records[0].topicLabel, 'Not yet grouped');
  assert.equal(stale.classified, 0);
  assert.equal(changed.topicLabel, 'Other topics');
});

test('stale classification is retained for audit but not trusted; unresolved sources remain visible and last', () => {
  const classified = record(1), creator = record(2, { channel: 'Example creator' });
  const records = [classified, creator, record(3, { channel: '廣東話頻道' }), record(4)];
  const saved = store([classified]);
  const changed = records.map(entry => entry.videoId === classified.videoId ? { ...entry, title: 'Changed title' } : entry);
  const stale = buildPersonalMap(changed, { classifications: saved, now });
  assert.equal(stale.stale, 1); assert.equal(stale.unresolved, 4); assert.equal(stale.classified, 0);
  assert.equal(stale.children[0].label, 'More to explore');
  assert.deepEqual(stale.children[0].children.map(node => node.label).sort(), ['Example creator', 'Needs context']);
  assert.equal(stale.count, 4);
  const fresh = buildPersonalMap(records, { classifications: saved, sort: 'volume', now });
  assert.equal(fresh.children[0].label, 'AI tools', 'a large unresolved group cannot bury named topics');
  assert.equal(fresh.children.at(-1).label, 'More to explore');
  assert.equal(fresh.children.at(-1).count, 3);
});

test('deduplication retains cumulative checked/watch evidence and latest activity without summing repeated source rows', () => {
  const earlier = record(1, { date: '2026-10-18', watchedSeconds: 50, hasPlayback: true, checkedTasks: 1,
    tasks: [{ taskId: 'task1', checkedAt: '2026-10-18T00:00:00.000Z', formula: '=SUM(A1:A3)' }] });
  const latest = record(1, { date: '2026-10-19', watchedSeconds: 10, hasPlayback: false, imported: true });
  const map = buildPersonalMap([earlier, latest], { classifications: store([latest]), now });
  assert.equal(map.count, 1); assert.equal(map.classified, 1);
  assert.equal(map.records[0].watchedSeconds, 50);
  assert.equal(map.records[0].checkedTasks, 1);
  assert.equal(map.records[0].tasks[0].formula, '=SUM(A1:A3)');
  assert.equal(map.records[0].hasPlayback, true);
  assert.equal(map.records[0].imported, true);
  assert.equal(mapEntryTime(map.records[0]), new Date(2026, 9, 19).getTime());
});

test('calendar week/month filtering uses observation/activity dates and excludes unknown dates without using import time', () => {
  const records = [record(1), record(2, { date: '2026-10-18' }), record(3, { date: '2026-10-01' }), record(4, { date: '2026-09-30' }),
    record(5, { date: null, importedAt: now }), record(6, { date: '2026-02-30', importedAt: now }),
    record(7, { date: null, lastActivityAt: new Date(2026, 9, 19, 12).getTime() }), record(8, { date: '2026-10-20' })];
  const classifications = store(records);
  const week = buildPersonalMap(records, { classifications, range: 'week', now });
  assert.equal(week.total, 8); assert.equal(week.count, 2); assert.equal(week.recentCount, 2);
  assert.deepEqual(new Set(week.records.map(entry => entry.videoId)), new Set([id(1), id(7)]));
  assert.equal(buildPersonalMap(records, { classifications, range: 'month', now }).count, 4);
  assert.equal(buildPersonalMap(records, { classifications, range: 'all', now }).count, 8);
  assert.equal(mapEntryTime({ date: '2026-02-30', importedAt: now }), null);
});

test('home can rank volume, recent activity or both with stable tie breaks and every node total matches its records', () => {
  const records = [record(1, { date: '2026-09-01' }), record(2, { date: '2026-09-01' }), record(3, { date: '2026-09-01' }), record(4)];
  const classifications = store(records, [['Archive', 'Big collection'], ['Archive', 'Big collection'], ['Archive', 'Big collection'], ['AI tools', 'Coding agents']]);
  assert.equal(buildPersonalMap(records, { classifications, sort: 'volume', now }).children[0].label, 'Archive');
  assert.equal(buildPersonalMap(records, { classifications, sort: 'recent', now }).children[0].label, 'AI tools');
  const balanced = buildPersonalMap(records, { classifications, now });
  assert.equal(balanced.children[0].label, 'AI tools');
  for (const node of [balanced, ...balanced.nodes]) {
    assert.equal(node.count, node.records.length);
    assert.equal(node.count, node.directRecords.length + node.children.reduce((count, child) => count + child.count, 0));
  }
  assert.deepEqual(buildPersonalMap([], { now }).children, []);
});
