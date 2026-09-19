import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('legacy installer cannot deploy a general-account SSH collector', () => {
  const result = spawnSync('/bin/sh', ['scripts/install-collector.sh'], {encoding:'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /protocol 2 requires/);
});
test('administrative installer documents its dry-run and requires explicit apply', () => {
  const result = spawnSync('python3', ['scripts/install-secure-vps.py', '--help'], {encoding:'utf8'});
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--apply/);
  assert.match(result.stdout, /validate and print/);
});
