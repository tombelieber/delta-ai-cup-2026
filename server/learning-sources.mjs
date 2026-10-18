// Reviewed pilot source anchors, not a general video transcript index.
// Basis: the exported English YouTube captions for dI8w0utjUc0 checked on
// 2026-10-17. Only short paraphrases are stored; no caption transcript is copied.
// These fixed anchors replace model-estimated timestamps. Their captions-based
// review does not verify every AI-generated teaching statement or slide.
export const LEARNING_SOURCE_REGISTRY_VERSION = 'sumif-caption-anchors-2026-10-17-v1';
const anchors = Object.freeze([
  Object.freeze({ id: 'sumif-purpose', start: 36, end: 76,
    statement: 'SUMIF adds sales for one matching region, illustrated by selecting North as a single condition.' }),
  Object.freeze({ id: 'sumif-arguments', start: 88, end: 125,
    statement: 'The walkthrough selects the region range, enters North as the criterion, then selects the sales values to sum.' }),
  Object.freeze({ id: 'sumif-result-check', start: 125, end: 146,
    statement: 'The North total is checked against the matching sales values to confirm the conditional sum.' }),
  Object.freeze({ id: 'sumif-cell-reference', start: 146, end: 186,
    statement: 'A cell reference can replace the typed criterion and produce the same total; directly entered text needs quotation marks.' }),
]);
export const REVIEWED_SUMIF_SOURCE = Object.freeze({
  videoId: 'dI8w0utjUc0', videoTitle: 'How to use SUMIF and SUMIFS in Microsoft Excel',
  videoUrl: 'https://www.youtube.com/watch?v=dI8w0utjUc0', start: 35, end: 186, anchors,
});

export function reviewedLearningSource(requested) {
  if (requested.videoId !== REVIEWED_SUMIF_SOURCE.videoId) return null;
  // Never widen a user's selected clip. A broader selected range is narrowed
  // to this reviewed excerpt, and that effective range is returned to the UI.
  const start = Math.max(requested.start, REVIEWED_SUMIF_SOURCE.start);
  const end = Math.min(requested.end, REVIEWED_SUMIF_SOURCE.end);
  const eligible = anchors.filter((anchor) => anchor.start >= start && anchor.end <= end);
  if (end <= start || eligible.length < 2) return null;
  return { source: { ...requested, title: REVIEWED_SUMIF_SOURCE.videoTitle, start, end,
    ...(start !== requested.start || end !== requested.end ? { requestedClip: { start: requested.start, end: requested.end } } : {}) },
    anchors: eligible,
    verification: { status: 'reviewed_source_anchors_ai_lesson_unverified', registryVersion: LEARNING_SOURCE_REGISTRY_VERSION,
      method: 'server-mapped-caption-anchor-ids', reviewedExcerpt: { start: REVIEWED_SUMIF_SOURCE.start, end: REVIEWED_SUMIF_SOURCE.end },
      limitation: 'Fixed source anchors were checked against exported English captions for this one excerpt. AI explanations and personalized examples are not verbatim or fully human-verified.' },
  };
}
