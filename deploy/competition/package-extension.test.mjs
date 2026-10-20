import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extensionArchive, extractExtensionArchive, packageExtension } from './package-extension.mjs';

test('MV3 ZIP bytes bind to sorted files and ignore filesystem timestamps', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'delta-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'extension-dist');
  await mkdir(path.join(directory, 'chunks'), { recursive: true });
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ manifest_version: 3, version: '0.7.0' }));
  await writeFile(path.join(directory, 'chunks/panel.js'), 'console.log("package proof");');
  const first = await extensionArchive(directory);
  await utimes(path.join(directory, 'chunks/panel.js'), 1000000000, 1000000000);
  const second = await extensionArchive(directory);
  assert.deepEqual(first.buffer, second.buffer);
  assert.deepEqual(first.files.map(file => file.path), ['chunks/panel.js', 'manifest.json']);
  await extractExtensionArchive(first.buffer, first.files, path.join(root, 'unpacked'));
  assert.equal(await readFile(path.join(root, 'unpacked/chunks/panel.js'), 'utf8'), 'console.log("package proof");');
  await writeFile(path.join(directory, 'chunks/panel.js'), 'console.log("changed");');
  assert.notDeepEqual((await extensionArchive(directory)).buffer, first.buffer);
});

async function builtExtension(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'delta-built-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'extension-dist');
  await mkdir(path.join(directory, 'icons'), { recursive: true });
  await mkdir(path.join(directory, 'assets'));
  await mkdir(path.join(directory, 'chunks'));
  const icons = { '16': 'icons/icon-16.png', '32': 'icons/icon-32.png', '48': 'icons/icon-48.png', '128': 'icons/icon-128.png' };
  const manifest = { manifest_version: 3, version: '0.7.0', icons, action: { default_icon: icons },
    background: { service_worker: 'background.js', type: 'module' }, side_panel: { default_path: 'panel.html' },
    content_scripts: [{ matches: ['https://www.youtube.com/*'], js: ['content.js'] }] };
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  for (const file of ['background.js', 'content.js', 'panel.js', 'chunks/hosted-actions-1234abcd.js']) await writeFile(path.join(directory, file), '/* synthetic package fixture */');
  await writeFile(path.join(directory, 'panel.html'), '<script src="./panel.js"></script><link href="./assets/panel-1234abcd.css">');
  await writeFile(path.join(directory, 'assets/panel-1234abcd.css'), 'body{}');
  await writeFile(path.join(directory, 'icons/delta.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  for (const file of Object.values(icons)) await copyFile(path.join(repository, 'extension', file), path.join(directory, file));
  return { root, directory, manifest };
}

test('MV3 package includes all declared icons and dynamic Vite chunks', async t => {
  const { root } = await builtExtension(t), receipt = await packageExtension(root);
  assert.deepEqual(receipt.files.filter(file => file.path.startsWith('icons/')).map(file => file.path),
    ['icons/delta.svg', 'icons/icon-128.png', 'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png']);
  assert(receipt.files.some(file => file.path === 'chunks/hosted-actions-1234abcd.js'));
});

test('MV3 package permits an identical rebuild of a released version', async t => {
  const { root } = await builtExtension(t);
  const first = await packageExtension(root);
  assert.deepEqual(await packageExtension(root), first);
});

test('MV3 package requires a new version for changed bytes and preserves the released archive', async t => {
  const { root, directory, manifest } = await builtExtension(t);
  const first = await packageExtension(root);
  const archive = path.join(root, 'public/downloads', first.filename);
  const original = await readFile(archive);
  await writeFile(path.join(directory, 'panel.js'), '/* changed release */');
  await assert.rejects(packageExtension(root), /already exists.*bump.*version/i);
  assert.deepEqual(await readFile(archive), original);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'extension-package.json'), 'utf8')), first);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ ...manifest, version: '0.7.1' }));
  const next = await packageExtension(root);
  assert.equal(next.filename, 'Delta-Chrome-MVP-0.7.1.zip');
  assert.notEqual(next.sha256, first.sha256);
  assert.deepEqual(await readFile(archive), original);
});

test('MV3 package rejects a missing manifest icon', async t => {
  const { root, directory } = await builtExtension(t);
  await rm(path.join(directory, 'icons/icon-48.png'));
  await assert.rejects(packageExtension(root), /[Ii]con|[Mm]anifest|[Mm]issing/);
});

test('MV3 package rejects undeclared private files instead of archiving them', async t => {
  const { root, directory } = await builtExtension(t);
  await writeFile(path.join(directory, 'private-history.json'), 'synthetic private fixture');
  await assert.rejects(packageExtension(root), /[Uu]nexpected|[Aa]llowlist/);
});

test('ZIP extraction rejects corrupt local or central CRC even when body hashes still match', async t => {
  const { directory, root } = await builtExtension(t), { buffer, files } = await extensionArchive(directory);
  const local = Buffer.from(buffer); local[14] ^= 1;
  await assert.rejects(extractExtensionArchive(local, files, path.join(root, 'bad-local')), /CRC/);
  const central = Buffer.from(buffer), offset = central.readUInt32LE(central.length - 6); central[offset + 16] ^= 1;
  await assert.rejects(extractExtensionArchive(central, files, path.join(root, 'bad-central')), /CRC/);
});

test('MV3 archive rejects symlinks instead of following them into private data', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'delta-package-link-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'outside.txt'), 'private fixture');
  await mkdir(path.join(root, 'extension-dist'));
  await symlink('../outside.txt', path.join(root, 'extension-dist/link.txt'));
  await assert.rejects(extensionArchive(path.join(root, 'extension-dist')), /Unsupported extension entry/);
});
