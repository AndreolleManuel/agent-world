use crate::remote_protocol::{self, MAX_RESPONSE_BYTES, Request, Response};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SshSource {
    pub host: String,
    pub user: String,
    pub port: u16,
    #[serde(default)]
    pub identity_file: Option<String>,
    #[serde(default)]
    pub root: Option<String>,
}
impl SshSource {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.host.is_empty()
            || self.host.len() > 253
            || self.host.starts_with('-')
            || !self
                .host
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b".-:".contains(&b))
            || self.user.is_empty()
            || self.user.len() > 64
            || self.user.starts_with('-')
            || !self
                .user
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
            || self.port == 0
        {
            return Err("ssh_invalid_address");
        }
        if let Some(path) = &self.identity_file
            && (!path.starts_with('/') || path.len() > 4096 || path.chars().any(char::is_control))
        {
            return Err("ssh_invalid_key_path");
        }
        if self.user != "aw-view"
            || self
                .root
                .as_deref()
                .is_some_and(|r| !r.is_empty() && r != "/export")
        {
            return Err("secure_setup_required");
        }
        if self.identity_file.is_none() {
            return Err("dedicated_key_required");
        }
        Ok(())
    }
    pub fn key(&self) -> String {
        format!(
            "ssh:{}",
            serde_json::to_string(&(&self.host, &self.user, self.port, &self.root))
                .expect("serializable source")
        )
    }
}

fn validate_identity(path: &str) -> Result<(), &'static str> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "ssh_invalid_key_path")?;
    let meta = file.metadata().map_err(|_| "ssh_invalid_key_path")?;
    if !meta.is_file()
        || meta.nlink() != 1
        || meta.uid() != unsafe { libc::geteuid() }
        || meta.mode() & 0o077 != 0
        || meta.len() > 16 * 1024
    {
        return Err("ssh_key_permissions");
    }
    let mut bytes = Vec::new();
    file.take(16 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "ssh_invalid_key_path")?;
    if !encrypted_ed25519(&bytes) {
        return Err("encrypted_key_required");
    }
    Ok(())
}

fn encrypted_ed25519(bytes: &[u8]) -> bool {
    use base64::Engine;
    let Ok(pem) = std::str::from_utf8(bytes) else {
        return false;
    };
    let Some(body) = pem
        .trim()
        .strip_prefix(concat!("-----BEGIN OPENSSH ", "PRIVATE KEY-----"))
        .and_then(|s| s.strip_suffix("-----END OPENSSH PRIVATE KEY-----"))
    else {
        return false;
    };
    let encoded: String = body.chars().filter(|c| !c.is_ascii_whitespace()).collect();
    let Ok(raw) = base64::engine::general_purpose::STANDARD.decode(encoded) else {
        return false;
    };
    let Some(mut input) = raw.strip_prefix(b"openssh-key-v1\0") else {
        return false;
    };
    fn string<'a>(input: &mut &'a [u8]) -> Option<&'a [u8]> {
        let length = u32::from_be_bytes(input.get(..4)?.try_into().ok()?) as usize;
        let value = input.get(4..4usize.checked_add(length)?)?;
        *input = input.get(4 + length..)?;
        Some(value)
    }
    let cipher = string(&mut input);
    if !matches!(cipher, Some(b"aes256-ctr" | b"aes256-gcm@openssh.com"))
        || string(&mut input) != Some(b"bcrypt".as_slice())
    {
        return false;
    }
    if string(&mut input).is_none() || input.get(..4) != Some(&[0, 0, 0, 1]) {
        return false;
    }
    input = &input[4..];
    let Some(mut public) = string(&mut input) else {
        return false;
    };
    if string(&mut public) != Some(b"ssh-ed25519".as_slice())
        || !string(&mut public).is_some_and(|s| s.len() == 32)
        || !public.is_empty()
    {
        return false;
    }
    string(&mut input).is_some_and(|s| !s.is_empty()) && input.is_empty()
}

// No client paths or commands are sent to the server. Its forced reader owns the policy.
const REMOTE_COMMAND: &str = "snapshot";
fn ssh_command(source: &SshSource) -> Result<Command, &'static str> {
    ssh_command_for(source, REMOTE_COMMAND)
}

pub(crate) fn ssh_command_for(
    source: &SshSource,
    remote_command: &str,
) -> Result<Command, &'static str> {
    source.validate()?;
    let mut command = Command::new("/usr/bin/ssh");
    command.args([
        "-F",
        "/dev/null",
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "ConnectTimeout=5",
        "-o",
        "ConnectionAttempts=1",
        "-o",
        "ServerAliveInterval=3",
        "-o",
        "ServerAliveCountMax=1",
        "-o",
        "ForwardAgent=no",
        "-o",
        "ClearAllForwardings=yes",
        "-o",
        "PermitLocalCommand=no",
        "-o",
        "ControlMaster=no",
        "-o",
        "LogLevel=ERROR",
        "-o",
        "IdentityAgent=none",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "PasswordAuthentication=no",
        "-o",
        "KbdInteractiveAuthentication=no",
        "-o",
        "AddKeysToAgent=no",
        "-p",
        &source.port.to_string(),
        "-l",
        &source.user,
    ]);
    if let Some(identity) = &source.identity_file {
        command.args(["-o", "IdentitiesOnly=yes", "-i", identity]);
    }
    #[cfg(target_os = "macos")]
    command.args(["-o", "UseKeychain=yes"]);
    command.arg(&source.host).arg(remote_command);
    command
        .env_remove("SSH_AUTH_SOCK")
        .env_remove("SSH_AGENT_PID")
        .env_remove("SSH_ASKPASS");
    command.env("SSH_ASKPASS_REQUIRE", "never");
    command.env("LC_ALL", "C");
    Ok(command)
}

fn read_pipe(
    mut pipe: impl Read + Send + 'static,
    limit: usize,
) -> mpsc::Receiver<Result<Vec<u8>, &'static str>> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = pipe
            .by_ref()
            .take((limit + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "ssh_io")
            .and(if bytes.len() > limit {
                Err("response_limit")
            } else {
                Ok(bytes)
            });
        let _ = tx.send(result);
    });
    rx
}

pub(crate) fn bounded_run(
    mut command: Command,
    input: Vec<u8>,
    timeout: Duration,
) -> Result<(Vec<u8>, Vec<u8>, bool), &'static str> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "ssh_unavailable")?;
    let stdout = read_pipe(child.stdout.take().ok_or("ssh_io")?, MAX_RESPONSE_BYTES);
    let stderr = read_pipe(child.stderr.take().ok_or("ssh_io")?, 8192);
    let mut stdin = child.stdin.take().ok_or("ssh_io")?;
    // A peer that never reads cannot block the caller's deadline.
    std::thread::spawn(move || {
        let _ = stdin.write_all(&input);
    });
    let started = Instant::now();
    let result = loop {
        if started.elapsed() >= timeout {
            break Err("ssh_timeout");
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                let remaining = timeout.saturating_sub(started.elapsed());
                let output = stdout
                    .recv_timeout(remaining)
                    .map_err(|_| "ssh_timeout")
                    .and_then(|v| v);
                let error = stderr
                    .recv_timeout(timeout.saturating_sub(started.elapsed()))
                    .map_err(|_| "ssh_timeout")
                    .and_then(|v| v);
                break output
                    .and_then(|output| error.map(|error| (output, error, status.success())));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => break Err("ssh_io"),
        }
    };
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    result
}

pub(crate) fn failure_code(stderr: &[u8]) -> &'static str {
    let text = String::from_utf8_lossy(stderr);
    if text.contains("REMOTE HOST IDENTIFICATION HAS CHANGED")
        || text.contains("Host key verification failed")
    {
        "ssh_host_untrusted"
    } else if text.contains("Permission denied") {
        "ssh_auth_failed"
    } else if text.contains("agent_world:hermes_not_found") {
        "hermes_not_found"
    } else if text.contains("agent_world:protocol_mismatch") {
        "protocol_mismatch"
    } else if text.contains("Could not resolve hostname") {
        "ssh_dns_failed"
    } else if text.contains("Connection refused") {
        "ssh_connection_refused"
    } else if text.contains("Connection timed out") || text.contains("Operation timed out") {
        "ssh_timeout"
    } else if text.contains("agent-world-collector")
        && (text.contains("No such file") || text.contains("not found"))
    {
        "collector_missing"
    } else {
        "ssh_connection_failed"
    }
}

pub fn collect(source: &SshSource) -> Result<Response, String> {
    source.validate()?;
    validate_identity(
        source
            .identity_file
            .as_deref()
            .ok_or("dedicated_key_required")?,
    )?;
    let request = serde_json::to_vec(&Request {
        protocol: remote_protocol::PROTOCOL,
    })
    .map_err(|_| "invalid_request")?;
    let (output, error, success) =
        bounded_run(ssh_command(source)?, request, Duration::from_secs(12))?;
    if !success {
        return Err(failure_code(&error).into());
    }
    let mut response = remote_protocol::parse_response(&output)?;
    remote_protocol::age_snapshot(&mut response, time::OffsetDateTime::now_utc())?;
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source() -> SshSource {
        SshSource {
            host: "example.invalid".into(),
            user: "aw-view".into(),
            port: 22,
            identity_file: Some("/tmp/agent-world-test-key".into()),
            root: None,
        }
    }
    #[test]
    fn user_data_never_enters_remote_shell_and_host_checks_are_mandatory() {
        let s = source();
        let command = ssh_command(&s).unwrap();
        let args: Vec<_> = command
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args.last().unwrap(), REMOTE_COMMAND);
        assert!(args.contains(&"StrictHostKeyChecking=yes".into()));
        assert!(!args.iter().any(|a| a.contains("quoted")));
        let mut evil = s.clone();
        evil.host = "-oProxyCommand=touch /tmp/unsafe".into();
        assert!(ssh_command(&evil).is_err());
        evil = s;
        evil.user = "user;whoami".into();
        assert!(ssh_command(&evil).is_err());
    }
    #[test]
    fn source_identity_includes_host_user_port_and_root_not_key_file() {
        let a = source();
        let mut b = a.clone();
        b.identity_file = Some("/tmp/key".into());
        assert_eq!(a.key(), b.key());
        b.host = "other.invalid".into();
        assert_ne!(a.key(), b.key());
    }
    #[test]
    fn local_process_harness_bounds_timeout_and_output_without_network() {
        let mut command = Command::new("/bin/sleep");
        command.arg("2");
        let start = Instant::now();
        assert_eq!(
            bounded_run(command, vec![], Duration::from_millis(40)).unwrap_err(),
            "ssh_timeout"
        );
        assert!(start.elapsed() < Duration::from_secs(1));
        let mut command = Command::new("/usr/bin/printf");
        command.arg("{}");
        assert_eq!(
            bounded_run(command, vec![], Duration::from_secs(1))
                .unwrap()
                .0,
            b"{}"
        );
        assert_eq!(
            failure_code(b"Host key verification failed. private hostname"),
            "ssh_host_untrusted"
        );
        assert_eq!(
            failure_code(b"Permission denied (publickey)."),
            "ssh_auth_failed"
        );
    }
}

#[cfg(test)]
mod key_tests {
    use super::*;
    #[test]
    fn only_private_encrypted_ed25519_files_are_accepted() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let key = directory.path().join("viewer");
        let mut child = Command::new("/usr/bin/ssh-keygen")
            .args(["-q", "-t", "ed25519", "-a", "1", "-f"])
            .arg(&key)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(b"synthetic-only\nsynthetic-only\n")
            .unwrap();
        assert!(child.wait().unwrap().success());
        assert!(validate_identity(key.to_str().unwrap()).is_ok());
        std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(
            validate_identity(key.to_str().unwrap()),
            Err("ssh_key_permissions")
        );
        std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o600)).unwrap();
        std::fs::hard_link(&key, directory.path().join("linked")).unwrap();
        assert!(validate_identity(key.to_str().unwrap()).is_err());
        assert!(!encrypted_ed25519(
            concat!(
                "-----BEGIN OPENSSH ",
                "PRIVATE KEY-----\ninvalid\n-----END OPENSSH PRIVATE KEY-----"
            )
            .as_bytes()
        ));
        let plain = directory.path().join("plain");
        assert!(
            Command::new("/usr/bin/ssh-keygen")
                .args(["-q", "-t", "ed25519", "-N", "", "-f"])
                .arg(&plain)
                .status()
                .unwrap()
                .success()
        );
        assert_eq!(
            validate_identity(plain.to_str().unwrap()),
            Err("encrypted_key_required")
        );
    }
}
