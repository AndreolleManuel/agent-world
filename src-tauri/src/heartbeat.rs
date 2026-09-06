use crate::sqlite_read::{self, QueryError};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
#[cfg(not(unix))]
use std::fs;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

const HEARTBEAT_FILE: &str = "gateway.heartbeat";
const SOURCE: &str = "gateway.heartbeat";
const CONFIDENCE: &str = "direct";
const PROFILE_FILE: &str = "profile.yaml";
const MAX_PROFILE_METADATA_BYTES: u64 = 64 * 1024;
const MAX_PROFILES: usize = 256;
const MAX_KANBAN_ROWS: usize = 512;
const MAX_KANBAN_OUTPUT_BYTES: usize = 128 * 1024;
const MAX_KANBAN_BOARDS: usize = 64;
const MAX_KANBAN_BOARD_ENTRIES: usize = 256;

#[derive(Debug, Clone)]
pub struct ReaderConfig {
    state_root: PathBuf,
    heartbeat_path: PathBuf,
    agent_id: String,
    display_name: String,
    profile: String,
    role: String,
    machine_id: String,
    origin: String,
    max_bytes: u64,
    stale_after_seconds: u64,
}

impl ReaderConfig {
    pub fn new(
        state_root: PathBuf,
        agent_id: impl Into<String>,
        profile: impl Into<String>,
        role: impl Into<String>,
        machine_id: impl Into<String>,
        origin: impl Into<String>,
    ) -> Self {
        let heartbeat_path = state_root.join(HEARTBEAT_FILE);
        let agent_id = agent_id.into();
        Self {
            state_root,
            heartbeat_path,
            display_name: agent_id.clone(),
            agent_id,
            profile: profile.into(),
            role: role.into(),
            machine_id: machine_id.into(),
            origin: origin.into(),
            max_bytes: 64 * 1024,
            stale_after_seconds: 30,
        }
    }

    pub fn with_limits(mut self, max_bytes: u64, stale_after_seconds: u64) -> Self {
        self.max_bytes = max_bytes;
        self.stale_after_seconds = stale_after_seconds;
        self
    }

    pub fn with_identity(
        mut self,
        agent_id: impl Into<String>,
        display_name: impl Into<String>,
        profile: impl Into<String>,
        role: impl Into<String>,
    ) -> Self {
        self.agent_id = agent_id.into();
        self.display_name = display_name.into();
        self.profile = profile.into();
        self.role = role.into();
        self
    }

    pub fn root(&self) -> &Path {
        &self.state_root
    }

    pub fn agent_id(&self) -> &str {
        &self.agent_id
    }

    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    pub fn profile(&self) -> &str {
        &self.profile
    }

    pub fn role(&self) -> &str {
        &self.role
    }

    /// Internal configuration hook. The desktop command never exposes a path argument.
    /// Every supplied path is still confined to the configured root at read time.
    pub fn with_heartbeat_path(mut self, heartbeat_path: PathBuf) -> Self {
        self.heartbeat_path = heartbeat_path;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ObservedState {
    Connected,
    Disconnected,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeartbeatDto {
    pub agent_id: String,
    pub profile: String,
    pub role: String,
    pub observed_state: ObservedState,
    pub last_evidence_at: String,
    pub age_seconds: u64,
    pub source: String,
    pub confidence: String,
    pub machine_id: String,
    pub origin: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentHeartbeatDto {
    pub agent_id: String,
    pub display_name: String,
    pub profile: String,
    pub role: String,
    pub observed_state: ObservedState,
    pub last_evidence_at: Option<String>,
    pub age_seconds: Option<u64>,
    pub source: String,
    pub confidence: String,
    pub machine_id: String,
    pub origin: String,
    pub activity: String,
    pub room: String,
    pub task_status: Option<String>,
    pub task_title: Option<String>,
    pub task_phase: String,
    pub board_slug: Option<String>,
    pub task_id: Option<String>,
    pub waiting_reason: Option<String>,
    pub telemetry_partial: bool,
    pub evidence: Vec<SourceEvidence>,
    pub session: Option<SessionEvidence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceEvidence {
    pub source: String,
    pub status: String,
    pub observed_at: Option<String>,
    pub age_seconds: Option<u64>,
    pub confidence: String,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionEvidence {
    pub id: String,
    pub title: String,
    pub observed_at: String,
    pub age_seconds: u64,
    pub confidence: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct KanbanTaskSnapshot {
    assignee: String,
    status: String,
    title: String,
    #[serde(default)]
    board_slug: String,
    #[serde(default)]
    task_id: String,
    #[serde(default)]
    has_live_run: i64,
    #[serde(default)]
    run_observed_at: Option<i64>,
    #[serde(default)]
    latest_run_status: Option<String>,
    #[serde(default)]
    latest_run_outcome: Option<String>,
    #[serde(default)]
    waiting_reason: Option<String>,
    #[serde(default)]
    block_kind: Option<String>,
    #[serde(default)]
    created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KanbanTaskDto {
    pub board_slug: String,
    pub task_id: String,
    pub title: String,
    pub status: String,
    pub assignee: Option<String>,
    pub waiting_reason: Option<String>,
    pub created_at: i64,
    pub run_observed_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KanbanSnapshotDto {
    pub tasks: Vec<KanbanTaskDto>,
    pub partial: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldSnapshotDto {
    pub agents: Vec<AgentHeartbeatDto>,
    pub kanban: KanbanSnapshotDto,
    pub collected_at: String,
    pub collection_ms: u64,
}

impl KanbanTaskSnapshot {
    pub fn new(assignee: &str, status: &str, title: &str) -> Self {
        Self {
            assignee: assignee.to_owned(),
            status: status.to_owned(),
            title: sanitize_task_title(title),
            board_slug: String::new(),
            task_id: String::new(),
            has_live_run: 0,
            run_observed_at: None,
            latest_run_status: None,
            latest_run_outcome: None,
            waiting_reason: None,
            block_kind: None,
            created_at: 0,
        }
    }

    pub fn with_runtime(
        mut self,
        board_slug: &str,
        task_id: &str,
        has_live_run: bool,
        latest_run_status: Option<&str>,
        latest_run_outcome: Option<&str>,
        waiting_reason: Option<&str>,
    ) -> Self {
        self.board_slug = board_slug.chars().take(64).collect();
        self.task_id = task_id.chars().take(96).collect();
        self.has_live_run = i64::from(has_live_run);
        self.latest_run_status = latest_run_status.map(|value| value.chars().take(32).collect());
        self.latest_run_outcome = latest_run_outcome.map(|value| value.chars().take(32).collect());
        self.waiting_reason = waiting_reason.map(sanitize_waiting_reason);
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RegistryError {
    #[error("Hermes profile registry is unavailable")]
    Unavailable,
    #[error("Hermes profile registry exceeds the supported profile limit")]
    TooManyProfiles,
}

pub fn resolve_hermes_root() -> Result<PathBuf, RegistryError> {
    let home = std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or(RegistryError::Unavailable)?;
    let configured = std::env::var_os("HERMES_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    Ok(resolve_hermes_root_from(&home, configured.as_deref()))
}

pub fn resolve_hermes_root_from(home: &Path, hermes_home: Option<&Path>) -> PathBuf {
    let Some(configured) = hermes_home.filter(|path| !path.as_os_str().is_empty()) else {
        return home.join(".hermes");
    };
    if configured
        .parent()
        .and_then(Path::file_name)
        .is_some_and(|name| name == "profiles")
    {
        return configured
            .parent()
            .and_then(Path::parent)
            .unwrap_or(configured)
            .to_path_buf();
    }
    configured.to_path_buf()
}

pub fn discover_agent_registry(root: &Path) -> Result<Vec<ReaderConfig>, RegistryError> {
    if !root.is_absolute() {
        return Err(RegistryError::Unavailable);
    }

    let mut profiles = Vec::new();
    if let Some(default) = profile_config(root, "default") {
        profiles.push(default);
    } else {
        return Err(RegistryError::Unavailable);
    }

    let profiles_root = root.join("profiles");

    #[cfg(unix)]
    if let Ok(directory) = root
        .canonicalize()
        .map(|canonical_root| canonical_root.join("profiles"))
        .map_err(|_| ReadError::RootUnavailable)
        .and_then(|registry| open_directory_no_symlinks(&registry))
    {
        let tombstones = tombstoned_profiles_at(&directory);
        for name in directory_entry_names(&directory).unwrap_or_default() {
            let Some(slug) = name.to_str().map(str::to_owned) else {
                continue;
            };
            if !valid_profile_slug(&slug)
                || matches!(slug.as_str(), "backups" | "snapshots")
                || tombstones.iter().any(|item| item == &slug)
            {
                continue;
            }
            let Some(profile_directory) = open_child_directory(&directory, &name) else {
                continue;
            };
            if let Some(profile) =
                profile_config_at(&profile_directory, &profiles_root.join(&slug), &slug)
            {
                profiles.push(profile);
                if profiles.len() > MAX_PROFILES {
                    return Err(RegistryError::TooManyProfiles);
                }
            }
        }
    }

    #[cfg(not(unix))]
    {
        let tombstones = tombstoned_profiles(&profiles_root);
        if let Ok(entries) = fs::read_dir(&profiles_root) {
            let mut entries: Vec<_> = entries.filter_map(Result::ok).collect();
            entries.sort_by_key(|entry| entry.file_name());
            for entry in entries {
                let Some(slug) = entry.file_name().to_str().map(str::to_owned) else {
                    continue;
                };
                if !valid_profile_slug(&slug)
                    || matches!(slug.as_str(), "backups" | "snapshots")
                    || tombstones.iter().any(|item| item == &slug)
                {
                    continue;
                }
                let Ok(metadata) = entry.path().symlink_metadata() else {
                    continue;
                };
                if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
                    continue;
                }
                if let Some(profile) = profile_config(&entry.path(), &slug) {
                    profiles.push(profile);
                    if profiles.len() > MAX_PROFILES {
                        return Err(RegistryError::TooManyProfiles);
                    }
                }
            }
        }
    }
    Ok(profiles)
}

fn valid_profile_slug(slug: &str) -> bool {
    let mut chars = slug.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_lowercase() || first.is_ascii_digit())
        && slug.len() <= 64
        && chars.all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '-' | '_')
        })
}

#[cfg(not(unix))]
fn tombstoned_profiles(profiles_root: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(profiles_root.join(".deleted")) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|slug| valid_profile_slug(slug))
        .collect()
}

#[cfg(unix)]
fn tombstoned_profiles_at(profiles_root: &File) -> Vec<String> {
    let Some(deleted) = open_child_directory(profiles_root, std::ffi::OsStr::new(".deleted"))
    else {
        return Vec::new();
    };
    directory_entry_names(&deleted)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|name| name.to_str().map(str::to_owned))
        .filter(|slug| valid_profile_slug(slug))
        .collect()
}

fn profile_config(profile_home: &Path, slug: &str) -> Option<ReaderConfig> {
    let display_name = read_public_display_name(&profile_home.join(PROFILE_FILE), slug)?;
    Some(
        ReaderConfig::new(
            profile_home.join("state"),
            slug,
            slug,
            slug,
            "local",
            "local-hermes-state",
        )
        .with_identity(slug, display_name, slug, slug),
    )
}

#[cfg(unix)]
fn profile_config_at(directory: &File, runtime_home: &Path, slug: &str) -> Option<ReaderConfig> {
    let profile_file = open_child_file(directory, std::ffi::OsStr::new(PROFILE_FILE))?;
    let display_name = read_public_display_name_from_file(profile_file, slug)?;
    Some(
        ReaderConfig::new(
            runtime_home.join("state"),
            slug,
            slug,
            slug,
            "local",
            "local-hermes-state",
        )
        .with_identity(slug, display_name, slug, slug),
    )
}

fn read_public_display_name(path: &Path, fallback: &str) -> Option<String> {
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;

    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK);
    read_public_display_name_from_file(options.open(path).ok()?, fallback)
}

fn read_public_display_name_from_file(file: File, fallback: &str) -> Option<String> {
    if !file.metadata().ok()?.is_file() {
        return None;
    }

    let mut reader = BufReader::new(file.take(MAX_PROFILE_METADATA_BYTES + 1));
    let mut consumed = 0_u64;
    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line).ok()?;
        if read == 0 {
            return Some(fallback.to_owned());
        }
        consumed += read as u64;
        if consumed > MAX_PROFILE_METADATA_BYTES {
            return None;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if key.trim() == "display_name" {
            return Some(
                clean_display_name(Some(value.trim())).unwrap_or_else(|| fallback.to_owned()),
            );
        }
    }
}

fn clean_display_name(value: Option<&str>) -> Option<String> {
    let mut value = value?.trim();
    if value.len() >= 2
        && ((value.starts_with('\'') && value.ends_with('\''))
            || (value.starts_with('"') && value.ends_with('"')))
    {
        value = &value[1..value.len() - 1];
    }
    let cleaned = value.trim();
    (!cleaned.is_empty()
        && cleaned.chars().count() <= 64
        && !cleaned.chars().any(char::is_control)
        && !cleaned.starts_with(['[', '{', '&', '*', '!', '|', '>']))
    .then(|| cleaned.to_owned())
}

pub fn read_agent_heartbeats_now(configs: &[ReaderConfig]) -> Vec<AgentHeartbeatDto> {
    read_agent_heartbeats_at(configs, OffsetDateTime::now_utc())
}

pub fn read_agent_heartbeats_live(root: &Path, configs: &[ReaderConfig]) -> Vec<AgentHeartbeatDto> {
    read_world_snapshot(root, configs).agents
}

pub fn read_world_snapshot(root: &Path, configs: &[ReaderConfig]) -> WorldSnapshotDto {
    let started = Instant::now();
    let deadline = started + Duration::from_secs(2);
    let collected_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default();
    let mut agents = read_agent_heartbeats_now(configs);
    let Some(read) = read_kanban_tasks(root, deadline) else {
        for agent in &mut agents {
            agent.activity = "unavailable".to_owned();
            agent.room = "unavailable".to_owned();
            agent.task_phase = "telemetry_unavailable".to_owned();
            agent.telemetry_partial = true;
            agent.evidence.push(SourceEvidence {
                source: "kanban".into(),
                status: "unavailable".into(),
                observed_at: None,
                age_seconds: None,
                confidence: "unknown".into(),
                error_code: Some("no_readable_board".into()),
            });
        }
        merge_runtime_sessions(&mut agents, configs, deadline);
        return WorldSnapshotDto {
            collected_at,
            collection_ms: started.elapsed().as_millis() as u64,
            agents,
            kanban: KanbanSnapshotDto {
                tasks: Vec::new(),
                partial: true,
            },
        };
    };

    let KanbanRead { tasks, partial, errors } = read;
    merge_agent_activity(&mut agents, tasks.iter().cloned());
    merge_runtime_sessions(&mut agents, configs, deadline);
    for agent in &mut agents {
        if agent.task_phase == "live_run" {
            if let Some(proof) = agent.evidence.iter().find(|e| e.source == "kanban-task") {
                agent.source = proof.source.clone();
                agent.confidence = proof.confidence.clone();
                agent.last_evidence_at = proof.observed_at.clone();
                agent.age_seconds = proof.age_seconds;
            }
        }
    }
    if partial {
        for agent in &mut agents {
            agent.telemetry_partial = true;
            if agent.task_phase == "available" {
                agent.task_phase = "telemetry_unavailable".to_owned();
            }
        }
    }
    let kanban = KanbanSnapshotDto {
        tasks: tasks.into_iter().map(kanban_task_dto).collect(),
        partial,
    };
    for agent in &mut agents {
        agent.evidence.extend(errors.iter().cloned());
        agent.evidence.push(SourceEvidence {
            source: "kanban".to_owned(),
            status: if partial {
                "unavailable"
            } else if kanban.tasks.is_empty() {
                "empty"
            } else {
                "readable"
            }
            .to_owned(),
            observed_at: Some(collected_at.clone()),
            age_seconds: Some(0),
            confidence: "declared".to_owned(),
            error_code: partial.then(|| "partial_read".to_owned()),
        });
    }
    WorldSnapshotDto {
        agents,
        kanban,
        collected_at,
        collection_ms: started.elapsed().as_millis() as u64,
    }
}

pub fn read_agent_heartbeats_at(
    configs: &[ReaderConfig],
    now: OffsetDateTime,
) -> Vec<AgentHeartbeatDto> {
    configs
        .iter()
        .map(
            |config| match HeartbeatReader::new(config.clone()).read_at(now) {
                Ok(heartbeat) => AgentHeartbeatDto {
                    agent_id: heartbeat.agent_id,
                    display_name: config.display_name.clone(),
                    profile: heartbeat.profile,
                    role: heartbeat.role,
                    observed_state: heartbeat.observed_state,
                    last_evidence_at: Some(heartbeat.last_evidence_at),
                    age_seconds: Some(heartbeat.age_seconds),
                    source: heartbeat.source,
                    confidence: heartbeat.confidence,
                    machine_id: heartbeat.machine_id,
                    origin: heartbeat.origin,
                    activity: "available".to_owned(),
                    room: "available".to_owned(),
                    task_status: None,
                    task_title: None,
                    task_phase: "available".to_owned(),
                    board_slug: None,
                    task_id: None,
                    waiting_reason: None,
                    telemetry_partial: false,
                    evidence: Vec::new(),
                    session: None,
                },
                Err(_) => AgentHeartbeatDto {
                    agent_id: config.agent_id.clone(),
                    display_name: config.display_name.clone(),
                    profile: config.profile.clone(),
                    role: config.role.clone(),
                    observed_state: ObservedState::Unavailable,
                    last_evidence_at: None,
                    age_seconds: None,
                    source: SOURCE.to_owned(),
                    confidence: "unavailable".to_owned(),
                    machine_id: config.machine_id.clone(),
                    origin: config.origin.clone(),
                    activity: "available".to_owned(),
                    room: "available".to_owned(),
                    task_status: None,
                    task_title: None,
                    task_phase: "available".to_owned(),
                    board_slug: None,
                    task_id: None,
                    waiting_reason: None,
                    telemetry_partial: false,
                    evidence: Vec::new(),
                    session: None,
                },
            },
        )
        .collect()
}

pub fn merge_agent_activity(
    agents: &mut [AgentHeartbeatDto],
    tasks: impl IntoIterator<Item = KanbanTaskSnapshot>,
) {
    let mut by_assignee: HashMap<String, KanbanTaskSnapshot> = HashMap::new();
    for task in tasks.into_iter().take(MAX_KANBAN_ROWS) {
        if !valid_profile_slug(&task.assignee) || activity_for_task(&task).0 == "available" {
            continue;
        }
        let replace = by_assignee
            .get(&task.assignee)
            .is_none_or(|current| task_priority(&task) > task_priority(current));
        if replace {
            by_assignee.insert(task.assignee.clone(), task);
        }
    }

    for agent in agents {
        let Some(task) = by_assignee.get(&agent.profile) else {
            continue;
        };
        let (task_phase, activity, room, telemetry_partial) = activity_for_task(task);
        agent.activity = activity.to_owned();
        agent.room = room.to_owned();
        agent.task_status = Some(task.status.clone());
        agent.task_title = (!task.title.is_empty()).then(|| task.title.clone());
        agent.task_phase = task_phase.to_owned();
        agent.board_slug = (!task.board_slug.is_empty()).then(|| task.board_slug.clone());
        agent.task_id = (!task.task_id.is_empty()).then(|| task.task_id.clone());
        agent.waiting_reason = task.waiting_reason.clone();
        agent.telemetry_partial = telemetry_partial;
        agent.evidence.push(SourceEvidence {
            source: "kanban-task".to_owned(),
            status: task_phase.to_owned(),
            observed_at: task
                .run_observed_at
                .and_then(|t| OffsetDateTime::from_unix_timestamp(t).ok())
                .and_then(|t| t.format(&Rfc3339).ok()),
            age_seconds: task
                .run_observed_at
                .map(|t| (OffsetDateTime::now_utc().unix_timestamp() - t).max(0) as u64),
            confidence: if task.has_live_run == 1 {
                "recent-worker"
            } else {
                "declared"
            }
            .to_owned(),
            error_code: None,
        });
    }
}

fn task_priority(task: &KanbanTaskSnapshot) -> u8 {
    match activity_for_task(task).0 {
        "live_run" => 6,
        "review_pending" => 5,
        "blocked" => 4,
        "ready_unclaimed" => 3,
        "todo_not_started" => 2,
        "telemetry_unavailable" => 1,
        _ => 0,
    }
}

fn activity_for_task(
    task: &KanbanTaskSnapshot,
) -> (&'static str, &'static str, &'static str, bool) {
    match task.status.as_str() {
        "running" if task.has_live_run == 1 => ("live_run", "working", "execution", false),
        "running" => ("telemetry_unavailable", "unavailable", "unavailable", true),
        "review" => ("review_pending", "reviewing", "review", false),
        "blocked" | "triage" if current_block_evidence(task) => {
            ("blocked", "blocked", "blocked", false)
        }
        "blocked" | "triage" => ("available", "available", "available", false),
        // A dormant card is Kanban evidence, not evidence that the assignee has
        // seen, claimed or started it. Keep it on the board without moving the agent.
        "ready" | "todo" => ("available", "available", "available", false),
        _ => ("available", "available", "available", false),
    }
}

fn current_block_evidence(task: &KanbanTaskSnapshot) -> bool {
    task.block_kind
        .as_deref()
        .is_some_and(|kind| !kind.is_empty())
        || task.latest_run_status.as_deref() == Some("blocked")
        || task.latest_run_outcome.as_deref() == Some("blocked")
}

fn sanitize_task_title(title: &str) -> String {
    title
        .chars()
        .filter(|character| !character.is_control())
        .take(120)
        .collect::<String>()
        .trim()
        .to_owned()
}

fn sanitize_waiting_reason(reason: &str) -> String {
    reason
        .chars()
        .filter(|character| !character.is_control())
        .take(120)
        .collect::<String>()
        .trim()
        .to_owned()
}

struct KanbanRead {
    tasks: Vec<KanbanTaskSnapshot>,
    partial: bool,
    errors: Vec<SourceEvidence>,
}

#[derive(Debug, Deserialize)]
struct RuntimeSessionSnapshot {
    session_id: String,
    title: String,
    evidence_at: i64,
    lease_active: i64,
}

fn runtime_database(config: &ReaderConfig) -> Result<Option<PathBuf>, QueryError> {
    let trusted = if config.root().file_name().is_some_and(|n| n == "state") {
        config.root().parent().ok_or(QueryError::Unavailable)?
    } else {
        config.root()
    };
    open_directory_no_symlinks(trusted).map_err(|_| QueryError::Unavailable)?;
    for candidate in [config.root().join("state.db"), trusted.join("state.db")] {
        match candidate.symlink_metadata() {
            Ok(meta) if !meta.file_type().is_symlink() && meta.is_file() => {
                open_directory_no_symlinks(candidate.parent().unwrap())
                    .map_err(|_| QueryError::Unavailable)?;
                return Ok(Some(candidate));
            }
            Ok(_) => return Err(QueryError::Unavailable),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(QueryError::Unavailable),
        }
    }
    Ok(None)
}

fn read_active_runtime_session(
    config: &ReaderConfig,
    deadline: Instant,
) -> Result<Option<RuntimeSessionSnapshot>, QueryError> {
    let Some(database) = runtime_database(config)? else {
        return Err(QueryError::Unavailable);
    };
    let output = sqlite_read::query(
        &database,
        "SELECT substr(s.id,1,96) AS session_id, substr(coalesce(s.title,''),1,120) AS title, CAST(coalesce(s.last_activity_at,s.started_at) AS INTEGER) AS evidence_at, EXISTS(SELECT 1 FROM session_turn_leases lease WHERE lease.conversation_id=s.id AND lease.expires_at > CAST(strftime('%s','now') AS REAL)) AS lease_active FROM sessions s WHERE s.ended_at IS NULL AND (EXISTS (SELECT 1 FROM session_turn_leases lease WHERE lease.conversation_id=s.id AND lease.expires_at > CAST(strftime('%s','now') AS REAL)) OR (coalesce(s.last_activity_description,'') LIKE 'tool running:%' AND coalesce(s.last_activity_at,s.started_at) > CAST(strftime('%s','now') AS REAL)-600)) ORDER BY coalesce(s.last_activity_at,s.started_at) DESC LIMIT 1",
        16 * 1024,
        deadline,
    )?;
    Ok(sqlite_read::rows::<RuntimeSessionSnapshot>(&output)?
        .into_iter()
        .next())
}

fn merge_runtime_sessions(
    agents: &mut [AgentHeartbeatDto],
    configs: &[ReaderConfig],
    deadline: Instant,
) {
    let now = OffsetDateTime::now_utc();
    for agent in agents {
        agent.evidence.push(SourceEvidence {
            source: "gateway.heartbeat".to_owned(),
            status: match agent.observed_state {
                ObservedState::Connected => "readable",
                ObservedState::Disconnected => "stale",
                ObservedState::Unavailable => "unavailable",
            }
            .to_owned(),
            observed_at: agent.last_evidence_at.clone(),
            age_seconds: agent.age_seconds,
            confidence: "direct".to_owned(),
            error_code: None,
        });
        let Some(config) = configs.iter().find(|c| c.profile() == agent.profile) else {
            continue;
        };
        match read_active_runtime_session(config, deadline) {
            Err(error) => {
                agent.telemetry_partial = true;
                agent.evidence.push(SourceEvidence {
                    source: "hermes-session".to_owned(),
                    status: "unavailable".to_owned(),
                    observed_at: None,
                    age_seconds: None,
                    confidence: "unknown".to_owned(),
                    error_code: Some(error.code().to_owned()),
                });
                if agent.task_phase == "available" {
                    agent.task_phase = "telemetry_unavailable".to_owned();
                }
            }
            Ok(None) => agent.evidence.push(SourceEvidence {
                source: "hermes-session".to_owned(),
                status: "empty".to_owned(),
                observed_at: Some(now.format(&Rfc3339).unwrap_or_default()),
                age_seconds: Some(0),
                confidence: "observed".to_owned(),
                error_code: None,
            }),
            Ok(Some(session)) => {
                let age = (now.unix_timestamp() - session.evidence_at).max(0) as u64;
                let stamp = OffsetDateTime::from_unix_timestamp(session.evidence_at)
                    .unwrap_or(now)
                    .format(&Rfc3339)
                    .unwrap_or_default();
                let confidence = if session.lease_active == 1 {
                    "lease"
                } else {
                    "inferred-tool"
                };
                agent.session = Some(SessionEvidence {
                    id: session.session_id.clone(),
                    title: sanitize_task_title(&session.title),
                    observed_at: stamp.clone(),
                    age_seconds: age,
                    confidence: confidence.to_owned(),
                });
                agent.evidence.push(SourceEvidence {
                    source: "hermes-session".to_owned(),
                    status: "active".to_owned(),
                    observed_at: Some(stamp.clone()),
                    age_seconds: Some(age),
                    confidence: confidence.to_owned(),
                    error_code: None,
                });
                if agent.task_phase == "live_run" {
                    continue;
                }
                agent.activity = "working".to_owned();
                agent.room = "execution".to_owned();
                agent.task_status = Some("running".to_owned());
                agent.task_title = Some(if session.title.trim().is_empty() {
                    "Session Hermes active".to_owned()
                } else {
                    sanitize_task_title(&session.title)
                });
                agent.task_phase = "live_session".to_owned();
                agent.board_slug = None;
                agent.task_id = Some(session.session_id);
                agent.waiting_reason = None;
                agent.source = "hermes-session".to_owned();
                agent.confidence = confidence.to_owned();
                agent.last_evidence_at = Some(stamp);
                agent.age_seconds = Some(age);
            }
        }
    }
}

fn read_kanban_tasks(root: &Path, deadline: Instant) -> Option<KanbanRead> {
    let (databases, discovery_partial) = resolve_kanban_databases(root);
    if databases.is_empty() {
        return None;
    }

    let mut tasks = Vec::new();
    let mut partial = discovery_partial;
    let mut errors = Vec::new();
    if discovery_partial {
        errors.push(SourceEvidence { source: "kanban:discovery".into(), status: "unavailable".into(), observed_at: None, age_seconds: None, confidence: "unknown".into(), error_code: Some("discovery_incomplete".into()) });
    }
    for (board_slug, database) in databases {
        #[derive(Deserialize)]
        struct Column {
            name: String,
        }
        let columns = sqlite_read::query(
            &database,
            "PRAGMA table_info(task_runs)",
            16 * 1024,
            deadline,
        )
        .and_then(|b| sqlite_read::rows::<Column>(&b));
        let columns = match columns {
            Ok(columns) => columns,
            Err(error) => {
                partial = true;
                errors.push(kanban_read_error(&board_slug, "schema", error));
                continue;
            }
        };
        let has = |name: &str| columns.iter().any(|c| c.name == name);
        // Legacy schemas without dates cannot confirm a live worker.
        let stamp = if has("last_heartbeat_at") && has("started_at") {
            "coalesce(live.last_heartbeat_at,live.started_at)"
        } else if has("started_at") {
            "live.started_at"
        } else {
            "NULL"
        };
        let lease = if has("claim_expires") {
            " AND (live.claim_expires IS NULL OR live.claim_expires > unixepoch())"
        } else {
            ""
        };
        let live_predicate = format!(
            "live.task_id=t.id AND live.status='running' AND live.ended_at IS NULL AND live.id=(SELECT max(id) FROM task_runs WHERE task_id=t.id) AND {stamp} BETWEEN unixepoch()-120 AND unixepoch()+5{lease}"
        );
        let sql = format!(
            "SELECT coalesce(substr(t.assignee,1,64),'') AS assignee, substr(t.status,1,16) AS status, substr(t.title,1,160) AS title, substr(t.id,1,64) AS task_id, EXISTS(SELECT 1 FROM task_runs live WHERE {live_predicate}) AS has_live_run, (SELECT {stamp} FROM task_runs live WHERE live.task_id=t.id ORDER BY live.id DESC LIMIT 1) AS run_observed_at, substr((SELECT latest.status FROM task_runs latest WHERE latest.task_id=t.id ORDER BY latest.id DESC LIMIT 1),1,32) AS latest_run_status, substr((SELECT latest.outcome FROM task_runs latest WHERE latest.task_id=t.id ORDER BY latest.id DESC LIMIT 1),1,32) AS latest_run_outcome, CASE WHEN t.block_kind='needs_input' THEN 'entrée humaine requise' WHEN t.block_kind='capability' THEN 'capacité indisponible' WHEN t.block_kind='dependency' THEN 'dépendance requise' WHEN t.status='ready' THEN 'worker non réclamé' WHEN t.status='todo' THEN 'tâche non démarrée' WHEN t.status IN ('blocked','triage') THEN substr(coalesce(t.block_kind,'dépendance ou arbitrage requis'),1,120) ELSE NULL END AS waiting_reason, substr(t.block_kind,1,120) AS block_kind, coalesce(t.created_at,0) AS created_at FROM tasks t WHERE t.status IN ('running','review','blocked','triage','ready','todo') ORDER BY has_live_run DESC, CASE t.status WHEN 'review' THEN 5 WHEN 'blocked' THEN 4 WHEN 'triage' THEN 4 WHEN 'ready' THEN 3 WHEN 'todo' THEN 2 ELSE 1 END DESC, t.created_at DESC, t.id LIMIT 512"
        );
        let rows = sqlite_read::query(&database, &sql, MAX_KANBAN_OUTPUT_BYTES, deadline)
            .and_then(|output| sqlite_read::rows::<KanbanTaskSnapshot>(&output));
        let mut board_tasks = match rows {
            Ok(tasks) => tasks,
            Err(error) => {
                partial = true;
                errors.push(kanban_read_error(&board_slug, "tasks", error));
                continue;
            }
        };
        for task in &mut board_tasks {
            task.board_slug = board_slug.clone();
            task.title = sanitize_task_title(&task.title);
            task.waiting_reason = task
                .waiting_reason
                .as_deref()
                .map(sanitize_waiting_reason)
                .filter(|reason| !reason.is_empty());
        }
        if board_tasks.len() == MAX_KANBAN_ROWS {
            partial = true;
        }
        tasks.extend(board_tasks);
    }
    tasks.sort_by(|left, right| {
        task_priority(right)
            .cmp(&task_priority(left))
            .then_with(|| right.created_at.cmp(&left.created_at))
            .then_with(|| left.board_slug.cmp(&right.board_slug))
            .then_with(|| left.task_id.cmp(&right.task_id))
    });
    if tasks.len() > MAX_KANBAN_ROWS {
        tasks.truncate(MAX_KANBAN_ROWS);
        partial = true;
    }
    Some(KanbanRead { tasks, partial, errors })
}

fn kanban_read_error(board: &str, stage: &str, error: QueryError) -> SourceEvidence {
    SourceEvidence { source: format!("kanban:{board}"), status: "unavailable".into(),
        observed_at: None, age_seconds: None, confidence: "unknown".into(),
        error_code: Some(format!("{stage}_{}", error.code())) }
}

pub fn read_kanban_snapshot(root: &Path) -> KanbanSnapshotDto {
    let Some(read) = read_kanban_tasks(root, Instant::now() + Duration::from_secs(2)) else {
        return KanbanSnapshotDto {
            tasks: Vec::new(),
            partial: true,
        };
    };
    KanbanSnapshotDto {
        tasks: read.tasks.into_iter().map(kanban_task_dto).collect(),
        partial: read.partial,
    }
}

fn kanban_task_dto(task: KanbanTaskSnapshot) -> KanbanTaskDto {
    KanbanTaskDto {
        board_slug: task.board_slug,
        task_id: task.task_id,
        title: task.title,
        status: task.status,
        assignee: (!task.assignee.is_empty()).then_some(task.assignee),
        waiting_reason: task.waiting_reason,
        created_at: task.created_at,
        run_observed_at: task.run_observed_at,
    }
}

fn resolve_kanban_databases(root: &Path) -> (Vec<(String, PathBuf)>, bool) {
    let mut candidates = Vec::new();
    let mut partial = false;
    if let Some(path) = std::env::var_os("HERMES_KANBAN_DB")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        candidates.push(("current".to_owned(), path));
    }
    if let Some(board) = std::env::var("HERMES_KANBAN_BOARD")
        .ok()
        .filter(|value| valid_profile_slug(value))
    {
        candidates.push((
            board.clone(),
            root.join("kanban/boards").join(board).join("kanban.db"),
        ));
    }
    match std::fs::read_dir(root.join("kanban/boards")) {
      Ok(entries) => {
        let mut entries = entries.take(MAX_KANBAN_BOARD_ENTRIES + 1).enumerate().filter_map(|(index, entry)| {
            if index == MAX_KANBAN_BOARD_ENTRIES { partial = true; return None; }
            match entry { Ok(entry) => Some(entry), Err(_) => { partial = true; None } }
        }).collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let board = entry.file_name().to_string_lossy().into_owned();
            if valid_profile_slug(&board) {
                candidates.push((board, entry.path().join("kanban.db")));
            }
        }
      },
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
      Err(_) => partial = true,
    }
    candidates.push(("current".to_owned(), root.join("kanban/current/kanban.db")));
    candidates.push(("default".to_owned(), root.join("kanban.db")));

    let Some(canonical_root) = root.canonicalize().ok() else {
        return (Vec::new(), true);
    };
    let mut seen = HashSet::new();
    let mut databases = Vec::new();
    for (board, candidate) in candidates {
        if let Some(canonical) = canonicalize_kanban_database(root, &canonical_root, &candidate) {
            if seen.insert(canonical.clone()) {
                if databases.len() == MAX_KANBAN_BOARDS { partial = true; }
                else { databases.push((board, canonical)); }
            }
        } else {
            // Optional absent defaults are normal. Existing rejected candidates or
            // permission failures must not silently masquerade as complete reads.
            match candidate.symlink_metadata() {
                Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) => (),
                _ => partial = true,
            }
        }
    }
    (databases, partial)
}

fn canonicalize_kanban_database(
    root: &Path,
    canonical_root: &Path,
    candidate: &Path,
) -> Option<PathBuf> {
    let relative = candidate.strip_prefix(root).ok()?;
    let mut cursor = root.to_path_buf();
    for component in relative.components() {
        let std::path::Component::Normal(name) = component else {
            return None;
        };
        cursor.push(name);
        if cursor.symlink_metadata().ok()?.file_type().is_symlink() {
            return None;
        }
    }

    let canonical = cursor.canonicalize().ok()?;
    let metadata = canonical.metadata().ok()?;
    (canonical.starts_with(canonical_root) && metadata.is_file()).then_some(canonical)
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ReadError {
    #[error("heartbeat file is missing")]
    Missing,
    #[error("configured state root is unavailable")]
    RootUnavailable,
    #[error("configured state root must not be a symbolic link")]
    RootSymlink,
    #[error("heartbeat must not be a symbolic link")]
    Symlink,
    #[error("heartbeat is outside the configured state root")]
    OutsideRoot,
    #[error("heartbeat is not a regular file")]
    NotRegular,
    #[error("heartbeat exceeds the configured size limit")]
    TooLarge,
    #[error("heartbeat content is invalid")]
    Invalid,
    #[error("heartbeat could not be read")]
    ReadFailed,
}

#[derive(Debug, Deserialize)]
struct RawHeartbeat {
    updated_at: String,
}

#[derive(Debug, Clone)]
pub struct HeartbeatReader {
    config: ReaderConfig,
}

impl HeartbeatReader {
    pub fn new(config: ReaderConfig) -> Self {
        Self { config }
    }

    pub fn read_now(&self) -> Result<HeartbeatDto, ReadError> {
        self.read_at(OffsetDateTime::now_utc())
    }

    pub fn read_at(&self, now: OffsetDateTime) -> Result<HeartbeatDto, ReadError> {
        let bytes = self.read_confined()?;
        let raw: RawHeartbeat = serde_json::from_slice(&bytes).map_err(|_| ReadError::Invalid)?;
        let updated_at =
            OffsetDateTime::parse(&raw.updated_at, &Rfc3339).map_err(|_| ReadError::Invalid)?;
        let age_seconds = (now - updated_at).whole_seconds().max(0) as u64;
        let observed_state = if age_seconds <= self.config.stale_after_seconds {
            ObservedState::Connected
        } else {
            ObservedState::Disconnected
        };

        Ok(HeartbeatDto {
            agent_id: self.config.agent_id.clone(),
            profile: self.config.profile.clone(),
            role: self.config.role.clone(),
            observed_state,
            last_evidence_at: raw.updated_at,
            age_seconds,
            source: SOURCE.to_owned(),
            confidence: CONFIDENCE.to_owned(),
            machine_id: self.config.machine_id.clone(),
            origin: self.config.origin.clone(),
        })
    }

    fn read_confined(&self) -> Result<Vec<u8>, ReadError> {
        if self.config.heartbeat_path != self.config.state_root.join(HEARTBEAT_FILE) {
            return Err(ReadError::OutsideRoot);
        }

        let root = open_directory_no_symlinks(&self.config.state_root)?;
        let mut file = open_heartbeat_at(&root)?;
        let metadata = file.metadata().map_err(|_| ReadError::ReadFailed)?;
        if !metadata.is_file() {
            return Err(ReadError::NotRegular);
        }
        if metadata.len() > self.config.max_bytes {
            return Err(ReadError::TooLarge);
        }

        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.by_ref()
            .take(self.config.max_bytes + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ReadError::ReadFailed)?;
        if bytes.len() as u64 > self.config.max_bytes {
            return Err(ReadError::TooLarge);
        }
        Ok(bytes)
    }
}

#[cfg(unix)]
pub(crate) fn open_directory_no_symlinks(path: &Path) -> Result<File, ReadError> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;
    use std::path::Component;

    if !path.is_absolute() {
        return Err(ReadError::RootUnavailable);
    }

    let mut directory = File::open("/").map_err(|_| ReadError::RootUnavailable)?;
    for component in path.components() {
        let Component::Normal(name) = component else {
            if component == Component::RootDir {
                continue;
            }
            return Err(ReadError::RootUnavailable);
        };
        let name = CString::new(name.as_bytes()).map_err(|_| ReadError::RootUnavailable)?;
        let descriptor = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if descriptor < 0 {
            return match std::io::Error::last_os_error().raw_os_error() {
                Some(libc::ELOOP) => Err(ReadError::RootSymlink),
                _ => Err(ReadError::RootUnavailable),
            };
        }
        directory = unsafe { File::from_raw_fd(descriptor) };
    }

    directory
        .metadata()
        .map_err(|_| ReadError::RootUnavailable)?
        .is_dir()
        .then_some(directory)
        .ok_or(ReadError::RootUnavailable)
}

#[cfg(unix)]
fn directory_entry_names(directory: &File) -> std::io::Result<Vec<std::ffi::OsString>> {
    use std::ffi::{CStr, OsString};
    use std::os::fd::AsRawFd;
    use std::os::unix::ffi::OsStringExt;

    let duplicated = unsafe { libc::dup(directory.as_raw_fd()) };
    if duplicated < 0 {
        return Err(std::io::Error::last_os_error());
    }
    let stream = unsafe { libc::fdopendir(duplicated) };
    if stream.is_null() {
        unsafe { libc::close(duplicated) };
        return Err(std::io::Error::last_os_error());
    }

    let mut names = Vec::new();
    loop {
        let entry = unsafe { libc::readdir(stream) };
        if entry.is_null() {
            break;
        }
        let bytes = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
        if bytes == b"." || bytes == b".." {
            continue;
        }
        names.push(OsString::from_vec(bytes.to_vec()));
    }
    let close_result = unsafe { libc::closedir(stream) };
    if close_result != 0 {
        return Err(std::io::Error::last_os_error());
    }
    names.sort();
    Ok(names)
}

#[cfg(unix)]
fn open_child_directory(parent: &File, name: &std::ffi::OsStr) -> Option<File> {
    open_child_at(
        parent,
        name,
        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
    )
}

#[cfg(unix)]
pub(crate) fn open_child_file(parent: &File, name: &std::ffi::OsStr) -> Option<File> {
    open_child_at(
        parent,
        name,
        libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
    )
}

#[cfg(unix)]
fn open_child_at(parent: &File, name: &std::ffi::OsStr, flags: libc::c_int) -> Option<File> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;

    let name = CString::new(name.as_bytes()).ok()?;
    let descriptor = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
    (descriptor >= 0).then(|| unsafe { File::from_raw_fd(descriptor) })
}

#[cfg(unix)]
fn open_heartbeat_at(root: &File) -> Result<File, ReadError> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};

    let leaf = CString::new(HEARTBEAT_FILE).expect("heartbeat filename is static");
    let descriptor = unsafe {
        libc::openat(
            root.as_raw_fd(),
            leaf.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
        )
    };
    if descriptor < 0 {
        return match std::io::Error::last_os_error().raw_os_error() {
            Some(libc::ENOENT) => Err(ReadError::Missing),
            Some(libc::ELOOP) => Err(ReadError::Symlink),
            _ => Err(ReadError::ReadFailed),
        };
    }
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

#[cfg(not(unix))]
pub(crate) fn open_directory_no_symlinks(_path: &Path) -> Result<File, ReadError> {
    Err(ReadError::RootUnavailable)
}

#[cfg(not(unix))]
fn open_heartbeat_at(_root: &File) -> Result<File, ReadError> {
    Err(ReadError::ReadFailed)
}

#[cfg(all(test, unix))]
mod descriptor_race_tests {
    use super::{open_directory_no_symlinks, open_heartbeat_at};
    use std::fs;
    use std::io::Read;

    #[test]
    fn descriptor_open_resists_parent_and_leaf_replacement() {
        let temporary = tempfile::tempdir().unwrap();
        let canonical_temporary = fs::canonicalize(temporary.path()).unwrap();
        let state = canonical_temporary.join("state");
        let pinned_state = canonical_temporary.join("pinned-state");
        fs::create_dir(&state).unwrap();
        fs::write(state.join("gateway.heartbeat"), b"trusted").unwrap();

        let root = open_directory_no_symlinks(&state).unwrap();
        fs::rename(&state, &pinned_state).unwrap();
        fs::create_dir(&state).unwrap();
        fs::write(state.join("gateway.heartbeat"), b"replacement-parent").unwrap();

        let mut heartbeat = open_heartbeat_at(&root).unwrap();
        fs::rename(
            pinned_state.join("gateway.heartbeat"),
            pinned_state.join("original.heartbeat"),
        )
        .unwrap();
        fs::write(pinned_state.join("gateway.heartbeat"), b"replacement-leaf").unwrap();

        let mut bytes = Vec::new();
        heartbeat.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, b"trusted");
    }
}
