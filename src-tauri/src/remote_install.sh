# Executed by the app over SSH after user confirmation. stdin is the binary.
set -eu
[ "$(uname -s)" = Linux ] && [ "$(id -u)" != 0 ] || exit 1
task_dir="${HOME:?}/.local/bin"
task_target="$task_dir/agent-world-collector"
[ ! -L "$HOME/.local" ] && [ ! -L "$task_dir" ] && [ ! -L "$task_target" ] || exit 1
[ ! -e "$task_target" ] || [ -f "$task_target" ] || exit 1
mkdir -p "$task_dir"
# Serialize installers without touching Hermes or trusting a predictable temp file.
task_lock="$task_dir/.agent-world-install.lock"
mkdir "$task_lock" || exit 1
task_stage=''
trap 'if [ -n "$task_stage" ]; then rm -f -- "$task_stage"; fi; rmdir "$task_lock"' EXIT
trap 'exit 1' HUP INT TERM
task_stage=$(mktemp "$task_dir/.agent-world-collector.XXXXXX")
dd of="$task_stage" 2>/dev/null
task_sum=$(sha256sum "$task_stage")
[ "${task_sum%% *}" = '__SHA256__' ] || exit 1
chmod 700 "$task_stage"
[ "$("$task_stage" --version)" = 'agent-world-collector __VERSION__ protocol=1' ] || exit 1
if [ -e "$task_target" ]; then
  task_backup=$(mktemp "$task_dir/agent-world-collector.backup.XXXXXX")
  cp -p "$task_target" "$task_backup"
fi
mv -f "$task_stage" "$task_target"
printf 'agent_world:installed\n'
