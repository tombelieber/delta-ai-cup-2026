import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStudySources, STUDY_CANDIDATES } from '../../server/study/catalogue.mjs';
import { clipStudySource } from './clip-source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = process.argv.slice(2);
if (arg.length !== 2 || arg[0] !== '--output') throw new Error('Usage: node deploy/competition/prepare.mjs --output artifacts/competition/CANDIDATE');
const output = path.resolve(root, arg[1]), privateRoot = path.join(root, 'artifacts/competition');
if (!output.startsWith(`${privateRoot}${path.sep}`)) throw new Error('Output must be a new directory under ignored artifacts/competition/');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceRoot = path.join(root, 'artifacts/study/sources');
const sources = await loadStudySources(sourceRoot);
if (sources.length !== 4 || STUDY_CANDIDATES.some(candidate => !sources.some(source => source.videoId === candidate.videoId))) throw new Error('All four prepared caption sources are required');

const roots = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'index.html', 'vite.config.mjs', 'src', 'extension', 'server', 'public', 'deploy/competition'];
const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...roots], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const rootFiles = new Set(roots.filter(value => value.includes('.')));
const allow = name => rootFiles.has(name)
  || /^src\/[A-Za-z0-9_./-]+\.(?:jsx?|mjs|css|svg|png|jpe?g|woff2?)$/.test(name)
  || /^extension\/[A-Za-z0-9_.-]+\.(?:jsx?|mjs|css|html|json)$/.test(name)
  || /^extension\/icons\/(?:delta\.svg|icon-(?:16|32|48|128)\.png)$/.test(name)
  || /^server\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.mjs$/.test(name)
  || /^server\/reviewed-index\/[a-f0-9]{64}\.json$/.test(name)
  || /^public\/episodes\/(?:anthropic|cursor|yc)\.jpg$/.test(name)
  || /^public\/(?:privacy|support)\.html$/.test(name)
  || /^public\/downloads\/Delta-Chrome-MVP-\d+\.\d+\.\d+\.zip$/.test(name)
  || /^deploy\/competition\/(?:Dockerfile|[A-Za-z0-9_.-]+\.mjs)$/.test(name);
const files = [...new Set(listed.filter(allow))].sort();
for (const required of ['package.json', 'pnpm-lock.yaml', 'server/index.mjs', 'extension/manifest.json', 'deploy/competition/Dockerfile', 'deploy/competition/package-extension.mjs']) {
  if (!files.includes(required)) throw new Error(`Required input missing: ${required}`);
}
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
if ((await realpath(privateRoot)) !== privateRoot) throw new Error('Private output directory must not be a symlink');
await mkdir(output, { mode: 0o700 });
const context = path.join(output, 'context'), manifest = [];
await mkdir(context, { mode: 0o700 });
async function copy(source, name, kind, transform) {
  const sourceStat = await lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error(`Only regular input files are allowed: ${name}`);
  const original = await readFile(source), clipped = transform?.(original.toString('utf8'));
  const bytes = clipped ? Buffer.from(clipped.text) : original, target = path.join(context, name);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
  manifest.push({ path: name, bytes: bytes.length, sha256: hash(bytes), kind,
    ...(clipped ? { sourceDigest: clipped.sourceDigest, start: clipped.start, end: clipped.end, captionLineCount: clipped.captionLineCount,
      boundarySentinel: clipped.boundarySentinel, originalBytes: original.length, originalSha256: hash(original) } : {}) });
}
for (const name of files) await copy(path.join(root, name), name, 'source');
for (const candidate of STUDY_CANDIDATES) await copy(path.join(sourceRoot, `${candidate.videoId}.txt`),
  `private/study-sources/${candidate.videoId}.txt`, 'private-caption-excerpt', text => clipStudySource(candidate, text));
// This context was assembled from allowed inputs; do not copy the repository's
// broader ignore exceptions or any environment/configuration files into it.
await writeFile(path.join(context, '.dockerignore'), '.git\nnode_modules\n.env\n.env.*\nartifacts\n', { mode: 0o600 });
manifest.sort((a, b) => a.path.localeCompare(b.path, 'en'));
const dockerfile = await readFile(path.join(context, 'deploy/competition/Dockerfile'), 'utf8');
const inputHash = hash(JSON.stringify(manifest));
const dependencies = manifest.filter(entry => ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].includes(entry.path));
const receipt = { schemaVersion: 1, gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  candidateInputSha256: inputHash, dependencyInputSha256: hash(JSON.stringify(dependencies)), baseImage: dockerfile.match(/^ARG NODE_IMAGE=(.+)$/m)?.[1],
  privateCaptionCount: 4, files: manifest };
await writeFile(path.join(output, 'candidate-input.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
await copyFile(path.join(context, '.dockerignore'), path.join(output, 'context-ignore.txt'));
console.log(JSON.stringify({ output, context, candidateInputSha256: inputHash, files: manifest.length, privateCaptionCount: 4, baseImage: receipt.baseImage }));
