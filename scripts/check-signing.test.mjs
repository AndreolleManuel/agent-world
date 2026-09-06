import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signingChecks } from './check-signing.mjs';
const name = 'Developer ID Application: Example (TEAM)';
const identities = `  1) ${'A'.repeat(40)} "${name}"\n`;
const env = { APPLE_SIGNING_IDENTITY: name, APPLE_ID: 'local-only', APPLE_PASSWORD: 'never-export-this', APPLE_TEAM_ID: 'TEAM' };
const ready = (checks) => checks.every((check) => check.ok);
test('accepts complete local Developer ID configuration without exporting values', () => {
  const checks = signingChecks(env, identities, () => false, 'darwin');
  assert.equal(ready(checks), true);
  assert.equal(JSON.stringify(checks).includes(env.APPLE_PASSWORD), false);
  assert.equal(JSON.stringify(checks).includes(name), false);
});
test('rejects development, revoked, absent or ad-hoc identities and non-Mac', () => {
  for (const identity of ['-', 'Apple Development: Example', 'Developer ID Application: Other']) {
    assert.equal(ready(signingChecks({ ...env, APPLE_SIGNING_IDENTITY: identity }, identities, () => true, 'darwin')), false);
  }
  assert.equal(ready(signingChecks(env, identities.trimEnd() + ' (CSSMERR_TP_CERT_REVOKED)', () => true, 'darwin')), false);
  assert.equal(ready(signingChecks(env, '', () => true, 'darwin')), false);
  assert.equal(ready(signingChecks(env, identities, () => true, 'linux')), false);
});
test('requires exactly one complete method and a readable absolute API key file', () => {
  const api = { APPLE_SIGNING_IDENTITY: name, APPLE_API_ISSUER: 'issuer', APPLE_API_KEY: 'key-id', APPLE_API_KEY_PATH: '/private/example.p8' };
  assert.equal(ready(signingChecks(api, identities, () => true, 'darwin')), true);
  for (const config of [{ ...env, ...api }, { ...env, APPLE_PASSWORD: '' }, { ...api, APPLE_API_KEY_PATH: 'relative.p8' }, {}]) {
    assert.equal(ready(signingChecks(config, identities, () => true, 'darwin')), false);
  }
  assert.equal(ready(signingChecks(api, identities, () => false, 'darwin')), false);
});
