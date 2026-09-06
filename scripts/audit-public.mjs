// Read-only gate. Reports locations, never the matched values or file contents.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyNoticeBundle } from './verify-notices.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
export function findings(bytes) {
  if (bytes.subarray(0, 8192).includes(0)) return [];
  const text = bytes.toString('utf8');
  return [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    ['credential-pattern', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})\b/],
    ['personal-macos-path', /\/Users\/(?!vous(?:\/|\b)|you(?:\/|\b)|example(?:\/|\b)|test(?:\/|\b))[^\s/"'<>]+\//],
  ].filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = [];
  if (!['LICENSE','LICENSE.md','LICENSE.txt'].some((name) => existsSync(resolve(root,name)))) issues.push({ issue:'license-decision-required' });
  const rights = JSON.parse(readFileSync(resolve(root,'docs/asset-rights.json')));
  if (rights.reviewed !== true) issues.push({ issue:'asset-rights-review-required' });
  const dependencyRights = resolve(root, 'docs/dependency-rights.json');
  if (!existsSync(dependencyRights) || JSON.parse(readFileSync(dependencyRights)).reviewed !== true) issues.push({ issue:'dependency-notices-review-required' });
  const files = [...new Set(git('ls-files','--cached','--others','--exclude-standard','-z').toString().split('\0').filter(Boolean))];
  try {
    const approved = JSON.parse(readFileSync(dependencyRights));
    if (!approved.noticeSha256) throw Error('Missing reviewed hash');
    verifyNoticeBundle(resolve(root, 'docs/third-party'), approved.noticeSha256);
  } catch { issues.push({ issue:'dependency-notice-integrity-check-failed' }); }
  for (const file of files.filter((name) => /\.(?:png|jpe?g|webp|gif|svg|icns|ico|woff2?|ttf|otf)$/i.test(name))) {
    if (!existsSync(resolve(root, file))) continue;
    const hash = createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
    if (!rights.assets?.some((asset) => asset.file === file && asset.sha256 === hash)) issues.push({ file, issue:'visual-added-or-changed-after-review' });
  }
  for (const file of files) {
    if (!existsSync(resolve(root,file))) continue;
    const bytes = readFileSync(resolve(root,file));
    for (const issue of findings(bytes)) issues.push({ file, issue });
    if (/(?:^|\/)(?:\.env(?:\..*)?|hermes-source\.json)$|\.(?:p12|p8|pem|key)$/.test(file)) issues.push({file, issue:'sensitive-file-name'});
  }
  if (process.argv.includes('--history')) {
    const objects = git('rev-list','--objects','--all').toString().trim().split('\n');
    for (const object of objects) {
      const [id, ...pathParts] = object.split(' ');
      if (!id || !pathParts.length || git('cat-file','-t',id).toString().trim() !== 'blob') continue;
      const size = Number(git('cat-file','-s',id).toString());
      if (size > 4 * 1024 * 1024) { issues.push({object:id.slice(0,12),file:pathParts.join(' '),issue:'large-history-blob-manual-review'}); continue; }
      for (const issue of findings(git('cat-file','blob',id))) issues.push({object:id.slice(0,12),file:pathParts.join(' '),issue});
    }
  }
  console.log(JSON.stringify({ scope: process.argv.includes('--history') ? 'worktree-and-history' : 'worktree-only',
    limitation: 'Pattern scan, not a guarantee that no private data or secrets exist.', ready: issues.length === 0, issues }, null, 2));
  if (issues.length) process.exitCode = 1;
}
