import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const RELEASE_DOCUMENTS = ['INSTALLATION.md', 'TEST-BETA.md', 'BETA-MAC.md', 'VPS.md', 'SECURITY.md', 'PRIVACY.md', 'PUBLICATION.md', 'PROTOCOL.md', 'VALIDATION-0.2.0.md'];
export const RELEASE_ROOT_DOCUMENTS = ['LICENSE', 'THIRD_PARTY_NOTICES.md'];

export function sourceStamp(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString();
  const revision = git('rev-parse', 'HEAD').trim();
  const dirty = git('status', '--porcelain').length > 0;
  const files = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean))].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    let stat;
    try { stat = lstatSync(resolve(root, file)); } catch { continue; }
    if (!stat.isFile()) throw Error('Source fingerprint requires regular files');
    hash.update(file).update('\0').update(createHash('sha256').update(readFileSync(resolve(root, file))).digest()).update('\0');
  }
  return { revision, dirty, fingerprint: hash.digest('hex') };
}

export function verifyDocumentLinks(root) {
  for (const name of RELEASE_DOCUMENTS) {
    const text = readFileSync(resolve(root, 'docs', name), 'utf8');
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|#)/.test(target)) continue;
      if (!RELEASE_DOCUMENTS.includes(target.split('#')[0])) throw Error(`Document missing from release: ${name} -> ${target}`);
    }
  }
}

export function adHocEnvironment(environment) {
  // Free beta builds must never inherit credentials or submit a build to Apple.
  return { ...Object.fromEntries(Object.entries(environment).filter(([name]) => !name.startsWith('APPLE_'))), APPLE_SIGNING_IDENTITY: '-' };
}
