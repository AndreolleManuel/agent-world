import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { licenseDocuments, pinnedRepository, cargoChecksums, verifyCrate, releasePackages } from './build-notices.mjs';

test('release notices include normal and build graph, not dev-only or unselected platforms', () => {
  const metadata = { packages: ['root', 'runtime', 'build', 'transitive', 'dev', 'other'].map((id) => ({ id, source: id === 'root' ? null : 'registry' })), resolve: { root: 'root', nodes: [
    { id: 'root', deps: [{ pkg: 'runtime', dep_kinds: [{ kind: null }] }, { pkg: 'build', dep_kinds: [{ kind: 'build' }] }, { pkg: 'dev', dep_kinds: [{ kind: 'dev' }] }] },
    { id: 'runtime', deps: [{ pkg: 'transitive', dep_kinds: [{ kind: null }] }] },
  ] } };
  assert.deepEqual(releasePackages(metadata).map((p) => p.id), ['runtime', 'build', 'transitive']);
});

test('notice discovery includes full license texts without following symlinks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-world-licenses-'));
  writeFileSync(join(dir, 'LICENSE-MIT'), 'fixture permission');
  mkdirSync(join(dir, 'LICENSES'));
  writeFileSync(join(dir, 'LICENSES', 'Unicode.txt'), 'fixture unicode');
  symlinkSync(join(dir, 'LICENSE-MIT'), join(dir, 'LICENSE-link'));
  assert.deepEqual(licenseDocuments(dir).map((d) => d.label), ['LICENSE-MIT', 'LICENSES/Unicode.txt']);
});
test('upstream fallback is restricted to commit-pinned GitHub repositories', () => {
  const commit = 'a'.repeat(40);
  assert.equal(pinnedRepository('https://github.com/owner/repo.git', commit), `https://raw.githubusercontent.com/owner/repo/${commit}`);
  assert.equal(pinnedRepository('https://token@github.com/owner/repo', commit), null);
  assert.equal(pinnedRepository('https://example.invalid/owner/repo', commit), null);
  assert.equal(pinnedRepository('https://github.com/owner/repo', 'main'), null);
});
test('redistributed source archive must match the pinned Cargo checksum', () => {
  const bytes = Buffer.from('fixture source archive');
  const sum = createHash('sha256').update(bytes).digest('hex');
  const entries = cargoChecksums(`[[package]]\nname = "fixture"\nversion = "1.2.3"\nchecksum = "${sum}"\n`);
  verifyCrate(bytes, entries.get('fixture@1.2.3'));
  assert.throws(() => verifyCrate(Buffer.from('changed'), sum), /mismatch/);
});
