// Opt-in DOM reader. Never reads page-private JavaScript, cookies or network.
const MAX_ROWS = 20000, MAX_TEXT = 18000, MAX_GROUPS = 80;
const CONTROL = 'ytd-video-description-transcript-section-renderer button, button[aria-label="Show transcript"], button[aria-label="顯示轉錄稿"], button[aria-label="显示文字稿"]';
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
const fail = (code, message) => { throw Object.assign(Error(message), { code }); };
const check = (condition, code, message) => { if (!condition) fail(code, message); };
const timestamp = seconds => `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
function secondsOf(value) {
  const match = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(clean(value));
  if (!match || Number(match[3]) >= 60 || match[1] && Number(match[2]) >= 60) return null;
  const result = Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return result <= 86400 ? result : null;
}
function visible(element) {
  if (!element || element.hidden || element.getAttribute?.('aria-hidden') === 'true' || element.closest?.('[hidden], [aria-hidden="true"]')) return false;
  return typeof element.getClientRects !== 'function' || element.getClientRects().length > 0;
}

/** Pure caption serialization; its boundary metadata is excluded by the server parser. */
export function parseTranscriptRows({ videoId, title, rows, start = 0, end, duration }) {
  check(typeof videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(videoId), 'transcript_identity', 'Open the matching YouTube video before capturing its transcript.');
  check(Number.isFinite(duration) && duration >= 1, 'transcript_media_unavailable', 'Wait until the YouTube video has loaded, then try again.');
  end ??= Math.min(Math.floor(duration), start + 300);
  check(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start && end - start <= 300 && end <= duration && end <= 86400,
    'transcript_clip_invalid', 'Choose a loaded video clip of no more than five minutes.');
  check(Array.isArray(rows) && rows.length >= 2 && rows.length <= MAX_ROWS, 'transcript_unavailable', 'Open YouTube’s Show transcript panel with timestamps, then try again.');
  const cues = [];
  for (const row of rows) {
    const time = secondsOf(row?.time), text = clean(row?.text);
    check(time !== null && text, 'transcript_markup', 'YouTube’s transcript timestamps could not be read. Show timestamps and try again.');
    const previous = cues.at(-1);
    check(!previous || time >= previous.start, 'transcript_markup', 'YouTube’s transcript order could not be verified. Reopen Show transcript and try again.');
    if (previous?.start === time) {
      check(previous.text === text, 'transcript_markup', 'Conflicting transcript lines share a timestamp. Reopen Show transcript and try again.');
      continue;
    }
    cues.push({ start: time, text });
  }
  // A cue's next visible start is its boundary. Without a following cue, use
  // only the same two-second conservative tail as the existing source parser.
  const selected = cues.map((cue, index) => ({ ...cue, end: cues[index + 1]?.start ?? Math.min(cue.start + 2, Math.floor(duration)) }))
    .filter(cue => cue.start >= start && cue.end <= end && cue.end > cue.start);
  check(selected.length >= 2, 'transcript_unavailable', 'Not enough complete timestamped captions were available in this clip. Open Show transcript and try again.');
  let textSize = 0;
  const groups = [];
  for (const cue of selected) {
    textSize += cue.text.length;
    check(textSize <= MAX_TEXT, 'transcript_too_large', 'This clip has too much caption text. Choose a shorter clip.');
    const previous = groups.at(-1);
    if (previous && cue.end - previous.start <= 30 && previous.text.length + cue.text.length < 1200) {
      previous.end = cue.end; previous.text += ` ${cue.text}`;
    } else groups.push({ ...cue });
  }
  check(groups.reduce((size, group) => size + group.text.length, 0) <= MAX_TEXT,
    'transcript_too_large', 'This clip has too much caption text. Choose a shorter clip.');
  check(groups.length <= MAX_GROUPS, 'transcript_too_large', 'This clip has too many caption spans. Choose a shorter clip.');
  const safeTitle = clean(title).slice(0, 200) || 'YouTube video';
  // This explicit metadata row supplies the final real cue boundary. Its start
  // equals that boundary, so parseStudySource never includes it in any anchor.
  const boundary = selected.at(-1).end;
  const transcript = [`Video ID: ${videoId}`, `Title: ${safeTitle}`, 'Captions: YouTube transcript visible on this device',
    `URL: https://www.youtube.com/watch?v=${videoId}`, ...selected.map(cue => `[${timestamp(cue.start)}] ${cue.text}`),
    `[${timestamp(boundary)}] Delta excerpt boundary (metadata, not a caption).`].join('\n');
  check(new TextEncoder().encode(transcript).length <= 250000, 'transcript_too_large', 'This caption excerpt is too large. Choose a shorter clip.');
  // Do not claim the metadata marker as a caption when an excerpt ends earlier
  // than requested. Closing the returned range excludes it at the source parser.
  return { videoId, title: safeTitle, url: `https://www.youtube.com/watch?v=${videoId}`, start, end: boundary, transcript };
}

/** Read only the ordinary transcript panel, never similarly named page text. */
export function readTranscriptRows(document) {
  const roots = [...document.querySelectorAll('ytd-transcript-renderer')].filter(visible);
  check(roots.length <= 1, 'transcript_markup', 'More than one transcript is visible. Close the extra panel and try again.');
  if (!roots.length) return [];
  const segments = [...roots[0].querySelectorAll('ytd-transcript-segment-renderer')].filter(visible);
  check(segments.length <= MAX_ROWS, 'transcript_too_large', 'This transcript has too many rows. Choose a shorter video.');
  return segments.map(segment => ({ time: segment.querySelector('.segment-timestamp')?.textContent || '',
    text: segment.querySelector('.segment-text')?.textContent || '' }));
}

export function installYouTubeTranscript({ document: doc, window: win, runtime }) {
  let stopped = false, active = null;
  const extensionHost = new URL(runtime.getURL('')).host;
  function trusted(sender) {
    if (sender?.id !== runtime.id || sender.tab || typeof sender.url !== 'string') return false;
    try { const url = new URL(sender.url); return url.protocol === 'chrome-extension:' && url.host === extensionHost && !url.username && !url.password && !url.port; } catch { return false; }
  }
  function context(videoId) {
    let url; try { url = new URL(win.location.href); } catch { /* Rejected below. */ }
    check(url?.origin === 'https://www.youtube.com' && url.pathname === '/watch' && url.searchParams.getAll('v').length === 1
      && /^[A-Za-z0-9_-]{11}$/.test(videoId || '') && url.searchParams.get('v') === videoId
      && doc.querySelector('ytd-watch-flexy[video-id]')?.getAttribute('video-id') === videoId,
    'transcript_identity', 'The YouTube video changed. Return to that video and choose Learn again.');
    const player = doc.querySelector('#movie_player'), video = player?.querySelector('video.html5-main-video');
    check(video && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration >= 1
      && !['ad-showing', 'ad-interrupting', 'ytp-live', 'ytp-live-dvr'].some(name => player.classList.contains(name)),
    'transcript_media_unavailable', 'Wait for the regular video to load and any advert to finish, then try again.');
    return { duration: video.duration, title: clean(doc.querySelector('ytd-watch-metadata h1')?.textContent || doc.title?.replace(/ - YouTube$/, '')) };
  }
  async function capture(message) {
    check(!stopped && !active, 'transcript_busy', 'A transcript capture is already running. Try again when it finishes.');
    const before = context(message.videoId);
    // Validate the clip before touching a native control, even if rows are absent.
    const start = message.start ?? 0, end = message.end ?? Math.min(Math.floor(before.duration), start + 300);
    check(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start && end - start <= 300 && end <= before.duration && end <= 86400,
      'transcript_clip_invalid', 'Choose a loaded video clip of no more than five minutes.');
    const finishRows = values => {
      context(message.videoId);
      const result = parseTranscriptRows({ ...before, videoId: message.videoId, rows: values, start, end });
      context(message.videoId);
      return result;
    };
    const existing = readTranscriptRows(doc);
    if (existing.length) return finishRows(existing);
    const controls = [...doc.querySelectorAll(CONTROL)].filter(element => visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true'
      && /^(show transcript|顯示轉錄稿|顯示文字稿|顯示逐字稿|顯示字幕記錄|显示文字稿|显示转录稿)$/i.test(clean(element.getAttribute('aria-label') || element.textContent)));
    check(controls.length === 1, 'transcript_unavailable', 'Open the video description and YouTube’s Show transcript panel, then choose Learn again. Some videos have no available captions.');
    check(typeof win.MutationObserver === 'function', 'transcript_unavailable', 'The transcript could not be observed on this page. Reload YouTube and try again.');
    return new Promise((resolve, reject) => {
      let timer, settled = false;
      const complete = (error, result) => {
        if (settled) return; settled = true; observer.disconnect(); win.clearTimeout(timer);
        doc.removeEventListener('yt-navigate-start', navigation); win.removeEventListener('pagehide', navigation);
        active = null; error ? reject(error) : resolve(result);
      };
      const navigation = () => complete(Object.assign(Error('The YouTube video changed. Choose Learn again on the current video.'), { code: 'transcript_navigation' }));
      const inspect = () => {
        try { context(message.videoId); const values = readTranscriptRows(doc); if (values.length >= 2) complete(null, finishRows(values)); }
        catch (error) { complete(error); }
      };
      const observer = new win.MutationObserver(inspect);
      active = { cancel: navigation };
      doc.addEventListener('yt-navigate-start', navigation); win.addEventListener('pagehide', navigation);
      observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'video-id'] });
      timer = win.setTimeout(() => complete(Object.assign(Error('YouTube did not show readable timestamped captions. Open Show transcript with timestamps and try again.'), { code: 'transcript_timeout' })), 10000);
      try { context(message.videoId); controls[0].click(); inspect(); } catch (error) { complete(error); }
    });
  }
  function listener(message, sender, respond) {
    if (message?.type !== 'DELTA_CAPTURE_TRANSCRIPT') return undefined;
    if (!trusted(sender)) { respond({ ok: false, code: 'transcript_sender_denied', error: 'Capture a transcript using the Delta extension.' }); return false; }
    void capture(message).then(result => respond({ ok: true, ...result }), error => respond({ ok: false,
      code: error.code || 'transcript_unavailable', error: error.code ? error.message : 'The transcript could not be read. Reopen YouTube’s Show transcript panel and try again.' }));
    return true;
  }
  runtime.onMessage.addListener(listener);
  return { stop() { if (stopped) return; stopped = true; active?.cancel(); runtime.onMessage.removeListener(listener); } };
}
