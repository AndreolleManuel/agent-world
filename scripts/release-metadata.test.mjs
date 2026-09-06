import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { adHocEnvironment, sourceStamp, verifyDocumentLinks } from './release-metadata.mjs';

test('beta build drops Apple credentials and forces ad-hoc signing', () => {
  const result = adHocEnvironment({ PATH: '/fixture/bin', APPLE_SIGNING_IDENTITY: 'Developer ID', APPLE_PASSWORD: 'secret', APPLE_API_KEY: 'key' });
  assert.deepEqual(result, { PATH: '/fixture/bin', APPLE_SIGNING_IDENTITY: '-' });
});
test('fingerprint covers uncommitted/untracked sources but not ignored build output', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-world-provenance-'));
  execFileSync('git', ['init', '-q', root]);
  writeFileSync(join(root, '.gitignore'), 'generated/\n');
  execFileSync('git', ['add', '.gitignore'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-qm', 'fixture'], { cwd: root });
  const clean = sourceStamp(root);
  assert.equal(clean.dirty, false);
  writeFileSync(join(root, 'source.txt'), 'first');
  const first = sourceStamp(root);
  assert.equal(first.dirty, true);
  assert.notEqual(first.fingerprint, clean.fingerprint);
  writeFileSync(join(root, 'source.txt'), 'changed');
  const changed = sourceStamp(root);
  assert.notEqual(first.fingerprint, changed.fingerprint);
  mkdirSync(join(root, 'generated'));
  writeFileSync(join(root, 'generated', 'build.json'), 'metadata');
  assert.deepEqual(sourceStamp(root), changed);
});
test('all linked local documents are included in the downloadable package', () => {
  verifyDocumentLinks(process.cwd());
});
