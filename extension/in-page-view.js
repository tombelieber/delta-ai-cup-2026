import { episodes } from '../src/data.js';
import { getLearningRouteProgress } from '../src/assistant-data.js';
import { mergeIntervals, normalizeData, validVideoId } from './store.js';

const playbackStatuses = new Set(['playing', 'paused', 'buffering', 'ad', 'seeking', 'waiting', 'unavailable']);
const positive = (value) => Number.isFinite(value) && value > 0;
const title = (value) => typeof value === 'string' ? value.trim().slice(0, 300) : '';

// The YouTube page receives only its current video and the fixed route coverage.
// Playback heartbeats are presentation state, never evidence of saved watching.
export function projectInPageView(data, live) {
  const stored = normalizeData(data);
  const videoId = validVideoId(live?.videoId) ? live.videoId : null;
  const current = videoId ? stored.videos[videoId] : null;
  const status = playbackStatuses.has(live?.status) ? live.status : 'waiting';
  const contentDurationAvailable = !['ad', 'unavailable'].includes(status) && positive(live?.duration);
  const duration = contentDurationAvailable ? live.duration : positive(current?.duration) ? current.duration : 0;
  const currentTime = Number.isFinite(live?.currentTime) ? Math.max(0, live.currentTime) : 0;
  const memory = episodes.map((episode) => ({ episodeId: episode.id, ranges: stored.videos[episode.videoId]?.ranges || [] }));
  const { totalSeconds, watchedSeconds, remainingSeconds, completedSteps, totalSteps, percent, complete, next } = getLearningRouteProgress(memory);
  return {
    videoId,
    title: videoId ? title(live?.title) || title(current?.title) || 'YouTube 影片' : '',
    duration: videoId ? duration : 0,
    ranges: videoId ? mergeIntervals(current?.ranges, duration || Infinity) : [],
    recordingEnabled: stored.recordingEnabled,
    status,
    currentTime: videoId ? duration > 0 ? Math.min(currentTime, duration) : currentTime : 0,
    updatedAt: current?.updatedAt || 0,
    error: '',
    loading: false,
    route: { totalSeconds, watchedSeconds, remainingSeconds, completedSteps, totalSteps, percent, complete, next },
  };
}
