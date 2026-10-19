import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudyAccounts} from './study/accounts.mjs';
import {createStudyProvider} from './study/provider.mjs';
import {createServer} from './index.mjs';
import {createStudyClassificationService} from './study/classification.mjs';

const env = {AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_API_KEY: 'synthetic-key',
  FIREBASE_PROJECT_ID: 'study-test-project', FIREBASE_WEB_CONFIG: JSON.stringify({apiKey:'public-test-key',
    authDomain:'study-test-project.firebaseapp.com',projectId:'study-test-project',appId:'public-test-app'})};
const alice = {principal: {uid: 'alice'}}, bob = {principal: {uid: 'bob'}};
const videos = [{videoId: '733mgqrzNKs', title: 'Explain compound interest', channel: 'Teaching'},
  {videoId: 'DiVPAjgmnj0', title: 'Explain cash flow'}];
const input = {videos, existingPaths: [['Business', 'Finance']]};
const groups = {groups: [{path: ['Business', 'Finance'], confidence: 'high', contentType: 'knowledge',
  videoIds: videos.map(video => video.videoId)}]};

function setup({providerOutput = groups, fail = false, count = 1000, gate, now,
  usage = {promptTokenCount:1000,candidatesTokenCount:20}} = {}) {
  const records = new Map(), operations = new Map(), queues = new Map(), calls = [];
  const store = {transact(uid, operation, reduce) {
    const key = `${uid}/${operation}`;
    const promise = (queues.get(uid) || Promise.resolve()).catch(() => {}).then(() => {
      const result = reduce(structuredClone(records.get(uid) ?? null), structuredClone(operations.get(key) ?? null));
      if (Object.hasOwn(result, 'account')) records.set(uid, structuredClone(result.account));
      if (Object.hasOwn(result, 'operation')) operations.set(key, structuredClone(result.operation));
      return structuredClone(result.result);
    });
    queues.set(uid, promise); return promise;
  }};
  const accounts = createStudyAccounts({env, auth: {verifyIdToken:async uid=>({uid,sub:uid,aud:'study-test-project',
    iss:'https://securetoken.google.com/study-test-project',email:'synthetic@example.test',email_verified:true,
    firebase:{sign_in_provider:'google.com'}})}, store});
  const provider = createStudyProvider({env, generationGate: gate, fetchImpl: async (url, options) => {
    calls.push({action: url.endsWith(':countTokens') ? 'count' : 'generate', body: JSON.parse(options.body)});
    if (url.endsWith(':countTokens')) return new Response(JSON.stringify({totalTokens: count}));
    if (fail) throw new Error('network failure');
    return new Response(JSON.stringify({usageMetadata: usage,
      candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify(providerOutput)}]}}]}));
  }});
  const service = createStudyClassificationService({provider, accounts, env, ...(now ? {now} : {})});
  return {service, accounts, provider, records, operations, calls};
}

test('classification requires a verified principal and bounded validated metadata before provider calls', async () => {
  assert.equal(typeof createStudyClassificationService, 'function');
  const {service, calls, records} = setup();
  await assert.rejects(service.classify(input), {code: 'authentication_required', status: 401});
  for (const invalid of [{videos: []}, {videos: Array.from({length: 13}, (_, i) => ({videoId: `abcde${String(i).padStart(6, '0')}`, title: 'Lesson'}))},
    {videos: [{...videos[0], title: 'x'.repeat(401)}]}, {videos, existingPaths: Array(81).fill(['Business'])},
    {videos, uid: 'forged'}, {videos, existingPaths: [['https://attacker.example', 'Topic']]}]) {
    await assert.rejects(service.classify(invalid, alice), {code: 'invalid_classification_input', status: 400});
  }
  assert.equal(calls.length, 0); assert.equal(records.size, 0);
});

test('classification counts complete input, reserves usage and returns the established map result', async () => {
  const {service, accounts, calls, records, operations} = setup();
  const result = await service.classify(input, alice);
  assert.deepEqual(result, {schemaVersion: 1, model: 'gemini-3.8-flash', cached: 0,
    items: videos.map(({videoId}) => ({videoId, path: ['Business', 'Finance'], confidence: 'high', contentType: 'knowledge'}))});
  assert.deepEqual(calls.map(call => call.action), ['count', 'generate']);
  assert.equal(calls[1].body.generationConfig.maxOutputTokens, 4096);
  assert.match(calls[0].body.generateContentRequest.systemInstruction.parts[0].text, /public YouTube video metadata/);
  assert.equal((await accounts.forUser('alice').snapshot()).spentUsd, .00165);
  assert.equal((await accounts.forUser('alice').snapshot()).reservedUsd, 0);
  const stored = JSON.stringify([...records, ...operations]);
  assert.ok(!stored.includes(videos[0].title)); assert.ok(!stored.includes('alice'));
});

test('UID scoped cache and inflight work prevent duplicate generation without sharing another user result', async () => {
  const {service, accounts, calls} = setup();
  const [first, concurrent] = await Promise.all([service.classify(input, alice), service.classify(input, alice)]);
  assert.deepEqual(first, concurrent);
  const cached = await service.classify({...input, videos: [...videos].reverse()}, alice);
  assert.equal(cached.cached, 2); assert.equal(cached.items[0].videoId, videos[1].videoId);
  assert.equal(calls.filter(call => call.action === 'generate').length, 1);
  await service.classify(input, bob);
  assert.equal(calls.filter(call => call.action === 'generate').length, 2);
  assert.equal((await accounts.forUser('alice').snapshot()).spentUsd, .00165);
  assert.equal((await accounts.forUser('bob').snapshot()).spentUsd, .00165);
});

test('an exhausted user and an unaffordable counted prompt cannot dispatch generation', async () => {
  const {service, accounts, calls} = setup();
  const account = accounts.forUser('alice');
  for (let i = 0; i < 6; i++) {
    const amount = i < 5 ? .09 : .05;
    await account.reserve({operationId: `spent-${i}`, sessionId: `previous-${i}`, amountUsd: amount});
    await account.settle({operationId: `spent-${i}`, actualUsd: amount});
  }
  await assert.rejects(service.classify(input, alice), {code: 'study_credit_exhausted'});
  assert.equal(calls.length, 0);
  const tooLarge = setup({count: 100000});
  await assert.rejects(tooLarge.service.classify(input, alice), {code: 'video_budget_exceeded'});
  assert.deepEqual(tooLarge.calls.map(call => call.action), ['count']);
});

test('unknown dispatched failures retain durable session reservations even after service restart', async () => {
  const {service, accounts, provider, calls} = setup({fail: true});
  await assert.rejects(service.classify(input, alice), {code: 'provider_unavailable'});
  assert.ok((await accounts.forUser('alice').snapshot()).reservedUsd > .03);
  const restarted = createStudyClassificationService({provider, accounts, env});
  for (let i = 0; i < 2; i++) await assert.rejects(restarted.classify(input, alice), {code: 'provider_unavailable'});
  await assert.rejects(restarted.classify({...input, videos: [...videos].reverse()}, alice), {code: 'video_budget_exceeded'});
  assert.equal(calls.filter(call => call.action === 'generate').length, 3);
});

test('invalid provider identifiers never enter cache but their known usage remains charged', async () => {
  const {service, accounts, calls} = setup({providerOutput: {groups: [{...groups.groups[0], videoIds: ['aaaaaaaaaaa']}]}});
  for (let i = 0; i < 2; i++) await assert.rejects(service.classify(input, alice), {code: 'invalid_provider_output', status: 502});
  assert.equal(calls.filter(call => call.action === 'generate').length, 2);
  assert.equal((await accounts.forUser('alice').snapshot()).spentUsd, .0033);
});

test('ambiguous omitted items remain unresolved and cached omissions do not call the provider again', async () => {
  const {service, calls} = setup({providerOutput: {groups: []}});
  assert.deepEqual(await service.classify(input, alice), {schemaVersion: 1, model: 'gemini-3.8-flash', cached: 0,
    items: [], unresolvedIds: videos.map(video => video.videoId)});
  await service.classify(input, alice);
  assert.equal(calls.filter(call => call.action === 'generate').length, 1);
});

test('a gate rejection after token counting settles zero without a dispatched inference', async () => {
  let checks = 0;
  const gate = {reason: () => null, observeResponse: () => null,
    reserve: () => (++checks, {reason: 'free_tier_quota_exhausted', retryAfterSeconds: 60})};
  const {service, accounts, calls} = setup({gate});
  await assert.rejects(service.classify(input, alice), {code: 'free_tier_quota_exhausted'});
  assert.deepEqual(calls.map(call => call.action), ['count']);
  assert.deepEqual(await accounts.forUser('alice').snapshot(), {limitUsd: .5, reservedUsd: 0, spentUsd: 0, remainingUsd: .5});
  assert.equal(checks, 1);
});

test('low and medium model confidence remain unresolved rather than becoming inferred map data', async () => {
  for(const confidence of ['medium','low']) {
    const {service}=setup({providerOutput:{groups:[{...groups.groups[0],confidence}]}});
    const result=await service.classify(input,alice);
    assert.deepEqual(result.items,[]);assert.deepEqual(result.unresolvedIds,videos.map(video=>video.videoId));
  }
});

test('real HTTP entry wiring reaches only the authenticated metered classification service',async t=>{
  const {service,accounts,calls}=setup();
  const server=createServer({studyService:{access:{mode:'google',check:()=>null}},studyAccounts:accounts,
    studyEntitlements:{forUser:()=>({assertRegistered:async()=>{}})},
    classificationService:service,studyAccessMode:'google'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(route,token)=>fetch(`${base}${route}`,{method:'POST',headers:{'content-type':'application/json',
    ...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(input)});
  assert.equal((await request('/api/study/classify')).status,401);
  assert.equal((await request('/api/map/classify','alice')).status,409);
  assert.equal(calls.length,0);
  const accepted=await request('/api/study/classify','alice');
  assert.equal(accepted.status,200);assert.equal((await accepted.json()).items.length,2);
  assert.deepEqual(calls.map(call=>call.action),['count','generate']);
});

test('unexpected usage over the session ceiling is recorded and rejected rather than cached',async()=>{
  const {service,accounts,calls}=setup({usage:{promptTokenCount:100000,candidatesTokenCount:20}});
  await assert.rejects(service.classify(input,alice),{code:'video_budget_exceeded'});
  assert.equal((await accounts.forUser('alice').snapshot()).spentUsd,.15015);
  await assert.rejects(service.classify(input,alice),{code:'video_budget_exceeded'});
  assert.equal(calls.filter(call=>call.action==='generate').length,1);
});
