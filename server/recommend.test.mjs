import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, mergeRanges, fullyCovered, hasOverlap, sourceUrl } from './catalogue.mjs';
import { normalizeRequest, validateSourceUnits, validateChoice, ValidationError } from './validation.mjs';
import { createRecommendationService, CapacityError } from './recommend.mjs';
import { ProviderError } from './gemini.mjs';

// Synthetic provider fixtures are confined to tests; the runtime has no seed data.
const rawUnit = (chapter, offset = 0, extra = {}) => ({ start: chapter.start + offset, end: chapter.start + offset + 20,
  summary: '測試來源論點', conditions: ['測試適用條件'], topic: '測試問題', support: '測試來源依據', speaker: '測試講者', ...extra });
const rawIndex = (chapter) => ({ units: [rawUnit(chapter), rawUnit(chapter, 25)] });
const fixtureProvider = (extra = {}) => ({ configured: true, model: 'test-provider', reason: null,
  indexChapter: async (chapter) => rawIndex(chapter),
  choose: async ({ memory, candidates }) => ({ unitId: candidates[0].id, relation: 'new_example',
    comparedTo: [memory[0].id], adds: '測試新增部分', reason: '測試推薦理由', usefulness: 'relevant', sameQuestion: true, compatibleConditions: true }), ...extra });
const request = (ranges = [], goal) => ({ schemaVersion: 1, ...(goal === undefined ? {} : { goal }),
  watched: ranges.length ? [{ videoId: CHAPTERS[0].videoId, ranges }] : [] });
const watchedRequest = (goal) => request([[CHAPTERS[0].start, CHAPTERS[0].start + 20]], goal);

test('normalization clips exactly to selected chapters and unions replay without filling a seek gap', () => {
  const start = CHAPTERS[0].start;
  const normalized = normalizeRequest(request([[0, start + 5], [start, start + 10], [start + 20, start + 30], [start + 22, start + 25]]));
  assert.deepEqual(normalized.watched[0].ranges, [[start, start + 10], [start + 20, start + 30]]);
  assert.equal(normalizeRequest(request([[0, 30]])).watched.length, 0);
});
test('adjacent saved ranges cover a unit, but partial overlap and gaps cannot become memory', () => {
  const unit = { start: 10, end: 30 };
  assert.equal(fullyCovered(unit, mergeRanges([[10, 20], [20, 30]])), true);
  assert.equal(fullyCovered(unit, mergeRanges([[10, 19], [20, 30]])), false);
  assert.equal(fullyCovered(unit, [[10, 29.999]]), false);
  assert.equal(hasOverlap(unit, [[30, 40]]), false);
  assert.equal(hasOverlap(unit, [[29.999, 40]]), true);
});
test('request rejects unknown videos, extra history fields, invalid ranges and oversized ranges', () => {
  assert.throws(() => normalizeRequest({ schemaVersion: 1, watched: [{ videoId: 'abcdefghijk', ranges: [[1, 2]] }] }), ValidationError);
  assert.throws(() => normalizeRequest({ ...request(), history: 'private' }), ValidationError);
  assert.throws(() => normalizeRequest(request([[NaN, 5]])), ValidationError);
  assert.throws(() => normalizeRequest(request([[30, 20]])), ValidationError);
  assert.throws(() => normalizeRequest(request(Array.from({ length: 161 }, () => [2325, 2326]))), ValidationError);
  assert.throws(() => normalizeRequest(request([], 'x'.repeat(201))), ValidationError);
});
test('source validation cannot accept authored URLs, outside timestamps or overlapping units', () => {
  const chapter = CHAPTERS[0];
  assert.throws(() => validateSourceUnits({ units: [{ ...rawUnit(chapter), url: 'https://attacker.invalid' }] }, chapter), ValidationError);
  assert.throws(() => validateSourceUnits({ units: [rawUnit(chapter, -10)] }, chapter), ValidationError);
  assert.throws(() => validateSourceUnits({ units: [rawUnit(chapter, 0, { end: chapter.end + 1 })] }, chapter), ValidationError);
  assert.throws(() => validateSourceUnits({ units: [rawUnit(chapter), rawUnit(chapter, 5)] }, chapter), ValidationError);
  assert.throws(() => validateSourceUnits({ units: [] }, chapter), ValidationError);
});
test('source IDs and URLs are server-generated with preserved exact seconds', () => {
  const unit = validateSourceUnits({ units: [rawUnit(CHAPTERS[0], 0.25)] }, CHAPTERS[0])[0];
  assert.match(unit.id, /^cursor:\d+:\d+:[a-f0-9]{8}$/);
  assert.equal(unit.start, 2325.25);
  assert.equal(sourceUrl(unit.videoId, unit.start), 'https://www.youtube.com/watch?v=En5cSXgGvZM&t=2325s');
});
test('unconfigured provider returns honest unavailable without invoking a model or populating memory', async () => {
  const provider = fixtureProvider({ configured: false, model: null, reason: 'provider_not_configured', indexChapter: () => { throw Error('must not call'); } });
  const result = await createRecommendationService({ provider }).recommend(watchedRequest());
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'provider_not_configured');
  assert.deepEqual(result.memory, []);
  assert.equal(result.recommendation, null);
  assert.ok(result.source.chapters.every((chapter) => chapter.status === 'unavailable'));
});
test('cold start uses a source-backed general entry without personalization or invented goals', async () => {
  let choices = 0;
  const service = createRecommendationService({ provider: fixtureProvider({ choose: () => { choices++; throw Error('must not compare'); } }) });
  const result = await service.recommend(request([], '測試目標'));
  assert.equal(result.status, 'no_history');
  assert.equal(result.reason, null);
  assert.equal(result.memory.length, 0);
  assert.equal(result.recommendation.relation, 'unknown');
  assert.equal(result.recommendation.usefulness, 'unknown');
  assert.deepEqual(result.recommendation.comparedTo, []);
  assert.equal(choices, 0);
});
test('partial watched units remain excluded both from claimed memory and unwatched recommendations', async () => {
  const result = await createRecommendationService({ provider: fixtureProvider() }).recommend(request([[2325, 2335]]));
  assert.equal(result.status, 'insufficient_source');
  assert.equal(result.memory.length, 0);
  assert.equal(result.recommendation.candidateSource.start, 2350);
  assert.match(result.limitations.join(' '), /部分睇過/);
});
test('ready recommendation references only fully covered memory and a zero-overlap candidate', async () => {
  let seen;
  const provider = fixtureProvider({ choose: async (input) => { seen = input; return fixtureProvider().choose(input); } });
  const result = await createRecommendationService({ provider }).recommend(watchedRequest('測試目標'));
  assert.equal(result.status, 'ready');
  assert.equal(result.memory.length, 1);
  assert.equal(result.recommendation.usefulness, 'relevant');
  assert.equal(result.recommendation.comparedTo[0].memoryId, result.memory[0].id);
  assert.equal(result.recommendation.candidateSource.start, 2350);
  assert.equal(seen.goal, '測試目標');
  assert.ok(!JSON.stringify(seen).includes('watched'));
});
test('without a goal, usefulness cannot be inferred even if model returns relevant', async () => {
  const result = await createRecommendationService({ provider: fixtureProvider() }).recommend(watchedRequest());
  assert.equal(result.recommendation.usefulness, 'unknown');
});
test('a provider cannot cite an unknown candidate or an unwatched reference', async () => {
  for (const field of ['unitId', 'comparedTo']) {
    const provider = fixtureProvider({ choose: async (input) => ({ ...await fixtureProvider().choose(input), [field]: field === 'unitId' ? 'forged' : ['forged'] }) });
    const result = await createRecommendationService({ provider }).recommend(watchedRequest());
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'analysis_failed');
    assert.equal(result.recommendation, null);
    assert.equal(result.memory.length, 1);
  }
});
test('opposing viewpoints require a watched source, the same question and compatible conditions', async () => {
  for (const input of [{ sameQuestion: false }, { compatibleConditions: false }, { comparedTo: [] }]) {
    const provider = fixtureProvider({ choose: async (data) => ({ ...await fixtureProvider().choose(data), relation: 'opposing', ...input }) });
    const result = await createRecommendationService({ provider }).recommend(watchedRequest());
    assert.equal(result.reason, 'analysis_failed');
  }
  const provider = fixtureProvider({ choose: async (data) => ({ ...await fixtureProvider().choose(data), relation: 'opposing' }) });
  assert.equal((await createRecommendationService({ provider }).recommend(watchedRequest())).recommendation.relation, 'opposing');
});
test('new ideas and repeat classifications cannot claim a baseline with no references', () => {
  const units = validateSourceUnits(rawIndex(CHAPTERS[0]), CHAPTERS[0]);
  for (const relation of ['new_idea', 'new_example', 'repeated', 'opposing']) {
    assert.throws(() => validateChoice({ unitId: units[1].id, relation, comparedTo: [], adds: '測試', reason: '測試',
      usefulness: 'unknown', sameQuestion: true, compatibleConditions: true }, [units[0]], [units[1]], ''), ValidationError);
  }
});
test('partial source availability is visible and absent chapters never generate memory', async () => {
  const provider = fixtureProvider({ indexChapter: async (chapter) => { if (chapter.id !== 'cursor') throw Error('unavailable'); return rawIndex(chapter); } });
  const result = await createRecommendationService({ provider }).recommend(watchedRequest());
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.source.chapters.map((chapter) => chapter.status), ['ready', 'unavailable', 'unavailable']);
  assert.match(result.limitations.join(' '), /部分章節來源/);
});
test('all unavailable sources and invalid source output cannot fall back to UI fixtures', async () => {
  for (const indexChapter of [async () => { throw Error('offline'); }, async () => ({ units: [] })]) {
    const result = await createRecommendationService({ provider: fixtureProvider({ indexChapter }) }).recommend(watchedRequest());
    assert.equal(result.reason, 'source_unavailable');
    assert.deepEqual(result.memory, []);
    assert.equal(result.recommendation, null);
  }
});
test('already partly watched or completed source units produce no fake next recommendation', async () => {
  const payload = { schemaVersion: 1, watched: CHAPTERS.map((chapter) => ({ videoId: chapter.videoId, ranges: [[chapter.start, chapter.end]] })) };
  const result = await createRecommendationService({ provider: fixtureProvider() }).recommend(payload);
  assert.equal(result.status, 'insufficient_source');
  assert.equal(result.reason, 'no_unwatched_source');
  assert.equal(result.recommendation, null);
  assert.equal(result.memory.length, 6);
});
test('source indexes are cached, concurrent requests share in-flight indexing, and budget is global', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const provider = fixtureProvider({ indexChapter: async (chapter) => { calls++; await gate; return rawIndex(chapter); } });
  const service = createRecommendationService({ provider, maxAnalysesPerHour: 3 });
  const a = service.recommend(request());
  const b = service.recommend(request());
  await assert.rejects(service.recommend(request()), (error) => error instanceof CapacityError && error.code === 'analysis_busy');
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 3);
  await service.recommend(request());
  assert.equal(calls, 3);
  await assert.rejects(service.recommend(request()), (error) => error.code === 'hourly_budget_reached');
});
test('hourly budget resets and source TTL expiry causes a fresh index without storing private history', async () => {
  let timestamp = 0;
  let calls = 0;
  const service = createRecommendationService({ now: () => timestamp, maxAnalysesPerHour: 1, cacheTtlMs: 1000,
    provider: fixtureProvider({ indexChapter: async (chapter) => { calls++; return rawIndex(chapter); } }) });
  await service.recommend(request());
  timestamp = 3600000;
  await service.recommend(watchedRequest());
  assert.equal(calls, 6);
});
test('billing failures from all source indexes remain a billing result instead of fabricated source-unavailable', async () => {
  let calls = 0;
  const provider = fixtureProvider({ indexChapter: async () => { calls++; throw new ProviderError('provider_billing_required'); } });
  const result = await createRecommendationService({ provider }).recommend(watchedRequest());
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'provider_billing_required');
  assert.deepEqual(result.memory, []);
  assert.equal(result.recommendation, null);
  assert.match(result.limitations.join(' '), /402.*所屬專案及免費／付費額度/);
  assert.equal(calls, 3);
});
test('a billing failure during comparison preserves validated memory but never presents a recommendation', async () => {
  const provider = fixtureProvider({ choose: async () => { throw new ProviderError('provider_billing_required'); } });
  const result = await createRecommendationService({ provider }).recommend(watchedRequest());
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'provider_billing_required');
  assert.equal(result.memory.length, 1);
  assert.equal(result.recommendation, null);
});
