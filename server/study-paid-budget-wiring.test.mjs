import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStudyAccounts, createFirestoreStudyAccountStore} from './study/accounts.mjs';
import {createStudyClassificationService} from './study/classification.mjs';
import {createStudyProvider} from './study/provider.mjs';
import {createStudyService} from './study/service.mjs';
import {parseStudySource} from './study/source.mjs';
import {PROJECT_BUDGET_ENFORCED, STUDY_PROJECT_BUDGET_PATH} from './study/project-budget.mjs';

const paidEnv = {AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_API_KEY: 'synthetic-key',
  FIREBASE_PROJECT_ID: 'study-wiring-test-project',
  GEMINI_PAID_BUDGET_APPROVED: 'true', STUDY_PROJECT_BUDGET_USD: '10', STUDY_ACCESS_MODE: 'google',
  STUDY_ORIGIN: 'https://study.example', LEARNING_SIGNING_KEY_BASE64: Buffer.alloc(32, 9).toString('base64')};
const context = {principal: {uid: 'verified-fixture-user'}};
const source = parseStudySource({videoId: '733mgqrzNKs', title: 'Compare dates', end: 60,
  text: 'Video ID: 733mgqrzNKs\nCaptions: synthetic\n[0:00] Compare money on the same date.\n[0:20] State a hypothetical rate.\n[0:40] Apply that assumption.\n[1:00] End.'});
const videos = [{videoId: source.videoId, title: 'Compare dates'}];
const lesson = {supported: true, title: 'Compare dates', summary: 'Use the stated hypothetical assumption.',
  concepts: [{label: 'Same date', explanation: 'Compare money on the same date.', anchorIds: [source.anchors[0].id]}],
  slides: [1, 2, 3, 4].map(i => ({title: `Step ${i}`, body: 'Use the stated assumption.', bullets: [], anchorId: source.anchors[0].id})),
  exercises: [1, 2].map(i => ({question: `Apply the assumption in scenario ${i}.`, options: ['110', '100', '90'], correctIndex: 0,
    explanation: '100 times 1.1 is 110.', hint: 'Use the stated rate.', anchorId: source.anchors[0].id}))};
const groups = {groups: [{path: ['Business', 'Finance'], confidence: 'high', contentType: 'knowledge', videoIds: [source.videoId]}]};
const projectState = () => ({schemaVersion: 1, limitMicros: 10000000, reservedMicros: 0, spentMicros: 0});

function firestoreFixture({paid = true} = {}) {
  const records = new Map(paid ? [[STUDY_PROJECT_BUDGET_PATH, projectState()]] : []), references = [], transactions = [];
  const reference = name => ({path: name, collection: collection => ({doc: id => reference(`${name}/${collection}/${id}`)})});
  const firestore = {collection: name => ({doc: id => {references.push(`${name}/${id}`); return reference(`${name}/${id}`);}}),
    async runTransaction(run) {
      const writes = [], reads = [];
      const result = await run({async get(ref) {
        assert.equal(writes.length, 0, 'Firestore reads precede writes');
        reads.push(ref.path);
        return {exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path))};
      }, set(ref, value) {writes.push([ref.path, structuredClone(value)]);}});
      for (const [name, value] of writes) records.set(name, value);
      transactions.push({reads, writes});
      return result;
    }};
  return {firestore, records, references, transactions};
}

function syntheticProvider(env, beforeGenerate = () => {}) {
  const calls = [];
  const provider = createStudyProvider({env, fetchImpl: async (url, options) => {
    const action = url.endsWith(':countTokens') ? 'count' : 'generate'; calls.push(action);
    if (action === 'count') return new Response('{"totalTokens":1000}');
    beforeGenerate();
    const request = JSON.parse(options.body), output = request.generationConfig.maxOutputTokens === 4096 ? groups : lesson;
    return new Response(JSON.stringify({usageMetadata: {promptTokenCount: 1000, candidatesTokenCount: 20},
      candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify(output)}]}}]}));
  }});
  return {provider, calls};
}

test('only explicitly paid Firestore stores with the fixed project document propagate the trusted capability', () => {
  const paid = firestoreFixture(), free = firestoreFixture({paid: false});
  const paidStore = createFirestoreStudyAccountStore(paid.firestore, {env: paidEnv});
  const freeEnv = {...paidEnv, GEMINI_PAID_BUDGET_APPROVED: 'false'};
  const freeStore = createFirestoreStudyAccountStore(free.firestore, {env: freeEnv});
  assert.deepEqual(paid.references, [STUDY_PROJECT_BUDGET_PATH]); assert.deepEqual(free.references, []);
  assert.equal(paidStore[PROJECT_BUDGET_ENFORCED], true); assert.equal(freeStore[PROJECT_BUDGET_ENFORCED], false);
  assert.equal(createStudyAccounts({env: paidEnv, store: paidStore})[PROJECT_BUDGET_ENFORCED], true);
  assert.equal(createStudyAccounts({env: freeEnv, store: paidStore})[PROJECT_BUDGET_ENFORCED], false);
  for (const store of [{transact() {}}, {...JSON.parse('{"PROJECT_BUDGET_ENFORCED":true}'), transact() {}},
    {[PROJECT_BUDGET_ENFORCED]: 'true', transact() {}}]) {
    assert.equal(createStudyAccounts({env: paidEnv, store})[PROJECT_BUDGET_ENFORCED], false);
  }
});

test('paid local and guarded factories reject before signing, local state, ledger or provider access', () => {
  const calls = {signing: 0, ledger: 0, provider: 0};
  const accounts = {[PROJECT_BUDGET_ENFORCED]: true, forUser() {calls.ledger++; throw Error('must not read');}};
  const provider = {get classifyMetadata() {calls.provider++; throw Error('must not inspect provider');},
    generate() {calls.provider++;}, ask() {calls.provider++;}};
  for (const mode of [undefined, 'local', 'guarded']) {
    const env = {...paidEnv, STUDY_ACCESS_MODE: mode};
    Object.defineProperty(env, 'LEARNING_SIGNING_KEY_BASE64', {get() {calls.signing++; throw Error('must not configure state');}});
    assert.throws(() => createStudyService({directory: null, provider, userQuota: accounts, env}),
      {code: 'project_budget_configuration_invalid', status: 503});
    assert.throws(() => createStudyClassificationService({provider, accounts, env}),
      {code: 'project_budget_configuration_invalid', status: 503});
  }
  assert.deepEqual(calls, {signing: 0, ledger: 0, provider: 0});
});

test('paid Google factories reject untrusted account stores before countTokens or generation', () => {
  let ledgerCalls = 0;
  const {provider, calls} = syntheticProvider(paidEnv);
  for (const store of [{transact() {ledgerCalls++;}},
    {PROJECT_BUDGET_ENFORCED: true, transact() {ledgerCalls++;}},
    createFirestoreStudyAccountStore(firestoreFixture({paid: false}).firestore, {env: {}})]) {
    const accounts = createStudyAccounts({env: paidEnv, store});
    assert.throws(() => createStudyService({directory: null, provider, userQuota: accounts, env: paidEnv}),
      {code: 'project_budget_configuration_invalid', status: 503});
    assert.throws(() => createStudyClassificationService({provider, accounts, env: paidEnv}),
      {code: 'project_budget_configuration_invalid', status: 503});
  }
  assert.equal(ledgerCalls, 0); assert.deepEqual(calls, []);
});

test('paid Google lesson and map factories reserve the shared Firestore budget before mocked inference', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'delta-paid-wiring-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const f = firestoreFixture(), store = createFirestoreStudyAccountStore(f.firestore, {env: paidEnv});
  const accounts = createStudyAccounts({env: paidEnv, store});
  const {provider, calls} = syntheticProvider(paidEnv, () => {
    assert.ok(f.records.get(STUDY_PROJECT_BUDGET_PATH).reservedMicros > 0, 'global reservation exists before generation');
  });
  const study = createStudyService({directory, sources: [source], provider, userQuota: accounts, env: paidEnv});
  const classification = createStudyClassificationService({provider, accounts, env: paidEnv});
  const generated = await study.generate({videoId: source.videoId}, context);
  assert.equal(generated.lesson.title, lesson.title); assert.equal(generated.cost.conservativeUsd, .00165);
  assert.equal((await classification.classify({videos}, context)).items.length, 1);
  assert.deepEqual(calls, ['count', 'generate', 'count', 'generate']);
  assert.deepEqual(f.records.get(STUDY_PROJECT_BUDGET_PATH), {...projectState(), spentMicros: 3300});
  assert.equal((await accounts.forUser(context.principal.uid).snapshot()).spentUsd, .0033);
  assert.ok(f.transactions.every(transaction => transaction.reads[0] === STUDY_PROJECT_BUDGET_PATH));
});

test('free Google factories keep the existing account-only path without a project budget document', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'delta-free-wiring-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const env = {...paidEnv, GEMINI_PAID_BUDGET_APPROVED: 'false', GEMINI_FREE_TIER_ONLY: 'true'};
  const f = firestoreFixture({paid: false}), accounts = createStudyAccounts({env, store: createFirestoreStudyAccountStore(f.firestore, {env})});
  const {provider, calls} = syntheticProvider(env);
  const study = createStudyService({directory, sources: [source], provider, userQuota: accounts, env});
  const classification = createStudyClassificationService({provider, accounts, env});
  assert.equal((await study.generate({videoId: source.videoId}, context)).lesson.title, lesson.title);
  assert.equal((await classification.classify({videos}, context)).items.length, 1);
  assert.deepEqual(calls, ['count', 'generate', 'count', 'generate']);
  assert.equal(f.records.has(STUDY_PROJECT_BUDGET_PATH), false);
  assert.ok(f.transactions.every(transaction => transaction.reads.every(name => name.startsWith('studyCredits/'))));
});

test('default local lessons retain generation without Google accounts or any project ledger', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'delta-local-wiring-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const env = {AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_API_KEY: 'synthetic-key', LEARNING_SIGNING_KEY: 'synthetic-local-key'};
  const {provider, calls} = syntheticProvider(env);
  const study = createStudyService({directory, sources: [source], provider, env});
  const result = await study.generate({videoId: source.videoId});
  assert.equal(study.access.mode, 'local'); assert.equal(result.lesson.title, lesson.title);
  assert.equal(result.cost.conservativeUsd, .00165); assert.deepEqual(calls, ['count', 'generate']);
});
