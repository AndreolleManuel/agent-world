// Prepare a signed-update candidate; never publishes or handles private keys.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, lstatSync, readdirSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { sourceStamp } from './release-metadata.mjs';
import { updaterKey, updateManifest } from './update-metadata.mjs';
import { verifyNoticeBundle } from './verify-notices.mjs';

const args = process.argv.slice(2);
if (args.length !== 2) throw Error('Usage: npm run package:update -- /path/to/Agent\ World.app /path/to/release-notes.txt');
const app = resolve(args[0]);
if (basename(app) !== 'Agent World.app') throw Error('Expected Agent World.app');
const version = JSON.parse(readFileSync('package.json')).version;
const info = JSON.parse(readFileSync(join(app, 'Contents/Resources/build-info.json')));
const key = updaterKey(readFileSync('docs/agent-world-updater.pub', 'utf8'));
if (info.updaterKeySha256 !== key || info.version !== version || JSON.stringify(info.source) !== JSON.stringify(sourceStamp(process.cwd()))) throw Error('Rebuild the app with the current sources and updater key before packaging');
const rights = JSON.parse(readFileSync('docs/dependency-rights.json'));
if (!rights.reviewed) throw Error('Dependency review required');
verifyNoticeBundle(join(app, 'Contents/Resources/licenses'), rights.noticeSha256);
const walk = path => {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw Error('Update packages must contain only regular files and directories');
  if (stat.isDirectory()) for (const child of readdirSync(path)) walk(join(path, child));
};
walk(app);
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
execFileSync('/usr/bin/lipo', [join(app, 'Contents/MacOS/pixel-ops'), '-verify_arch', 'arm64', 'x86_64']);
for (const [field, expected] of [['CFBundleIdentifier', 'com.amlabs.pixelops'], ['CFBundleShortVersionString', version]]) {
  if (execFileSync('/usr/bin/plutil', ['-extract', field, 'raw', '-o', '-', join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim() !== expected) throw Error('Unexpected app identity/version');
}
mkdirSync('release', { recursive: true });
const output = mkdtempSync(resolve('release/update-'));
const name = `Agent-World-${version}-mac-universal.app.tar.gz`;
execFileSync('/usr/bin/tar', ['--format', 'ustar', '--no-xattrs', '-czf', join(output, name), '-C', dirname(app), basename(app)], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
const { manifest } = updateManifest(version, readFileSync(join(output, name)), readFileSync(args[1], 'utf8').trim());
writeFileSync(join(output, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Update candidate: ${output}\nSign latest.json with scripts/updater-signing.py sign, then verify it before publishing.`);
