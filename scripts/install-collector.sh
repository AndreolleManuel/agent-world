#!/bin/sh
# Run on the machine hosting Hermes, as its normal user. No sudo or network daemon.
set -eu
if [ "${1-}" = "--help" ]; then
  printf '%s\n' 'Usage: sh scripts/install-collector.sh [--replace]' 'Requires Cargo/Rust and a C compiler. Existing binaries are preserved unless --replace is supplied.'
  exit 0
fi
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--replace" ]; }; then
  printf '%s\n' 'Unknown option. Use --help.' >&2
  exit 2
fi
case "$(uname -s)" in Linux|Darwin) ;; *) printf '%s\n' 'Linux or macOS required.' >&2; exit 1 ;; esac
if [ "$(id -u)" -eq 0 ]; then printf '%s\n' 'Run as the Hermes user, not root. No sudo is needed.' >&2; exit 1; fi
command -v cargo >/dev/null 2>&1 || { printf '%s\n' 'Install Rust/Cargo and a C compiler first; see docs/VPS.md.' >&2; exit 1; }
task_repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
task_bin_dir="${HOME:?}/.local/bin"
task_target="$task_bin_dir/agent-world-collector"
if [ -L "$task_target" ]; then printf '%s\n' 'Refusing to replace a symbolic link.' >&2; exit 1; fi
if [ -e "$task_target" ] && [ "${1-}" != "--replace" ]; then
  printf '%s\n' 'Collector already exists. Use --replace to update and keep a backup.' >&2
  exit 1
fi
cargo build --release --locked --manifest-path "$task_repo/collector/Cargo.toml" --target-dir "$task_repo/collector/target"
mkdir -p "$task_bin_dir"
task_staging=$(mktemp "$task_bin_dir/.agent-world-collector.XXXXXX")
trap 'rm -f -- "$task_staging"' EXIT HUP INT TERM
install -m 755 "$task_repo/collector/target/release/agent-world-collector" "$task_staging"
"$task_staging" --version
if [ -e "$task_target" ]; then
  task_backup=$(mktemp "$task_bin_dir/agent-world-collector.backup.XXXXXX")
  cp -p "$task_target" "$task_backup"
  printf 'Previous collector preserved: %s\n' "$task_backup"
fi
mv -f "$task_staging" "$task_target"
printf 'Installed: %s\nNo Hermes settings or databases changed. No service or listening port created.\n' "$task_target"
