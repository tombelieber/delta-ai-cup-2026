// Pure playback observation. Storage owns interval union; this module never
// infers watched coverage from a playhead jump or cumulative player history.
const MAX_OBSERVATION_GAP_MS = 2_000;
const POSITION_TOLERANCE_SECONDS = 0.25;

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.videoId !== 'string' || !snapshot.videoId.trim()) return null;
  const { currentTime, duration, playbackRate, readyState, now } = snapshot;
  if (![currentTime, duration, playbackRate, readyState, now].every(Number.isFinite)
    || duration <= 0 || currentTime < 0 || playbackRate <= 0) return null;

  return {
    videoId: snapshot.videoId,
    currentTime: Math.min(currentTime, duration),
    duration,
    playbackRate,
    readyState,
    now,
    paused: Boolean(snapshot.paused),
    seeking: Boolean(snapshot.seeking),
    ended: Boolean(snapshot.ended),
    ad: Boolean(snapshot.ad),
  };
}

function hasContentFrame(snapshot) {
  // HAVE_FUTURE_DATA (3) is the lowest state in which playback can advance.
  return snapshot && snapshot.readyState >= 3 && !snapshot.seeking && !snapshot.ad;
}

/**
 * Observe a real media element using a monotonic millisecond clock.
 *
 * sample() returns the same { videoId, start, end } sent to onRange, or null.
 * Call reset() on seeking, ratechange, emptied, or player element replacement.
 * A pause/ended snapshot may close an already observed playing interval, but
 * starting playback, navigating, or seeking never fills the preceding gap.
 */
export function createPlaybackTracker({ onRange = () => {} } = {}) {
  if (typeof onRange !== 'function') throw new TypeError('onRange must be a function');
  let previous = null;

  return {
    reset() {
      previous = null;
    },

    sample(snapshot) {
      const current = normalizeSnapshot(snapshot);
      const from = previous;
      previous = current;

      if (!hasContentFrame(from) || !hasContentFrame(current)
        || from.paused || from.ended || from.videoId !== current.videoId
        || from.playbackRate !== current.playbackRate
        // A large metadata change with the same ID may be a replaced/ad player.
        || Math.abs(from.duration - current.duration) > 1) return null;

      const elapsedMs = current.now - from.now;
      const advanced = current.currentTime - from.currentTime;
      if (elapsedMs <= 0 || elapsedMs > MAX_OBSERVATION_GAP_MS || advanced <= 0) return null;

      const expectedAdvance = elapsedMs / 1_000 * from.playbackRate;
      // Small clock/player rounding drift is allowed. Forward skips and long
      // timer suspension are discarded, even if seeking events were missed.
      const tolerance = Math.max(POSITION_TOLERANCE_SECONDS, expectedAdvance * 0.1);
      if (advanced > expectedAdvance + tolerance) return null;

      const end = Math.min(current.currentTime, from.duration, current.duration);
      if (end <= from.currentTime) return null;
      const range = { videoId: current.videoId, start: from.currentTime, end };
      onRange(range);
      return range;
    },
  };
}
