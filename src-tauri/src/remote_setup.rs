//! Dedicated SSH preflight/install. No frontend-provided command, URL or binary.
use crate::remote::{self, SshSource};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Read, path::Path, time::Duration};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_BINARY: u64 = 16 * 1024 * 1024;
const PROBE: &str = "printf 'AWP1\\n'; uname -s; uname -m; id -u; if command -v sha256sum >/dev/null 2>&1 && command -v mktemp >/dev/null 2>&1 && command -v dd >/dev/null 2>&1; then printf 'tools\\n'; else printf 'no-tools\\n'; fi; if [ -x \"$HOME/.local/bin/agent-world-collector\" ]; then printf 'present\\n'; else printf 'missing\\n'; fi";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check { pub id: &'static str, pub status: &'static str, pub code: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub app_version: &'static str,
    pub platform: &'static str,
    pub architecture: &'static str,
    pub checks: Vec<Check>,
    pub can_install: bool,
}
struct Probe { architecture: &'static str, linux: bool, root: bool, tools: bool, present: bool }
fn parse_probe(bytes: &[u8]) -> Result<Probe, &'static str> {
    if bytes.len() > 1024 { return Err("invalid_response"); }
    let text = std::str::from_utf8(bytes).map_err(|_| "invalid_response")?;
    let lines: Vec<_> = text.lines().collect();
    if lines.len() != 6 || lines[0] != "AWP1" || lines[3].parse::<u32>().is_err()
        || !["tools", "no-tools"].contains(&lines[4]) || !["present", "missing"].contains(&lines[5]) { return Err("invalid_response"); }
    Ok(Probe { linux: lines[1] == "Linux", architecture: match lines[2] { "x86_64" => "x86_64", "aarch64" | "arm64" => "aarch64", _ => "unsupported" }, root: lines[3] == "0", tools: lines[4] == "tools", present: lines[5] == "present" })
}
fn probe(source: &SshSource) -> Result<Probe, String> {
    let (out, err, ok) = remote::bounded_run(remote::ssh_command_for(source, PROBE)?, vec![], Duration::from_secs(12))?;
    if !ok { return Err(remote::failure_code(&err).into()); }
    parse_probe(&out).map_err(Into::into)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest { version: String, sha256: BTreeMap<String, String> }
fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, &'static str> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| "collector_bundle_missing")?;
    if !metadata.is_file() || metadata.len() > limit { return Err("collector_bundle_invalid"); }
    let mut bytes = Vec::new();
    std::fs::File::open(path).map_err(|_| "collector_bundle_missing")?.take(limit + 1).read_to_end(&mut bytes).map_err(|_| "collector_bundle_invalid")?;
    if bytes.len() as u64 > limit { return Err("collector_bundle_invalid"); }
    Ok(bytes)
}
fn bundled_binary(directory: &Path, architecture: &str) -> Result<(Vec<u8>, String), &'static str> {
    let name = match architecture { "x86_64" => "agent-world-collector-linux-x86_64", "aarch64" => "agent-world-collector-linux-aarch64", _ => return Err("platform_unsupported") };
    let manifest: Manifest = serde_json::from_slice(&read_bounded(&directory.join("manifest.json"), 8192)?).map_err(|_| "collector_bundle_invalid")?;
    if manifest.version != VERSION { return Err("protocol_mismatch"); }
    let expected = manifest.sha256.get(name).ok_or("collector_bundle_invalid")?;
    if expected.len() != 64 || !expected.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("collector_bundle_invalid"); }
    let bytes = read_bounded(&directory.join(name), MAX_BINARY)?;
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if &actual != expected { return Err("collector_bundle_invalid"); }
    // Reject the wrong CPU/format even if a packaging mistake had a matching hash.
    let machine = if architecture == "x86_64" { 62 } else { 183 };
    if bytes.len() < 64 || &bytes[..6] != b"\x7fELF\x02\x01" || u16::from_le_bytes([bytes[18], bytes[19]]) != machine { return Err("collector_bundle_invalid"); }
    Ok((bytes, actual))
}
fn check(id: &'static str, status: &'static str, code: impl Into<String>) -> Check { Check { id, status, code: code.into() } }

pub fn diagnose(source: &SshSource, directory: &Path) -> Diagnostic {
    let mut result = Diagnostic { app_version: VERSION, platform: "unknown", architecture: "unknown", checks: vec![], can_install: false };
    let p = match probe(source) {
        Ok(p) => { result.checks.push(check("ssh", "ok", "ssh_verified")); p }
        Err(code) => { result.checks.push(check("ssh", "error", code)); return result }
    };
    result.platform = if p.linux { "linux" } else { "unsupported" }; result.architecture = p.architecture;
    let supported = p.linux && p.architecture != "unsupported";
    result.checks.push(check("platform", if supported { "ok" } else { "error" }, if supported { "platform_supported" } else { "platform_unsupported" }));
    let bundle = bundled_binary(directory, p.architecture);
    result.checks.push(match &bundle { Ok(_) => check("bundle", "ok", "collector_bundle_ready"), Err(code) => check("bundle", "warning", *code) });
    result.can_install = supported && !p.root && p.tools && bundle.is_ok();
    result.checks.push(check("installation", if p.root || !p.tools { "warning" } else { "ok" }, if p.root { "root_not_supported" } else if !p.tools { "install_tools_missing" } else { "install_user_ready" }));
    if p.present {
        result.checks.push(check("collector", "ok", "collector_present"));
        match remote::collect(source) {
            Ok(response) => {
                let partial = response.snapshot.kanban.partial || response.snapshot.agents.iter().any(|a| a.telemetry_partial);
                result.checks.push(check("hermes", if partial { "warning" } else { "ok" }, if partial { "telemetry_partial" } else { "hermes_readable" }));
            }
            Err(code) => result.checks.push(check("hermes", "error", code)),
        }
    } else { result.checks.push(check("collector", "warning", "collector_missing")); }
    result
}

pub fn install(source: &SshSource, directory: &Path, confirmed: bool) -> Result<(), String> {
    if !confirmed { return Err("installation_confirmation_required".into()); }
    let p = probe(source)?;
    if !p.linux || p.architecture == "unsupported" { return Err("platform_unsupported".into()); }
    if p.root { return Err("root_not_supported".into()); }
    if !p.tools { return Err("install_tools_missing".into()); }
    let (bytes, hash) = bundled_binary(directory, p.architecture)?;
    // Only a verified hex digest and our build version enter this fixed script.
    let script = include_str!("remote_install.sh").replace("__SHA256__", &hash).replace("__VERSION__", VERSION);
    let command = format!("sh -c '{}'", script.replace('\'', "'\\''"));
    let (output, _error, success) = remote::bounded_run(remote::ssh_command_for(source, &command)?, bytes, Duration::from_secs(60))?;
    if !success || output != b"agent_world:installed\n" { return Err("collector_install_failed".into()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preflight_is_strict_and_does_not_export_server_strings() {
        let p = parse_probe(b"AWP1\nLinux\naarch64\n1000\ntools\nmissing\n").unwrap();
        assert_eq!(p.architecture, "aarch64"); assert!(!p.root); assert!(!p.present);
        assert!(parse_probe(b"banner SECRET\nAWP1\nLinux\nx86_64\n0\ntools\nmissing\n").is_err());
        assert!(parse_probe(b"AWP1\nLinux\nx86_64\n0\ntools\nmissing\nSECRET").is_err());
    }
    #[test]
    fn package_requires_matching_version_checksum_and_elf_cpu() {
        let directory = tempfile::tempdir().unwrap();
        assert!(bundled_binary(directory.path(), "../../key").is_err());
        let mut bytes = vec![0; 64]; bytes[..6].copy_from_slice(b"\x7fELF\x02\x01"); bytes[18] = 62;
        let name = "agent-world-collector-linux-x86_64";
        std::fs::write(directory.path().join(name), &bytes).unwrap();
        let manifest = serde_json::json!({"version":VERSION,"sha256":{name: format!("{:x}",Sha256::digest(&bytes))}});
        std::fs::write(directory.path().join("manifest.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(bundled_binary(directory.path(), "x86_64").is_ok());
        std::fs::write(directory.path().join(name), b"tampered").unwrap();
        assert!(bundled_binary(directory.path(), "x86_64").is_err());
    }
    #[test]
    fn no_install_without_explicit_confirmation() {
        let source = SshSource { host: "example.invalid".into(), user: "hermes".into(), port: 22, root: None, identity_file: None };
        assert_eq!(install(&source, Path::new("/absent"), false).unwrap_err(), "installation_confirmation_required");
    }
}
