import { useCallback, useState } from 'react';
import App from './App';
import { DEV_WORLD_FIXTURE } from './devFixture';
import type { WorldSnapshotDto } from './heartbeat';

export function scenarioWorld(scenario: string): WorldSnapshotDto {
  const count = scenario === 'crowded' ? 40 : scenario === 'pause' || scenario === 'work' || scenario === 'unknown' ? 10 : scenario === 'empty' ? 0 : 12;
  const agents = Array.from({ length: count }, (_, i) => {
    const base = DEV_WORLD_FIXTURE.agents[i % DEV_WORLD_FIXTURE.agents.length];
    const phase = scenario === 'unknown' ? 'telemetry_unavailable' : scenario === 'pause' ? 'available' : scenario === 'work' || scenario === 'crowded' ? 'live_run'
      : scenario === 'statuses' ? ['live_run', 'live_session', 'review_pending', 'blocked', 'available', 'telemetry_unavailable'][i % 6] : base.task_phase;
    return { ...base, agent_id: `fixture-${i + 1}`, profile: `fixture-${i + 1}`, display_name: i < 12 ? base.display_name : `Agent ${i + 1}`,
      task_phase: phase, observed_state: phase === 'telemetry_unavailable' ? 'unavailable' as const : 'connected' as const,
      task_id: phase === 'available' || phase === 'telemetry_unavailable' ? null : `task-${i}`,
      task_title: phase === 'available' || phase === 'telemetry_unavailable' ? null : `Vérification ${i + 1} — scénario ${scenario}`,
      board_slug: 'validation',
      room: phase === 'available' ? 'break-room' : 'control-room', age_seconds: 0, last_evidence_at: new Date().toISOString(),
      waiting_reason: phase === 'blocked' ? 'Décision humaine attendue' : null,
    };
  });
  return { agents, collected_at: new Date().toISOString(), collection_ms: 2, kanban: { partial: false,
    tasks: agents.filter((a) => a.task_title).map((a) => ({ board_slug: 'validation', task_id: a.task_id!, title: a.task_title!,
      status: a.task_phase === 'blocked' ? 'blocked' : a.task_phase === 'review_pending' ? 'review'
        : a.task_phase === 'ready_unclaimed' ? 'ready' : a.task_phase === 'todo_not_started' ? 'todo' : 'running',
      assignee: a.profile,
      waiting_reason: a.waiting_reason, created_at: Math.floor(Date.now() / 1000) - 600,
    })),
  } };
}

export default function FixtureLab() {
  const [scenario, setScenario] = useState('mixed');
  const load = useCallback(async () => {
    if (scenario === 'error') throw new Error('simulated_source_failure');
    return scenarioWorld(scenario);
  }, [scenario]);
  return <div className="fixture-shell"><div className="fixture-toolbar"><label>Scénario de vérification <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
    <option value="mixed">Mixte</option><option value="work">10 au travail</option><option value="pause">10 en pause</option><option value="unknown">10 sans télémétrie</option>
    <option value="crowded">40 actifs · capacité dépassée</option><option value="statuses">États mélangés</option>
    <option value="empty">Registre vide</option><option value="error">Lecture en échec</option>
  </select></label><span>Développement uniquement · changer de scénario teste aussi les trajets</span><a href="/">Revenir aux données locales</a></div>
    <App loadWorldSnapshot={load} dataMode="fixture" /></div>;
}
