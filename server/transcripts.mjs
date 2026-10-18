import path from 'node:path';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CHAPTERS } from './catalogue.mjs';
import { ValidationError } from './validation.mjs';

const fail = (message) => { throw new ValidationError(message); };
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => { if (!plain(value) || Object.keys(value).some((key) => !expected.includes(key))) fail('逐字稿格式不正確'); };

export function validateTranscript(value, chapter, sha256) {
  keys(value, ['schemaVersion', 'videoId', 'sourceUrl', 'language', 'cues']);
  if (value.schemaVersion !== 1 || value.videoId !== chapter.videoId || typeof value.language !== 'string' || !/^[A-Za-z0-9-]{2,30}$/.test(value.language)) fail('逐字稿識別或語言不正確');
  if (![chapter.official, `https://www.youtube.com/watch?v=${chapter.videoId}`].includes(value.sourceUrl)) fail('逐字稿來源唔係指定原片或官方頁');
  if (!Array.isArray(value.cues) || value.cues.length < 1 || value.cues.length > 20000) fail('逐字稿未提供有效字幕');
  let previous = -1;
  const eligible = [];
  for (let i = 0; i < value.cues.length; i++) {
    const cue = value.cues[i];
    keys(cue, ['start', 'end', 'text']);
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.start < previous || cue.end <= cue.start || cue.end > 100000 || cue.end - cue.start > 90 || typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 2000) fail('逐字稿時間碼或字幕不正確');
    previous = cue.start;
    // Integer YouTube export timestamps are approximate. A one-second end
    // margin is required, including at chapter boundaries; never clip away it.
    if (cue.start >= chapter.start && cue.end + 1 <= chapter.end) eligible.push({ ...cue, text: cue.text.trim(), originalIndex: i });
  }
  if (!eligible.length) fail('章節內冇完整且可保守定位嘅字幕');
  // Group complete adjacent caption cues into short evidence blocks to retain
  // every word while keeping the local model context bounded. IDs are ours.
  const blocks = [];
  for (const cue of eligible) {
    const block = blocks.at(-1);
    if (block && cue.start <= block.end + 2 && cue.end - block.start <= 16 && block.text.length + cue.text.length < 450) {
      block.end = Math.max(block.end, cue.end);
      block.text += ` ${cue.text}`;
      block.originalCueIndices.push(cue.originalIndex);
    } else blocks.push({ id: `c${blocks.length}`, start: cue.start, end: cue.end, text: cue.text, originalCueIndices: [cue.originalIndex] });
  }
  return { videoId: chapter.videoId, sourceUrl: value.sourceUrl, language: value.language, sha256, blocks,
    cueCount: eligible.length, precisionSeconds: 1 };
}

export function loadTranscripts(directory) {
  const transcripts = new Map();
  if (!directory || typeof directory !== 'string') return transcripts;
  let root;
  try { root = realpathSync(path.resolve(directory)); } catch { return transcripts; }
  for (const chapter of CHAPTERS) {
    try {
      const filename = realpathSync(path.join(root, `${chapter.videoId}.json`));
      if (!filename.startsWith(`${root}${path.sep}`) || !statSync(filename).isFile() || statSync(filename).size > 2000000) continue;
      const bytes = readFileSync(filename);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      transcripts.set(chapter.videoId, validateTranscript(JSON.parse(bytes.toString('utf8')), chapter, sha256));
    } catch { /* A missing/invalid source remains unavailable, never a fixture. */ }
  }
  return transcripts;
}

export function transcriptIndexVersion(transcripts, modelDigest = '') {
  const fingerprint = CHAPTERS.map((chapter) => `${chapter.videoId}:${transcripts.get(chapter.videoId)?.sha256 || 'unavailable'}`).join('|');
  return `timed-cues-v2-verified:${createHash('sha256').update(`${fingerprint}|${modelDigest}`).digest('hex').slice(0, 24)}`;
}

export function materializeTranscriptIndex(raw, transcript, chapter) {
  keys(raw, ['units']);
  if (!Array.isArray(raw.units) || raw.units.length > 8) fail('本機分析來源單元格式不正確');
  const used = new Set();
  return { units: raw.units.map((unit) => {
    keys(unit, ['cueIds', 'summary', 'conditions', 'topic', 'support', 'speaker']);
    if (!Array.isArray(unit.cueIds) || !unit.cueIds.length || unit.cueIds.length > 12 || new Set(unit.cueIds).size !== unit.cueIds.length) fail('來源缺少有效字幕依據');
    const positions = unit.cueIds.map((id) => transcript.blocks.findIndex((cue) => cue.id === id));
    if (positions.some((position, i) => position < 0 || i > 0 && position !== positions[i - 1] + 1)) fail('來源字幕依據缺失或唔連續');
    if (unit.cueIds.some((id) => used.has(id))) fail('來源重用字幕單元');
    unit.cueIds.forEach((id) => used.add(id));
    const first = transcript.blocks[positions[0]], last = transcript.blocks[positions.at(-1)];
    const start = first.start, end = last.end + 1;
    if (start < chapter.start || end > chapter.end || end - start < 12 || end - start > 90) fail('來源時間碼超出保守字幕範圍或只屬過短片段');
    const { cueIds, ...annotation } = unit;
    return { ...annotation, start, end };
  }) };
}
