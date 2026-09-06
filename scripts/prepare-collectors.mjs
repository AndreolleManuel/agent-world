import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateElf(bytes, architecture) {
  if (bytes.length < 64 || bytes.length > 16 * 1024 * 1024 || !bytes.subarray(0, 6).equals(Buffer.from([127, 69, 76, 70, 2, 1]))) throw Error('ELF 64-bit little-endian required');
  if (bytes.readUInt16LE(18) !== ({ x86_64: 62, aarch64: 183 })[architecture]) throw Error('Wrong CPU architecture');
  const offset = Number(bytes.readBigUInt64LE(32));
  const stride = bytes.readUInt16LE(54), count = bytes.readUInt16LE(56);
  if (!Number.isSafeInteger(offset) || stride < 56 || count < 1 || offset + count * stride > bytes.length) throw Error('Invalid ELF program headers');
  for (let index = 0; index < count; index++) {
    if (bytes.readUInt32LE(offset + index * stride) === 3) throw Error('Dynamic ELF interpreter found; static musl binary required');
  }
}
export function prepare(input, output, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid release version');
  const artifacts = ['x86_64', 'aarch64'].map((arch) => {
    const name = `agent-world-collector-linux-${arch}`;
    const bytes = readFileSync(resolve(input, name)); validateElf(bytes, arch);
    return { name, bytes, hash: createHash('sha256').update(bytes).digest('hex') };
  });
  mkdirSync(output, { recursive: true });
  for (const artifact of artifacts) copyFileSync(resolve(input, artifact.name), resolve(output, artifact.name));
  writeFileSync(resolve(output, 'manifest.json'), JSON.stringify({ version, sha256: Object.fromEntries(artifacts.map((a) => [a.name, a.hash])) }, null, 2) + '\n');
  writeFileSync(resolve(output, 'SHA256SUMS'), artifacts.map((a) => `${a.hash}  ${a.name}\n`).join(''));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (!process.argv[2]) throw Error('Usage: node scripts/prepare-collectors.mjs INPUT_DIRECTORY');
  const version = JSON.parse(readFileSync(resolve(repo, 'package.json'))).version;
  for (const manifest of ['collector/Cargo.toml','src-tauri/Cargo.toml']) {
    if (readFileSync(resolve(repo,manifest),'utf8').match(/^version = "([^"]+)"$/m)?.[1] !== version) throw Error('App and collector versions must match');
  }
  prepare(resolve(process.argv[2]), resolve(repo, 'src-tauri/resources/collectors'), version);
}
