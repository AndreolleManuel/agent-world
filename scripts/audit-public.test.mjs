import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findings } from './audit-public.mjs';
test('detects credentials and personal paths without returning their values', () => {
  const key = ['-----BEGIN ', 'OPENSSH ', 'PRIVATE KEY-----'].join('');
  assert.deepEqual(findings(Buffer.from(key)), ['private-key']);
  assert.deepEqual(findings(Buffer.from('/Users/' + 'someone/secret')), ['personal-macos-path']);
  assert.deepEqual(findings(Buffer.from('/Users/vous/.ssh/key')), []);
  assert.deepEqual(findings(Buffer.from([0,1,2,3])), []);
});
