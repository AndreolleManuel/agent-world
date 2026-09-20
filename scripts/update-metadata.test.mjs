import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateManifest, updaterKey } from './update-metadata.mjs';
test('update manifest binds stable version, repository, architectures, size and digest', () => {
  const { manifest, name } = updateManifest('0.3.0', Buffer.from('abc'), 'Corrections');
  assert.equal(name, 'Agent-World-0.3.0-mac-universal.app.tar.gz');
  assert.equal(manifest.platforms['darwin-aarch64'].url, 'https://github.com/AndreolleManuel/agent-world/releases/download/v0.3.0/Agent-World-0.3.0-mac-universal.app.tar.gz');
  assert.equal(manifest.platforms['darwin-aarch64'].sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(manifest.platforms['darwin-aarch64'].size, 3);
  assert.deepEqual(manifest.platforms['darwin-x86_64'], manifest.platforms['darwin-aarch64']);
});
test('cannot package prereleases, path injection, empty archives or huge notes', () => {
  for (const version of ['v0.3.0', '0.3.0-rc.1', '0.3.0+meta', '../../x', '00.3.0']) assert.throws(() => updateManifest(version, Buffer.from('x'), ''));
  assert.throws(() => updateManifest('0.3.0', Buffer.alloc(0), ''));
  assert.throws(() => updateManifest('0.3.0', Buffer.from('x'), 'é'.repeat(5000)));
});
test('release builds reject absent or invalid updater keys', () => {
  for (const key of ['', 'PLACEHOLDER', 'ssh-ed25519 invalid']) assert.throws(() => updaterKey(key));
});
