import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { CHAPTERS } from './catalogue.mjs';
import { createGeminiProvider, filterVertexSourceIndex } from './gemini.mjs';
import { createAIProvider } from './provider.mjs';
import { createRecommendationService } from './recommend.mjs';
import { validateSourceUnits, ValidationError } from './validation.mjs';

// Fake credentials and synthetic provider output only; no external API calls.
const env = { AI_PROVIDER: 'vertex', GEMINI_API_KEY: 'test-only-key+/?&', GEMINI_MODEL: 'gemini-3.8-flash',
  GOOGLE_CLOUD_PROJECT: 'zhixin-test-project', GEMINI_BILLING_PAUSED: 'true' };
const response = (value) => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }));
const units = (chapter) => ({ units: [{ start: chapter.start, end: chapter.start + 20,
  summary: '合成測試論點', conditions: [], topic: '合成測試問題', support: '合成測試依據', speaker: '測試講者' }] });

test('Vertex is explicitly selected, validates project/model and never inherits the Developer pause', async () => {
  const provider = createAIProvider({ env });
  assert.equal(provider.configured, true);
  assert.equal(provider.reason, null);
  assert.equal(provider.transport, 'vertex');
  assert.equal(provider.method, 'gemini_youtube_video');
  assert.equal(provider.indexVersion, 'vertex-youtube-chapters-v2');
  const health = createRecommendationService({ provider }).health();
  assert.equal(health.transport, 'vertex');
  assert.equal(health.indexVersion, 'vertex-youtube-chapters-v2');
  for (const project of ['', '../other', 'abc?key=leak', 'https://attacker.invalid', 'WrongCase', 'short', 'project-ending-']) {
    let calls = 0;
    const invalid = createAIProvider({ env: { ...env, GOOGLE_CLOUD_PROJECT: project }, fetchImpl: async () => { calls++; throw Error('must not call'); } });
    assert.equal(invalid.reason, 'provider_project_not_configured');
    const result = await createRecommendationService({ provider: invalid }).recommend({ schemaVersion: 1, watched: [] });
    assert.equal(result.reason, 'provider_project_not_configured');
    assert.deepEqual(result.memory, []);
    assert.equal(result.recommendation, null);
    assert.equal(calls, 0);
  }
  assert.equal(createAIProvider({ env: { ...env, GOOGLE_CLOUD_PROJECT: '123456789012' } }).configured, true);
  assert.equal(createAIProvider({ env: { ...env, GEMINI_MODEL: 'gemini-3.6-flash' } }).configured, true);
  assert.equal(createAIProvider({ env: { ...env, GEMINI_MODEL: 'gemini-2.5-flash' } }).reason, 'provider_model_not_configured');
  assert.equal(createAIProvider({ env: { ...env, AI_PROVIDER: 'gemini' }, transport: 'vertex' }).transport, 'gemini');
  assert.equal(createAIProvider({ env: { ...env, AI_PROVIDER: 'gemini' } }).reason, 'provider_billing_required');
});

test('Vertex uses the fixed project/global URL, encoded query key and exact clipped YouTube REST parts', async () => {
  let sent;
  const provider = createAIProvider({ env, fetchImpl: async (url, options) => { sent = { url, options, body: JSON.parse(options.body) }; return response({ units: [] }); } });
  await provider.indexChapter(CHAPTERS[0]);
  assert.equal(sent.url, 'https://aiplatform.googleapis.com/v1/projects/zhixin-test-project/locations/global/publishers/google/models/gemini-3.8-flash:generateContent?key=test-only-key%2B%2F%3F%26');
  assert.deepEqual(sent.options.headers, { 'content-type': 'application/json' });
  assert.equal(sent.options.method, 'POST');
  assert.ok(sent.options.signal instanceof AbortSignal);
  assert.deepEqual(sent.body.contents[0].parts[0], {
    fileData: { fileUri: 'https://www.youtube.com/watch?v=En5cSXgGvZM', mimeType: 'video/mp4' },
    videoMetadata: { startOffset: '2325s', endOffset: '2776s', fps: 1 },
  });
  assert.deepEqual(sent.body.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
  assert.equal(sent.body.generationConfig.responseMimeType, 'application/json');
  const schema = sent.body.generationConfig.responseSchema;
  assert.equal(schema.properties.units.minItems, undefined);
  assert.equal(schema.properties.units.maxItems, undefined);
  assert.equal(schema.properties.units.items.properties.conditions.maxItems, undefined);
  assert.deepEqual(schema.required, ['units']);
  assert.deepEqual(schema.properties.units.items.required, ['start', 'end', 'summary', 'conditions', 'topic', 'support', 'speaker']);
  assert.equal(schema.properties.units.items.properties.conditions.items.type, 'STRING');
  assert.match(sent.body.contents[0].parts[1].text, /at most 40/);
  assert.match(sent.body.contents[0].parts[1].text, /conditions \(<=6/);
  assert.equal(sent.body.tools, undefined);
  assert.equal(JSON.stringify(sent.body).includes(env.GEMINI_API_KEY), false);
  assert.equal(JSON.stringify(provider).includes(env.GEMINI_API_KEY), false);
});

test('removing Vertex schema array bounds never lets oversized source results enter an index, cache or response', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zhixin-vertex-bounds-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const excessive of ['units', 'conditions']) {
    let calls = 0;
    const provider = createAIProvider({ env, fetchImpl: async (_, options) => {
      calls++;
      const body = JSON.parse(options.body);
      assert.equal(/"(?:minItems|maxItems)":/.test(JSON.stringify(body.generationConfig.responseSchema)), false);
      const chapter = CHAPTERS.find((entry) => body.contents[0].parts[0].fileData.fileUri.endsWith(entry.videoId));
      const raw = units(chapter);
      if (excessive === 'units') raw.units = Array.from({ length: 41 }, (_, i) => ({ ...raw.units[0], start: chapter.start + i * 6, end: chapter.start + i * 6 + 5 }));
      else raw.units[0].conditions = Array.from({ length: 7 }, () => '超額條件');
      return response(raw);
    } });
    const service = createRecommendationService({ provider, indexDirectory: directory });
    for (let i = 0; i < 2; i++) {
      const result = await service.recommend({ schemaVersion: 1, watched: [] });
      assert.equal(result.status, 'unavailable');
      assert.equal(result.reason, 'source_unavailable');
      assert.deepEqual(result.memory, []);
      assert.equal(result.recommendation, null);
      assert.ok(result.source.chapters.every((chapter) => chapter.status === 'unavailable'));
      assert.deepEqual(await readdir(directory), []);
    }
    assert.equal(calls, 6, 'invalid source results must not be reused from memory cache');
  }
});

test('Vertex failure errors redact URL/key, do not retry/fallback, and keep its 402 circuit instance-local', async () => {
  let calls = 0;
  const provider = createAIProvider({ env, fetchImpl: async (url) => { calls++; throw Error(`network rejected ${url}`); } });
  await assert.rejects(provider.indexChapter(CHAPTERS[0]), (error) => error.code === 'provider_unavailable'
    && !error.stack.includes(env.GEMINI_API_KEY) && !error.stack.includes('aiplatform.googleapis.com'));
  assert.equal(calls, 1);
  let bodyReads = 0;
  const rejected = createAIProvider({ env, fetchImpl: async () => { calls++; return { ok: false, status: 402,
    text: async () => { bodyReads++; throw Error('private error'); } }; } });
  await assert.rejects(rejected.indexChapter(CHAPTERS[0]), /provider_billing_required/);
  await assert.rejects(rejected.indexChapter(CHAPTERS[1]), /provider_billing_required/);
  assert.equal(calls, 2);
  assert.equal(bodyReads, 0);
  assert.equal(rejected.configured, false);
  assert.equal(createAIProvider({ env }).configured, true);
});

test('Vertex validates extracted sources and comparisons through the same watched-range contract', async () => {
  let calls = 0;
  const provider = createAIProvider({ env, fetchImpl: async (_, options) => {
    calls++;
    const body = JSON.parse(options.body);
    const video = body.contents[0].parts[0].fileData;
    if (video) return response(units(CHAPTERS.find((chapter) => video.fileUri.endsWith(chapter.videoId))));
    const schema = body.generationConfig.responseSchema;
    assert.equal(schema.properties.comparedTo.maxItems, undefined);
    assert.deepEqual(schema.properties.relation.enum, ['repeated', 'new_example', 'new_idea', 'opposing', 'unknown']);
    assert.ok(schema.required.includes('comparedTo'));
    const data = JSON.parse(body.contents[0].parts[0].text.split('DATA=')[1]);
    return response({ unitId: data.candidates[0].id, relation: 'new_idea', comparedTo: [data.memory[0].id],
      adds: '合成測試新增角度', reason: '合成測試理由', usefulness: 'relevant', sameQuestion: true, compatibleConditions: true });
  } });
  const result = await createRecommendationService({ provider }).recommend({ schemaVersion: 1, goal: '測試',
    watched: [{ videoId: CHAPTERS[0].videoId, ranges: [[2325, 2345]] }] });
  assert.equal(result.status, 'ready');
  assert.equal(result.source.indexVersion, 'vertex-youtube-chapters-v2');
  assert.equal(result.memory.length, 1);
  assert.equal(result.memory[0].source.start, 2325);
  assert.equal(result.memory[0].source.end, 2345);
  assert.notEqual(result.recommendation.candidateSource.videoId, CHAPTERS[0].videoId);
  assert.deepEqual(result.recommendation.comparedTo[0].source, result.memory[0].source);
  assert.equal(calls, 4);
});

test('Vertex and Developer source caches remain separate even with identical model and source IDs', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zhixin-vertex-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const fetchImpl = async (_, options) => {
    calls++;
    const video = JSON.parse(options.body).contents[0].parts[0].fileData;
    return response(units(CHAPTERS.find((chapter) => video.fileUri.endsWith(chapter.videoId))));
  };
  const developer = createGeminiProvider({ env: { ...env, GEMINI_BILLING_PAUSED: 'false' }, fetchImpl });
  const vertex = createAIProvider({ env, fetchImpl });
  const first = await createRecommendationService({ provider: developer, indexDirectory: directory }).preindex();
  const second = await createRecommendationService({ provider: vertex, indexDirectory: directory }).preindex();
  const reused = await createRecommendationService({ provider: createAIProvider({ env, fetchImpl }), indexDirectory: directory }).preindex();
  assert.ok([first, second, reused].every((result) => result.chapters.every((chapter) => chapter.status === 'ready')));
  assert.equal(calls, 6);
});

test('Vertex independently rejects malformed, out-of-bounds, long and overlapping units without changing valid intervals', () => {
  const chapter = CHAPTERS[0];
  const first = units(chapter).units[0];
  const later = { ...first, start: chapter.start + 40, end: chapter.start + 60, summary: '另一個完整測試論點' };
  const overlapping = { ...first, start: chapter.start + 10, end: chapter.start + 30 };
  const raw = { units: [later, { ...first, end: chapter.start + 137 }, null,
    { ...first, start: chapter.start - 1 }, { ...first, end: chapter.start + 4 },
    { ...first, conditions: Array(7).fill('超額條件') }, { ...first, url: 'https://attacker.invalid' },
    overlapping, first] };
  const unchanged = JSON.stringify(raw);
  const filtered = filterVertexSourceIndex(raw, chapter);
  assert.deepEqual(filtered.units, [first, later]);
  assert.strictEqual(filtered.units[0], first);
  assert.strictEqual(filtered.units[1], later);
  assert.equal(JSON.stringify(raw), unchanged);
  assert.equal(validateSourceUnits(filtered, chapter).length, 2);
  for (const invalid of [{ units: [first], extra: true }, { units: {} }, { units: Array(41).fill(first) }]) {
    assert.throws(() => filterVertexSourceIndex(invalid, chapter), ValidationError);
  }
  assert.deepEqual(filterVertexSourceIndex({ units: [{ ...first, end: chapter.start + 100 }] }, chapter), { units: [] });
});

test('only independently valid Vertex units reach source caches; an all-invalid chapter remains unavailable', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zhixin-vertex-filter-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const provider = createAIProvider({ env, fetchImpl: async (_, options) => {
    const video = JSON.parse(options.body).contents[0].parts[0].fileData;
    const chapter = CHAPTERS.find((entry) => video.fileUri.endsWith(entry.videoId));
    const valid = units(chapter).units[0];
    return response({ units: [{ ...valid, end: chapter.start + 137 }, ...(chapter === CHAPTERS[2] ? [] : [valid])] });
  } });
  const service = createRecommendationService({ provider, indexDirectory: directory });
  const result = await service.preindex();
  assert.deepEqual(result.chapters.map(({ status, unitCount }) => ({ status, unitCount })), [
    { status: 'ready', unitCount: 1 }, { status: 'ready', unitCount: 1 }, { status: 'unavailable', unitCount: 0 },
  ]);
  const filenames = await readdir(directory);
  assert.equal(filenames.length, 2);
  for (const filename of filenames) {
    const saved = JSON.parse(await readFile(path.join(directory, filename), 'utf8'));
    assert.equal(saved.raw.units.length, 1);
    assert.equal(saved.raw.units[0].end - saved.raw.units[0].start, 20);
  }
});

test('reviewed-only Vertex reuses old accepted source records across restarts and never extracts or writes viewer input', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zhixin-reviewed-index-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let requests = 0;
  const provider = createAIProvider({ env, fetchImpl: async () => { requests++; throw Error('no extraction or comparison expected'); } });
  const now = () => Date.UTC(2026, 9, 17);
  const recordFor = (chapter, extra = {}) => {
    const key = `${provider.method}:${provider.model}::${provider.indexVersion}:${chapter.id}`;
    return { filename: path.join(directory, `${createHash('sha256').update(key).digest('hex')}.json`),
      record: { schemaVersion: 1, key, createdAt: now() - 30 * 24 * 60 * 60 * 1000,
        reviewStatus: 'accepted', raw: units(chapter), ...extra } };
  };
  for (const chapter of CHAPTERS) {
    const { filename, record } = recordFor(chapter);
    await writeFile(filename, JSON.stringify(record));
  }
  const before = await Promise.all((await readdir(directory)).sort().map((name) => readFile(path.join(directory, name), 'utf8')));
  for (let restart = 0; restart < 2; restart++) {
    const service = createRecommendationService({ provider, now, indexDirectory: directory, requireReviewedIndex: true });
    assert.equal(service.health().sourcePolicy, 'reviewed_index_only');
    const result = await service.recommend({ schemaVersion: 1, watched: [] });
    assert.equal(result.status, 'no_history');
    assert.ok(result.source.chapters.every((chapter) => chapter.status === 'ready'));
    assert.equal(result.source.verification, 'ai_derived_not_human_verified');
    assert.equal(result.recommendation.candidateSource.start, CHAPTERS[0].start);
  }
  assert.equal(requests, 0);
  assert.deepEqual(await Promise.all((await readdir(directory)).sort().map((name) => readFile(path.join(directory, name), 'utf8'))), before);

  // Missing, draft, wrong-key, future-dated or structurally invalid records
  // cannot trigger regeneration or acquire approval from the HTTP path.
  await Promise.all((await readdir(directory)).map((name) => rm(path.join(directory, name))));
  const variants = [undefined, { reviewStatus: 'draft' }, { reviewStatus: undefined },
    { key: 'wrong-key' }, { createdAt: now() + 1 }, { raw: { units: [] } }, { schemaVersion: 2 }];
  for (const variant of variants) {
    const { filename, record } = recordFor(CHAPTERS[0], variant || {});
    if (variant) await writeFile(filename, JSON.stringify(record));
    const previous = variant ? await readFile(filename, 'utf8') : null;
    const service = createRecommendationService({ provider, now, indexDirectory: directory, requireReviewedIndex: true });
    const result = await service.recommend({ schemaVersion: 1, goal: 'PRIVATE_VIEWER_SENTINEL',
      watched: [{ videoId: CHAPTERS[0].videoId, ranges: [[2325, 2345]] }] });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'source_unavailable');
    assert.deepEqual(result.memory, []);
    assert.equal(result.recommendation, null);
    assert.equal(requests, 0);
    if (variant) {
      assert.equal(await readFile(filename, 'utf8'), previous);
      assert.equal(previous.includes('PRIVATE_VIEWER_SENTINEL'), false);
      await rm(filename);
    }
    assert.deepEqual(await readdir(directory), []);
  }
});
