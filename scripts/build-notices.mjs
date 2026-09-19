// Assemble verbatim license texts and exact, checksum-verified MPL source crates.
// Upstream fallback downloads require --fetch and use commit-pinned GitHub URLs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const licenseName = /^(?:licen[cs]e|copying|copyright|notice)(?:[._-]|$)/i;

export function licenseDocuments(directory) {
  const paths = [];
  function visit(folder, prefix = '', depth = 0) {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isFile() && (licenseName.test(name) || (depth > 0 && /\.(?:txt|md)$/i.test(name)))) paths.push({ label: prefix + name, text: readFileSync(path, 'utf8') });
      if (stat.isDirectory() && depth < 2 && /^(?:licen[cs]es?|legal)$/i.test(name)) visit(path, prefix + name + '/', depth + 1);
    }
  }
  visit(directory);
  return paths;
}

export function pinnedRepository(repository, commit) {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(repository ?? '');
  if (!match || !/^[a-f0-9]{40}$/.test(commit ?? '')) return null;
  return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${commit}`;
}

export function verifyCrate(bytes, checksum) {
  if (!/^[a-f0-9]{64}$/.test(checksum ?? '') || sha(bytes) !== checksum) throw Error('MPL source archive checksum mismatch');
}

export function cargoChecksums(text) {
  const checksums = new Map();
  for (const block of text.split('[[package]]').slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    const checksum = /^checksum = "([a-f0-9]+)"/m.exec(block)?.[1];
    if (name && version && checksum) checksums.set(`${name}@${version}`, checksum);
  }
  return checksums;
}

export function releasePackages(metadata) {
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const selected = new Set();
  function visit(id) {
    if (selected.has(id)) return;
    selected.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((kind) => kind.kind !== 'dev')) visit(dep.pkg);
    }
  }
  visit(metadata.resolve.root);
  return metadata.packages.filter((p) => p.source && selected.has(p.id));
}

const targets = {
  'src-tauri': ['aarch64-apple-darwin', 'x86_64-apple-darwin'],
  collector: ['aarch64-unknown-linux-musl', 'x86_64-unknown-linux-musl'],
  reader: ['aarch64-unknown-linux-musl', 'x86_64-unknown-linux-musl'],
};

async function assemble(root, allowFetch) {
  const out = resolve(root, 'docs/third-party');
  const upstream = join(out, 'upstream');
  mkdirSync(upstream, { recursive: true });
  const records = [];
  const missing = [];
  const chunks = ['Agent World — third-party license texts\n\nThese are verbatim upstream notices, not relicensed as Agent World.\nRust entries cover normal and build dependencies for the universal macOS app\nand both static Linux exporters and readers. Development-only dependencies are excluded.\nExact unchanged MPL source crates are distributed in licenses/mpl inside the app,\nand docs/third-party/mpl in the source repository, under their original MPL terms.\n'];
  const append = (ecosystem, name, version, license, docs, extra = {}) => {
    if (!docs.length) { missing.push(`${ecosystem}:${name}@${version}`); return; }
    chunks.push(`\n========== ${ecosystem}: ${name}@${version} (${license}) ==========\n`);
    for (const doc of docs) chunks.push(`\n--- ${doc.label} ---\n${doc.text.trim()}\n`);
    records.push({ ecosystem, name, version, license, documents: docs.map((d) => ({ source: d.label, sha256: sha(d.text) })), ...extra });
  };

  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json')));
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || (entry.dev && !['node_modules/vite', 'node_modules/esbuild', 'node_modules/rollup'].includes(path))) continue;
    const directory = resolve(root, path);
    const installed = JSON.parse(readFileSync(join(directory, 'package.json')));
    if (installed.version !== entry.version) throw Error(`Installed npm version differs: ${path}`);
    let docs = licenseDocuments(directory);
    if (!docs.length && installed.name === '@pixi/colord' && entry.version === '2.9.6') {
      const cache = join(upstream, 'npm-pixi-colord-2.9.6.json');
      if (existsSync(cache)) docs = JSON.parse(readFileSync(cache));
      else if (allowFetch) {
        // npm metadata pins this release to this upstream gitHead. The npm tarball omits LICENSE.md.
        const url = 'https://raw.githubusercontent.com/omgovich/colord/5344fbf77b736f81cd33c21050021bc09bc9dd1d/LICENSE.md';
        const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
        if (!response.ok) throw Error('Cannot retrieve the pinned colord license');
        docs = [{ label: url, text: await response.text() }];
        writeFileSync(cache, JSON.stringify(docs, null, 2) + '\n');
      }
    }
    append('npm', installed.name, entry.version, entry.license, docs);
  }

  const packages = new Map();
  const checksums = new Map();
  for (const [component, platforms] of Object.entries(targets)) {
    for (const platform of platforms) {
      const metadata = JSON.parse(execFileSync(process.env.AGENT_WORLD_CARGO || 'cargo', ['metadata', '--locked', '--offline', '--format-version', '1', '--filter-platform', platform, ...(component === 'src-tauri' ? ['--features', 'tauri/custom-protocol'] : []), '--manifest-path', `${component}/Cargo.toml`], { cwd: root, maxBuffer: 16 * 1024 * 1024 }));
      for (const p of releasePackages(metadata)) packages.set(`${p.name}@${p.version}`, p);
    }
    for (const [key, value] of cargoChecksums(readFileSync(resolve(root, component, 'Cargo.lock'), 'utf8'))) checksums.set(key, value);
  }
  const fetched = new Map();
  const mpl = [];
  for (const p of [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'))) {
    const dir = dirname(p.manifest_path);
    let docs = licenseDocuments(dir);
    if (!docs.length) {
      const cache = join(upstream, `${p.name}-${p.version}.json`);
      if (existsSync(cache)) docs = JSON.parse(readFileSync(cache));
      else if (allowFetch) {
        const vcs = existsSync(join(dir, '.cargo_vcs_info.json')) ? JSON.parse(readFileSync(join(dir, '.cargo_vcs_info.json'))) : {};
        const base = pinnedRepository(p.repository, vcs.git?.sha1);
        if (base) {
          if (fetched.has(base)) docs = fetched.get(base);
          else {
            // A shared repo-root license is used only for crates declaring that license.
            for (const name of ['LICENSE.md', 'LICENSE', 'LICENSE-MIT', 'LICENSE-MIT.txt', 'LICENSE.txt', 'LICENSE-APACHE', 'LICENSE_MIT', 'LICENSE_APACHE-2.0', 'COPYING']) {
              const url = `${base}/${name}`;
              try {
                const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
                if (response.ok) {
                  const text = await response.text();
                  if (text.length > 100 && text.length < 200000 && !/<html/i.test(text)) docs.push({ label: url, text });
                }
              } catch { /* Report unresolved upstream notices instead of inventing them. */ }
            }
            if (docs.length) fetched.set(base, docs);
          }
          if (docs.length) writeFileSync(cache, JSON.stringify(docs, null, 2) + '\n');
        }
      }
    }
    const extra = {};
    if (p.license === 'MPL-2.0') {
      if (!docs.length && p.name === 'selectors' && p.version === '0.36.1') {
        // Upstream omits the full text (servo/stylo#317); supply the unmodified
        // standard MPL 2.0 text from another exact MPL crate. Attribution remains
        // in the complete, unchanged selectors source archive shipped alongside it.
        const option = packages.get('option-ext@0.2.0');
        const license = licenseDocuments(dirname(option.manifest_path)).find((doc) => doc.text.includes('Mozilla Public License Version 2.0'));
        if (!license) throw Error('Standard MPL 2.0 text missing');
        docs = [{ label: 'Standard MPL 2.0 supplement (option-ext 0.2.0 LICENSE.txt); selectors original notices retained in source archive', text: license.text }];
      }
      const name = `${p.name}-${p.version}.crate`;
      const cached = resolve(dir, '../../../cache', basename(dirname(dir)), name);
      const bytes = readFileSync(cached);
      verifyCrate(bytes, checksums.get(`${p.name}@${p.version}`));
      mkdirSync(join(out, 'mpl'), { recursive: true });
      writeFileSync(join(out, 'mpl', name), bytes);
      extra.source = `mpl/${name}`;
      extra.sourceSha256 = sha(bytes);
      mpl.push(name);
    }
    append('cargo', p.name, p.version, p.license, docs, extra);
  }
  // SQLite is built from the bundled amalgamation, not the optional SQLCipher tree.
  const sqlite = [...packages.values()].find((p) => p.name === 'libsqlite3-sys');
  const header = readFileSync(join(dirname(sqlite.manifest_path), 'sqlite3/sqlite3.c'), 'utf8').split('\n').slice(0, 40).join('\n');
  chunks.push(`\n========== SQLite bundled amalgamation — original header ==========\n${header}\n`);
  const notice = chunks.join('');
  writeFileSync(join(out, 'THIRD-PARTY-LICENSES.txt'), notice);
  const manifest = { schema: 1, targets, noticeSha256: sha(notice), missing, mplSources: mpl, entries: records };
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ noticeEntries: records.length, mplSources: mpl.length, missing, bytes: Buffer.byteLength(notice) }, null, 2));
  if (missing.length) throw Error('Some upstream notices are missing. Do not publish yet.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  await assemble(root, process.argv.includes('--fetch'));
}
