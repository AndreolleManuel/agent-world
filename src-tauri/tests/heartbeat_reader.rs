use pixel_ops_lib::heartbeat::{
    HeartbeatReader, KanbanTaskSnapshot, ObservedState, ReadError, ReaderConfig, RegistryError,
    discover_agent_registry, merge_agent_activity, read_agent_heartbeats_at,
    read_agent_heartbeats_live, read_kanban_snapshot, read_world_snapshot,
    resolve_hermes_root_from,
};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use time::OffsetDateTime;

fn now() -> OffsetDateTime {
    OffsetDateTime::parse(
        "2026-09-02T12:00:10Z",
        &time::format_description::well_known::Rfc3339,
    )
    .unwrap()
}

#[test]
fn board_discovery_cap_is_explicitly_partial() {
    let fixture = tempfile::tempdir().unwrap();
    for index in 0..65 {
        let path = fixture.path().join(format!("kanban/boards/board-{index:03}/kanban.db"));
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let db = rusqlite::Connection::open(path).unwrap();
        db.execute_batch("CREATE TABLE tasks (id TEXT, assignee TEXT, status TEXT, title TEXT, block_kind TEXT, created_at INTEGER);
            CREATE TABLE task_runs (id INTEGER, task_id TEXT, status TEXT, outcome TEXT, ended_at TEXT, last_heartbeat_at INTEGER, started_at INTEGER, claim_expires INTEGER);
            INSERT INTO tasks VALUES ('task', '', 'todo', 'Audit fixture', NULL, 1);").unwrap();
    }
    let snapshot = read_kanban_snapshot(fixture.path());
    assert_eq!(snapshot.tasks.len(), 64);
    assert!(snapshot.partial);
}

#[test]
fn current_board_marker_file_is_not_an_unreadable_database() {
    let fixture = tempfile::tempdir().unwrap();
    create_kanban_database(&fixture.path().join("kanban.db"), "a", "Synthetic task");
    fs::create_dir_all(fixture.path().join("kanban")).unwrap();
    fs::write(fixture.path().join("kanban/current"), "default").unwrap();
    assert!(!read_kanban_snapshot(fixture.path()).partial);
}

fn config(root: &Path) -> ReaderConfig {
    ReaderConfig::new(
        fs::canonicalize(root).unwrap(),
        "unit-default",
        "default-profile",
        "operator",
        "local",
        "local",
    )
    .with_limits(16 * 1024, 30)
}

fn write_heartbeat(path: &Path, updated_at: &str) {
    fs::write(
        path,
        serde_json::to_vec(&json!({
            "updated_at": updated_at,
            "pid": 4242,
            "monotonic": 98765.0,
            "loop_tick_socket": true,
            "session_id": "must-not-leak",
            "metadata": {"secret": "must-not-leak"},
            "prompts": ["must-not-leak"],
            "messages": ["must-not-leak"],
            "arguments": {"token": "must-not-leak"},
            "tool_results": ["must-not-leak"]
        }))
        .unwrap(),
    )
    .unwrap();
}

fn create_kanban_database(path: &Path, task_id: &str, title: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let sql = format!(
        "CREATE TABLE tasks (id TEXT, assignee TEXT, status TEXT, title TEXT, block_kind TEXT, created_at INTEGER);\
         CREATE TABLE task_runs (id INTEGER, task_id TEXT, status TEXT, outcome TEXT, ended_at TEXT, last_heartbeat_at INTEGER, started_at INTEGER, claim_expires INTEGER);\
         INSERT INTO tasks VALUES ('{task_id}', 'default-profile', 'running', '{title}', NULL, 1);\
         INSERT INTO task_runs VALUES (1, '{task_id}', 'running', NULL, NULL, unixepoch(), unixepoch()-10, unixepoch()+60);"
    );
    assert!(
        Command::new("/usr/bin/sqlite3")
            .arg(path)
            .arg(sql)
            .status()
            .unwrap()
            .success()
    );
}

fn create_history_kanban_database(path: &Path) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let sql = "CREATE TABLE tasks (id TEXT, assignee TEXT, status TEXT, title TEXT, block_kind TEXT, created_at INTEGER); \
               CREATE TABLE task_runs (id INTEGER, task_id TEXT, status TEXT, outcome TEXT, ended_at TEXT); \
               WITH RECURSIVE counter(value) AS ( \
                 SELECT 0 UNION ALL SELECT value + 1 FROM counter WHERE value < 512 \
               ) \
               INSERT INTO tasks \
                 SELECT printf('history-%03d', value), 'default-profile', 'blocked', \
                        printf('Historical task %03d', value), 'dependency', value \
                 FROM counter;";
    assert!(
        Command::new("/usr/bin/sqlite3")
            .arg(path)
            .arg(sql)
            .status()
            .unwrap()
            .success()
    );
}

fn create_runtime_database(path: &Path, active: bool) {
    let lease_offset = if active { 600 } else { -600 };
    let sql = format!(
        "CREATE TABLE sessions (id TEXT, title TEXT, ended_at REAL, started_at REAL, last_activity_at REAL, last_activity_description TEXT);\
         CREATE TABLE session_turn_leases (conversation_id TEXT, expires_at REAL);\
         INSERT INTO sessions VALUES ('session-live', 'Audit SEO réellement lancé', NULL, strftime('%s','now')-30, strftime('%s','now'), 'tool running: process');\
         INSERT INTO session_turn_leases VALUES ('session-live', strftime('%s','now')+{lease_offset});"
    );
    assert!(
        Command::new("/usr/bin/sqlite3")
            .arg(path)
            .arg(sql)
            .status()
            .unwrap()
            .success()
    );
}

#[test]
fn maps_fresh_heartbeat_with_injected_clock() {
    let dir = tempfile::tempdir().unwrap();
    let heartbeat_path = dir.path().join("gateway.heartbeat");
    write_heartbeat(&heartbeat_path, "2026-09-02T12:00:00Z");
    let bytes_before = fs::read(&heartbeat_path).unwrap();
    let modified_before = fs::metadata(&heartbeat_path).unwrap().modified().unwrap();

    let dto = HeartbeatReader::new(config(dir.path()))
        .read_at(now())
        .unwrap();

    assert_eq!(fs::read(&heartbeat_path).unwrap(), bytes_before);
    assert_eq!(
        fs::metadata(&heartbeat_path).unwrap().modified().unwrap(),
        modified_before
    );
    assert_eq!(dto.agent_id, "unit-default");
    assert_eq!(dto.profile, "default-profile");
    assert_eq!(dto.role, "operator");
    assert_eq!(dto.observed_state, ObservedState::Connected);
    assert_eq!(dto.last_evidence_at, "2026-09-02T12:00:00Z");
    assert_eq!(dto.age_seconds, 10);
    assert_eq!(dto.source, "gateway.heartbeat");
    assert_eq!(dto.confidence, "direct");
    assert_eq!(dto.machine_id, "local");
    assert_eq!(dto.origin, "local");
}

#[test]
fn serializes_only_the_allowlisted_dto() {
    let dir = tempfile::tempdir().unwrap();
    write_heartbeat(
        &dir.path().join("gateway.heartbeat"),
        "2026-09-02T12:00:00Z",
    );
    let dto = HeartbeatReader::new(config(dir.path()))
        .read_at(now())
        .unwrap();
    let value = serde_json::to_value(dto).unwrap();
    let object = value.as_object().unwrap();
    let mut keys: Vec<_> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        vec![
            "age_seconds",
            "agent_id",
            "confidence",
            "last_evidence_at",
            "machine_id",
            "observed_state",
            "origin",
            "profile",
            "role",
            "source",
        ]
    );
    let serialized = serde_json::to_string(&value).unwrap();
    for forbidden in [
        "pid",
        "monotonic",
        "socket",
        "session_id",
        "metadata",
        "prompts",
        "messages",
        "arguments",
        "tool_results",
        "must-not-leak",
    ] {
        assert!(!serialized.contains(forbidden), "leaked {forbidden}");
    }
}

#[test]
fn marks_stale_heartbeat_disconnected() {
    let dir = tempfile::tempdir().unwrap();
    write_heartbeat(
        &dir.path().join("gateway.heartbeat"),
        "2026-09-02T11:59:00Z",
    );
    let dto = HeartbeatReader::new(config(dir.path()))
        .read_at(now())
        .unwrap();
    assert_eq!(dto.observed_state, ObservedState::Disconnected);
    assert_eq!(dto.age_seconds, 70);
}

#[test]
fn rejects_missing_heartbeat() {
    let dir = tempfile::tempdir().unwrap();
    let error = HeartbeatReader::new(config(dir.path()))
        .read_at(now())
        .unwrap_err();
    assert_eq!(error, ReadError::Missing);
}

#[test]
fn rejects_invalid_heartbeat_without_echoing_payload() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("gateway.heartbeat"), b"{private-payload").unwrap();
    let error = HeartbeatReader::new(config(dir.path()))
        .read_at(now())
        .unwrap_err();
    assert_eq!(error, ReadError::Invalid);
    assert!(!error.to_string().contains("private-payload"));
}

#[test]
fn rejects_oversized_heartbeat() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("gateway.heartbeat");
    fs::write(&path, vec![b'x'; 65]).unwrap();
    let cfg = config(dir.path()).with_limits(64, 30);
    let error = HeartbeatReader::new(cfg).read_at(now()).unwrap_err();
    assert_eq!(error, ReadError::TooLarge);
}

#[cfg(unix)]
#[test]
fn rejects_symlink_even_when_target_is_inside_root() {
    use std::os::unix::fs::symlink;
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("actual-heartbeat");
    write_heartbeat(&target, "2026-09-02T12:00:00Z");
    symlink(&target, dir.path().join("gateway.heartbeat")).unwrap();
    let error = HeartbeatReader::new(config(dir.path()))
        .read_at(now())
        .unwrap_err();
    assert_eq!(error, ReadError::Symlink);
}

#[test]
fn rejects_heartbeat_outside_configured_root() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let candidate = outside.path().join("gateway.heartbeat");
    write_heartbeat(&candidate, "2026-09-02T12:00:00Z");
    let cfg = config(root.path()).with_heartbeat_path(PathBuf::from(candidate));
    let error = HeartbeatReader::new(cfg).read_at(now()).unwrap_err();
    assert_eq!(error, ReadError::OutsideRoot);
}

fn write_profile(home: &Path, display_name: Option<&str>) {
    fs::create_dir_all(home.join("state")).unwrap();
    let metadata = display_name
        .map(|name| format!("description: public\ndisplay_name: {name}\n"))
        .unwrap_or_else(|| "description: public\n".to_owned());
    fs::write(home.join("profile.yaml"), metadata).unwrap();
}

#[test]
fn resolves_default_named_profile_and_custom_hermes_homes() {
    let home = PathBuf::from("/Users/example");
    assert_eq!(resolve_hermes_root_from(&home, None), home.join(".hermes"));
    assert_eq!(
        resolve_hermes_root_from(&home, Some(Path::new("/fleet/profiles/writer"))),
        PathBuf::from("/fleet")
    );
    assert_eq!(
        resolve_hermes_root_from(&home, Some(Path::new("/custom-hermes"))),
        PathBuf::from("/custom-hermes")
    );
}

#[test]
fn discovers_default_and_named_profiles_without_a_name_allowlist() {
    let root = tempfile::tempdir().unwrap();
    write_profile(root.path(), Some("Coordinator"));
    write_profile(&root.path().join("profiles/writer"), Some("Writer"));
    write_profile(&root.path().join("profiles/reviewer"), None);

    let registry = discover_agent_registry(root.path()).unwrap();
    let actual: Vec<_> = registry
        .iter()
        .map(|config| {
            (
                config.agent_id(),
                config.display_name(),
                config.root().to_path_buf(),
            )
        })
        .collect();
    assert_eq!(
        actual,
        vec![
            ("default", "Coordinator", root.path().join("state")),
            (
                "reviewer",
                "reviewer",
                root.path().join("profiles/reviewer/state")
            ),
            (
                "writer",
                "Writer",
                root.path().join("profiles/writer/state")
            ),
        ]
    );
}

#[test]
fn registry_reflects_addition_deletion_and_tombstones_between_reads() {
    let root = tempfile::tempdir().unwrap();
    write_profile(root.path(), None);
    write_profile(&root.path().join("profiles/first"), None);
    assert_eq!(discover_agent_registry(root.path()).unwrap().len(), 2);

    write_profile(&root.path().join("profiles/second"), Some("Second"));
    assert_eq!(discover_agent_registry(root.path()).unwrap().len(), 3);

    fs::create_dir_all(root.path().join("profiles/.deleted/first")).unwrap();
    fs::remove_dir_all(root.path().join("profiles/second")).unwrap();
    let ids: Vec<_> = discover_agent_registry(root.path())
        .unwrap()
        .iter()
        .map(|config| config.agent_id().to_owned())
        .collect();
    assert_eq!(ids, vec!["default".to_owned()]);
}

#[cfg(unix)]
#[test]
fn excludes_unsafe_or_invalid_profile_entries() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    write_profile(root.path(), None);
    let profiles = root.path().join("profiles");
    for name in [
        ".hidden",
        "backups",
        "snapshots",
        "bad.profile",
        "bad profile",
    ] {
        write_profile(&profiles.join(name), Some("Do not expose"));
    }
    fs::write(profiles.join("plain-file"), b"not a profile").unwrap();
    let external = tempfile::tempdir().unwrap();
    write_profile(external.path(), Some("Outside"));
    symlink(external.path(), profiles.join("linked")).unwrap();

    let ids: Vec<_> = discover_agent_registry(root.path())
        .unwrap()
        .iter()
        .map(|config| config.agent_id().to_owned())
        .collect();
    assert_eq!(ids, vec!["default".to_owned()]);
}

#[cfg(unix)]
#[test]
fn does_not_follow_a_symlinked_profiles_registry() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    write_profile(root.path(), None);
    let external = tempfile::tempdir().unwrap();
    write_profile(&external.path().join("outside"), Some("Outside"));
    symlink(external.path(), root.path().join("profiles")).unwrap();

    let ids: Vec<_> = discover_agent_registry(root.path())
        .unwrap()
        .iter()
        .map(|config| config.agent_id().to_owned())
        .collect();

    assert_eq!(ids, vec!["default".to_owned()]);
}

#[test]
fn malformed_or_oversized_display_names_fall_back_without_hiding_profiles() {
    let root = tempfile::tempdir().unwrap();
    write_profile(root.path(), None);
    write_profile(&root.path().join("profiles/valid"), Some("Visible"));
    write_profile(
        &root.path().join("profiles/too-long"),
        Some(&"x".repeat(200)),
    );
    fs::create_dir_all(root.path().join("profiles/malformed/state")).unwrap();
    fs::write(
        root.path().join("profiles/malformed/profile.yaml"),
        b"display_name: [not-a-scalar]\n",
    )
    .unwrap();

    let names: Vec<_> = discover_agent_registry(root.path())
        .unwrap()
        .iter()
        .map(|config| {
            (
                config.agent_id().to_owned(),
                config.display_name().to_owned(),
            )
        })
        .collect();
    assert!(names.contains(&("malformed".to_owned(), "malformed".to_owned())));
    assert!(names.contains(&("too-long".to_owned(), "too-long".to_owned())));
    assert!(names.contains(&("valid".to_owned(), "Visible".to_owned())));
}

#[test]
fn stops_after_public_display_name_without_consuming_an_oversized_private_tail() {
    let root = tempfile::tempdir().unwrap();
    write_profile(root.path(), None);
    let profile = root.path().join("profiles/bounded");
    fs::create_dir_all(profile.join("state")).unwrap();
    let mut contents = b"display_name: Visible\nprivate_blob: ".to_vec();
    contents.extend(std::iter::repeat_n(b'x', 256 * 1024));
    fs::write(profile.join("profile.yaml"), contents).unwrap();

    let names: Vec<_> = discover_agent_registry(root.path())
        .unwrap()
        .iter()
        .map(|config| {
            (
                config.agent_id().to_owned(),
                config.display_name().to_owned(),
            )
        })
        .collect();

    assert!(names.contains(&("bounded".to_owned(), "Visible".to_owned())));
}

#[test]
fn rejects_more_than_the_bounded_profile_limit_without_truncation() {
    let root = tempfile::tempdir().unwrap();
    write_profile(root.path(), None);
    for index in 0..256 {
        write_profile(&root.path().join(format!("profiles/p{index:03}")), None);
    }
    assert_eq!(
        discover_agent_registry(root.path()).unwrap_err(),
        RegistryError::TooManyProfiles
    );
}

#[test]
fn aggregates_agents_in_registry_order_and_degrades_failures_independently() {
    let connected = tempfile::tempdir().unwrap();
    let missing = tempfile::tempdir().unwrap();
    let invalid = tempfile::tempdir().unwrap();
    write_heartbeat(
        &connected.path().join("gateway.heartbeat"),
        "2026-09-02T12:00:00Z",
    );
    fs::write(
        invalid.path().join("gateway.heartbeat"),
        b"{private-payload",
    )
    .unwrap();

    let configs = vec![
        config(connected.path()).with_identity("unit-one", "Unit One", "unit-one", "builder"),
        config(missing.path()).with_identity("unit-two", "Unit Two", "unit-two", "planner"),
        config(invalid.path()).with_identity("unit-three", "Unit Three", "unit-three", "reviewer"),
    ];
    let agents = read_agent_heartbeats_at(&configs, now());

    assert_eq!(agents.len(), 3);
    assert_eq!(agents[0].agent_id, "unit-one");
    assert_eq!(agents[0].display_name, "Unit One");
    assert_eq!(agents[0].observed_state, ObservedState::Connected);
    assert_eq!(agents[0].age_seconds, Some(10));
    for (agent, id) in agents[1..].iter().zip(["unit-two", "unit-three"]) {
        assert_eq!(agent.agent_id, id);
        assert_eq!(agent.observed_state, ObservedState::Unavailable);
        assert_eq!(agent.last_evidence_at, None);
        assert_eq!(agent.age_seconds, None);
        assert_eq!(agent.confidence, "unavailable");
    }
    let serialized = serde_json::to_string(&agents).unwrap();
    assert!(!serialized.contains("private-payload"));
    assert!(!serialized.contains(connected.path().to_string_lossy().as_ref()));
    assert!(!serialized.contains(missing.path().to_string_lossy().as_ref()));
    assert!(!serialized.contains(invalid.path().to_string_lossy().as_ref()));
}

#[test]
fn merges_bounded_kanban_activity_by_canonical_profile_slug() {
    let root = tempfile::tempdir().unwrap();
    let mut agents = read_agent_heartbeats_at(
        &[
            config(root.path()).with_identity("first", "First", "first", "first"),
            config(root.path()).with_identity("second", "Second", "second", "second"),
        ],
        now(),
    );
    merge_agent_activity(
        &mut agents,
        vec![
            KanbanTaskSnapshot::new("first", "running", "Bounded task title").with_runtime(
                "default",
                "task-first",
                true,
                Some("running"),
                None,
                None,
            ),
            KanbanTaskSnapshot::new("SECOND", "blocked", "wrong slug casing"),
        ],
    );

    assert_eq!(agents[0].activity, "working");
    assert_eq!(agents[0].room, "execution");
    assert_eq!(agents[0].task_status.as_deref(), Some("running"));
    assert_eq!(agents[0].task_title.as_deref(), Some("Bounded task title"));
    assert_eq!(agents[1].activity, "available");
    assert_eq!(agents[1].room, "available");
    assert_eq!(agents[1].task_title, None);
}

#[test]
fn serializes_only_the_multi_agent_allowlist() {
    let dir = tempfile::tempdir().unwrap();
    write_heartbeat(
        &dir.path().join("gateway.heartbeat"),
        "2026-09-02T12:00:00Z",
    );
    let agents = read_agent_heartbeats_at(
        &[config(dir.path()).with_identity("unit-one", "Unit One", "unit-one", "builder")],
        now(),
    );
    let value = serde_json::to_value(&agents[0]).unwrap();
    let object = value.as_object().unwrap();
    let mut keys: Vec<_> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        vec![
            "activity",
            "age_seconds",
            "agent_id",
            "board_slug",
            "confidence",
            "display_name",
            "evidence",
            "last_evidence_at",
            "machine_id",
            "observed_state",
            "origin",
            "profile",
            "role",
            "room",
            "session",
            "source",
            "task_id",
            "task_phase",
            "task_status",
            "task_title",
            "telemetry_partial",
            "waiting_reason",
        ]
    );
}

#[test]
fn derives_honest_task_phases_from_task_and_run_evidence() {
    let root = tempfile::tempdir().unwrap();
    let mut agents = read_agent_heartbeats_at(
        &[
            config(root.path()).with_identity("live", "Live", "live", "builder"),
            config(root.path()).with_identity("orphan", "Orphan", "orphan", "builder"),
            config(root.path()).with_identity("review", "Review", "review", "reviewer"),
            config(root.path()).with_identity("ready", "Ready", "ready", "builder"),
        ],
        now(),
    );
    merge_agent_activity(
        &mut agents,
        vec![
            KanbanTaskSnapshot::new("live", "running", "Live task").with_runtime(
                "board-a",
                "t-live",
                true,
                Some("running"),
                None,
                None,
            ),
            KanbanTaskSnapshot::new("orphan", "running", "Orphan task").with_runtime(
                "board-a",
                "t-orphan",
                false,
                Some("crashed"),
                Some("crashed"),
                None,
            ),
            KanbanTaskSnapshot::new("review", "review", "Review task").with_runtime(
                "board-b",
                "t-review",
                false,
                Some("review"),
                Some("review_requested"),
                None,
            ),
            KanbanTaskSnapshot::new("ready", "ready", "Ready task").with_runtime(
                "board-b",
                "t-ready",
                false,
                None,
                None,
                Some("worker non réclamé"),
            ),
        ],
    );

    assert_eq!(agents[0].task_phase, "live_run");
    assert_eq!(agents[0].activity, "working");
    assert_eq!(agents[0].board_slug.as_deref(), Some("board-a"));
    assert_eq!(agents[0].task_id.as_deref(), Some("t-live"));
    assert_eq!(agents[1].task_phase, "telemetry_unavailable");
    assert_eq!(agents[1].activity, "unavailable");
    assert!(agents[1].telemetry_partial);
    assert_eq!(agents[2].task_phase, "review_pending");
    assert_eq!(agents[2].activity, "reviewing");
    assert_eq!(agents[3].task_phase, "available");
    assert_eq!(agents[3].activity, "available");
    assert_eq!(agents[3].task_title, None);
    assert_eq!(agents[3].waiting_reason, None);
}

#[test]
fn ignores_abandoned_blocked_rows_for_live_agent_placement() {
    let root = tempfile::tempdir().unwrap();
    let mut agents = read_agent_heartbeats_at(
        &[
            config(root.path()).with_identity("montreal", "Montréal", "montreal", "writer"),
            config(root.path()).with_identity("active", "Active", "active", "reviewer"),
        ],
        now(),
    );
    merge_agent_activity(
        &mut agents,
        vec![
            KanbanTaskSnapshot::new("montreal", "blocked", "Ancienne tentative").with_runtime(
                "content",
                "t-old",
                false,
                Some("gave_up"),
                Some("gave_up"),
                Some("dépendance ou arbitrage requis"),
            ),
            KanbanTaskSnapshot::new("active", "blocked", "Blocage confirmé").with_runtime(
                "content",
                "t-active",
                false,
                Some("blocked"),
                Some("blocked"),
                Some("needs_input"),
            ),
        ],
    );

    assert_eq!(agents[0].task_phase, "available");
    assert_eq!(agents[0].task_title, None);
    assert_eq!(agents[1].task_phase, "blocked");
    assert_eq!(agents[1].task_title.as_deref(), Some("Blocage confirmé"));
}

#[test]
fn kanban_snapshot_includes_real_unassigned_cards() {
    let root = tempfile::tempdir().unwrap();
    let database = root.path().join("kanban/boards/live-board/kanban.db");
    fs::create_dir_all(database.parent().unwrap()).unwrap();
    let sql = "CREATE TABLE tasks (id TEXT, assignee TEXT, status TEXT, title TEXT, block_kind TEXT, created_at INTEGER); \
               CREATE TABLE task_runs (id INTEGER, task_id TEXT, status TEXT, outcome TEXT, ended_at TEXT); \
               INSERT INTO tasks VALUES ('t-free', NULL, 'ready', 'Carte libre réelle', NULL, 10);";
    assert!(
        Command::new("/usr/bin/sqlite3")
            .arg(&database)
            .arg(sql)
            .status()
            .unwrap()
            .success()
    );

    let snapshot = read_kanban_snapshot(root.path());

    assert!(!snapshot.partial);
    assert_eq!(snapshot.tasks.len(), 1);
    assert_eq!(snapshot.tasks[0].board_slug, "live-board");
    assert_eq!(snapshot.tasks[0].title, "Carte libre réelle");
    assert_eq!(snapshot.tasks[0].assignee, None);
}

#[test]
fn combined_world_snapshot_keeps_agent_activity_and_board_in_one_read() {
    let root = tempfile::tempdir().unwrap();
    write_profile(root.path(), None);
    write_heartbeat(
        &root.path().join("gateway.heartbeat"),
        "2026-09-02T12:00:00Z",
    );
    create_kanban_database(
        &root.path().join("kanban/boards/live-board/kanban.db"),
        "t-live",
        "Live task",
    );

    let snapshot = read_world_snapshot(
        root.path(),
        &[config(root.path()).with_identity(
            "unit-default",
            "Default",
            "default-profile",
            "operator",
        )],
    );

    assert_eq!(snapshot.agents[0].task_phase, "live_run");
    assert_eq!(snapshot.agents[0].task_id.as_deref(), Some("t-live"));
    assert_eq!(snapshot.kanban.tasks.len(), 1);
    assert_eq!(snapshot.kanban.tasks[0].task_id, "t-live");
}

#[test]
fn active_hermes_turn_moves_agent_to_a_desk_without_a_kanban_run() {
    let root = tempfile::tempdir().unwrap();
    write_heartbeat(
        &root.path().join("gateway.heartbeat"),
        "2026-09-02T12:00:00Z",
    );
    create_runtime_database(&root.path().join("state.db"), true);
    let database = root.path().join("kanban/boards/empty/kanban.db");
    fs::create_dir_all(database.parent().unwrap()).unwrap();
    assert!(
        Command::new("/usr/bin/sqlite3")
            .arg(&database)
            .arg("CREATE TABLE tasks (id TEXT, assignee TEXT, status TEXT, title TEXT, block_kind TEXT, created_at INTEGER); CREATE TABLE task_runs (id INTEGER, task_id TEXT, status TEXT, outcome TEXT, ended_at TEXT);")
            .status()
            .unwrap()
            .success()
    );

    let snapshot = read_world_snapshot(
        root.path(),
        &[config(root.path()).with_identity("dublin", "Dublin", "default-profile", "seo")],
    );

    assert_eq!(snapshot.agents[0].task_phase, "live_session");
    assert_eq!(snapshot.agents[0].activity, "working");
    assert_eq!(snapshot.agents[0].room, "execution");
    assert_eq!(
        snapshot.agents[0].task_title.as_deref(),
        Some("Audit SEO réellement lancé")
    );
    assert_eq!(snapshot.agents[0].task_id.as_deref(), Some("session-live"));
    assert_eq!(snapshot.agents[0].board_slug, None);
}

#[test]
fn recent_background_tool_remains_working_after_its_turn_lease_expires() {
    let root = tempfile::tempdir().unwrap();
    write_heartbeat(
        &root.path().join("gateway.heartbeat"),
        "2026-09-02T12:00:00Z",
    );
    create_runtime_database(&root.path().join("state.db"), false);
    let database = root.path().join("kanban/boards/empty/kanban.db");
    fs::create_dir_all(database.parent().unwrap()).unwrap();
    assert!(
        Command::new("/usr/bin/sqlite3")
            .arg(&database)
            .arg("CREATE TABLE tasks (id TEXT, assignee TEXT, status TEXT, title TEXT, block_kind TEXT, created_at INTEGER); CREATE TABLE task_runs (id INTEGER, task_id TEXT, status TEXT, outcome TEXT, ended_at TEXT);")
            .status()
            .unwrap()
            .success()
    );

    let snapshot = read_world_snapshot(
        root.path(),
        &[config(root.path()).with_identity("dublin", "Dublin", "default-profile", "seo")],
    );

    assert_eq!(snapshot.agents[0].task_phase, "live_session");
    assert_eq!(snapshot.agents[0].activity, "working");
}

#[test]
fn aggregates_multiple_boards_with_a_global_bound_and_prefers_live_work() {
    let root = tempfile::tempdir().unwrap();
    let mut agents = read_agent_heartbeats_at(
        &[config(root.path()).with_identity("shared", "Shared", "shared", "builder")],
        now(),
    );
    let mut tasks = vec![
        KanbanTaskSnapshot::new("shared", "ready", "Queued elsewhere")
            .with_runtime("board-a", "t-ready", false, None, None, None),
        KanbanTaskSnapshot::new("shared", "running", "Actually executing").with_runtime(
            "board-b",
            "t-live",
            true,
            Some("running"),
            None,
            None,
        ),
    ];
    tasks.extend((0..600).map(|index| {
        KanbanTaskSnapshot::new("shared", "blocked", &format!("Overflow {index}")).with_runtime(
            "overflow",
            &format!("t-{index}"),
            false,
            None,
            None,
            None,
        )
    }));

    merge_agent_activity(&mut agents, tasks);

    assert_eq!(agents[0].task_phase, "live_run");
    assert_eq!(agents[0].board_slug.as_deref(), Some("board-b"));
    assert_eq!(agents[0].task_id.as_deref(), Some("t-live"));
}

fn assert_live_board_wins(history_board: &str, live_board: &str) {
    let root = tempfile::tempdir().unwrap();
    write_profile(root.path(), None);
    write_heartbeat(
        &root.path().join("gateway.heartbeat"),
        "2026-09-02T12:00:00Z",
    );
    let boards = root.path().join("kanban/boards");
    create_history_kanban_database(&boards.join(history_board).join("kanban.db"));
    create_kanban_database(
        &boards.join(live_board).join("kanban.db"),
        "t-live-across-boards",
        "Live across boards",
    );

    let agents = read_agent_heartbeats_live(
        root.path(),
        &[config(root.path()).with_identity(
            "unit-default",
            "Default",
            "default-profile",
            "operator",
        )],
    );

    assert_eq!(agents[0].task_phase, "live_run");
    assert_eq!(agents[0].board_slug.as_deref(), Some(live_board));
    assert_eq!(agents[0].task_id.as_deref(), Some("t-live-across-boards"));
}

#[test]
fn live_run_survives_multi_board_collection_cap_regardless_of_board_order() {
    assert_live_board_wins("a-history", "z-live");
    assert_live_board_wins("z-history", "a-live");
}

#[cfg(unix)]
#[test]
fn ignores_symlinked_and_corrupt_kanban_boards_without_leaking_data() {
    use std::os::unix::fs::symlink;

    let root = tempfile::tempdir().unwrap();
    write_heartbeat(
        &root.path().join("gateway.heartbeat"),
        "2026-09-02T12:00:00Z",
    );
    let private_database = root.path().join("private.db");
    create_kanban_database(&private_database, "t-private", "must-not-leak");

    let boards = root.path().join("kanban/boards");
    let linked_board = boards.join("a-linked");
    fs::create_dir_all(&linked_board).unwrap();
    symlink(&private_database, linked_board.join("kanban.db")).unwrap();
    create_kanban_database(
        &boards.join("b-valid/kanban.db"),
        "t-visible",
        "Visible task",
    );
    fs::create_dir_all(boards.join("z-corrupt")).unwrap();
    fs::write(boards.join("z-corrupt/kanban.db"), b"not a sqlite database").unwrap();

    let agents = read_agent_heartbeats_live(
        root.path(),
        &[config(root.path()).with_identity(
            "unit-default",
            "Default",
            "default-profile",
            "operator",
        )],
    );

    assert_eq!(agents[0].task_id.as_deref(), Some("t-visible"));
    assert_eq!(agents[0].task_title.as_deref(), Some("Visible task"));
    assert!(agents[0].telemetry_partial);
    assert!(
        !serde_json::to_string(&agents)
            .unwrap()
            .contains("must-not-leak")
    );
}

fn empty_board(root: &Path) {
    assert!(Command::new("/usr/bin/sqlite3").arg(root.join("kanban.db"))
        .arg("CREATE TABLE tasks (id TEXT, assignee TEXT, status TEXT, title TEXT, block_kind TEXT, created_at INTEGER); CREATE TABLE task_runs (id INTEGER, task_id TEXT, status TEXT, outcome TEXT, ended_at TEXT);")
        .status().unwrap().success());
}

#[test]
fn empty_valid_board_is_not_a_partial_read() {
    let root = tempfile::tempdir().unwrap();
    empty_board(root.path());
    let snapshot = read_world_snapshot(root.path(), &[config(root.path())]);
    assert!(!snapshot.kanban.partial);
    assert!(snapshot.kanban.tasks.is_empty());
}

#[test]
fn unreadable_sessions_do_not_claim_availability() {
    let root = tempfile::tempdir().unwrap();
    empty_board(root.path());
    fs::write(root.path().join("state.db"), "not sqlite").unwrap();
    let snapshot = read_world_snapshot(root.path(), &[config(root.path())]);
    assert!(snapshot.agents[0].telemetry_partial);
    assert_eq!(snapshot.agents[0].task_phase, "telemetry_unavailable");
    assert!(
        snapshot.agents[0]
            .evidence
            .iter()
            .any(|e| e.source == "hermes-session" && e.error_code.is_some())
    );
}

#[test]
fn confirmed_run_keeps_its_task_and_also_exposes_session() {
    let root = tempfile::tempdir().unwrap();
    create_kanban_database(
        &root.path().join("kanban.db"),
        "confirmed",
        "Confirmed task",
    );
    create_runtime_database(&root.path().join("state.db"), true);
    let snapshot = read_world_snapshot(root.path(), &[config(root.path())]);
    let agent = &snapshot.agents[0];
    assert_eq!(agent.task_phase, "live_run");
    assert_eq!(agent.task_id.as_deref(), Some("confirmed"));
    assert!(agent.board_slug.is_some());
    assert!(agent.session.is_some());
}

#[test]
fn unreadable_board_is_not_a_resting_agent() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("kanban.db"), "not sqlite").unwrap();
    let snapshot = read_world_snapshot(root.path(), &[config(root.path())]);
    assert!(snapshot.kanban.partial);
    assert_eq!(snapshot.agents[0].task_phase, "telemetry_unavailable");
    assert!(snapshot.agents[0].evidence.iter().any(|e|
        e.source == "kanban:default" && e.error_code.as_deref() == Some("schema_read_failed")));
}

#[test]
fn broken_board_does_not_erase_a_run_confirmed_on_another_board() {
    let root = tempfile::tempdir().unwrap();
    create_kanban_database(&root.path().join("kanban/boards/healthy/kanban.db"), "confirmed", "Confirmed task");
    create_runtime_database(&root.path().join("state.db"), false);
    fs::write(root.path().join("kanban.db"), "not sqlite").unwrap();
    let snapshot = read_world_snapshot(root.path(), &[config(root.path())]);
    let agent = &snapshot.agents[0];
    assert!(snapshot.kanban.partial);
    assert!(agent.telemetry_partial);
    assert_eq!(agent.task_phase, "live_run");
    assert_eq!(agent.board_slug.as_deref(), Some("healthy"));
    assert_eq!(agent.task_id.as_deref(), Some("confirmed"));
    assert!(agent.evidence.iter().any(|e| e.source == "kanban:default" && e.error_code.is_some()));
    assert_eq!(snapshot.kanban.tasks.len(), 1);
}

#[test]
fn stale_or_expired_runs_are_not_confirmed_workers() {
    for update in [
        "last_heartbeat_at=unixepoch()-121",
        "claim_expires=unixepoch()-1",
        "last_heartbeat_at=unixepoch()+600",
    ] {
        let root = tempfile::tempdir().unwrap();
        create_kanban_database(&root.path().join("kanban.db"), "stale", "Old task");
        assert!(
            Command::new("/usr/bin/sqlite3")
                .arg(root.path().join("kanban.db"))
                .arg(format!("UPDATE task_runs SET {update}"))
                .status()
                .unwrap()
                .success()
        );
        let snapshot = read_world_snapshot(root.path(), &[config(root.path())]);
        assert_eq!(snapshot.agents[0].task_phase, "telemetry_unavailable");
        assert_eq!(snapshot.kanban.tasks[0].status, "running");
        assert!(
            snapshot.agents[0]
                .evidence
                .iter()
                .any(|e| e.source == "kanban-task" && e.observed_at.is_some())
        );
    }
}

#[test]
fn later_finished_run_supersedes_an_abandoned_running_row() {
    let root = tempfile::tempdir().unwrap();
    create_kanban_database(&root.path().join("kanban.db"), "t", "Task");
    assert!(
        Command::new("/usr/bin/sqlite3")
            .arg(root.path().join("kanban.db"))
            .arg(
                "INSERT INTO task_runs(id,task_id,status,ended_at) VALUES(2,'t','done',unixepoch())"
            )
            .status()
            .unwrap()
            .success()
    );
    assert_ne!(
        read_world_snapshot(root.path(), &[config(root.path())]).agents[0].task_phase,
        "live_run"
    );
}

#[test]
fn absent_runtime_database_is_not_a_readable_empty_source() {
    let root = tempfile::tempdir().unwrap();
    empty_board(root.path());
    let snapshot = read_world_snapshot(root.path(), &[config(root.path())]);
    assert!(snapshot.agents[0].telemetry_partial);
    assert!(
        snapshot.agents[0]
            .evidence
            .iter()
            .any(|e| e.source == "hermes-session" && e.status == "unavailable")
    );
}

#[test]
fn readable_empty_runtime_source_is_distinct_from_missing() {
    let root = tempfile::tempdir().unwrap();
    empty_board(root.path());
    create_runtime_database(&root.path().join("state.db"), false);
    assert!(
        Command::new("/usr/bin/sqlite3")
            .arg(root.path().join("state.db"))
            .arg("DELETE FROM sessions; DELETE FROM session_turn_leases;")
            .status()
            .unwrap()
            .success()
    );
    let snapshot = read_world_snapshot(root.path(), &[config(root.path())]);
    assert!(!snapshot.agents[0].telemetry_partial);
    assert!(
        snapshot.agents[0]
            .evidence
            .iter()
            .any(|e| e.source == "hermes-session" && e.status == "empty")
    );
}
