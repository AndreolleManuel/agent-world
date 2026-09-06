// Read-only local preflight: never exports keys or contacts Apple.
import { execFileSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function signingChecks(env, identities, readableFile, platform = process.platform) {
  const checks = [];
  const add = (id, ok) => checks.push({ id, ok });
  add('macos-required', platform === 'darwin');
  const names = [...identities.matchAll(/^\s*\d+\)\s+[A-Fa-f0-9]{40}\s+"([^"]+)"\s*$/gm)].map((match) => match[1]);
  add('developer-id-installed', names.some((name) => name.startsWith('Developer ID Application:')));
  add('developer-id-selected', Boolean(env.APPLE_SIGNING_IDENTITY?.startsWith('Developer ID Application:') && names.includes(env.APPLE_SIGNING_IDENTITY)));
  const present = (key) => typeof env[key] === 'string' && env[key].trim().length > 0;
  const apiKeys = ['APPLE_API_ISSUER', 'APPLE_API_KEY', 'APPLE_API_KEY_PATH'];
  const idKeys = ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID'];
  const hasApi = apiKeys.some(present);
  const hasId = idKeys.some(present);
  add('one-notarization-method', hasApi !== hasId);
  add('notarization-credentials-present', hasApi ? apiKeys.every(present) : idKeys.every(present));
  if (hasApi) add('api-key-file-readable', Boolean(env.APPLE_API_KEY_PATH && isAbsolute(env.APPLE_API_KEY_PATH) && readableFile(env.APPLE_API_KEY_PATH)));
  return checks;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let identities = '';
  let keychainReadable = false;
  try {
    identities = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
    keychainReadable = true;
  } catch { /* Only report the check code, never raw keychain output. */ }
  const checks = [{ id: 'keychain-query', ok: keychainReadable }, ...signingChecks(process.env, identities, (path) => {
    try { accessSync(path, constants.R_OK); return statSync(path).isFile(); } catch { return false; }
  })];
  console.log(JSON.stringify({ configurationReady: checks.every((check) => check.ok),
    limitation: 'Local configuration only. Does not verify Apple membership, remote credentials, signing or notarization.', checks }, null, 2));
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}
