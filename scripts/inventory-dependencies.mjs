// Read-only metadata inventory. It neither selects licenses nor copies notices.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function npmDependencies(lock) {
  if (!lock.packages || typeof lock.packages !== 'object') throw Error('npm lockfile packages missing');
  return Object.entries(lock.packages).filter(([path]) => path.includes('node_modules/')).map(([path, entry]) => ({
    name: entry.name ?? path.split('node_modules/').at(-1),
    version: entry.version ?? 'unknown',
    license: typeof entry.license === 'string' ? entry.license : null,
    development: entry.dev === true,
  })).sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
}

export function rustDependencies(inputs) {
  const packages = new Map();
  for (const { component, metadata } of inputs) {
    if (!Array.isArray(metadata.packages)) throw Error('Cargo metadata packages missing');
    for (const entry of metadata.packages) {
      if (!entry.source) continue; // The project's own crates are not third parties.
      const origin = entry.source.startsWith('registry+') ? 'registry' : 'non-registry';
      const key = JSON.stringify([entry.name, entry.version, origin, entry.license ?? null]);
      const item = packages.get(key) ?? { name: entry.name, version: entry.version, license: entry.license ?? null, origin, components: [] };
      if (!item.components.includes(component)) item.components.push(component);
      item.components.sort();
      packages.set(key, item);
    }
  }
  return [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
}

export function inventory(root, cargo = 'cargo') {
  const npm = npmDependencies(JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8')));
  const rust = rustDependencies(['src-tauri', 'collector'].map((component) => ({
    component,
    metadata: JSON.parse(execFileSync(cargo, ['metadata', '--locked', '--offline', '--format-version', '1', '--manifest-path', `${component}/Cargo.toml`], { cwd: root, maxBuffer: 16 * 1024 * 1024 })),
  })));
  return {
    schema: 1,
    limitation: 'Declared license metadata only, including development/build dependencies and other targets. Not a bundled-code inventory, complete notices, or a legal review. No local paths or credentials are exported.',
    noticesReviewed: false,
    npm,
    rust,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = inventory(root);
  if (process.argv.includes('--check')) {
    const saved = JSON.parse(readFileSync(resolve(root, 'docs/dependency-licenses.json'), 'utf8'));
    if (JSON.stringify(saved) !== JSON.stringify(result)) throw Error('Dependency inventory changed; regenerate and review the notices before publication');
    console.log(`Dependency inventory matches: ${result.npm.length} npm entries, ${result.rust.length} Rust packages. Notices are not certified by this check.`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}
