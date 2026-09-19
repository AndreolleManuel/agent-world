#!/bin/sh
# Run interactively on the maintainer's Mac. Never receives a passphrase argument.
set -eu
[ "$(uname -s)" = Darwin ] || { printf '%s\n' 'macOS required.' >&2; exit 1; }
[ "$#" = 1 ] || { printf '%s\n' 'Usage: sh scripts/prepare-release-key.sh /absolute/path/outside/repository' >&2; exit 1; }
case "$1" in /*) ;; *) printf '%s\n' 'Absolute path required.' >&2; exit 1 ;; esac
[ -t 0 ] || { printf '%s\n' 'Run in an interactive terminal; type the passphrase there.' >&2; exit 1; }
[ ! -e "$1" ] && [ ! -L "$1" ] && [ ! -e "$1.pub" ] && [ ! -L "$1.pub" ] || {
  printf '%s\n' 'Refusing to replace an existing private or public key.' >&2; exit 1;
}
task_parent=$(dirname "$1")
[ -d "$task_parent" ] && [ ! -L "$task_parent" ] || { printf '%s\n' 'Use an existing real private directory outside the repository.' >&2; exit 1; }
umask 077
printf '%s\n' 'Choose a NON-EMPTY passphrase. Enter it here only, never in a chat.' 'This key signs releases; do not authorize it on a VPS.'
/usr/bin/ssh-keygen -t ed25519 -a 100 -C 'AM Labs Agent World releases' -f "$1"
if /usr/bin/ssh-keygen -y -P '' -f "$1" >/dev/null 2>&1; then
  printf '%s\n' 'Empty passphrase refused. Protect this key with ssh-keygen -p before using it.' >&2
  exit 1
fi
/bin/chmod 600 "$1" "$1.pub"
printf '%s\n' 'Encrypted release key ready. Keep the private file and its backup outside Git.'
/usr/bin/ssh-keygen -lf "$1.pub"
