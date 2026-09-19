#!/bin/sh
# Interactive developer setup on macOS. No connection to any server.
set -eu
[ "$(uname -s)" = Darwin ] || { printf '%s\n' 'macOS required.' >&2; exit 1; }
[ "$#" = 1 ] || { printf '%s\n' 'Usage: sh scripts/prepare-viewer-key.sh /absolute/path/to/new-agent-world-key' >&2; exit 1; }
case "$1" in /*) ;; *) printf '%s\n' 'Absolute path required.' >&2; exit 1 ;; esac
[ ! -e "$1" ] && [ ! -L "$1" ] || { printf '%s\n' 'Refusing to replace an existing key.' >&2; exit 1; }
umask 077
printf '%s\n' 'Create a dedicated key with a NON-EMPTY passphrase. Do not reuse an administrator key.'
/usr/bin/ssh-keygen -t ed25519 -a 64 -C agent-world-viewer -f "$1"
# Plaintext keys are rejected before storing anything in Keychain.
if /usr/bin/ssh-keygen -y -P '' -f "$1" >/dev/null 2>&1; then
  printf '%s\n' 'A non-empty passphrase is required. Add one with ssh-keygen -p -f PATH before continuing.' >&2
  exit 1
fi
task_directory=$(mktemp -d "${TMPDIR:-/tmp}/agent-world-key.XXXXXX")
task_pid=''
cleanup() {
  if [ -n "$task_pid" ]; then kill "$task_pid" 2>/dev/null || true; wait "$task_pid" 2>/dev/null || true; fi
  rm -f "$task_directory/agent.sock"
  rmdir "$task_directory"
}
trap cleanup EXIT HUP INT TERM
/usr/bin/ssh-agent -D -a "$task_directory/agent.sock" >/dev/null 2>&1 &
task_pid=$!
task_count=0
while [ ! -S "$task_directory/agent.sock" ]; do
  task_count=$((task_count+1)); [ "$task_count" -lt 30 ] || exit 1; sleep 0.1
done
SSH_AUTH_SOCK="$task_directory/agent.sock" /usr/bin/ssh-add --apple-use-keychain -t 60 "$1"
printf '%s\n' 'Key encrypted; passphrase registered by Apple OpenSSH in Keychain.' 'The temporary agent is stopped now. Give only the .pub file to the VPS administrator.'
