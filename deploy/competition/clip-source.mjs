import assert from 'node:assert/strict';
import { parseStudySource } from '../../server/study/source.mjs';

export function clipStudySource(candidate, text) {
  const original = parseStudySource({ ...candidate, text });
  const cues = [...text.matchAll(/^\[(?:(\d+):)?(\d{1,2}):(\d{2})\]\s+(.+)$/gm)].map(match => ({
    start: Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]), line: match[0],
  }));
  const selected = cues.map((cue, index) => ({ ...cue, end: cues[index + 1]?.start ?? cue.start + 2 }))
    .filter(cue => cue.start >= candidate.start && cue.end <= candidate.end && cue.end > cue.start);
  const last = selected.at(-1), boundarySentinel = last.end !== last.start + 2;
  const lines = selected.map(cue => cue.line);
  if (boundarySentinel) {
    // The source parser uses the following cue's start as the previous cue's
    // end. A synthetic boundary preserves that end without copying later speech.
    // Its own fallback end must exceed the clip, so it never enters an anchor.
    assert(last.end <= candidate.end && last.end + 2 > candidate.end, 'This source needs a boundary outside the allowed clip');
    const hours = Math.floor(last.end / 3600), minutes = Math.floor(last.end % 3600 / 60), seconds = last.end % 60;
    lines.push(`[${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}] [clip boundary]`);
  }
  const clipped = `Video ID: ${candidate.videoId}\nCaptions: ${original.captionType}\nSource: https://www.youtube.com/watch?v=${candidate.videoId}\n\n${lines.join('\n')}\n`;
  const parsed = parseStudySource({ ...candidate, text: clipped });
  assert.deepEqual(parsed.anchors, original.anchors, 'Clipping must preserve every selected caption anchor');
  assert.equal(parsed.digest, original.digest, 'Clipping must preserve the source identity');
  return { text: clipped, sourceDigest: parsed.digest, captionLineCount: selected.length, boundarySentinel,
    start: candidate.start, end: candidate.end };
}
