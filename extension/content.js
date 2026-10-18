import { createPlaybackTracker } from './tracker.js';
import { youtubeVideoId, mergeIntervals } from './store.js';

// DOM-only adapter: no page globals, account cookies, history API or network.
export function createYouTubeRecorder({ document: doc, window: win, runtime, clock = () => performance.now(), onView = () => {}, onContext = () => {}, onError = () => {} }) {
  let video = null, player = null, contextId = null, enabled = false, recordingEpoch = null, stopped = false;
  let navigating = false, navigationCycle = false, navigationFromId = null, awaitingMetadata = false, sending = false, flushRequested = false, lastSent = -Infinity;
  let lastStatus = '', lastAd = false, live = { videoId: null, title: '', duration: 0, currentTime: 0, status: 'waiting' };
  const pending = new Map(), listeners = [];
  const tracker = createPlaybackTracker({ onRange({ videoId, start, end }) {
    const item = pending.get(videoId) || { videoId, title: live.title, duration: live.duration, ranges: [], epoch: recordingEpoch };
    item.title = live.title; item.duration = live.duration;
    item.ranges = mergeIntervals([...item.ranges, [start, end]], item.duration);
    pending.set(videoId, item);
  } });
  const title = () => (doc.querySelector('ytd-watch-metadata h1')?.textContent || doc.title.replace(/ - YouTube$/, '') || 'YouTube 影片').trim().slice(0, 300);
  const adPlaying = () => Boolean(player?.classList.contains('ad-showing') || player?.classList.contains('ad-interrupting'));
  const validDuration = () => Number.isFinite(video?.duration) && video.duration > 0
    && !player?.classList.contains('ytp-live') && !player?.classList.contains('ytp-live-dvr');
  const listen = (target, type, handler, bucket = listeners) => {
    target.addEventListener(type, handler); bucket.push(() => target.removeEventListener(type, handler));
  };
  let mediaListeners = [];
  function unbind() { for (const remove of mediaListeners) remove(); mediaListeners = []; tracker.reset(); video = null; player = null; }
  function reconcile() {
    const id = youtubeVideoId(win.location.href);
    const nextPlayer = doc.querySelector('#movie_player');
    const nextVideo = id ? nextPlayer?.querySelector('video.html5-main-video') || null : null;
    if (id === contextId && nextVideo === video) return;
    const previousVideo = video;
    unbind();
    contextId = id; player = nextPlayer; video = nextVideo;
    // A reused element must deliver fresh metadata after SPA navigation.
    if (previousVideo && previousVideo === video && !navigationCycle) awaitingMetadata = true;
    else if (video && previousVideo !== video && video.readyState >= 1) awaitingMetadata = false;
    if (!video) return;
    for (const type of ['play', 'playing', 'pause', 'ended', 'timeupdate', 'waiting', 'stalled', 'seeking', 'seeked', 'ratechange', 'loadstart', 'emptied', 'loadedmetadata']) {
      listen(video, type, (event) => {
        if (['seeking', 'ratechange', 'loadstart', 'emptied', 'loadedmetadata'].includes(event.type)) tracker.reset();
        if (['loadstart', 'emptied'].includes(event.type)) awaitingMetadata = true;
        if (event.type === 'loadedmetadata') awaitingMetadata = false;
        tick();
        if (['pause', 'ended', 'seeking', 'waiting', 'emptied'].includes(event.type)) void flush();
      }, mediaListeners);
    }
  }
  function tick() {
    if (stopped) return;
    reconcile();
    const ad = adPlaying();
    if (ad !== lastAd) { tracker.reset(); lastAd = ad; }
    // Watch-page identity prevents recording hover previews on the home page.
    const watchId = doc.querySelector('ytd-watch-flexy[video-id]')?.getAttribute('video-id');
    const identityReady = !watchId || watchId === contextId;
    let status = !video || !contextId ? 'waiting' : ad ? 'ad' : navigating || awaitingMetadata || !identityReady ? 'waiting'
      : !validDuration() ? 'unavailable' : video.seeking ? 'seeking' : video.paused || video.ended ? 'paused' : video.readyState < 3 ? 'buffering' : 'playing';
    live = { videoId: contextId, title: contextId ? title() : '', duration: validDuration() && !ad ? video.duration : 0,
      currentTime: Number.isFinite(video?.currentTime) && !ad ? video.currentTime : 0, status };
    onContext(live);
    if (enabled && video && !navigating && !awaitingMetadata && identityReady && validDuration()) {
      tracker.sample({ videoId: contextId, currentTime: video.currentTime, duration: video.duration, playbackRate: video.playbackRate,
        paused: video.paused, seeking: video.seeking, ended: video.ended, readyState: video.readyState, ad, now: clock() });
    } else tracker.reset();
    const changed = `${contextId}:${status}` !== lastStatus;
    lastStatus = `${contextId}:${status}`;
    if (changed || clock() - lastSent >= 1000) void flush();
  }
  async function send(sample) {
    let response;
    try { response = await runtime.sendMessage({ type: 'RECORDER_SAMPLE', sample: { epoch: recordingEpoch, ...sample } }); }
    catch (error) { onError('Extension 連線中斷或版本已更新，請重新整理 YouTube。', live.videoId); throw error; }
    if (!response?.ok) {
      onError(response?.error || '未能確認觀看紀錄已儲存，請重試。', live.videoId);
      throw Error(response?.error || 'Extension 連線中斷');
    }
    if (response.view) onView(response.view);
    const nextEnabled = response.enabled !== false;
    if (nextEnabled !== enabled || response.epoch !== recordingEpoch) { tracker.reset(); pending.clear(); }
    recordingEpoch = response.epoch;
    enabled = nextEnabled;
    if (!enabled) pending.clear();
  }
  async function flush() {
    if (stopped) return;
    if (sending) { flushRequested = true; return; }
    sending = true; lastSent = clock();
    try {
      while (pending.size) {
        const [id, item] = pending.entries().next().value;
        pending.delete(id);
        try {
          await send({ ...item, status: id === live.videoId ? live.status : 'paused', currentTime: id === live.videoId ? live.currentTime : item.ranges.at(-1)?.[1] || 0 });
        } catch (error) {
          const newer = pending.get(id);
          pending.set(id, { ...item, ranges: mergeIntervals([...item.ranges, ...(newer?.ranges || [])], item.duration) });
          throw error;
        }
      }
      await send({ ...live, ranges: [] });
    } catch {
      // Keep unacknowledged intervals in memory and retry on the next tick.
      // The worker exposes persistence errors to the panel through session data.
    } finally {
      sending = false;
      if (flushRequested) { flushRequested = false; void flush(); }
    }
  }
  listen(doc, 'yt-navigate-start', () => {
    tick(); void flush(); navigationFromId = contextId; navigating = true; navigationCycle = true; awaitingMetadata = true; tracker.reset();
  });
  listen(doc, 'yt-navigate-finish', () => {
    navigating = false;
    if (youtubeVideoId(win.location.href) === navigationFromId && video?.readyState >= 1) awaitingMetadata = false;
    tick(); navigationCycle = false;
  });
  listen(win, 'pagehide', () => { tick(); void flush(); });
  listen(doc, 'visibilitychange', () => { tick(); void flush(); });
  const timer = win.setInterval(tick, 500);
  tick();
  return { tick, flush, stop() { stopped = true; win.clearInterval(timer); unbind(); for (const remove of listeners) remove(); }, getLive: () => ({ ...live }) };
}
