import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, mkdirSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const template = readFileSync(new URL('../src-tauri/src/remote_install.sh', import.meta.url),'utf8');
const payload = Buffer.from('#!/bin/sh\nprintf "agent-world-collector 0.1.0 protocol=1\\n"\n');
function run(root, bytes = payload, hash = createHash('sha256').update(payload).digest('hex')) {
  // Exercise the shipped script in an isolated fixture. Never repurpose HOME.
  // OS/user probes and the Mac SHA tool are substituted only in this test harness.
  const shim = 'uname() { printf "Linux\\n"; }; id() { printf "1000\\n"; }; sha256sum() { shasum -a 256 "$@"; };\n';
  const script = template.replaceAll('${HOME:?}',root).replaceAll('$HOME',root).replaceAll('__SHA256__',hash).replaceAll('__VERSION__','0.1.0');
  return spawnSync('/bin/sh',['-c',shim+script],{input:bytes,timeout:5000});
}
test('installs atomically, preserves previous binary, and leaves no lock on success', () => {
  const root = mkdtempSync(join(tmpdir(),'agent-world-install-test-'));
  assert.equal(run(root).status,0);
  const directory = join(root,'.local/bin');
  assert.deepEqual(readFileSync(join(directory,'agent-world-collector')),payload);
  assert.equal(run(root).status,0);
  const backups = readdirSync(directory).filter((name) => name.startsWith('agent-world-collector.backup.'));
  assert.equal(backups.length,1); assert.deepEqual(readFileSync(join(directory,backups[0])),payload);
  assert.ok(!readdirSync(directory).includes('.agent-world-install.lock'));
});
test('corruption and a symlink target never replace the existing file', () => {
  const root = mkdtempSync(join(tmpdir(),'agent-world-install-test-'));
  assert.equal(run(root).status,0);
  assert.notEqual(run(root,Buffer.from('corrupt')).status,0);
  assert.deepEqual(readFileSync(join(root,'.local/bin/agent-world-collector')),payload);
  const linked = mkdtempSync(join(tmpdir(),'agent-world-install-test-'));
  mkdirSync(join(linked,'.local/bin'),{recursive:true});
  writeFileSync(join(linked,'protected'),'unchanged');
  symlinkSync(join(linked,'protected'),join(linked,'.local/bin/agent-world-collector'));
  assert.notEqual(run(linked).status,0);
  assert.equal(readFileSync(join(linked,'protected'),'utf8'),'unchanged');
});
