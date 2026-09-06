// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import type { AgentHeartbeatDto, ObservedState } from './heartbeat';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./world/renderer', () => ({
  PixiWorldRenderer: class {
    async start() {}
    sync() {}
    destroy() {}
  },
}));

const invokeMock = vi.mocked(invoke);

type FixturePhase =
  | 'live_run'
  | 'live_session'
  | 'review_pending'
  | 'blocked'
  | 'ready_unclaimed'
  | 'todo_not_started'
  | 'available'
  | 'telemetry_unavailable';

function agent(
  id: string,
  phase: FixturePhase = 'available',
  state: ObservedState = 'connected',
): AgentHeartbeatDto {
  const active = phase !== 'available' && phase !== 'telemetry_unavailable';
  return {
    agent_id: id,
    display_name: `Operator ${id}`,
    profile: id,
    role: `Role ${id}`,
    observed_state: state,
    last_evidence_at: state === 'unavailable' ? null : '2026-09-02T18:00:00Z',
    age_seconds: state === 'unavailable' ? null : 7,
    source: state === 'unavailable' ? 'profile-discovery' : 'gateway-heartbeat',
    confidence: state === 'unavailable' ? 'none' : 'high',
    machine_id: state === 'unavailable' ? '' : 'local-machine',
    origin: state === 'unavailable' ? '' : 'local',
    activity: phase === 'live_run' || phase === 'live_session' ? 'working' : phase,
    room: phase === 'available' ? 'break-room' : 'control-room',
    task_status: active ? (phase === 'live_run' ? 'running' : phase) : null,
    task_title: active ? `Task ${id}` : null,
    board_slug: active ? 'fixture-board' : null,
    task_id: active ? `task-${id}` : null,
    task_phase: phase,
    waiting_reason: phase,
    has_live_run: phase === 'live_run',
    telemetry_partial: false,
  } as AgentHeartbeatDto;
}

describe('multi-agent control room', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  });

  afterEach(cleanup);

  it('keeps all detailed supervision unmounted until requested and removes it completely on close', async () => {
    render(<App loadAgentHeartbeats={async () => [agent('atlas')]}
      loadKanban={async () => ({ partial: false, tasks: [] })} />);
    await screen.findByRole('button', { name: 'Opérateur Operator atlas' });
    expect(screen.queryByRole('region', { name: 'Supervision détaillée' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Kanban · 0' }));
    expect(screen.getByRole('dialog', { name: 'Kanban' })).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: 'Supervision détaillée' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer le Kanban' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le Kanban détaillé' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Supervision détaillée' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Équipe · 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Équipe' });
    expect(within(dialog).getByRole('heading', { name: 'Équipe · 1 résultats' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Journal · 0' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer la supervision' }));
    expect(screen.queryByRole('region', { name: 'Supervision détaillée' })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });

  it('opens the matching filter from counters and returns from a card to a visible focused agent file', async () => {
    render(<App loadAgentHeartbeats={async () => [agent('atlas', 'live_run'), agent('rest')]}
      loadKanban={async () => ({ partial: false, tasks: [
        { board_slug: 'board', task_id: 'free', title: 'À réclamer', status: 'ready', assignee: null },
        { board_slug: 'board', task_id: 'busy', title: 'Travail attribué', status: 'running', assignee: 'atlas' },
      ] })} />);
    await screen.findByRole('button', { name: '1 actifs' });
    fireEvent.click(screen.getByRole('button', { name: '1 actifs' }));
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Équipe · 1 résultats' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fermer la supervision' }));
    fireEvent.click(screen.getByRole('button', { name: '1 à prendre' }));
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Kanban lisible · 1 cartes' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).queryByText('Travail attribué')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'À prendre uniquement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voir les preuves de l’agent' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('evidence-panel')).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('evidence-panel'), { key: 'Escape' });
    expect(screen.queryByTestId('evidence-panel')).not.toBeInTheDocument();
  });

  it('ages retained data, signals stale snapshots and recovers without inventing history', async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValueOnce({ agents: [agent('fresh', 'live_run')], kanban: { tasks: [], partial: false } })
      .mockRejectedValue(new Error('source_failure'));
    try {
      render(<App loadWorldSnapshot={load} />);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
      expect(screen.getByText(/Données périmées/)).toBeInTheDocument();
      expect(screen.getByText('0 actifs')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Dernier état lisible conservé');
      load.mockResolvedValue({ agents: [agent('fresh', 'live_run')], kanban: { tasks: [], partial: false } });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Réessayer' })); });
      expect(screen.queryByText(/Données périmées/)).not.toBeInTheDocument();
      expect(screen.getByText('1 actifs')).toBeInTheDocument();
    } finally { cleanup(); vi.useRealTimers(); }
  });
  it('labels the remote source and preserves uncertainty through an SSH outage and recovery', async () => {
    vi.useFakeTimers();
    const snapshot = { agents: [agent('remote-worker', 'live_run')], kanban: { tasks: [], partial: false } };
    const load = vi.fn().mockResolvedValueOnce(snapshot).mockRejectedValue('ssh_timeout');
    try {
      render(<App remoteSourceLabel="hermes@example.invalid" loadWorldSnapshot={load} />);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getByText('VPS · SSH')).toBeInTheDocument();
      expect(screen.getByText(/hermes@example.invalid/)).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
      expect(screen.getByRole('alert')).toHaveTextContent('Connexion VPS perdue');
      expect(screen.getByText('0 actifs')).toBeInTheDocument();
      expect(screen.getByText(/Données périmées/)).toBeInTheDocument();
      load.mockResolvedValue(snapshot);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Réessayer' })); });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('1 actifs')).toBeInTheDocument();
    } finally { cleanup(); vi.useRealTimers(); }
  });

  it('loads the production world with one combined backend read', async () => {
    invokeMock.mockResolvedValue({
      agents: [agent('unit-combined', 'available')],
      kanban: { tasks: [], partial: false },
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: /opérateur operator unit-combined/i }))
      .toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('read_world_snapshot');
  });

  it('renders exactly one Pixi canvas and one accessible control per discovered agent', async () => {
    invokeMock.mockResolvedValue([
      agent('unit-17', 'live_run'),
      agent('unit-42', 'review_pending', 'disconnected'),
      agent('unit-93', 'telemetry_unavailable', 'unavailable'),
    ]);

    render(<App loadKanban={async () => ({ tasks: [], partial: false })} />);

    expect(screen.getByText(/chargement du registre/i)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /laboratoire/i })).toBeInTheDocument();
    expect(screen.getByTestId('pixi-world-canvas')).toBeInTheDocument();
    expect(screen.getAllByTestId('pixi-agent-control')).toHaveLength(3);
    expect(screen.getAllByTestId('pixi-world-canvas')).toHaveLength(1);
    expect(screen.queryByTestId('agent-sprite')).not.toBeInTheDocument();
    expect(screen.queryByTestId('operator-station')).not.toBeInTheDocument();
    for (const control of screen.getAllByTestId('pixi-agent-control')) {
      expect(control).toHaveAttribute('type', 'button');
      expect(control.getAttribute('aria-label')).toMatch(/^Opérateur /);
    }
    expect(screen.getByText(/3 agents/i)).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith('read_agent_heartbeats');
  });

  it('places the initial population directly without a synchronized entrance march', async () => {
    invokeMock.mockResolvedValue([
      agent('unit-a', 'available'),
      agent('unit-b', 'available'),
      agent('unit-c', 'todo_not_started'),
    ]);

    render(<App loadKanban={async () => ({ tasks: [], partial: false })} />);

    await screen.findByRole('button', { name: /opérateur operator unit-a/i });
    for (const control of screen.getAllByTestId('pixi-agent-control')) {
      expect(control).toHaveAttribute('data-moving', 'false');
      expect(control).toHaveAttribute('data-origin-x', control.getAttribute('data-destination-x'));
      expect(control).toHaveAttribute('data-origin-y', control.getAttribute('data-destination-y'));
    }
  });

  it('keeps existing agents in place when a peer joins the same phase', async () => {
    const loadAgentHeartbeats = vi.fn()
      .mockResolvedValueOnce([
        agent('atlas', 'available'),
        agent('berlin', 'available'),
      ])
      .mockResolvedValueOnce([
        agent('alma', 'available'),
        agent('atlas', 'available'),
        agent('berlin', 'available'),
      ]);

    render(<App
      loadAgentHeartbeats={loadAgentHeartbeats}
      loadKanban={async () => ({ tasks: [], partial: false })}
    />);
    const atlas = await screen.findByRole('button', { name: /opérateur operator atlas/i });
    const atlasDestination = [
      atlas.getAttribute('data-destination-x'),
      atlas.getAttribute('data-destination-y'),
    ];

    fireEvent.click(screen.getByRole('button', { name: /actualiser/i }));

    await screen.findByRole('button', { name: /opérateur operator alma/i });
    const refreshedAtlas = screen.getByRole('button', { name: /opérateur operator atlas/i });
    expect([
      refreshedAtlas.getAttribute('data-destination-x'),
      refreshedAtlas.getAttribute('data-destination-y'),
    ]).toEqual(atlasDestination);
    expect(refreshedAtlas).toHaveAttribute('data-moving', 'false');
  });

  it('exposes the real bounded Kanban cards and keeps an empty board empty', async () => {
    const loadAgentHeartbeats = vi.fn(async () => [agent('atlas', 'todo_not_started')]);
    const loadKanban = vi.fn(async () => ({
      partial: false,
      tasks: [{
        board_slug: 'toolinnov-seo',
        task_id: 't-atlas',
        title: 'Corriger la redirection SEO',
        status: 'todo',
        assignee: 'atlas',
      }],
    }));

    render(<App loadAgentHeartbeats={loadAgentHeartbeats} loadKanban={loadKanban} />);

    expect(await screen.findByText(/corriger la redirection seo/i)).toBeInTheDocument();
    expect(screen.getByText(/todo · corriger la redirection seo · atlas · toolinnov-seo/i))
      .toBeInTheDocument();
  });

  it('refreshes additions and removals while preserving a valid selection', async () => {
    invokeMock
      .mockResolvedValueOnce([
        agent('unit-a', 'ready_unclaimed'),
        agent('unit-b', 'blocked'),
      ])
      .mockResolvedValueOnce([
        agent('unit-b', 'blocked'),
        agent('unit-c', 'ready_unclaimed'),
      ]);

    render(<App loadKanban={async () => ({ tasks: [], partial: false })} />);
    await screen.findByRole('button', { name: /opérateur operator unit-a/i });

    fireEvent.click(screen.getByRole('button', { name: /opérateur operator unit-b/i }));
    expect(screen.getByRole('heading', { name: 'Operator unit-b' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /actualiser/i }));
    });

    await waitFor(() => expect(screen.queryByText('Operator unit-a')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /opérateur operator unit-c/i })).toBeInTheDocument();
    expect(screen.getAllByTestId('pixi-agent-control')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Operator unit-b' })).toBeInTheDocument();
  });

  it('closes detail when the explicitly selected agent disappears', async () => {
    invokeMock
      .mockResolvedValueOnce([
        agent('unit-first', 'live_run'),
        agent('unit-next', 'ready_unclaimed'),
      ])
      .mockResolvedValueOnce([agent('unit-next', 'ready_unclaimed')]);

    render(<App loadKanban={async () => ({ tasks: [], partial: false })} />);
    const first = await screen.findByRole('button', { name: /opérateur operator unit-first/i });
    fireEvent.click(first);
    expect(screen.getByRole('heading', { name: 'Operator unit-first' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /actualiser/i }));

    await waitFor(() => {
      expect(screen.queryByTestId('evidence-panel')).not.toBeInTheDocument();
    });
  });

  it('shows bounded telemetry and explicit unavailable evidence', async () => {
    invokeMock.mockResolvedValue([
      agent('unit-redacted', 'telemetry_unavailable', 'unavailable'),
    ]);

    render(<App loadKanban={async () => ({ tasks: [], partial: false })} />);
    const sprite = await screen.findByRole('button', { name: /opérateur operator unit-redacted/i });
    fireEvent.click(sprite);
    const panel = screen.getByTestId('evidence-panel');

    expect(within(panel).getByText('Indisponible')).toBeInTheDocument();
    expect(within(panel).getByText('profile-discovery')).toBeInTheDocument();
    expect(within(panel).getAllByText(/aucune preuve live exploitable/i)).toHaveLength(2);
    expect(within(panel).getByText('telemetry_unavailable')).toBeInTheDocument();
  });

  it('keeps its physical seat while an unclaimed todo gains a live run', async () => {
    invokeMock
      .mockResolvedValueOnce([agent('unit-moving', 'todo_not_started')])
      .mockResolvedValueOnce([agent('unit-moving', 'live_run')]);

    render(<App loadKanban={async () => ({ tasks: [], partial: false })} />);
    const queued = await screen.findByRole('button', { name: /opérateur operator unit-moving/i });
    expect(queued).toHaveAttribute('data-state', 'todo_not_started');
    expect(queued).toHaveAttribute('data-zone', 'queue-todo');
    const queuedX = queued.getAttribute('data-destination-x');
    const queuedY = queued.getAttribute('data-destination-y');
    expect(queuedX).not.toBeNull();
    expect(queuedY).not.toBeNull();
    expect(screen.getAllByText(/carte assignée, non démarrée/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /actualiser/i }));

    await waitFor(() => {
      const working = screen.getByRole('button', { name: /opérateur operator unit-moving/i });
      expect(working).toHaveAttribute('data-state', 'live_run');
      expect(working).toHaveAttribute('data-zone', 'console');
      expect(working).toHaveAttribute('data-interaction', 'typing-at-desk');
      expect(working).toHaveAttribute('data-origin-x', queuedX);
      expect(working).toHaveAttribute('data-origin-y', queuedY);
      expect(working).toHaveAttribute('data-moving', 'false');
      expect([
        working.getAttribute('data-destination-x'),
        working.getAttribute('data-destination-y'),
      ]).toEqual([queuedX, queuedY]);
    });

    // A status change alone must not make an agent change seats.
    expect(screen.getByRole('button', { name: /opérateur operator unit-moving/i })).toHaveAttribute('data-moving', 'false');
  });

  it('reacts automatically when a Hermes heartbeat becomes disconnected', async () => {
    let disconnectedSource = false;
    const loadAgentHeartbeats = vi.fn(async () => [
      agent('unit-offline', 'live_run', disconnectedSource ? 'disconnected' : 'connected'),
    ]);

    render(<App
      loadAgentHeartbeats={loadAgentHeartbeats}
      loadKanban={async () => ({ tasks: [], partial: false })}
      refreshIntervalMs={20}
    />);

    const connected = await screen.findByRole('button', { name: /opérateur operator unit-offline/i });
    expect(connected).toHaveAttribute('data-state', 'live_run');
    expect(connected).toHaveAttribute('data-zone', 'console');
    // Change the source only after observing the initial state. A 20 ms poll
    // must not race the assertion on a busy test machine.
    disconnectedSource = true;

    await waitFor(() => {
      const disconnected = screen.getByRole('button', { name: /opérateur operator unit-offline/i });
      expect(disconnected).toHaveAttribute('data-state', 'telemetry_unavailable');
      expect(disconnected).toHaveAttribute('data-zone', 'unknown');
      expect(disconnected).toHaveAttribute('data-moving', 'false');
    });
    expect(loadAgentHeartbeats.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('distinguishes ready, review and blocked actions without simulating work', async () => {
    invokeMock.mockResolvedValue([
      agent('unit-ready', 'ready_unclaimed'),
      agent('unit-review', 'review_pending'),
      agent('unit-blocked', 'blocked'),
    ]);

    render(<App loadKanban={async () => ({ tasks: [], partial: false })} />);
    expect((await screen.findAllByText(/carte prête, aucun worker/i)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /opérateur operator unit-ready/i }))
      .toHaveAttribute('data-state', 'ready_unclaimed');
    expect(screen.getByRole('button', { name: /opérateur operator unit-review/i }))
      .toHaveAttribute('data-state', 'review_pending');
    expect(screen.getByRole('button', { name: /opérateur operator unit-blocked/i }))
      .toHaveAttribute('data-state', 'blocked');
    expect(screen.queryAllByRole('button', { name: /opérateur operator unit-(ready|review|blocked)/i })
      .some((node) => node.getAttribute('data-state') === 'live_run')).toBe(false);
  });

  it('makes fixture provenance and operational attention impossible to confuse with live data', async () => {
    render(<App
      dataMode="fixture"
      loadAgentHeartbeats={async () => [
        agent('unit-run', 'live_run'),
        agent('unit-session', 'live_session'),
        agent('unit-review', 'review_pending'),
        agent('unit-blocked', 'blocked'),
        agent('unit-offline', 'telemetry_unavailable', 'unavailable'),
      ]}
      loadKanban={async () => ({
        partial: false,
        tasks: [{
          board_slug: 'fixture-board',
          task_id: 'ready-1',
          title: 'Tâche prête',
          status: 'ready',
          assignee: null,
        }],
      })}
    />);

    expect(await screen.findByText('MODE DÉMO')).toBeInTheDocument();
    expect(screen.getByText(/données simulées · aucune lecture Hermes/i)).toBeInTheDocument();
    expect(screen.getByText('2 actifs')).toBeInTheDocument();
    expect(screen.getByText('1 bloq.')).toBeInTheDocument();
    expect(screen.getByText('1 revues')).toBeInTheDocument();
    expect(screen.getByText('1 à prendre')).toBeInTheDocument();
    expect(screen.getByText('1 sans preuve')).toBeInTheDocument();
    expect(screen.getByText('Session active')).toBeInTheDocument();
    expect(screen.getByText('Run confirmé')).toBeInTheDocument();
  });

  it('renders one continuous world with both furnished rooms and no navigation', async () => {
    invokeMock.mockResolvedValue([agent('unit-resting'), agent('unit-working', 'live_run')]);
    render(<App loadKanban={async () => ({ tasks: [], partial: false })} />);

    expect(await screen.findByRole('heading', { name: /laboratoire/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /salle de repos/i })).toBeInTheDocument();
    expect(screen.getByTestId('pixi-world-canvas')).toBeInTheDocument();
    expect(screen.getByText(/bureaux, écrans, expériences, Kanban/i)).toBeInTheDocument();
    expect(screen.getByText(/canapé, table basse, bibliothèque et coin café/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /opérateur operator unit-resting/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /opérateur operator unit-working/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /porte/i })).not.toBeInTheDocument();
  });

  it('opens operator detail only after that character is clicked', async () => {
    invokeMock.mockResolvedValue([agent('unit-private', 'live_run')]);
    render(<App loadKanban={async () => ({ tasks: [], partial: false })} />);

    const sprite = await screen.findByRole('button', { name: /opérateur operator unit-private/i });
    expect(screen.queryByTestId('evidence-panel')).not.toBeInTheDocument();

    fireEvent.click(sprite);

    expect(screen.getByTestId('evidence-panel')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Operator unit-private' })).toBeInTheDocument();
  });

  it('surfaces read failures and recovers on manual refresh', async () => {
    invokeMock
      .mockRejectedValueOnce(new Error('backend unavailable'))
      .mockResolvedValueOnce([agent('unit-recovered', 'ready_unclaimed')]);

    render(<App loadKanban={async () => ({ tasks: [], partial: false })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/lecture du registre impossible/i);
    expect(document.body).not.toHaveTextContent('backend unavailable');

    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));

    expect(await screen.findByRole('button', { name: /opérateur operator unit-recovered/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
