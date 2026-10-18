// Real episode/chapter metadata only. No authored UI fixture is source evidence.
export const INDEX_VERSION = 'youtube-chapters-v1';
export const CHAPTERS = Object.freeze([
  Object.freeze({ id: 'cursor', videoId: 'En5cSXgGvZM', title: 'Cursor：產品與競爭優勢', start: 2325, end: 2776,
    official: 'https://www.lennysnewsletter.com/p/the-rise-of-cursor-michael-truell' }),
  Object.freeze({ id: 'yc', videoId: 'bxBzsSsqQAM', title: 'YC：AI 新創護城河', start: 1170, end: 1884,
    official: 'https://www.ycombinator.com/library/Mx-the-7-most-powerful-moats-for-ai-startups' }),
  Object.freeze({ id: 'anthropic', videoId: 'DKrBGOFs0GY', title: 'Anthropic：AI 產品機會', start: 2836, end: 3123,
    official: 'https://www.lennysnewsletter.com/p/anthropics-cpo-heres-what-comes-next' }),
]);
export const chapterFor = (videoId) => CHAPTERS.find((chapter) => chapter.videoId === videoId);
export const sourceUrl = (videoId, start) => `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(start)}s`;

export function mergeRanges(ranges, start = 0, end = Infinity) {
  const sorted = ranges.map(([a, b]) => [Math.max(start, a), Math.min(end, b)])
    .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const result = [];
  for (const range of sorted) {
    const last = result.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else result.push([...range]);
  }
  return result;
}

export const fullyCovered = (unit, ranges) => ranges.some(([start, end]) => start <= unit.start && end >= unit.end);
export const hasOverlap = (unit, ranges) => ranges.some(([start, end]) => start < unit.end && end > unit.start);
