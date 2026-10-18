// The service worker is the only writer. Never seed real history with UI fixtures.
export const STORE_KEY = 'zhixin.watch.v1';
export const LIVE_PREFIX = 'zhixin.live.';
export const validVideoId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
export const emptyData = () => ({ schemaVersion: 1, recordingEnabled: true, recordingEpoch: 0, goal: '', videos: {} });

export function mergeIntervals(ranges, duration = Infinity) {
  const sorted = (Array.isArray(ranges) ? ranges : []).filter((range) => Array.isArray(range) && range.length === 2 && range.every(Number.isFinite))
    .map(([start, end]) => [Math.max(0, start), Math.min(duration, end)]).filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  return sorted.reduce((result, range) => {
    const last = result.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else result.push([...range]);
    return result;
  }, []);
}

export function normalizeData(value) {
  if (!value || value.schemaVersion !== 1) return emptyData();
  const data = { ...emptyData(), recordingEnabled: value.recordingEnabled !== false,
    recordingEpoch: Number.isSafeInteger(value.recordingEpoch) && value.recordingEpoch >= 0 ? value.recordingEpoch : 0,
    goal: typeof value.goal === 'string' ? value.goal.slice(0, 200) : '' };
  for (const [id, video] of Object.entries(value.videos || {})) {
    if (!validVideoId(id) || !video || !(Number.isFinite(video.duration) && video.duration > 0)) continue;
    data.videos[id] = { videoId: id, title: typeof video.title === 'string' ? video.title.slice(0, 300) : 'YouTube 影片', duration: video.duration,
      ranges: mergeIntervals(video.ranges, video.duration), updatedAt: Number.isFinite(video.updatedAt) ? video.updatedAt : 0 };
  }
  return data;
}

export function applyRecording(data, { videoId, title, duration, ranges }, now = Date.now()) {
  if (!data.recordingEnabled || !validVideoId(videoId) || !Number.isFinite(duration) || duration <= 0) return data;
  const added = mergeIntervals(ranges, duration);
  if (!added.length) return data;
  const previous = data.videos[videoId];
  const merged = mergeIntervals([...(previous?.ranges || []), ...added], duration);
  const safeTitle = typeof title === 'string' && title.trim() ? title.slice(0, 300) : previous?.title || 'YouTube 影片';
  if (previous && previous.duration === duration && previous.title === safeTitle && JSON.stringify(previous.ranges) === JSON.stringify(merged)) return data;
  return { ...data, videos: { ...data.videos, [videoId]: { videoId, title: safeTitle, duration, ranges: merged, updatedAt: now } } };
}

export const isYouTubeUrl = (value) => {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'www.youtube.com'; }
  catch { return false; }
};

export function youtubeVideoId(value) {
  try { const url = new URL(value); const id = url.searchParams.get('v'); return isYouTubeUrl(value) && url.pathname === '/watch' && validVideoId(id) ? id : null; }
  catch { return null; }
}

export function createRepository(storage, now = Date.now) {
  let queue = Promise.resolve();
  const run = (operation) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const read = async () => normalizeData((await storage.get(STORE_KEY))[STORE_KEY]);
  return {
    read: () => run(read),
    update: (operation) => run(async () => {
      const before = await read();
      const after = operation(before, now());
      if (after !== before) await storage.set({ [STORE_KEY]: after });
      return after;
    }),
  };
}
