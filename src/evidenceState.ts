import { visualPhaseForAgent, type AgentHeartbeatDto } from './heartbeat';
import { phasePresentation } from './world/placement';

export interface ObservedEvent { id: number; at: number; agentId: string; name: string; message: string }
export function ageEvidence(agent: AgentHeartbeatDto, elapsed: number, stale: boolean): AgentHeartbeatDto {
  return { ...agent, snapshot_stale: stale,
    age_seconds: agent.age_seconds === null ? null : agent.age_seconds + elapsed,
    evidence: agent.evidence?.map((e) => ({ ...e, age_seconds: e.age_seconds === null ? null : e.age_seconds + elapsed })),
  };
}
export function observedChanges(previous: AgentHeartbeatDto[], next: AgentHeartbeatDto[], at: number, initial = false): ObservedEvent[] {
  if (initial) return [];
  const before = new Map(previous.map((a) => [a.agent_id, a]));
  const changes = next.flatMap((agent) => {
    const old = before.get(agent.agent_id);
    if (!old) return [{ id: at, at, agentId: agent.agent_id, name: agent.display_name, message: 'Agent apparu dans l’équipe observée' }];
    const messages: string[] = [];
    if (old.observed_state !== agent.observed_state) messages.push(`Gateway : ${agent.observed_state === 'connected' ? 'reconnexion observée' : 'connexion non confirmée'}`);
    if (visualPhaseForAgent(old) !== visualPhaseForAgent(agent)) messages.push(`État observé : ${phasePresentation(visualPhaseForAgent(old)).label} → ${phasePresentation(visualPhaseForAgent(agent)).label}`);
    if (old.task_id !== agent.task_id || old.board_slug !== agent.board_slug || old.session?.id !== agent.session?.id) messages.push('Changement de tâche/session observé');
    else if (old.waiting_reason !== agent.waiting_reason) messages.push('Motif d’attente modifié');
    return messages.map((message, i) => ({ id: at + i, at, agentId: agent.agent_id, name: agent.display_name, message }));
  });
  const ids = new Set(next.map((a) => a.agent_id));
  return [...changes, ...previous.filter((a) => !ids.has(a.agent_id)).map((a) => ({ id: at, at, agentId: a.agent_id, name: a.display_name, message: 'Agent absent de l’équipe observée — aucune conclusion sur ses tâches' }))];
}
