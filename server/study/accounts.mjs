import {createHash} from 'node:crypto';
import {StudyError, requireStudy} from './source.mjs';
import {studyProjectBudgetConfig, projectBudgetState, applyProjectBudgetDelta, PROJECT_BUDGET_ENFORCED} from './project-budget.mjs';

const LIMIT_MICROS = 500000;
const AUTHOR_LIMIT_MICROS = 5000000;
const SESSION_LIMIT_MICROS = 100000;
const MAX_SESSIONS = 256;
const MICROS_PER_USD = 1000000;
const RESERVED = 0, FAILED = 1, SETTLED = 2;
const HASH = /^[a-f0-9]{64}$/;
const WEB_FIELDS = ['apiKey', 'authDomain', 'projectId', 'appId'];
const hash = (kind, value) => createHash('sha256').update(`delta-study-credit-${kind}\0${value}`).digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;

function projectId(env) {
  requireStudy(typeof env.FIREBASE_PROJECT_ID === 'string' && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(env.FIREBASE_PROJECT_ID),
    'firebase_configuration_invalid', 503, 'Google sign-in is not configured.');
  return env.FIREBASE_PROJECT_ID;
}

function publicConfig(env) {
  const project = projectId(env);
  let input;
  try {input = typeof env.FIREBASE_WEB_CONFIG === 'string' ? JSON.parse(env.FIREBASE_WEB_CONFIG) : env.FIREBASE_WEB_CONFIG;}
  catch {throw new StudyError('firebase_configuration_invalid', 503, 'Google sign-in is not configured.');}
  requireStudy(record(input) && input.projectId === project, 'firebase_configuration_invalid', 503, 'Google sign-in is not configured.');
  const config = {};
  for (const field of WEB_FIELDS) {
    if (!Object.hasOwn(input, field)) continue;
    requireStudy(typeof input[field] === 'string' && input[field].trim().length > 0 && input[field].length <= 2048,
      'firebase_configuration_invalid', 503, 'Google sign-in is not configured.');
    config[field] = input[field];
  }
  requireStudy(['apiKey', 'authDomain', 'projectId', 'appId'].every(field => config[field]),
    'firebase_configuration_invalid', 503, 'Google sign-in is not configured.');
  const labels = config.authDomain.split('.');
  requireStudy(config.authDomain.length <= 253 && labels.length >= 2
    && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)),
  'firebase_configuration_invalid', 503, 'Google sign-in is not configured.');
  return config;
}

function micros(value, allowZero = false) {
  requireStudy(typeof value === 'number' && Number.isFinite(value) && (allowZero ? value >= 0 : value > 0), 'invalid_credit_amount');
  const amount = Math.ceil(value * MICROS_PER_USD);
  requireStudy(integer(amount), 'invalid_credit_amount');
  return amount;
}

function identifier(value) {
  requireStudy(typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value),
    'invalid_credit_operation');
  return value;
}

const emptyAccount = () => ({schemaVersion: 2, limitMicros: LIMIT_MICROS, reservedMicros: 0, spentMicros: 0, sessions: {}});
function accountState(value, maximumLimitMicros = LIMIT_MICROS) {
  if (value === null) return emptyAccount();
  requireStudy(record(value) && [1, 2].includes(value.schemaVersion)
    && integer(value.limitMicros) && value.limitMicros >= LIMIT_MICROS && value.limitMicros <= maximumLimitMicros
    && integer(value.reservedMicros) && value.reservedMicros <= value.limitMicros && integer(value.spentMicros)
    && Object.keys(value).every(key => ['schemaVersion', 'limitMicros', 'reservedMicros', 'spentMicros',
      ...(value.schemaVersion === 2 ? ['sessions'] : [])].includes(key)),
  'credit_ledger_invalid', 503, 'Your saved credit balance could not be verified.');
  if (value.schemaVersion === 1) {
    requireStudy(value.limitMicros === LIMIT_MICROS && value.reservedMicros === 0 && value.spentMicros === 0, 'credit_ledger_invalid', 503,
      'Existing credit use requires verified session accounting.');
    return emptyAccount();
  }
  requireStudy(record(value.sessions) && Object.keys(value.sessions).length <= MAX_SESSIONS, 'credit_ledger_invalid', 503);
  let reservedMicros = 0, spentMicros = 0;
  const sessions = {};
  for (const [key, session] of Object.entries(value.sessions)) {
    requireStudy(HASH.test(key) && record(session) && integer(session.reservedMicros) && session.reservedMicros < SESSION_LIMIT_MICROS
      && integer(session.spentMicros) && Object.keys(session).every(field => ['reservedMicros', 'spentMicros'].includes(field)),
    'credit_ledger_invalid', 503, 'Your saved session credit could not be verified.');
    reservedMicros += session.reservedMicros; spentMicros += session.spentMicros;
    sessions[key] = {...session};
  }
  requireStudy(integer(reservedMicros) && integer(spentMicros) && reservedMicros === value.reservedMicros && spentMicros === value.spentMicros,
    'credit_ledger_invalid', 503, 'Your saved credit totals could not be verified.');
  return {...value, sessions};
}

function operationState(value, account, hasAccount) {
  if (value === null) return null;
  const sessionKeys = record(value?.session) ? Object.keys(value.session) : [];
  const session = account.sessions[sessionKeys[0]];
  requireStudy(hasAccount && record(value) && value.schemaVersion === 1 && [RESERVED, FAILED, SETTLED].includes(value.status)
    && integer(value.reservedMicros) && value.reservedMicros > 0 && value.reservedMicros < SESSION_LIMIT_MICROS
    && integer(value.actualMicros) && integer(value.createdAtMs) && integer(value.updatedAtMs)
    && sessionKeys.length === 1 && HASH.test(sessionKeys[0]) && value.session[sessionKeys[0]] === 1 && session
    && Object.keys(value).every(key => ['schemaVersion', 'status', 'reservedMicros', 'actualMicros', 'session', 'createdAtMs', 'updatedAtMs'].includes(key))
    && (value.status === SETTLED ? session.spentMicros >= value.actualMicros : value.actualMicros === 0 && session.reservedMicros >= value.reservedMicros),
  'credit_ledger_invalid', 503, 'Your saved credit reservation could not be verified.');
  return {...value, session: {...value.session}};
}

function snapshot(account) {
  return {limitUsd: account.limitMicros / MICROS_PER_USD, reservedUsd: account.reservedMicros / MICROS_PER_USD,
    spentUsd: account.spentMicros / MICROS_PER_USD,
    remainingUsd: Math.max(0, account.limitMicros - account.reservedMicros - account.spentMicros) / MICROS_PER_USD};
}
const exhausted = () => new StudyError('study_credit_exhausted', 402, 'Your lifetime AI credit is used or reserved. Saved lessons remain available.');
const stateName = operation => ['reserved', 'failed', 'settled'][operation.status];

// Store seam: transact(uidHash, operationHash|null, reducer) atomically reads
// account/operation records and applies {account?, operation?, result}. Reducers contain no
// inference or other external side effects: Firestore may run them again.
export function createStudyAccounts({env = process.env, auth, store, now = Date.now} = {}) {
  // Server-only policy permits a separately authorized limit-only grant. It
  // never grants on read, changes defaults or accepts a client-supplied UID.
  const authorKey = env.STUDY_AUTHOR_UID_HASH;
  requireStudy(authorKey === undefined || typeof authorKey === 'string' && HASH.test(authorKey),
    'firebase_configuration_invalid', 503, 'AI allowance policy is not configured.');
  const timestamp = () => {const value = now(); requireStudy(integer(value), 'credit_ledger_invalid', 503); return value;};
  async function transaction(userKey, operationKey, reduce) {
    requireStudy(typeof store?.transact === 'function', 'credit_ledger_unavailable', 503, 'AI credit verification is unavailable.');
    try {
      return await store.transact(userKey, operationKey, (savedAccount, savedOperation) => {
        const account = accountState(savedAccount, userKey === authorKey ? AUTHOR_LIMIT_MICROS : LIMIT_MICROS);
        const operation = operationState(savedOperation, account, savedAccount !== null);
        return reduce(account, operation);
      });
    } catch (error) {
      if (error instanceof StudyError) throw error;
      throw new StudyError('credit_ledger_unavailable', 503, 'AI credit verification is unavailable.');
    }
  }
  return {
    [PROJECT_BUDGET_ENFORCED]: env.GEMINI_PAID_BUDGET_APPROVED === 'true' && store?.[PROJECT_BUDGET_ENFORCED] === true,
    config: () => ({enabled: true, firebase: publicConfig(env), limitUsd: LIMIT_MICROS / MICROS_PER_USD}),
    async authenticate(request) {
      const header = typeof request?.headers?.get === 'function' ? request.headers.get('authorization') : request?.headers?.authorization;
      const match = typeof header === 'string' ? /^Bearer ([A-Za-z0-9._-]{1,8192})$/i.exec(header) : null;
      if (!match) throw new StudyError('authentication_required', 401, 'Sign in with Google to use AI credit.');
      const project = projectId(env);
      requireStudy(typeof auth?.verifyIdToken === 'function', 'firebase_configuration_invalid', 503, 'Google sign-in is not configured.');
      try {
        const token = await auth.verifyIdToken(match[1], true);
        requireStudy(typeof token?.uid === 'string' && token.uid.length > 0 && token.uid.length <= 128 && token.uid === token.sub
          && token.aud === project && token.iss === `https://securetoken.google.com/${project}`
          && token.firebase?.sign_in_provider === 'google.com' && token.email_verified === true
          && typeof token.email === 'string' && token.email.trim().length > 0, 'authentication_required', 401);
        return {uid: token.uid};
      } catch {throw new StudyError('authentication_required', 401, 'Sign in with Google to use AI credit.');}
    },
    // Only pass the UID returned by authenticate(), never a client body value.
    forUser(uid) {
      projectId(env);
      requireStudy(typeof uid === 'string' && uid.length > 0 && uid.length <= 128, 'authentication_required', 401);
      const userKey = hash('uid', uid);
      const transact = (operationId, reduce) => transaction(userKey, operationId === null ? null : hash('operation', identifier(operationId)), reduce);
      return {
        snapshot: () => transact(null, account => ({result: snapshot(account)})),
        async session(sessionId) {
          const sessionKey = hash('session', identifier(sessionId));
          return transact(null, account => {
            const session = account.sessions[sessionKey];
            const reservedMicros = session?.reservedMicros ?? 0, spentMicros = session?.spentMicros ?? 0;
            // Presence is distinct from remaining allowance. Missing history
            // never creates a session or authorizes replacement generation.
            return {result: {available: Boolean(session), conservativeUsd: (reservedMicros + spentMicros) / MICROS_PER_USD,
              reservedUsd: reservedMicros / MICROS_PER_USD, spentUsd: spentMicros / MICROS_PER_USD,
              limitUsd: SESSION_LIMIT_MICROS / MICROS_PER_USD}};
          });
        },
        check: () => transact(null, account => {
          if (account.reservedMicros + account.spentMicros >= account.limitMicros) throw exhausted();
          return {result: snapshot(account)};
        }),
        async reserve({operationId, sessionId, amountUsd} = {}) {
          identifier(operationId);
          const amount = micros(amountUsd), sessionKey = hash('session', identifier(sessionId));
          return transact(operationId, (account, operation) => {
            if (operation) {
              requireStudy(operation.reservedMicros === amount && operation.session[sessionKey] === 1, 'credit_operation_conflict', 409);
              return {result: {...snapshot(account), created: false, operationState: stateName(operation)}};
            }
            if (amount > account.limitMicros - account.reservedMicros - account.spentMicros) throw exhausted();
            const session = account.sessions[sessionKey] || {reservedMicros: 0, spentMicros: 0};
            requireStudy(Object.hasOwn(account.sessions, sessionKey) || Object.keys(account.sessions).length < MAX_SESSIONS,
              'credit_ledger_capacity', 503, 'Your AI credit session ledger is full. Saved lessons remain available.');
            requireStudy(session.reservedMicros + session.spentMicros + amount < SESSION_LIMIT_MICROS,
              'video_budget_exceeded', 429, 'This learning session has reached its US$0.10 AI budget. Saved lessons remain available.');
            account.reservedMicros += amount;
            session.reservedMicros += amount;
            account.sessions[sessionKey] = session;
            const at = timestamp();
            return {account, operation: {schemaVersion: 1, status: RESERVED, reservedMicros: amount, actualMicros: 0,
              session: {[sessionKey]: 1}, createdAtMs: at, updatedAtMs: at},
            result: {...snapshot(account), created: true, operationState: 'reserved'}};
          });
        },
        async settle({operationId, actualUsd} = {}) {
          identifier(operationId);
          const actual = micros(actualUsd, true);
          return transact(operationId, (account, operation) => {
            requireStudy(operation, 'credit_operation_not_found', 409);
            if (operation.status === SETTLED) {
              requireStudy(operation.actualMicros === actual, 'credit_operation_conflict', 409);
              return {result: snapshot(account)};
            }
            const session = account.sessions[Object.keys(operation.session)[0]];
            requireStudy(integer(account.spentMicros + actual) && integer(session.spentMicros + actual), 'invalid_credit_amount');
            account.reservedMicros -= operation.reservedMicros;
            account.spentMicros += actual;
            session.reservedMicros -= operation.reservedMicros;
            session.spentMicros += actual;
            Object.assign(operation, {status: SETTLED, actualMicros: actual, updatedAtMs: timestamp()});
            return {account, operation, result: snapshot(account)};
          });
        },
        async failure({operationId} = {}) {
          identifier(operationId);
          return transact(operationId, (account, operation) => {
            requireStudy(operation, 'credit_operation_not_found', 409);
            if (operation.status !== RESERVED) return {result: snapshot(account)};
            // Unknown provider usage is never refunded. Usage/diagnostic bodies
            // belong in safe session receipts, never in this identity ledger.
            Object.assign(operation, {status: FAILED, updatedAtMs: timestamp()});
            return {account, operation, result: snapshot(account)};
          });
        },
      };
    },
  };
}

// Server SDK access uses ADC/IAM. Browser Firestore rules must deny access to
// studyCredits and its operation subcollections; no client ledger API exists.
export function createFirestoreStudyAccountStore(firestore, {env = process.env} = {}) {
  const budgetConfig = studyProjectBudgetConfig(env);
  const budgetRef = budgetConfig ? firestore.collection(budgetConfig.collection).doc(budgetConfig.document) : null;
  return {
    [PROJECT_BUDGET_ENFORCED]: Boolean(budgetRef),
    async transact(userKey, operationKey, reduce) {
      requireStudy(HASH.test(userKey) && (operationKey === null || HASH.test(operationKey)), 'invalid_credit_operation');
      const accountRef = firestore.collection('studyCredits').doc(userKey);
      const operationRef = operationKey === null ? null : accountRef.collection('operations').doc(operationKey);
      return firestore.runTransaction(async transaction => {
        // Every read precedes every write, including the shared project ledger.
        // The fixed global document creates contention across all user IDs.
        const budget = budgetRef ? await transaction.get(budgetRef) : null;
        const account = await transaction.get(accountRef);
        const operation = operationRef ? await transaction.get(operationRef) : null;
        const savedBudget = budgetRef ? projectBudgetState(budget.exists ? budget.data() : null) : null;
        const savedAccount = account.exists ? account.data() : null;
        // Capture counters before a reducer can mutate its own account copy.
        const before = savedAccount === null ? null : {reservedMicros: savedAccount.reservedMicros, spentMicros: savedAccount.spentMicros};
        const update = await reduce(savedAccount, operation?.exists ? operation.data() : null);
        const nextBudget = budgetRef && Object.hasOwn(update, 'account')
          ? applyProjectBudgetDelta(savedBudget, before, update.account) : null;
        if (nextBudget && (nextBudget.reservedMicros !== savedBudget.reservedMicros || nextBudget.spentMicros !== savedBudget.spentMicros)) {
          transaction.set(budgetRef, nextBudget);
        }
        if (Object.hasOwn(update, 'account')) transaction.set(accountRef, update.account);
        if (Object.hasOwn(update, 'operation')) transaction.set(operationRef, update.operation);
        return update.result;
      });
    },
  };
}

export async function createFirebaseStudyAccounts({env = process.env, now = Date.now} = {}) {
  const project = projectId(env);
  publicConfig(env);
  studyProjectBudgetConfig(env);
  requireStudy(!env.FIREBASE_AUTH_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST
    && !env.FIRESTORE_EMULATOR_HOST && !process.env.FIRESTORE_EMULATOR_HOST,
  'firebase_configuration_invalid', 503, 'Google sign-in and AI credit require production services.');
  try {
    const [{initializeApp, getApps, applicationDefault}, {getAuth}, {getFirestore}] = await Promise.all([
      import('firebase-admin/app'), import('firebase-admin/auth'), import('firebase-admin/firestore'),
    ]);
    const name = `delta-study-accounts-${project}`;
    const app = getApps().find(candidate => candidate.name === name)
      || initializeApp({projectId: project, credential: applicationDefault()}, name);
    requireStudy(app.options.projectId === project, 'firebase_configuration_invalid', 503);
    return createStudyAccounts({env, auth: getAuth(app), store: createFirestoreStudyAccountStore(getFirestore(app), {env}), now});
  } catch (error) {
    if (error instanceof StudyError) throw error;
    throw new StudyError('firebase_configuration_invalid', 503, 'Google sign-in is not configured.');
  }
}
