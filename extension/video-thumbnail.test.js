import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithEsbuild } from 'vite';
import { videoThumbnailUrl, hideFailedVideoThumbnail } from './video-thumbnail.js';

// Catch an arbitrary-URL or non-ID input becoming a third-party request.
test('thumbnail URL accepts only a strict video ID and fixes the host, path and image quality', () => {
  assert.equal(videoThumbnailUrl('abcdefghijk'), 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg');
  assert.equal(videoThumbnailUrl('ab_CD-ef123'), 'https://i.ytimg.com/vi/ab_CD-ef123/mqdefault.jpg');
  for (const invalid of [null, undefined, 12345678901, {}, '', 'short', 'abcdefghijkl', '../abcdefgh', 'abcdefghij/', 'abcdefghij?', ' abcdefghijk', 'abcdefghijk\n', 'https://evil.test/a.jpg']) {
    assert.equal(videoThumbnailUrl(invalid), null);
  }
});

// Catch a failed image leaving a broken preview, changing src or attempting a retry.
test('image failure reveals the adjacent existing status icon without changing or retrying the source', () => {
  const fallback = { hidden: true, classList: { contains: name => name === 'dlj-record-icon' } };
  const image = { tagName: 'IMG', hidden: false, src: 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg', nextElementSibling: fallback };
  hideFailedVideoThumbnail({ currentTarget: image });
  assert.equal(image.hidden, true); assert.equal(fallback.hidden, false);
  assert.equal(image.src, 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg');
  assert.doesNotThrow(() => hideFailedVideoThumbnail({ currentTarget: { tagName: 'IMG', nextElementSibling: null } }));
  assert.doesNotThrow(() => hideFailedVideoThumbnail(null));
});

// Render the actual shared component, rather than checking source strings.
let component;
async function sharedRecord() {
  if (component) return component;
  const source = new URL('./LearningJournal.jsx', import.meta.url), directory = await mkdtemp(join(tmpdir(), 'delta-thumbnail-render-'));
  try {
    await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(directory, 'node_modules'));
    const content = (await readFile(source, 'utf8')).replace(/^import ['"][^'"]+\.css['"];?\s*$/gm, '');
    const transformed = await transformWithEsbuild(content, source.pathname, { loader: 'jsx', jsx: 'automatic' });
    const code = transformed.code.replace(/(['"])\.\/([^'"]+)\1/g, (_match, _quote, path) => JSON.stringify(new URL(path, source).href));
    const file = join(directory, 'record.mjs'); await writeFile(file, code);
    component = (await import(pathToFileURL(file))).VideoRecord;
    return component;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('shared History and Map record renders a lazy private thumbnail and accessible original-title link', async () => {
  const VideoRecord = await sharedRecord();
  const html = renderToStaticMarkup(React.createElement(VideoRecord, { entry: { videoId: 'abcdefghijk', title: 'A real source title', thumbnail: 'https://evil.test/track.jpg' } }));
  assert.match(html, /<img[^>]+src="https:\/\/i\.ytimg\.com\/vi\/abcdefghijk\/mqdefault\.jpg"/);
  assert.match(html, /loading="lazy"/); assert.match(html, /decoding="async"/); assert.match(html, /referrerPolicy="no-referrer"/);
  assert.match(html, /alt=""/); assert.match(html, /width="96"/); assert.match(html, /height="54"/);
  assert.match(html, /<a[^>]+class="dlj-record-title dlj-record-title-link"[^>]+href="https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk"[^>]+rel="noopener noreferrer"[^>]*>A real source title<\/a>/);
  assert.equal(html.includes('evil.test'), false);
  assert.match(html, /class="dlj-record-icon"[^>]+hidden=""/);
  const findImage = node => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'img') return node;
    for (const child of React.Children.toArray(node.props?.children)) { const found = findImage(child); if (found) return found; }
    return null;
  };
  const image = findImage(VideoRecord({ entry: { videoId: 'abcdefghijk', title: 'A real source title' } }));
  const fallback = { hidden: true, classList: { contains: name => name === 'dlj-record-icon' } };
  const target = { tagName: 'IMG', hidden: false, nextElementSibling: fallback };
  image.props.onError({ currentTarget: target });
  assert.equal(target.hidden, true); assert.equal(fallback.hidden, false);
});

test('invalid source identity shows the existing fallback without a remote image or original-video link', async () => {
  const VideoRecord = await sharedRecord();
  const html = renderToStaticMarkup(React.createElement(VideoRecord, { entry: { videoId: 'invalid/source', title: 'Unavailable source' } }));
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('i.ytimg.com'), false);
  assert.equal(html.includes('dlj-record-title-link'), false);
  assert.match(html, /class="dlj-record-icon"/);
});
