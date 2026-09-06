use std::{io::{Read, Write}, process::{Command, Stdio}, sync::mpsc, time::{Duration, Instant}};
use serde::{Deserialize, Serialize};
use crate::remote_protocol::{self, Request, Response, MAX_RESPONSE_BYTES};

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
        if self.host.is_empty() || self.host.len() > 253 || self.host.starts_with('-')
            || !self.host.bytes().all(|b| b.is_ascii_alphanumeric() || b".-:".contains(&b))
            || self.user.is_empty() || self.user.len() > 64 || self.user.starts_with('-')
            || !self.user.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b)) || self.port == 0 {
            return Err("ssh_invalid_address");
        }
        if let Some(path) = &self.identity_file {
            if !path.starts_with('/') || path.len() > 4096 || path.chars().any(char::is_control) { return Err("ssh_invalid_key_path"); }
        }
        remote_protocol::parse_request(&serde_json::to_vec(&Request { protocol: 1, root: self.root.clone() }).map_err(|_| "invalid_request")?)?;
        Ok(())
    }
    pub fn key(&self) -> String {
        format!("ssh:{}", serde_json::to_string(&(&self.host, &self.user, self.port, &self.root)).expect("serializable source"))
    }
}

// No user text appears in the remote shell command. The Hermes path is JSON on
// stdin; the collector location is fixed, under the authenticated user's home.
const REMOTE_COMMAND: &str = "exec \"$HOME/.local/bin/agent-world-collector\" --stdio";
fn ssh_command(source: &SshSource) -> Result<Command, &'static str> {
    ssh_command_for(source, REMOTE_COMMAND)
}

pub(crate) fn ssh_command_for(source: &SshSource, remote_command: &str) -> Result<Command, &'static str> {
    source.validate()?;
    let mut command = Command::new("/usr/bin/ssh");
    command.args(["-F", "/dev/null", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
        "-o", "ConnectTimeout=5", "-o", "ConnectionAttempts=1", "-o", "ServerAliveInterval=3", "-o", "ServerAliveCountMax=1",
        "-o", "ForwardAgent=no", "-o", "ClearAllForwardings=yes", "-o", "PermitLocalCommand=no", "-o", "ControlMaster=no",
        "-o", "LogLevel=ERROR", "-p", &source.port.to_string(), "-l", &source.user]);
    if let Some(identity) = &source.identity_file { command.args(["-o", "IdentitiesOnly=yes", "-i", identity]); }
    command.arg(&source.host).arg(remote_command);
    command.env("SSH_ASKPASS_REQUIRE", "never");
    command.env("LC_ALL", "C");
    Ok(command)
}

fn read_pipe(mut pipe: impl Read + Send + 'static, limit: usize) -> mpsc::Receiver<Result<Vec<u8>, &'static str>> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = pipe.by_ref().take((limit + 1) as u64).read_to_end(&mut bytes)
            .map_err(|_| "ssh_io").and_then(|_| if bytes.len() > limit { Err("response_limit") } else { Ok(bytes) });
        let _ = tx.send(result);
    });
    rx
}

pub(crate) fn bounded_run(mut command: Command, input: Vec<u8>, timeout: Duration) -> Result<(Vec<u8>, Vec<u8>, bool), &'static str> {
    let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|_| "ssh_unavailable")?;
    let stdout = read_pipe(child.stdout.take().ok_or("ssh_io")?, MAX_RESPONSE_BYTES);
    let stderr = read_pipe(child.stderr.take().ok_or("ssh_io")?, 8192);
    let mut stdin = child.stdin.take().ok_or("ssh_io")?;
    // A peer that never reads cannot block the caller's deadline.
    std::thread::spawn(move || { let _ = stdin.write_all(&input); });
    let started = Instant::now();
    let result = loop {
        if started.elapsed() >= timeout { break Err("ssh_timeout"); }
        match child.try_wait() {
            Ok(Some(status)) => {
                let remaining = timeout.saturating_sub(started.elapsed());
                let output = stdout.recv_timeout(remaining).map_err(|_| "ssh_timeout").and_then(|v| v);
                let error = stderr.recv_timeout(timeout.saturating_sub(started.elapsed())).map_err(|_| "ssh_timeout").and_then(|v| v);
                break output.and_then(|output| error.map(|error| (output, error, status.success())));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => break Err("ssh_io"),
        }
    };
    if result.is_err() { let _ = child.kill(); let _ = child.wait(); }
    result
}

pub(crate) fn failure_code(stderr: &[u8]) -> &'static str {
    let text = String::from_utf8_lossy(stderr);
    if text.contains("REMOTE HOST IDENTIFICATION HAS CHANGED") || text.contains("Host key verification failed") { "ssh_host_untrusted" }
    else if text.contains("Permission denied") { "ssh_auth_failed" }
    else if text.contains("agent_world:hermes_not_found") { "hermes_not_found" }
    else if text.contains("agent_world:protocol_mismatch") { "protocol_mismatch" }
    else if text.contains("Could not resolve hostname") { "ssh_dns_failed" }
    else if text.contains("Connection refused") { "ssh_connection_refused" }
    else if text.contains("Connection timed out") || text.contains("Operation timed out") { "ssh_timeout" }
    else if text.contains("agent-world-collector") && (text.contains("No such file") || text.contains("not found")) { "collector_missing" }
    else { "ssh_connection_failed" }
}

pub fn collect(source: &SshSource) -> Result<Response, String> {
    let started = Instant::now();
    let request = serde_json::to_vec(&Request { protocol: 1, root: source.root.clone() }).map_err(|_| "invalid_request")?;
    let (output, error, success) = bounded_run(ssh_command(source)?, request, Duration::from_secs(12))?;
    if !success { return Err(failure_code(&error).into()); }
    let mut response = remote_protocol::parse_response(&output)?;
    // Never present a replayed/clock-skewed remote snapshot as fresh telemetry.
    let collected = time::OffsetDateTime::parse(&response.snapshot.collected_at, &time::format_description::well_known::Rfc3339).map_err(|_| "invalid_response")?;
    let age = (time::OffsetDateTime::now_utc() - collected).whole_seconds();
    if !(-30..=30).contains(&age) { return Err("remote_clock_or_stale".into()); }
    let elapsed = started.elapsed().as_secs();
    for agent in &mut response.snapshot.agents {
        agent.age_seconds = agent.age_seconds.map(|age| age.saturating_add(elapsed));
        for proof in &mut agent.evidence { proof.age_seconds = proof.age_seconds.map(|age| age.saturating_add(elapsed)); }
        if let Some(session) = &mut agent.session { session.age_seconds = session.age_seconds.saturating_add(elapsed); }
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source() -> SshSource { SshSource { host: "example.invalid".into(), user: "hermes".into(), port: 22, identity_file: None, root: Some("/home/hermes/a 'quoted' path".into()) } }
    #[test]
    fn user_data_never_enters_remote_shell_and_host_checks_are_mandatory() {
        let s = source(); let command = ssh_command(&s).unwrap();
        let args: Vec<_> = command.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(args.last().unwrap(), REMOTE_COMMAND);
        assert!(args.contains(&"StrictHostKeyChecking=yes".into()));
        assert!(!args.iter().any(|a| a.contains("quoted")));
        let mut evil = s.clone(); evil.host = "-oProxyCommand=touch /tmp/unsafe".into(); assert!(ssh_command(&evil).is_err());
        evil = s; evil.user = "user;whoami".into(); assert!(ssh_command(&evil).is_err());
    }
    #[test]
    fn source_identity_includes_host_user_port_and_root_not_key_file() {
        let a = source(); let mut b = a.clone(); b.identity_file = Some("/tmp/key".into()); assert_eq!(a.key(), b.key());
        b.host = "other.invalid".into(); assert_ne!(a.key(), b.key());
    }
    #[test]
    fn local_process_harness_bounds_timeout_and_output_without_network() {
        let mut command = Command::new("/bin/sleep"); command.arg("2");
        let start = Instant::now(); assert_eq!(bounded_run(command, vec![], Duration::from_millis(40)).unwrap_err(), "ssh_timeout");
        assert!(start.elapsed() < Duration::from_secs(1));
        let mut command = Command::new("/usr/bin/printf"); command.arg("{}");
        assert_eq!(bounded_run(command, vec![], Duration::from_secs(1)).unwrap().0, b"{}");
        assert_eq!(failure_code(b"Host key verification failed. private hostname"), "ssh_host_untrusted");
        assert_eq!(failure_code(b"Permission denied (publickey)."), "ssh_auth_failed");
    }
}
