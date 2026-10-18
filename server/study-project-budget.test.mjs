import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createStudyAccounts, createFirestoreStudyAccountStore, createFirebaseStudyAccounts} from './study/accounts.mjs';
import {STUDY_PROJECT_BUDGET_PATH, studyProjectBudgetConfig, projectBudgetState, applyProjectBudgetDelta} from './study/project-budget.mjs';

const env = {FIREBASE_PROJECT_ID: 'delta-test-project', GEMINI_PAID_BUDGET_APPROVED: 'true', STUDY_PROJECT_BUDGET_USD: '10',
  FIREBASE_WEB_CONFIG: JSON.stringify({apiKey: 'public-web-key', authDomain: 'delta-test-project.firebaseapp.com',
    projectId: 'delta-test-project', appId: 'public-app-id'})};
const budget = (reservedMicros = 0, spentMicros = 0) => ({schemaVersion: 1, limitMicros: 10000000, reservedMicros, spentMicros});
const key = (kind, value) => createHash('sha256').update(`delta-study-credit-${kind}\0${value}`).digest('hex');
const reserve = (user, id = 'one', amountUsd = .04) => user.reserve({operationId: id, sessionId: `session-${id}`, amountUsd});

// Stage writes until commit and serialize on the shared project document, not
// the UID. A discarded optimistic callback cannot change durable records.
function fixture({initialBudget = budget(), retry = false, paid = true} = {}) {
  const records = new Map(initialBudget === null ? [] : [[STUDY_PROJECT_BUDGET_PATH, structuredClone(initialBudget)]]);
  const calls = [];
  let queue = Promise.resolve(), attempts = 0;
  const reference = path => ({path, collection: name => ({doc: id => reference(`${path}/${name}/${id}`)})});
  const firestore = {collection: name => ({doc: id => reference(`${name}/${id}`)}), runTransaction(run) {
    const next = queue.catch(() => {}).then(async () => {
      for (let attempt = 0; attempt < (retry ? 2 : 1); attempt++) {
        let wrote = false;
        const writes = [], trace = [];
        const result = await run({async get(ref) {
          assert.equal(wrote, false, 'all reads must precede every write');
          trace.push(['get', ref.path]);
          return {exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path))};
        }, set(ref, value) {wrote = true; trace.push(['set', ref.path]); writes.push([ref.path, structuredClone(value)]);}});
        attempts++;
        calls.push(trace);
        if (retry && attempt === 0) continue;
        for (const [path, value] of writes) records.set(path, value);
        return structuredClone(result);
      }
    });
    queue = next;
    return next;
  }};
  const configured = paid ? env : {...env, GEMINI_PAID_BUDGET_APPROVED: 'false'};
  const accounts = (overrides = {}) => {
    const accountEnv = {...configured, ...overrides};
    return createStudyAccounts({env: accountEnv,
      store: createFirestoreStudyAccountStore(firestore, {env: accountEnv}), now: () => 1234});
  };
  return {records, calls, accounts, get attempts() {return attempts;}};
}

test('paid budget requires the exact approved ten-dollar configuration before SDK access', async () => {
  assert.equal(STUDY_PROJECT_BUDGET_PATH, 'studyProjectBudgets/kol-gemini-launch-v1');
  assert.deepEqual(studyProjectBudgetConfig(env), {collection: 'studyProjectBudgets', document: 'kol-gemini-launch-v1'});
  for (const value of [undefined, '', '0', '9', '10.0', '100', 10]) {
    const invalid = {...env, STUDY_PROJECT_BUDGET_USD: value};
    assert.throws(() => studyProjectBudgetConfig(invalid), {code: 'project_budget_configuration_invalid', status: 503});
    assert.throws(() => createFirestoreStudyAccountStore({}, {env: invalid}), {code: 'project_budget_configuration_invalid'});
    await assert.rejects(createFirebaseStudyAccounts({env: invalid}), {code: 'project_budget_configuration_invalid'});
  }
  assert.equal(studyProjectBudgetConfig({}), null);
});

test('budget shape and every monetary integer are strict without rejecting a recorded overrun', () => {
  const invalid = [null, {}, {...budget(), schemaVersion: 2}, {...budget(), limitMicros: 9999999},
    {...budget(), reservedMicros: -1}, {...budget(), spentMicros: .5}, {...budget(), spentMicros: Infinity},
    {...budget(), spentMicros: Number.MAX_SAFE_INTEGER + 1}, {...budget(), extra: 1},
    {...budget(), spentMicros: '0'}];
  for (const value of invalid) assert.throws(() => projectBudgetState(value), {code: 'project_budget_unavailable', status: 503});
  assert.deepEqual(projectBudgetState(budget(40000, 10001000)), budget(40000, 10001000));
});

test('missing or malformed project ledger never initializes, grants or mutates an account', async () => {
  for (const initialBudget of [null, {...budget(), limitMicros: 500000}, {...budget(), extra: 1}]) {
    const f = fixture({initialBudget});
    const before = structuredClone([...f.records]);
    const user = f.accounts().forUser('new-user');
    await assert.rejects(user.snapshot(), {code: 'project_budget_unavailable'});
    await assert.rejects(reserve(user), {code: 'project_budget_unavailable'});
    assert.deepEqual([...f.records], before);
  }
});

test('paid reserve reads project, account and operation before atomically writing all three', async () => {
  const f = fixture();
  await reserve(f.accounts().forUser('user-a'));
  assert.deepEqual(f.calls[0].map(([action]) => action), ['get', 'get', 'get', 'set', 'set', 'set']);
  assert.equal(f.calls[0][0][1], STUDY_PROJECT_BUDGET_PATH);
  assert.match(f.calls[0][1][1], /^studyCredits\/[a-f0-9]{64}$/);
  assert.match(f.calls[0][2][1], /^studyCredits\/[a-f0-9]{64}\/operations\/[a-f0-9]{64}$/);
  assert.deepEqual(f.records.get(STUDY_PROJECT_BUDGET_PATH), budget(40000));
  await f.accounts().forUser('user-a').snapshot();
  assert.deepEqual(f.calls[1], [['get', STUDY_PROJECT_BUDGET_PATH], ['get', f.calls[0][1][1]]]);
});

test('different UIDs and store instances share the last project credits under concurrent admission', async () => {
  const f = fixture({initialBudget: budget(0, 9950000)});
  const users = Array.from({length: 8}, (_, i) => f.accounts().forUser(`user-${i}`));
  const result = await Promise.allSettled(users.map(user => reserve(user)));
  assert.equal(result.filter(value => value.status === 'fulfilled').length, 1);
  assert.ok(result.filter(value => value.status === 'rejected').every(value => value.reason.code === 'project_budget_exhausted'));
  assert.deepEqual(f.records.get(STUDY_PROJECT_BUDGET_PATH), budget(40000, 9950000));
  assert.equal([...f.records.keys()].filter(path => /^studyCredits\/[^/]+$/.test(path)).length, 1);
  await reserve(f.accounts().forUser('last-user'), 'last', .01);
  assert.deepEqual(f.records.get(STUDY_PROJECT_BUDGET_PATH), budget(50000, 9950000));
  await assert.rejects(reserve(f.accounts().forUser('another-user'), 'blocked', .000001), {code: 'project_budget_exhausted', status: 429});
});

test('exact exhaustion preserves reads, reservation replay, failure holds and settlement recovery', async () => {
  const f = fixture({initialBudget: budget(0, 9960000)});
  const user = f.accounts().forUser('user-a');
  await reserve(user);
  assert.equal((await user.snapshot()).reservedUsd, .04);
  assert.equal((await user.session('session-one')).reservedUsd, .04);
  assert.equal((await reserve(user)).created, false);
  await user.failure({operationId: 'one'});
  assert.deepEqual(f.records.get(STUDY_PROJECT_BUDGET_PATH), budget(40000, 9960000));
  await user.settle({operationId: 'one', actualUsd: .02});
  assert.deepEqual(f.records.get(STUDY_PROJECT_BUDGET_PATH), budget(0, 9980000));
  await reserve(f.accounts().forUser('user-b'), 'remaining', .02);
  assert.deepEqual(f.records.get(STUDY_PROJECT_BUDGET_PATH), budget(20000, 9980000));
});

test('idempotent retries, a process restart and Firestore callback retries never double count', async () => {
  const f = fixture({retry: true});
  await reserve(f.accounts().forUser('user-a'));
  assert.equal(f.attempts, 2);
  assert.equal((await reserve(f.accounts().forUser('user-a'))).created, false);
  const restarted = f.accounts().forUser('user-a');
  await restarted.settle({operationId: 'one', actualUsd: .03});
  await restarted.settle({operationId: 'one', actualUsd: .03});
  assert.deepEqual(f.records.get(STUDY_PROJECT_BUDGET_PATH), budget(0, 30000));
  assert.equal((await restarted.snapshot()).spentUsd, .03);
});

test('preexisting free-mode failed reservations settle against a seed containing their exact aggregates', async () => {
  const f = fixture({paid: false});
  const user = f.accounts().forUser('existing-user');
  await reserve(user);
  await user.failure({operationId: 'one'});
  f.records.set(STUDY_PROJECT_BUDGET_PATH, budget(40000, 123000));
  const paid = f.accounts({GEMINI_PAID_BUDGET_APPROVED: 'true'}).forUser('existing-user');
  await paid.settle({operationId: 'one', actualUsd: .025});
  assert.deepEqual(f.records.get(STUDY_PROJECT_BUDGET_PATH), budget(0, 148000));
  assert.equal((await paid.snapshot()).spentUsd, .025);
});

test('provider actual above its reservation is retained even across the cap and blocks future admission', async () => {
  const f = fixture({initialBudget: budget(0, 9960000)});
  const user = f.accounts().forUser('user-a');
  await reserve(user);
  await user.settle({operationId: 'one', actualUsd: .05});
  assert.deepEqual(f.records.get(STUDY_PROJECT_BUDGET_PATH), budget(0, 10010000));
  assert.equal((await user.snapshot()).spentUsd, .05);
  await user.settle({operationId: 'one', actualUsd: .05});
  await assert.rejects(reserve(f.accounts().forUser('new-user')), {code: 'project_budget_exhausted'});
  assert.deepEqual(f.records.get(STUDY_PROJECT_BUDGET_PATH), budget(0, 10010000));
});

test('aggregate underflow, decreasing spend and unsafe sums cannot erase accounting', () => {
  const account = {reservedMicros: 40000, spentMicros: 20000};
  assert.deepEqual(applyProjectBudgetDelta(budget(0, Number.MAX_SAFE_INTEGER),
    {reservedMicros: 0, spentMicros: 20000}, {reservedMicros: 0, spentMicros: 20000}), budget(0, Number.MAX_SAFE_INTEGER));
  for (const [saved, before, after] of [
    [budget(30000, 20000), account, {reservedMicros: 0, spentMicros: 30000}],
    [budget(40000, 20000), account, {reservedMicros: 40000, spentMicros: 10000}],
    [budget(40000, Number.MAX_SAFE_INTEGER), account, {reservedMicros: 0, spentMicros: 60000}],
  ]) assert.throws(() => applyProjectBudgetDelta(saved, before, after), {code: 'project_budget_unavailable'});
});

test('free mode keeps its existing account-only path without requiring or creating a project ledger', async () => {
  const f = fixture({initialBudget: null, paid: false});
  await reserve(f.accounts().forUser('free-user'));
  assert.deepEqual(f.calls[0].map(([action]) => action), ['get', 'get', 'set', 'set']);
  assert.equal(f.records.has(STUDY_PROJECT_BUDGET_PATH), false);
  assert.equal((await f.accounts().forUser('free-user').snapshot()).limitUsd, .5);
});

test('author allowance and per-session strict tenth-dollar bound remain independent of project capacity', async () => {
  const f = fixture();
  const uid = 'author-test-user', authorKey = key('uid', uid), sessionKey = key('session', 'old-session');
  f.records.set(`studyCredits/${authorKey}`, {schemaVersion: 2, limitMicros: 5000000, reservedMicros: 0, spentMicros: 60000,
    sessions: {[sessionKey]: {reservedMicros: 0, spentMicros: 60000}}});
  f.records.set(STUDY_PROJECT_BUDGET_PATH, budget(0, 60000));
  const accounts = f.accounts({STUDY_AUTHOR_UID_HASH: authorKey});
  const basic = accounts.forUser('ordinary-user');
  const author = accounts.forUser(uid);
  assert.equal((await basic.snapshot()).limitUsd, .5);
  assert.equal((await author.snapshot()).limitUsd, 5);
  await reserve(author, 'author-next', .04);
  assert.deepEqual(f.records.get(STUDY_PROJECT_BUDGET_PATH), budget(40000, 60000));
  assert.equal((await author.snapshot()).reservedUsd, .04);
  await assert.rejects(reserve(basic, 'strict-session', .1), {code: 'video_budget_exceeded'});
});

test('an overrun cannot prevent settlement of another already reserved operation', async () => {
  const f = fixture({initialBudget: budget(0, 9920000)});
  const first = f.accounts().forUser('user-a'), second = f.accounts().forUser('user-b');
  await reserve(first);
  await reserve(second);
  await first.settle({operationId: 'one', actualUsd: .06});
  assert.deepEqual(f.records.get(STUDY_PROJECT_BUDGET_PATH), budget(40000, 9980000));
  await second.settle({operationId: 'one', actualUsd: .05});
  assert.deepEqual(f.records.get(STUDY_PROJECT_BUDGET_PATH), budget(0, 10030000));
  assert.equal((await first.snapshot()).spentUsd, .06);
  assert.equal((await second.snapshot()).spentUsd, .05);
});

test('an underseeded aggregate rejects settlement before any user or operation write', async () => {
  const f = fixture();
  const user = f.accounts().forUser('user-a');
  await reserve(user);
  f.records.set(STUDY_PROJECT_BUDGET_PATH, budget());
  const before = structuredClone([...f.records]);
  await assert.rejects(user.settle({operationId: 'one', actualUsd: .03}), {code: 'project_budget_unavailable'});
  assert.deepEqual([...f.records], before);
});
