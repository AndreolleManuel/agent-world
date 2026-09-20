//! Isolated update channel: no Hermes state, SSH credentials, arbitrary URLs or shell.
use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::State;

const ENDPOINT: &str =
    "https://github.com/AndreolleManuel/agent-world/releases/latest/download/latest.json";
const KEY: &str = include_str!("../../docs/agent-world-updater.pub");
const MAX_MANIFEST: usize = 32 * 1024;
const MAX_ARCHIVE: usize = 256 * 1024 * 1024;
const MAX_EXPANDED: u64 = 768 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Package {
    url: String,
    sha256: String,
    size: usize,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    schema: u8,
    version: String,
    notes: String,
    platforms: std::collections::BTreeMap<String, Package>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    phase: &'static str,
    current_version: &'static str,
    version: Option<String>,
    notes: Option<String>,
    downloaded: usize,
    total: Option<usize>,
    error: Option<&'static str>,
}
impl Default for Status {
    fn default() -> Self {
        Self {
            phase: if KEY.trim().is_empty() {
                "unconfigured"
            } else {
                "idle"
            },
            current_version: env!("CARGO_PKG_VERSION"),
            version: None,
            notes: None,
            downloaded: 0,
            total: None,
            error: None,
        }
    }
}
#[derive(Default)]
struct Inner {
    status: Status,
    candidate: Option<(Manifest, Package)>,
    checked: Option<Instant>,
}
#[derive(Default)]
pub struct Updates {
    inner: Mutex<Inner>,
    busy: AtomicBool,
}
struct Permit<'a>(&'a AtomicBool);
impl Drop for Permit<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
impl Updates {
    fn begin(&self) -> Result<Permit<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "update_busy")?;
        Ok(Permit(&self.busy))
    }
    fn status(&self) -> Result<Status, String> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| "update_unavailable")?
            .status
            .clone())
    }
    fn change(&self, f: impl FnOnce(&mut Inner)) {
        if let Ok(mut inner) = self.inner.lock() {
            f(&mut inner);
        }
    }
    fn fail(&self, code: &'static str) {
        self.change(|s| {
            s.status.phase = "error";
            s.status.error = Some(code);
        });
    }
}

fn release_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && url.host_str() == Some("github.com")
        && url
            .path()
            .starts_with("/AndreolleManuel/agent-world/releases/")
        && url.query().is_none()
}
fn permitted_redirect(url: &Url) -> bool {
    release_url(url)
        || (url.scheme() == "https"
            && url.port().is_none()
            && url.username().is_empty()
            && url.password().is_none()
            && url.fragment().is_none()
            && url.host_str() == Some("release-assets.githubusercontent.com"))
}
fn client(timeout: u64) -> Result<Client, &'static str> {
    Client::builder()
        .https_only(true)
        .no_proxy()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(timeout))
        .user_agent("Agent-World-Updater")
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !permitted_redirect(attempt.url()) {
                attempt.error("update_redirect_refused")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| "update_network")
}
async fn fetch(
    client: &Client,
    url: &str,
    limit: usize,
    state: Option<&Updates>,
) -> Result<Vec<u8>, &'static str> {
    let url = Url::parse(url).map_err(|_| "update_manifest")?;
    if !release_url(&url) {
        return Err("update_manifest");
    }
    let mut response = client.get(url).send().await.map_err(|_| "update_network")?;
    if response.status().as_u16() == 404 {
        return Err("update_not_published");
    }
    if !response.status().is_success() {
        return Err("update_network");
    }
    if response
        .content_length()
        .is_some_and(|len| len > limit as u64)
    {
        return Err("update_size");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "update_network")? {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err("update_size");
        }
        bytes.extend_from_slice(&chunk);
        if let Some(state) = state {
            state.change(|s| s.status.downloaded = bytes.len());
        }
    }
    Ok(bytes)
}
fn verify_signature(data: &[u8], signature: &[u8], key: &str) -> Result<(), &'static str> {
    let decode = |value: &[u8]| -> Result<String, &'static str> {
        let value = std::str::from_utf8(value)
            .map_err(|_| "update_signature")?
            .trim();
        String::from_utf8(STANDARD.decode(value).map_err(|_| "update_signature")?)
            .map_err(|_| "update_signature")
    };
    let key = minisign_verify::PublicKey::decode(&decode(key.as_bytes())?)
        .map_err(|_| "update_signature")?;
    let signature =
        minisign_verify::Signature::decode(&decode(signature)?).map_err(|_| "update_signature")?;
    key.verify(data, &signature, false)
        .map_err(|_| "update_signature")
}
fn parse_manifest(
    bytes: &[u8],
    current: &str,
    target: &str,
) -> Result<Option<(Manifest, Package)>, &'static str> {
    if bytes.len() > MAX_MANIFEST {
        return Err("update_size");
    }
    let manifest: Manifest = serde_json::from_slice(bytes).map_err(|_| "update_manifest")?;
    let version = semver::Version::parse(&manifest.version).map_err(|_| "update_manifest")?;
    if manifest.schema != 1
        || manifest.version.len() > 64
        || !version.pre.is_empty()
        || !version.build.is_empty()
        || manifest.notes.len() > 8000
        || manifest.platforms.len() > 2
    {
        return Err("update_manifest");
    }
    let current = semver::Version::parse(current).map_err(|_| "update_manifest")?;
    if version <= current {
        return Ok(None);
    }
    let package = manifest
        .platforms
        .get(target)
        .ok_or("update_platform")?
        .clone();
    let expected = format!(
        "https://github.com/AndreolleManuel/agent-world/releases/download/v{}/Agent-World-{}-mac-universal.app.tar.gz",
        manifest.version, manifest.version
    );
    if package.url != expected
        || package.size == 0
        || package.size > MAX_ARCHIVE
        || package.sha256.len() != 64
        || !package
            .sha256
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err("update_manifest");
    }
    Ok(Some((manifest, package)))
}
fn target() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "darwin-aarch64"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "darwin-x86_64"
    } else {
        "unsupported"
    }
}

/// Read-only release preflight, shared with the maintainer CLI (never exposed over IPC).
pub fn verify_update_candidate(public_key: &Path, directory: &Path) -> Result<String, String> {
    fn bounded(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
        let file = std::fs::File::open(path).map_err(|_| "candidate_read")?;
        if !file.metadata().map_err(|_| "candidate_read")?.is_file() {
            return Err("candidate_read".into());
        }
        let mut bytes = Vec::new();
        file.take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "candidate_read")?;
        if bytes.len() > limit {
            return Err("update_size".into());
        }
        Ok(bytes)
    }
    let key = String::from_utf8(bounded(public_key, 2048)?).map_err(|_| "update_signature")?;
    let manifest = bounded(&directory.join("latest.json"), MAX_MANIFEST)?;
    let signature = bounded(&directory.join("latest.json.sig"), 2048)?;
    verify_signature(&manifest, &signature, &key)?;
    let (manifest, package) =
        parse_manifest(&manifest, "0.0.0", "darwin-aarch64")?.ok_or("update_manifest")?;
    if manifest.platforms.len() != 2
        || manifest.platforms.get("darwin-x86_64").is_none_or(|p| {
            p.url != package.url || p.size != package.size || p.sha256 != package.sha256
        })
    {
        return Err("update_platform".into());
    }
    let name = format!("Agent-World-{}-mac-universal.app.tar.gz", manifest.version);
    let bytes = bounded(&directory.join(name), package.size)?;
    if bytes.len() != package.size || format!("{:x}", Sha256::digest(&bytes)) != package.sha256 {
        return Err("update_signature".into());
    }
    Ok(manifest.version)
}

#[tauri::command]
pub fn app_update_status(state: State<'_, Updates>) -> Result<Status, String> {
    state.status()
}

#[tauri::command]
pub async fn check_app_update(state: State<'_, Updates>) -> Result<Status, String> {
    let _permit = state.begin()?;
    if KEY.trim().is_empty() {
        return state.status();
    }
    {
        let mut inner = state.inner.lock().map_err(|_| "update_unavailable")?;
        if inner
            .checked
            .is_some_and(|when| when.elapsed() < Duration::from_secs(30))
        {
            return Ok(inner.status.clone());
        }
        inner.checked = Some(Instant::now());
        inner.candidate = None;
        inner.status = Status {
            phase: "checking",
            ..Status::default()
        };
    }
    let result = async {
        let client = client(20)?;
        let bytes = fetch(&client, ENDPOINT, MAX_MANIFEST, None).await?;
        let signature = fetch(&client, &format!("{ENDPOINT}.sig"), 2048, None).await?;
        verify_signature(&bytes, &signature, KEY)?;
        parse_manifest(&bytes, env!("CARGO_PKG_VERSION"), target())
    }
    .await;
    match result {
        Ok(candidate) => state.change(|inner| {
            inner.status.phase = if candidate.is_some() {
                "available"
            } else {
                "current"
            };
            if let Some((manifest, _)) = &candidate {
                inner.status.version = Some(manifest.version.clone());
                inner.status.notes = Some(manifest.notes.clone());
            }
            inner.candidate = candidate;
        }),
        Err(code) => state.fail(code),
    }
    state.status()
}

fn bundle_for_executable(executable: &Path) -> Result<PathBuf, &'static str> {
    let root = executable
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .ok_or("update_location")?;
    if executable.file_name().is_none_or(|n| n != "pixel-ops")
        || !executable.ends_with("Contents/MacOS/pixel-ops")
        || root.extension().is_none_or(|e| e != "app")
        || root.starts_with("/Volumes")
        || root
            .components()
            .any(|p| p.as_os_str() == "AppTranslocation")
    {
        return Err("update_location");
    }
    let meta = std::fs::symlink_metadata(root).map_err(|_| "update_location")?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("update_location");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.uid() != unsafe { libc::geteuid() } {
            return Err("update_location");
        }
    }
    Ok(root.to_path_buf())
}

fn extract_archive(bytes: &[u8], destination: &Path) -> Result<(), &'static str> {
    let decoder = flate2::read::GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(decoder.take(MAX_EXPANDED + 16 * 1024 * 1024));
    let mut seen = HashSet::new();
    let mut total = 0_u64;
    for entry in archive.entries().map_err(|_| "update_archive")? {
        let mut entry = entry.map_err(|_| "update_archive")?;
        let path = entry.path().map_err(|_| "update_archive")?.into_owned();
        let parts: Vec<_> = path.components().collect();
        if parts.first() != Some(&Component::Normal("Agent World.app".as_ref()))
            || parts.iter().any(|c| !matches!(c, Component::Normal(_)))
            || path.as_os_str().len() > 1024
            || seen.len() >= 10000
            || !seen.insert(path.clone())
        {
            return Err("update_archive");
        }
        let kind = entry.header().entry_type();
        if !kind.is_file() && !kind.is_dir() {
            return Err("update_archive");
        }
        total = total.checked_add(entry.size()).ok_or("update_size")?;
        if total > MAX_EXPANDED {
            return Err("update_size");
        }
        let relative: PathBuf = parts.iter().skip(1).collect();
        if relative.as_os_str().is_empty() {
            if kind.is_dir() {
                continue;
            } else {
                return Err("update_archive");
            }
        }
        let output = destination.join(relative);
        if kind.is_dir() {
            std::fs::create_dir_all(output).map_err(|_| "update_install")?;
        } else {
            std::fs::create_dir_all(output.parent().ok_or("update_archive")?)
                .map_err(|_| "update_install")?;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&output)
                .map_err(|_| "update_archive")?;
            std::io::copy(&mut entry, &mut file).map_err(|_| "update_install")?;
            file.flush()
                .and_then(|_| file.sync_all())
                .map_err(|_| "update_install")?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let executable = entry.header().mode().map_err(|_| "update_archive")? & 0o111 != 0;
                std::fs::set_permissions(
                    &output,
                    std::fs::Permissions::from_mode(if executable { 0o755 } else { 0o644 }),
                )
                .map_err(|_| "update_install")?;
            }
        }
    }
    if !seen.contains(Path::new("Agent World.app/Contents/MacOS/pixel-ops"))
        || !seen.contains(Path::new("Agent World.app/Contents/Info.plist"))
    {
        return Err("update_archive");
    }
    Ok(())
}
fn replace_bundle(current: &Path, staged: &Path, backup: &Path) -> Result<(), &'static str> {
    // The backup is deliberately outside TempDir ownership: never delete it on failure.
    std::fs::rename(current, backup).map_err(|_| "update_install")?;
    if std::fs::rename(staged, current).is_err() {
        if std::fs::rename(backup, current).is_err() {
            return Err("update_restore");
        }
        return Err("update_install");
    }
    Ok(())
}
fn install_archive(
    bytes: &[u8],
    package: &Package,
    version: &str,
    current: &Path,
) -> Result<(), &'static str> {
    if bytes.len() != package.size || format!("{:x}", Sha256::digest(bytes)) != package.sha256 {
        return Err("update_signature");
    }
    let parent = current.parent().ok_or("update_location")?;
    // Staging and backup on the same volume ensure the final moves are renames.
    let staging = tempfile::Builder::new()
        .prefix(".agent-world-update-")
        .tempdir_in(parent)
        .map_err(|_| "update_location")?;
    let staged = staging.path().join("Agent World.app");
    std::fs::create_dir(&staged).map_err(|_| "update_install")?;
    extract_archive(bytes, &staged)?;
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        for (field, expected) in [
            ("CFBundleIdentifier", "com.amlabs.pixelops"),
            ("CFBundleShortVersionString", version),
            ("CFBundleExecutable", "pixel-ops"),
        ] {
            let result = Command::new("/usr/bin/plutil")
                .args(["-extract", field, "raw", "-o", "-"])
                .arg(staged.join("Contents/Info.plist"))
                .output()
                .map_err(|_| "update_archive")?;
            if !result.status.success()
                || String::from_utf8_lossy(&result.stdout).trim() != expected
            {
                return Err("update_archive");
            }
        }
        if !Command::new("/usr/bin/codesign")
            .args(["--verify", "--deep", "--strict"])
            .arg(&staged)
            .output()
            .map_err(|_| "update_archive")?
            .status
            .success()
        {
            return Err("update_archive");
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = version;
        return Err("update_platform");
    }
    #[cfg(target_os = "macos")]
    {
        let backup = tempfile::Builder::new()
            .prefix(".agent-world-backup-")
            .tempdir_in(parent)
            .map_err(|_| "update_install")?
            .keep();
        replace_bundle(current, &staged, &backup.join("Agent World.app"))
    }
}

#[tauri::command]
pub async fn install_app_update(
    app: tauri::AppHandle,
    state: State<'_, Updates>,
) -> Result<Status, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let _permit = state.begin()?;
    let (manifest, package) = state
        .inner
        .lock()
        .map_err(|_| "update_unavailable")?
        .candidate
        .clone()
        .ok_or("update_check_required")?;
    let executable = std::env::current_exe().map_err(|_| "update_location")?;
    let current = match bundle_for_executable(&executable) {
        Ok(path) => path,
        Err(code) => {
            state.fail(code);
            return state.status();
        }
    };
    let dialog = app.clone();
    let version = manifest.version.clone();
    let approved = tauri::async_runtime::spawn_blocking(move || dialog.dialog()
        .message(format!("Installer Agent World {version} et redémarrer l’app ?\n\nLe paquet sera vérifié avant installation. Les réglages sont conservés ; Hermes et le VPS ne seront pas modifiés."))
        .title("Agent World · Mise à jour")
        .buttons(MessageDialogButtons::OkCancel).blocking_show()).await.map_err(|_| "update_unavailable")?;
    if !approved {
        return state.status();
    }
    state.change(|s| {
        s.status.phase = "downloading";
        s.status.error = None;
        s.status.downloaded = 0;
        s.status.total = Some(package.size);
    });
    let result = async {
        let bytes = fetch(&client(300)?, &package.url, package.size, Some(&state)).await?;
        state.change(|s| s.status.phase = "installing");
        tauri::async_runtime::spawn_blocking(move || {
            install_archive(&bytes, &package, &manifest.version, &current)
        })
        .await
        .map_err(|_| "update_install")?
    }
    .await;
    match result {
        Ok(()) => {
            state.change(|s| s.status.phase = "restarting");
            app.restart();
        }
        Err(code) => state.fail(code),
    }
    state.status()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires an isolated signed fixture; see scripts/test-update-install.py"]
    fn signed_bundle_roundtrip() {
        let fixture =
            PathBuf::from(std::env::var("AGENT_WORLD_UPDATE_FIXTURE").expect("fixture directory"));
        let key_path = fixture.join("fixture.key.pub");
        assert_eq!(
            verify_update_candidate(&key_path, &fixture).unwrap(),
            "0.3.0"
        );
        let manifest = std::fs::read(fixture.join("latest.json")).unwrap();
        let signature = std::fs::read(fixture.join("latest.json.sig")).unwrap();
        let key = std::fs::read_to_string(key_path).unwrap();
        assert!(verify_signature(&manifest, &signature, &key).is_ok());
        let mut altered = manifest.clone();
        altered[0] ^= 1;
        assert_eq!(
            verify_signature(&altered, &signature, &key),
            Err("update_signature")
        );
        let (manifest, package) = parse_manifest(&manifest, "0.2.0", "darwin-aarch64")
            .unwrap()
            .unwrap();
        let bytes =
            std::fs::read(fixture.join("Agent-World-0.3.0-mac-universal.app.tar.gz")).unwrap();
        let directory = tempfile::tempdir().unwrap();
        let current = directory.path().join("Agent World.app");
        std::fs::create_dir(&current).unwrap();
        std::fs::write(current.join("old-app"), "original").unwrap();
        let mut tampered = bytes.clone();
        tampered[10] ^= 1;
        assert_eq!(
            install_archive(&tampered, &package, &manifest.version, &current),
            Err("update_signature")
        );
        assert!(current.join("old-app").is_file());
        assert_eq!(
            install_archive(&bytes, &package, "0.9.0", &current),
            Err("update_archive")
        );
        assert!(current.join("old-app").is_file());
        install_archive(&bytes, &package, &manifest.version, &current).unwrap();
        assert!(current.join("Contents/MacOS/pixel-ops").is_file());
        assert!(!current.join("old-app").exists());
        assert!(
            std::fs::read_dir(directory.path())
                .unwrap()
                .filter_map(Result::ok)
                .any(|entry| entry.path().join("Agent World.app/old-app").is_file())
        );
    }
    fn manifest(version: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"schema":1,"version":version,"notes":"Fixes","platforms":{"darwin-aarch64":{"url":format!("https://github.com/AndreolleManuel/agent-world/releases/download/v{version}/Agent-World-{version}-mac-universal.app.tar.gz"),"size":123,"sha256":"a".repeat(64)}}})).unwrap()
    }
    #[test]
    fn only_new_stable_versions() {
        for version in ["0.1.0", "0.2.0"] {
            assert!(
                parse_manifest(&manifest(version), "0.2.0", "darwin-aarch64")
                    .unwrap()
                    .is_none()
            );
        }
        assert!(
            parse_manifest(&manifest("0.3.0"), "0.2.0", "darwin-aarch64")
                .unwrap()
                .is_some()
        );
        for version in ["0.3.0-beta.1", "0.3.0+anything", "invalid"] {
            assert!(parse_manifest(&manifest(version), "0.2.0", "darwin-aarch64").is_err());
        }
    }
    #[test]
    fn manifests_reject_foreign_urls_size_platform_and_fields() {
        for (field, value) in [
            ("url", serde_json::json!("https://evil.example/x")),
            ("size", serde_json::json!(MAX_ARCHIVE + 1)),
            ("size", serde_json::json!(0)),
            ("sha256", serde_json::json!("bogus")),
        ] {
            let mut m: serde_json::Value = serde_json::from_slice(&manifest("0.3.0")).unwrap();
            m["platforms"]["darwin-aarch64"][field] = value;
            assert!(
                parse_manifest(&serde_json::to_vec(&m).unwrap(), "0.2.0", "darwin-aarch64")
                    .is_err()
            );
        }
        assert!(parse_manifest(&manifest("0.3.0"), "0.2.0", "windows").is_err());
        assert!(parse_manifest(&vec![b' '; MAX_MANIFEST + 1], "0.2.0", "darwin-aarch64").is_err());
    }
    #[test]
    fn redirects_never_reach_local_or_unrelated_hosts() {
        for bad in [
            "http://github.com/AndreolleManuel/agent-world/releases/x",
            "https://localhost/x",
            "https://127.0.0.1/x",
            "https://github.com/other/repo/releases/x",
            "https://github.com.evil.example/x",
            "https://u:p@release-assets.githubusercontent.com/x",
            "https://release-assets.githubusercontent.com:444/x",
        ] {
            assert!(!permitted_redirect(&Url::parse(bad).unwrap()));
        }
        assert!(permitted_redirect(&Url::parse(ENDPOINT).unwrap()));
        assert!(permitted_redirect(
            &Url::parse("https://release-assets.githubusercontent.com/file?token=public").unwrap()
        ));
    }
    #[test]
    fn only_one_operation_and_permit_released_on_error() {
        let state = Updates::default();
        let permit = state.begin().unwrap();
        assert!(state.begin().is_err());
        drop(permit);
        assert!(state.begin().is_ok());
    }
    #[test]
    fn failure_restores_original_bundle() {
        let dir = tempfile::tempdir().unwrap();
        let current = dir.path().join("current");
        let backup = dir.path().join("backup");
        std::fs::create_dir(&current).unwrap();
        std::fs::write(current.join("original"), "keep").unwrap();
        assert!(replace_bundle(&current, &dir.path().join("missing"), &backup).is_err());
        assert_eq!(std::fs::read(current.join("original")).unwrap(), b"keep");
        assert!(!backup.exists());
    }
    #[test]
    fn successful_replacement_retains_backup() {
        let dir = tempfile::tempdir().unwrap();
        let current = dir.path().join("current");
        let staged = dir.path().join("staged");
        let backup = dir.path().join("backup");
        std::fs::create_dir(&current).unwrap();
        std::fs::create_dir(&staged).unwrap();
        std::fs::write(current.join("old"), "old").unwrap();
        std::fs::write(staged.join("new"), "new").unwrap();
        replace_bundle(&current, &staged, &backup).unwrap();
        assert!(current.join("new").exists());
        assert!(backup.join("old").exists());
    }
    #[test]
    fn invalid_signature_and_corrupt_package_cannot_install() {
        assert!(verify_signature(b"x", b"junk", "junk").is_err());
        let p = Package {
            url: String::new(),
            size: 1,
            sha256: "a".repeat(64),
        };
        assert_eq!(
            install_archive(b"x", &p, "0.3.0", Path::new("/missing")),
            Err("update_signature")
        );
    }
    #[test]
    fn archive_refuses_links_and_wrong_roots() {
        for name in ["Other.app/Contents/link", "Agent World.app/Contents/link"] {
            let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
            let mut archive = tar::Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            header.set_size(0);
            header.set_entry_type(tar::EntryType::Symlink);
            header.set_link_name("/etc/passwd").unwrap();
            header.set_cksum();
            archive
                .append_data(&mut header, name, std::io::empty())
                .unwrap();
            let bytes = archive.into_inner().unwrap().finish().unwrap();
            assert_eq!(
                extract_archive(&bytes, tempfile::tempdir().unwrap().path()),
                Err("update_archive")
            );
        }
    }
}
