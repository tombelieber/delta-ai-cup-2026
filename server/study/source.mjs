import { createHash } from 'node:crypto';

export class StudyError extends Error {
  constructor(code, status = 400, message = code) { super(message); this.code = code; this.status = status; }
}
export const requireStudy = (condition, code, status = 400, message = code) => {
  if (!condition) throw new StudyError(code, status, message);
};
export function parseStudySource({ videoId, title, text, start = 0, end = 300 }) {
  requireStudy(/^[A-Za-z0-9_-]{11}$/.test(videoId || ''), 'invalid_source');
  requireStudy(typeof text === 'string' && text.length <= 250000, 'invalid_transcript');
  requireStudy(text.match(/^Video ID: ([A-Za-z0-9_-]{11})$/m)?.[1] === videoId, 'source_identity');
  requireStudy(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end - start <= 300 && end <= 86400, 'invalid_clip');
  const lines = [...text.matchAll(/^\[(?:(\d+):)?(\d{1,2}):(\d{2})\]\s+(.+)$/gm)].map(match => ({
    start: Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]), text: match[4].trim(),
  }));
  requireStudy(lines.length >= 3 && lines.every((line, i) => !i || line.start >= lines[i - 1].start), 'invalid_transcript');
  const selected = lines.map((line, i) => ({ ...line, end: lines[i + 1]?.start ?? line.start + 2 }))
    .filter(line => line.start >= start && line.end <= end && line.end > line.start);
  requireStudy(selected.length >= 2, 'source_unavailable', 422, 'Not enough timestamped captions in this clip.');
  // Group complete caption lines; references always resolve to these real
  // caption boundaries, never model-generated seconds. Not claim verification.
  const groups = [];
  for (const line of selected) {
    const previous = groups.at(-1);
    if (previous && line.end - previous.start <= 30 && previous.text.length + line.text.length < 1200) {
      previous.end = line.end; previous.text += ` ${line.text}`;
    } else groups.push({ ...line });
  }
  requireStudy(groups.length <= 80 && groups.reduce((n,a) => n + a.text.length, 0) <= 18000, 'source_too_large', 413);
  const anchors = groups.map((group, i) => ({ id: `${videoId}-${i}`, ...group }));
  const digest = createHash('sha256').update(JSON.stringify({ videoId, start, end, anchors })).digest('hex');
  return { videoId, videoUrl: `https://www.youtube.com/watch?v=${videoId}`, title: String(title || videoId).slice(0, 200),
    start, end, anchors, digest, captionType: text.match(/^Captions: (.+)$/m)?.[1] || 'unspecified',
    provenance: 'Exported YouTube captions; timestamps locate caption spans, not independently verified claims.' };
}
