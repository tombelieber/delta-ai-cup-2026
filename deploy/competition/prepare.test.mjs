import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStudySource } from '../../server/study/source.mjs';
import { createServer } from '../../server/index.mjs';

test('private context includes public icon and trust assets while retaining bounded caption excerpts', async t => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const folder = path.join(root, 'artifacts/competition');
  await mkdir(folder, { recursive: true });
  const temporary = await mkdtemp(path.join(folder, 'assets-context-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, 'candidate');
  execFileSync(process.execPath, ['deploy/competition/prepare.mjs', '--output', output], { cwd: root });
  const receipt = JSON.parse(await readFile(path.join(output, 'candidate-input.json'), 'utf8'));
  for (const name of ['extension/icons/delta.svg', 'extension/icons/icon-16.png', 'extension/icons/icon-32.png', 'extension/icons/icon-48.png', 'extension/icons/icon-128.png', 'public/privacy.html', 'public/support.html']) {
    assert(receipt.files.some(file => file.path === name), `Required public asset absent: ${name}`);
    assert.deepEqual(await readFile(path.join(output, 'context', name)), await readFile(path.join(root, name)));
  }
  const server = createServer({ distDir: path.join(output, 'context/public') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const filename of ['privacy.html', 'support.html']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/${filename}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.equal(await response.text(), await readFile(path.join(root, 'public', filename), 'utf8'));
  }
  assert(!receipt.files.some(file => /(?:^|\/)(?:\.env[^/]*|docs|artifacts|review)(?:\/|$)/.test(file.path)));
  const excerpts = receipt.files.filter(file => file.kind === 'private-caption-excerpt');
  assert.equal(excerpts.length, 4);
  for (const excerpt of excerpts) {
    const text = await readFile(path.join(output, 'context', excerpt.path), 'utf8');
    const videoId = path.basename(excerpt.path, '.txt');
    assert.equal(parseStudySource({ videoId, title: videoId, text, start: excerpt.start, end: excerpt.end }).digest, excerpt.sourceDigest);
    assert(excerpt.bytes < excerpt.originalBytes);
  }
});
