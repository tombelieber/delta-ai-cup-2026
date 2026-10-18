import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, createHmac } from 'node:crypto';
import { createLearningService, normalizeLearningInput, evaluateLearningFormula, LearningError } from './learning.mjs';
import { REVIEWED_SUMIF_SOURCE, LEARNING_SOURCE_REGISTRY_VERSION } from './learning-sources.mjs';
import { createGenerationGate } from './generation-gate.mjs';
import { createGeminiProvider } from './gemini.mjs';
import { CHAPTERS } from './catalogue.mjs';

const env = { AI_PROVIDER: 'vertex', GEMINI_API_KEY: 'AQ.private-test-only', GOOGLE_CLOUD_PROJECT: 'delta-test-project', GEMINI_MODEL: 'gemini-3.8-flash' };
const input = { source: { videoUrl: 'https://www.youtube.com/watch?v=dI8w0utjUc0&t=35s', title: 'Teaching clip', start: 35, end: 186 }, profile: { interests: ['AI tools'], level: 'beginner', language: 'en' } };
function output(overrides = {}) {
  return { supported: true, reason: '', title: 'SUMIF: select matching rows', summary: 'SUMIF adds revenue only for a chosen region.',
    evidence: [{ anchorId: 'sumif-purpose' }, { anchorId: 'sumif-arguments' }],
    slides: ['Choose rows', 'Three arguments', 'AI tool shop example', 'Check both ranges'].map((title, index) => ({ title, body: 'A new Delta practice example uses region and revenue rows.', bullets: ['Match the region', 'Add matching revenue'], code: index === 2 ? '=SUMIF(A2:A5,"Hong Kong",B2:B5)' : '', sourceAnchorId: index === 0 ? 'sumif-purpose' : 'sumif-arguments' })), ...overrides };
}
function response(value = output()) {
  return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'not public' }, { text: JSON.stringify(value) }] } }] }), { status: 200 });
}
function service(options = {}) { return createLearningService({ env, fetchImpl: async () => response(), ...options }); }
const rejectsCode = (promise, code, status) => assert.rejects(promise, (error) => error instanceof LearningError && error.code === code && (status == null || error.status === status));
const freeEnv = () => ({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'fake-free-developer-key', GEMINI_MODEL: 'gemini-3.8-flash',
  GEMINI_FREE_TIER_ONLY: 'true', GEMINI_API_PROJECT: 'gen-lang-client-0441267635',
  GEMINI_API_KEY_RESOURCE: 'projects/2937676390/locations/global/keys/00000000-0000-4000-8000-000000000000',
  LEARNING_SIGNING_KEY_BASE64: Buffer.alloc(32, 7).toString('base64') });

test('YouTube source is canonicalized; profiles are bounded and default to English', () => {
  const normalized = normalizeLearningInput({ source: { videoUrl: 'https://youtu.be/dI8w0utjUc0?si=abc', start: 35, end: 186 } });
  assert.equal(normalized.source.videoUrl, 'https://www.youtube.com/watch?v=dI8w0utjUc0');
  assert.equal(normalized.profile.language, 'en');
  assert.equal(normalized.profile.level, 'beginner');
  assert.deepEqual(normalized.profile.interests, []);
  assert.deepEqual(normalizeLearningInput({ ...input, profile: { interests: ['AI', 'AI'] } }).profile.interests, ['AI']);
});

test('source URL scope prevents SSRF, credentials, host spoofing and oversized clips', () => {
  const urls = ['http://www.youtube.com/watch?v=dI8w0utjUc0', 'https://localhost/watch?v=dI8w0utjUc0', 'https://127.0.0.1/watch?v=dI8w0utjUc0', 'https://www.youtube.com.attacker.test/watch?v=dI8w0utjUc0', 'https://user:pass@www.youtube.com/watch?v=dI8w0utjUc0', 'https://www.youtube.com:444/watch?v=dI8w0utjUc0', 'https://www.youtube.com/watch?v=bad', 'https://youtu.be/dI8w0utjUc0/more', 'https://www.youtube.com/redirect?v=dI8w0utjUc0'];
  for (const videoUrl of urls) assert.throws(() => normalizeLearningInput({ source: { videoUrl } }), LearningError, videoUrl);
  for (const clip of [{ start: -1, end: 5 }, { start: 5, end: 5 }, { start: 0, end: 301 }, { start: '0', end: 100 }, { start: 86300, end: 86500 }]) {
    assert.throws(() => normalizeLearningInput({ source: { videoUrl: input.source.videoUrl, ...clip } }), { code: 'invalid_clip' });
  }
  assert.throws(() => normalizeLearningInput({ ...input, profile: { interests: Array(6).fill('AI') } }), { code: 'invalid_request' });
  assert.throws(() => normalizeLearningInput({ ...input, profile: { interests: [42] } }), { code: 'invalid_request' });
  assert.throws(() => normalizeLearningInput({ ...input, profile: { language: 'xx' } }), { code: 'invalid_request' });
});

test('generation sends only canonical scoped video to approved Vertex route and keeps secrets off response', async () => {
  let request;
  const app = service({ fetchImpl: async (url, options) => { request = { url: new URL(url), options, body: JSON.parse(options.body) }; return response(); } });
  const result = await app.generate(input);
  assert.equal(request.url.origin, 'https://aiplatform.googleapis.com');
  assert.equal(request.url.pathname, '/v1/projects/delta-test-project/locations/global/publishers/google/models/gemini-3.8-flash:generateContent');
  assert.equal(request.url.searchParams.get('key'), env.GEMINI_API_KEY);
  assert.deepEqual(request.body.contents[0].parts[0], { fileData: { fileUri: 'https://www.youtube.com/watch?v=dI8w0utjUc0', mimeType: 'video/mp4' }, videoMetadata: { startOffset: '35s', endOffset: '186s', fps: 1 } });
  assert.match(request.body.systemInstruction.parts[0].text, /UNTRUSTED DATA/);
  const schema = request.body.generationConfig.responseSchema;
  assert.deepEqual(schema.properties.evidence.items.properties.anchorId.enum, REVIEWED_SUMIF_SOURCE.anchors.map((anchor) => anchor.id));
  assert.deepEqual(schema.properties.slides.items.properties.sourceAnchorId.enum, REVIEWED_SUMIF_SOURCE.anchors.map((anchor) => anchor.id));
  assert.equal(schema.properties.evidence.items.properties.start, undefined);
  assert.equal(schema.properties.slides.items.properties.sourceTime, undefined);
  assert.match(request.body.contents[0].parts[1].text, /never create timestamps, new IDs/);
  assert.match(request.body.contents[0].parts[1].text, /Delta-created range-alignment tip/);
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.equal(result.lesson.slides.length, 4);
  assert.equal(result.lesson.source.evidence.length, 2);
  assert.equal(result.lesson.title, 'SUMIF: select matching rows');
  assert.equal(result.lesson.source.title, REVIEWED_SUMIF_SOURCE.videoTitle);
  assert.equal(result.lesson.sourceVerification.status, 'reviewed_source_anchors_ai_lesson_unverified');
  assert.equal(result.lesson.sourceVerification.registryVersion, LEARNING_SOURCE_REGISTRY_VERSION);
  assert.deepEqual(result.lesson.source.evidence.map(({ start, end }) => [start, end]), [[36, 76], [88, 125]]);
  assert.deepEqual(result.lesson.slides.map((slide) => slide.sourceTime), [36, 88, 88, 88]);
  assert.equal(result.lesson.task.targetRegion, 'Tokyo');
  assert.match(result.lesson.task.instructions, /AI tools/);
  assert.equal(result.lesson.task.correctFormula, undefined);
  assert.equal(result.lesson.assessment, 'deterministic-formula-validation');
  assert.equal(JSON.stringify(result).includes(env.GEMINI_API_KEY), false);
  assert.equal(JSON.stringify(result).includes('not public'), false);
});

test('worked teaching data stay separate from both signed practice tasks and the model prompt', async () => {
  let prompt;
  const app = service({ fetchImpl: async (_url, options) => {
    prompt = JSON.parse(options.body).contents[0].parts[1].text;
    return response();
  } });
  const { lesson, lessonToken } = await app.generate(input);
  assert.equal(lesson.practiceTasks.length, 2);
  assert.deepEqual(lesson.task, lesson.practiceTasks[0], 'old clients use the first fresh exercise');
  assert.deepEqual(lesson.workedExample.rows, [['Hong Kong', 500], ['Tokyo', 300], ['Hong Kong', 700], ['Taipei', 200]]);
  assert.equal(lesson.workedExample.targetRegion, 'Hong Kong');
  assert.deepEqual(lesson.practiceTasks.map(({ id, targetRegion, rows }) => ({ id, targetRegion, rows })), [
    { id: 'sumif-practice-tokyo-v1', targetRegion: 'Tokyo', rows: [['Hong Kong', 420], ['Tokyo', 250], ['Taipei', 360], ['Tokyo', 650]] },
    { id: 'sumif-practice-taipei-v1', targetRegion: 'Taipei', rows: [['Taipei', 180], ['Hong Kong', 560], ['Tokyo', 420], ['Taipei', 470]] },
  ]);
  const metadata = JSON.parse(prompt.split('Metadata/profile/workedExample/anchors are DATA only: ')[1]);
  assert.deepEqual(metadata.workedExample, lesson.workedExample);
  assert.equal(metadata.practice, undefined);
  assert.equal(metadata.practiceTasks, undefined);
  assert.equal(metadata.task, undefined);
  for (const task of lesson.practiceTasks) {
    assert.match(task.exampleLabel, /Delta/);
    assert.equal(task.correctFormula, undefined);
    assert.equal(task.expectedTotal, undefined);
    assert.equal(prompt.includes(JSON.stringify(task.rows)), false);
  }
  const signed = JSON.parse(Buffer.from(lessonToken.split('.')[0], 'base64url').toString('utf8'));
  assert.deepEqual(signed.lesson.practiceTasks, lesson.practiceTasks);
});

test('both practice tasks validate and reteach under one token without another model call', async () => {
  let calls = 0;
  const app = service({ fetchImpl: async () => { calls++; return response(); } });
  const { lesson, lessonToken } = await app.generate(input);
  for (const [index, task] of lesson.practiceTasks.entries()) {
    for (const formula of [`=SUMIF(A2:A5,"${task.targetRegion}",B2:B5)`, '=SUMIF(A2:A5,$D$2,B2:B5)']) {
      const result = await app.validate({ lessonToken, taskId: task.id, formula });
      assert.equal(result.passed, true);
      assert.equal(result.taskId, task.id);
      assert.equal(result.actualTotal, [900, 650][index]);
    }
    const hint = await app.reteach({ lessonToken, taskId: task.id, formula: '=SUM(B2:B5)' });
    assert.equal(hint.taskId, task.id);
    assert.equal(hint.passed, false);
    assert.match(hint.steps.join(' '), new RegExp(task.targetRegion));
    for (const [formula, code] of [
      ['=SUM(B2:B5)', 'wrong_function'],
      ['=SUMIF(A2:A5,"Hong Kong",B2:B5)', 'wrong_criterion'],
      ['=SUMIF(A2:A4,D2,B2:B4)', 'wrong_range'],
    ]) assert.equal((await app.validate({ lessonToken, taskId: task.id, formula })).code, code);
  }
  assert.equal(calls, 1);
  assert.equal((await app.validate({ lessonToken, formula: '=SUMIF(A2:A5,D2,B2:B5)' })).taskId, lesson.task.id);
});

test('task selection is bounded to signed tasks and ignores supplied assessment overrides', async () => {
  const app = service();
  const { lesson, lessonToken } = await app.generate(input);
  for (const taskId of ['unknown-task', 'sumif-equality-v1', '', 'x'.repeat(101), null, {}, 1]) {
    for (const method of ['validate', 'reteach']) {
      await rejectsCode(app[method]({ lessonToken, taskId, formula: '=SUMIF(A2:A5,D2,B2:B5)' }), 'invalid_task_id', 400);
    }
  }
  const result = await app.validate({ lessonToken, taskId: lesson.practiceTasks[1].id,
    formula: '=SUMIF(A2:A5,"Hong Kong",B2:B5)', targetRegion: 'Hong Kong', criteriaValue: 'Hong Kong',
    task: { ...lesson.task, targetRegion: 'Hong Kong' }, rows: [['Hong Kong', 1]], answer: 1, passed: true });
  assert.equal(result.passed, false);
  assert.equal(result.code, 'wrong_criterion');
  const [body, signature] = lessonToken.split('.');
  const changed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  changed.lesson.practiceTasks[1].targetRegion = 'Hong Kong';
  const forged = `${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`;
  await rejectsCode(app.validate({ lessonToken: forged, taskId: lesson.practiceTasks[1].id, formula: '=SUMIF(A2:A5,D2,B2:B5)' }), 'invalid_lesson_token', 400);
});

test('accepted v2 source tokens retain their original task and cannot select a newly introduced exercise', async () => {
  const app = service();
  const { lessonToken } = await app.generate(input);
  const legacy = JSON.parse(Buffer.from(lessonToken.split('.')[0], 'base64url').toString('utf8'));
  delete legacy.lesson.practiceTasks;
  delete legacy.lesson.workedExample;
  legacy.lesson.task = { ...legacy.lesson.task, id: 'sumif-equality-v1', targetRegion: 'Hong Kong', criteriaValue: 'Hong Kong',
    rows: [['Hong Kong', 500], ['Tokyo', 300], ['Hong Kong', 700], ['Taipei', 200]] };
  const body = Buffer.from(JSON.stringify(legacy)).toString('base64url');
  const key = createHash('sha256').update(`delta-learning-v1\0${env.GOOGLE_CLOUD_PROJECT}\0${env.GEMINI_API_KEY}`).digest();
  const token = `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
  for (const taskId of [undefined, 'sumif-equality-v1']) {
    const result = await app.validate({ lessonToken: token, taskId, formula: '=SUMIF(A2:A5,"Hong Kong",B2:B5)' });
    assert.equal(result.passed, true);
    assert.equal(result.actualTotal, 1200);
    assert.equal(result.taskId, 'sumif-equality-v1');
  }
  const hint = await app.reteach({ lessonToken: token, formula: '=SUM(B2:B5)' });
  assert.equal(hint.taskId, 'sumif-equality-v1');
  assert.match(hint.steps.join(' '), /Hong Kong/);
  await rejectsCode(app.validate({ lessonToken: token, taskId: 'sumif-practice-tokyo-v1', formula: '=SUMIF(A2:A5,D2,B2:B5)' }), 'invalid_task_id', 400);
  assert.ok((await app.exportPptx({ lessonToken: token })).buffer.length > 0);
});

test('unsupported/inaccessible source returns a real error, never a synthetic lesson', async () => {
  const app = service({ fetchImpl: async () => response({ supported: false, reason: 'No SUMIF teaching', title: '', summary: '', evidence: [], slides: [] }) });
  await rejectsCode(app.generate(input), 'unsupported_source', 422);
});

test('only complete reviewed anchors are offered, and broader selections narrow inward transparently', async () => {
  const offered = [];
  const app = service({ fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body);
    const part = request.contents[0].parts[0];
    const schema = request.generationConfig.responseSchema;
    const ids = schema.properties.evidence.items.properties.anchorId.enum;
    offered.push({ ids, clip: part.videoMetadata });
    return response(output({ evidence: ids.map((anchorId) => ({ anchorId })),
      slides: output().slides.map((slide) => ({ ...slide, sourceAnchorId: ids[0] })) }));
  } });
  const broad = await app.generate({ ...input, source: { ...input.source, start: 0, end: 300 } });
  assert.deepEqual([broad.lesson.source.start, broad.lesson.source.end], [35, 186]);
  assert.deepEqual(broad.lesson.source.requestedClip, { start: 0, end: 300 });
  assert.match(broad.lesson.limitations.join(' '), /narrowed from 0–300s/);
  const narrow = await app.generate({ ...input, source: { ...input.source, start: 88, end: 146 } });
  assert.deepEqual(narrow.lesson.source.evidence.map((entry) => entry.anchorId), ['sumif-arguments', 'sumif-result-check']);
  assert.deepEqual(offered[1].ids, ['sumif-arguments', 'sumif-result-check']);
  assert.deepEqual([offered[1].clip.startOffset, offered[1].clip.endOffset], ['88s', '146s']);
});

test('unknown/unreviewed sources and insufficient complete anchors are rejected before any AI call', async () => {
  let calls = 0;
  const app = service({ fetchImpl: async () => { calls++; return response(); } });
  for (const source of [{ ...input.source, videoUrl: 'https://www.youtube.com/watch?v=En5cSXgGvZM' }, { ...input.source, start: 36, end: 76 }, { ...input.source, start: 100, end: 140 }, { ...input.source, start: 186, end: 300 }]) {
    await rejectsCode(app.generate({ ...input, source }), 'source_review_required', 422);
  }
  assert.equal(calls, 0);
});

test('model-estimated timestamps, fabricated or duplicate anchors and missing slide references are rejected', async () => {
  const samples = [
    { evidence: output().evidence.slice(0, 1) },
    { slides: output().slides.slice(0, 3) },
    { evidence: [{ anchorId: 'not-reviewed' }, output().evidence[1]] },
    { evidence: [{ anchorId: 'sumif-purpose' }, { anchorId: 'sumif-purpose' }] },
    // Real Vertex regression: 101–125/125–154/154–186 were in bounds but
    // semantically wrong. No free timestamp output is accepted anymore.
    { evidence: [{ start: 101, end: 125, statement: 'SUMIF begins.' }, { start: 125, end: 154, statement: 'Criteria is selected.' }] },
    { evidence: [{ anchorId: 'sumif-purpose', start: 101, end: 125 }, output().evidence[1]] },
    { slides: output().slides.map((slide, index) => index ? slide : { ...slide, sourceAnchorId: 'sumif-result-check' }) },
    { slides: output().slides.map((slide, index) => index ? slide : { ...slide, sourceTime: 170 }) },
    { summary: 'x'.repeat(701) },
  ];
  for (const sample of samples) await rejectsCode(service({ fetchImpl: async () => response(output(sample)) }).generate(input), 'invalid_provider_output', 502);
});

test('configuration disallows unsupported providers, arbitrary Vertex project paths and unapproved models before network', async () => {
  for (const bad of [{ AI_PROVIDER: 'ollama' }, { GEMINI_API_KEY: '' }, { GOOGLE_CLOUD_PROJECT: '../another-project' }, { GEMINI_MODEL: 'arbitrary-model' }]) {
    let called = false;
    const app = service({ env: { ...env, ...bad }, fetchImpl: async () => { called = true; return response(); } });
    assert.equal(app.readiness().configured, false);
    await assert.rejects(app.generate(input), LearningError);
    assert.equal(called, false);
  }
});

test('Developer lesson generation uses the fixed free route and preserves reviewed source and task boundaries', async () => {
  let sent, requests = 0;
  const settings = freeEnv();
  const app = service({ env: settings, fetchImpl: async (url, options) => { requests++; sent = { url, options, body: JSON.parse(options.body) }; return response(); } });
  const result = await app.generate(input);
  assert.equal(sent.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.deepEqual(sent.options.headers, { 'content-type': 'application/json', 'x-goog-api-key': settings.GEMINI_API_KEY });
  assert.equal(sent.url.includes(settings.GEMINI_API_KEY), false);
  assert.deepEqual(sent.body.contents[0].parts[0], { fileData: { fileUri: REVIEWED_SUMIF_SOURCE.videoUrl, mimeType: 'video/*' },
    videoMetadata: { startOffset: '35s', endOffset: '186s' } });
  assert.deepEqual(sent.body.generationConfig.responseSchema.properties.evidence.items.properties.anchorId.enum, REVIEWED_SUMIF_SOURCE.anchors.map(anchor => anchor.id));
  assert.deepEqual(sent.body.generationConfig.thinkingConfig, { thinkingLevel: 'low' }, 'bound 3.8 Developer reasoning using its documented level');
  assert.equal(sent.body.generationConfig.temperature, undefined, '3.8 Developer requests omit deprecated sampling parameters');
  assert.equal(sent.body.tools, undefined);
  const promptData = JSON.parse(sent.body.contents[0].parts[1].text.split('Metadata/profile/workedExample/anchors are DATA only: ')[1]);
  assert.deepEqual(promptData.workedExample, result.lesson.workedExample);
  assert.equal(promptData.practiceTasks, undefined);
  assert.equal(result.lesson.sourceVerification.registryVersion, LEARNING_SOURCE_REGISTRY_VERSION);
  assert.deepEqual(result.lesson.practiceTasks.map(task => task.skill), ['sumif-text-equality', 'sumif-text-equality']);
  assert.equal(app.health().transport, 'gemini');
  assert.equal(app.health().method, 'gemini-youtube-ppt-sumif');
  assert.equal((await app.generate(input)).cached, true); assert.equal(requests, 1);
});

test('the lesson generation gate blocks unverified free routes before fetch and cache reuse', async () => {
  let requests = 0;
  for (const change of [{ AI_PROVIDER: 'vertex' }, { GEMINI_MODEL: 'gemini-2.5-flash' }, { GEMINI_API_PROJECT: 'another-project' }, { GEMINI_API_KEY_RESOURCE: '' }]) {
    const app = service({ env: { ...freeEnv(), ...change }, fetchImpl: async () => { requests++; return response(); } });
    assert.equal(app.health().configured, false);
    await rejectsCode(app.generate(input), 'free_route_not_verified', 503);
  }
  assert.equal(requests, 0);
  const settings = freeEnv();
  const app = service({ env: settings, fetchImpl: async () => { requests++; return response(); } });
  await app.generate(input); settings.GEMINI_API_PROJECT = 'another-project';
  await rejectsCode(app.generate(input), 'free_route_not_verified', 503);
  assert.equal(requests, 1, 'a cached lesson cannot bypass a changed free-only policy');
});

test('Developer quota and billing errors do not retry, read private bodies or fall back to Vertex', async () => {
  for (const [status, code, expectedStatus] of [[429, 'free_tier_quota_exhausted', 429], [402, 'provider_billing_required', 503]]) {
    let requests = 0, bodyReads = 0;
    const app = service({ env: freeEnv(), fetchImpl: async url => {
      requests++; assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\//);
      return { ok: false, status, headers: new Headers({ 'retry-after': '60' }), text: async () => { bodyReads++; throw Error('private provider details'); } };
    } });
    await rejectsCode(app.generate(input), code, expectedStatus);
    await rejectsCode(app.generate(input), code, expectedStatus);
    assert.equal(app.health().reason, code); assert.equal(requests, 1); assert.equal(bodyReads, 0);
  }
});

test('an injected shared generation gate reserves actual lesson requests and never reserves cache hits', async () => {
  let reservations = 0, requests = 0;
  const contexts = [];
  const generationGate = { reason: () => null, reserve(context) { contexts.push(context); reservations++; return reservations > 1 ? { reason: 'free_tier_quota_exhausted', retryAfterSeconds: 30 } : null; }, observeResponse: () => null, status: () => ({}) };
  const app = service({ env: freeEnv(), generationGate, fetchImpl: async () => { requests++; return response(); } });
  await app.generate(input); assert.equal((await app.generate(input)).cached, true);
  await assert.rejects(app.generate({ ...input, profile: { ...input.profile, interests: ['different'] } }), error => error.code === 'free_tier_quota_exhausted' && error.status === 429 && error.retryAfterSeconds === 30);
  assert.equal(reservations, 2); assert.equal(requests, 1);
  assert.deepEqual(contexts, Array(2).fill({ transport: 'gemini', model: 'gemini-3.8-flash' }));
});

test('lesson and recommendation requests consume the same real free-tier gate while cache hits consume none', async () => {
  const settings = freeEnv(), generationGate = createGenerationGate({ env: settings });
  let calls = 0;
  const provider = createGeminiProvider({ env: settings, transport: 'gemini', generationGate, fetchImpl: async () => {
    calls++; return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ units: [] }) }] } }] }));
  } });
  const app = service({ env: settings, generationGate, fetchImpl: async () => { calls++; return response(); } });
  for (let index = 0; index < 3; index++) await provider.indexChapter(CHAPTERS[0]);
  const { lessonToken } = await app.generate(input);
  assert.equal((await app.generate(input)).cached, true);
  assert.equal(generationGate.status().requestsToday, 4);
  await provider.indexChapter(CHAPTERS[0]);
  await rejectsCode(app.generate({ ...input, profile: { ...input.profile, interests: ['new'] } }), 'free_tier_quota_exhausted', 429);
  await rejectsCode(app.generate(input), 'free_tier_quota_exhausted', 429);
  assert.equal(calls, 5); assert.equal(app.health().generationPolicy.requestsToday, 5);
  assert.equal((await app.validate({ lessonToken, formula: '=SUMIF(A2:A5,D2,B2:B5)' })).actualTotal, 900, 'quota exhaustion cannot disable signed offline assessment');
});

test('provider failures and key-bearing fetch errors are sanitized; 402 pauses more requests', async () => {
  let calls = 0;
  const app = service({ fetchImpl: async () => { calls++; return new Response('raw private key and billing details', { status: 402 }); } });
  await rejectsCode(app.generate(input), 'provider_billing_required', 503);
  await rejectsCode(app.generate(input), 'provider_billing_required', 503);
  assert.equal(calls, 1);
  assert.equal(app.health().reason, 'provider_billing_required');
  const rejected = service({ fetchImpl: async (url) => { throw Error(`bad URL ${url}`); } });
  await assert.rejects(rejected.generate(input), (error) => error.code === 'provider_unavailable' && !String(error).includes(env.GEMINI_API_KEY) && !String(error).includes('aiplatform'));
  await rejectsCode(service({ fetchImpl: async () => new Response('no access', { status: 403 }) }).generate(input), 'provider_unavailable', 503);
  await rejectsCode(service({ fetchImpl: async () => new Response('not json') }).generate(input), 'invalid_provider_output', 502);
  await rejectsCode(service({ fetchImpl: async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: JSON.stringify(output()) }] } }] })) }).generate(input), 'invalid_provider_output', 502);
});

test('timeout bounds fetch even when a custom transport ignores the abort signal', async () => {
  const app = service({ timeoutMs: 15, fetchImpl: async () => new Promise(() => {}) });
  // Keep the test process alive while the service's unref timeout runs.
  const keepAlive = setTimeout(() => {}, 1000);
  try { await rejectsCode(app.generate(input), 'provider_timeout', 504); } finally { clearTimeout(keepAlive); }
});

test('generation concurrency is one; cached repeats avoid extra AI calls and hourly budget resets', async () => {
  let finish; let calls = 0; let timestamp = 1_700_000_000_000;
  const app = service({ now: () => timestamp, maxGenerationsPerHour: 1, fetchImpl: async () => { calls++; return new Promise((resolve) => { finish = () => resolve(response()); }); } });
  const first = app.generate(input);
  await rejectsCode(app.generate({ ...input, profile: { interests: ['cats'] } }), 'analysis_busy', 429);
  finish(); await first;
  assert.equal((await app.generate(input)).cached, true);
  assert.equal(calls, 1);
  await rejectsCode(app.generate({ ...input, profile: { interests: ['cats'] } }), 'hourly_limit', 429);
  timestamp += 3600001;
  const next = app.generate(input); finish(); await next;
  assert.equal(calls, 2);
});

test('formula parser computes matching rows and accepts absolute references, separators and D2', async () => {
  const app = service(); const { lesson, lessonToken } = await app.generate(input);
  for (const formula of ['=SUMIF(A2:A5,"Tokyo",B2:B5)', '=sumif($A$2:$A$5;"tokyo";$B$2:$B$5)', '=SUMIF(A2:A5,D2,B2:B5)', '= SUMIF(A2:A5, $D$2, B2:B5)', '=SUMIF(A2:A5,"=Tokyo",B2:B5)']) {
    const result = await app.validate({ lessonToken, formula });
    assert.equal(result.passed, true, formula); assert.equal(result.actualTotal, 900);
    assert.equal(result.method, 'deterministic-formula-validation');
  }
  // A separate signed server task can contain other values; computation is not
  // a hardcoded "1200" answer comparison.
  const differentTask = { ...lesson.task, targetRegion: 'Hong Kong', criteriaValue: 'Hong Kong', rows: [['Hong Kong', 6], ['Tokyo', 3], ['Hong Kong', 8], ['Taipei', 2]] };
  assert.equal(evaluateLearningFormula('=SUMIF(A2:A5,D2,B2:B5)', differentTask).actualTotal, 14);
});

test('formula parser rejects hardcoded answers, SUM, arbitrary evaluation, wrong conditions and misaligned ranges', async () => {
  const app = service(); const { lessonToken } = await app.generate(input);
  const cases = [['1200', 'formula_required'], ['=1200', 'formula_required'], ['=SUM(B2:B5)', 'wrong_function'], ['=SUMIFS(B2:B5,A2:A5,"Hong Kong")', 'wrong_function'], ['=SUMIF(A2:A5,"Hong Kong",B2:B4)', 'mismatched_ranges'], ['=SUMIF(A2:A4,"Hong Kong",B2:B4)', 'wrong_range'], ['=SUMIF(B2:B5,"Hong Kong",A2:A5)', 'wrong_range'], ['=SUMIF(A2:A5,"Hong Kong",B2:B5)', 'wrong_criterion'], ['=SUMIF(A2:A5,D3,B2:B5)', 'invalid_criterion'], ['=SUMIF(A2:A5,"*",B2:B5)', 'wrong_criterion'], ['=SUMIF(A2:A5,"Hong Kong",B2:B5)+1', 'formula_required'], ['=SUMIF(A2:A5,IMPORTXML("https://example.com"),B2:B5)', 'invalid_criterion'], ['=SUMIF(A2:A5,"Hong Kong")', 'invalid_arguments'], ['=SUMIF(A2:A5,"Hong Kong,B2:B5)', 'invalid_arguments'], ['=SUMIF(A:A,"Hong Kong",B:B)', 'invalid_range']];
  for (const [formula, code] of cases) {
    const result = await app.validate({ lessonToken, formula }); assert.equal(result.passed, false, formula); assert.equal(result.code, code, formula);
  }
});

test('signed lesson survives service restart and ignores caller-supplied task or answer overrides', async () => {
  const { lessonToken } = await service().generate(input);
  const restarted = service({ fetchImpl: async () => { assert.fail('Validation must not call AI'); } });
  assert.equal((await restarted.validate({ lessonToken, formula: '=SUMIF(A2:A5,D2,B2:B5)', task: { correct: 1700 } })).passed, true);
  assert.equal((await restarted.validate({ lessonToken, formula: '=SUM(B2:B5)', answer: 1200, passed: true })).passed, false);
  const hint = await restarted.reteach({ lessonToken, formula: '=SUM(B2:B5)' });
  assert.equal(hint.method, 'rule-based'); assert.equal(hint.code, 'wrong_function'); assert.match(hint.steps[0], /^SUM includes/);
  assert.ok(hint.sourceTime >= 35 && hint.sourceTime < 186);
  assert.deepEqual((await restarted.reteach({ lessonToken, formula: '=SUMIF(A2:A5,D2,B2:B5)' })).steps, []);
});

test('preserved raw signing bytes retain old Vertex lessons after a Developer project and key migration', async () => {
  for (const explicit of [false, true]) {
    const oldSettings = explicit ? { ...env, LEARNING_SIGNING_KEY: 'old-explicit-test-only-signing-key' } : { ...env };
    const { lessonToken, lesson } = await service({ env: oldSettings }).generate(input);
    const oldBytes = createHash('sha256').update(`delta-learning-v1\0${oldSettings.GOOGLE_CLOUD_PROJECT}\0${oldSettings.GEMINI_API_KEY}`).digest();
    const settings = { ...freeEnv(), GOOGLE_CLOUD_PROJECT: 'new-hosting-project', GEMINI_API_KEY: 'different-free-test-key', AI_GENERATION_DISABLED: 'true' };
    if (explicit) { delete settings.LEARNING_SIGNING_KEY_BASE64; settings.LEARNING_SIGNING_KEY = oldSettings.LEARNING_SIGNING_KEY; }
    else settings.LEARNING_SIGNING_KEY_BASE64 = oldBytes.toString('base64');
    let requests = 0;
    const migrated = service({ env: settings, fetchImpl: async () => { requests++; assert.fail('Signed operations must remain offline'); } });
    const checked = await migrated.validate({ lessonToken, formula: '=SUMIF(A2:A5,D2,B2:B5)', taskId: lesson.task.id });
    assert.equal(checked.passed, true); assert.equal(checked.actualTotal, 900);
    assert.equal((await migrated.reteach({ lessonToken, formula: '=SUM(B2:B5)', taskId: lesson.task.id })).code, 'wrong_function');
    const exported = await migrated.exportPptx({ lessonToken });
    assert.equal(exported.buffer.subarray(0, 2).toString(), 'PK');
    await rejectsCode(migrated.generate(input), 'generation_disabled', 503);
    assert.equal(requests, 0);
    const fresh = await service({ env: { ...settings, AI_GENERATION_DISABLED: 'false' } }).generate(input);
    assert.equal((await migrated.validate({ lessonToken: fresh.lessonToken, formula: '=SUMIF(A2:A5,D2,B2:B5)' })).passed, true);
    const [body, signature] = lessonToken.split('.');
    const tampered = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); tampered.lesson.task.rows[0][1] = 9999;
    await rejectsCode(migrated.validate({ lessonToken: `${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${signature}`, formula: '=SUMIF(A2:A5,D2,B2:B5)' }), 'invalid_lesson_token', 400);
  }
});

test('invalid explicit base64 signing configuration blocks generation and verification without fallback', async () => {
  const { lessonToken } = await service().generate(input);
  const valid = Buffer.alloc(32, 255).toString('base64');
  for (const invalid of ['', null, false, 'not-base64', Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'), valid.slice(0, -1), `${valid}\n`, `${valid.slice(0, -2)}9=`, Buffer.alloc(32, 255).toString('base64url')]) {
    let requests = 0;
    const app = service({ env: { ...env, LEARNING_SIGNING_KEY: 'explicit-fallback-must-not-be-used', LEARNING_SIGNING_KEY_BASE64: invalid }, fetchImpl: async () => { requests++; return response(); } });
    assert.equal(app.health().configured, false); assert.equal(app.health().reason, 'signing_configuration_invalid');
    await rejectsCode(app.generate(input), 'signing_configuration_invalid', 503);
    await rejectsCode(app.validate({ lessonToken, formula: '=SUMIF(A2:A5,D2,B2:B5)' }), 'signing_configuration_invalid', 503);
    await rejectsCode(app.exportPptx({ lessonToken }), 'signing_configuration_invalid', 503);
    assert.equal(requests, 0);
  }
});

test('generation pause blocks cached and fresh generation but keeps signed checks, hints and PPTX export offline', async () => {
  const settings = { ...env };
  let requests = 0;
  const app = createLearningService({ env: settings, fetchImpl: async () => { requests++; return response(); } });
  const { lessonToken, lesson } = await app.generate(input);
  assert.equal(requests, 1);
  settings.AI_GENERATION_DISABLED = 'true';
  assert.equal(app.health().configured, false);
  assert.equal(app.readiness().reason, 'generation_disabled');
  await rejectsCode(app.generate(input), 'generation_disabled', 503);
  await rejectsCode(app.generate({}), 'generation_disabled', 503);
  const restarted = createLearningService({ env: settings, fetchImpl: async () => { requests++; throw Error('must not request'); } });
  await rejectsCode(restarted.generate(input), 'generation_disabled', 503);
  const checked = await restarted.validate({ lessonToken, formula: '=SUMIF(A2:A5,D2,B2:B5)', taskId: lesson.task.id });
  assert.equal(checked.passed, true); assert.equal(checked.actualTotal, 900);
  assert.equal((await restarted.reteach({ lessonToken, formula: '=SUM(B2:B5)', taskId: lesson.task.id })).code, 'wrong_function');
  const exported = await restarted.exportPptx({ lessonToken });
  assert.equal(exported.buffer.subarray(0, 2).toString(), 'PK');
  const JSZip = createRequire(import.meta.resolve('pptxgenjs'))('jszip');
  const zip = await JSZip.loadAsync(exported.buffer);
  assert.ok(zip.file('ppt/slides/slide4.xml'));
  assert.equal(requests, 1, 'only the initial fake generation ran; paused operations are fully offline');
});

test('token signature, expiry and key rotation prevent forged saved lessons or changed task data', async () => {
  let timestamp = 1_700_000_000_000;
  const app = service({ now: () => timestamp });
  const { lessonToken } = await app.generate(input);
  const [body, signature] = lessonToken.split('.');
  const changed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  changed.lesson.task.rows[0][1] = 9999;
  const forged = `${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`;
  for (const token of [forged, 'x.y', `${body}.${signature.slice(0, -1)}!`, 'x'.repeat(48001), null]) await rejectsCode(app.validate({ lessonToken: token, formula: '=SUMIF(A2:A5,D2,B2:B5)' }), 'invalid_lesson_token', 400);
  await rejectsCode(service({ env: { ...env, GEMINI_API_KEY: 'AQ.rotated-test-key' } }).validate({ lessonToken, formula: '=SUMIF(A2:A5,D2,B2:B5)' }), 'invalid_lesson_token', 400);
  timestamp += 7 * 24 * 3600000 + 1;
  await rejectsCode(app.validate({ lessonToken, formula: '=SUMIF(A2:A5,D2,B2:B5)' }), 'expired_lesson', 400);
});

test('legacy signed v1 lessons require regeneration for grading, hints and PowerPoint export', async () => {
  const app = service();
  const generated = await app.generate(input);
  const parsed = JSON.parse(Buffer.from(generated.lessonToken.split('.')[0], 'base64url').toString('utf8'));
  assert.equal(parsed.v, 2);
  const key = createHash('sha256').update(`delta-learning-v1\0${env.GOOGLE_CLOUD_PROJECT}\0${env.GEMINI_API_KEY}`).digest();
  const legacy = { ...parsed, v: 1, lesson: { ...parsed.lesson } };
  delete legacy.lesson.sourceVerification;
  legacy.lesson.source.evidence = [{ start: 101, end: 125, statement: 'Known inaccurate old AI timing.' }];
  const body = Buffer.from(JSON.stringify(legacy)).toString('base64url');
  const token = `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
  for (const method of ['validate', 'reteach', 'exportPptx']) await rejectsCode(app[method]({ lessonToken: token, formula: '=SUMIF(A2:A5,D2,B2:B5)' }), 'lesson_regeneration_required', 400);
});

test('Hong Kong Chinese practice uses localized criteria and deterministic hints', async () => {
  const app = service();
  const { lesson, lessonToken } = await app.generate({ ...input, profile: { language: 'zh-HK', interests: ['貓咪咖啡店'] } });
  assert.equal(lesson.task.targetRegion, '東京');
  assert.match(lesson.task.instructions, /貓咪咖啡店/);
  for (const [index, task] of lesson.practiceTasks.entries()) {
    assert.equal(task.targetRegion, ['東京', '台北'][index]);
    for (const formula of [`=SUMIF(A2:A5,"${task.targetRegion}",B2:B5)`, '=SUMIF(A2:A5,D2,B2:B5)']) {
      const result = await app.validate({ lessonToken, taskId: task.id, formula });
      assert.equal(result.passed, true); assert.equal(result.actualTotal, [900, 650][index]);
    }
    const hint = await app.reteach({ lessonToken, taskId: task.id, formula: '=SUM(B2:B5)' });
    assert.ok(hint.steps.join(' ').includes(task.targetRegion));
  }
  const hint = await app.reteach({ lessonToken, formula: '=SUMIF(A2:A5,"香港",B2:B4)' });
  assert.equal(hint.code, 'mismatched_ranges'); assert.match(hint.steps[0], /第 2 行/);
});

test('editable PPTX export is a real OpenXML package with four slides and no secret', async () => {
  const app = service(); const { lessonToken } = await app.generate(input);
  const exported = await app.exportPptx({ lessonToken });
  assert.equal(exported.contentType, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.match(exported.filename, /^Delta-SUMIF-[a-f0-9-]+\.pptx$/);
  assert.ok(Buffer.isBuffer(exported.buffer));
  assert.equal(exported.buffer.subarray(0, 2).toString(), 'PK');
  const JSZip = createRequire(import.meta.resolve('pptxgenjs'))('jszip');
  const zip = await JSZip.loadAsync(exported.buffer);
  for (let slide = 1; slide <= 4; slide++) {
    const xml = await zip.file(`ppt/slides/slide${slide}.xml`).async('string');
    assert.match(xml, /<a:t>Delta<\/a:t>/);
    assert.match(xml, /<p:sp>/); // editable text shapes, not slide screenshots
  }
  assert.equal(zip.file('ppt/slides/slide5.xml'), null);
  const allText = (await Promise.all(Object.values(zip.files).filter((file) => !file.dir).map((file) => file.async('string')))).join('\n');
  assert.equal(allText.includes(env.GEMINI_API_KEY), false);
  assert.match(allText, /Reviewed caption anchors/);
  assert.match(allText, /does not verify every generated bullet/);
  assert.match(allText, /sumif-arguments 88–125/);
  assert.match(allText, /https:\/\/www.youtube.com\/watch\?v=dI8w0utjUc0/);
});
