import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicSource } from './prepare-public-source.mjs';

test('public snapshot keeps source/build inputs and community documentation', () => {
  for (const file of ['README.md', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/PRIVACY.md', 'docs/dependency-licenses.json', 'src/Startup.tsx', 'src/assets/fixture.png', 'src-tauri/tauri.beta.conf.json', 'src-tauri/src/remote_install.sh', 'src-tauri/Cargo.lock', 'collector/tests/protocol.rs', '.github/workflows/beta.yml']) assert.equal(isPublicSource(file), true, file);
});

test('public snapshot excludes private history, internal reports, builds and settings', () => {
  for (const file of ['.git/config', '.env', 'hermes-source.json', 'docs/AUDIT-FINAL-2026-09-06.md', 'docs/REMEDIATION.md', 'work/screenshot.png', 'release/beta/app.zip', 'src-tauri/resources/build-info.json', 'src-tauri/target/release/app', 'collector/target/release/collector', 'src/private.key', 'src/../.env', '../README.md', '/README.md', 'docs/../../.env', 'src\\private.ts', '.github/workflows/unknown.yml']) assert.equal(isPublicSource(file), false, file);
});
