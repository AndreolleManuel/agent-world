//! Protocol 2: bounded metadata only. Shared by exporter, reader and desktop.
use crate::telemetry::*;
use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
pub const PROTOCOL: u8 = 2;
pub const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
#[allow(dead_code)] // Request-side API is used by the separate reader.
pub const MAX_REQUEST_BYTES: usize = 64;
const MAX_AGE: u64 = 315_576_000;
const PHASES: &[&str] = &[
    "available",
    "live_run",
    "live_session",
    "review_pending",
    "blocked",
    "ready_unclaimed",
    "todo_not_started",
    "telemetry_unavailable",
];
const STATUSES: &[&str] = &[
    "todo",
    "ready",
    "running",
    "review",
    "blocked",
    "triage",
    "done",
    "cancelled",
    "archived",
];

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub protocol: u8,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Response {
    pub protocol: u8,
    // Opaque source identity, never a path on the exporting machine.
    pub source_id: String,
    pub snapshot: WorldSnapshotDto,
}

#[allow(dead_code)] // Request-side API is used by the separate reader.
pub fn parse_request(bytes: &[u8]) -> Result<Request, &'static str> {
    if bytes.len() > MAX_REQUEST_BYTES {
        return Err("request_limit");
    }
    let request: Request = serde_json::from_slice(bytes).map_err(|_| "invalid_request")?;
    if request.protocol != PROTOCOL {
        return Err("protocol_mismatch");
    }
    Ok(request)
}

fn opaque(s: &str) -> bool {
    s.len() == 32
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn text(s: &str, max: usize) -> bool {
    s.len() <= max
        && !s.chars().any(|c| {
            c.is_control() || matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
}
fn stamp(s: &str) -> bool {
    s.len() <= 35
        && OffsetDateTime::parse(s, &Rfc3339).is_ok_and(|t| (2000..=2100).contains(&t.year()))
}
fn age_time(at: &Option<String>, age: Option<u64>) -> bool {
    match (at, age) {
        (None, None) => true,
        (Some(at), Some(age)) => stamp(at) && age <= MAX_AGE,
        _ => false,
    }
}
fn epoch(t: i64) -> bool {
    (0..=4_133_980_800).contains(&t)
}

pub fn validate(response: &Response) -> Result<(), &'static str> {
    if response.protocol != PROTOCOL {
        return Err("protocol_mismatch");
    }
    let world = &response.snapshot;
    if !opaque(&response.source_id)
        || world.agents.len() > 256
        || world.kanban.tasks.len() > 512
        || !stamp(&world.collected_at)
        || world.collection_ms > 60_000
    {
        return Err("invalid_response");
    }
    let mut ids = std::collections::HashSet::new();
    for a in &world.agents {
        if !opaque(&a.agent_id)
            || !ids.insert(&a.agent_id)
            || a.profile != a.agent_id
            || a.role != "agent"
            || a.machine_id != "export"
            || a.origin != "export"
            || a.source != "gateway.heartbeat"
            || !text(&a.display_name, 256)
            || !["direct", "unavailable"].contains(&a.confidence.as_str())
            || !PHASES.contains(&a.task_phase.as_str())
            || !["working", "resting", "waiting", "unavailable"].contains(&a.activity.as_str())
            || !["execution", "rest", "waiting", "unavailable"].contains(&a.room.as_str())
            || !age_time(&a.last_evidence_at, a.age_seconds)
            || a.evidence.len() > 8
            || a.task_status
                .as_deref()
                .is_some_and(|s| !STATUSES.contains(&s))
            || a.task_title.as_deref().is_some_and(|s| !text(s, 512))
            || a.waiting_reason.is_some()
            || a.board_slug.as_deref().is_some_and(|s| !opaque(s))
            || a.task_id.as_deref().is_some_and(|s| !opaque(s))
        {
            return Err("invalid_response");
        }
        for e in &a.evidence {
            if ![
                "gateway.heartbeat",
                "hermes-session",
                "kanban",
                "kanban-task",
            ]
            .contains(&e.source.as_str())
                || ![
                    "readable",
                    "stale",
                    "unavailable",
                    "empty",
                    "active",
                    "available",
                    "live_run",
                    "live_session",
                    "review_pending",
                    "blocked",
                    "ready_unclaimed",
                    "todo_not_started",
                    "telemetry_unavailable",
                ]
                .contains(&e.status.as_str())
                || ![
                    "direct",
                    "unknown",
                    "declared",
                    "observed",
                    "lease",
                    "inferred-tool",
                    "recent-worker",
                ]
                .contains(&e.confidence.as_str())
                || !age_time(&e.observed_at, e.age_seconds)
                || e.error_code.as_deref().is_some_and(|s| s != "partial_read")
            {
                return Err("invalid_response");
            }
        }
        if let Some(s) = &a.session
            && (!opaque(&s.id)
                || !text(&s.title, 512)
                || !stamp(&s.observed_at)
                || s.age_seconds > MAX_AGE
                || !["lease", "inferred-tool"].contains(&s.confidence.as_str()))
        {
            return Err("invalid_response");
        }
    }
    let mut tasks = std::collections::HashSet::new();
    for t in &world.kanban.tasks {
        if !opaque(&t.board_slug)
            || !opaque(&t.task_id)
            || !tasks.insert((&t.board_slug, &t.task_id))
            || !text(&t.title, 512)
            || !STATUSES.contains(&t.status.as_str())
            || t.waiting_reason.is_some()
            || t.assignee.as_ref().is_some_and(|id| !ids.contains(id))
            || !epoch(t.created_at)
            || t.run_observed_at.is_some_and(|t| !epoch(t))
        {
            return Err("invalid_response");
        }
    }
    Ok(())
}

pub fn parse_response(bytes: &[u8]) -> Result<Response, &'static str> {
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("response_limit");
    }
    // serde_json's default recursion limit is kept enabled (128).
    let response: Response = serde_json::from_slice(bytes).map_err(|_| "invalid_response")?;
    validate(&response)?;
    Ok(response)
}

pub fn age_snapshot(response: &mut Response, now: OffsetDateTime) -> Result<(), &'static str> {
    let collected = OffsetDateTime::parse(&response.snapshot.collected_at, &Rfc3339)
        .map_err(|_| "invalid_response")?;
    let delta = (now - collected).whole_seconds();
    if !(-5..=30).contains(&delta) {
        return Err("remote_clock_or_stale");
    }
    // Re-reading a cached export must never refresh the age of its evidence.
    for a in &mut response.snapshot.agents {
        fn age(at: &Option<String>, old: &mut Option<u64>, now: OffsetDateTime) {
            if let Some(t) = at
                .as_ref()
                .and_then(|s| OffsetDateTime::parse(s, &Rfc3339).ok())
            {
                *old = Some(
                    old.unwrap_or(0)
                        .max((now - t).whole_seconds().max(0) as u64),
                );
            }
        }
        age(&a.last_evidence_at, &mut a.age_seconds, now);
        for e in &mut a.evidence {
            age(&e.observed_at, &mut e.age_seconds, now);
        }
        if let Some(s) = &mut a.session {
            let t =
                OffsetDateTime::parse(&s.observed_at, &Rfc3339).map_err(|_| "invalid_response")?;
            s.age_seconds = s.age_seconds.max((now - t).whole_seconds().max(0) as u64);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    pub fn response() -> Response {
        Response {
            protocol: PROTOCOL,
            source_id: "a".repeat(32),
            snapshot: WorldSnapshotDto {
                agents: vec![],
                kanban: KanbanSnapshotDto {
                    tasks: vec![],
                    partial: false,
                },
                collected_at: "2026-09-19T12:00:00Z".into(),
                collection_ms: 1,
            },
        }
    }
    #[test]
    fn rejects_legacy_requests_paths_unknown_fields_and_deep_json() {
        assert!(parse_request(br#"{"protocol":2}"#).is_ok());
        for b in [
            br#"{"protocol":1}"#.as_slice(),
            br#"{"protocol":2,"root":"/private"}"#,
            br#"{"protocol":2,"command":"id"}"#,
        ] {
            assert!(parse_request(b).is_err());
        }
        assert!(parse_request(&[b' '; 65]).is_err());
        assert!(parse_response(&vec![b' '; MAX_RESPONSE_BYTES + 1]).is_err());
        assert!(
            parse_response(format!("{}0{}", "[".repeat(200), "]".repeat(200)).as_bytes()).is_err()
        );
        assert!(parse_response(&serde_json::to_vec(&response()).unwrap()).is_ok());
    }
    #[test]
    fn rejects_paths_wrong_versions_and_invalid_dates_without_echoing_payload() {
        let mut r = response();
        r.source_id = "/private/SECRET".into();
        assert_eq!(validate(&r), Err("invalid_response"));
        r.source_id = "a".repeat(32);
        r.protocol = 1;
        assert_eq!(validate(&r), Err("protocol_mismatch"));
        r.protocol = PROTOCOL;
        r.snapshot.collected_at = "yesterday".into();
        assert!(validate(&r).is_err());
    }
    #[test]
    fn replay_does_not_become_fresh() {
        let mut r = response();
        assert!(
            age_snapshot(
                &mut r,
                OffsetDateTime::parse("2026-09-19T12:00:31Z", &Rfc3339).unwrap()
            )
            .is_err()
        );
    }
}
