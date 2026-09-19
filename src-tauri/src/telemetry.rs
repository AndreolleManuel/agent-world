use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ObservedState {
    Connected,
    Disconnected,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
pub struct SourceEvidence {
    pub source: String,
    pub status: String,
    pub observed_at: Option<String>,
    pub age_seconds: Option<u64>,
    pub confidence: String,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionEvidence {
    pub id: String,
    pub title: String,
    pub observed_at: String,
    pub age_seconds: u64,
    pub confidence: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
pub struct KanbanSnapshotDto {
    pub tasks: Vec<KanbanTaskDto>,
    pub partial: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorldSnapshotDto {
    pub agents: Vec<AgentHeartbeatDto>,
    pub kanban: KanbanSnapshotDto,
    pub collected_at: String,
    pub collection_ms: u64,
}
