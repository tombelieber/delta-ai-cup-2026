import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILLS, emptySkills, normalizeSkills, setFamiliarity, markStarted, createPracticeEvidence, addPracticeEvidence, videoValue } from '../src/learning/skill-records.mjs';
import { LEARNING_SOURCE_REGISTRY_VERSION } from '../server/learning-sources.mjs';

const origin = 'https://delta.example.com', at = '2026-10-17T08:00:00.000Z';
const source = { videoUrl: 'https://www.youtube.com/watch?v=dI8w0utjUc0', start: 35, end: 186 };
const task = { id: 'sumif-practice-tokyo-v1', skill: 'sumif-text-equality' };
const lesson = { id: 'lesson-a', skill: task.skill, source, task, sourceVerification: { status: 'reviewed_source_anchors_ai_lesson_unverified', registryVersion: LEARNING_SOURCE_REGISTRY_VERSION } };
const formula = '=SUMIF(A2:A5,D2,B2:B5)';
const feedback = { passed: true, code: 'correct', method: 'deterministic-formula-validation', answer: formula, lessonId: lesson.id, taskId: task.id, actualTotal: 900 };
const accepted = (changes = {}) => createPracticeEvidence({ lesson, task, formula, feedback, origin, checkedAt: at, ...changes });

test('fresh skills and self-declared familiarity stay separate from scoped practice', () => {
  const empty = emptySkills();
  assert.deepEqual(SKILLS.map(({ id }) => id), ['excel-column-total', 'sumif-text-equality']);
  assert.deepEqual(normalizeSkills(null), empty);
  assert.equal(videoValue(empty, source, origin).kind, 'new');
  const basic = setFamiliarity(empty, 'excel-column-total', true, at);
  assert.equal(videoValue(basic, source, origin).kind, 'new');
  const familiar = setFamiliarity(basic, task.skill, true, at);
  assert.equal(videoValue(familiar, source, origin).kind, 'consolidation');
  assert.deepEqual(familiar.evidence, []);
  assert.deepEqual(setFamiliarity(familiar, task.skill, false).familiarity, basic.familiarity);
  assert.deepEqual(empty, emptySkills(), 'mutations cannot change callers');
  assert.deepEqual(setFamiliarity(empty, '__proto__', true, at), empty);
});

test('starting a reviewed step records activity without practice or fabricated title mapping', () => {
  const record = markStarted(emptySkills(), source, at);
  assert.deepEqual(record.activity[task.skill], { startedAt: at, source });
  assert.deepEqual(record.evidence, []);
  assert.equal(videoValue(record, source, origin).kind, 'new');
  const unsupported = { ...source, videoUrl: 'https://www.youtube.com/watch?v=En5cSXgGvZM', title: 'SUMIF tutorial' };
  assert.deepEqual(markStarted(record, unsupported, at), record);
  assert.equal(videoValue(record, unsupported, origin).kind, 'unsupported');
  for (const clip of [{ start: 125, end: 146 }, { start: 0, end: 34 }, { start: 187, end: 200 }])
    assert.equal(videoValue(record, { ...source, ...clip }, origin).kind, 'unsupported');
  assert.equal(videoValue(record, { ...source, start: 88, end: 146 }, origin).kind, 'new');
});

test('only an exact deterministic backend verdict creates evidence; legacy flags never certify practice', () => {
  const evidence = accepted();
  assert.deepEqual(evidence, { skillId: task.skill, lessonId: lesson.id, taskId: task.id, formula, source, registryVersion: LEARNING_SOURCE_REGISTRY_VERSION, origin, checkedAt: at, actualTotal: 900 });
  for (const change of [{ passed: false }, { passed: 'true' }, { code: 'wrong_function' }, { method: 'rule-based' }, { method: undefined }, { lessonId: undefined }, { taskId: undefined }, { lessonId: 'old' }, { taskId: 'old' }, { answer: '=SUM(B2:B5)' }, { answer: undefined }, { actualTotal: NaN }])
    assert.equal(accepted({ feedback: { ...feedback, ...change } }), null, JSON.stringify(change));
  for (const change of [{ skill: 'excel-column-total' }, { sourceVerification: null }, { sourceVerification: { ...lesson.sourceVerification, registryVersion: 'old' } }, { source: { ...source, videoUrl: 'https://www.youtube.com/watch?v=En5cSXgGvZM' } }])
    assert.equal(accepted({ lesson: { ...lesson, ...change } }), null);
  assert.equal(accepted({ task: { id: 'unbound-task', skill: task.skill } }), null);
  assert.equal(accepted({ origin: 'https://delta.example.com/private' }), null);
  assert.equal(accepted({ checkedAt: 'made up' }), null);
  assert.equal(accepted({ checkedAt: undefined }).checkedAt, null, 'old valid feedback retains unknown check time');
});

test('practice evidence changes value only for its reviewed source and assessment origin', () => {
  const record = addPracticeEvidence(emptySkills(), accepted());
  assert.equal(videoValue(record, source, origin).kind, 'review');
  assert.equal(videoValue(record, source, origin).evidence.length, 1);
  assert.equal(videoValue(record, source, 'https://other.example.com').kind, 'new');
  assert.deepEqual(videoValue(record, source, 'https://other.example.com').evidence, []);
  assert.equal(videoValue(record, { ...source, title: 'Another title' }, origin).kind, 'review');
  assert.equal(videoValue(record, { ...source, videoUrl: 'https://www.youtube.com/watch?v=En5cSXgGvZM' }, origin).kind, 'unsupported');
  assert.equal(record.evidence.length, 1, 'unsupported videos cannot delete historical evidence');
});

test('a fresh dataset adds evidence for the same ability; editing never promotes a stale pass', () => {
  const secondTask = { id: 'sumif-practice-taipei-v1', skill: task.skill };
  const extendedLesson = { ...lesson, practiceTasks: [task, secondTask] };
  const first = addPracticeEvidence(emptySkills(), accepted({ lesson: extendedLesson }));
  const nextFeedback = { ...feedback, taskId: secondTask.id, actualTotal: 650 };
  const nextEvidence = accepted({ lesson: extendedLesson, task: secondTask, feedback: nextFeedback });
  const second = addPracticeEvidence(first, nextEvidence);
  assert.equal(second.evidence.length, 2);
  assert.deepEqual([...new Set(second.evidence.map(item => item.skillId))], [task.skill]);
  assert.equal(second.evidence[1].actualTotal, 650);
  assert.equal(accepted({ formula: '=SUM(B2:B5)' }), null);
  assert.deepEqual(addPracticeEvidence(second, null), second, 'the earlier scoped record remains history, rather than certifying an edited draft');
});

test('normalization rejects corrupt records and bounds/deduplicates history without inventing time', () => {
  const evidence = accepted({ checkedAt: undefined });
  let record = addPracticeEvidence(emptySkills(), evidence);
  record = addPracticeEvidence(record, evidence);
  assert.equal(record.evidence.length, 1);
  assert.equal(record.evidence[0].checkedAt, null);
  for (let index = 0; index < 25; index++) record = addPracticeEvidence(record, { ...accepted(), lessonId: `lesson-${index}` });
  assert.equal(record.evidence.length, 20);
  assert.equal(record.evidence[0].lessonId, 'lesson-5');
  const dirty = { ...record, familiarity: { unknown: { confirmedAt: at }, [task.skill]: { confirmedAt: 'bad date' } }, activity: { [task.skill]: { startedAt: at, source: { ...source, start: 200, end: 250 } } }, evidence: [...record.evidence, { ...evidence, origin: 'https://evil.example.com/path' }, { ...evidence, skillId: 'unknown' }], passed: true };
  const normalized = normalizeSkills(dirty);
  assert.deepEqual(normalized.familiarity, {}); assert.deepEqual(normalized.activity, {});
  assert.equal(normalized.evidence.length, 20); assert.equal(Object.hasOwn(normalized, 'passed'), false);
  assert.deepEqual(normalizeSkills({ schemaVersion: 99, familiarity: { [task.skill]: { confirmedAt: at } } }), emptySkills());
});
