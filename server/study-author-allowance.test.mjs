import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createStudyAccounts} from './study/accounts.mjs';

const authorUid = 'synthetic-author', ordinaryUid = 'synthetic-ordinary';
const uidHash = uid => createHash('sha256').update(`delta-study-credit-uid\0${uid}`).digest('hex');
const authorHash = uidHash(authorUid);
const project = 'synthetic-credit-project';
const env = {FIREBASE_PROJECT_ID: project, STUDY_AUTHOR_UID_HASH: authorHash,
  FIREBASE_WEB_CONFIG: JSON.stringify({apiKey: 'public-web-key', authDomain: `${project}.firebaseapp.com`, projectId: project, appId: 'public-app'})};

class MemoryStore {
  accounts = new Map(); operations = new Map(); queues = new Map();
  transact(user, operation, reduce) {
    const next = (this.queues.get(user) || Promise.resolve()).catch(() => {}).then(async () => {
      const operationKey = `${user}/${operation}`;
      const update = await reduce(structuredClone(this.accounts.get(user) ?? null), structuredClone(this.operations.get(operationKey) ?? null));
      if (Object.hasOwn(update, 'account')) this.accounts.set(user, structuredClone(update.account));
      if (Object.hasOwn(update, 'operation')) this.operations.set(operationKey, structuredClone(update.operation));
      return structuredClone(update.result);
    });
    this.queues.set(user, next);
    return next;
  }
}
function setup(settings = env, store = new MemoryStore(), auth) {
  const accounts = createStudyAccounts({env: settings, store, auth});
  return {accounts, store};
}
function seedGranted(store, uid = authorUid, limitMicros = 5000000) {
  store.accounts.set(uidHash(uid), {schemaVersion: 2, limitMicros, reservedMicros: 0, spentMicros: 0, sessions: {}});
}
const reserve = (user, operationId, amountUsd, sessionId = operationId) => user.reserve({operationId, sessionId, amountUsd});

test('the author policy does not grant credit on read or change new-user and public defaults', async () => {
  const {accounts, store} = setup();
  for (const uid of [authorUid, ordinaryUid]) {
    assert.deepEqual(await accounts.forUser(uid).snapshot(), {limitUsd: .5, reservedUsd: 0, spentUsd: 0, remainingUsd: .5});
  }
  assert.equal(store.accounts.size, 0);
  const config = accounts.config();
  assert.equal(config.limitUsd, .5);
  assert.ok(!JSON.stringify(config).includes(authorHash));
  assert.ok(!JSON.stringify(config).includes(authorUid));
});

test('an authorized limit-only grant preserves spent, reserved, sessions and operations across restart', async () => {
  const {accounts, store} = setup(); const user = accounts.forUser(authorUid);
  await reserve(user, 'settled', .04); await user.settle({operationId: 'settled', actualUsd: .01});
  await reserve(user, 'unknown', .03); await user.failure({operationId: 'unknown'});
  const before = structuredClone(store.accounts.get(authorHash));
  const operations = structuredClone([...store.operations]);
  // Models a separately authorized Admin transaction changing only this field.
  store.accounts.get(authorHash).limitMicros = 5000000;
  const restarted = setup(env, store).accounts.forUser(authorUid);
  assert.deepEqual(await restarted.snapshot(), {limitUsd: 5, reservedUsd: .03, spentUsd: .01, remainingUsd: 4.96});
  const after = store.accounts.get(authorHash);
  assert.deepEqual({...after, limitMicros: before.limitMicros}, before);
  assert.deepEqual([...store.operations], operations);
  assert.deepEqual(await restarted.session('unknown'), {available: true, conservativeUsd: .03, reservedUsd: .03, spentUsd: 0, limitUsd: .1});
  await restarted.settle({operationId: 'unknown', actualUsd: .02});
  assert.deepEqual(await restarted.snapshot(), {limitUsd: 5, reservedUsd: 0, spentUsd: .03, remainingUsd: 4.97});
  await restarted.settle({operationId: 'unknown', actualUsd: .02});
  assert.equal((await restarted.snapshot()).spentUsd, .03);
});

test('only the configured UID hash can use the larger persisted allowance', async () => {
  const {accounts, store} = setup();
  seedGranted(store); seedGranted(store, ordinaryUid);
  assert.equal((await accounts.forUser(authorUid).check()).remainingUsd, 5);
  await assert.rejects(accounts.forUser(ordinaryUid).snapshot(), {code: 'credit_ledger_invalid'});
  await assert.rejects(reserve(accounts.forUser(ordinaryUid), 'forged-grant', .01), {code: 'credit_ledger_invalid'});
  assert.equal(store.operations.size, 0);
  for (const limitMicros of [5000001, 6000000, 0, -1, 500000.5]) {
    seedGranted(store, authorUid, limitMicros);
    await assert.rejects(accounts.forUser(authorUid).snapshot(), {code: 'credit_ledger_invalid'});
  }
});

test('author reservations can exceed the ordinary allowance but cannot race past the authorized lifetime limit', async () => {
  const {accounts, store} = setup(); seedGranted(store);
  const users = Array.from({length: 60}, () => setup(env, store).accounts.forUser(authorUid));
  const results = await Promise.allSettled(users.map((user, i) => reserve(user, `parallel-${i}`, .09)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 55);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'study_credit_exhausted').length, 5);
  assert.deepEqual(await accounts.forUser(authorUid).snapshot(), {limitUsd: 5, reservedUsd: 4.95, spentUsd: 0, remainingUsd: .05});
  await reserve(users[0], 'last-credit', .05);
  assert.deepEqual(await users[0].snapshot(), {limitUsd: 5, reservedUsd: 5, spentUsd: 0, remainingUsd: 0});
  await assert.rejects(reserve(users[0], 'over-credit', .000001), {code: 'study_credit_exhausted'});
});

test('the granted author still cannot reach the strict US$0.10 session boundary', async () => {
  const {accounts, store} = setup(); seedGranted(store); const user = accounts.forUser(authorUid);
  await reserve(user, 'first', .06, 'same-session');
  await assert.rejects(reserve(user, 'equal-boundary', .04, 'same-session'), {code: 'video_budget_exceeded'});
  await reserve(user, 'below-boundary', .039999, 'same-session');
  await assert.rejects(reserve(user, 'one-micro-over', .000001, 'same-session'), {code: 'video_budget_exceeded'});
  assert.deepEqual(await user.session('same-session'), {available: true, conservativeUsd: .099999, reservedUsd: .099999, spentUsd: 0, limitUsd: .1});
});

test('claiming the author email or client UID does not elevate a different verified UID', async () => {
  const {accounts, store} = setup(env, undefined, {verifyIdToken: async () => ({uid: ordinaryUid, sub: ordinaryUid,
    aud: project, iss: `https://securetoken.google.com/${project}`, email: 'author@example.test', email_verified: true,
    firebase: {sign_in_provider: 'google.com'}})});
  const principal = await accounts.authenticate({headers: {authorization: 'Bearer synthetic-id-token'}, uid: authorUid});
  assert.equal(principal.uid, ordinaryUid);
  await reserve(accounts.forUser(principal.uid), 'ordinary', .04);
  assert.equal((await accounts.forUser(principal.uid).snapshot()).limitUsd, .5);
  assert.equal(store.accounts.has(authorHash), false);
});

test('missing policy and policy removal fail closed on a granted account without resetting its data', async () => {
  const store = new MemoryStore(); seedGranted(store);
  const before = structuredClone([...store.accounts]);
  for (const settings of [{FIREBASE_PROJECT_ID: project}, {...env, STUDY_AUTHOR_UID_HASH: uidHash(ordinaryUid)}]) {
    const accounts = setup(settings, store).accounts;
    await assert.rejects(accounts.forUser(authorUid).snapshot(), {code: 'credit_ledger_invalid'});
  }
  assert.deepEqual([...store.accounts], before);
});

test('malformed server author policy fails closed without exposing the configured value', () => {
  for (const value of ['', null, [], {}, 'private-config-fragment', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(64) + '\n']) {
    assert.throws(() => setup({...env, STUDY_AUTHOR_UID_HASH: value}), error => {
      assert.equal(error.code, 'firebase_configuration_invalid');
      assert.equal(error.status, 503);
      assert.ok(!error.message.includes('private-config-fragment'));
      return true;
    });
  }
});
