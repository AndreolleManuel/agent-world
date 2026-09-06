// Export an allowlisted snapshot, never the private Git history or user data.
import { execFileSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findings } from './audit-public.mjs';

const ROOT_FILES = new Set(['.gitignore', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts']);
const DOCS = new Set(['INSTALLATION.md', 'TEST-BETA.md', 'BETA-MAC.md', 'VPS.md', 'SECURITY.md', 'PRIVACY.md', 'PUBLICATION.md', 'asset-rights.json', 'dependency-rights.json', 'dependency-licenses.json']);

export function isPublicSource(file) {
  if (file.includes('\\') || file.split('/').some((part) => part === '..' || part === '.' || !part)) return false;
  if (ROOT_FILES.has(file)) return true;
  if (file.startsWith('docs/')) return DOCS.has(file.slice(5)) || file === 'docs/screenshots/agent-world-demo.png' || /^docs\/third-party\/(?:THIRD-PARTY-LICENSES\.txt|manifest\.json|upstream\/[\w.-]+\.json|mpl\/[\w.-]+\.crate)$/.test(file);
  if (file === '.github/workflows/beta.yml') return true;
  if (/^src\/.+\.(?:tsx?|css|png)$/.test(file)) return true;
  if (/^scripts\/[^/]+\.(?:mjs|sh|swift)$/.test(file)) return true;
  if (/^src-tauri\/(?:Cargo\.(?:toml|lock)|build\.rs|tauri\.(?:beta\.)?conf\.json)$/.test(file)) return true;
  if (/^src-tauri\/(?:src|tests|examples)\/[^/]+\.(?:rs|sh)$/.test(file)) return true;
  if (/^src-tauri\/capabilities\/[^/]+\.json$/.test(file)) return true;
  if (/^src-tauri\/icons\/[^/]+\.(?:svg|icns|png)$/.test(file)) return true;
  return /^collector\/(?:Cargo\.(?:toml|lock)|(?:src|tests)\/[^/]+\.rs)$/.test(file);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const tracked = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean))];
  const files = tracked.filter(isPublicSource).sort().filter((file) => {
    try { return lstatSync(resolve(root, file)) !== undefined; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  });
  for (const file of files) {
    const path = resolve(root, file);
    if (!lstatSync(path).isFile()) throw Error(`Export refuses a non-regular file: ${file}`);
    if (findings(readFileSync(path)).length) throw Error(`Review required before export: ${file}`);
  }
  if (!process.argv.includes('--write')) {
    console.log(JSON.stringify({ scope: 'allowlisted source snapshot, no publication', files }, null, 2));
  } else {
    mkdirSync(resolve(root, 'work'), { recursive: true });
    const output = mkdtempSync(resolve(root, 'work/public-source-'));
    for (const file of files) {
      mkdirSync(dirname(resolve(output, file)), { recursive: true });
      copyFileSync(resolve(root, file), resolve(output, file));
    }
    console.log(JSON.stringify({ output, files: files.length, publicReleaseApproved: false, note: 'No Git history copied, no commit or network action. License, asset rights, dependency notices and release tests still require verification.' }, null, 2));
  }
}
