#!/bin/sh
# Source-only delivery: never includes user data, Git, keys or the GUI assets.
set -eu
task_repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$task_repo/work"
task_output_dir=$(mktemp -d "$task_repo/work/collector-source.XXXXXX")
tar -czf "$task_output_dir/agent-world-collector-source.tar.gz" -C "$task_repo" \
  collector/Cargo.toml collector/Cargo.lock collector/src/main.rs collector/tests/protocol.rs \
  src-tauri/src/heartbeat.rs src-tauri/src/sqlite_read.rs src-tauri/src/remote_protocol.rs \
  scripts/install-collector.sh docs/VPS.md docs/SECURITY.md docs/BETA-MAC.md \
  docs/INSTALLATION.md docs/TEST-BETA.md docs/PRIVACY.md docs/PUBLICATION.md \
  LICENSE THIRD_PARTY_NOTICES.md docs/third-party
printf '%s\n' "$task_output_dir/agent-world-collector-source.tar.gz"
