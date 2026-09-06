import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function verifyNoticeBundle(directory, approvedHash) {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json')));
  const notice = readFileSync(resolve(directory, 'THIRD-PARTY-LICENSES.txt'));
  if (manifest.schema !== 1 || !Array.isArray(manifest.missing) || manifest.missing.length || !manifest.entries?.length) throw Error('Third-party notices are incomplete');
  if (sha(notice) !== manifest.noticeSha256 || (approvedHash && approvedHash !== manifest.noticeSha256)) throw Error('Third-party notices changed after review');
  const sources = manifest.entries.filter((entry) => entry.license === 'MPL-2.0');
  if (sources.length !== manifest.mplSources.length) throw Error('MPL source list mismatch');
  for (const entry of sources) {
    if (!/^mpl\/[\w.-]+\.crate$/.test(entry.source ?? '') || !manifest.mplSources.includes(entry.source.slice(4))) throw Error('Invalid MPL source path');
    if (sha(readFileSync(resolve(directory, entry.source))) !== entry.sourceSha256) throw Error('MPL source archive changed');
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const rights = JSON.parse(readFileSync(resolve(root, 'docs/dependency-rights.json')));
  if (rights.reviewed !== true || !rights.noticeSha256) throw Error('Dependency review required');
  const manifest = verifyNoticeBundle(resolve(root, 'docs/third-party'), rights.noticeSha256);
  console.log(`Verified ${manifest.entries.length} notices and ${manifest.mplSources.length} unchanged MPL source archives.`);
}
