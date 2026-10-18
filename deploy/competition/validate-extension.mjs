import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function validateExtensionFiles(directory, manifest, files) {
  assert.equal(manifest.manifest_version, 3, 'Expected an MV3 manifest');
  assert.match(manifest.version || '', /^\d+\.\d+\.\d+$/, 'Expected a release manifest version');
  assert.equal(manifest.background?.service_worker, 'background.js', 'Unexpected manifest background entry');
  assert.equal(manifest.background?.type, 'module', 'Expected a module background worker');
  assert.equal(manifest.side_panel?.default_path, 'panel.html', 'Unexpected manifest side panel entry');
  assert.deepEqual(manifest.content_scripts?.flatMap(item => item.js), ['content.js'], 'Unexpected manifest content scripts');
  const icons = Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon-${size}.png`]));
  assert.deepEqual(manifest.icons, icons, 'Manifest icons must include all supported sizes');
  assert.deepEqual(manifest.action?.default_icon, icons, 'Action icons must match the manifest icons');
  const required = new Set(['manifest.json', 'background.js', 'content.js', 'panel.html', 'panel.js', 'icons/delta.svg', ...Object.values(icons)]);
  const names = new Set(files.map(file => file.path));
  assert.equal(names.size, files.length, 'Duplicate extension package paths');
  for (const name of names) {
    assert(required.has(name) || /^(?:assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.css|chunks\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.js)$/.test(name), `Unexpected extension file outside allowlist: ${name}`);
  }
  for (const name of required) assert(names.has(name), `Missing manifest or required extension file: ${name}`);
  for (const [size, name] of Object.entries(icons)) {
    const bytes = await readFile(path.join(directory, name));
    assert(bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `Icon is not a PNG: ${name}`);
    assert.equal(bytes.readUInt32BE(16), Number(size), `Icon width differs from manifest: ${name}`);
    assert.equal(bytes.readUInt32BE(20), Number(size), `Icon height differs from manifest: ${name}`);
  }
  const panel = await readFile(path.join(directory, 'panel.html'), 'utf8');
  for (const [, reference] of panel.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert(reference.startsWith('./') && names.has(reference.slice(2)), `Missing or external panel asset: ${reference}`);
  }
}
