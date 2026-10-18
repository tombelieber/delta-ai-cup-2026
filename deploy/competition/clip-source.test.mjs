import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipStudySource } from './clip-source.mjs';
import { STUDY_CANDIDATES } from '../../server/study/catalogue.mjs';
import { parseStudySource } from '../../server/study/source.mjs';

test('clip preserves the last selected cue using an excluded boundary without later speech', () => {
  const candidate = { videoId: 'dI8w0utjUc0', title: 'Synthetic boundary test', start: 5, end: 20 };
  const raw = 'Private unrelated metadata\nVideo ID: dI8w0utjUc0\nCaptions: test-only\n[00:00] BEFORE_PRIVATE\n[00:05] First selected caption.\n[00:10] Second selected caption.\n[00:20] AFTER_PRIVATE\n[00:30] LATER_PRIVATE';
  const result = clipStudySource(candidate, raw);
  assert(!result.text.includes('PRIVATE'));
  assert.match(result.text, /\[00:20\] \[clip boundary\]/);
  assert.equal(result.sourceDigest, parseStudySource({ ...candidate, text: raw }).digest);
  assert(!parseStudySource({ ...candidate, text: result.text }).anchors.some(anchor => anchor.text.includes('clip boundary')));
});

test('all four private source excerpts preserve exact anchors/digests and contain only bounded selected captions', async t => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  for (const candidate of STUDY_CANDIDATES) {
    const filename = path.join(root, 'artifacts/study/sources', `${candidate.videoId}.txt`);
    let original;
    try { original = await readFile(filename, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return t.skip('Private captions are deliberately absent from public source checkouts'); throw error; }
    const originalHash = createHash('sha256').update(original).digest('hex');
    const clipped = clipStudySource(candidate, original);
    assert(Buffer.byteLength(clipped.text) < Buffer.byteLength(original));
    const lines = clipped.text.trim().split('\n');
    assert(lines.slice(0, 3).every(line => /^(?:Video ID|Captions|Source): /.test(line)));
    for (const line of lines.slice(4)) {
      const match = line.match(/^\[(?:(\d+):)?(\d{1,2}):(\d{2})\] (.+)$/);
      assert(match, 'Only timestamped cue lines may follow the allowed metadata');
      const start = Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      assert(start >= candidate.start && start <= candidate.end);
      assert(line.endsWith('[clip boundary]') || original.includes(line));
    }
    const parsed = parseStudySource({ ...candidate, text: clipped.text });
    assert.deepEqual(parsed.anchors, parseStudySource({ ...candidate, text: original }).anchors);
    assert.equal(parsed.digest, clipped.sourceDigest);
    assert.equal(createHash('sha256').update(await readFile(filename)).digest('hex'), originalHash, 'Original private captions must remain untouched');
  }
});
