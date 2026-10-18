import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { CHAPTERS } from './catalogue.mjs';
import { validateSourceUnits } from './validation.mjs';
import { validateTranscript, loadTranscripts, materializeTranscriptIndex, transcriptIndexVersion } from './transcripts.mjs';
import { createOllamaProvider, normalizeOllamaEndpoint, ALLOWED_GEMMA_MODELS } from './ollama.mjs';
import { createAIProvider } from './provider.mjs';
import { createRecommendationService } from './recommend.mjs';
import { createServer } from './index.mjs';

// Synthetic captions are test-only, never copied into runtime sources or Git fixtures.
const captionData = (chapter, count = 12) => ({ schemaVersion: 1, videoId: chapter.videoId,
  sourceUrl: `https://www.youtube.com/watch?v=${chapter.videoId}`, language: 'en',
  cues: Array.from({ length: count }, (_, i) => ({ start: chapter.start + 1 + i * 6, end: chapter.start + 7 + i * 6, text: `Test-only spoken caption ${i}.` })) });
const annotation = (cueIds = ['c0'], extra = {}) => ({ cueIds, summary: '測試論點', conditions: ['測試條件'], topic: '測試問題', support: '測試字幕依據', speaker: '未辨識', ...extra });
const digest = 'c'.repeat(64);
const tags = (model = 'gemma4:e2b', hash = digest) => new Response(JSON.stringify({ models: [{ name: model, digest: hash }] }));
const completed = (value, model = 'gemma4:e2b', extra = {}) => new Response(JSON.stringify({ model, done: true, done_reason: 'stop', message: { content: JSON.stringify(value), thinking: 'test-only ignored thought' }, ...extra }));
async function sources(t, modify = () => {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zhixin-local-sources-test-'));
  for (const chapter of CHAPTERS) {
    const value = captionData(chapter);
    modify(value, chapter);
    await writeFile(path.join(directory, `${chapter.videoId}.json`), JSON.stringify(value));
  }
  t.after(async () => { assert.ok(directory.startsWith(path.join(os.tmpdir(), 'zhixin-local-sources-test-'))); await rm(directory, { recursive: true, force: true }); });
  return directory;
}
const configured = (directory, extra = {}) => ({ AI_PROVIDER: 'ollama', GEMMA_MODEL: 'gemma4:e2b', OLLAMA_BASE_URL: 'http://zhixin-ollama:11434', TRANSCRIPT_DIR: directory, ...extra });
const fetchFor = (onChat = () => ({ units: [annotation(), annotation(['c2'])] }), model = 'gemma4:e2b') => async (url, options) => {
  if (url.endsWith('/api/tags')) return tags(model);
  const body = JSON.parse(options.body);
  if (body.messages[1].content.startsWith('Verify evidence')) return completed({ acceptedUnitIndices: [0] }, model);
  return completed(await onChat(body, options), model);
};

test('local source validation requires real timed cues and preserves complete text blocks', () => {
  const chapter = CHAPTERS[0];
  const original = captionData(chapter);
  const transcript = validateTranscript(original, chapter, digest);
  assert.equal(transcript.blocks[0].start, chapter.start + 1);
  assert.equal(transcript.blocks[0].end, chapter.start + 13);
  assert.match(transcript.blocks[0].text, /caption 0.*caption 1/);
  assert.deepEqual(transcript.blocks[0].originalCueIndices, [0, 1]);
  assert.equal(transcript.precisionSeconds, 1);
  assert.equal(original.cues[0].originalIndex, undefined);
  assert.throws(() => validateTranscript({ ...original, sourceUrl: 'https://attacker.invalid' }, chapter, digest));
  assert.throws(() => validateTranscript({ ...original, cues: [original.cues[2], original.cues[0]] }, chapter, digest));
  assert.throws(() => validateTranscript({ ...original, cues: [{ start: 1, end: 1, text: 'bad' }] }, chapter, digest));
});
test('chapter boundary cues are excluded when the one-second uncertainty margin would escape', () => {
  const chapter = CHAPTERS[0];
  const raw = { ...captionData(chapter), cues: [
    { start: chapter.start - 1, end: chapter.start + 5, text: 'outside start' },
    { start: chapter.start + 5, end: chapter.start + 18, text: 'complete allowed cue' },
    { start: chapter.end - 6, end: chapter.end, text: 'outside conservative end' },
  ] };
  const transcript = validateTranscript(raw, chapter, digest);
  assert.equal(transcript.cueCount, 1);
  const index = materializeTranscriptIndex({ units: [annotation()] }, transcript, chapter);
  assert.equal(index.units[0].start, chapter.start + 5);
  assert.equal(index.units[0].end, chapter.start + 19);
  assert.ok(!JSON.stringify(index).includes('outside'));
});
test('model timestamps, unknown, unordered, skipped and reused cue IDs cannot become evidence', () => {
  const chapter = CHAPTERS[0];
  const transcript = validateTranscript(captionData(chapter), chapter, digest);
  for (const raw of [{ units: [annotation(['not-real'])] }, { units: [annotation(['c2', 'c0'])] },
    { units: [annotation(['c0', 'c2'])] }, { units: [annotation(), annotation()] },
    { units: [annotation(['c0'], { start: chapter.start, end: chapter.start + 10 })] }]) {
    assert.throws(() => materializeTranscriptIndex(raw, transcript, chapter));
  }
  const result = materializeTranscriptIndex({ units: [annotation(['c0', 'c1'])] }, transcript, chapter);
  assert.equal(result.units[0].start, transcript.blocks[0].start);
  assert.equal(result.units[0].end, transcript.blocks[1].end + 1);
  assert.equal(result.units[0].cueIds, undefined);
  assert.equal(validateSourceUnits(result, chapter).length, 1);
});
test('source file hashes and source versions change with the actual captions', async (t) => {
  const directory = await sources(t);
  const first = loadTranscripts(directory);
  assert.equal(first.size, 3);
  assert.match(first.get(CHAPTERS[0].videoId).sha256, /^[a-f0-9]{64}$/);
  const file = path.join(directory, `${CHAPTERS[0].videoId}.json`);
  const changed = JSON.parse(await readFile(file, 'utf8'));
  changed.cues[0].text += ' Changed actual source.';
  await writeFile(file, JSON.stringify(changed));
  const second = loadTranscripts(directory);
  assert.notEqual(transcriptIndexVersion(first, digest), transcriptIndexVersion(second, digest));
  assert.notEqual(transcriptIndexVersion(first, digest), transcriptIndexVersion(first, 'd'.repeat(64)));
  assert.equal(loadTranscripts(path.join(directory, 'not-present')).size, 0);
});
test('runtime endpoint is operator-only loopback or the exact isolated Docker service', () => {
  for (const value of ['http://127.0.0.1:11434', 'http://localhost:11434', 'http://[::1]:11434', 'http://zhixin-ollama:11434']) assert.equal(normalizeOllamaEndpoint(value), value);
  for (const value of ['https://external.invalid', 'http://192.168.1.5:11434', 'http://zhixin-ollama:1234', 'http://127.0.0.1:11434/private', 'http://user:password@localhost:11434', 'http://localhost:11434/?key=secret']) assert.throws(() => normalizeOllamaEndpoint(value));
});
test('only explicit latest-generation Gemma 4 variants are allowed, with no older/cloud fallback', async (t) => {
  const directory = await sources(t);
  assert.deepEqual(ALLOWED_GEMMA_MODELS, ['gemma4:e2b', 'gemma4:e4b', 'gemma4:12b']);
  for (const model of ALLOWED_GEMMA_MODELS) {
    const provider = createOllamaProvider({ offlineReview: true, env: configured(directory, { GEMMA_MODEL: model }), fetchImpl: fetchFor(undefined, model) });
    assert.equal(provider.configured, false);
    await provider.prepare();
    assert.equal(provider.configured, true);
    assert.equal(provider.model, model);
  }
  for (const model of ['gemma3:4b', 'gemma4:latest', 'gemma4:cloud']) {
    const provider = createOllamaProvider({ offlineReview: true, env: configured(directory, { GEMMA_MODEL: model }), fetchImpl: () => { throw Error('must not request'); } });
    assert.equal(await provider.prepare(), false);
    assert.equal(provider.reason, 'provider_model_not_configured');
  }
  assert.equal(createAIProvider({ env: { AI_PROVIDER: 'unknown' } }).configured, false);
  assert.equal(createAIProvider({ env: {} }).method, 'gemini_youtube_video');
});
test('offline-review readiness requires sources and the exact local model to be reachable', async (t) => {
  const directory = await sources(t);
  for (const fetchImpl of [async () => { throw Error('offline'); }, async () => tags('wrong:model'), async () => tags('gemma4:e2b', 'not-a-digest')]) {
    const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl });
    assert.equal(provider.configured, false);
    assert.equal(await provider.prepare(), false);
    assert.equal(provider.reason, 'provider_unavailable');
  }
  const absent = createOllamaProvider({ offlineReview: true, env: configured(path.join(directory, 'missing')), fetchImpl: () => { throw Error('must not request'); } });
  assert.equal(await absent.prepare(), false);
  assert.equal(absent.reason, 'source_unavailable');
  const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: fetchFor() });
  const service = createRecommendationService({ provider });
  assert.equal(service.health().configured, false);
  const health = await service.readiness();
  assert.equal(health.configured, true);
  assert.equal(health.method, 'local_gemma_transcript');
  assert.equal(health.modelDigest, digest);
});

test('global generation pause prevents local recommendation readiness probes and generation', async (t) => {
  const directory = await sources(t);
  let requests = 0;
  const settings = configured(directory, { AI_GENERATION_DISABLED: 'true' });
  for (const factory of [createOllamaProvider, createAIProvider]) {
    const provider = factory({ offlineReview: true, env: settings, fetchImpl: async () => { requests++; throw Error('must not request'); } });
    assert.equal(provider.configured, false);
    assert.equal(provider.reason, 'generation_disabled');
    const service = createRecommendationService({ provider });
    assert.equal((await service.readiness()).configured, false);
    assert.equal((await service.recommend({ schemaVersion: 1, watched: [] })).reason, 'generation_disabled');
    await assert.rejects(provider.indexChapter(CHAPTERS[0]), { code: 'generation_disabled' });
    await assert.rejects(provider.choose({ memory: [], candidates: [], goal: '' }), { code: 'generation_disabled' });
  }
  assert.equal(requests, 0);
});

test('a pause during an existing local readiness probe cannot start a later generation request', async (t) => {
  const directory = await sources(t), settings = configured(directory);
  let release, started;
  const probing = new Promise(resolve => { started = resolve; });
  const requests = [];
  const provider = createOllamaProvider({ offlineReview: true, env: settings, fetchImpl: async url => {
    requests.push(url); started();
    await new Promise(resolve => { release = resolve; });
    return tags();
  } });
  const pending = provider.choose({ memory: [], candidates: [], goal: '' });
  await probing; settings.AI_GENERATION_DISABLED = 'true'; release();
  await assert.rejects(pending, { code: 'generation_disabled' });
  assert.deepEqual(requests, ['http://zhixin-ollama:11434/api/tags']);
});
test('Ollama sends CPU-only structured JSON with explicit context/output limits and ignores thought fields', async (t) => {
  const directory = await sources(t);
  let body, options;
  const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: fetchFor((sent, request) => { body = sent; options = request; return { units: [annotation()] }; }) });
  await provider.indexChapter(CHAPTERS[0]);
  assert.equal(body.model, 'gemma4:e2b');
  assert.equal(body.stream, false);
  assert.equal(body.think, false);
  assert.equal(body.options.num_gpu, 0);
  assert.equal(body.options.num_ctx, 8192);
  assert.equal(body.options.num_predict, 2048);
  assert.equal(body.options.num_thread, 4);
  assert.equal(body.format.type, 'object');
  assert.equal(body.tools, undefined);
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal);
  assert.match(body.messages[0].content, /untrusted DATA/);
  assert.ok(!JSON.stringify(body).includes('test-only ignored thought'));
});
test('truncated, wrong-model, malformed or unfinished local model output fails closed', async (t) => {
  const directory = await sources(t);
  for (const bad of [completed({}, 'gemma4:e4b'), completed({}, 'gemma4:e2b', { done: false }), completed({}, 'gemma4:e2b', { done_reason: 'length' }),
    completed({}, 'gemma4:e2b', { message: { content: '```json\n{}\n```' } }), completed([], 'gemma4:e2b')]) {
    const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: async (url) => url.endsWith('/api/tags') ? tags() : bad });
    await assert.rejects(provider.indexChapter(CHAPTERS[0]), /invalid_provider_output/);
  }
});
test('local model calls are serialized rather than contending for CPU/GPU resources', async (t) => {
  const directory = await sources(t);
  let active = 0, maximum = 0, probes = 0;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/api/tags')) { probes++; return tags(); }
    active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    const body = JSON.parse(options.body);
    return completed(body.messages?.[1]?.content.startsWith('Verify evidence') ? { acceptedUnitIndices: [0] } : { units: [annotation()] });
  };
  const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl });
  await Promise.all([provider.indexChapter(CHAPTERS[0]), provider.indexChapter(CHAPTERS[1])]);
  assert.equal(maximum, 1);
  assert.equal(probes, 1);
});
test('long caption sources are partitioned on complete blocks with a strict UTF-8 context bound', async (t) => {
  const directory = await sources(t, (value, chapter) => {
    value.cues = captionData(chapter, 24).cues;
    value.cues.forEach((cue) => { cue.text = 'Test-only genuine-shaped sentence with meaningful conditions. '.repeat(5); });
  });
  const requests = [];
  const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: fetchFor((body) => {
    requests.push(body);
    const ids = [...body.messages[1].content.matchAll(/\n(c\d+) \d/g)].slice(0, 2).map((match) => match[1]);
    return { units: [annotation(ids)] };
  }) });
  const raw = await provider.indexChapter(CHAPTERS[0]);
  assert.ok(requests.length > 1);
  assert.ok(raw.units.length <= 8);
  for (const request of requests) assert.ok(Buffer.byteLength(request.messages.map((item) => item.content).join('\n'), 'utf8') <= 8192 - 2048 - 512);
  assert.ok(provider.validateIndex(raw, CHAPTERS[0]).units.length > 0);
});
test('a source block too large for the full context is rejected without sending any chat request', async (t) => {
  const directory = await sources(t, (value) => { value.cues = [value.cues[0]]; value.cues[0].text = '字'.repeat(2000); });
  let chats = 0;
  const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: fetchFor(() => { chats++; return { units: [annotation()] }; }) });
  await assert.rejects(provider.indexChapter(CHAPTERS[0]), /source_context_exceeded/);
  assert.equal(chats, 0);
});
test('only fully watched conservative cue bounds become local memory; partial seconds remain insufficient', async (t) => {
  const directory = await sources(t);
  const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: fetchFor((body) => {
    if (body.messages[1].content.startsWith('Choose')) {
      const data = JSON.parse(body.messages[1].content.split('DATA=')[1].split('\nJSON schema:')[0]);
      return { unitId: data.candidates[0].id, comparedTo: [data.memory[0].id], relation: 'new_example', adds: '測試新增', reason: '測試理由', usefulness: 'relevant', sameQuestion: true, compatibleConditions: true };
    }
    return { units: [annotation(), annotation(['c2'])] };
  }) });
  const service = createRecommendationService({ provider });
  const partial = await service.recommend({ schemaVersion: 1, watched: [{ videoId: CHAPTERS[0].videoId, ranges: [[2326, 2338]] }] });
  assert.equal(partial.status, 'insufficient_source');
  assert.equal(partial.memory.length, 0);
  const full = await service.recommend({ schemaVersion: 1, watched: [{ videoId: CHAPTERS[0].videoId, ranges: [[2326, 2339]] }] });
  assert.equal(full.status, 'ready');
  assert.equal(full.source.method, 'local_gemma_transcript');
  assert.equal(full.source.transcripts.length, 3);
  assert.equal(full.memory[0].source.end, 2339);
  assert.equal(full.recommendation.usefulness, 'unknown');
  assert.match(full.limitations.join(' '), /精度約 1 秒/);
});
test('public source indexes persist raw cue IDs, reload with strict validation, and never persist viewer history', async (t) => {
  const directory = await sources(t);
  const cacheDirectory = path.join(directory, 'index-cache');
  let calls = 0;
  const create = () => createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: fetchFor(() => { calls++; return { units: [annotation(), annotation(['c2'])] }; }) });
  const warmed = await createRecommendationService({ provider: create(), indexDirectory: cacheDirectory }).preindex();
  assert.ok(warmed.chapters.every((chapter) => chapter.status === 'ready'));
  assert.equal(calls, 3);
  const files = await readdir(cacheDirectory);
  assert.equal(files.length, 3);
  const contents = await Promise.all(files.map((file) => readFile(path.join(cacheDirectory, file), 'utf8')));
  assert.ok(contents.every((raw) => raw.includes('cueIds') && !raw.includes('watched') && !raw.includes('goal')));
  await createRecommendationService({ provider: create(), indexDirectory: cacheDirectory }).preindex();
  assert.equal(calls, 3);
  const firstFile = path.join(cacheDirectory, files[0]);
  const forged = JSON.parse(await readFile(firstFile, 'utf8'));
  forged.raw.units[0].cueIds = ['fabricated'];
  await writeFile(firstFile, JSON.stringify(forged));
  await createRecommendationService({ provider: create(), indexDirectory: cacheDirectory }).preindex();
  assert.equal(calls, 4);
});
test('bounded local comparison considers eligible candidates across videos instead of only the first episode', async (t) => {
  const directory = await sources(t);
  let compared;
  const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: fetchFor((body) => {
    if (body.messages[1].content.startsWith('Choose')) {
      compared = JSON.parse(body.messages[1].content.split('DATA=')[1].split('\nJSON schema:')[0]);
      return { unitId: compared.candidates[0].id, comparedTo: [compared.memory[0].id], relation: 'unknown', adds: '測試', reason: '測試', usefulness: 'unknown', sameQuestion: false, compatibleConditions: false };
    }
    return { units: [annotation(), annotation(['c2'])] };
  }) });
  const result = await createRecommendationService({ provider }).recommend({ schemaVersion: 1,
    watched: [{ videoId: CHAPTERS[0].videoId, ranges: [[2326, 2339]] }] });
  assert.equal(result.status, 'ready');
  assert.deepEqual(compared.candidates.map((unit) => unit.id.split(':')[0]), ['cursor', 'yc', 'anthropic']);
  assert.match(result.limitations.join(' '), /最多考慮 3/);
});
test('offline preindex reports static validation reasons without printing source text or model thoughts', async (t) => {
  const directory = await sources(t);
  const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: fetchFor(() => ({ units: [annotation(['fabricated'])] })) });
  const result = await createRecommendationService({ provider }).preindex();
  assert.ok(result.chapters.every((chapter) => chapter.status === 'unavailable'));
  assert.ok(result.chapters.every((chapter) => chapter.reason === 'invalid_source_index'));
  assert.ok(!JSON.stringify(result).includes('test-only ignored thought'));
  assert.ok(!JSON.stringify(result).includes('Test-only spoken caption'));
});
test('short end fragments cannot become source units even when their timestamps fall inside the chapter', () => {
  const chapter = CHAPTERS[0];
  const raw = { ...captionData(chapter), cues: [{ start: 2770, end: 2774, text: 'This is an incomplete ending fragment and' }] };
  const transcript = validateTranscript(raw, chapter, digest);
  assert.throws(() => materializeTranscriptIndex({ units: [annotation()] }, transcript, chapter), /過短片段/);
});
test('a second evidence pass can reject unsupported conditions or an unfinished claim without rewriting it', async (t) => {
  const directory = await sources(t);
  let verifications = 0;
  const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: async (url, options) => {
    if (url.endsWith('/api/tags')) return tags();
    const body = JSON.parse(options.body);
    if (body.messages[1].content.startsWith('Verify evidence')) { verifications++; return completed({ acceptedUnitIndices: [] }); }
    return completed({ units: [annotation(['c0'], { conditions: ['測試無根據嘅必要條件'] })] });
  } });
  assert.deepEqual(await provider.indexChapter(CHAPTERS[0]), { units: [] });
  assert.equal(verifications, 1);
});
test('verification distinguishes cited evidence from nearby context and accepts only candidate index zero', async (t) => {
  const directory = await sources(t);
  let verification;
  const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: async (url, options) => {
    if (url.endsWith('/api/tags')) return tags();
    const body = JSON.parse(options.body);
    if (body.messages[1].content.startsWith('Verify evidence')) {
      verification = JSON.parse(body.messages[1].content.split('DATA=')[1].split('\nJSON schema:')[0]);
      assert.match(body.messages[1].content, /NEVER use nearby as uncited support/);
      return completed({ acceptedUnitIndices: [1] });
    }
    return completed({ units: [annotation()] });
  } });
  await assert.rejects(provider.indexChapter(CHAPTERS[0]), /invalid_provider_output/);
  assert.deepEqual(verification.candidate.cueIds, ['c0']);
  assert.equal(verification.cited[0].id, 'c0');
  assert.equal(verification.nearby[0].id, 'c1');
});
test('all-English and common Simplified Chinese annotations are rejected rather than shown as Hong Kong paraphrases', async (t) => {
  const directory = await sources(t);
  for (const summary of ['An English quotation presented as the summary.', '这个观点是关于产品的。']) {
    const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: fetchFor(() => ({ units: [annotation(['c0'], { summary })] })) });
    assert.deepEqual(await provider.indexChapter(CHAPTERS[0]), { units: [] });
  }
});
test('automatic GPU selection is an explicit offline-only option and keep-alive zero releases the model', async (t) => {
  const directory = await sources(t);
  const env = configured(directory, { OLLAMA_NUM_GPU: 'auto', OLLAMA_KEEP_ALIVE: '0' });
  const withoutGpuOptIn = createOllamaProvider({ offlineReview: true, env, fetchImpl: () => { throw Error('must not call'); } });
  assert.equal(await withoutGpuOptIn.prepare(), false);
  assert.equal(withoutGpuOptIn.reason, 'provider_not_configured');
  const sent = [];
  const offline = createOllamaProvider({ offlineReview: true, env, allowAutomaticGpu: true, fetchImpl: async (url, options) => {
    if (url.endsWith('/api/tags')) return tags();
    const body = JSON.parse(options.body); sent.push(body);
    return completed(body.messages[1].content.startsWith('Verify evidence') ? { acceptedUnitIndices: [0] } : { units: [annotation()] });
  } });
  assert.equal((await offline.indexChapter(CHAPTERS[0])).units.length, 1);
  assert.equal(sent.length, 2);
  assert.ok(sent.every((body) => body.options.num_gpu === undefined && body.keep_alive === 0));
});
test('the evidence verification pass rejects oversized evidence instead of dropping context', async (t) => {
  const directory = await sources(t);
  let calls = 0;
  const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: fetchFor(() => {
    calls++;
    return { units: [annotation(['c0'], { summary: '測'.repeat(600), support: '測'.repeat(600), topic: '測'.repeat(200), conditions: ['測'.repeat(300), '測'.repeat(300)] })] };
  }) });
  await assert.rejects(provider.indexChapter(CHAPTERS[0]), /source_context_exceeded/);
  assert.equal(calls, 1);
});
test('unspecified local variant uses explicit current-generation 12B without falling back to a smaller model', async (t) => {
  const directory = await sources(t);
  const env = configured(directory);
  delete env.GEMMA_MODEL;
  const provider = createOllamaProvider({ offlineReview: true, env, fetchImpl: fetchFor(undefined, 'gemma4:12b') });
  assert.equal(provider.model, 'gemma4:12b');
  await provider.prepare();
  assert.equal(provider.configured, true);
});
test('mixed malformed, short, out-of-bounds or nonconsecutive candidates do not erase an independent valid claim', async (t) => {
  const directory = await sources(t, (value, chapter) => {
    value.cues = [
      { start: chapter.start + 1, end: chapter.start + 6, text: 'Test-only incomplete short fragment and' },
      { start: chapter.start + 10, end: chapter.start + 24, text: 'Test-only complete source argument with an explicit conclusion.' },
      { start: chapter.start + 30, end: chapter.start + 44, text: 'Test-only separate complete argument and conclusion.' },
    ];
  });
  for (const bad of [null, annotation(['c0']), annotation(['missing']), annotation(['c0', 'c2']),
    annotation(['c1', 'c1']), annotation(['c1'], { start: 1, end: 100000 }), annotation(['c1'], { conditions: 'invalid' })]) {
    let verified = 0;
    const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: async (url, options) => {
      if (url.endsWith('/api/tags')) return tags();
      const body = JSON.parse(options.body);
      if (body.messages[1].content.startsWith('Verify evidence')) { verified++; return completed({ acceptedUnitIndices: [0] }); }
      return completed({ units: [bad, annotation(['c1'])] });
    } });
    const raw = await provider.indexChapter(CHAPTERS[0]);
    assert.equal(raw.units.length, 1);
    assert.deepEqual(raw.units[0].cueIds, ['c1']);
    assert.equal(verified, 1);
    const parsed = validateSourceUnits(provider.validateIndex(raw, CHAPTERS[0]), CHAPTERS[0]);
    assert.equal(parsed[0].start, CHAPTERS[0].start + 10);
    assert.equal(parsed[0].end, CHAPTERS[0].start + 25);
  }
});
test('accepted source units cannot reuse cue IDs or overlap the one-second conservative end margin', async (t) => {
  const directory = await sources(t);
  for (const next of [annotation(['c0']), annotation(['c1'])]) {
    let verified = 0;
    const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: async (url, options) => {
      if (url.endsWith('/api/tags')) return tags();
      const body = JSON.parse(options.body);
      if (body.messages[1].content.startsWith('Verify evidence')) { verified++; return completed({ acceptedUnitIndices: [0] }); }
      return completed({ units: [annotation(['c0']), next] });
    } });
    const raw = await provider.indexChapter(CHAPTERS[0]);
    assert.equal(raw.units.length, 1);
    assert.deepEqual(raw.units[0].cueIds, ['c0']);
    assert.equal(verified, 1);
  }
});
test('a globally valid cue from another extraction window is rejected while that window valid candidate survives', async (t) => {
  const directory = await sources(t, (value, chapter) => {
    value.cues = captionData(chapter, 24).cues;
    value.cues.forEach((cue) => { cue.text = 'Test-only genuine-shaped sentence with meaningful conditions. '.repeat(5); });
  });
  let windows = 0;
  const provider = createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: fetchFor((body) => {
    windows++;
    const allowed = [...body.messages[1].content.matchAll(/\n(c\d+) \d/g)].map((match) => match[1]);
    const outside = allowed.includes('c0') ? 'c23' : 'c0';
    return { units: [annotation([outside]), annotation(allowed.slice(0, 2))] };
  }) });
  const raw = await provider.indexChapter(CHAPTERS[0]);
  assert.ok(windows > 1);
  assert.equal(raw.units.length, windows);
  assert.equal(validateSourceUnits(provider.validateIndex(raw, CHAPTERS[0]), CHAPTERS[0]).length, windows);
});
test('immutable local source cache survives age but source-key changes and future timestamps invalidate it; Gemini still expires', async (t) => {
  const directory = await sources(t);
  const indexDirectory = path.join(directory, 'immutable-index');
  let timestamp = 1000;
  let localCalls = 0;
  const localProvider = () => createOllamaProvider({ offlineReview: true, env: configured(directory), fetchImpl: fetchFor(() => {
    localCalls++; return { units: [annotation(), annotation(['c2'])] };
  }) });
  const localService = (provider = localProvider()) => createRecommendationService({ provider, indexDirectory, now: () => timestamp });
  const original = localService();
  await original.preindex();
  assert.equal(localCalls, 3);
  timestamp += 24 * 60 * 60 * 1000;
  await original.preindex(); // Existing in-memory entries do not expire either.
  await localService().preindex(); // A fresh process-equivalent reuses disk.
  assert.equal(localCalls, 3);
  const sourceFile = path.join(directory, `${CHAPTERS[0].videoId}.json`);
  const changed = JSON.parse(await readFile(sourceFile, 'utf8'));
  changed.cues[0].text += ' Material source revision.';
  await writeFile(sourceFile, JSON.stringify(changed));
  const revised = localService();
  await revised.preindex();
  assert.equal(localCalls, 6); // The global corpus hash changed, so keys changed.
  const activeVersion = revised.health().indexVersion;
  for (const file of await readdir(indexDirectory)) {
    const filename = path.join(indexDirectory, file);
    const saved = JSON.parse(await readFile(filename, 'utf8'));
    if (saved.key.includes(activeVersion)) {
      saved.createdAt = timestamp + 1;
      await writeFile(filename, JSON.stringify(saved));
      break;
    }
  }
  await localService().preindex();
  assert.equal(localCalls, 7); // An impossible future entry still fails closed.

  let geminiCalls = 0;
  const geminiProvider = { configured: true, method: 'gemini_youtube_video', model: 'test-only-gemini', reason: null,
    indexChapter: async (chapter) => {
      geminiCalls++;
      const { cueIds, ...fields } = annotation();
      return { units: [{ ...fields, start: chapter.start + 1, end: chapter.start + 20 }] };
    } };
  const geminiDirectory = path.join(directory, 'gemini-index');
  const gemini = createRecommendationService({ provider: geminiProvider, indexDirectory: geminiDirectory, now: () => timestamp });
  await gemini.preindex();
  assert.equal(geminiCalls, 3);
  timestamp += 7 * 60 * 60 * 1000;
  await gemini.preindex();
  assert.equal(geminiCalls, 6);
});
test('production local HTTP remains quality-blocked even with real-shaped sources and a reachable installed model', async (t) => {
  const directory = await sources(t);
  let chats = 0;
  const provider = createAIProvider({ env: configured(directory, { OFFLINE_REVIEW: 'true', ALLOW_LOCAL_HTTP: 'true' }),
    fetchImpl: async (url) => {
      if (url.endsWith('/api/tags')) return tags();
      chats++; throw Error('production must never generate local analysis');
    } });
  const service = createRecommendationService({ provider });
  const server = createServer({ service });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const health = (await (await fetch(`${origin}/api/health`)).json()).analysis;
  assert.equal(health.configured, false);
  assert.equal(health.runtimeReady, true);
  assert.equal(health.reason, 'source_review_required');
  const response = await fetch(`${origin}/api/recommendations`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schemaVersion: 1, watched: [] }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'source_review_required');
  assert.deepEqual(result.memory, []);
  assert.equal(result.recommendation, null);
  assert.equal(result.source.method, 'local_gemma_transcript');
  assert.equal(chats, 0);
  await assert.rejects(provider.indexChapter(CHAPTERS[0]), /source_review_required/);
  await assert.rejects(provider.choose({ memory: [], candidates: [], goal: '' }), /source_review_required/);
  assert.deepEqual((await service.preindex()).chapters, []);
  assert.equal(chats, 0);
});
