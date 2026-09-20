import { createHash } from 'node:crypto';

export function updaterKey(value) {
  const text = Buffer.from(value.trim(), 'base64').toString('utf8');
  const lines = text.trim().split('\n');
  const raw = Buffer.from(lines[1] || '', 'base64');
  if (!lines[0]?.startsWith('untrusted comment:') || raw.length !== 42 || raw.subarray(0, 2).toString() !== 'Ed') throw Error('Valid updater public key required. Run scripts/updater-signing.py init in your Terminal first.');
  return createHash('sha256').update(value.trim()).digest('hex');
}
export function updateManifest(version, archive, notes) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || version.length > 64) throw Error('Stable numeric version required');
  if (!archive.length || archive.length > 256 * 1024 * 1024) throw Error('Update archive must be between 1 byte and 256 MiB');
  if (Buffer.byteLength(notes) > 8000) throw Error('Release notes exceed 8000 bytes');
  const name = `Agent-World-${version}-mac-universal.app.tar.gz`;
  const pkg = { url: `https://github.com/AndreolleManuel/agent-world/releases/download/v${version}/${name}`, size: archive.length, sha256: createHash('sha256').update(archive).digest('hex') };
  return { name, manifest: { schema: 1, version, notes, platforms: { 'darwin-aarch64': pkg, 'darwin-x86_64': pkg } } };
}
