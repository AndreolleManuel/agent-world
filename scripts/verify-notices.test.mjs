import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyNoticeBundle } from './verify-notices.mjs';
const sha = (text) => createHash('sha256').update(text).digest('hex');

test('notice bundle detects missing notices, changed text, changed MPL source and unsafe paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-world-notice-check-'));
  mkdirSync(join(dir, 'mpl'));
  writeFileSync(join(dir, 'THIRD-PARTY-LICENSES.txt'), 'license');
  writeFileSync(join(dir, 'mpl/fixture.crate'), 'source');
  const manifest = { schema: 1, missing: [], noticeSha256: sha('license'), mplSources: ['fixture.crate'], entries: [{ license: 'MPL-2.0', source: 'mpl/fixture.crate', sourceSha256: sha('source') }] };
  const save = () => writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  save();
  assert.equal(verifyNoticeBundle(dir, sha('license')).entries.length, 1);
  assert.throws(() => verifyNoticeBundle(dir, sha('old review')), /changed/);
  writeFileSync(join(dir, 'mpl/fixture.crate'), 'changed');
  assert.throws(() => verifyNoticeBundle(dir), /archive changed/);
  manifest.entries[0].source = '../fixture.crate'; save();
  assert.throws(() => verifyNoticeBundle(dir), /Invalid/);
  manifest.missing.push('fixture'); save();
  assert.throws(() => verifyNoticeBundle(dir), /incomplete/);
});
