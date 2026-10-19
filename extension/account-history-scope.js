// Explicit consent scopes shared by the native UI, service worker and reader.
// The default is bounded; a full-history scan always requires choosing it.
export const DEFAULT_ACCOUNT_HISTORY_RANGE = 'latest10';
export const ACCOUNT_HISTORY_IMPORT_SCOPES = Object.freeze([
  { id: 'latest100', label: 'Latest videos · maximum 100' },
  { id: 'latest10', label: 'Latest 10 videos · no scrolling' },
  { id: 'all', label: 'All available history' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'Last 30 days' },
  { id: 'year', label: 'Last year' },
]);
export const BOUNDED_HISTORY_SCOPES = Object.freeze({
  latest10: Object.freeze({ limit: 10, batchSize: 10, maxScrollRounds: 0, timeBudgetMs: 10_000 }),
  latest100: Object.freeze({ limit: 100, batchSize: 25, maxScrollRounds: 12, timeBudgetMs: 15_000 }),
});
export const historyImportLimit = range => BOUNDED_HISTORY_SCOPES[range]?.limit || null;
