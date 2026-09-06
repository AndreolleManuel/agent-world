#!/bin/sh
set -eu
case "${AGENT_WORLD_LINUX_ARCH-}" in
  x86_64) task_triple=x86_64-linux-musl ;;
  aarch64) task_triple=aarch64-linux-musl ;;
  *) printf '%s\n' 'Unsupported Linux architecture' >&2; exit 1 ;;
esac
# cc-rs adds a Rust/LLVM triple with an "unknown" vendor; Zig uses its own
# three-part triple. Keep every other argument verbatim, without eval.
for task_argument do
  shift
  case "$task_argument" in
    --target=*) ;;
    *) set -- "$@" "$task_argument" ;;
  esac
done
exec "${AGENT_WORLD_ZIG:?Set the path to a verified Zig compiler}" cc -target "$task_triple" "$@"
