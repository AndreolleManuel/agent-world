// Lists versioned/unignored visual and font files, without inferring usage or rights.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean))];
const assets = [];
for (const file of files.sort()) {
  if (!/\.(?:png|jpe?g|webp|gif|svg|icns|ico|woff2?|ttf|otf)$/i.test(file)) continue;
  let stat;
  try { stat = lstatSync(resolve(root, file)); } catch { continue; }
  if (!stat.isFile()) { assets.push({ file, review: 'non-regular-file-review-required' }); continue; }
  assets.push({ file, bytes: stat.size, sha256: createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex'), review: 'provenance-and-redistribution-to-confirm' });
}
console.log(JSON.stringify({ limitation: 'Inventory only, including possibly unused files. Not a license or rights validation; external assets and dependency licenses require separate review.', count: assets.length, assets }, null, 2));
