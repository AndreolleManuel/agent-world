import { test } from 'node:test';
import assert from 'node:assert/strict';
import { npmDependencies, rustDependencies } from './inventory-dependencies.mjs';

test('npm inventory preserves scoped/nested names and marks missing license metadata', () => {
  const entries = npmDependencies({ packages: {
    '': { name: 'app', license: 'MIT' },
    'node_modules/@scope/example': { version: '1.2.3', license: 'MIT', resolved: 'https://user:password@example.invalid/archive' },
    'node_modules/outer/node_modules/inner': { version: '2.0.0', dev: true },
  } });
  assert.deepEqual(entries, [
    { name: '@scope/example', version: '1.2.3', license: 'MIT', development: false },
    { name: 'inner', version: '2.0.0', license: null, development: true },
  ]);
  assert.ok(!JSON.stringify(entries).includes('password'));
});

test('Rust inventory merges shared crates without exporting local paths or repository credentials', () => {
  const pkg = { name: 'shared', version: '1.0.0', license: 'MIT OR Apache-2.0', source: 'registry+https://example.invalid', manifest_path: '/private/fixture/Cargo.toml' };
  const entries = rustDependencies([
    { component: 'src-tauri', metadata: { packages: [pkg, { name: 'app', source: null }] } },
    { component: 'collector', metadata: { packages: [pkg, { ...pkg, name: 'custom', license: null, source: 'git+https://token@example.invalid/private' }] } },
  ]);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.find((p) => p.name === 'shared').components, ['collector', 'src-tauri']);
  assert.equal(entries.find((p) => p.name === 'custom').origin, 'non-registry');
  assert.equal(entries.find((p) => p.name === 'custom').license, null);
  assert.ok(!JSON.stringify(entries).includes('/private'));
  assert.ok(!JSON.stringify(entries).includes('token'));
});

test('inventories fail explicitly when package metadata is absent', () => {
  assert.throws(() => npmDependencies({}), /missing/);
  assert.throws(() => rustDependencies([{ component: 'collector', metadata: {} }]), /missing/);
});
