import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateElf, prepare } from './prepare-collectors.mjs';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
function elf(machine = 62) {
  const bytes = Buffer.alloc(120); bytes.set([127,69,76,70,2,1]); bytes.writeUInt16LE(machine,18);
  bytes.writeBigUInt64LE(64n,32); bytes.writeUInt16LE(56,54); bytes.writeUInt16LE(1,56); return bytes;
}
test('rejects wrong CPU, Mach-O and dynamic interpreter', () => {
  assert.doesNotThrow(() => validateElf(elf(), 'x86_64'));
  assert.throws(() => validateElf(elf(), 'aarch64'));
  assert.throws(() => validateElf(Buffer.from('not ELF'), 'x86_64'));
  const dynamic = elf(); dynamic.writeUInt32LE(3,64); assert.throws(() => validateElf(dynamic, 'x86_64'));
});
test('creates a versioned manifest only from both verified architectures', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-world-release-test-'));
  const output = join(root,'out');
  writeFileSync(join(root,'agent-world-collector-linux-x86_64'),elf());
  assert.throws(() => prepare(root, output, '0.1.0'));
  writeFileSync(join(root,'agent-world-collector-linux-aarch64'),elf(183));
  prepare(root,output,'0.1.0');
  const manifest = JSON.parse(readFileSync(join(output,'manifest.json')));
  assert.equal(manifest.version,'0.1.0'); assert.equal(Object.keys(manifest.sha256).length,2);
  assert.match(manifest.sha256['agent-world-collector-linux-x86_64'], /^[a-f0-9]{64}$/);
});
