import { own, dictionary } from './records';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  loadAgentHeartbeats as loadAgentHeartbeatsFromBackend,
  loadKanban as loadKanbanFromBackend,
  loadWorldSnapshot as loadWorldSnapshotFromBackend,
} from './heartbeat';
import type {
  AgentHeartbeatDto,
  KanbanSnapshotDto,
  ObservedState,
  WorldSnapshotDto,
} from './heartbeat';
import { visualPhaseForAgent } from './heartbeat';
import {
  phasePresentation,
  placementFor,
  reconcileDeskPresence,
  reconcilePhaseSlots,
  type DeskPresence,
  type PhaseSlotAssignments,
  type SpritePoint,
  type WorldScene,
} from './world/placement';
import PixiWorld from './world/PixiWorld';
import type { AgentMotion } from './world/renderer';
import './styles.css';
import Supervision from './Supervision';
import KanbanDialog from './KanbanDialog';
import CompanyLink from './CompanyLink';
import { ageEvidence, observedChanges, type ObservedEvent } from './evidenceState';

const DEFAULT_REFRESH_INTERVAL_MS = 5_000;


const stateLabels: Record<ObservedState, string> = {
  connected: 'Connecté',
  disconnected: 'Déconnecté',
  unavailable: 'Indisponible',
};

interface AppProps {
  remoteSourceLabel?: string;
  configurationNotice?: string;
  onConfigure?: () => void;
  loadAgentHeartbeats?: () => Promise<AgentHeartbeatDto[]>;
  loadKanban?: () => Promise<KanbanSnapshotDto>;
  loadWorldSnapshot?: () => Promise<WorldSnapshotDto>;
  refreshIntervalMs?: number;
  dataMode?: 'live' | 'fixture';
}

function ageLabel(ageSeconds: number | null): string {
  if (ageSeconds === null) return 'Aucune preuve live exploitable';
  if (ageSeconds < 60) return `il y a ${ageSeconds} s`;
  return `il y a ${Math.floor(ageSeconds / 60)} min`;
}

function evidenceTimeLabel(value: string | null): string {
  if (!value) return 'Non disponible';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Non disponible';
  return parsed.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function worldSceneForPhase(phase: string): WorldScene {
  return phase === 'available' ? 'break-room' : 'control-room';
}

function pointsDiffer(origin: SpritePoint, destination: SpritePoint): boolean {
  return origin.x !== destination.x || origin.y !== destination.y;
}


function App(props: AppProps) {
  const refreshIntervalMs = props.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  const dataMode = props.dataMode ?? 'live';
  const loadAgentHeartbeats = props.loadAgentHeartbeats ?? loadAgentHeartbeatsFromBackend;
  const loadKanban = props.loadKanban ?? loadKanbanFromBackend;
  const loadWorldSnapshot = props.loadWorldSnapshot
    ?? (!props.loadAgentHeartbeats && !props.loadKanban ? loadWorldSnapshotFromBackend : undefined);
  const [agents, setAgents] = useState<AgentHeartbeatDto[]>([]);
  const [kanban, setKanban] = useState<KanbanSnapshotDto>({ tasks: [], partial: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lastSuccessfulRead, setLastSuccessfulRead] = useState<number | null>(null);
  const [collection, setCollection] = useState<{ at: string; ms: number } | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [mode, setMode] = useState('agents');
  const [sceneExpanded, setSceneExpanded] = useState(false);
  const [kanbanOpen, setKanbanOpen] = useState(false);
  const [readyOnly, setReadyOnly] = useState(false);
  const evidencePanelRef = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState('all');
  const [events, setEvents] = useState<ObservedEvent[]>([]);
  const previousAgents = useRef<AgentHeartbeatDto[]>([]);
  const [motionBlocked, setMotionBlocked] = useState<Record<string, boolean>>({});
  const [reducedMotion, setReducedMotion] = useState(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [spriteMotions, setSpriteMotions] = useState<Record<string, AgentMotion>>({});
  const mountedRef = useRef(true);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const positionsRef = useRef<Record<string, SpritePoint>>({});
  const phaseSlotsRef = useRef<PhaseSlotAssignments>({});
  const deskPresenceRef = useRef<DeskPresence>({});
  const initializedRef = useRef(false);


  const refresh = useCallback((manual = false) => {
    // Background polling stays visually quiet; a manual click can join it.
    if (manual) setRefreshing(true);
    if (inFlightRef.current) return inFlightRef.current;
    const read = loadWorldSnapshot
      ? loadWorldSnapshot().then(({ agents: nextAgents, kanban: nextKanban, collected_at, collection_ms }) => [
        nextAgents,
        nextKanban,
        { at: collected_at, ms: collection_ms },
      ] as const)
      : Promise.all([loadAgentHeartbeats(), loadKanban()]);
    const request = read
      .then(([nextAgents, nextKanban, metadata]) => {
        if (!mountedRef.current) return;
        const previousPositions = positionsRef.current;
        const nextPositions = dictionary<SpritePoint>();
        const nextMotions = dictionary<AgentMotion>();

        const initialPopulation = !initializedRef.current;
        const readAt = Date.now();
        const visualAgents = nextAgents.map((agent) => ({
          agent_id: agent.agent_id,
          task_phase: visualPhaseForAgent(agent),
        }));
        const nextDeskPresence = reconcileDeskPresence(deskPresenceRef.current, visualAgents, readAt);
        const placementAgents = visualAgents.map((agent) => ({
          ...agent,
          task_phase: nextDeskPresence[agent.agent_id]?.phase ?? agent.task_phase,
        }));
        const nextPhaseSlots = reconcilePhaseSlots(phaseSlotsRef.current, placementAgents);

        for (const agent of nextAgents) {
          const placementPhase = nextPhaseSlots[agent.agent_id].phase;
          const slotIndex = nextPhaseSlots[agent.agent_id].slotIndex;
          const placement = placementFor(
            agent.agent_id,
            placementPhase,
            worldSceneForPhase(placementPhase),
            slotIndex,
          );
          const previous = own(previousPositions, agent.agent_id);
          const origin = previous ?? (initialPopulation ? placement.destination : placement.start);
          const moving = pointsDiffer(origin, placement.destination);
          nextPositions[agent.agent_id] = placement.destination;
          nextMotions[agent.agent_id] = {
            origin,
            destination: placement.destination,
            moving,
            slotIndex,
            placementPhase,
          };

        }

        positionsRef.current = nextPositions;
        phaseSlotsRef.current = nextPhaseSlots;
        deskPresenceRef.current = nextDeskPresence;
        initializedRef.current = true;
        setSpriteMotions(nextMotions);
        setAgents(nextAgents);
        setKanban(nextKanban);
        setCollection(metadata?.at && typeof metadata.ms === 'number' ? { at: metadata.at, ms: metadata.ms } : null);
        setLastSuccessfulRead(readAt); setClock(readAt);
        const changes = observedChanges(previousAgents.current, nextAgents, readAt, initialPopulation);
        setMotionBlocked((old) => Object.fromEntries(Object.entries(old).filter(([id]) => nextAgents.some((a) => a.agent_id === id))));
        setEvents((current) => [...changes, ...current].slice(0, 100));
        previousAgents.current = nextAgents;
        setSelectedId((current) =>
          current && nextAgents.some((agent) => agent.agent_id === current)
            ? current
            : null,
        );
        setFailed(false);


      })
      .catch(() => {
        if (mountedRef.current) setFailed(true);
      })
      .finally(() => {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
        inFlightRef.current = null;
      });

    inFlightRef.current = request;
    return request;
  }, [loadAgentHeartbeats, loadKanban, loadWorldSnapshot]);

  const selectAgent = useCallback((agentId: string) => {
    setSelectedId((current) => current === agentId ? null : agentId);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, refreshIntervalMs);
    const clockTimer = window.setInterval(() => setClock(Date.now()), 1000);
    const visible = () => { if (!document.hidden) { setClock(Date.now()); void refresh(); } };
    document.addEventListener('visibilitychange', visible);
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const changed = () => setReducedMotion(media?.matches ?? false);
    media?.addEventListener?.('change', changed);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      window.clearInterval(clockTimer);
      document.removeEventListener('visibilitychange', visible);
      media?.removeEventListener?.('change', changed);
    };
  }, [refresh, refreshIntervalMs]);

  useEffect(() => {
    if (!sceneExpanded) return;
    const collapse = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !kanbanOpen && !selectedId) setSceneExpanded(false);
    };
    window.addEventListener('keydown', collapse);
    return () => window.removeEventListener('keydown', collapse);
  }, [sceneExpanded, kanbanOpen, selectedId]);

  const elapsed = lastSuccessfulRead === null ? 0 : Math.max(0, Math.floor((clock - lastSuccessfulRead) / 1000));
  const stale = lastSuccessfulRead !== null && elapsed >= Math.max(15, refreshIntervalMs * 3 / 1000);
  const agedAgents = agents.map((a) => ageEvidence(a, elapsed, stale));
  const overflowIds = new Set(agents.filter((agent) => {
    const motion = own(spriteMotions, agent.agent_id);
    const placementPhase = motion?.placementPhase ?? visualPhaseForAgent(agent);
    return placementFor(agent.agent_id, placementPhase, worldSceneForPhase(placementPhase), motion?.slotIndex).overflow;
  }).map((agent) => agent.agent_id));
  const onMotionEnd = useCallback((id: string, destination: SpritePoint, blocked: boolean) => {
    setMotionBlocked((old) => ({ ...old, [id]: blocked }));
    setSpriteMotions((old) => {
      if (!own(old, id) || pointsDiffer(old[id].destination, destination) || !old[id].moving) return old;
      return { ...old, [id]: { ...old[id], moving: false } };
    });
  }, []);
  const showFilter = (value: string) => { setFilter(value); setMode('agents'); setKanbanOpen(true); };
  const openKanban = () => { setMode('kanban'); setReadyOnly(false); setKanbanOpen(true); };
  useEffect(() => {
    if (selectedId && !kanbanOpen) evidencePanelRef.current?.focus({ preventScroll: true });
  }, [selectedId, kanbanOpen]);
  const selectedAgent =
    agedAgents.find((agent) => agent.agent_id === selectedId) ?? null;
  const activeCount = agedAgents.filter((agent) =>
    ['live_run', 'live_session'].includes(visualPhaseForAgent(agent))).length;
  const blockedCount = agedAgents.filter((agent) => visualPhaseForAgent(agent) === 'blocked').length;
  const reviewCount = agedAgents.filter((agent) => visualPhaseForAgent(agent) === 'review_pending').length;
  const unavailableCount = agedAgents.filter((agent) =>
    visualPhaseForAgent(agent) === 'telemetry_unavailable').length;
  const readyUnclaimedCount = kanban.tasks.filter((task) =>
    task.status === 'ready' && !task.assignee).length;
  const partialTelemetry = kanban.partial || agents.some((agent) => agent.telemetry_partial);
  const refreshSeconds = Math.max(0.1, refreshIntervalMs / 1_000);

  return (
    <main className={`control-room${sceneExpanded ? ' scene-expanded' : ''}`}>
      <header className="room-header">
        <div>
          <p className="eyebrow">AM Labs · supervision locale en lecture seule</p>
          <h1>Agent World <span className="operator-total">· {agents.length} agents</span></h1>
          <p className="lede">
            Le labo vivant de vos agents IA, animé uniquement à partir des preuves
            opérationnelles disponibles.
          </p>
        </div>
        <div className="header-controls">
          <div className="fleet-counts" aria-label="Résumé de la flotte">
            <button className="attention-active" onClick={() => showFilter('active')}>{activeCount} actifs</button>
            <button className="attention-blocked" onClick={() => showFilter('blocked')}>{blockedCount} bloq.</button>
            <button className="attention-review" onClick={() => showFilter('review_pending')}>{reviewCount} revues</button>
            <button className="attention-ready" onClick={() => { setMode('kanban'); setReadyOnly(true); setKanbanOpen(true); }}>{readyUnclaimedCount} à prendre</button>
            <button className="attention-unavailable" onClick={() => showFilter('telemetry_unavailable')}>{unavailableCount} sans preuve</button>
          </div>
          <button
            className="refresh-control"
            type="button"
            disabled={refreshing}
            aria-busy={refreshing}
            onClick={() => void refresh(true)}
          >
            <svg className="refresh-icon" aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" />
            </svg>
            {failed ? 'Réessayer' : 'Actualiser'}
          </button>
        </div>
      </header>

      <section className={`data-mode-strip data-mode-${dataMode}`} aria-label="Mode et fraîcheur des données">
        <div className="data-mode-copy">
          <strong>{dataMode === 'fixture' ? 'MODE DÉMO' : props.remoteSourceLabel ? 'VPS · SSH' : 'DIRECT LOCAL'}</strong>
          <span>
            {dataMode === 'fixture'
              ? 'Données simulées · aucune lecture Hermes'
              : props.remoteSourceLabel ? `${props.remoteSourceLabel} · lecture seule` : 'Hermes + Kanban · lecture seule'}
          </span>
        </div>
        <div className="data-freshness">
          {partialTelemetry && <strong className="partial-warning">Lecture partielle</strong>}
          <span>{lastSuccessfulRead ? `Dernière lecture · ${new Date(lastSuccessfulRead).toLocaleTimeString('fr-FR')} · il y a ${elapsed} s` : 'Lecture en cours…'}</span>
          {collection && <span title={`Collecte effectuée le ${evidenceTimeLabel(collection.at)}`}>Collecte · {collection.ms} ms</span>}
        </div>
        <div className="status-legend" aria-label="Légende des états opérationnels">
          <span className="legend-run">Run confirmé</span>
          <span className="legend-session">Session active</span>
          <span className="legend-review">Revue</span>
          <span className="legend-blocked">Bloqué</span>
          <span className="legend-unavailable">Preuve absente</span>
        </div>
      </section>

      <div className="world-notices">
      {failed && (
        <p className="room-error" role="alert">
          {props.remoteSourceLabel ? 'Connexion VPS perdue ou lecture distante indisponible.' : 'Lecture du registre impossible.'} {agents.length > 0 && 'Dernier état lisible conservé.'}
        </p>
      )}

      {stale && <p role="status" className="room-error">Données périmées : aucune lecture récente. Monde figé, activité actuelle non confirmée.</p>}
      {props.configurationNotice && <p role="status" className="overflow-notice">{props.configurationNotice}</p>}
      {overflowIds.size > 0 && <p className="overflow-notice">{overflowIds.size} agents hors scène : capacité atteinte. Ils restent consultables dans le panneau Équipe.</p>}
      {Object.values(motionBlocked).some(Boolean) && <p className="overflow-notice">Un déplacement n’a pas de trajet sûr : personnage maintenu sur place, état réel consultable dans sa fiche.</p>}
      </div>
      <div className="world-viewport">
      {loading ? (
        <section className="loading-floor" aria-live="polite">
          Chargement du registre dynamique…
        </section>
      ) : agents.length === 0 ? (
        <section className="empty-floor">
          <h2>Aucun opérateur découvert</h2>
          <p>Le registre local ne contient actuellement aucun profil exploitable.</p>
        </section>
      ) : (
        <div className={`control-room-layout pixel-world-layout${selectedAgent ? ' has-evidence' : ''}`}>
          <PixiWorld
            agents={agents}
            kanban={kanban}
            motions={spriteMotions}
            selectedId={selectedId}
            reducedMotion={reducedMotion}
            paused={failed || stale}
            onMotionEnd={onMotionEnd}
            onOpenKanban={openKanban}
            onSelect={selectAgent}
          />

          {selectedAgent && (
            <aside
              ref={evidencePanelRef}
              tabIndex={-1}
              onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setSelectedId(null); } }}
              className="evidence-panel"
              aria-label="Preuves de l’opérateur sélectionné"
              data-testid="evidence-panel"
            >
              <div className="evidence-title-row">
                <div>
                  <p className="eyebrow">Dossier actif</p>
                  <h2>{selectedAgent.display_name}</h2>
                </div>
                <button
                  className="evidence-close"
                  type="button"
                  aria-label="Fermer le dossier actif"
                  onClick={() => setSelectedId(null)}
                >
                  ×
                </button>
              </div>
              <p className={`detail-state state-${selectedAgent.observed_state}`}>
                {stateLabels[selectedAgent.observed_state]}
              </p>
              <section className="evidence-primary">
                <span className={`phase-badge phase-${selectedAgent.task_phase}`}>
                  {phasePresentation(visualPhaseForAgent(selectedAgent)).label}
                </span>
                <p className="evidence-task-title">
                  {selectedAgent.task_title ?? 'Aucune tâche active lisible'}
                </p>
                {selectedAgent.waiting_reason && (
                  <p className="evidence-attention">
                    <strong>Intervention :</strong>{' '}
                    {selectedAgent.waiting_reason === selectedAgent.task_phase
                      ? 'Motif précis non disponible'
                      : selectedAgent.waiting_reason}
                  </p>
                )}
                {selectedAgent.telemetry_partial && (
                  <p className="evidence-partial">Certaines sources locales sont illisibles.</p>
                )}
                <div className="evidence-vitals">
                  <span><strong>Fraîcheur</strong>{ageLabel(selectedAgent.age_seconds)}</span>
                  <span><strong>Board</strong>{selectedAgent.board_slug ?? 'Aucun'}</span>
                </div>
              </section>
              <ul className="source-evidence">{selectedAgent.evidence?.map((e, i) => <li key={i}>{e.source} · {e.status} · {ageLabel(e.age_seconds)} · confiance : {e.confidence}{e.error_code ? ` · ${e.error_code}` : ''}</li>)}</ul>
              {selectedAgent.session && <p className="simulation-note">Session associée : {selectedAgent.session.title} · {selectedAgent.session.id} · {selectedAgent.session.confidence === 'inferred-tool' ? 'Activité déduite du journal d’outil (fenêtre de 10 min), pas une vérification de processus.' : 'Bail de session observé.'}</p>}
              <details className="evidence-technical">
                <summary>Détails de preuve</summary>
                <dl>
                <div><dt>Profil</dt><dd>{selectedAgent.profile}</dd></div>
                <div><dt>Rôle</dt><dd>{selectedAgent.role}</dd></div>
                <div><dt>Pièce</dt><dd>{selectedAgent.room || 'unassigned'}</dd></div>
                <div><dt>Activité</dt><dd>{selectedAgent.activity === selectedAgent.task_phase ? 'Alignée sur la phase' : selectedAgent.activity}</dd></div>
                <div><dt>Phase</dt><dd>{selectedAgent.task_phase}</dd></div>
                <div><dt>Tâche</dt><dd>{selectedAgent.task_title ?? 'Aucune tâche lisible'}</dd></div>
                <div><dt>Statut tâche</dt><dd>{selectedAgent.task_status ?? 'Non disponible'}</dd></div>
                <div><dt>Board</dt><dd>{selectedAgent.board_slug ?? 'Non disponible'}</dd></div>
                <div><dt>ID tâche/session</dt><dd>{selectedAgent.task_id ?? 'Non disponible'}</dd></div>
                {selectedAgent.waiting_reason && (
                  <div><dt>Attente</dt><dd>{selectedAgent.waiting_reason === selectedAgent.task_phase ? 'Aucun motif distinct' : (selectedAgent.waiting_reason ?? 'Aucun motif signalé')}</dd></div>
                )}
                <div><dt>Source</dt><dd>{selectedAgent.source}</dd></div>
                <div><dt>Fraîcheur</dt><dd>{ageLabel(selectedAgent.age_seconds)}</dd></div>
                <div><dt>Dernière preuve</dt><dd>{evidenceTimeLabel(selectedAgent.last_evidence_at)}</dd></div>
                <div><dt>Confiance</dt><dd>{selectedAgent.confidence}</dd></div>
                </dl>
              </details>
              <p className="simulation-note">
                Les animations indiquent une présence observée, jamais la preuve d’une action en cours.
              </p>
            </aside>
          )}
        </div>
      )}
      </div>

      <div className="supervision-launcher" role="group" aria-label="Ouvrir la supervision">
        <button onClick={() => showFilter('all')} aria-haspopup="dialog">Équipe · {agents.length}</button>
        <button onClick={openKanban} aria-haspopup="dialog">Kanban · {kanban.tasks.length}</button>
        <button onClick={() => { setMode('events'); setKanbanOpen(true); }} aria-haspopup="dialog">Journal · {events.length}</button>
        <button className="expand-scene" aria-pressed={sceneExpanded} onClick={() => setSceneExpanded((value) => !value)}>
          {sceneExpanded ? 'Réduire la scène' : 'Agrandir la scène'}
        </button>
      </div>
      {kanbanOpen && <KanbanDialog title={mode === 'kanban' ? 'Kanban' : mode === 'events' ? 'Journal' : 'Équipe'} onClose={() => setKanbanOpen(false)}>
        <Supervision agents={agedAgents} kanban={kanban} events={events} mode={mode}
          readyOnly={readyOnly} setReadyOnly={setReadyOnly}
          setMode={setMode} filter={filter} setFilter={setFilter} overflowIds={overflowIds}
          onSelect={(id) => { setKanbanOpen(false); setSelectedId(id); }} />
      </KanbanDialog>}
      <footer className="room-footer">
        <span>Bulles et pauses imaginées pour le décor · les états affichés viennent de Hermes.</span>
        <span>Actualisation bornée · {refreshSeconds.toLocaleString('fr-FR')} s</span>
        <span>Aucune écriture distante</span>
        {props.onConfigure && <button onClick={props.onConfigure}>Configurer mes agents</button>}
        <CompanyLink>Créé par AM Labs ↗</CompanyLink>
      </footer>
    </main>
  );
}

export default App;
