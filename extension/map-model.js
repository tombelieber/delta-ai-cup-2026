import { validVideoId } from './store.js';

export const MAP_CLASSIFICATION_KEY = 'delta.map.classifications.v1';
export const MAP_CONTENT_TYPES = Object.freeze(['knowledge', 'entertainment', 'unknown']);
export const MAP_CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);
const MAX_DATE = 8.64e15;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' ? value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const time = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_DATE ? value : null;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const canonical = value => value.toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
const empty = () => ({ schemaVersion: 1, assignments: {}, reviews: {}, updatedAt: null });

// Source titles remain multilingual. Only the taxonomy labels are English.
// Latin product names (for example Pokémon) and familiar technical punctuation
// are allowed; a model cannot inject markup, URLs or a non-English taxonomy.
export function validMapLabel(value) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 80
    && /[A-Za-z]/u.test(value) && /^[\p{Script=Latin}\p{M}\p{N} &'’+.,()\-/:!?_%–—]+$/u.test(value)
    && !/https?:|www\.|[\u0000-\u001f\u007f]/i.test(value);
}

export function normalizeMapPath(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4 || !value.every(validMapLabel)) return null;
  const path = value.map(label => label.normalize('NFC').replace(/\s+/g, ' '));
  if (new Set(path.map(canonical)).size !== path.length || canonical(path[0]) === 'more to explore') return null;
  return path;
}

function origin(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (!(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

function metadata(entry) {
  if (!object(entry) || !validVideoId(entry.videoId)) return null;
  const title = text(entry.title, 400);
  if (!title) return null;
  const channel = text(entry.channel ?? entry.channelTitle ?? entry.creator, 160);
  return { videoId: entry.videoId, title, ...(channel ? { channel } : {}) };
}

// Exact canonical metadata avoids hash collisions. Dates, account identity,
// watch duration, notes and checked practice never enter this fingerprint.
export function mapMetadataFingerprint(entry) {
  const value = metadata(entry);
  return value ? `map-v1:${JSON.stringify({ title: value.title, ...(value.channel ? { channel: value.channel } : {}) })}` : null;
}

function validFingerprint(value) {
  if (typeof value !== 'string' || !value.startsWith('map-v1:') || value.length > 1200) return false;
  try {
    const parsed = JSON.parse(value.slice(7));
    return mapMetadataFingerprint({ videoId: 'abcdefghijk', ...parsed }) === value;
  } catch { return false; }
}

// The current journal may have less creator metadata than an earlier snapshot.
// A title change is always stale. Creator metadata invalidates only when both
// sides actually identify a creator and those identities differ.
export function mapAssignmentMatches(assignment, record) {
  if (!object(assignment) || !object(record) || assignment.videoId !== record.videoId
    || !validVideoId(record.videoId) || !validFingerprint(assignment.metadataFingerprint)) return false;
  const current = metadata(record);
  if (!current) return false;
  const submitted = JSON.parse(assignment.metadataFingerprint.slice(7));
  return submitted.title === current.title
    && !(submitted.channel && current.channel && submitted.channel !== current.channel);
}

// A review proves only that these exact public metadata were processed. It
// neither creates a topic assignment nor changes any learning/watch evidence.
export function mapReviewMatches(review, record) {
  const normalized = object(record) ? normalizeReview(review, record.videoId) : null;
  return Boolean(normalized && mapAssignmentMatches(normalized, record));
}

export function metadataForMap(entries) {
  return dedupeRecords(entries).map(metadata).filter(Boolean);
}

function normalizeAssignment(value, videoId) {
  if (!object(value) || !validVideoId(videoId) || value.videoId != null && value.videoId !== videoId) return null;
  const path = normalizeMapPath(value.path);
  const endpoint = origin(value.endpoint);
  if (!path || !validFingerprint(value.metadataFingerprint) || !MAP_CONFIDENCE_LEVELS.includes(value.confidence)
    || !MAP_CONTENT_TYPES.includes(value.contentType)
    || !endpoint || !text(value.model, 160) || time(value.classifiedAt) === null) return null;
  return { videoId, path, confidence: value.confidence, contentType: value.contentType,
    metadataFingerprint: value.metadataFingerprint, classifiedAt: value.classifiedAt, endpoint, model: text(value.model, 160), source: 'ai' };
}

function normalizeReview(value, videoId) {
  if (!object(value) || !validVideoId(videoId) || value.videoId != null && value.videoId !== videoId) return null;
  const endpoint = origin(value.endpoint);
  if (!validFingerprint(value.metadataFingerprint) || !endpoint || !text(value.model, 160) || time(value.reviewedAt) === null) return null;
  return { videoId, metadataFingerprint: value.metadataFingerprint, reviewedAt: value.reviewedAt,
    endpoint, model: text(value.model, 160) };
}

function latestUpdate(store) {
  let latest = store.updatedAt || 0;
  for (const assignment of Object.values(store.assignments)) latest = Math.max(latest, assignment.classifiedAt);
  for (const review of Object.values(store.reviews)) latest = Math.max(latest, review.reviewedAt);
  return latest || null;
}

export function normalizeMapClassifications(value) {
  if (!object(value) || value.schemaVersion !== 1 || !object(value.assignments)) return empty();
  const result = empty();
  for (const [videoId, raw] of Object.entries(value.assignments)) {
    const assignment = normalizeAssignment(raw, videoId);
    if (assignment) result.assignments[videoId] = assignment;
  }
  for (const [videoId, raw] of Object.entries(object(value.reviews) ? value.reviews : {})) {
    const review = normalizeReview(raw, videoId);
    if (review) result.reviews[videoId] = review;
  }
  result.updatedAt = time(value.updatedAt);
  return result;
}

// A response item needs the fingerprint of the metadata actually submitted.
// The client attaches it; a local batch importer can instead pass {records}.
// Never attach a new fingerprint to an old in-flight result after metadata edits.
export function mergeMapClassifications(current, items, { now = Date.now(), endpoint, model, records } = {}) {
  const result = normalizeMapClassifications(current);
  const byVideo = new Map(metadataForMap(records).map(record => [record.videoId, record]));
  for (const item of Array.isArray(items) ? items : []) {
    if (!object(item) || !validVideoId(item.videoId)) continue;
    const assignment = normalizeAssignment({ ...item, endpoint: endpoint ?? item.endpoint, model: model ?? item.model,
      classifiedAt: now, metadataFingerprint: item.metadataFingerprint ?? mapMetadataFingerprint(byVideo.get(item.videoId)) }, item.videoId);
    if (!assignment) continue;
    const previous = result.assignments[item.videoId];
    if (!previous || assignment.classifiedAt >= previous.classifiedAt) result.assignments[item.videoId] = assignment;
  }
  result.updatedAt = latestUpdate(result);
  return result;
}

// Call only after a complete batch response passes validation. Include every
// submitted record, including omitted IDs; unresolved results must not burn the
// same quota again after a panel restart. Metadata changes become eligible.
export function markMapReviewed(current, records, { now = Date.now(), endpoint, model } = {}) {
  const result = normalizeMapClassifications(current);
  for (const record of metadataForMap(records)) {
    const review = normalizeReview({ videoId: record.videoId, metadataFingerprint: mapMetadataFingerprint(record),
      reviewedAt: now, endpoint, model }, record.videoId);
    if (!review) continue;
    const previous = result.reviews[record.videoId];
    if (!previous || review.reviewedAt >= previous.reviewedAt) result.reviews[record.videoId] = review;
  }
  result.updatedAt = latestUpdate(result);
  return result;
}

function calendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? time(date.getTime()) : null;
}

export function mapEntryTime(entry) {
  if (!object(entry)) return null;
  const observed = [time(entry.lastActivityAt), time(entry.visitedAt), calendarDay(entry.date),
    ...(Array.isArray(entry.historyDates) ? entry.historyDates.map(item => calendarDay(item?.date)) : [])].filter(value => value !== null);
  return observed.length ? observed.reduce((latest, value) => Math.max(latest, value), 0) : null;
}

function mergeRecords(a, b) {
  const newer = (mapEntryTime(b) || 0) >= (mapEntryTime(a) || 0) ? b : a;
  const older = newer === b ? a : b;
  const result = { ...older, ...newer, title: text(newer.title, 500) || text(older.title, 500) || 'YouTube video' };
  for (const key of ['hasPlayback', 'imported', 'accountHistory', 'learningStarted', 'hasLesson']) {
    if (a[key] === true || b[key] === true) result[key] = true;
  }
  for (const key of ['watchedSeconds', 'checkedTasks']) {
    const values = [a[key], b[key]].filter(value => Number.isFinite(value) && value >= 0);
    if (values.length) result[key] = Math.max(...values);
  }
  const tasks = [...(Array.isArray(a.tasks) ? a.tasks : []), ...(Array.isArray(b.tasks) ? b.tasks : [])];
  if (tasks.length) {
    const byTask = new Map();
    for (const task of tasks) {
      if (!object(task) || typeof task.taskId !== 'string') continue;
      const previous = byTask.get(task.taskId);
      if (!previous || (Date.parse(task.checkedAt) || 0) >= (Date.parse(previous.checkedAt) || 0)) byTask.set(task.taskId, { ...task });
    }
    result.tasks = [...byTask.values()];
  }
  const dates = [...(Array.isArray(a.historyDates) ? a.historyDates : []), ...(Array.isArray(b.historyDates) ? b.historyDates : [])];
  if (dates.length) result.historyDates = [...new Map(dates.filter(object).map(item => [JSON.stringify(item), { ...item }])).values()];
  return result;
}

function dedupeRecords(entries) {
  const byVideo = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!object(entry) || !validVideoId(entry.videoId)) continue;
    const previous = byVideo.get(entry.videoId);
    byVideo.set(entry.videoId, previous ? mergeRecords(previous, entry) : { ...entry });
  }
  return [...byVideo.values()].sort((a, b) => (mapEntryTime(b) || 0) - (mapEntryTime(a) || 0) || compare(a.videoId, b.videoId));
}

export function mapTimeBounds(range = 'all', now = Date.now()) {
  if (!['week', 'month'].includes(range)) return null;
  const end = time(now);
  if (end === null) return { start: null, end: null };
  const date = new Date(end);
  date.setHours(0, 0, 0, 0);
  if (range === 'week') date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  else date.setDate(1);
  return { start: date.getTime(), end };
}

export const mapPathId = path => `topic:${path.map(label => encodeURIComponent(canonical(label))).join('/')}`;

function makeNode(label, path, unresolved = false) {
  return { id: mapPathId(path), label, path: [...path], count: 0, lastActive: null, recentCount: 0,
    children: [], records: [], directRecords: [], unresolved, _children: new Map() };
}

export function buildPersonalMap(entries, { classifications, range = 'all', sort = 'balanced', now = Date.now() } = {}) {
  const all = dedupeRecords(entries);
  const bounds = mapTimeBounds(range, now), week = mapTimeBounds('week', now);
  const records = all.filter(entry => {
    if (!bounds) return true;
    const at = mapEntryTime(entry);
    return at !== null && bounds.start !== null && at >= bounds.start && at <= bounds.end;
  });
  const assignments = normalizeMapClassifications(classifications).assignments;
  const root = { ...makeNode('My map', []), id: 'root', total: all.length, classified: 0, unresolved: 0, stale: 0,
    range: ['week', 'month', 'all'].includes(range) ? range : 'all', sort: ['volume', 'recent', 'balanced'].includes(sort) ? sort : 'balanced' };
  for (const record of records) {
    const assignment = assignments[record.videoId];
    const fresh = mapAssignmentMatches(assignment, record);
    const creator = metadata(record)?.channel;
    const path = fresh ? assignment.path : ['More to explore', creator && validMapLabel(creator) ? creator : 'Needs context'];
    // The map owns this label only. Keep the journal's heuristic label and
    // original watch/learning evidence unchanged for History and persistence.
    const viewRecord = { ...record, topicLabel: fresh ? assignment.path.at(-1) : 'Not yet grouped' };
    if (fresh) root.classified++;
    else { root.unresolved++; if (assignment) root.stale++; }
    const at = mapEntryTime(record);
    const recent = at !== null && week?.start !== null && at >= week.start && at <= week.end;
    let node = root;
    for (let depth = 0; depth <= path.length; depth++) {
      node.records.push(viewRecord); node.count++;
      if (at !== null) node.lastActive = Math.max(node.lastActive || 0, at);
      if (recent) node.recentCount++;
      if (depth === path.length) { node.directRecords.push(viewRecord); break; }
      const key = canonical(path[depth]);
      if (!node._children.has(key)) {
        const child = makeNode(path[depth], path.slice(0, depth + 1), !fresh);
        node._children.set(key, child); node.children.push(child);
      }
      node = node._children.get(key);
    }
  }
  const recency = node => node.lastActive && time(now) !== null ? Math.exp(-Math.max(0, now - node.lastActive) / (7 * 86400000)) : 0;
  const score = node => Math.log1p(node.count) + 1.5 * Math.log1p(node.recentCount) + recency(node);
  const compareNodes = (a, b) => Number(a.unresolved) - Number(b.unresolved)
    || (root.sort === 'volume' ? b.count - a.count || (b.lastActive || 0) - (a.lastActive || 0)
      : root.sort === 'recent' ? (b.lastActive || 0) - (a.lastActive || 0) || b.count - a.count
        : score(b) - score(a) || b.count - a.count || (b.lastActive || 0) - (a.lastActive || 0))
    || compare(canonical(a.label), canonical(b.label));
  const nodes = [];
  function finish(node) {
    node.children.sort(compareNodes); delete node._children;
    nodes.push(node);
    for (const child of node.children) finish(child);
  }
  finish(root);
  // A flat index supports breadcrumbs. records aggregate descendants;
  // directRecords partition the videos exactly once across assigned paths.
  root.nodes = nodes.slice(1);
  return root;
}
