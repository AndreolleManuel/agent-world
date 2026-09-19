mod access;
mod export;
pub mod heartbeat;
pub mod local_helper;
mod remote;
mod remote_protocol;
mod sqlite_read;
mod telemetry;
use remote::SshSource;

use heartbeat::{AgentHeartbeatDto, WorldSnapshotDto, resolve_hermes_root};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

struct AppState {
    hermes_root: Mutex<PathBuf>,
    remote: Mutex<Option<SshSource>>,
    access: access::Access,
}

#[tauri::command]
async fn read_world_snapshot(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<WorldSnapshotDto, String> {
    let permit = state.access.begin()?;
    let root = state
        .hermes_root
        .lock()
        .map_err(|_| "settings_unavailable")?
        .clone();
    let remote = state
        .remote
        .lock()
        .map_err(|_| "settings_unavailable")?
        .clone();
    let key = remote
        .as_ref()
        .map(remote_approval_key)
        .unwrap_or_else(|| root.to_string_lossy().into_owned());
    state.access.require(&key)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        if let Some(source) = remote {
            return remote::collect(&source).map(|r| r.snapshot);
        }
        local_helper::collect(&app, &root).map(|r| r.snapshot)
    })
    .await
    .map_err(|_| "collector_unavailable".to_owned())?
}

fn remote_approval_key(source: &SshSource) -> String {
    // The v2 export has no client-controlled root; normalize only after validation.
    let mut source = source.clone();
    source.root = None;
    serde_json::to_string(&source).unwrap_or_default()
}

#[derive(serde::Serialize, serde::Deserialize)]
struct SavedSource {
    root: String,
    #[serde(default)]
    remote: Option<SshSource>,
    #[serde(default)]
    profiles: BTreeMap<String, UiPreferences>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UiPreferences {
    version: u8,
    #[serde(default)]
    identity_version: u8,
    configured: bool,
    enabled_agents: Vec<String>,
    avatars: BTreeMap<String, u8>,
    #[serde(default)]
    aliases: BTreeMap<String, String>,
    #[serde(default)]
    known_agents: Vec<String>,
    #[serde(default)]
    root: String,
}

fn saved_source(directory: &std::path::Path) -> Result<Option<SavedSource>, String> {
    let path = directory.join("hermes-source.json");
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC);
    }
    let file = match options.open(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Ok(file) => file,
        _ => return Err("settings_unavailable".into()),
    };
    let metadata = file.metadata().map_err(|_| "settings_unavailable")?;
    if !metadata.is_file() {
        return Err("settings_unavailable".into());
    }
    if metadata.len() > 1024 * 1024 {
        return Err("settings_invalid".into());
    }
    let mut bytes = Vec::new();
    file.take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "settings_unavailable")?;
    if bytes.len() > 1024 * 1024 {
        return Err("settings_invalid".into());
    }
    let saved: SavedSource = serde_json::from_slice(&bytes).map_err(|_| "settings_invalid")?;
    if !saved.root.starts_with('/')
        || saved.root.len() > 4096
        || saved.profiles.len() > 128
        || saved.profiles.values().any(|p| !valid_preferences(p))
    {
        return Err("settings_invalid".into());
    }
    Ok(Some(saved))
}

fn archive_invalid_configuration(
    directory: &std::path::Path,
    confirmed: bool,
) -> Result<String, String> {
    if !confirmed {
        return Err("recovery_confirmation_required".into());
    }
    match saved_source(directory) {
        Err(code) if code == "settings_invalid" => (),
        Err(code) => return Err(code),
        Ok(_) => return Err("settings_not_invalid".into()),
    }
    let source = directory.join("hermes-source.json");
    if !std::fs::symlink_metadata(&source)
        .map_err(|_| "settings_unavailable")?
        .is_file()
    {
        return Err("settings_unavailable".into());
    }
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "settings_unavailable")?
        .as_nanos();
    let backup = format!("recovery-{}-{nonce}", std::process::id());
    let destination = directory.join(&backup);
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(&destination)
        .map_err(|_| "settings_unavailable")?;
    std::fs::rename(source, destination.join("hermes-source.json"))
        .map_err(|_| "settings_unavailable")?;
    Ok(format!("{backup}/hermes-source.json"))
}

#[tauri::command]
async fn recover_configuration(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    confirmed: bool,
) -> Result<String, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    if !confirmed {
        return Err("recovery_confirmation_required".into());
    }
    let _permit = state.access.begin()?;
    let check = app.clone();
    let approved = tauri::async_runtime::spawn_blocking(move || check.dialog().message("Archiver les préférences Agent World endommagées et recommencer la configuration ? Aucune donnée Hermes ne sera modifiée.").title("Agent World · Récupération").buttons(MessageDialogButtons::OkCancel).blocking_show()).await.map_err(|_| "settings_unavailable")?;
    if !approved {
        return Err("recovery_confirmation_required".into());
    }
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|_| "settings_unavailable")?;
    let default_root = resolve_hermes_root().map_err(|_| "settings_unavailable")?;
    let mut root = state
        .hermes_root
        .lock()
        .map_err(|_| "settings_unavailable")?;
    let mut remote = state.remote.lock().map_err(|_| "settings_unavailable")?;
    let backup = archive_invalid_configuration(&directory, confirmed)?;
    *root = default_root;
    *remote = None;
    Ok(backup)
}

#[derive(serde::Serialize)]
struct Discovery {
    root: String,
    agents: Vec<AgentHeartbeatDto>,
    preferences: Option<UiPreferences>,
    remote: Option<SshSource>,
    #[serde(rename = "sourceId")]
    source_id: String,
}

fn checked_root(path: String) -> Result<PathBuf, String> {
    if path.len() > 4096 {
        return Err("invalid_root".to_owned());
    }
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("absolute_root_required".to_owned());
    }
    path.canonicalize()
        .map_err(|_| "hermes_not_found".to_owned())
}

#[tauri::command]
async fn detect_hermes(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
    local: Option<bool>,
) -> Result<Discovery, String> {
    let permit = state.access.begin()?;
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|_| "settings_unavailable")?;
    // Surface invalid local preferences before starting any remote connection.
    saved_source(&directory)?;
    let active_remote = state
        .remote
        .lock()
        .map_err(|_| "settings_unavailable")?
        .clone();
    if path.is_none()
        && local != Some(true)
        && let Some(source) = active_remote
    {
        source.validate()?;
        let app_copy = app.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            app_copy.state::<AppState>().access.approve(
                &app_copy,
                &remote_approval_key(&source),
                &remote_consent(&source),
            )?;
            discover_remote(&directory, source)
        })
        .await
        .map_err(|_| "collector_unavailable")?;
    }
    let root = path.map(PathBuf::from).unwrap_or(
        state
            .hermes_root
            .lock()
            .map_err(|_| "settings_unavailable")?
            .clone(),
    );
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let root = root.canonicalize().map_err(|_| "hermes_not_found")?;
        app.state::<AppState>().access.approve(&app, &root.to_string_lossy(), &format!("Autoriser la consultation locale de {} ? Les noms sont conservés sur ce Mac ; les titres de tâches sont masqués. Aucun envoi réseau par le lecteur local.", root.display()))?;
        let response = local_helper::collect(&app, &root)?;
        let mut preferences = saved_source(&directory)?.and_then(|saved| saved.profiles.get(&root.to_string_lossy().into_owned()).cloned());
        if let Some(p) = preferences.as_mut().filter(|p| p.identity_version < 2) {
            let policy = export::Policy { salt: local_helper::policy_salt(&app)?, profiles: vec!["default".into()], disclose_names: true, disclose_titles: false };
            let translate = |id: &String| {
                if response.snapshot.agents.iter().any(|a| &a.agent_id == id) { id.clone() }
                else { policy.id("agent", id) }
            };
            p.enabled_agents = p.enabled_agents.iter().map(translate).collect();
            p.known_agents = p.known_agents.iter().map(translate).collect();
            p.avatars = p.avatars.iter().map(|(k,v)| (translate(k), *v)).collect();
            p.identity_version = 2;
        }
        Ok(Discovery {
            source_id: root.to_string_lossy().into_owned(),
            root: root.to_string_lossy().into_owned(),
            agents: response.snapshot.agents,
            preferences,
            remote: None,
        })
    })
    .await
    .map_err(|_| "collector_unavailable".to_owned())?
}

#[tauri::command]
async fn configure_hermes(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
    preferences: UiPreferences,
) -> Result<(), String> {
    let permit = state.access.begin()?;
    state.access.require(&path)?;
    let check_app = app.clone();
    let (root, snapshot) = tauri::async_runtime::spawn_blocking(move || {
        let root = checked_root(path)?;
        let response = local_helper::collect(&check_app, &root)?;
        Ok::<_, String>((root, response.snapshot))
    })
    .await
    .map_err(|_| "settings_unavailable")??;
    // Keep the permit through the state/config commit, not just the subprocess.
    let _permit = permit;
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|_| "settings_unavailable")?;
    // Lock before committing, so success cannot be followed by a failed state update.
    let mut current = state
        .hermes_root
        .lock()
        .map_err(|_| "settings_unavailable")?;
    let mut remote = state.remote.lock().map_err(|_| "settings_unavailable")?;
    if preferences
        .enabled_agents
        .iter()
        .any(|id| !snapshot.agents.iter().any(|a| &a.agent_id == id))
    {
        return Err("registry_changed".into());
    }
    save_configuration(&directory, &root, preferences)?;
    *current = root;
    *remote = None;
    Ok(())
}

fn save_configuration(
    directory: &std::path::Path,
    root: &std::path::Path,
    mut preferences: UiPreferences,
) -> Result<(), String> {
    preferences.root = root.to_string_lossy().into_owned();
    save_source_configuration(directory, root, None, preferences)
}

fn valid_preferences(preferences: &UiPreferences) -> bool {
    preferences.aliases.len() <= 256
        && preferences.aliases.iter().all(|(id, name)| {
            id.len() <= 256
                && name.chars().count() <= 64
                && !name.chars().any(|c| {
                    c.is_control() || matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
                })
        })
        && preferences.version == 1
        && !preferences.enabled_agents.is_empty()
        && preferences.enabled_agents.len() <= 256
        && preferences.known_agents.len() <= 256
        && preferences.avatars.len() <= 256
        && preferences.avatars.values().all(|v| *v <= 12)
        && preferences
            .enabled_agents
            .iter()
            .chain(preferences.known_agents.iter())
            .chain(preferences.avatars.keys())
            .all(|id| !id.is_empty() && id.len() <= 256)
}

fn save_source_configuration(
    directory: &std::path::Path,
    root: &std::path::Path,
    remote: Option<SshSource>,
    mut preferences: UiPreferences,
) -> Result<(), String> {
    if !valid_preferences(&preferences) {
        return Err("invalid_preferences".into());
    }
    preferences.root = remote
        .as_ref()
        .map(SshSource::key)
        .unwrap_or_else(|| root.to_string_lossy().into_owned());
    preferences.configured = true;
    preferences.identity_version = 2;
    let mut saved = saved_source(directory)?.unwrap_or(SavedSource {
        root: String::new(),
        remote: None,
        profiles: BTreeMap::new(),
    });
    if saved.profiles.values().any(|p| p.identity_version < 2) {
        let original = directory.join("hermes-source.json");
        let backup = directory.join("hermes-source.pre-v2.json");
        if !backup.exists() {
            use std::os::unix::fs::OpenOptionsExt;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&backup)
                .map_err(|_| "settings_unavailable")?;
            let bytes = std::fs::read(original).map_err(|_| "settings_unavailable")?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "settings_unavailable")?;
        }
    }
    saved.root = root.to_string_lossy().into_owned();
    saved.remote = remote;
    saved.profiles.insert(preferences.root.clone(), preferences);
    if saved.profiles.len() > 128 {
        return Err("settings_limit".into());
    }
    std::fs::create_dir_all(directory).map_err(|_| "settings_unavailable")?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "settings_unavailable")?
        .as_nanos();
    let temporary = directory.join(format!(
        "hermes-source.{}.{nonce}.pending.json",
        std::process::id()
    ));
    let bytes = serde_json::to_vec(&saved).map_err(|_| "settings_unavailable")?;
    if bytes.len() > 1024 * 1024 {
        return Err("settings_limit".into());
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|_| "settings_unavailable")?;
    let result = (|| {
        file.write_all(&bytes)?;
        file.sync_all()?;
        std::fs::rename(&temporary, directory.join("hermes-source.json"))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|_| "settings_unavailable")?;
    Ok(())
}

fn discover_remote(
    directory: &std::path::Path,
    mut source: SshSource,
) -> Result<Discovery, String> {
    let saved = saved_source(directory)?;
    let response = remote::collect(&source)?;
    source.root = Some("/export".into());
    let source_id = source.key();
    let preferences = saved.and_then(|saved| saved.profiles.get(&source_id).cloned());
    Ok(Discovery {
        root: "/export".into(),
        agents: response.snapshot.agents,
        preferences,
        remote: Some(source),
        source_id,
    })
}

fn remote_consent(source: &SshSource) -> String {
    format!(
        "Autoriser la consultation de {}@{}:{} avec la clé {} ? Ce compte doit être préparé avec le lecteur restreint Agent World. Cette app ne peut pas certifier les permissions d'un serveur inconnu.",
        source.user,
        source.host,
        source.port,
        source.identity_file.as_deref().unwrap_or("absente")
    )
}
#[tauri::command]
async fn detect_remote_hermes(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source: SshSource,
) -> Result<Discovery, String> {
    source.validate()?;
    let permit = state.access.begin()?;
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|_| "settings_unavailable")?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        app.state::<AppState>().access.approve(
            &app,
            &remote_approval_key(&source),
            &remote_consent(&source),
        )?;
        discover_remote(&directory, source)
    })
    .await
    .map_err(|_| "collector_unavailable")?
}

#[tauri::command]
fn configured_remote(state: State<'_, AppState>) -> Result<Option<SshSource>, String> {
    Ok(state
        .remote
        .lock()
        .map_err(|_| "settings_unavailable")?
        .clone())
}

#[tauri::command]
async fn configure_remote_hermes(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    mut source: SshSource,
    preferences: UiPreferences,
) -> Result<(), String> {
    source.validate()?;
    let permit = state.access.begin()?;
    state.access.require(&remote_approval_key(&source))?;
    let check = source.clone();
    let response = tauri::async_runtime::spawn_blocking(move || remote::collect(&check))
        .await
        .map_err(|_| "collector_unavailable")??;
    if preferences
        .enabled_agents
        .iter()
        .any(|id| !response.snapshot.agents.iter().any(|a| &a.agent_id == id))
    {
        return Err("registry_changed".into());
    }
    let _permit = permit;
    source.root = Some("/export".into());
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|_| "settings_unavailable")?;
    let root = state
        .hermes_root
        .lock()
        .map_err(|_| "settings_unavailable")?;
    let mut active = state.remote.lock().map_err(|_| "settings_unavailable")?;
    save_source_configuration(&directory, &root, Some(source.clone()), preferences)?;
    *active = Some(source);
    Ok(())
}

#[tauri::command]
fn open_company_site() -> Result<(), String> {
    std::process::Command::new("/usr/bin/open")
        .arg("https://amlabs.dev")
        .spawn()
        .map(|_| ())
        .map_err(|_| "browser_unavailable".to_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hermes_root = resolve_hermes_root().expect("Hermes root is unavailable");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            hermes_root: Mutex::new(hermes_root),
            remote: Mutex::new(None),
            access: access::Access::default(),
        })
        .setup(|app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("AM Labs · Agent World")
            .inner_size(1280.0, 820.0)
            .min_inner_size(960.0, 640.0)
            .on_navigation(|url| {
                (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                    || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
                    || (cfg!(debug_assertions)
                        && url.scheme() == "http"
                        && url.host_str() == Some("127.0.0.1")
                        && url.port() == Some(1420))
            })
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .build()?;
            if let Ok(directory) = app.path().app_config_dir() {
                // The configurator reports invalid settings and offers recovery.
                if let Ok(Some(saved)) = saved_source(&directory) {
                    *app.state::<AppState>().remote.lock().unwrap() = saved.remote;
                    *app.state::<AppState>().hermes_root.lock().unwrap() =
                        PathBuf::from(saved.root);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_world_snapshot,
            detect_hermes,
            configure_hermes,
            detect_remote_hermes,
            configure_remote_hermes,
            configured_remote,
            recover_configuration,
            open_company_site
        ])
        .run(tauri::generate_context!())
        .expect("Pixel Ops failed to start");
}

#[cfg(test)]
mod configuration_tests {
    use super::*;
    #[test]
    fn corrupt_preferences_require_consent_and_are_archived_without_data_loss() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hermes-source.json");
        let contents = b"{broken preferences";
        std::fs::write(&path, contents).unwrap();
        assert!(matches!(saved_source(dir.path()), Err(code) if code == "settings_invalid"));
        assert_eq!(
            archive_invalid_configuration(dir.path(), false).unwrap_err(),
            "recovery_confirmation_required"
        );
        assert_eq!(std::fs::read(&path).unwrap(), contents);
        let backup = archive_invalid_configuration(dir.path(), true).unwrap();
        assert_eq!(std::fs::read(dir.path().join(backup)).unwrap(), contents);
        assert!(saved_source(dir.path()).unwrap().is_none());
        save_configuration(
            dir.path(),
            std::path::Path::new("/fixture/hermes"),
            preferences("a"),
        )
        .unwrap();
        assert_eq!(
            archive_invalid_configuration(dir.path(), true).unwrap_err(),
            "settings_not_invalid"
        );
        assert!(saved_source(dir.path()).unwrap().is_some());
    }
    #[test]
    fn oversized_preferences_can_be_archived_without_parsing_their_contents() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hermes-source.json");
        let contents = vec![b'x'; 1024 * 1024 + 1];
        std::fs::write(&path, &contents).unwrap();
        assert!(matches!(saved_source(dir.path()), Err(code) if code == "settings_invalid"));
        let backup = archive_invalid_configuration(dir.path(), true).unwrap();
        assert_eq!(std::fs::read(dir.path().join(backup)).unwrap(), contents);
    }
    #[cfg(unix)]
    #[test]
    fn recovery_refuses_symlinks_and_never_touches_their_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("unrelated.json");
        std::fs::write(&target, b"keep").unwrap();
        std::os::unix::fs::symlink(&target, dir.path().join("hermes-source.json")).unwrap();
        assert!(matches!(saved_source(dir.path()), Err(code) if code == "settings_unavailable"));
        assert_eq!(
            archive_invalid_configuration(dir.path(), true).unwrap_err(),
            "settings_unavailable"
        );
        assert_eq!(std::fs::read(target).unwrap(), b"keep");
    }
    fn preferences(id: &str) -> UiPreferences {
        UiPreferences {
            version: 1,
            identity_version: 2,
            configured: true,
            enabled_agents: vec![id.into()],
            known_agents: vec![id.into()],
            avatars: BTreeMap::from([(id.into(), 3)]),
            aliases: BTreeMap::new(),
            root: String::new(),
        }
    }
    #[test]
    fn atomic_source_and_preferences_are_scoped_and_recoverable() {
        let dir = tempfile::tempdir().unwrap();
        save_configuration(
            dir.path(),
            std::path::Path::new("/fixture/a"),
            preferences("a"),
        )
        .unwrap();
        save_configuration(
            dir.path(),
            std::path::Path::new("/fixture/b"),
            preferences("b"),
        )
        .unwrap();
        let saved = saved_source(dir.path()).unwrap().unwrap();
        assert_eq!(saved.root, "/fixture/b");
        assert_eq!(saved.profiles["/fixture/a"].enabled_agents, ["a"]);
        assert_eq!(saved.profiles["/fixture/b"].avatars["b"], 3);
        let bytes = std::fs::read(dir.path().join("hermes-source.json")).unwrap();
        let mut invalid = preferences("invalid");
        invalid.enabled_agents.clear();
        assert!(
            save_configuration(dir.path(), std::path::Path::new("/fixture/c"), invalid).is_err()
        );
        assert_eq!(
            std::fs::read(dir.path().join("hermes-source.json")).unwrap(),
            bytes
        );
    }
    #[test]
    fn legacy_source_migrates_without_discarding_the_source() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("hermes-source.json"),
            br#"{"root":"/fixture/legacy"}"#,
        )
        .unwrap();
        assert_eq!(
            saved_source(dir.path()).unwrap().unwrap().root,
            "/fixture/legacy"
        );
        save_configuration(
            dir.path(),
            std::path::Path::new("/fixture/legacy"),
            preferences("a"),
        )
        .unwrap();
        assert!(
            saved_source(dir.path())
                .unwrap()
                .unwrap()
                .profiles
                .contains_key("/fixture/legacy")
        );
    }
    #[test]
    fn remote_preferences_do_not_overwrite_local_or_other_servers() {
        let dir = tempfile::tempdir().unwrap();
        let local = std::path::Path::new("/fixture/local");
        save_configuration(dir.path(), local, preferences("local-agent")).unwrap();
        let a = SshSource {
            host: "a.invalid".into(),
            user: "hermes".into(),
            port: 22,
            root: Some("/home/hermes/.hermes".into()),
            identity_file: None,
        };
        let mut b = a.clone();
        b.host = "b.invalid".into();
        save_source_configuration(dir.path(), local, Some(a.clone()), preferences("remote-a"))
            .unwrap();
        save_source_configuration(dir.path(), local, Some(b.clone()), preferences("remote-b"))
            .unwrap();
        let saved = saved_source(dir.path()).unwrap().unwrap();
        assert_eq!(saved.remote, Some(b.clone()));
        assert_eq!(saved.root, "/fixture/local");
        assert_eq!(saved.profiles[&a.key()].enabled_agents, ["remote-a"]);
        assert_eq!(saved.profiles[&b.key()].enabled_agents, ["remote-b"]);
        save_configuration(dir.path(), local, preferences("local-agent")).unwrap();
        assert!(saved_source(dir.path()).unwrap().unwrap().remote.is_none());
    }
}
