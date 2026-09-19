#!/bin/sh
# Local maintainer operation. The passphrase is typed into this terminal only.
set -eu
[ "$(uname -s)" = Darwin ] || { printf '%s\n' 'macOS required.' >&2; exit 1; }
[ "$#" = 2 ] || { printf '%s\n' 'Usage: sh scripts/sign-release.sh RELEASE_DIRECTORY ENCRYPTED_PRIVATE_KEY' >&2; exit 1; }
[ -t 0 ] || { printf '%s\n' 'Run interactively in a terminal.' >&2; exit 1; }
case "$1:$2" in /*:/*) ;; *) printf '%s\n' 'Absolute paths required.' >&2; exit 1 ;; esac
task_release=$1
task_key=$2
[ -d "$task_release" ] && [ ! -L "$task_release" ] || exit 1
[ -f "$task_key" ] && [ ! -L "$task_key" ] && [ -f "$task_key.pub" ] && [ ! -L "$task_key.pub" ] || exit 1
if /usr/bin/ssh-keygen -y -P '' -f "$task_key" >/dev/null 2>&1; then
  printf '%s\n' 'An encrypted private key with a non-empty passphrase is required.' >&2; exit 1
fi
# Validate the exact files to sign before asking for the passphrase.
python3 - "$task_release" "$task_key.pub" <<'PY'
import hashlib, json, re, sys
from pathlib import Path
p, key = Path(sys.argv[1]), Path(sys.argv[2])
for f in p.iterdir():
    if f.is_symlink() or not f.is_file() or not re.fullmatch(r'[A-Za-z0-9._-]+', f.name):
        raise SystemExit('Release must contain only regular files with simple names')
for name in ('SHA256SUMS.sig', 'server-manifest.json.sig'):
    if (p/name).exists(): raise SystemExit('Refusing to replace an existing release signature')
if (p/'agent-world-release.pub').read_bytes() != key.read_bytes():
    raise SystemExit('Packaged public key differs from the signing identity')
parts = key.read_text().split()
if len(parts) < 2 or parts[0] != 'ssh-ed25519': raise SystemExit('Ed25519 public key required')
expected = 'am-labs namespaces="agent-world-release,agent-world-server" ' + ' '.join(parts[:2]) + '\n'
if (p/'allowed-signers').read_text() != expected: raise SystemExit('Unexpected trusted signers')
manifest = json.loads((p/'server-manifest.json').read_text())
if manifest.get('protocol') != 2 or manifest.get('architecture') != 'aarch64':
    raise SystemExit('Only validated ARM64 protocol 2 server packages are signed here')
for name, field in [('agent-world-collector', 'collectorSha256'), ('agent-world-reader', 'readerSha256')]:
    data = (p/name).read_bytes()
    if data[:6] != b'\x7fELF\x02\x01' or int.from_bytes(data[18:20], 'little') != 183:
        raise SystemExit('ARM64 ELF required')
    if hashlib.sha256(data).hexdigest() != manifest.get(field): raise SystemExit('Server binary hash mismatch')
PY
umask 077
task_directory=$(mktemp -d "${TMPDIR:-/tmp}/agent-world-sign.XXXXXX")
task_pid=''
cleanup() {
  if [ -n "$task_pid" ]; then kill "$task_pid" 2>/dev/null || true; wait "$task_pid" 2>/dev/null || true; fi
  rm -f "$task_directory/agent.sock"
  rmdir "$task_directory"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
/usr/bin/ssh-agent -D -a "$task_directory/agent.sock" >/dev/null 2>&1 &
task_pid=$!
task_count=0
while [ ! -S "$task_directory/agent.sock" ]; do
  task_count=$((task_count+1)); [ "$task_count" -lt 30 ] || exit 1; sleep 0.1
done
SSH_AUTH_SOCK="$task_directory/agent.sock"
export SSH_AUTH_SOCK
printf '%s\n' 'Enter the release-key passphrase here. The isolated signing agent stops at the end.'
/usr/bin/ssh-add -t 300 "$task_key"
/usr/bin/ssh-keygen -Y sign -U -f "$task_key.pub" -n agent-world-server "$task_release/server-manifest.json"
/usr/bin/ssh-keygen -Y verify -f "$task_release/allowed-signers" -I am-labs -n agent-world-server -s "$task_release/server-manifest.json.sig" < "$task_release/server-manifest.json"
python3 - "$task_release" <<'PY'
import hashlib, sys
from pathlib import Path
p = Path(sys.argv[1])
files = sorted(f for f in p.iterdir() if f.name not in ('SHA256SUMS', 'SHA256SUMS.sig'))
if any(f.is_symlink() or not f.is_file() for f in files): raise SystemExit('Unexpected release file')
(p/'SHA256SUMS').write_text(''.join(hashlib.sha256(f.read_bytes()).hexdigest()+'  '+f.name+'\n' for f in files))
PY
/usr/bin/ssh-keygen -Y sign -U -f "$task_key.pub" -n agent-world-release "$task_release/SHA256SUMS"
/usr/bin/ssh-keygen -Y verify -f "$task_release/allowed-signers" -I am-labs -n agent-world-release -s "$task_release/SHA256SUMS.sig" < "$task_release/SHA256SUMS"
(cd "$task_release" && /usr/bin/shasum -a 256 -c SHA256SUMS)
printf '%s\n' 'Release signed and verified. No publication performed. Signing agent stopped on exit.'
