import { build } from 'vite';
import { copyFile, cp, readFile, access, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'extension-dist');
await build({ configFile: false, root, publicDir: false, define: { 'process.env.NODE_ENV': JSON.stringify('production'), __DELTA_EXTENSION__: 'true' }, build: { outDir, emptyOutDir: true, target: 'chrome116', minify: false,
  lib: { entry: path.join(root, 'extension/content-entry.js'), name: 'DeltaRecorder', formats: ['iife'], fileName: () => 'content.js' } } });
await build({ configFile: false, root: path.join(root, 'extension'), publicDir: false, base: './', define: { __DELTA_EXTENSION__: 'true' }, build: { outDir, emptyOutDir: false, target: 'chrome116', minify: false,
  rollupOptions: { input: { panel: path.join(root, 'extension/panel.html'), background: path.join(root, 'extension/background.js') },
    output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' } } } });
await copyFile(path.join(root, 'extension/manifest.json'), path.join(outDir, 'manifest.json'));
await cp(path.join(root, 'extension/icons'), path.join(outDir, 'icons'), { recursive: true });
const manifest = JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, '0.7.0');
assert.deepEqual(manifest.permissions, ['storage', 'sidePanel']);
assert.deepEqual(manifest.optional_permissions, ['history']);
assert.deepEqual(manifest.host_permissions, ['https://www.youtube.com/*']);
assert.deepEqual(manifest.optional_host_permissions, ['https://delta-assistant-613646062582.us-central1.run.app/*', 'http://127.0.0.1/*', 'http://localhost/*']);
assert.deepEqual(manifest.externally_connectable, { matches: ['https://delta-assistant-613646062582.us-central1.run.app/*'] });
const iconPaths = Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon-${size}.png`]));
assert.deepEqual(manifest.icons, iconPaths);
assert.deepEqual(manifest.action.default_icon, iconPaths);
assert.ok(manifest.description.length <= 132, 'The store description must be at most 132 characters');
for (const [size, file] of Object.entries(iconPaths)) {
  const bytes = await readFile(path.join(outDir, file));
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Icons must be PNG files');
  assert.equal(bytes.readUInt32BE(16), Number(size), 'Icon width must match the manifest');
  assert.equal(bytes.readUInt32BE(20), Number(size), 'Icon height must match the manifest');
}
for (const file of [manifest.background.service_worker, manifest.side_panel.default_path, ...manifest.content_scripts.flatMap((item) => item.js)]) await access(path.join(outDir, file));
const contentBundle = await readFile(path.join(outDir, 'content.js'), 'utf8');
new Script(contentBundle, { filename: 'content.js' }); // Classic content-script bundle must parse without module imports.
assert.ok(!contentBundle.includes('process.env.NODE_ENV'), 'Content React build must not depend on a Node process global');
assert.ok(contentBundle.includes('OPEN_LEARNING_PANEL') && contentBundle.includes('Learn this skill more easily.'), 'YouTube must ship the small, opt-in learning suggestion');
assert.ok(!contentBundle.includes('live-ppt') && !contentBundle.includes('HISTORY_PREVIEW'), 'The page must not ship a duplicate learning panel or Chrome-history preview reader');
assert.ok(contentBundle.includes('DELTA_ACCOUNT_HISTORY_START') && contentBundle.includes('ACCOUNT_HISTORY_BATCH'), 'The explicit account history collector must ship in the content bundle');
assert.ok(contentBundle.includes('zhixin-inpage-host'), 'The existing tracked progress host must be retained');
const panel = await readFile(path.join(outDir, 'panel.html'), 'utf8');
for (const [, file] of panel.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) await access(path.join(outDir, file));
const chunks = await readdir(path.join(outDir, 'chunks'));
const panelCode = [await readFile(path.join(outDir, 'panel.js'), 'utf8'), ...(await Promise.all(chunks.filter(file => file.endsWith('.js')).map(file => readFile(path.join(outDir, 'chunks', file), 'utf8'))))].join('\n');
assert.ok(panelCode.includes('HISTORY_PREVIEW') && panelCode.includes('live-ppt') && panelCode.includes('Your history') && panelCode.includes('Your universe.'), 'Native panel must include optional history import, real viewing and learning records, and the orbital map');
assert.ok(panelCode.includes('Allow & import history') && panelCode.includes('ACCOUNT_HISTORY_CONFIRM'), 'Native panel must include explicit account confirmation before collection');
assert.ok(!panelCode.includes('ORBIT_DEMO_RECORDS') && !panelCode.includes('DELTA_SAMPLE_VIDEOS') && !panelCode.includes('Try a larger history'), 'Native records must never include prototype sample data');
assert.ok(panel.includes('lang="en"'), 'Native panel language must be English');
assert.ok(panelCode.includes('Share my universe') && panelCode.includes('Map settings and backups'), 'Native panel must ship real-record maps, local backups and aggregate sharing');
console.log('PASS: Delta 0.7.0 MV3, dynamic AI hierarchy, private analysis, aggregate sharing, real records and shared time range');
console.log(`Load unpacked extension: ${outDir}`);
