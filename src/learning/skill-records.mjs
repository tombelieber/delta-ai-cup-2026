import { reviewedLearningSource, REVIEWED_SUMIF_SOURCE, LEARNING_SOURCE_REGISTRY_VERSION } from '../../server/learning-sources.mjs';

export const SKILLS_STORE_KEY = 'delta-skill-tree-v1';
export const SKILLS = Object.freeze([
  Object.freeze({ id: 'excel-column-total', label: 'Total a column of numbers', method: 'SUM' }),
  Object.freeze({ id: 'sumif-text-equality', label: 'Total revenue for one region', method: 'SUMIF' }),
]);
const REGION_SKILL = 'sumif-text-equality';
const MAX_EVIDENCE = 20;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const knownSkill = id => SKILLS.some(skill => skill.id === id);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;

function serviceOrigin(value) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash && url.pathname === '/'
      && (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) ? url.origin : null;
  } catch { return null; }
}

function reviewedSource(value) {
  if (!object(value)) return null;
  try {
    const url = new URL(value.videoUrl || value.url || (value.videoId === REVIEWED_SUMIF_SOURCE.videoId ? REVIEWED_SUMIF_SOURCE.videoUrl : ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    const videoId = ['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname) && url.pathname === '/watch'
      ? url.searchParams.get('v') : url.hostname === 'youtu.be' ? url.pathname.slice(1) : null;
    const start = Number(value.start), end = Number(value.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 300 || end > 86400) return null;
    const reviewed = reviewedLearningSource({ videoId, videoUrl: REVIEWED_SUMIF_SOURCE.videoUrl, start, end });
    return reviewed ? { videoUrl: REVIEWED_SUMIF_SOURCE.videoUrl, start: reviewed.source.start, end: reviewed.source.end } : null;
  } catch { return null; }
}

function normalizedEvidence(value) {
  if (!object(value) || value.skillId !== REGION_SKILL || value.registryVersion !== LEARNING_SOURCE_REGISTRY_VERSION
    || !text(value.lessonId, 100) || !text(value.taskId, 100) || !text(value.formula, 1000) || !/^=\s*SUMIF\s*\(/i.test(value.formula.trim())
    || !Number.isFinite(value.actualTotal)) return null;
  const source = reviewedSource(value.source), origin = serviceOrigin(value.origin);
  const checkedAt = value.checkedAt == null ? null : timestamp(value.checkedAt);
  if (!source || !origin || value.checkedAt != null && !checkedAt) return null;
  return { skillId: REGION_SKILL, lessonId: value.lessonId, taskId: value.taskId, formula: value.formula,
    source, registryVersion: LEARNING_SOURCE_REGISTRY_VERSION, origin, checkedAt, actualTotal: value.actualTotal };
}

const evidenceIdentity = value => JSON.stringify([value.skillId, value.lessonId, value.taskId, value.formula, value.origin]);
function evidenceList(values) {
  const unique = new Map();
  for (const value of Array.isArray(values) ? values.slice(-100) : []) {
    const evidence = normalizedEvidence(value);
    if (evidence) { const key = evidenceIdentity(evidence); unique.delete(key); unique.set(key, evidence); }
  }
  return [...unique.values()].slice(-MAX_EVIDENCE);
}

export function emptySkills() { return { schemaVersion: 1, familiarity: {}, activity: {}, evidence: [] }; }

export function normalizeSkills(value) {
  const result = emptySkills();
  if (!object(value) || value.schemaVersion !== 1) return result;
  for (const { id } of SKILLS) {
    const confirmedAt = timestamp(value.familiarity?.[id]?.confirmedAt);
    if (confirmedAt) result.familiarity[id] = { confirmedAt };
    const startedAt = timestamp(value.activity?.[id]?.startedAt), source = reviewedSource(value.activity?.[id]?.source);
    if (id === REGION_SKILL && startedAt && source) result.activity[id] = { startedAt, source };
  }
  result.evidence = evidenceList(value.evidence);
  return result;
}

export function setFamiliarity(value, id, familiar, at = new Date().toISOString()) {
  const result = normalizeSkills(value);
  if (!knownSkill(id) || typeof familiar !== 'boolean') return result;
  if (!familiar) delete result.familiarity[id];
  else if (timestamp(at)) result.familiarity[id] = { confirmedAt: at };
  return result;
}

export function markStarted(value, source, at = new Date().toISOString()) {
  const result = normalizeSkills(value), reviewed = reviewedSource(source);
  if (reviewed && timestamp(at) && !result.activity[REGION_SKILL]) result.activity[REGION_SKILL] = { startedAt: at, source: reviewed };
  return result;
}

// A positive backend verdict must already be bound to this exact submission.
// No token verification or formula assessment is reimplemented in the UI.
export function createPracticeEvidence({ lesson, task, formula, feedback, origin, checkedAt } = {}) {
  if (!object(lesson) || lesson.skill !== REGION_SKILL || task?.skill !== REGION_SKILL || !text(lesson.id, 100) || !text(task.id, 100)
    || feedback?.passed !== true || feedback.code !== 'correct' || feedback.method !== 'deterministic-formula-validation'
    || feedback.lessonId !== lesson.id || feedback.taskId !== task.id || feedback.answer !== formula
    || lesson.sourceVerification?.status !== 'reviewed_source_anchors_ai_lesson_unverified'
    || lesson.sourceVerification.registryVersion !== LEARNING_SOURCE_REGISTRY_VERSION) return null;
  const tasks = [lesson.task, ...(Array.isArray(lesson.practiceTasks) ? lesson.practiceTasks : [])];
  if (!tasks.some(candidate => candidate?.id === task.id && candidate.skill === REGION_SKILL)) return null;
  return normalizedEvidence({ skillId: REGION_SKILL, lessonId: lesson.id, taskId: task.id, formula, source: lesson.source,
    registryVersion: LEARNING_SOURCE_REGISTRY_VERSION, origin, checkedAt, actualTotal: feedback.actualTotal });
}

export function addPracticeEvidence(value, evidence) {
  const result = normalizeSkills(value), accepted = normalizedEvidence(evidence);
  if (accepted) result.evidence = evidenceList([...result.evidence, accepted]);
  return result;
}

export function videoValue(value, source, origin) {
  const reviewed = reviewedSource(source);
  if (!reviewed) return { kind: 'unsupported', evidence: [] };
  const record = normalizeSkills(value), endpoint = serviceOrigin(origin);
  const evidence = record.evidence.filter(item => item.origin === endpoint && item.source.start < reviewed.end && item.source.end > reviewed.start);
  return { kind: evidence.length ? 'review' : record.familiarity[REGION_SKILL] ? 'consolidation' : 'new', evidence };
}
