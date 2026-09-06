import { invoke } from '@tauri-apps/api/core';

export type ObservedState = 'connected' | 'disconnected' | 'unavailable';

export interface HeartbeatDto {
  agent_id: string;
  profile: string;
  role: string;
  observed_state: ObservedState;
  last_evidence_at: string;
  age_seconds: number;
  source: string;
  confidence: string;
  machine_id: string;
  origin: string;
}

export interface AgentHeartbeatDto {
  agent_id: string;
  display_name: string;
  profile: string;
  role: string;
  observed_state: ObservedState;
  last_evidence_at: string | null;
  age_seconds: number | null;
  source: string;
  confidence: string;
  machine_id: string;
  origin: string;
  activity: string;
  room: string;
  task_status: string | null;
  task_title: string | null;
  task_phase: string;
  board_slug: string | null;
  task_id: string | null;
  waiting_reason: string | null;
  telemetry_partial: boolean;
  evidence?: SourceEvidence[];
  snapshot_stale?: boolean;
  session?: { id: string; title: string; observed_at: string; age_seconds: number; confidence: string } | null;
}

export interface SourceEvidence {
  source: string;
  status: string;
  observed_at: string | null;
  age_seconds: number | null;
  confidence: string;
  error_code: string | null;
}

export interface KanbanTaskDto {
  board_slug: string;
  task_id: string;
  title: string;
  status: string;
  assignee: string | null;
  waiting_reason?: string | null;
  created_at?: number;
  run_observed_at?: number | null;
}

export interface KanbanSnapshotDto {
  tasks: KanbanTaskDto[];
  partial: boolean;
}

export interface WorldSnapshotDto {
  agents: AgentHeartbeatDto[];
  kanban: KanbanSnapshotDto;
  collected_at?: string;
  collection_ms?: number;
}

export function visualPhaseForAgent(agent: AgentHeartbeatDto): string {
  if (agent.snapshot_stale) return 'telemetry_unavailable';
  if (agent.task_phase === 'telemetry_unavailable') return 'telemetry_unavailable';
  if (agent.evidence?.some((e) =>
    (e.source === 'hermes-session' && e.status === 'active')
    || (e.source === 'kanban-task' && e.status === 'live_run'))) return agent.task_phase;
  if (agent.telemetry_partial && agent.task_phase === 'available') return 'telemetry_unavailable';
  if (agent.evidence?.some((e) => e.source === 'kanban-task' && ['review_pending', 'blocked'].includes(e.status))) return agent.task_phase;
  return agent.observed_state === 'connected'
    ? agent.task_phase
    : 'telemetry_unavailable';
}

export function loadHeartbeat(): Promise<HeartbeatDto> {
  return invoke<HeartbeatDto>('read_gateway_heartbeat');
}

export function loadAgentHeartbeats(): Promise<AgentHeartbeatDto[]> {
  return invoke<AgentHeartbeatDto[]>('read_agent_heartbeats');
}

export function loadKanban(): Promise<KanbanSnapshotDto> {
  return invoke<KanbanSnapshotDto>('read_kanban');
}

export function loadWorldSnapshot(): Promise<WorldSnapshotDto> {
  return invoke<WorldSnapshotDto>('read_world_snapshot');
}
