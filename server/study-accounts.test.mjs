import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {createStudyAccounts, createFirestoreStudyAccountStore, createFirebaseStudyAccounts} from './study/accounts.mjs';

const project = 'delta-test-project';
const env = {FIREBASE_PROJECT_ID: project, FIREBASE_WEB_CONFIG: JSON.stringify({
  apiKey: 'public-web-key', authDomain: `${project}.firebaseapp.com`, projectId: project,
  appId: 'public-app-id', storageBucket: 'not-needed-by-auth', private_key: 'must-not-leak', GEMINI_API_KEY: 'must-not-leak',
})};
const claims = () => ({uid: 'verified-google-user', sub: 'verified-google-user', aud: project,
  iss: `https://securetoken.google.com/${project}`, email: 'private@example.com', email_verified: true,
  firebase: {sign_in_provider: 'google.com'}});
const request = (token = 'firebase-id-token') => ({headers: {authorization: `Bearer ${token}`}, uid: 'forged-client-uid'});

class MemoryStore {
  accounts = new Map();
  operations = new Map();
  queues = new Map();
  transact(userHash, operationHash, reduce) {
    const next = (this.queues.get(userHash) || Promise.resolve()).catch(() => {}).then(async () => {
      await setImmediate();
      const operationKey = `${userHash}/${operationHash}`;
      const update = await reduce(structuredClone(this.accounts.get(userHash) ?? null),
        structuredClone(this.operations.get(operationKey) ?? null));
      if (Object.hasOwn(update, 'account')) this.accounts.set(userHash, structuredClone(update.account));
      if (Object.hasOwn(update, 'operation')) this.operations.set(operationKey, structuredClone(update.operation));
      return structuredClone(update.result);
    });
    this.queues.set(userHash, next);
    return next;
  }
}
const setup = (options = {}) => {
  const store = options.store || new MemoryStore();
  return {store, accounts: createStudyAccounts({env, auth: {verifyIdToken: async () => claims()}, store, ...options})};
};
const reserve = (user, operationId = 'operation-1', amountUsd = .04, sessionId = 'session-1') =>
  user.reserve({operationId, sessionId, amountUsd});

test('public config contains only explicit Firebase web fields and matches the verifier project', () => {
  const {accounts} = setup();
  assert.deepEqual(accounts.config(), {enabled: true, firebase: {apiKey: 'public-web-key', authDomain: `${project}.firebaseapp.com`,
    projectId: project, appId: 'public-app-id'}, limitUsd: .5});
  assert.throws(() => setup({env: {...env, FIREBASE_WEB_CONFIG: '{invalid'}}).accounts.config(), {code: 'firebase_configuration_invalid'});
  assert.throws(() => setup({env: {...env, FIREBASE_PROJECT_ID: 'other-project'}}).accounts.config(), {code: 'firebase_configuration_invalid'});
  assert.throws(() => setup({env: {}}).accounts.config(), {code: 'firebase_configuration_invalid'});
});

test('authDomain accepts only a bounded DNS hostname before exposing public configuration', () => {
  for (const authDomain of ['localhost', 'https://example.com', 'example.com:443', 'user@example.com', '*.example.com',
    'example.com/path', 'example.com?query', 'example.com#fragment', 'example.com; frame-src *', '-a.example',
    'a-.example', 'a..example', 'a.example.', 'a'.repeat(64) + '.example', 'a.'.repeat(127) + 'com', ' example.com', 'example.com\n']) {
    const config = {...JSON.parse(env.FIREBASE_WEB_CONFIG), authDomain};
    assert.throws(() => setup({env: {...env, FIREBASE_WEB_CONFIG: JSON.stringify(config)}}).accounts.config(),
      {code: 'firebase_configuration_invalid'});
  }
});

test('authentication takes uid only from a verified, revocation-checked Firebase ID token', async () => {
  const calls = [];
  const {accounts} = setup({auth: {async verifyIdToken(...args) {calls.push(args); return claims();}}});
  assert.deepEqual(await accounts.authenticate(request()), {uid: 'verified-google-user'});
  assert.deepEqual(calls, [['firebase-id-token', true]]);
});

test('missing and malformed bearer authorization is rejected before auth or ledger access', async () => {
  const {accounts} = setup({auth: {verifyIdToken() {throw Error('must not verify');}},
    store: {transact() {throw Error('must not access credits');}}});
  for (const authorization of [undefined, '', 'Basic token', 'Bearer token extra', ['Bearer token'], 'Bearer token\n']) {
    await assert.rejects(accounts.authenticate({headers: {authorization}, uid: 'forged'}), {code: 'authentication_required', status: 401});
  }
});

test('issuer, audience, Google provider, verified email and token subject are all enforced', async () => {
  const invalid = [
    {iss: 'https://securetoken.google.com/other-project'}, {aud: 'other-project'},
    {firebase: {sign_in_provider: 'password'}}, {firebase: {sign_in_provider: 'anonymous'}},
    {email_verified: false}, {email: undefined}, {sub: 'other-user'}, {uid: ''},
    {uid: 'x'.repeat(129), sub: 'x'.repeat(129)},
  ];
  for (const change of invalid) {
    const {accounts} = setup({auth: {verifyIdToken: async () => ({...claims(), ...change})}});
    await assert.rejects(accounts.authenticate(request()), {code: 'authentication_required', status: 401});
  }
});

test('auth failures do not reveal SDK errors or raw tokens', async () => {
  const {accounts} = setup({auth: {verifyIdToken: async () => {throw Error('private-key firebase-id-token');}}});
  await assert.rejects(accounts.authenticate(request()), error =>
    error.code === 'authentication_required' && !error.message.includes('private-key') && !error.message.includes('firebase-id-token'));
});

test('new verified users receive lifetime credit and the balance survives process/time changes', async () => {
  const {accounts, store} = setup({now: () => 1000});
  const user = accounts.forUser('user-a');
  assert.deepEqual(await user.check(), {limitUsd: .5, reservedUsd: 0, spentUsd: 0, remainingUsd: .5});
  await reserve(user);
  await user.settle({operationId: 'operation-1', actualUsd: .03});
  const restarted = setup({store, now: () => 1000 + 400 * 86400000}).accounts.forUser('user-a');
  assert.deepEqual(await restarted.snapshot(), {limitUsd: .5, reservedUsd: 0, spentUsd: .03, remainingUsd: .47});
  assert.equal((await accounts.forUser('user-b').snapshot()).remainingUsd, .5);
});

test('cross-instance concurrent reservations cannot spend the same available credit twice', async () => {
  const store = new MemoryStore();
  const users = Array.from({length: 6}, () => setup({store}).accounts.forUser('shared-user'));
  const results = await Promise.allSettled(users.map((user, i) => reserve(user, `parallel-${i}`, .09, `session-${i}`)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 5);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'study_credit_exhausted');
  assert.deepEqual(await users[0].snapshot(), {limitUsd: .5, reservedUsd: .45, spentUsd: 0, remainingUsd: .05});
  await reserve(users[0], 'final-credit', .05, 'final-session');
  await assert.rejects(users[0].check(), {code: 'study_credit_exhausted'});
  assert.equal((await users[0].snapshot()).reservedUsd, .5);
});

test('reservation replays are idempotent and do not authorize another inference', async () => {
  const {accounts} = setup(); const user = accounts.forUser('user');
  const results = await Promise.all([reserve(user), reserve(user)]);
  assert.deepEqual(results.map(result => result.created).sort(), [false, true]);
  assert.equal(results[0].operationState, 'reserved');
  assert.equal((await user.snapshot()).reservedUsd, .04);
  await assert.rejects(reserve(user, 'operation-1', .041), {code: 'credit_operation_conflict'});
  await assert.rejects(reserve(user, 'operation-1', .04, 'different-session'), {code: 'credit_operation_conflict'});
});

test('settlement replaces the reservation with actual spend exactly once', async () => {
  const {accounts} = setup(); const user = accounts.forUser('user');
  await reserve(user);
  const expected = {limitUsd: .5, reservedUsd: 0, spentUsd: .02, remainingUsd: .48};
  assert.deepEqual(await user.settle({operationId: 'operation-1', actualUsd: .02, usage: {inputTokens: 2000}}), expected);
  assert.deepEqual(await user.settle({operationId: 'operation-1', actualUsd: .02}), expected);
  await assert.rejects(user.settle({operationId: 'operation-1', actualUsd: .01}), {code: 'credit_operation_conflict'});
  const replay = await reserve(user);
  assert.equal(replay.created, false); assert.equal(replay.operationState, 'settled');
});

test('unknown failures retain reserved credit and repeated failure calls do not refund it', async () => {
  const {accounts} = setup(); const user = accounts.forUser('user');
  await reserve(user, 'unknown', .08);
  const first = await user.failure({operationId: 'unknown', diagnostics: {httpStatus: 503, body: 'private captions'}});
  assert.deepEqual(first, {limitUsd: .5, reservedUsd: .08, spentUsd: 0, remainingUsd: .42});
  assert.deepEqual(await user.failure({operationId: 'unknown'}), first);
  assert.equal((await reserve(user, 'unknown', .08)).operationState, 'failed');
  await assert.rejects(reserve(user, 'next', .02), {code: 'video_budget_exceeded'});
  await user.settle({operationId: 'unknown', actualUsd: .03});
  assert.equal((await user.check()).remainingUsd, .47);
});

test('a late failure cannot undo a settled debit', async () => {
  const {accounts} = setup(); const user = accounts.forUser('user');
  await reserve(user);
  await user.settle({operationId: 'operation-1', actualUsd: .05});
  assert.deepEqual(await user.failure({operationId: 'operation-1'}), {limitUsd: .5, reservedUsd: 0, spentUsd: .05, remainingUsd: .45});
});

test('unknown operation IDs cannot create or refund a credit operation', async () => {
  const {accounts} = setup(); const user = accounts.forUser('user');
  await assert.rejects(user.settle({operationId: 'missing', actualUsd: 0}), {code: 'credit_operation_not_found'});
  await assert.rejects(user.failure({operationId: 'missing'}), {code: 'credit_operation_not_found'});
  assert.equal((await user.snapshot()).remainingUsd, .5);
});

test('invalid operation and session IDs are rejected before opening a ledger transaction', async () => {
  const {accounts} = setup({store: {transact() {throw Error('must not access ledger');}}});
  const user = accounts.forUser('user');
  for (const operationId of [undefined, null, '', ' ', 'x'.repeat(257), 'unsafe\n']) {
    await assert.rejects(user.reserve({operationId, sessionId: 'session', amountUsd: .1}), {code: 'invalid_credit_operation'});
    await assert.rejects(user.settle({operationId, actualUsd: .1}), {code: 'invalid_credit_operation'});
    await assert.rejects(user.failure({operationId}), {code: 'invalid_credit_operation'});
  }
  for (const sessionId of [undefined, null, '', ' ', 'x'.repeat(257)]) {
    await assert.rejects(user.reserve({operationId: 'valid', sessionId, amountUsd: .1}), {code: 'invalid_credit_operation'});
  }
});

test('micro-dollar rounding is conservative and invalid amounts cannot alter credit', async () => {
  const {accounts} = setup(); const user = accounts.forUser('user');
  await reserve(user, 'tiny', .0000001);
  assert.equal((await user.snapshot()).reservedUsd, .000001);
  await user.settle({operationId: 'tiny', actualUsd: .0000001});
  assert.equal((await user.snapshot()).spentUsd, .000001);
  for (const amount of [-1, 0, NaN, Infinity, '0.1', Number.MAX_VALUE]) {
    await assert.rejects(reserve(user, 'invalid', amount), {code: 'invalid_credit_amount'});
  }
  for (const amount of [-1, NaN, Infinity, '0.1']) {
    await assert.rejects(user.settle({operationId: 'tiny', actualUsd: amount}), {code: 'invalid_credit_amount'});
  }
});

test('reported actual overruns are durably debited and block all future reservations', async () => {
  const {accounts, store} = setup(); const user = accounts.forUser('user');
  await reserve(user);
  assert.deepEqual(await user.settle({operationId: 'operation-1', actualUsd: .65}),
    {limitUsd: .5, reservedUsd: 0, spentUsd: .65, remainingUsd: 0});
  const restarted = setup({store}).accounts.forUser('user');
  await assert.rejects(restarted.check(), {code: 'study_credit_exhausted'});
  await assert.rejects(reserve(restarted, 'another', .000001), {code: 'study_credit_exhausted'});
});

test('strict session limit survives failed inference and new account instances', async () => {
  const {accounts, store} = setup();
  const user = accounts.forUser('user');
  await reserve(user, 'first', .06);
  await user.failure({operationId: 'first'});
  const restarted = setup({store, now: () => Date.now() + 3 * 86400000}).accounts.forUser('user');
  await assert.rejects(reserve(restarted, 'equal-limit', .04), {code: 'video_budget_exceeded', status: 429});
  await reserve(restarted, 'below-limit', .039999);
  assert.equal((await restarted.snapshot()).reservedUsd, .099999);
  await assert.rejects(reserve(restarted, 'one-micro-too-many', .000001), {code: 'video_budget_exceeded'});
  await user.settle({operationId: 'first', actualUsd: .01});
  await reserve(restarted, 'after-known-usage', .04);
  assert.deepEqual(await restarted.snapshot(), {limitUsd: .5, reservedUsd: .079999, spentUsd: .01, remainingUsd: .410001});
});

test('concurrent new operations on the same session cannot cross US$0.10', async () => {
  const store = new MemoryStore();
  const users = [0, 1, 2].map(() => setup({store}).accounts.forUser('user'));
  const results = await Promise.allSettled(users.map((user, i) => reserve(user, `session-race-${i}`, .04)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'video_budget_exceeded');
  assert.equal((await users[0].snapshot()).reservedUsd, .08);
});

test('actual session overruns persist and block that session without resetting its history', async () => {
  const {accounts, store} = setup(); const user = accounts.forUser('user');
  await reserve(user);
  await user.settle({operationId: 'operation-1', actualUsd: .11});
  const restarted = setup({store}).accounts.forUser('user');
  await assert.rejects(reserve(restarted, 'session-overrun', .000001), {code: 'video_budget_exceeded'});
  await reserve(restarted, 'different-session', .02, 'other-context');
  assert.deepEqual(await restarted.snapshot(), {limitUsd: .5, reservedUsd: .02, spentUsd: .11, remainingUsd: .37});
});

test('session reads distinguish missing and known zero-cost sessions without writing or granting credit', async () => {
  const {accounts, store} = setup(); const user = accounts.forUser('user');
  assert.deepEqual(await user.session('missing'), {available: false, conservativeUsd: 0, reservedUsd: 0, spentUsd: 0, limitUsd: .1});
  assert.equal(store.accounts.size, 0); assert.equal(store.operations.size, 0);
  await reserve(user, 'cancelled', .04, 'known-session');
  await user.settle({operationId: 'cancelled', actualUsd: 0});
  const before = JSON.stringify([...store.accounts, ...store.operations]);
  assert.deepEqual(await user.session('known-session'), {available: true, conservativeUsd: 0, reservedUsd: 0, spentUsd: 0, limitUsd: .1});
  assert.equal((await user.session('another-session')).available, false);
  assert.equal(JSON.stringify([...store.accounts, ...store.operations]), before);
});

test('session reads recover exact spent and failed reservations after restart without local receipts', async () => {
  const {accounts, store} = setup(); const user = accounts.forUser('user');
  await reserve(user, 'settled', .04, 'source-context-key');
  await user.settle({operationId: 'settled', actualUsd: .015});
  await reserve(user, 'failed', .03, 'source-context-key');
  await user.failure({operationId: 'failed'});
  await reserve(user, 'other', .02, 'different-context-key');
  const before = JSON.stringify([...store.accounts, ...store.operations]);
  const restarted = setup({store, now: () => Date.now() + 100 * 86400000}).accounts.forUser('user');
  assert.deepEqual(await restarted.session('source-context-key'),
    {available: true, conservativeUsd: .045, reservedUsd: .03, spentUsd: .015, limitUsd: .1});
  assert.deepEqual(await restarted.session('different-context-key'),
    {available: true, conservativeUsd: .02, reservedUsd: .02, spentUsd: 0, limitUsd: .1});
  assert.equal((await accounts.forUser('another-user').session('source-context-key')).available, false);
  assert.equal(JSON.stringify([...store.accounts, ...store.operations]), before);
});

test('session reads retain overrun evidence and fail closed on malformed persisted session totals', async () => {
  const {accounts, store} = setup(); const user = accounts.forUser('user');
  await reserve(user);
  await user.settle({operationId: 'operation-1', actualUsd: .11});
  assert.deepEqual(await user.session('session-1'),
    {available: true, conservativeUsd: .11, reservedUsd: 0, spentUsd: .11, limitUsd: .1});
  const account = [...store.accounts.values()][0];
  account.spentMicros--;
  await assert.rejects(user.session('session-1'), {code: 'credit_ledger_invalid', status: 503});
});

test('session reads reject invalid keys before transaction and fail closed on datastore outage', async () => {
  const {accounts} = setup({store: {transact() {throw Error('private datastore failure');}}});
  const user = accounts.forUser('user');
  for (const sessionId of [undefined, null, '', ' ', 'x'.repeat(257), 'unsafe\n']) {
    await assert.rejects(user.session(sessionId), {code: 'invalid_credit_operation'});
  }
  await assert.rejects(user.session('source-context-key'), {code: 'credit_ledger_unavailable', status: 503});
});

test('only untouched v1 balances can migrate to session accounting', async () => {
  const {accounts, store} = setup(); const user = accounts.forUser('user');
  await reserve(user);
  const key = [...store.accounts.keys()][0]; store.operations.clear();
  for (const balance of [{reservedMicros: 1, spentMicros: 0}, {reservedMicros: 0, spentMicros: 1}]) {
    store.accounts.set(key, {schemaVersion: 1, limitMicros: 500000, ...balance});
    await assert.rejects(setup({store}).accounts.forUser('user').snapshot(), {code: 'credit_ledger_invalid'});
    assert.deepEqual(store.accounts.get(key), {schemaVersion: 1, limitMicros: 500000, ...balance});
  }
  store.accounts.set(key, {schemaVersion: 1, limitMicros: 500000, reservedMicros: 0, spentMicros: 0});
  await reserve(user, 'first-v2');
  assert.equal(store.accounts.get(key).schemaVersion, 2);
  assert.equal(Object.keys(store.accounts.get(key).sessions).length, 1);
  assert.equal((await user.snapshot()).reservedUsd, .04);
});

test('v2 global counters must equal session totals and the session map is bounded', async () => {
  const {accounts, store} = setup(); const user = accounts.forUser('user');
  await reserve(user);
  const key = [...store.accounts.keys()][0];
  store.accounts.get(key).reservedMicros++;
  await assert.rejects(user.snapshot(), {code: 'credit_ledger_invalid'});
  const sessions = Object.fromEntries(Array.from({length: 256}, (_, i) =>
    [(i + 1).toString(16).padStart(64, '0'), {reservedMicros: 0, spentMicros: 0}]));
  store.accounts.set(key, {schemaVersion: 2, limitMicros: 500000, reservedMicros: 0, spentMicros: 0, sessions});
  await assert.rejects(reserve(user, 'capacity', .01, 'new-session'), {code: 'credit_ledger_capacity'});
  assert.equal(Object.keys(store.accounts.get(key).sessions).length, 256);
});

test('ledger contains only hashed identifiers and numeric credit/reservation metadata', async () => {
  const {accounts, store} = setup(); const user = accounts.forUser('private-user-id');
  await reserve(user, 'private-operation', .04, 'private-session');
  await user.failure({operationId: 'private-operation', diagnostics: {caption: 'private caption', email: 'private@example.com'}});
  await user.settle({operationId: 'private-operation', actualUsd: .02, usage: {caption: 'private caption', preferences: ['private']}});
  assert.match([...store.accounts.keys()][0], /^[a-f0-9]{64}$/);
  const numericLeaves = value => typeof value === 'number' || (value && typeof value === 'object' && Object.values(value).every(numericLeaves));
  assert.ok([...store.accounts.values(), ...store.operations.values()].every(numericLeaves));
  const saved = JSON.stringify([...store.accounts, ...store.operations]);
  for (const privateText of ['private-user-id', 'private-operation', 'private-session', 'private caption', 'private@example.com']) {
    assert.ok(!saved.includes(privateText));
  }
});

test('ledger outages fail closed and conceal datastore details', async () => {
  const {accounts} = setup({store: {transact: async () => {throw Error('private service-account credential');}}});
  await assert.rejects(accounts.forUser('user').check(), error =>
    error.code === 'credit_ledger_unavailable' && error.status === 503 && !error.message.includes('private'));
});

test('corrupt persisted balances fail closed instead of granting a new balance', async () => {
  const {accounts, store} = setup(); const user = accounts.forUser('user');
  await reserve(user);
  const key = [...store.accounts.keys()][0];
  store.accounts.get(key).spentMicros = -1;
  await assert.rejects(user.snapshot(), {code: 'credit_ledger_invalid'});
});

test('Firestore adapter reads account and operation before writing and never creates a client ledger API', async () => {
  const calls = [], records = new Map();
  const reference = path => ({path, collection: name => ({doc: id => reference(`${path}/${name}/${id}`)})});
  const firestore = {collection: name => ({doc: id => reference(`${name}/${id}`)}), async runTransaction(run) {
    let wrote = false;
    return run({async get(ref) {assert.equal(wrote, false); calls.push(['get', ref.path]); return {exists: records.has(ref.path), data: () => records.get(ref.path)};},
      set(ref, value) {wrote = true; calls.push(['set', ref.path]); records.set(ref.path, structuredClone(value));}});
  }};
  const store = createFirestoreStudyAccountStore(firestore);
  const {accounts} = setup({store});
  await reserve(accounts.forUser('user'));
  assert.deepEqual(calls.map(([action]) => action), ['get', 'get', 'set', 'set']);
  assert.match(calls[0][1], /^studyCredits\/[a-f0-9]{64}$/);
  assert.match(calls[1][1], /^studyCredits\/[a-f0-9]{64}\/operations\/[a-f0-9]{64}$/);
  calls.length = 0;
  assert.equal((await accounts.forUser('user').snapshot()).remainingUsd, .46);
  assert.deepEqual(calls.map(([action]) => action), ['get']);
  calls.length = 0;
  assert.deepEqual(await accounts.forUser('user').session('session-1'),
    {available: true, conservativeUsd: .04, reservedUsd: .04, spentUsd: 0, limitUsd: .1});
  assert.deepEqual(calls.map(([action]) => action), ['get']);
});

test('a Firestore transaction callback retry does not multiply the reservation', async () => {
  const records = new Map(); let callbacks = 0;
  const reference = path => ({path, collection: name => ({doc: id => reference(`${path}/${name}/${id}`)})});
  const firestore = {collection: name => ({doc: id => reference(`${name}/${id}`)}), async runTransaction(run) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const writes = [];
      const result = await run({async get(ref) {return {exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path))};},
        set(ref, value) {writes.push([ref.path, structuredClone(value)]);}});
      callbacks++;
      if (attempt === 0) continue; // Simulate a discarded optimistic attempt.
      for (const [path, value] of writes) records.set(path, value);
      return result;
    }
  }};
  const {accounts} = setup({store: createFirestoreStudyAccountStore(firestore)});
  const result = await reserve(accounts.forUser('user'));
  assert.equal(callbacks, 2);
  assert.equal(result.reservedUsd, .04);
  assert.equal([...records.values()].find(value => Object.hasOwn(value, 'limitMicros')).reservedMicros, 40000);
  assert.equal(records.size, 2);
});

test('runtime factory requires an explicit Firebase project before loading SDK credentials', async () => {
  await assert.rejects(createFirebaseStudyAccounts({env: {}}), {code: 'firebase_configuration_invalid'});
  await assert.rejects(createFirebaseStudyAccounts({env: {...env, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099'}}),
    {code: 'firebase_configuration_invalid'});
  await assert.rejects(createFirebaseStudyAccounts({env: {...env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'}}),
    {code: 'firebase_configuration_invalid'});
  for (const field of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) {
    const previous = process.env[field];
    try {
      process.env[field] = '127.0.0.1:8080';
      await assert.rejects(createFirebaseStudyAccounts({env}), {code: 'firebase_configuration_invalid'});
    } finally {
      if (previous === undefined) delete process.env[field]; else process.env[field] = previous;
    }
  }
});
