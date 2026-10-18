import { CHAPTERS, INDEX_VERSION, chapterFor, fullyCovered, hasOverlap } from './catalogue.mjs';
import { normalizeRequest, sourceFor, validateChoice, validateSourceUnits, ValidationError } from './validation.mjs';
import { ProviderError } from './gemini.mjs';
import { createAIProvider } from './provider.mjs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, unlink, stat } from 'node:fs/promises';

const unavailableText = {
  generation_disabled: '模型呼叫已暫停，避免模型費用；觀看紀錄仍正常保存在本機。',
  free_route_not_verified: '免費模型路線未完成核對，暫停生成；觀看紀錄仍正常保存在本機。',
  free_tier_quota_exhausted: '免費模型額度暫時已用完，請稍後再試；唔會自動重試或轉用付費服務。觀看紀錄繼續保存。',
  provider_not_configured: '內容分析服務尚未設定連線；觀看紀錄仍正常保存在本機。',
  provider_model_not_configured: '內容分析服務尚未設定支援嘅模型；觀看紀錄仍正常保存在本機。',
  provider_project_not_configured: 'Vertex 內容分析服務尚未設定有效 Google Cloud 專案；觀看紀錄仍正常保存在本機。',
  provider_unavailable: '內容分析服務未能連接或指定模型尚未就緒；觀看紀錄仍正常保存在本機。',
  provider_billing_required: 'Google AI 暫時拒絕生成（402）；請核對 API key 所屬專案及免費／付費額度。觀看紀錄繼續保存。',
  source_review_required: '本機 Gemma 嘅來源摘要未通過品質核對，暫時只供離線測試；觀看紀錄繼續保存。',
  source_unavailable: '未能取得原定三個章節嘅可用內容來源；暫時唔作內容記憶或新增價值判斷。',
  analysis_failed: '今次內容比較未能完成或來源驗證不通過；請稍後再試，唔會用示例代替分析。',
  no_unwatched_source: '目前可分析嘅來源單元已全部睇過或部分睇過；未有足夠完全未看嘅來源作推薦。',
};
export class CapacityError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function humanizeReferences(text, units) {
  for (const unit of [...units].sort((a, b) => b.id.length - a.id.length)) {
    const timestamp = `${Math.floor(unit.start / 60)}:${String(Math.floor(unit.start % 60)).padStart(2, '0')}`;
    text = text.replaceAll(unit.id, `《${chapterFor(unit.videoId).title}》${timestamp}`);
  }
  return text;
}
function diverseUnits(units, limit) {
  const selected = [];
  const byVideo = CHAPTERS.map((chapter) => units.filter((unit) => unit.videoId === chapter.videoId));
  for (let index = 0; selected.length < limit; index++) {
    let added = false;
    for (const chapterUnits of byVideo) {
      if (chapterUnits[index] && selected.length < limit) { selected.push(chapterUnits[index]); added = true; }
    }
    if (!added) break;
  }
  return selected;
}

export function createRecommendationService({ provider = createAIProvider(), now = Date.now,
  maxAnalysesPerHour = 12, maxConcurrent = 2, cacheTtlMs = 6 * 60 * 60 * 1000,
  indexDirectory = '', requireReviewedIndex = false } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  let active = 0;
  let hourStart = now();
  let analyses = 0;
  const indexVersion = () => provider.indexVersion || INDEX_VERSION;
  const health = () => ({ configured: provider.configured === true, method: provider.method || 'gemini_youtube_video', model: provider.model || null,
    transport: provider.transport || null,
    ...(provider.generationPolicy ? { generationPolicy: provider.generationPolicy } : {}),
    ...(requireReviewedIndex ? { sourcePolicy: 'reviewed_index_only' } : {}),
    modelDigest: provider.modelDigest || null, runtimeReady: provider.runtimeReady ?? null,
    reason: provider.reason || null, limits: { maxAnalysesPerHour, maxConcurrent }, indexVersion: indexVersion() });
  const prepare = async () => { await provider.prepare?.(); return health(); };
  const validateIndex = (raw, chapter) => validateSourceUnits(provider.validateIndex ? provider.validateIndex(raw, chapter) : raw, chapter);
  // Local files + actual model digest + algorithm version fully address this
  // immutable corpus. Re-extract only when that key changes, not the next day.
  const currentCache = (createdAt) => Number.isFinite(createdAt) && createdAt >= 0 && createdAt <= now()
    && (requireReviewedIndex || provider.method === 'local_gemma_transcript' || now() - createdAt < cacheTtlMs);

  async function fromDisk(filename, key, chapter) {
    try {
      if ((await stat(filename)).size > 512000) return null;
      const saved = JSON.parse(await readFile(filename, 'utf8'));
      if (saved.schemaVersion !== 1 || saved.key !== key || !currentCache(saved.createdAt)) return null;
      if (requireReviewedIndex && saved.reviewStatus !== 'accepted') return null;
      return { units: validateIndex(saved.raw, chapter), createdAt: saved.createdAt };
    } catch { return null; }
  }
  async function toDisk(filename, key, raw, createdAt) {
    if (!filename || requireReviewedIndex) return;
    let temporary;
    try {
      await mkdir(path.dirname(filename), { recursive: true });
      temporary = `${filename}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, key, createdAt, raw }), { flag: 'wx', mode: 0o600 });
      await rename(temporary, filename);
    } catch { if (temporary) await unlink(temporary).catch(() => {}); }
  }

  async function index(chapter) {
    const key = `${provider.method || 'gemini_youtube_video'}:${provider.model}:${provider.modelDigest || ''}:${indexVersion()}:${chapter.id}`;
    const saved = cache.get(key);
    if (saved && currentCache(saved.createdAt)) return saved.units;
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = Promise.resolve().then(async () => {
      const filename = indexDirectory ? path.join(path.resolve(indexDirectory), `${createHash('sha256').update(key).digest('hex')}.json`) : null;
      const disk = filename ? await fromDisk(filename, key, chapter) : null;
      if (disk) { cache.set(key, disk); return disk.units; }
      // Production fixed-corpus Vertex has no extraction/approval path. This
      // operator-owned metadata is never accepted from a request or model.
      if (requireReviewedIndex) throw new ProviderError('source_unavailable');
      const raw = await provider.indexChapter(chapter);
      const units = validateIndex(raw, chapter);
      const createdAt = now();
      cache.set(key, { units, createdAt });
      await toDisk(filename, key, raw, createdAt);
      return units;
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
  }

  async function recommend(raw) {
    const request = normalizeRequest(raw);
    await prepare();
    const result = { schemaVersion: 1, status: 'unavailable', reason: null, generatedAt: new Date(now()).toISOString(),
      source: { method: provider.method || 'gemini_youtube_video', model: provider.model || null, indexVersion: indexVersion(),
        ...(provider.sourceTranscripts ? { transcripts: provider.sourceTranscripts } : {}),
        verification: 'ai_derived_not_human_verified', chapters: CHAPTERS.map(({ videoId, start, end }) => ({ videoId, start, end, status: 'unavailable' })) },
      memory: [], recommendation: null, limitations: [] };
    const unavailable = (reason) => ({ ...result, status: 'unavailable', reason,
      limitations: [...result.limitations, unavailableText[reason] || unavailableText.analysis_failed] });
    if (!provider.configured) return unavailable(provider.reason || 'provider_not_configured');
    if (now() - hourStart >= 60 * 60 * 1000) { hourStart = now(); analyses = 0; }
    if (analyses >= maxAnalysesPerHour) throw new CapacityError('hourly_budget_reached');
    if (active >= maxConcurrent) throw new CapacityError('analysis_busy');
    analyses++;
    active++;
    try {
      const indexed = await Promise.allSettled(CHAPTERS.map(index));
      if (['free_tier_quota_exhausted', 'free_route_not_verified', 'provider_billing_required', 'generation_disabled'].includes(provider.reason)) return unavailable(provider.reason);
      const units = indexed.flatMap((entry, i) => {
        if (entry.status !== 'fulfilled') return [];
        result.source.chapters[i].status = 'ready';
        return entry.value;
      });
      if (!units.length) return unavailable(indexed.every((entry) => entry.status === 'rejected' && entry.reason instanceof ProviderError
        && entry.reason.code === 'provider_billing_required') ? 'provider_billing_required' : 'source_unavailable');
      result.limitations.push(provider.method === 'local_gemma_transcript'
        ? '內容由本機 Gemma 根據真實字幕整理；時間取自字幕並保守增加 1 秒結束範圍，精度約 1 秒，未經人工逐字核對。只分析三個章節嘅部分完整論點，觀看唔等於理解或認同。'
        : '內容及時間碼由 Google AI 整理，未經人工逐字核對；可返回原片檢查。只分析原定三個章節，觀看唔等於理解或認同。');
      if (requireReviewedIndex) result.limitations.push(`MVP 目前只涵蓋三集內 ${units.length} 個經獨立 AI 來源核對嘅片段，並非完整章節分析；呢個核對亦唔等於人工事實查核。`);
      if (indexed.some((entry) => entry.status !== 'fulfilled')) result.limitations.push('部分章節來源暫時不可用；判斷只涵蓋成功讀取嘅來源單元。');
      const ranges = new Map(request.watched.map((record) => [record.videoId, record.ranges]));
      const watchedUnits = units.filter((unit) => fullyCovered(unit, ranges.get(unit.videoId) || []));
      const memoryLimit = provider.maxMemoryUnits || 80;
      const candidateLimit = provider.maxCandidateUnits || 80;
      const memory = provider.method === 'local_gemma_transcript' ? diverseUnits(watchedUnits, memoryLimit) : watchedUnits.slice(0, memoryLimit);
      const unwatchedUnits = units.filter((unit) => !hasOverlap(unit, ranges.get(unit.videoId) || []));
      const candidates = provider.method === 'local_gemma_transcript' ? diverseUnits(unwatchedUnits, candidateLimit) : unwatchedUnits.slice(0, candidateLimit);
      result.memory = memory.map((unit) => ({ id: unit.id, summary: unit.summary, conditions: unit.conditions, source: sourceFor(unit) }));
      if (watchedUnits.length > memory.length) result.limitations.push(`今次最多比較 ${memoryLimit} 個完整已看來源單元，其餘已看內容未納入。`);
      if (unwatchedUnits.length > candidates.length) result.limitations.push(`今次最多考慮 ${candidateLimit} 個未看候選單元，唔代表已比較所有內容。`);
      if (units.some((unit) => hasOverlap(unit, ranges.get(unit.videoId) || []) && !fullyCovered(unit, ranges.get(unit.videoId) || []))) {
        result.limitations.push('部分睇過嘅來源單元未完整覆蓋，唔會當作已看論點，亦唔會將佢推薦為完全未睇。');
      }
      if (!candidates.length) {
        result.status = 'insufficient_source';
        result.reason = 'no_unwatched_source';
        result.limitations.push(unavailableText.no_unwatched_source);
        return result;
      }
      if (!memory.length) {
        const selected = candidates[0];
        const chapter = chapterFor(selected.videoId);
        result.status = request.watched.length ? 'insufficient_source' : 'no_history';
        result.recommendation = { id: selected.id, title: chapter.title, summary: selected.summary,
          relation: 'unknown', adds: '未有足夠完整已看內容作個人新增價值比較。',
          reason: '先由原定三集嘅一段有內容來源嘅片段開始；呢個係一般入門選擇。',
          usefulness: 'unknown', candidateSource: sourceFor(selected), comparedTo: [] };
        result.limitations.push(request.watched.length ? '已儲存觀看範圍未完整覆蓋可用來源單元；保留記錄，暫時只提供一般選擇。' : '未有可比較嘅已看內容，唔會聲稱呢段對你係新資訊。');
        return result;
      }
      try {
        const choice = validateChoice(await provider.choose({ memory, candidates, goal: request.goal }), memory, candidates, request.goal);
        const chapter = chapterFor(choice.selected.videoId);
        result.status = 'ready';
        result.recommendation = { id: choice.selected.id, title: chapter.title, summary: choice.selected.summary,
          relation: choice.relation,
          adds: humanizeReferences(choice.adds, [choice.selected, ...choice.references]),
          reason: humanizeReferences(choice.reason, [choice.selected, ...choice.references]), usefulness: choice.usefulness,
          candidateSource: sourceFor(choice.selected), comparedTo: choice.references.map((unit) => ({ memoryId: unit.id, source: sourceFor(unit) })) };
        if (!request.goal) result.limitations.push('未提供學習目標，用處分類保留為未能判斷；唔推斷你嘅目的。');
        return result;
      } catch (error) { return unavailable(provider.reason || (error instanceof ProviderError && error.code === 'provider_billing_required' ? 'provider_billing_required' : 'analysis_failed')); }
    } finally { active--; }
  }
  async function preindex({ onChapter = () => {} } = {}) {
    const readiness = await prepare();
    if (!readiness.configured) return { ...readiness, chapters: [] };
    const chapters = [];
    for (const chapter of CHAPTERS) {
      let result;
      try { result = { videoId: chapter.videoId, status: 'ready', unitCount: (await index(chapter)).length }; }
      catch (error) { result = { videoId: chapter.videoId, status: 'unavailable', unitCount: 0,
        reason: error instanceof ProviderError ? error.code : error instanceof ValidationError ? 'invalid_source_index' : 'source_unavailable',
        ...(error instanceof ValidationError ? { validation: error.message } : {}) }; }
      chapters.push(result);
      onChapter(result);
    }
    return { ...health(), chapters };
  }
  return { recommend, health, readiness: prepare, preindex };
}
