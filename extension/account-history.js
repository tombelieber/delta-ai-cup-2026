import {admitImportBatch,importAdmissionMessage} from './import-admission.js';
import { validVideoId } from './store.js';
import { ACCOUNT_HISTORY_IMPORT_SCOPES, DEFAULT_ACCOUNT_HISTORY_RANGE, historyImportLimit } from './account-history-scope.js';

export const ACCOUNT_HISTORY_KEY = 'delta.youtube-history.v1';
export const ACCOUNT_HISTORY_SESSION_KEY = 'delta.youtube-history.session.v1';
const HISTORY_URL = 'https://www.youtube.com/feed/history';
const RANGES = new Set(ACCOUNT_HISTORY_IMPORT_SCOPES.map(scope => scope.id));
const PHASES = new Set(['opening', 'confirm', 'running', 'paused', 'complete', 'finished', 'error']);
const FINISH_REASONS = new Set(['stalled', 'range', 'end', 'timeout', 'navigation', 'account', 'unsupported', 'paused', 'limit', 'visible', 'budget']);
const MAX_DATE = 8.64e15;
const STALE_MS = 45_000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
const validTime = (value, now) => Number.isFinite(value) && value > 0 && value <= now && value <= MAX_DATE;
class AccountHistoryError extends Error {}
const fail = message => { throw new AccountHistoryError(message); };
const empty = () => ({ schemaVersion: 1, activeAccountKey: null, accounts: {} });
const canonicalUrl = videoId => `https://www.youtube.com/watch?v=${videoId}`;
const localDate = time => {
  const date = new Date(time);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
function account(value) {
  if (!object(value) || typeof value.key !== 'string' || !/^channel:@[\p{L}\p{N}\p{M}._-]{1,100}$/u.test(value.key)) return null;
  const label = text(value.label, 200);
  return label ? { key: value.key, label } : null;
}
function videoFromUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)
      || url.username || url.password || url.port) return null;
    const id = url.pathname === '/watch' && url.searchParams.getAll('v').length === 1 ? url.searchParams.get('v')
      : /^\/shorts\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
    return validVideoId(id) ? id : null;
  } catch { return null; }
}
function row(value, now, committed = false) {
  if (!object(value) || !validVideoId(value.videoId) || videoFromUrl(value.url) !== value.videoId || !['video', 'short'].includes(value.kind)) return null;
  const date = day(value.date);
  if (value.date != null && (!date || date > localDate(now))) return null;
  if (value.datePrecision !== (date ? 'day' : 'unknown')) return null;
  if (committed && !validTime(value.importedAt, now)) return null;
  // pageObservedAt is when Delta read the rendered order, never a watch time.
  return { videoId: value.videoId, url: canonicalUrl(value.videoId), title: text(value.title, 300) || 'YouTube video',
    date, dateLabel: text(value.dateLabel, 100) || date || 'Date not shown', datePrecision: date ? 'day' : 'unknown',
    kind: value.kind, importedAt: committed ? value.importedAt : now,
    ...(Number.isInteger(value.pageOrder) && value.pageOrder >= 0 && value.pageOrder < 100
      && (!committed || validTime(value.pageObservedAt, now))
      ? { pageOrder: value.pageOrder, pageObservedAt: committed ? value.pageObservedAt : now } : {}) };
}
const rowKey = value => `${value.videoId}|${value.date || 'unknown'}`;
function mergeRows(before, incoming) {
  const entries = new Map(before.map(value => [rowKey(value), value]));
  for (const value of incoming) {
    const previous = entries.get(rowKey(value));
    entries.set(rowKey(value), previous ? {
      ...(previous.pageOrder != null && value.pageOrder == null ? { pageOrder: previous.pageOrder, pageObservedAt: previous.pageObservedAt } : {}),
      ...value, importedAt: Math.min(previous.importedAt, value.importedAt),
    } : value);
  }
  return [...entries.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.videoId.localeCompare(b.videoId));
}

export function normalizeAccountHistory(value, now = Date.now()) {
  if (!Number.isFinite(now) || now <= 0 || now > MAX_DATE) fail('The current date is unavailable. Saved history has not been changed.');
  const result = empty();
  if (!object(value) || value.schemaVersion !== 1 || !object(value.accounts)) return result;
  for (const [key, saved] of Object.entries(value.accounts)) {
    const identity = account(saved?.account);
    if (!identity || identity.key !== key) continue;
    const entries = [];
    for (const candidate of Array.isArray(saved.entries) ? saved.entries : []) {
      const entry = row(candidate, now, true);
      if (entry) entries.push(entry);
    }
    result.accounts[key] = { account: identity, entries: mergeRows([], entries), updatedAt: validTime(saved.updatedAt, now) ? saved.updatedAt : 0 };
  }
  result.activeAccountKey = typeof value.activeAccountKey === 'string' && Object.hasOwn(result.accounts, value.activeAccountKey) ? value.activeAccountKey : null;
  return result;
}

function historyUrl(value) {
  return value === HISTORY_URL;
}
function nativeSender(api, panelSender, sender) {
  if (!sender || sender.id !== api.runtime.id || !panelSender(sender)) return false;
  try {
    const url = new URL(sender.url), root = new URL(api.runtime.getURL(''));
    return url.protocol === 'chrome-extension:' && url.host === root.host && !url.username && !url.password && !url.port;
  } catch { return false; }
}
function contentSender(api, sender) {
  return sender?.id === api.runtime.id && sender.frameId === 0 && Number.isInteger(sender.tab?.id) && sender.tab.id >= 0 && historyUrl(sender.url);
}
function dateRange(range, now) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === 'week') start.setDate(start.getDate() - 6);
  if (range === 'month') start.setDate(start.getDate() - 29);
  if (range === 'year') start.setDate(start.getDate() - 364);
  return { startDate: (range === 'all' || historyImportLimit(range)) ? null : localDate(start.getTime()), endDate: localDate(now) };
}
function normalizeSession(value) {
  if (!object(value) || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id) || !RANGES.has(value.range) || !PHASES.has(value.phase)
    || value.tabId !== null && (!Number.isInteger(value.tabId) || value.tabId < 0)) return null;
  return { id: value.id, tabId: value.tabId, phase: value.phase, range: value.range, account: account(value.account),
    startDate: day(value.startDate), endDate: day(value.endDate), message: text(value.message, 350),
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : 0, updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
    lastProgressAt: Number.isFinite(value.lastProgressAt) ? value.lastProgressAt : 0,
    savedEntries: Number.isSafeInteger(value.savedEntries) && value.savedEntries >= 0 ? value.savedEntries : 0,
    skippedUnknown: Number.isSafeInteger(value.skippedUnknown) && value.skippedUnknown >= 0 ? value.skippedUnknown : 0,
    skippedOutOfRange: Number.isSafeInteger(value.skippedOutOfRange) && value.skippedOutOfRange >= 0 ? value.skippedOutOfRange : 0,
    progress: { oldestDate: day(value.progress?.oldestDate), dateLabel: text(value.progress?.dateLabel, 100) },
    ...(historyImportLimit(value.range) ? { selectedVideoIds: [...new Set((Array.isArray(value.selectedVideoIds) ? value.selectedVideoIds : []).filter(validVideoId))].slice(0, historyImportLimit(value.range)) } : {}),
    ...(FINISH_REASONS.has(value.reason) ? { reason: value.reason } : {}),
    rangeComplete: value.rangeComplete === true && value.reason === 'range' && value.range !== 'all',
    availablePageEnd: value.availablePageEnd === true && value.reason === 'end' };
}

export function createAccountHistoryHandler({ api, panelSender, now = Date.now, admitImports }) {
  let writes = Promise.resolve(), admission = null;
  const run = operation => { const result = writes.then(operation, operation); writes = result.catch(() => {}); return result; };
  const time = () => {
    const value = now();
    if (!Number.isFinite(value) || value <= 0 || value > MAX_DATE) fail('The current date is unavailable. Saved history has not been changed.');
    return value;
  };
  const readSession = async () => normalizeSession((await api.storage.session.get(ACCOUNT_HISTORY_SESSION_KEY))[ACCOUNT_HISTORY_SESSION_KEY]);
  const saveSession = async value => { await api.storage.session.set({ [ACCOUNT_HISTORY_SESSION_KEY]: value }); return value; };
  const readStore = async () => normalizeAccountHistory((await api.storage.local.get(ACCOUNT_HISTORY_KEY))[ACCOUNT_HISTORY_KEY], time());
  async function sendTab(tabId, message) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new AccountHistoryError('The YouTube history page did not respond. Import is paused.')), 8000); timer.unref?.(); });
    try { return await Promise.race([api.tabs.sendMessage(tabId, message, { frameId: 0 }), timeout]); }
    finally { clearTimeout(timer); }
  }
  async function stop(session) {
    if (!Number.isInteger(session?.tabId)) return;
    try { await sendTab(session.tabId, { type: 'DELTA_ACCOUNT_HISTORY_STOP', jobId: session.id }); } catch { /* Existing committed batches remain available. */ }
  }
  async function pause(session, message, reason = 'paused', phase = 'paused') {
    const next = { ...session, phase, reason, rangeComplete: false, availablePageEnd: false, message, updatedAt: time() };
    try { await saveSession(next); } finally { await stop(session); }
    return next;
  }
  async function inspectTab(session) {
    if (!Number.isInteger(session?.tabId)) fail('Open the YouTube history page again before continuing.');
    if (typeof api.tabs.get !== 'function') return;
    let tab;
    try { tab = await api.tabs.get(session.tabId); }
    catch { fail('The import tab was closed. Saved history is kept. Open the history page again.'); }
    if (tab?.url && !historyUrl(tab.url) && !(session.phase === 'opening' && tab.status === 'loading')) {
      fail('The import tab left YouTube history. Saved history is kept. Return to the history page before continuing.');
    }
  }
  async function probe(session) {
    await inspectTab(session);
    const result = await sendTab(session.tabId, { type: 'DELTA_ACCOUNT_HISTORY_PROBE' });
    const identity = account(result?.account);
    if (result?.ok !== true || result.ready !== true || !identity) fail('Confirm that you are signed in and the YouTube history page has finished loading, then try again.');
    return identity;
  }
  async function snapshot(session) {
    const store = await readStore();
    const identity = session?.account || store.accounts[store.activeAccountKey]?.account || null;
    const saved = identity ? store.accounts[identity.key] : null;
    return { ok: true, session, account: identity, entryCount: saved?.entries.length || 0,
      videoCount: new Set((saved?.entries || []).map(entry => entry.videoId)).size, accountCount: Object.keys(store.accounts).length };
  }
  function assertJob(message, session) {
    if (!session || message.jobId !== session.id) fail('This history import has changed. Refresh Delta before continuing.');
  }
  const nativeTypes = new Set(['ACCOUNT_HISTORY_STATUS', 'ACCOUNT_HISTORY_OPEN', 'ACCOUNT_HISTORY_CONFIRM', 'ACCOUNT_HISTORY_PAUSE', 'ACCOUNT_HISTORY_CONTINUE', 'ACCOUNT_HISTORY_CLEAR']);
  const contentTypes = new Set(['ACCOUNT_HISTORY_BATCH', 'ACCOUNT_HISTORY_FINISH']);

  const handle = async (message, sender) => {
    const native = nativeTypes.has(message?.type);
    if (native ? !nativeSender(api, panelSender, sender) : !contentTypes.has(message?.type) || !contentSender(api, sender)) {
      fail('This YouTube history action is not available from this page.');
    }
    if(native&&admission&&(message.type==='ACCOUNT_HISTORY_OPEN'||message.type==='ACCOUNT_HISTORY_PAUSE'&&message.jobId===admission.jobId||message.type==='ACCOUNT_HISTORY_CLEAR'&&message.accountKey===admission.accountKey))admission.controller.abort();
    return run(async () => {
      let session = null;
      let ownedRunningRequest = false;
      let ownedNativeRequest = false;
      try {
        session = await readSession();
        if (message.type === 'ACCOUNT_HISTORY_STATUS') {
          if (session?.phase === 'opening') {
            try {
              const identity = await probe(session);
              session = await saveSession({ ...session, account: identity, phase: 'confirm', message: 'Confirm the visible YouTube account before importing.', updatedAt: time() });
            } catch {
              if (time() - session.createdAt > STALE_MS) session = await pause(session, 'The history page is not ready. Sign in or reload it, then continue.', 'timeout');
            }
          } else if (session?.phase === 'running') {
            try { await inspectTab(session); }
            catch (error) { session = await pause(session, error.message, 'navigation'); }
            if (session.phase === 'running' && time() - (session.lastProgressAt || session.updatedAt) > STALE_MS) {
              session = await pause(session, 'No recent collection progress was received. Saved history is kept; continue when ready.', 'timeout');
            }
          }
          return await snapshot(session);
        }
        if (message.type === 'ACCOUNT_HISTORY_OPEN') {
          const range = message.range ?? DEFAULT_ACCOUNT_HISTORY_RANGE;
          if (!RANGES.has(range)) fail('Choose latest videos (maximum 100), latest ten, all history, this week, this month or this year.');
          ownedNativeRequest = true;
          if (session && ['opening', 'confirm', 'running'].includes(session.phase)) await pause(session, 'A new import was opened. Saved history is kept.');
          const createdAt = time();
          session = await saveSession({ id: crypto.randomUUID(), tabId: null, phase: 'opening', range, account: null,
            ...dateRange(range, createdAt), createdAt, updatedAt: createdAt, lastProgressAt: 0, savedEntries: 0,
            skippedUnknown: 0, skippedOutOfRange: 0, progress: { oldestDate: null, dateLabel: '' },
            ...(historyImportLimit(range) ? { selectedVideoIds: [] } : {}),
            rangeComplete: false, availablePageEnd: false, message: 'Opening YouTube history. Confirm the visible account before importing.' });
          const tab = await api.tabs.create({ url: HISTORY_URL, active: true });
          if (!Number.isInteger(tab?.id)) fail('The YouTube history tab could not be opened. Please try again.');
          session = await saveSession({ ...session, tabId: tab.id });
          return await snapshot(session);
        }
        if (message.type === 'ACCOUNT_HISTORY_PAUSE') {
          if (message.jobId != null) assertJob(message, session);
          ownedNativeRequest = true;
          if (session) session = await pause(session, 'Import paused. Earlier saved batches are kept.');
          return await snapshot(session);
        }
        if (message.type === 'ACCOUNT_HISTORY_CLEAR') {
          const store = await readStore();
          if (typeof message.accountKey !== 'string' || message.accountKey !== store.activeAccountKey || !Object.hasOwn(store.accounts, message.accountKey)) {
            fail('Choose the currently active imported account before removing its saved history.');
          }
          ownedNativeRequest = true;
          if (session) {
            session = await pause(session, 'Imported history is being removed. Collection is stopped.');
            session = await saveSession({ ...session, id: crypto.randomUUID(), account: null, message: 'Imported history removed from Delta. Nothing was deleted from YouTube.', updatedAt: time() });
          }
          delete store.accounts[message.accountKey];
          store.activeAccountKey = null;
          await api.storage.local.set({ [ACCOUNT_HISTORY_KEY]: store });
          return await snapshot(session);
        }
        if (message.type === 'ACCOUNT_HISTORY_CONTINUE' || message.type === 'ACCOUNT_HISTORY_CONFIRM') {
          if (message.type === 'ACCOUNT_HISTORY_CONTINUE' && message.jobId == null) {
            if (!session) fail('Open the YouTube history page before continuing.');
          } else assertJob(message, session);
          ownedNativeRequest = true;
          if (message.type === 'ACCOUNT_HISTORY_CONTINUE') session = await pause(session, 'Collection stopped while the visible account is confirmed again.');
          if (message.type === 'ACCOUNT_HISTORY_CONFIRM' && (session.phase !== 'confirm' || message.accountKey !== session.account?.key)) {
            fail('Confirm the currently shown YouTube account before starting this import.');
          }
          const identity = await probe(session);
          if (session.account && identity.key !== session.account.key) {
            session = await pause(session, 'The visible YouTube account changed. Open a new import for that account; existing accounts remain separate.', 'account');
            fail('The YouTube account changed. No history was mixed between accounts.');
          }
          if (message.type === 'ACCOUNT_HISTORY_CONTINUE') {
            session = await saveSession({ ...session, id: crypto.randomUUID(), account: identity, phase: 'confirm', message: 'Confirm the visible YouTube account again before resuming.', updatedAt: time(), rangeComplete: false, availablePageEnd: false });
            return await snapshot(session);
          }
          const store = await readStore();
          store.activeAccountKey = identity.key;
          store.accounts[identity.key] ||= { account: identity, entries: [], updatedAt: time() };
          store.accounts[identity.key].account = identity;
          await api.storage.local.set({ [ACCOUNT_HISTORY_KEY]: store });
          session = await saveSession({ ...session, account: identity, phase: 'running', message: 'Reading entries shown on your YouTube history page.',
            updatedAt: time(), lastProgressAt: time(), rangeComplete: false, availablePageEnd: false });
          const response = await sendTab(session.tabId, { type: 'DELTA_ACCOUNT_HISTORY_START', jobId: session.id, account: identity,
            range: session.range, startDate: session.startDate, endDate: session.endDate });
          if (response?.ok !== true) fail('The YouTube history collector could not start. Earlier saved batches are kept.');
          return await snapshot(session);
        }

        assertJob(message, session);
        if (sender.tab.id !== session.tabId || session.phase !== 'running') fail('This history import is paused or belongs to another tab.');
        ownedRunningRequest = true;
        if (message.accountKey !== session.account?.key) fail('The YouTube account changed. Import stopped before saving another batch.');
        if (message.type === 'ACCOUNT_HISTORY_FINISH') {
          const limit = historyImportLimit(session.range), selectedCount = session.selectedVideoIds?.length || 0;
          if (!FINISH_REASONS.has(message.reason) || message.reason === 'range' && (session.range === 'all' || limit)
            || message.reason === 'limit' && (!limit || selectedCount !== limit)
            || message.reason === 'visible' && (session.range !== 'latest10' || selectedCount >= 10)
            || message.reason === 'budget' && (session.range !== 'latest100' || selectedCount >= 100)) fail('The history collector returned an unverified completion state.');
          const messages = {
            limit: `Selected the first ${limit} distinct videos shown on YouTube history${session.range === 'latest10' ? ' without scrolling' : ''}. Earlier saved records are kept.`,
            budget: `Stopped after the bounded scrolling budget with ${selectedCount} of at most 100 videos selected. This is a partial import; earlier saved records are kept.`,
            visible: `Selected ${session.selectedVideoIds?.length || 0} visible videos without scrolling. Fewer than 10 were available; earlier saved records are kept.`,
            range: 'Reached the selected date window. Entries without verified dates were excluded.',
            end: 'Reached the end currently shown on YouTube. This does not prove complete lifetime account history.',
            stalled: 'No additional entries loaded. Earlier batches are saved; continue to try loading more.',
            timeout: limit ? `Stopped at the time limit with ${selectedCount} of at most ${limit} videos selected. This is a partial import; earlier saved records are kept.` : 'The history page stopped responding. Earlier batches are saved; continue when ready.',
            navigation: 'The history page changed. Import stopped and earlier batches are saved.',
            account: 'The visible account changed. Import stopped without mixing accounts.',
            unsupported: 'This history layout could not be read safely. Earlier batches are saved.',
            paused: 'Import paused. Earlier saved batches are kept.',
          };
          session = await saveSession({ ...session, phase: ['range', 'end', 'limit', 'visible'].includes(message.reason) ? 'complete' : 'paused',
            reason: message.reason, message: messages[message.reason], updatedAt: time(), rangeComplete: message.reason === 'range', availablePageEnd: message.reason === 'end' });
          await stop(session);
          return { ok: true };
        }
        if (!Array.isArray(message.rows) || message.rows.length > 500) fail('A history batch must contain no more than 500 visible entries.');
        const limit = historyImportLimit(session.range), bounded = Boolean(limit);
        const selected = new Set(session.selectedVideoIds || []);
        if (bounded) {
          if (message.rows.length > limit || new Set(message.rows.map(value => value?.videoId)).size !== message.rows.length
            || message.rows.some(value => !Number.isInteger(value?.pageOrder) || value.pageOrder < 0 || value.pageOrder >= limit)
            || new Set(message.rows.map(value => value.pageOrder)).size !== message.rows.length) fail(`Latest ${limit} import accepts at most ${limit} distinct visible videos in page order.`);
          for (const value of message.rows) {
            const previousIndex = [...selected].indexOf(value.videoId);
            const expected = previousIndex < 0 ? selected.size : previousIndex;
            if (value.pageOrder !== expected) fail(`Latest ${limit} import must preserve the selected visible page order.`);
            selected.add(value.videoId);
          }
          if (selected.size > limit) fail(`Latest ${limit} import cannot add more than ${limit} distinct videos.`);
        }
        const currentTime = time(), candidates = [];
        let skippedUnknown = 0, skippedOutOfRange = 0;
        for (const candidate of message.rows) {
          const entry = row(candidate, currentTime);
          if (!entry) fail('A history entry could not be verified. Import paused before saving this batch.');
          if (session.range !== 'all' && !bounded && !entry.date) { skippedUnknown++; continue; }
          if (session.range !== 'all' && !bounded && (entry.date < session.startDate || entry.date > session.endDate)) { skippedOutOfRange++; continue; }
          candidates.push(entry);
        }
        if(candidates.length){
          const controller=new AbortController();admission={controller,tabId:session.tabId,jobId:session.id,accountKey:session.account.key};
          try{await admitImportBatch(admitImports,session.id,candidates.map(value=>value.videoId),controller.signal);}
          catch(error){fail(importAdmissionMessage(error));}
          const current=await readSession(),identity=await probe(session);
          if(current?.id!==session.id||current.phase!=='running'||identity.key!==session.account.key)fail('The visible account changed. Import stopped without mixing accounts.');
        }
        const store = await readStore();
        const saved = store.accounts[session.account.key] || { account: session.account, entries: [], updatedAt: 0 };
        const entries = candidates.length ? mergeRows(saved.entries, candidates) : saved.entries;
        if(admission?.controller.signal.aborted)fail('Import stopped. Your saved records are kept.');
        if (candidates.length && JSON.stringify(entries) !== JSON.stringify(saved.entries)) {
          store.activeAccountKey = session.account.key;
          store.accounts[session.account.key] = { account: session.account, entries, updatedAt: currentTime };
          await api.storage.local.set({ [ACCOUNT_HISTORY_KEY]: store });
        }
        const added = entries.length - saved.entries.length;
        session = await saveSession({ ...session, updatedAt: currentTime, lastProgressAt: currentTime, savedEntries: session.savedEntries + added,
          skippedUnknown: session.skippedUnknown + skippedUnknown, skippedOutOfRange: session.skippedOutOfRange + skippedOutOfRange,
          ...(bounded ? { selectedVideoIds: [...selected] } : {}),
          progress: { oldestDate: day(message.progress?.oldestDate), dateLabel: text(message.progress?.dateLabel, 100) } });
        return { ok: true, added, entryCount: entries.length };
      } catch (error) {
        // An obsolete/foreign sender cannot pause a new job. A failure in the
        // active collector or a native action must stop collection safely.
        if (session && (ownedRunningRequest || ownedNativeRequest)) {
          try { await pause(session, error instanceof AccountHistoryError ? error.message : 'Import paused because this batch could not be saved. Earlier saved history is kept.'); } catch { /* Stop is still attempted when session storage fails. */ }
        }
        if (error instanceof AccountHistoryError) throw error;
        throw new AccountHistoryError('YouTube history import could not be completed. Earlier saved history is kept. Please try again.');
      }finally{admission=null;}
    });
  };
  handle.handleTabRemoved = tabId => {if(admission?.tabId===tabId)admission.controller.abort();return run(async () => {
    const session = await readSession();
    if (session?.tabId === tabId && ['opening', 'confirm', 'running'].includes(session.phase)) await pause(session, 'The import tab was closed. Earlier saved history is kept.', 'navigation');
  });};
  handle.handleTabUpdated = (tabId, url) => {if(admission?.tabId===tabId&&!historyUrl(url))admission.controller.abort();return run(async () => {
    const session = await readSession();
    if (session?.tabId === tabId && typeof url === 'string' && !historyUrl(url) && ['confirm', 'running'].includes(session.phase)) {
      await pause(session, 'The import tab left YouTube history. Earlier saved history is kept.', 'navigation');
    }
  });};
  return handle;
}
