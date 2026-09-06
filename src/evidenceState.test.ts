import { describe, expect, it } from 'vitest';
import { ageEvidence, observedChanges } from './evidenceState';
import { visualPhaseForAgent, type AgentHeartbeatDto } from './heartbeat';
const agent = { agent_id: 'a', display_name: 'Atlas', observed_state: 'disconnected', task_phase: 'live_session', age_seconds: 90,
  evidence: [{ source: 'hermes-session', status: 'active', age_seconds: 2, observed_at: null, confidence: 'lease', error_code: null }],
} as AgentHeartbeatDto;
describe('honest evidence', () => {
  it('does not replace a live session with an old gateway status', () => expect(visualPhaseForAgent(agent)).toBe('live_session'));
  it('ages all proofs and never calls stale snapshots current', () => {
    const aged = ageEvidence(agent, 18, true);
    expect(aged.age_seconds).toBe(108); expect(aged.evidence?.[0].age_seconds).toBe(20);
    expect(visualPhaseForAgent(aged)).toBe('telemetry_unavailable'); expect(agent.age_seconds).toBe(90);
  });
  it('does not fabricate history on startup or a success from disappearance', () => {
    expect(observedChanges([], [agent], 1, true)).toEqual([]);
    expect(observedChanges([agent], [], 1)[0].message).toContain('aucune conclusion');
    expect(observedChanges([agent], [agent], 1)).toEqual([]);
    expect(observedChanges([agent], [{ ...agent, observed_state: 'connected' }], 1)[0].message).toContain('reconnexion');
  });
  it('observes arrivals after an empty read and identical task IDs across boards', () => {
    expect(observedChanges([], [agent], 2)[0].message).toContain('apparu');
    expect(observedChanges([{ ...agent, board_slug: 'a', task_id: '1' }], [{ ...agent, board_slug: 'b', task_id: '1' }], 3)[0].message).toContain('Changement de tâche');
  });
});
