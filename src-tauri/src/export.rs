//! Privacy is enforced at the source; client input cannot enable extra fields.
use crate::{
    heartbeat,
    remote_protocol::{self, PROTOCOL, Response},
    telemetry::*,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, io::Read, path::Path};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    pub salt: String,
    pub profiles: Vec<String>,
    #[serde(default)]
    pub disclose_names: bool,
    #[serde(default)]
    pub disclose_titles: bool,
}
impl Policy {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.salt.len() != 64
            || !self.salt.bytes().all(|b| b.is_ascii_hexdigit())
            || self.profiles.is_empty()
            || self.profiles.len() > 256
            || self.profiles.iter().any(|p| {
                p.is_empty()
                    || p.len() > 64
                    || !p
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
            })
            || self.profiles.iter().collect::<HashSet<_>>().len() != self.profiles.len()
        {
            return Err("invalid_export_policy");
        }
        Ok(())
    }
    pub fn id(&self, namespace: &str, raw: &str) -> String {
        let mut hash = Sha256::new();
        for part in [&self.salt, namespace, raw] {
            hash.update(part.as_bytes());
            hash.update([0]);
        }
        format!("{:x}", hash.finalize())[..32].to_owned()
    }
}

#[allow(dead_code)] // Used by the separate administrative exporter.
pub fn read_policy(path: &Path) -> Result<Policy, &'static str> {
    use std::os::unix::fs::OpenOptionsExt;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "policy_unavailable")?;
    let meta = file.metadata().map_err(|_| "policy_unavailable")?;
    if !meta.is_file() || meta.len() > 32768 {
        return Err("invalid_export_policy");
    }
    let mut bytes = Vec::new();
    file.take(32769)
        .read_to_end(&mut bytes)
        .map_err(|_| "policy_unavailable")?;
    if bytes.len() > 32768 {
        return Err("invalid_export_policy");
    }
    let policy: Policy = serde_json::from_slice(&bytes).map_err(|_| "invalid_export_policy")?;
    policy.validate()?;
    Ok(policy)
}

#[allow(dead_code)] // Used by the separate administrative exporter and privacy tests.
pub fn collect(root: &Path, policy: &Policy) -> Result<Response, &'static str> {
    policy.validate()?;
    let registry = heartbeat::discover_agent_registry(root).map_err(|_| "registry_unavailable")?;
    let selected: Vec<_> = registry
        .into_iter()
        .filter(|c| policy.profiles.iter().any(|p| p == c.agent_id()))
        .collect();
    if selected.len() != policy.profiles.len() {
        return Err("registry_changed");
    }
    redact(heartbeat::read_world_snapshot(root, &selected), policy)
}

pub fn redact(mut world: WorldSnapshotDto, policy: &Policy) -> Result<Response, &'static str> {
    policy.validate()?;
    let allowed: HashSet<_> = policy.profiles.iter().map(String::as_str).collect();
    world
        .agents
        .retain(|a| allowed.contains(a.agent_id.as_str()));
    // Unassigned/other-profile tasks are not published merely because they share a DB.
    world
        .kanban
        .tasks
        .retain(|t| t.assignee.as_deref().is_some_and(|id| allowed.contains(id)));
    for (index, a) in world.agents.iter_mut().enumerate() {
        a.agent_id = policy.id("agent", &a.agent_id);
        a.profile = a.agent_id.clone();
        if !policy.disclose_names {
            a.display_name = format!("Agent {}", index + 1);
        }
        a.role = "agent".into();
        a.machine_id = "export".into();
        a.origin = "export".into();
        a.source = "gateway.heartbeat".into();
        a.confidence = if a.observed_state == ObservedState::Unavailable {
            "unavailable"
        } else {
            "direct"
        }
        .into();
        a.waiting_reason = None;
        if !policy.disclose_titles {
            a.task_title = a.task_title.as_ref().map(|_| "Tâche privée".into());
        }
        a.board_slug = a.board_slug.as_ref().map(|s| policy.id("board", s));
        a.task_id = a.task_id.as_ref().map(|s| policy.id("task", s));
        a.activity = match a.task_phase.as_str() {
            "live_run" | "live_session" => "working",
            "available" => "resting",
            "telemetry_unavailable" => "unavailable",
            _ => "waiting",
        }
        .into();
        a.room = match a.activity.as_str() {
            "working" => "execution",
            "resting" => "rest",
            "waiting" => "waiting",
            _ => "unavailable",
        }
        .into();
        a.evidence.retain(|e| {
            [
                "gateway.heartbeat",
                "hermes-session",
                "kanban",
                "kanban-task",
            ]
            .contains(&e.source.as_str())
        });
        for e in &mut a.evidence {
            if e.error_code.is_some() {
                e.error_code = Some("partial_read".into());
            }
        }
        if let Some(s) = &mut a.session {
            s.id = policy.id("session", &s.id);
            if !policy.disclose_titles {
                s.title = "Session privée".into();
            }
        }
    }
    for t in &mut world.kanban.tasks {
        t.board_slug = policy.id("board", &t.board_slug);
        t.task_id = policy.id("task", &t.task_id);
        t.assignee = t.assignee.as_ref().map(|s| policy.id("agent", s));
        t.waiting_reason = None;
        if !policy.disclose_titles {
            t.title = "Tâche privée".into();
        }
    }
    let response = Response {
        protocol: PROTOCOL,
        source_id: policy.id("source", "export"),
        snapshot: world,
    };
    remote_protocol::validate(&response)?;
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn privacy_is_an_allowlist_and_ids_are_scoped_by_source() {
        let mut p = Policy {
            salt: "a".repeat(64),
            profiles: vec!["default".into()],
            disclose_names: false,
            disclose_titles: false,
        };
        let fixture = tempfile::tempdir().unwrap();
        std::fs::write(
            fixture.path().join("profile.yaml"),
            "display_name: PRIVATE_SENTINEL\nsecret: PRIVATE_SENTINEL\n",
        )
        .unwrap();
        let r = collect(fixture.path(), &p).unwrap();
        let json = serde_json::to_string(&r).unwrap();
        assert!(!json.contains("PRIVATE_SENTINEL"));
        assert!(!json.contains(fixture.path().to_str().unwrap()));
        assert_eq!(r.snapshot.agents[0].display_name, "Agent 1");
        let old_id = p.id("agent", "default");
        p.salt = "b".repeat(64);
        assert_ne!(old_id, p.id("agent", "default"));
        p.profiles.clear();
        assert!(p.validate().is_err());
    }
}

#[cfg(test)]
mod hostile_tests {
    use super::*;
    #[test]
    fn field_limits_and_unknown_metadata_are_rejected_before_rendering() {
        let fixture = tempfile::tempdir().unwrap();
        std::fs::write(fixture.path().join("profile.yaml"), "display_name: Fixture").unwrap();
        let policy = Policy {
            salt: "a".repeat(64),
            profiles: vec!["default".into()],
            disclose_names: false,
            disclose_titles: false,
        };
        let value = serde_json::to_value(collect(fixture.path(), &policy).unwrap()).unwrap();
        for (field, bad) in [
            ("task_phase", serde_json::json!("constructor")),
            ("agent_id", serde_json::json!("__proto__")),
            ("task_title", serde_json::json!("x".repeat(513))),
            ("display_name", serde_json::json!("<script>\u{202e}")),
            ("age_seconds", serde_json::json!(u64::MAX)),
            ("role", serde_json::json!("admin")),
            ("extra_secret", serde_json::json!("SECRET")),
        ] {
            let mut v = value.clone();
            v["snapshot"]["agents"][0][field] = bad;
            assert!(
                remote_protocol::parse_response(&serde_json::to_vec(&v).unwrap()).is_err(),
                "{field}"
            );
        }
        let mut v = value.clone();
        let a = v["snapshot"]["agents"][0].clone();
        v["snapshot"]["agents"].as_array_mut().unwrap().push(a);
        assert!(remote_protocol::parse_response(&serde_json::to_vec(&v).unwrap()).is_err());
        let mut v = value;
        v["snapshot"]["agents"][0]["task_title"] = serde_json::json!("x".repeat(512));
        assert!(remote_protocol::parse_response(&serde_json::to_vec(&v).unwrap()).is_ok());
    }
}
