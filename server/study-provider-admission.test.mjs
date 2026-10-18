import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createGenerationGate} from './generation-gate.mjs';
import {createStudyAccounts} from './study/accounts.mjs';
import {createStudyProvider} from './study/provider.mjs';
import {createStudyService} from './study/service.mjs';
import {parseStudySource} from './study/source.mjs';

const env = {
  AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_API_KEY: 'synthetic-provider-key',
  GEMINI_FREE_TIER_ONLY: 'true', GEMINI_API_PROJECT: 'gen-lang-client-0441267635',
  GEMINI_API_KEY_RESOURCE: 'projects/2937676390/locations/global/keys/00000000-0000-4000-8000-000000000000',
  STUDY_ACCESS_MODE: 'google', STUDY_ORIGIN: 'https://study.example',
  LEARNING_SIGNING_KEY_BASE64: Buffer.alloc(32, 1).toString('base64'),
  FIREBASE_PROJECT_ID: 'study-test-project',
};
const context = {principal: {uid: 'synthetic-google-user'}};
const source = parseStudySource({videoId: '733mgqrzNKs', title: 'Timing of money', end: 60,
  text: 'Video ID: 733mgqrzNKs\nCaptions: synthetic\n[0:00] Compare money on the same date.\n[0:20] Assume a hypothetical interest rate.\n[0:40] Discount a future amount.\n[1:00] End.'});
const input = {videoId: source.videoId, profile: {level: 'beginner', language: 'en', interests: []}};
const lesson = {
  supported: true, title: 'Compare dates', summary: 'Use a stated hypothetical rate.',
  concepts: [{label: 'Comparable dates', explanation: 'Compare amounts on the same date.', anchorIds: [source.anchors[0].id]}],
  slides: [1, 2, 3, 4].map(i => ({title: `Step ${i}`, body: 'Use the stated assumption.', bullets: ['Compare dates.'], anchorId: source.anchors[0].id})),
  exercises: [1, 2].map(i => ({question: `Apply the assumption in scenario ${i}.`, options: ['110', '100', '90'], correctIndex: 0,
    explanation: '100 times 1.1 is 110.', hint: 'Use the stated rate.', anchorId: source.anchors[0].id})),
};

async function setup(t, {fillGateDuringCount = false, networkFailure = false, providerResponse, responseText, responseStatus = 200} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'delta-provider-admission-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const records = new Map();
  const accounts = createStudyAccounts({env, store: {async transact(user, operation, reduce) {
    const accountKey = `account:${user}`, operationKey = `operation:${user}:${operation}`;
    const update = await reduce(structuredClone(records.get(accountKey) ?? null), structuredClone(records.get(operationKey) ?? null));
    if (Object.hasOwn(update, 'account')) records.set(accountKey, structuredClone(update.account));
    if (Object.hasOwn(update, 'operation')) records.set(operationKey, structuredClone(update.operation));
    return update.result;
  }}});
  const gate = createGenerationGate({env, now: () => 1000000});
  const calls = {count: 0, generate: 0}, requests = {};
  const provider = createStudyProvider({env, generationGate: gate, fetchImpl: async (url, options) => {
    if (url.endsWith(':countTokens')) {
      calls.count++;
      requests.count = JSON.parse(options.body);
      // Other admitted sessions use the process allowance while this request
      // awaits its token count. This request has not dispatched generation.
      if (fillGateDuringCount) for (let i = 0; i < 5; i++) assert.equal(gate.reserve(), null);
      return new Response('{"totalTokens":2000}', {status: 200});
    }
    assert.ok(url.endsWith(':generateContent'));
    calls.generate++;
    if (networkFailure) throw Error('synthetic transport failure');
    const request = JSON.parse(options.body);
    requests.generate = request;
    assert.equal(request.generationConfig.maxOutputTokens, 3500);
    assert.equal(request.generationConfig.thinkingConfig.thinkingLevel, 'low');
    return new Response(responseText ?? JSON.stringify(providerResponse ?? {usageMetadata: {promptTokenCount: 2000, candidatesTokenCount: 100, thoughtsTokenCount: 50, totalTokenCount: 2150},
      candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify(lesson)}]}}]}), {status: responseStatus});
  }});
  const service = createStudyService({directory, sources: [source], env, userQuota: accounts, provider});
  async function receipt() {
    const filename = (await readdir(directory)).find(name => name.endsWith('.cost.json'));
    return JSON.parse(await readFile(path.join(directory, filename), 'utf8'));
  }
  return {service, calls, requests, receipt, quota: () => accounts.forUser(context.principal.uid).snapshot()};
}

test('gate exhaustion during countTokens releases both credit reservations without dispatching generation', async t => {
  const {service, calls, receipt, quota} = await setup(t, {fillGateDuringCount: true});
  await assert.rejects(service.generate(input, context), {code: 'free_tier_quota_exhausted', status: 429, retryAfterSeconds: 60});
  assert.deepEqual(calls, {count: 1, generate: 0});
  assert.deepEqual(await quota(), {limitUsd: .5, reservedUsd: 0, spentUsd: 0, remainingUsd: .5});
  const cost = await receipt();
  assert.equal(cost.conservativeUsd, 0);
  assert.equal(cost.entries[0].actualUsd, 0);
  assert.deepEqual(cost.entries[0].usage, {inputTokens: 0, outputTokens: 0, thoughtTokens: 0,
    currentPaidEquivalentUsd: 0, usageKnown: true, notDispatched: true});
});

test('admitted generation settles its reported input, output and thinking usage normally', async t => {
  const {service, calls, requests, receipt, quota} = await setup(t);
  const result = await service.generate(input, context);
  assert.equal(result.lesson.title, 'Compare dates');
  assert.deepEqual(calls, {count: 1, generate: 1});
  assert.deepEqual(await quota(), {limitUsd: .5, reservedUsd: 0, spentUsd: .004125, remainingUsd: .495875});
  assert.equal((await receipt()).conservativeUsd, .004125);
  const {model, ...countedRequest} = requests.count.generateContentRequest;
  assert.equal(model, 'models/gemini-3.8-flash');
  assert.deepEqual(countedRequest, requests.generate);
  const schema = requests.generate.generationConfig.responseSchema;
  const anchors = source.anchors.map(anchor => anchor.id);
  assert.deepEqual(schema.properties.concepts.items.properties.anchorIds.items.enum, anchors);
  assert.deepEqual(schema.properties.slides.items.properties.anchorId.enum, anchors);
  assert.deepEqual(schema.properties.exercises.items.properties.anchorId.enum, anchors);
  assert.equal(schema.properties.slides.minItems, 4);
  assert.equal(schema.properties.slides.maxItems, 4);
  assert.equal(schema.properties.exercises.minItems, 2);
  assert.equal(schema.properties.exercises.maxItems, 2);
});

test('unknown network failure after dispatch retains both reservations and safe diagnostics without retry', async t => {
  const {service, calls, receipt, quota} = await setup(t, {networkFailure: true});
  await assert.rejects(service.generate(input, context), {code: 'provider_unavailable', status: 503});
  assert.deepEqual(calls, {count: 1, generate: 1});
  assert.deepEqual(await quota(), {limitUsd: .5, reservedUsd: .02955, spentUsd: 0, remainingUsd: .47045});
  const cost = await receipt();
  assert.equal(cost.conservativeUsd, .02955);
  assert.equal(cost.entries[0].actualUsd, null);
  assert.deepEqual(cost.entries[0].failure, {step: 'generateContent'});
});

test('a failed zero-cost settlement preserves the gate rejection and marks the credit release as pending', async () => {
  let releaseAttempts = 0, generationCalls = 0;
  const provider = createStudyProvider({env,
    generationGate: {reason: () => null, observeResponse: () => null,
      reserve: () => ({reason: 'free_tier_quota_exhausted', retryAfterSeconds: 60})},
    fetchImpl: async url => {
      if (url.endsWith(':countTokens')) return new Response('{"totalTokens":2000}', {status: 200});
      generationCalls++; throw Error('must not dispatch');
    }});
  await assert.rejects(provider.generate({source, profile: input.profile, budget: {
    reserve: async () => {},
    settle: async amount => {releaseAttempts++; assert.equal(amount, 0); throw Error('synthetic ledger failure');},
  }}), {code: 'free_tier_quota_exhausted', status: 429, retryAfterSeconds: 60, creditSettlementPending: true});
  assert.equal(releaseAttempts, 1);
  assert.equal(generationCalls, 0);
});

const usageMetadata = {promptTokenCount: 2000, candidatesTokenCount: 100, thoughtsTokenCount: 50, totalTokenCount: 2150};
for (const scenario of [
  {name: 'malformed generated JSON', finishReason: 'STOP', text: '{private-provider-fragment',
    expected: {phase: 'json', reason: 'invalid_output_json', kind: 'format', finishReason: 'STOP', length: 26}},
  {name: 'safety finish', finishReason: 'SAFETY', text: 'private-provider-fragment',
    expected: {phase: 'finish', reason: 'unfinished_response', kind: 'safety', finishReason: 'SAFETY', count: 1, retryable: false}},
  {name: 'unknown finish value', finishReason: 'private-provider-fragment', text: '{}',
    expected: {phase: 'finish', reason: 'unfinished_response', kind: 'format', finishReason: 'UNRECOGNIZED', count: 1, retryable: false}},
  {name: 'missing generated content', finishReason: 'STOP', text: '',
    expected: {phase: 'content', reason: 'missing_output', kind: 'format', finishReason: 'STOP', length: 0}},
  {name: 'oversized generated content', finishReason: 'STOP', text: 'x'.repeat(50000),
    expected: {phase: 'content', reason: 'output_too_large', kind: 'format', finishReason: 'STOP', length: 50000}},
]) {
  test(`${scenario.name} records safe diagnostics without refunding known provider usage or retrying`, async t => {
    const {service, calls, receipt, quota} = await setup(t, {providerResponse: {usageMetadata,
      candidates: [{finishReason: scenario.finishReason, content: {parts: [{text: scenario.text}]}}]}});
    const diagnostics = {step: 'generateContent', usageKnown: true, ...scenario.expected};
    await assert.rejects(service.generate(input, context), error => {
      assert.equal(error.code, 'invalid_provider_output');
      assert.deepEqual(error.diagnostics, diagnostics);
      assert.ok(!JSON.stringify(error.diagnostics).includes('private-provider-fragment'));
      return true;
    });
    assert.deepEqual(calls, {count: 1, generate: 1});
    assert.deepEqual(await quota(), {limitUsd: .5, reservedUsd: 0, spentUsd: .004125, remainingUsd: .495875});
    const cost = await receipt();
    assert.equal(cost.conservativeUsd, .004125);
    assert.equal(cost.entries[0].actualUsd, .004125);
    assert.deepEqual(cost.entries[0].failure, diagnostics);
  });
}

test('invalid HTTP-success response JSON retains the unknown-usage reservation with safe envelope diagnostics', async t => {
  const {service, calls, receipt, quota} = await setup(t, {responseText: '{private-provider-fragment'});
  const diagnostics = {step: 'generateContent', phase: 'envelope', reason: 'invalid_response_json', kind: 'format', length: 26, usageKnown: false};
  await assert.rejects(service.generate(input, context), error => {
    assert.equal(error.code, 'invalid_provider_output');
    assert.deepEqual(error.diagnostics, diagnostics);
    return true;
  });
  assert.deepEqual(calls, {count: 1, generate: 1});
  assert.deepEqual(await quota(), {limitUsd: .5, reservedUsd: .02955, spentUsd: 0, remainingUsd: .47045});
  assert.deepEqual((await receipt()).entries[0].failure, diagnostics);
});

test('diagnostic receipt outages do not mask a post-generation validation error or undo known settlement', async () => {
  let settled = null, failures = 0, generations = 0;
  const provider = createStudyProvider({env, fetchImpl: async url => {
    if (url.endsWith(':countTokens')) return new Response('{"totalTokens":2000}', {status: 200});
    generations++;
    return new Response(JSON.stringify({usageMetadata, candidates: [{finishReason: 'STOP', content: {parts: [{text: '{private-provider-fragment'}]}}]}), {status: 200});
  }});
  await assert.rejects(provider.generate({source, profile: input.profile, budget: {
    reserve: async () => {}, settle: async value => {settled = value;},
    failure: async () => {failures++; throw Error('private-receipt-fragment');},
  }}), error => {
    assert.equal(error.code, 'invalid_provider_output');
    assert.equal(error.diagnostics.reason, 'invalid_output_json');
    assert.ok(!error.message.includes('private-receipt-fragment'));
    return true;
  });
  assert.equal(generations, 1);
  assert.equal(settled, .004125);
  assert.equal(failures, 1);
});

test('unrecognized provider status strings never enter errors or persisted failure diagnostics', async t => {
  const {service, calls, receipt, quota} = await setup(t, {responseStatus: 503,
    responseText: '{"error":{"status":"PRIVATE_PROVIDER_FRAGMENT","message":"private-provider-fragment"}}'});
  const diagnostics = {httpStatus: 503, step: 'generateContent', transient: true};
  await assert.rejects(service.generate(input, context), error => {
    assert.equal(error.code, 'provider_temporarily_unavailable');
    assert.deepEqual(error.diagnostics, diagnostics);
    assert.ok(!JSON.stringify(error).includes('PRIVATE_PROVIDER_FRAGMENT'));
    assert.ok(!error.message.includes('private-provider-fragment'));
    return true;
  });
  assert.deepEqual(calls, {count: 1, generate: 1});
  assert.deepEqual(await quota(), {limitUsd: .5, reservedUsd: .02955, spentUsd: 0, remainingUsd: .47045});
  assert.deepEqual((await receipt()).entries[0].failure, diagnostics);
});
