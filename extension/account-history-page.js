// Opt-in reader of the ordinary, rendered YouTube history page. No page-private
// JavaScript state, credentials, network client, or storage API is used here.
import { ACCOUNT_HISTORY_IMPORT_SCOPES, BOUNDED_HISTORY_SCOPES } from './account-history-scope.js';

const DAY = 86_400_000;
const SLICE_MS = 180_000;
const INACTIVITY_MS = 45_000;
const BATCH_SIZE = 500;
const CARD_SELECTOR = 'yt-lockup-view-model, ytm-shorts-lockup-view-model, ytd-video-renderer';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const clean = (value, limit = 300) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const dayString = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Resolve only recognized day headings, using the page's local calendar. */
export function parseHistoryDate(label, now = Date.now()) {
  const dateLabel = clean(label, 100), current = new Date(now);
  const unknown = { dateLabel, date: null, datePrecision: 'unknown' };
  if (!Number.isFinite(current.getTime())) return unknown;
  const today = new Date(current.getFullYear(), current.getMonth(), current.getDate());
  const text = dateLabel.toLocaleLowerCase('en').replace(/[,，]/g, ' ').replace(/\s+/g, ' ').trim();
  let relative = /^(today|今天|今日)$/.test(text) ? 0 : /^(yesterday|昨天|昨日)$/.test(text) ? 1 : /^(前天|前日)$/.test(text) ? 2 : null;
  if (relative == null) {
    const weekday = WEEKDAYS.findIndex(value => text === value || text === value.slice(0, 3));
    const chinese = /^(?:星期|週|周)([日天一二三四五六])$/.exec(text);
    const target = weekday >= 0 ? weekday : chinese ? '日一二三四五六'.indexOf(chinese[1] === '天' ? '日' : chinese[1]) : -1;
    // A same-named weekday is the preceding week: today's heading is Today.
    if (target >= 0) relative = (today.getDay() - target + 7) % 7 || 7;
  }
  if (relative != null) {
    const date = new Date(today); date.setDate(date.getDate() - relative);
    return { dateLabel, date: dayString(date), datePrecision: 'day' };
  }
  let year, month, day;
  let match = /^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日?$/.exec(text);
  if (match) { year = match[1] ? Number(match[1]) : null; month = Number(match[2]); day = Number(match[3]); }
  else {
    const english = text.replace(/^(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+/, '');
    match = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(english);
    if (match) {
      const index = MONTHS.findIndex(value => value === match[1] || value.slice(0, 3) === match[1] || match[1] === 'sept' && value === 'september');
      month = index + 1; day = Number(match[2]); year = match[3] ? Number(match[3]) : null;
    } else {
      match = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?(?: (\d{4}))?$/.exec(english);
      if (match) {
        month = MONTHS.findIndex(value => value === match[2] || value.slice(0, 3) === match[2] || match[2] === 'sept' && value === 'september') + 1;
        day = Number(match[1]); year = match[3] ? Number(match[3]) : null;
      }
    }
  }
  if (!month || !day || month > 12 || day > 31) return unknown;
  let candidate = new Date(year ?? today.getFullYear(), month - 1, day);
  if (year == null && candidate > today) candidate = new Date(today.getFullYear() - 1, month - 1, day);
  if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day || candidate > today || candidate.getFullYear() < 1970) return unknown;
  return { dateLabel, date: dayString(candidate), datePrecision: 'day' };
}

function visible(element) {
  if (!element || element.hidden || element.getAttribute?.('aria-hidden') === 'true' || element.closest?.('[hidden], [aria-hidden="true"]')) return false;
  return typeof element.getClientRects !== 'function' || element.getClientRects().length > 0;
}
const historyRoot = document => document.querySelector('ytd-browse[page-subtype="history"]');
function sections(document) {
  const root = historyRoot(document);
  if (!root) return [];
  return [...root.querySelectorAll('ytd-item-section-renderer')].filter(section => {
    const owner = section.closest?.('ytd-browse');
    return (!owner || owner === root) && visible(section) && section.querySelector(':scope > #header > ytd-item-section-header-renderer h2#title');
  });
}
function* cards(document, now) {
  for (const section of sections(document)) {
    const label = section.querySelector(':scope > #header > ytd-item-section-header-renderer h2#title')?.textContent;
    const date = parseHistoryDate(label, now);
    const contents = section.querySelector(':scope > #contents');
    if (!contents) continue;
    for (const element of contents.querySelectorAll(CARD_SELECTOR)) {
      if (visible(element)) yield { element, ...date };
    }
  }
}
function rowFor(card) {
  const { element, dateLabel, date, datePrecision } = card;
  const heading = element.querySelector('h3[title], h3');
  const link = heading?.querySelector('a[href]') || element.querySelector('a#video-title[href]');
  if (!link) return null;
  let url;
  try { url = new URL(link.getAttribute('href'), 'https://www.youtube.com'); } catch { return null; }
  if (url.origin !== 'https://www.youtube.com') return null;
  const short = /^\/shorts\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname);
  const videoId = short?.[1] || (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1 ? url.searchParams.get('v') : null);
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) return null;
  const title = clean(heading?.getAttribute('title') || link.getAttribute('title') || link.textContent);
  if (!title) return null;
  return { videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title, dateLabel, date, datePrecision, kind: short ? 'short' : 'video' };
}
const rowKey = row => `${row.videoId}\u0000${row.date || row.dateLabel}`;

/** Read only history-owned rendered card elements, without scrolling or messages. */
export function readHistoryRows(document, now = Date.now()) {
  const seen = new Set(), result = [];
  for (const card of cards(document, now)) {
    const row = rowFor(card);
    if (row && !seen.has(rowKey(row))) { seen.add(rowKey(row)); result.push(row); }
  }
  return result;
}

function routeIsHistory(window) {
  try { const url = new URL(window.location.href); return url.origin === 'https://www.youtube.com' && url.pathname === '/feed/history' && !url.search && !url.hash; }
  catch { return false; }
}
function filtersAreAll(document) {
  const root = historyRoot(document);
  if (!root) return false;
  const selected = [...root.querySelectorAll('[role="tab"][aria-selected="true"]')].filter(visible);
  const searches = [...document.querySelectorAll('input[name="query"]')].filter(input => !input.closest?.('ytd-masthead') && visible(input));
  return selected.length === 1 && /^(all|全部)$/i.test(clean(selected[0].getAttribute('aria-label') || selected[0].textContent))
    && searches.length === 1 && !clean(searches[0].value);
}
function handleFrom(value) {
  const handle = clean(value, 101);
  return /^@[\p{L}\p{M}\p{N}_.·-]{1,100}$/u.test(handle) ? handle : null;
}
const accountKey = handle => `channel:${handle.toLocaleLowerCase('en')}`;
function guideAccount(document) {
  const handles = new Set();
  for (const link of document.querySelectorAll('ytd-guide-renderer a[href]')) {
    if (!visible(link)) continue;
    if (!/^(?:your channel|你的頻道|您的頻道|你的频道|您的频道)$/i.test(clean(link.getAttribute('title')))) continue;
    let url;
    try { url = new URL(link.getAttribute('href'), 'https://www.youtube.com'); } catch { continue; }
    if (url.origin !== 'https://www.youtube.com' || url.search || url.hash) continue;
    let handle;
    try { handle = handleFrom(decodeURIComponent(url.pathname.slice(1))); } catch { continue; }
    if (handle) handles.add(accountKey(handle));
  }
  // Subscriptions also use /@handle. Only the explicitly named own-channel
  // guide link can guard identity; an ambiguous own-channel link is refused.
  return handles.size === 1 ? [...handles][0] : null;
}
function menuHeader(document) {
  return [...document.querySelectorAll('ytd-active-account-header-renderer')].find(visible) || null;
}
function nextShortsButton(document, now, startDate, blocked) {
  for (const section of sections(document)) {
    const date = parseHistoryDate(section.querySelector(':scope > #header > ytd-item-section-header-renderer h2#title')?.textContent, now).date;
    if (date && startDate && date < startDate) continue;
    for (const button of section.querySelectorAll('button[aria-label="下一批"], button[aria-label="Next batch"]')) {
      const shelf = button.closest('yt-horizontal-list-renderer, ytd-horizontal-list-renderer, ytd-reel-shelf-renderer, ytd-rich-shelf-renderer');
      if (shelf && !blocked.has(shelf) && shelf.querySelector('ytm-shorts-lockup-view-model') && visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true') return { button, shelf };
    }
  }
  return null;
}
function shelfSignature(shelf) {
  return `${shelf.scrollLeft || 0}:${[...shelf.querySelectorAll('h3 a[href]')].map(link => link.getAttribute('href')).join('\n')}`;
}
function explicitEnd(document) {
  const root = historyRoot(document);
  if (!root) return false;
  return [...root.querySelectorAll('ytd-message-renderer, yt-formatted-string#message')].some(element => visible(element)
    && /^(?:no more videos|no more history|you have no watch history|this list has no videos|沒有更多觀看記錄|沒有更多影片|沒有觀看記錄|無觀看記錄|觀看記錄中沒有任何影片)[.!。]?$/i.test(clean(element.textContent)));
}
function validDate(value) {
  if (value == null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isFinite(parsed.getTime()) && dayString(parsed) === value;
}

export function installAccountHistoryPage({ document, window, runtime, now = Date.now }) {
  let stopped = false, running = null, probing = null, confirmedAccount = null;
  const timer = window.setTimeout.bind(window), clearTimer = window.clearTimeout.bind(window);
  function nativeSender(sender) {
    if (sender?.id !== runtime.id || sender.tab || typeof sender.url !== 'string') return false;
    try {
      const url = new URL(sender.url), base = new URL(runtime.getURL(''));
      return url.protocol === 'chrome-extension:' && url.host === base.host && !url.username && !url.password && !url.port;
    } catch { return false; }
  }
  async function delay(ms, signal) {
    if (signal?.aborted || stopped) return;
    await new Promise(resolve => {
      const finish = () => { clearTimer(id); signal?.removeEventListener('abort', finish); resolve(); };
      const id = timer(finish, ms);
      signal?.addEventListener('abort', finish, { once: true });
    });
  }
  async function send(message, signal, timeout = 10_000) {
    let id, onAbort;
    try {
      if (signal?.aborted) throw Error('collection stopped');
      const interrupted = new Promise((_, reject) => {
        onAbort = () => reject(Error('collection stopped'));
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      return await Promise.race([runtime.sendMessage(message), interrupted,
        new Promise((_, reject) => { id = timer(() => reject(Error('message timeout')), timeout); })]);
    } finally { clearTimer(id); signal?.removeEventListener('abort', onAbort); }
  }
  function halt(reason) {
    const previous = running;
    running = null;
    if (previous && !previous.controller.signal.aborted) { previous.reason = reason; previous.controller.abort(); }
    if (probing) probing.abort();
    confirmedAccount = null;
  }
  function guard(job) {
    if (job.controller.signal.aborted || stopped) return job.reason || 'paused';
    if (!routeIsHistory(window)) return 'navigation';
    if (!filtersAreAll(document)) return 'paused';
    if (guideAccount(document) !== job.account.key) return 'account';
    return null;
  }
  async function probe() {
    if (stopped || probing || running) return { ok: false, ready: false, error: 'An account history action is already running.' };
    confirmedAccount = null;
    if (!routeIsHistory(window) || !filtersAreAll(document)) return { ok: false, ready: false, error: 'Open the unfiltered All view of your YouTube watch history.' };
    const avatar = document.querySelector('button#avatar-btn');
    if (!visible(avatar) || menuHeader(document)) return { ok: false, ready: false, error: 'Close the YouTube account menu, then check the account again.' };
    const controller = new AbortController(); probing = controller;
    let opened = false;
    try {
      avatar.click(); opened = true;
      let header = null;
      for (let tries = 0; tries < 12 && !controller.signal.aborted; tries += 1) {
        await delay(150, controller.signal);
        header = menuHeader(document);
        if (header) break;
      }
      if (controller.signal.aborted || stopped || !routeIsHistory(window) || !filtersAreAll(document) || !header) return { ok: false, ready: false, error: 'The account could not be confirmed. Keep the unfiltered history page open and try again.' };
      const handle = handleFrom(header.querySelector('#channel-handle')?.textContent);
      if (!handle || guideAccount(document) !== accountKey(handle)) return { ok: false, ready: false, error: 'The active channel is missing or changed. Recheck the account before importing.' };
      const name = clean(header.querySelector('#account-name')?.textContent, 100);
      // Account email is never retained, even if presented in the name field.
      const safeName = /[^\s@]+@[^\s@]+\.[^\s@]+/.test(name) ? '' : name;
      confirmedAccount = { key: accountKey(handle), label: safeName ? `${safeName} (${handle})` : handle };
      return { ok: true, ready: true, account: { ...confirmedAccount } };
    } catch { return { ok: false, ready: false, error: 'The account could not be confirmed. Try checking it again.' }; }
    finally {
      if (opened && !stopped && routeIsHistory(window) && menuHeader(document)) { try { avatar.click(); } catch { /* Never click any alternative control. */ } }
      if (probing === controller) probing = null;
    }
  }
  async function run(job) {
    const signal = job.controller.signal, seen = new Set(), blockedShelves = new WeakSet();
    const clock = () => window.performance?.now?.() ?? Date.now();
    let sliceStarted = clock(), lastAdvancement = clock(), watchdog;
    const advanced = () => { lastAdvancement = clock(); };
    const watch = () => {
      if (signal.aborted) return;
      const remaining = INACTIVITY_MS - (clock() - lastAdvancement);
      if (remaining <= 0) { job.reason = 'timeout'; job.controller.abort(); }
      else watchdog = timer(watch, remaining);
    };
    watchdog = timer(watch, INACTIVITY_MS);
    let reason = 'stalled', oldestDate = null, dateLabel = '', stalls = 0, incomplete = false;
    try {
      const policy = BOUNDED_HISTORY_SCOPES[job.range];
      if (policy) {
        const videos = new Set(), startedAt = clock();
        let noNewRounds = 0, budgetTimer;
        const remaining = () => policy.timeBudgetMs - (clock() - startedAt);
        const boundedGuard = () => guard(job) || (remaining() <= 0 ? 'timeout' : null);
        const flush = async rows => {
          const invalid = boundedGuard(); if (invalid) { reason = invalid; return false; }
          const response = await send({ type: 'ACCOUNT_HISTORY_BATCH', jobId: job.jobId, accountKey: job.account.key,
            rows, progress: { oldestDate: rows.at(-1).date, dateLabel: rows.at(-1).dateLabel } }, signal, Math.max(1, Math.min(10_000, remaining())));
          const changed = boundedGuard(); if (changed) { reason = changed; return false; }
          if (!response?.ok || response.keepGoing === false) { reason = 'paused'; return false; }
          return true;
        };
        budgetTimer = timer(() => { job.reason = 'timeout'; job.controller.abort(); }, policy.timeBudgetMs);
        try {
          for (let round = 0; round <= policy.maxScrollRounds; round += 1) {
            let rows = [], added = 0, lastCard = null;
            const invalid = boundedGuard(); if (invalid) { reason = invalid; return; }
            for (const card of cards(document, now())) {
              const invalidCard = boundedGuard(); if (invalidCard) { reason = invalidCard; return; }
              lastCard = card.element;
              const row = rowFor(card);
              if (!row) { reason = 'unsupported'; return; }
              if (videos.has(row.videoId)) continue;
              rows.push({ ...row, pageOrder: videos.size }); videos.add(row.videoId); added += 1;
              if (rows.length >= policy.batchSize || videos.size === policy.limit) {
                if (!await flush(rows)) return;
                rows = [];
              }
              if (videos.size === policy.limit) { reason = 'limit'; return; }
            }
            if (rows.length && !await flush(rows)) return;
            if (explicitEnd(document)) { reason = 'end'; return; }
            if (!videos.size) { reason = 'unsupported'; return; }
            if (!policy.maxScrollRounds) { reason = 'visible'; return; }
            if (!historyRoot(document)) { reason = 'unsupported'; return; }
            noNewRounds = added ? 0 : noNewRounds + 1;
            if (noNewRounds >= 2) { reason = 'stalled'; return; }
            if (round === policy.maxScrollRounds) { reason = 'budget'; return; }
            const beforeScroll = boundedGuard(); if (beforeScroll) { reason = beforeScroll; return; }
            lastCard?.scrollIntoView?.({ block: 'end', inline: 'nearest', behavior: 'instant' });
            window.scrollBy?.({ top: Math.max(500, (window.innerHeight || 700) * .8), behavior: 'instant' });
            await delay(Math.min(750, remaining()), signal);
          }
        } finally { clearTimer(budgetTimer); }
        return; // Limited scopes never open Shorts continuation shelves.
      }
      while (true) {
        const invalid = guard(job); if (invalid) { reason = invalid; break; }
        let batch = [], added = 0, inspected = 0, unresolved = false, boundary = false, lastCard = null;
        const pending = new Set();
        const flush = async () => {
          const invalidNow = guard(job); if (invalidNow) { reason = invalidNow; return false; }
          const response = await send({ type: 'ACCOUNT_HISTORY_BATCH', jobId: job.jobId, accountKey: job.account.key,
            rows: batch, progress: { oldestDate, dateLabel } }, signal);
          if (response?.ok) {
            for (const row of batch) seen.add(rowKey(row));
            advanced();
          }
          batch = [];
          pending.clear();
          const invalidAfter = guard(job); if (invalidAfter) { reason = invalidAfter; return false; }
          if (!response?.ok || response.keepGoing === false) { reason = 'paused'; return false; }
          // The user's consent covers the unchanged job, not a timer interval.
          // Checkpoint only after ACK; retain deduplication and blocked shelves.
          if (clock() - sliceStarted >= SLICE_MS) {
            await delay(0, signal);
            sliceStarted = clock();
            const invalidSlice = guard(job); if (invalidSlice) { reason = invalidSlice; return false; }
          }
          return true;
        };
        for (const card of cards(document, now())) {
          const invalidCard = guard(job); if (invalidCard) { reason = invalidCard; return; }
          lastCard = card.element; inspected += 1;
          if (card.date && (!oldestDate || card.date < oldestDate)) { oldestDate = card.date; dateLabel = card.dateLabel; }
          if (card.date && job.startDate && card.date < job.startDate) boundary = true;
          else if (!card.date || !job.endDate || card.date <= job.endDate) {
            let row = rowFor(card);
            if (!row) {
              card.element.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'instant' });
              await delay(250, signal); row = rowFor(card);
            }
            if (!row) unresolved = true;
            else if (!seen.has(rowKey(row)) && !pending.has(rowKey(row))) {
              pending.add(rowKey(row)); batch.push(row); added += 1; advanced();
            }
          }
          if (batch.length >= BATCH_SIZE || inspected % BATCH_SIZE === 0 || clock() - sliceStarted >= SLICE_MS) {
            if (!await flush()) return;
            await delay(0, signal);
            const changed = guard(job); if (changed) { reason = changed; return; }
          }
        }
        if (!await flush()) break;
        const next = nextShortsButton(document, now(), job.startDate, blockedShelves);
        if (next) {
          const before = shelfSignature(next.shelf);
          next.button.click(); await delay(700, signal);
          const changed = guard(job); if (changed) { reason = changed; break; }
          if (before === shelfSignature(next.shelf) && !next.button.disabled && next.button.getAttribute('aria-disabled') !== 'true') {
            blockedShelves.add(next.shelf); incomplete = true;
            // One immovable Shorts shelf must not hide older regular videos.
          } else { advanced(); continue; }
        }
        if (unresolved) incomplete = true;
        if (boundary) { reason = incomplete ? 'stalled' : 'range'; break; }
        if (explicitEnd(document)) { reason = incomplete ? 'stalled' : 'end'; break; }
        if (!historyRoot(document)) { reason = 'unsupported'; break; }
        stalls = added ? 0 : stalls + 1;
        if (stalls >= 4) { reason = 'stalled'; break; }
        lastCard?.scrollIntoView?.({ block: 'end', inline: 'nearest', behavior: 'instant' });
        window.scrollBy?.({ top: Math.max(500, (window.innerHeight || 700) * .8), behavior: 'instant' });
        await delay(750, signal);
      }
    } catch { reason = signal.aborted ? job.reason || 'paused' : 'paused'; }
    finally {
      clearTimer(watchdog);
      if (signal.aborted) reason = job.reason || 'paused';
      try { await send({ type: 'ACCOUNT_HISTORY_FINISH', jobId: job.jobId, accountKey: job.account.key, reason,
        progress: { oldestDate, dateLabel } }, null, 5_000); } catch { /* Prior acknowledged batches remain saved. */ }
      if (running === job) running = null;
    }
  }
  function listener(message, sender, respond) {
    if (!['DELTA_ACCOUNT_HISTORY_PROBE', 'DELTA_ACCOUNT_HISTORY_START', 'DELTA_ACCOUNT_HISTORY_STOP'].includes(message?.type)) return undefined;
    if (!nativeSender(sender)) { respond({ ok: false, error: 'Account history is available only from the Delta native panel.' }); return false; }
    if (message.type === 'DELTA_ACCOUNT_HISTORY_PROBE') {
      void (async () => { respond(await probe()); })(); return true;
    }
    if (message.type === 'DELTA_ACCOUNT_HISTORY_STOP') {
      if (message.jobId && running && message.jobId !== running.jobId) { respond({ ok: false, error: 'That history job is not active.' }); return false; }
      halt('paused'); respond({ ok: true, stopped: true }); return false;
    }
    const account = message.account;
    if (stopped || running || probing || !confirmedAccount || account?.key !== confirmedAccount.key || account?.label !== confirmedAccount.label
      || !routeIsHistory(window) || !filtersAreAll(document) || guideAccount(document) !== confirmedAccount.key
      || typeof message.jobId !== 'string' || !message.jobId || message.jobId.length > 100
      || !ACCOUNT_HISTORY_IMPORT_SCOPES.some(scope => scope.id === message.range) || !validDate(message.startDate) || !validDate(message.endDate)
      || message.startDate && message.endDate && message.startDate > message.endDate) {
      respond({ ok: false, error: 'Confirm the current account and unfiltered history view before starting.' }); return false;
    }
    const today = new Date(now());
    const fallbackStart = new Date(today); fallbackStart.setDate(fallbackStart.getDate() - ({ week: 7, month: 30, year: 365 }[message.range] || 0));
    const job = { jobId: message.jobId, account: { ...confirmedAccount }, controller: new AbortController(), reason: null,
      range: message.range, startDate: message.startDate || ((message.range === 'all' || BOUNDED_HISTORY_SCOPES[message.range]) ? null : dayString(fallbackStart)), endDate: message.endDate || null };
    confirmedAccount = null; running = job;
    respond({ ok: true, started: true }); // Acknowledge before scrolling or collecting.
    void run(job); return false;
  }
  const navigation = () => halt('navigation');
  runtime.onMessage.addListener(listener);
  window.addEventListener('pagehide', navigation);
  document.addEventListener('yt-navigate-start', navigation);
  return { stop() {
    if (stopped) return;
    stopped = true; halt('paused');
    runtime.onMessage.removeListener(listener);
    window.removeEventListener('pagehide', navigation);
    document.removeEventListener('yt-navigate-start', navigation);
  } };
}
