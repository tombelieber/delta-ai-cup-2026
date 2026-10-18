import {StudyError, requireStudy} from './source.mjs';

export const STUDY_PROJECT_BUDGET_PATH = 'studyProjectBudgets/kol-gemini-launch-v1';
// Server-owned capability: request JSON cannot supply this store wiring proof.
export const PROJECT_BUDGET_ENFORCED = Symbol('Delta durable project budget');
const LIMIT_MICROS = 10000000;
const FIELDS = ['schemaVersion', 'limitMicros', 'reservedMicros', 'spentMicros'];
const integer = value => Number.isSafeInteger(value) && value >= 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const unavailable = condition => requireStudy(condition, 'project_budget_unavailable', 503,
  'Project AI budget verification is unavailable. Saved lessons remain available.');

export function studyProjectBudgetConfig(env = process.env) {
  if (env.GEMINI_PAID_BUDGET_APPROVED !== 'true') return null;
  requireStudy(env.STUDY_PROJECT_BUDGET_USD === '10', 'project_budget_configuration_invalid', 503,
    'Project AI budget is not configured.');
  const [collection, document] = STUDY_PROJECT_BUDGET_PATH.split('/');
  return {collection, document};
}

// Existing, administratively seeded state only. Actual usage may take spend
// above the ceiling: retaining that accounting must not make settlement or
// saved-content reads inaccessible.
export function projectBudgetState(value) {
  unavailable(record(value) && Object.keys(value).length === FIELDS.length
    && Object.keys(value).every(field => FIELDS.includes(field))
    && value.schemaVersion === 1 && value.limitMicros === LIMIT_MICROS
    && integer(value.reservedMicros) && integer(value.spentMicros)
    && integer(value.reservedMicros + value.spentMicros));
  return {...value};
}

function counters(account) {
  if (account === null) return {reservedMicros: 0, spentMicros: 0};
  unavailable(record(account) && integer(account.reservedMicros) && integer(account.spentMicros));
  return {reservedMicros: account.reservedMicros, spentMicros: account.spentMicros};
}

// Pure transition: Firestore may re-run it. No initialization, resets, grants,
// inference or other external side effects are allowed in this reducer.
export function applyProjectBudgetDelta(saved, oldAccount, newAccount) {
  const state = projectBudgetState(saved), before = counters(oldAccount), after = counters(newAccount);
  unavailable(state.reservedMicros >= before.reservedMicros && state.spentMicros >= before.spentMicros
    && after.spentMicros >= before.spentMicros);
  const reservedDelta = after.reservedMicros - before.reservedMicros;
  const spentDelta = after.spentMicros - before.spentMicros;
  const next = {...state, reservedMicros: state.reservedMicros + reservedDelta,
    spentMicros: state.spentMicros + spentDelta};
  unavailable(integer(next.reservedMicros) && integer(next.spentMicros)
    && integer(next.reservedMicros + next.spentMicros));
  if (reservedDelta > 0 && next.reservedMicros + next.spentMicros > LIMIT_MICROS) {
    throw new StudyError('project_budget_exhausted', 429,
      'Project AI budget is used or reserved. Saved lessons remain available.');
  }
  return next;
}
