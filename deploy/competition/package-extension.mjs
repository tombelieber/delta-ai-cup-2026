import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';
import { validateExtensionFiles } from './validate-extension.mjs';

// ZIP_STORED, lexical paths and a fixed DOS date make the exact built files
// reproducible without depending on a host zip utility or filesystem mtimes.
export async function extensionArchive(directory) {
  async function files(folder, prefix = '') {
    const result = [];
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) result.push(...await files(path.join(folder, entry.name), `${name}/`));
      else if (entry.isFile()) result.push({ name, body: await readFile(path.join(folder, entry.name)) });
      else throw new Error(`Unsupported extension entry: ${name}`);
    }
    return result;
  }
  const entries = await files(directory), local = [], central = [];
  let offset = 0;
  for (const { name, body } of entries) {
    const filename = Buffer.from(name), header = Buffer.alloc(30), record = Buffer.alloc(46), checksum = crc32(body);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(body.length, 22); header.writeUInt16LE(filename.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8); record.writeUInt16LE(33, 14); record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(body.length, 20); record.writeUInt32LE(body.length, 24);
    record.writeUInt16LE(filename.length, 28); record.writeUInt32LE(offset, 42);
    local.push(header, filename, body); central.push(record, filename); offset += header.length + filename.length + body.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return { buffer: Buffer.concat([...local, index, end]), files: entries.map(({ name, body }) => ({ path: name, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') })) };
}

export async function packageExtension(root = process.cwd()) {
  const directory = path.join(root, 'extension-dist');
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const { buffer, files } = await extensionArchive(directory), filename = `Delta-Chrome-MVP-${manifest.version}.zip`;
  await validateExtensionFiles(directory, manifest, files);
  verifyExtensionArchive(buffer, files);
  await mkdir(path.join(root, 'public/downloads'), { recursive: true });
  const archivePath = path.join(root, 'public/downloads', filename);
  try {
    await writeFile(archivePath, buffer, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await readFile(archivePath)).equals(buffer)) {
      throw new Error(`${filename} already exists with different bytes; bump extension/manifest.json version before packaging`);
    }
  }
  const receipt = { version: manifest.version, filename, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'), files };
  await writeFile(path.join(root, 'extension-package.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export function verifyExtensionArchive(buffer, files) {
  const check = (condition, message) => { if (!condition) throw new Error(`Invalid extension ZIP: ${message}`); };
  check(buffer.length >= 22, 'missing end record');
  const end = buffer.length - 22;
  check(buffer.readUInt32LE(end) === 0x06054b50 && buffer.readUInt16LE(end + 20) === 0, 'unexpected trailer');
  check(buffer.readUInt16LE(end + 4) === 0 && buffer.readUInt16LE(end + 6) === 0, 'multi-disk archive');
  check(buffer.readUInt16LE(end + 8) === files.length && buffer.readUInt16LE(end + 10) === files.length, 'entry count differs from receipt');
  let offset = 0;
  const entries = [], names = new Set();
  for (const file of files) {
    check(/^[A-Za-z0-9_./-]+$/.test(file.path) && !file.path.split('/').some(part => !part || part === '..' || part.startsWith('.')) && !names.has(file.path), 'invalid or duplicate path');
    names.add(file.path);
    check(offset + 30 <= end && buffer.readUInt32LE(offset) === 0x04034b50 && buffer.readUInt16LE(offset + 6) === 0x800 && buffer.readUInt16LE(offset + 8) === 0, 'expected UTF-8 ZIP_STORED local entry');
    const nameSize = buffer.readUInt16LE(offset + 26), extraSize = buffer.readUInt16LE(offset + 28), size = buffer.readUInt32LE(offset + 18);
    const name = buffer.subarray(offset + 30, offset + 30 + nameSize).toString();
    const start = offset + 30 + nameSize + extraSize, body = buffer.subarray(start, start + size);
    check(extraSize === 0 && start + size <= end && name === file.path && size === file.bytes && buffer.readUInt32LE(offset + 22) === size, 'entry content or size differs from receipt');
    check(buffer.readUInt32LE(offset + 14) === crc32(body), 'local CRC mismatch');
    check(createHash('sha256').update(body).digest('hex') === file.sha256, 'entry hash differs from receipt');
    entries.push({ name, body, offset, checksum: crc32(body) });
    offset = start + size;
  }
  const centralStart = offset;
  for (const entry of entries) {
    check(offset + 46 <= end && buffer.readUInt32LE(offset) === 0x02014b50 && buffer.readUInt16LE(offset + 8) === 0x800 && buffer.readUInt16LE(offset + 10) === 0, 'invalid central entry');
    const nameSize = buffer.readUInt16LE(offset + 28);
    check(buffer.readUInt32LE(offset + 16) === entry.checksum, 'central CRC mismatch');
    check(buffer.readUInt32LE(offset + 20) === entry.body.length && buffer.readUInt32LE(offset + 24) === entry.body.length, 'central entry size mismatch');
    check(buffer.readUInt16LE(offset + 30) === 0 && buffer.readUInt16LE(offset + 32) === 0 && buffer.readUInt16LE(offset + 34) === 0, 'unexpected central extra data');
    check(buffer.readUInt32LE(offset + 42) === entry.offset && buffer.subarray(offset + 46, offset + 46 + nameSize).toString() === entry.name, 'central path or offset mismatch');
    offset += 46 + nameSize;
  }
  check(offset === end && buffer.readUInt32LE(end + 12) === offset - centralStart && buffer.readUInt32LE(end + 16) === centralStart, 'central directory bounds mismatch');
  return entries;
}

export async function extractExtensionArchive(buffer, files, directory) {
  const entries = verifyExtensionArchive(buffer, files);
  await mkdir(directory, { mode: 0o700 });
  for (const { name, body } of entries) {
    const target = path.join(directory, name);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, body, { flag: 'wx', mode: 0o600 });
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || '')).href) {
  const receipt = await packageExtension();
  console.log(JSON.stringify({ filename: receipt.filename, bytes: receipt.bytes, sha256: receipt.sha256, files: receipt.files.length }));
}
