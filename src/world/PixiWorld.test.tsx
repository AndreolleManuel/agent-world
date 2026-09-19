// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentHeartbeatDto } from '../heartbeat';
import PixiWorld from './PixiWorld';
import type { WorldRenderer } from './renderer';
import { placementFor } from './placement';

vi.mock('./renderer', () => ({
  PixiWorldRenderer: class {
    async start() {}
    sync() {}
    destroy() {}
  },
}));

function fixture(id: string, phase = 'live_run'): AgentHeartbeatDto {
  return {
    agent_id: id,
    display_name: `Operator ${id}`,
    profile: id,
    role: 'Tester',
    observed_state: 'connected',
    last_evidence_at: '2026-09-02T18:00:00Z',
    age_seconds: 4,
    source: 'gateway-heartbeat',
    confidence: 'high',
    machine_id: 'local-machine',
    origin: 'local',
    activity: phase,
    room: phase === 'available' ? 'break-room' : 'control-room',
    task_status: phase,
    task_title: `Task ${id}`,
    board_slug: 'fixture-board',
    task_id: `task-${id}`,
    task_phase: phase,
    waiting_reason: null,
    has_live_run: phase === 'live_run',
    telemetry_partial: false,
  } as AgentHeartbeatDto;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('PixiWorld lifecycle', () => {
  it('renders an idle agent at its retained work seat without passing a false working status to Pixi', async () => {
    const renderer: WorldRenderer = {
      start: vi.fn().mockResolvedValue(undefined), sync: vi.fn(), destroy: vi.fn(),
    };
    const idle = fixture('atlas', 'available');
    const desk = placementFor('atlas', 'live_run', 'control-room', 0);
    render(<PixiWorld agents={[idle]} motions={{ atlas: {
      origin: desk.start, destination: desk.destination, moving: true,
      slotIndex: 0, placementPhase: 'live_run',
    } }} selectedId={null} reducedMotion={false} onSelect={vi.fn()} createRenderer={() => renderer} />);
    await waitFor(() => expect(renderer.sync).toHaveBeenCalled());
    const model = vi.mocked(renderer.sync).mock.calls.at(-1)![0].agents[0];
    expect(model.agent).toBe(idle);
    expect(model.agent.task_phase).toBe('available');
    expect(model.interaction).toBe('typing-at-desk');
    expect(model.motion.destination).toEqual(desk.destination);
    expect(model.hidden).toBe(false);
    const control = screen.getByTestId('pixi-agent-control');
    expect(control).toHaveAttribute('data-state', 'available');
    expect(control).toHaveAttribute('data-zone', 'console');
    expect(control).toHaveTextContent('Disponible');
  });

  it('emits a sanitized native canvas probe after 25 seconds when explicitly enabled', async () => {
    vi.stubEnv('VITE_CANVAS_PROBE', '1');
    vi.useFakeTimers();
    const pixelData = new Uint8ClampedArray([
      12, 34, 56, 255,
      78, 90, 12, 255,
    ]);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getImageData: vi.fn(() => ({ data: pixelData })),
    } as unknown as GPUCanvasContext);
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const renderer: WorldRenderer = {
      start: vi.fn().mockResolvedValue(undefined),
      sync: vi.fn(),
      destroy: vi.fn(),
    };

    function ProbeHarness() {
      const [selectedId, setSelectedId] = useState<string | null>(null);
      return (
        <PixiWorld
          agents={[fixture('probe')]}
          motions={{}}
          selectedId={selectedId}
          reducedMotion={false}
          onSelect={setSelectedId}
          createRenderer={() => renderer}
        />
      );
    }

    render(<ProbeHarness />);
    const canvas = screen.getByTestId('pixi-world-canvas');
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 360 },
    });
    await act(async () => Promise.resolve());

    expect(screen.queryByTestId('pixi-native-probe')).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_001);
    });

    const rawOutput = screen.getByTestId('pixi-native-probe').textContent ?? '';
    expect(rawOutput).toMatch(/^PIXEL_OPS_NATIVE_PROBE /);
    expect(JSON.parse(rawOutput.replace(/^PIXEL_OPS_NATIVE_PROBE /, ''))).toMatchObject({
      backend: 'canvas',
      rendererState: 'ready',
      dimensions: {
        clientWidth: 640,
        clientHeight: 360,
      },
      pixels: {
        nonUniform: true,
        opaque: 8,
      },
      controls: 1,
      interaction: {
        attempted: true,
        selected: true,
      },
      errors: {
        error: 0,
        unhandledrejection: 0,
      },
      rendererErrorVisible: false,
      worldFallbackVisible: false,
    });
    expect(consoleInfo).toHaveBeenCalledWith(rawOutput);
  });

  it('does not mount the native probe when the explicit flag is absent', async () => {
    const renderer: WorldRenderer = {
      start: vi.fn().mockResolvedValue(undefined),
      sync: vi.fn(),
      destroy: vi.fn(),
    };

    render(
      <PixiWorld
        agents={[fixture('ordinary')]}
        motions={{}}
        selectedId={null}
        reducedMotion={false}
        onSelect={vi.fn()}
        createRenderer={() => renderer}
      />,
    );

    await waitFor(() => expect(renderer.start).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('pixi-native-probe')).not.toBeInTheDocument();
  });

  it('shows an expurgated warning when renderer initialization fails', async () => {
    const renderer: WorldRenderer = {
      start: vi.fn().mockRejectedValue(new Error('/private/path: native GPU process crashed')),
      sync: vi.fn(),
      destroy: vi.fn(),
    };

    render(
      <PixiWorld
        agents={[fixture('alpha')]}
        motions={{}}
        selectedId={null}
        reducedMotion={false}
        onSelect={vi.fn()}
        createRenderer={() => renderer}
      />,
    );

    const world = screen.getByTestId('pixi-world-canvas').closest('.pixi-world');
    await waitFor(() => expect(world).toHaveAttribute('data-renderer-state', 'unavailable'));
    const warning = screen.getByRole('status');
    expect(warning).toHaveTextContent(
      'Le rendu graphique est indisponible, les contrôles accessibles restent utilisables.',
    );
    expect(warning).not.toHaveTextContent('/private/path');
    expect(renderer.sync).toHaveBeenCalled();
  });

  it('creates one renderer, reconciles refreshes and destroys it on unmount', async () => {
    const renderer: WorldRenderer = {
      start: vi.fn().mockResolvedValue(undefined),
      sync: vi.fn(),
      destroy: vi.fn(),
    };
    const factory = vi.fn(() => renderer);
    const onSelect = vi.fn();
    const initialAgent = fixture('alpha');
    const motion = {
      origin: { x: 48, y: 66 },
      destination: { x: 12, y: 24 },
      moving: true,
    };

    const view = render(
      <PixiWorld
        agents={[initialAgent]}
        motions={{ alpha: motion }}
        selectedId={null}
        reducedMotion={false}
        onSelect={onSelect}
        createRenderer={factory}
      />,
    );

    await waitFor(() => expect(renderer.start).toHaveBeenCalledTimes(1));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(renderer.sync).toHaveBeenCalled();

    view.rerender(
      <PixiWorld
        agents={[initialAgent, fixture('bravo', 'available')]}
        motions={{ alpha: { ...motion, moving: false } }}
        selectedId="alpha"
        reducedMotion
        onSelect={onSelect}
        createRenderer={factory}
      />,
    );

    expect(factory).toHaveBeenCalledTimes(1);
    const latestSnapshot = vi.mocked(renderer.sync).mock.calls.at(-1)?.[0];
    expect(latestSnapshot?.agents.map(({ agent }) => agent.agent_id)).toEqual(['alpha', 'bravo']);
    expect(latestSnapshot?.reducedMotion).toBe(true);

    view.unmount();
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps one canvas and one active renderer after StrictMode stabilizes', async () => {
    const renderers: Array<WorldRenderer & { active: boolean }> = [];
    const factory = vi.fn(() => {
      const renderer: WorldRenderer & { active: boolean } = {
        active: false,
        start: vi.fn(async () => {
          renderer.active = true;
        }),
        sync: vi.fn(),
        destroy: vi.fn(() => {
          renderer.active = false;
        }),
      };
      renderers.push(renderer);
      return renderer;
    });

    const view = render(
      <StrictMode>
        <PixiWorld
          agents={[fixture('strict')]}
          motions={{}}
          selectedId={null}
          reducedMotion={false}
          onSelect={vi.fn()}
          createRenderer={factory}
        />
      </StrictMode>,
    );

    await waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
    expect(screen.getAllByTestId('pixi-world-canvas')).toHaveLength(1);
    expect(renderers.filter(({ active }) => active)).toHaveLength(1);
    expect(renderers[0].destroy).toHaveBeenCalledOnce();
    expect(renderers[1].destroy).not.toHaveBeenCalled();

    view.unmount();
  });
});
