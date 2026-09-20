import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { RELEASE_DOCUMENTS, RELEASE_ROOT_DOCUMENTS, sourceStamp, verifyDocumentLinks } from './release-metadata.mjs';
import { verifyNoticeBundle } from './verify-notices.mjs';
import { updaterKey } from './update-metadata.mjs';

const root = process.cwd();
const version = JSON.parse(readFileSync('package.json')).version;
const args = process.argv.slice(2);
if (args.some((arg) => arg.startsWith('--') && arg !== '--public-beta')) throw Error('Unknown packaging option');
const publicBeta = args.includes('--public-beta');
const app = resolve(args.find((arg) => !arg.startsWith('--')) || 'src-tauri/target/universal-apple-darwin/release/bundle/macos/Agent World.app');
const binary = join(app,'Contents/MacOS/pixel-ops');
verifyDocumentLinks(root);
const info = JSON.parse(readFileSync(join(app, 'Contents/Resources/build-info.json')));
const appVersion = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
const minimumMacOS = execFileSync('/usr/bin/plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', '-o', '-', join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
const source = sourceStamp(root);
if (publicBeta) {
  if (info.updaterKeySha256 !== updaterKey(readFileSync('docs/agent-world-updater.pub', 'utf8'))) throw Error('Public release requires the current updater public key');
  if (source.dirty) throw Error('Public beta requires committed, clean sources');
  execFileSync(process.execPath, ['scripts/audit-public.mjs', '--history'], { cwd: root, stdio: 'inherit' });
}
const rights = JSON.parse(readFileSync(join(root, 'docs/dependency-rights.json')));
if (!rights.reviewed || !rights.noticeSha256) throw Error('Dependency review required before packaging');
verifyNoticeBundle(join(app, 'Contents/Resources/licenses'), rights.noticeSha256);
for (const [file, bundled] of [['LICENSE', 'AGENT-WORLD-LICENSE.txt'], ['THIRD_PARTY_NOTICES.md', 'README.md']]) {
  if (!readFileSync(join(root, file)).equals(readFileSync(join(app, 'Contents/Resources/licenses', bundled)))) throw Error('Bundled project license or notice index mismatch');
}
if (appVersion !== version || info.version !== version || info.minimumMacOS !== minimumMacOS) throw Error('App metadata does not match the release');
if (JSON.stringify(info.source) !== JSON.stringify(source)) throw Error('Sources changed after the app build. Rebuild before packaging.');
execFileSync('/usr/bin/lipo',[binary,'-verify_arch','arm64','x86_64']);
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app]);
if (readFileSync(binary).includes(Buffer.from(homedir() + '/'))) throw Error('Personal build path remains in the application');
mkdirSync('release',{recursive:true});
const output = mkdtempSync(resolve(root,'release/beta-'));
const zip = `Agent-World-${version}-mac-universal-UNNOTARIZED.zip`;
execFileSync('/usr/bin/ditto',['-c','-k','--norsrc','--noextattr','--keepParent',app,join(output,zip)]);
for (const doc of RELEASE_DOCUMENTS) copyFileSync(join(root,'docs',doc),join(output,doc));
for (const doc of RELEASE_ROOT_DOCUMENTS) copyFileSync(join(root,doc),join(output,doc));
writeFileSync(join(output,'BUILD-STATUS.json'),JSON.stringify({version,minimumMacOS,source,macArchitectures:['x86_64','arm64'],embeddedRemoteInstaller:false,protocol:2,notarized:false,serverComponentsBundled:false,publicReleaseApproved:publicBeta,channel:publicBeta?'public-beta':'test-artifact'},null,2)+'\n');
const checksummed = [zip, ...RELEASE_DOCUMENTS, ...RELEASE_ROOT_DOCUMENTS, 'BUILD-STATUS.json'];
writeFileSync(join(output,'SHA256SUMS'), checksummed.map((file) => `${createHash('sha256').update(readFileSync(join(output,file))).digest('hex')}  ${file}\n`).join(''));
console.log(output);
