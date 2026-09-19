//! Local extraction runs in a short-lived OS sandbox, with no network or writes.
use crate::{
    export::{self, Policy},
    heartbeat, remote,
    remote_protocol::{self, Response},
};
use std::{
    io::{Read, Write},
    path::Path,
    process::Command,
    time::Duration,
};
use tauri::Manager;

pub fn policy_salt(app: &tauri::AppHandle) -> Result<String, String> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|_| "settings_unavailable")?;
    std::fs::create_dir_all(&directory).map_err(|_| "settings_unavailable")?;
    let meta = std::fs::symlink_metadata(&directory).map_err(|_| "settings_unavailable")?;
    if !meta.is_dir() || meta.uid() != unsafe { libc::geteuid() } {
        return Err("settings_invalid".into());
    }
    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
        .map_err(|_| "settings_unavailable")?;
    let path = directory.join("export-identity.v2");
    let mut options = std::fs::OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    match options.open(&path) {
        Ok(file) => {
            let meta = file.metadata().map_err(|_| "settings_unavailable")?;
            if meta.nlink() != 1
                || meta.uid() != unsafe { libc::geteuid() }
                || meta.mode() & 0o077 != 0
            {
                return Err("settings_invalid".into());
            }
            if !file
                .metadata()
                .map_err(|_| "settings_unavailable")?
                .is_file()
            {
                return Err("settings_invalid".into());
            }
            let mut s = String::new();
            file.take(65)
                .read_to_string(&mut s)
                .map_err(|_| "settings_unavailable")?;
            if s.len() != 64 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err("settings_invalid".into());
            }
            Ok(s)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let mut random = [0u8; 32];
            std::fs::File::open("/dev/urandom")
                .and_then(|mut f| f.read_exact(&mut random))
                .map_err(|_| "settings_unavailable")?;
            let s: String = random.iter().map(|b| format!("{b:02x}")).collect();
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(path)
                .map_err(|_| "settings_unavailable")?;
            file.write_all(s.as_bytes())
                .and_then(|_| file.sync_all())
                .map_err(|_| "settings_unavailable")?;
            Ok(s)
        }
        Err(_) => Err("settings_unavailable".into()),
    }
}

fn quoted(path: &str) -> Result<String, &'static str> {
    if path.len() > 4096 || !path.starts_with('/') || path.chars().any(char::is_control) {
        return Err("invalid_root");
    }
    Ok(format!(
        "\"{}\"",
        path.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

pub fn sandbox_profile(root: &Path, executable: &Path) -> Result<String, &'static str> {
    let ancestors = root
        .ancestors()
        .map(|p| quoted(p.to_str().ok_or("invalid_root")?).map(|q| format!("(literal {q})")))
        .collect::<Result<Vec<_>, _>>()?
        .join(" ");
    let root = quoted(root.to_str().ok_or("invalid_root")?)?;
    let executable = quoted(executable.to_str().ok_or("invalid_root")?)?;
    // Source files remain read-only. SQLite cannot create/update WAL auxiliaries.
    // The extractor is trusted to query metadata; it cannot read unrelated homes or network.
    Ok(format!(
        r#"(version 1)
(deny default)
(allow process-exec (literal {executable}))
(allow process-info* (target self))
(allow sysctl-read)
(allow file-read* (subpath "/System/Library") (subpath "/usr/lib") (literal "/dev/urandom") (literal {executable}))
(allow file-read-metadata (subpath {root}) {ancestors} (literal "/dev/null"))
(allow file-read-data (require-all (vnode-type DIRECTORY) (require-any (subpath {root}) {ancestors})))
(allow file-read-data
  (regex (string-append "^" (regex-quote {root}) "(/profiles/[-_a-z0-9]+)?/(profile[.]yaml|state/gateway[.]heartbeat|(state/)?state[.]db(-wal|-shm)?)$"))
  (regex (string-append "^" (regex-quote {root}) "/(kanban[.]db|kanban/(current|boards/[-_a-z0-9]+)/kanban[.]db)(-wal|-shm)?$")))
(allow file-write-data (literal "/dev/null"))
"#
    ))
}

pub fn collect(app: &tauri::AppHandle, root: &Path) -> Result<Response, String> {
    let salt = policy_salt(app)?;
    collect_with(
        root,
        &salt,
        &std::env::current_exe().map_err(|_| "collector_unavailable")?,
    )
}

pub fn collect_with(root: &Path, salt: &str, executable: &Path) -> Result<Response, String> {
    if !cfg!(target_os = "macos") {
        return Err("local_sandbox_unsupported".into());
    }
    let profile = sandbox_profile(root, executable)?;
    let mut command = Command::new("/usr/bin/sandbox-exec");
    command
        .args(["-p", &profile])
        .arg(executable)
        .arg("--agent-world-snapshot")
        .arg(root);
    command.env_clear().env("LANG", "C");
    let (bytes, _, success) =
        remote::bounded_run(command, salt.as_bytes().to_vec(), Duration::from_secs(5))?;
    if !success {
        return Err("local_collector_unavailable".into());
    }
    let mut response = remote_protocol::parse_response(&bytes)?;
    remote_protocol::age_snapshot(&mut response, time::OffsetDateTime::now_utc())?;
    Ok(response)
}

pub fn helper_entry(args: &[String]) -> Result<(), &'static str> {
    if args.len() != 2 || args[0] != "--agent-world-snapshot" {
        return Err("invalid_request");
    }
    let mut salt = String::new();
    std::io::stdin()
        .take(65)
        .read_to_string(&mut salt)
        .map_err(|_| "invalid_request")?;
    let root = Path::new(&args[1]);
    let registry = heartbeat::discover_agent_registry(root).map_err(|_| "registry_unavailable")?;
    let policy = Policy {
        salt,
        profiles: registry.iter().map(|c| c.agent_id().to_owned()).collect(),
        disclose_names: true,
        disclose_titles: false,
    };
    policy.validate()?;
    let response = export::redact(heartbeat::read_world_snapshot(root, &registry), &policy)?;
    let bytes = serde_json::to_vec(&response).map_err(|_| "invalid_response")?;
    if bytes.len() > remote_protocol::MAX_RESPONSE_BYTES {
        return Err("response_limit");
    }
    std::io::stdout()
        .write_all(&bytes)
        .map_err(|_| "response_unavailable")
}
