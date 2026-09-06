import type { AgentHeartbeatDto, WorldSnapshotDto } from './heartbeat';

const names = [
  'Atlas', 'Berlin', 'Dublin', 'Florence', 'Milan AM Labs', 'Montréal',
  'Paris', 'Séoul', 'Singapore', 'Toscane', 'Zurich', 'Alma',
];

export const DEV_WORLD_FIXTURE: WorldSnapshotDto = {
  agents: names.map((displayName, index): AgentHeartbeatDto => {
    const livePhase = index === 0 || index === 1 || index === 9
      ? 'live_run'
      : index === 2 || index === 3 || index === 4
        ? 'live_session'
        : 'available';
    const working = livePhase !== 'available';
    const disconnected = index === 7;
    return ({
    agent_id: `fixture-${index + 1}`,
    display_name: displayName,
    profile: `fixture-${index + 1}`,
    role: 'Agent de démonstration locale',
    observed_state: disconnected ? 'disconnected' : 'connected',
    last_evidence_at: new Date(0).toISOString(),
    age_seconds: disconnected ? 45 : 0,
    source: 'fixture locale',
    confidence: 'test',
    machine_id: 'local-test',
    origin: 'browser-fixture',
    activity: working ? 'working' : 'resting',
    room: working ? 'control-room' : 'break-room',
    task_status: working ? 'running' : null,
    task_title: index === 0
      ? 'Tester le poste dynamique'
      : index === 2
        ? 'Session Hermes active sans Kanban'
        : index === 9
          ? 'Mission Hermes active'
        : null,
    task_phase: livePhase,
    board_slug: index === 0 ? 'local-test' : null,
    task_id: index === 0 ? 'fixture-task' : null,
    waiting_reason: null,
    telemetry_partial: false,
    });
  }),
  kanban: {
    tasks: [{
      board_slug: 'local-test',
      task_id: 'fixture-task',
      title: 'Tester le poste dynamique',
      status: 'running',
      assignee: 'fixture-1',
    }],
    partial: false,
  },
};
