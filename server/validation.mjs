import { createHash } from 'node:crypto';
import { CHAPTERS, chapterFor, mergeRanges, sourceUrl } from './catalogue.mjs';

export class ValidationError extends Error {}
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message) => { throw new ValidationError(message); };
const exactKeys = (value, allowed) => { if (!plain(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail('包含未支援欄位'); };
const text = (value, max, label, empty = false) => {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`無效${label}`);
  return value.trim();
};
const texts = (value, count, max, label) => {
  if (!Array.isArray(value) || value.length > count) fail(`無效${label}`);
  return value.map((item) => text(item, max, label));
};

export function normalizeRequest(value) {
  exactKeys(value, ['schemaVersion', 'goal', 'watched']);
  if (value.schemaVersion !== 1 || !Array.isArray(value.watched) || value.watched.length > 3) fail('無效分析要求');
  const goal = value.goal === undefined ? '' : text(value.goal, 200, '目標', true);
  const byVideo = new Map();
  for (const record of value.watched) {
    exactKeys(record, ['videoId', 'ranges']);
    const chapter = chapterFor(record.videoId);
    if (!chapter || !Array.isArray(record.ranges) || record.ranges.length > 160) fail('只支援原定三集及最多 160 段紀錄');
    for (const range of record.ranges) {
      if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] < 0 || range[1] <= range[0] || range[1] > 100000) fail('無效觀看區間');
    }
    byVideo.set(record.videoId, [...(byVideo.get(record.videoId) || []), ...record.ranges]);
  }
  const watched = CHAPTERS.filter((chapter) => byVideo.has(chapter.videoId)).map((chapter) => ({
    videoId: chapter.videoId, ranges: mergeRanges(byVideo.get(chapter.videoId), chapter.start, chapter.end),
  })).filter((record) => record.ranges.length);
  return { schemaVersion: 1, goal, watched };
}

export function validateSourceUnits(value, chapter) {
  exactKeys(value, ['units']);
  if (!Array.isArray(value.units) || value.units.length < 1 || value.units.length > 40) fail('來源未提供可用論點');
  const units = value.units.map((raw) => {
    exactKeys(raw, ['start', 'end', 'summary', 'conditions', 'topic', 'support', 'speaker']);
    if (!Number.isFinite(raw.start) || !Number.isFinite(raw.end) || raw.start < chapter.start || raw.end > chapter.end || raw.end - raw.start < 5 || raw.end - raw.start > 90) fail('來源時間碼超出分析章節或片段長度');
    const summary = text(raw.summary, 600, '來源論點');
    const unit = { videoId: chapter.videoId, start: raw.start, end: raw.end, summary,
      conditions: texts(raw.conditions, 6, 300, '適用條件'), topic: text(raw.topic, 200, '問題'),
      support: text(raw.support, 600, '來源依據'), speaker: text(raw.speaker, 120, '講者') };
    const hash = createHash('sha256').update(JSON.stringify(unit)).digest('hex').slice(0, 8);
    return { ...unit, id: `${chapter.id}:${Math.round(unit.start * 1000)}:${Math.round(unit.end * 1000)}:${hash}` };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < units.length; i++) if (units[i].start < units[i - 1].end) fail('來源論點重疊；未能安全識別已看範圍');
  return units;
}

export function sourceFor(unit) {
  return { unitId: unit.id, videoId: unit.videoId, start: unit.start, end: unit.end, url: sourceUrl(unit.videoId, unit.start) };
}

export const RELATIONS = ['repeated', 'new_example', 'new_idea', 'opposing', 'unknown'];
export function validateChoice(value, memory, candidates, goal) {
  exactKeys(value, ['unitId', 'relation', 'comparedTo', 'adds', 'reason', 'usefulness', 'sameQuestion', 'compatibleConditions']);
  const selected = candidates.find((unit) => unit.id === value.unitId);
  if (!selected || !RELATIONS.includes(value.relation)) fail('推薦引用未提供來源');
  if (!Array.isArray(value.comparedTo) || value.comparedTo.length > 6 || new Set(value.comparedTo).size !== value.comparedTo.length) fail('無效比較來源');
  const references = value.comparedTo.map((id) => memory.find((unit) => unit.id === id) || fail('比較引用未看過來源'));
  if (typeof value.sameQuestion !== 'boolean' || typeof value.compatibleConditions !== 'boolean') fail('缺少比較條件');
  if (value.relation !== 'unknown' && !references.length) fail('分類缺少已看基準');
  // Different questions or conditions cannot support a contradiction claim.
  if (value.relation === 'opposing' && (!value.sameQuestion || !value.compatibleConditions)) fail('反方比較缺少相同問題或適用條件');
  const adds = text(value.adds, 800, '新增說明');
  const reason = text(value.reason, 800, '推薦理由');
  if (!['relevant', 'limited', 'unknown'].includes(value.usefulness)) fail('無效用處分類');
  return { selected, references, relation: value.relation, adds, reason, usefulness: goal ? value.usefulness : 'unknown' };
}
