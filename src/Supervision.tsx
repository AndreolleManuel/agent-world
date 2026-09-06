import { useState } from 'react';
import { visualPhaseForAgent, type AgentHeartbeatDto, type KanbanSnapshotDto } from './heartbeat';
import { phasePresentation } from './world/placement';
import type { ObservedEvent } from './evidenceState';

export default function Supervision({ agents, kanban, events, onSelect, mode, setMode, filter, setFilter, overflowIds, hideNavigation = false, readyOnly = false, setReadyOnly }: {
  agents: AgentHeartbeatDto[]; kanban: KanbanSnapshotDto; events: ObservedEvent[];
  onSelect: (id: string) => void; mode: string; setMode: (mode: string) => void;
  filter: string; setFilter: (filter: string) => void; overflowIds: Set<string>;
  hideNavigation?: boolean;
  readyOnly?: boolean; setReadyOnly?: (value: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [board, setBoard] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [assignee, setAssignee] = useState('');
  const match = (text: string) => text.toLocaleLowerCase('fr').includes(query.trim().toLocaleLowerCase('fr'));
  const filtered = agents.filter((a) => match(`${a.display_name} ${a.profile} ${a.task_title ?? ''}`)
    && (filter === 'all' || (filter === 'active' ? ['live_run', 'live_session'].includes(visualPhaseForAgent(a)) : visualPhaseForAgent(a) === filter)));
  const names = new Map(agents.map((a) => [a.profile, a.display_name]));
  const tasks = kanban.tasks.filter((t) => match(`${t.title} ${t.board_slug} ${t.task_id} ${names.get(t.assignee ?? '') ?? t.assignee ?? ''}`)
    && (!readyOnly || (t.status === 'ready' && !t.assignee))
    && (board === '' || t.board_slug === board)
    && (statusFilter === 'all' || t.status === statusFilter || (statusFilter === 'blocked' && t.status === 'triage'))
    && (assignee === '' || (assignee === '!unassigned' ? !t.assignee : t.assignee === assignee)));
  const columns = [['todo', 'À faire'], ['ready', 'Prêtes'], ['running', 'En cours'], ['review', 'En revue'], ['blocked', 'Bloquées / triage']];
  return <section className="operations-panel" aria-label="Supervision détaillée">
    <div className="world-toolbar">
      {!hideNavigation && <><button aria-pressed={mode === 'agents'} onClick={() => setMode('agents')}>Équipe · {agents.length}</button>
      <button aria-pressed={mode === 'kanban'} onClick={() => setMode('kanban')}>Kanban · {kanban.tasks.length}</button>
      <button aria-pressed={mode === 'events'} onClick={() => setMode('events')}>Journal · {events.length}</button></>}
      <input type="search" aria-label="Rechercher dans la supervision" placeholder="Agent, tâche, board…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {mode === 'agents' && <select aria-label="Filtrer les agents" value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="all">Tous les états</option><option value="active">Actifs</option><option value="available">Disponibles · pause</option>
        <option value="blocked">Bloqués</option><option value="review_pending">En revue</option><option value="telemetry_unavailable">Preuve indisponible</option>
      </select>}
    </div>
    {mode === 'kanban' && <div className="world-toolbar task-filters">
      <select aria-label="Filtrer par board" value={board} onChange={(e) => setBoard(e.target.value)}><option value="">Tous les boards</option>
        {[...new Set(kanban.tasks.map((t) => t.board_slug))].sort().map((slug) => <option key={slug}>{slug}</option>)}</select>
      <select aria-label="Filtrer les cartes par statut" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">Tous les statuts</option>
        {columns.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="Filtrer par assignation" value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Toutes les assignations</option><option value="!unassigned">Non assignées</option>
        {[...new Set(kanban.tasks.map((t) => t.assignee).filter((s): s is string => !!s))].sort().map((slug) => <option key={slug} value={slug}>{names.get(slug) ?? slug}</option>)}</select>
      {setReadyOnly && <label><input type="checkbox" checked={readyOnly} onChange={(e) => setReadyOnly(e.target.checked)} /> À prendre uniquement</label>}
    </div>}
    {mode === 'agents' && <><h2>Équipe · {filtered.length} résultats</h2><div className="agent-list">{filtered.map((a) => <button key={a.agent_id} onClick={() => onSelect(a.agent_id)}>
      <strong>{a.display_name}</strong><span>{phasePresentation(visualPhaseForAgent(a)).label}</span>
      <small>{a.task_title ?? 'Aucune tâche active lisible'}{overflowIds.has(a.agent_id) ? ' · hors scène : capacité atteinte' : ''}</small>
    </button>)}</div>{!filtered.length && <p>Aucun agent ne correspond.</p>}</>}
    {mode === 'kanban' && <><h2>Kanban lisible · {tasks.length} cartes</h2>
      <p className="simulation-note">« En cours » est le statut déclaré de la carte ; la fiche de l’agent indique si un worker récent est confirmé.</p>
      {kanban.partial && <p role="status">Lecture partielle : des cartes peuvent manquer.</p>}
      <div className="kanban-grid">{columns.map(([status, label]) => <section className="kanban-column" key={status}><h3>{label}</h3>
        {tasks.filter((t) => t.status === status || (status === 'blocked' && t.status === 'triage')).map((t) => <article className="task-card" key={`${t.board_slug}:${t.task_id}`}>
          <strong>{t.title}</strong><p>{names.get(t.assignee ?? '') ?? t.assignee ?? 'Non assignée'}</p>
          {t.waiting_reason && <p>{t.waiting_reason}</p>}<small>{t.board_slug} · {t.task_id}</small>
          {!!t.created_at && <p><small>Créée le {new Date(t.created_at * 1000).toLocaleString('fr-FR')}</small></p>}
          {agents.some((a) => a.profile === t.assignee) && <p><button onClick={() => onSelect(agents.find((a) => a.profile === t.assignee)!.agent_id)}>Voir les preuves de l’agent</button></p>}
        </article>)}</section>)}</div>{!tasks.length && <p>Aucune carte correspondante dans les sources lisibles.</p>}</>}
    {mode === 'events' && <><h2>Changements observés</h2><p className="simulation-note">Depuis cette ouverture uniquement · 100 événements maximum · les changements entre deux lectures peuvent ne pas être observés. Une disparition de carte n’est pas une preuve de réussite.</p>
      <ol className="event-list">{events.filter((e) => match(`${e.name} ${e.message}`)).map((e) => <li key={`${e.id}:${e.agentId}:${e.message}`}><time>{new Date(e.at).toLocaleTimeString('fr-FR')}</time> · {e.name} · {e.message}</li>)}</ol>
      {!events.length && <p>Aucun changement observé depuis l’ouverture.</p>}</>}
  </section>;
}
