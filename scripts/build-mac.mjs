import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { adHocEnvironment, sourceStamp } from './release-metadata.mjs';
import { updaterKey } from './update-metadata.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flags = [...(process.env.CARGO_ENCODED_RUSTFLAGS?.split('\x1f') ?? []),
  `--remap-path-prefix=${homedir()}=/build-user`, `--remap-path-prefix=${root}=/agent-world`, '-C', 'strip=symbols'];
const args = process.argv.slice(2);
const testBuild = args.includes('--test-build');
{
  const config = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json')));
  const version = JSON.parse(readFileSync(resolve(root, 'package.json'))).version;
  if (config.version !== version) throw Error('App and package versions must match');
  mkdirSync(resolve(root, 'src-tauri/resources'), { recursive: true });
  const key = readFileSync(resolve(root, 'docs/agent-world-updater.pub'), 'utf8');
  const updaterKeySha256 = testBuild && !key.trim() ? null : updaterKey(key);
  writeFileSync(resolve(root, 'src-tauri/resources/build-info.json'), JSON.stringify({ version, minimumMacOS: config.bundle.macOS.minimumSystemVersion, updaterKeySha256, source: sourceStamp(root) }, null, 2) + '\n');
}
execFileSync(resolve(root,'node_modules/.bin/tauri'), ['build','--target','universal-apple-darwin',
  '--config','src-tauri/tauri.beta.conf.json', ...args.filter((arg) => !['--with-collectors', '--test-build'].includes(arg))],
  {cwd:root,stdio:'inherit',env:{...adHocEnvironment(process.env),CARGO_ENCODED_RUSTFLAGS:flags.join('\x1f')}});
