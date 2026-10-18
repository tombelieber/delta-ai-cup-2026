// The learning pilot uses reviewed SUMIF teaching evidence. This selection never
// changes the independent recorder's playhead, duration, or watched ranges.
export const LEARNING_PILOT = Object.freeze({ videoId: 'dI8w0utjUc0', kind: 'knowledge', start: 35, end: 186,
  url: 'https://www.youtube.com/watch?v=dI8w0utjUc0&t=35s' });

export function learningSourceVideo(video = {}) {
  const source = video || {};
  return source.videoId === LEARNING_PILOT.videoId
    ? { ...source, start: LEARNING_PILOT.start, end: LEARNING_PILOT.end }
    : { ...source };
}
