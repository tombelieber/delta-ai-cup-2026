import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractExtensionArchive } from './package-extension.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--candidate') throw new Error('Usage: node deploy/competition/build.mjs --candidate artifacts/competition/CANDIDATE');
const candidate = path.resolve(args[1]), context = path.join(candidate, 'context');
const receipt = JSON.parse(await readFile(path.join(candidate, 'candidate-input.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = new Map(receipt.files.map(file => [file.path, file]));
for (const name of ['build.mjs', 'package-extension.mjs', 'validate-extension.mjs']) {
  const recorded = expected.get(`deploy/competition/${name}`);
  const actual = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), name));
  if (!recorded || hash(actual) !== recorded.sha256) throw new Error('Packaging tooling changed; prepare a new candidate');
}
async function verify(folder, prefix = '') {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`, absolute = path.join(folder, entry.name);
    if (entry.isDirectory()) { await verify(absolute, `${name}/`); continue; }
    if (!entry.isFile() || (await lstat(absolute)).isSymbolicLink()) throw new Error(`Unexpected context entry: ${name}`);
    const bytes = await readFile(absolute);
    if (name === '.dockerignore') {
      if (bytes.toString() !== '.git\nnode_modules\n.env\n.env.*\nartifacts\n') throw new Error('Context ignore changed');
      continue;
    }
    const input = expected.get(name);
    if (!input || input.bytes !== bytes.length || input.sha256 !== hash(bytes)) throw new Error(`Context differs from candidate receipt: ${name}`);
    expected.delete(name);
  }
}
await verify(context);
if (expected.size || hash(JSON.stringify(receipt.files)) !== receipt.candidateInputSha256) throw new Error('Candidate input receipt is incomplete or changed');
const image = `delta-competition:${receipt.candidateInputSha256.slice(0, 16)}`;
execFileSync('docker', ['build', '--platform=linux/amd64', '--file', path.join(context, 'deploy/competition/Dockerfile'),
  '--label', `io.delta.candidate-input-sha256=${receipt.candidateInputSha256}`,
  '--label', `io.delta.dependency-input-sha256=${receipt.dependencyInputSha256}`,
  '--tag', image, context], { stdio: 'inherit' });
const identity = JSON.parse(execFileSync('docker', ['image', 'inspect', image], { encoding: 'utf8' }))[0];
const container = execFileSync('docker', ['create', identity.Id], { encoding: 'utf8' }).trim();
try {
  execFileSync('docker', ['cp', `${container}:/app/release/extension-package.json`, path.join(candidate, 'extension-package.json')]);
  const extension = JSON.parse(await readFile(path.join(candidate, 'extension-package.json'), 'utf8'));
  execFileSync('docker', ['cp', `${container}:/app/dist/downloads/${extension.filename}`, path.join(candidate, extension.filename)]);
  const zip = await readFile(path.join(candidate, extension.filename));
  if (zip.length !== extension.bytes || hash(zip) !== extension.sha256) throw new Error('Extension export differs from image receipt');
  await extractExtensionArchive(zip, extension.files, path.join(candidate, 'extension-dist'));
  const built = { schemaVersion: 1, image, imageId: identity.Id, platform: `${identity.Os}/${identity.Architecture}`, runtimeUser: identity.Config.User,
    baseImage: receipt.baseImage, candidateInputSha256: receipt.candidateInputSha256, dependencyInputSha256: receipt.dependencyInputSha256,
    extension: { filename: extension.filename, bytes: extension.bytes, sha256: extension.sha256, files: extension.files.length }, published: false };
  await writeFile(path.join(candidate, 'image-receipt.json'), `${JSON.stringify(built, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(built));
} finally { execFileSync('docker', ['rm', container], { stdio: 'ignore' }); }
