// Optional local cross-build. Compilation is not Linux runtime validation.
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const zig = process.argv[2];
if (!zig || !zig.startsWith('/')) throw Error('Pass an absolute path to a verified Zig compiler');
const temporary = mkdtempSync(join(tmpdir(),'agent-world-cross-build-'));
const wrapper = join(temporary,'zig-cc');
copyFileSync(join(root,'scripts/zig-cc.sh'),wrapper); chmodSync(wrapper,0o700);
const cargo = process.env.AGENT_WORLD_CARGO || 'cargo';
const rustc = cargo === 'cargo' ? 'rustc' : join(dirname(cargo),'rustc');
const sysroot = execFileSync(rustc,['--print','sysroot'],{encoding:'utf8'}).trim();
const host = execFileSync(rustc,['-vV'],{encoding:'utf8'}).match(/^host: (.+)$/m)?.[1];
if (!host) throw Error('Cannot identify Rust host toolchain');
const linker = join(sysroot,'lib/rustlib',host,'bin/rust-lld');
mkdirSync(join(root,'release/collectors'),{recursive:true});
for (const arch of ['x86_64','aarch64']) {
  const target = `${arch}-unknown-linux-musl`;
  const env = {...process.env, AGENT_WORLD_ZIG:zig, AGENT_WORLD_LINUX_ARCH:arch,
    ZIG_GLOBAL_CACHE_DIR:join(temporary,'zig-global'), ZIG_LOCAL_CACHE_DIR:join(temporary,'zig-local'),
    [`CC_${target.replaceAll('-','_')}`]:wrapper,
    [`CARGO_TARGET_${target.toUpperCase().replaceAll('-','_')}_LINKER`]:linker,
    CARGO_ENCODED_RUSTFLAGS:['-C','target-feature=+crt-static','-C','strip=symbols',`--remap-path-prefix=${homedir()}=/build-user`,`--remap-path-prefix=${root}=/agent-world`].join('\x1f'), CARGO_TARGET_DIR:join(root,'collector/target')};
  execFileSync(cargo,['build','--offline','--locked','--release','--manifest-path',join(root,'collector/Cargo.toml'),'--target',target],{env,stdio:'inherit',cwd:root});
  copyFileSync(join(root,`collector/target/${target}/release/agent-world-collector`),join(root,`release/collectors/agent-world-collector-linux-${arch}`));
  execFileSync(cargo,['build','--offline','--locked','--release','--manifest-path',join(root,'reader/Cargo.toml'),'--target',target],{env:{...env,CARGO_TARGET_DIR:join(root,'reader/target')},stdio:'inherit',cwd:root});
  copyFileSync(join(root,`reader/target/${target}/release/agent-world-reader`),join(root,`release/collectors/agent-world-reader-linux-${arch}`));
}
console.log('Both Linux architectures compiled. Run the Linux test workflow before declaring runtime compatibility.');
