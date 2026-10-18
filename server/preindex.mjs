import { createAIProvider } from './provider.mjs';
import { createRecommendationService } from './recommend.mjs';

// Operator-only source warming, outside the public HTTP path. Contains no
// viewer input and never writes private viewing history into the source cache.
const provider = createAIProvider({ allowAutomaticGpu: true, offlineReview: true });
const service = createRecommendationService({ provider, indexDirectory: process.env.TRANSCRIPT_INDEX_DIR || '', requireReviewedIndex: false });
const result = await service.preindex({ onChapter: (chapter) => process.stdout.write(`${JSON.stringify(chapter)}\n`) });
process.stdout.write(`${JSON.stringify({ configured: result.configured, method: result.method, model: result.model,
  modelDigest: result.modelDigest, indexVersion: result.indexVersion, reason: result.reason,
  chapters: result.chapters })}\n`);
if (!result.configured || result.chapters.length !== 3 || result.chapters.some((chapter) => chapter.status !== 'ready')) process.exitCode = 1;
