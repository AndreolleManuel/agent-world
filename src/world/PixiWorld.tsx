import { own } from '../records';
import { useEffect, useRef, useState } from 'react';
import { visualPhaseForAgent } from '../heartbeat';
import type { AgentHeartbeatDto, KanbanSnapshotDto } from '../heartbeat';
import { phasePresentation, phaseSlotIndex, placementFor, routeBetween } from './placement';

import {
  PixiWorldRenderer,
  type AgentMotion,
  type PixiSceneSnapshot,
  type WorldRenderer,
} from './renderer';

export interface PixiWorldProps {
  agents: AgentHeartbeatDto[];
  kanban?: KanbanSnapshotDto;
  motions: Record<string, AgentMotion>;
  selectedId: string | null;
  reducedMotion: boolean;
  paused?: boolean;
  onMotionEnd?: (id: string, point: { x: number; y: number }, blocked: boolean) => void;
  onOpenKanban?: () => void;
  onSelect: (agentId: string) => void;
  createRenderer?: (canvas: HTMLCanvasElement, onSelect: (agentId: string) => void) => WorldRenderer;
}

const defaultRendererFactory = (
  canvas: HTMLCanvasElement,
  onSelect: (agentId: string) => void,
): WorldRenderer => new PixiWorldRenderer(canvas, onSelect);

const NATIVE_CANVAS_PROBE_DELAY_MS = 25_000;
const NATIVE_CANVAS_PROBE_PREFIX = 'PIXEL_OPS_NATIVE_PROBE ';

interface PixelRegionMetrics {
  colors: number;
  opaque: number;
}

function nativeCanvasProbeEnabled(): boolean {
  return (import.meta.env.DEV || import.meta.env.MODE === 'test')
    && import.meta.env.VITE_CANVAS_PROBE === '1';
}

function visibleElement(root: ParentNode, selector: string): boolean {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element || element.hidden) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function inspectCanvas(canvas: HTMLCanvasElement): {
  backend: 'canvas' | 'webgl' | 'unknown';
  regions: PixelRegionMetrics[];
} {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    const webgl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    return { backend: webgl ? 'webgl' : 'unknown', regions: [] };
  }

  const sampleWidth = Math.max(1, Math.min(120, Math.floor(canvas.width / 4)));
  const sampleHeight = Math.max(1, Math.min(120, Math.floor(canvas.height / 4)));
  const positions = [
    { x: 0, y: 0 },
    { x: Math.max(0, canvas.width - sampleWidth), y: 0 },
    { x: 0, y: Math.max(0, canvas.height - sampleHeight) },
    {
      x: Math.max(0, canvas.width - sampleWidth),
      y: Math.max(0, canvas.height - sampleHeight),
    },
  ];

  try {
    const regions = positions.map(({ x, y }) => {
      const pixels = context.getImageData(x, y, sampleWidth, sampleHeight).data;
      const colors = new Set<string>();
      let opaque = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`);
        if (pixels[index + 3] > 0) opaque += 1;
      }
      return { colors: colors.size, opaque };
    });
    return { backend: 'canvas', regions };
  } catch {
    return { backend: 'canvas', regions: [] };
  }
}

function createNativeCanvasProbeReport(
  canvas: HTMLCanvasElement,
  world: HTMLElement,
  errors: { error: number; unhandledrejection: number },
  interactionAttempted: boolean,
): string {
  const { backend, regions } = inspectCanvas(canvas);
  const controls = world.querySelectorAll('.pixi-agent-control');
  const firstControl = controls.item(0);
  const report = {
    backend,
    rendererState: world.dataset.rendererState ?? 'unknown',
    waitedMs: NATIVE_CANVAS_PROBE_DELAY_MS,
    dimensions: {
      width: canvas.width,
      height: canvas.height,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      visible: canvas.clientWidth > 0 && canvas.clientHeight > 0,
    },
    regions,
    pixels: {
      nonUniform: regions.length === 4 && regions.every(({ colors, opaque }) => colors > 1 && opaque > 0),
      opaque: regions.reduce((total, region) => total + region.opaque, 0),
    },
    controls: controls.length,
    interaction: {
      attempted: interactionAttempted,
      selected: firstControl?.getAttribute('aria-pressed') === 'true',
    },
    errors,
    rendererErrorVisible: visibleElement(world, '.renderer-error, .renderer-warning'),
    worldFallbackVisible: visibleElement(world, '.world-fallback'),
  };
  return `${NATIVE_CANVAS_PROBE_PREFIX}${JSON.stringify(report)}`;
}

function PixiWorld({
  agents,
  kanban = { tasks: [], partial: false },
  motions,
  selectedId,
  reducedMotion,
  paused = false,
  onMotionEnd,
  onOpenKanban,
  onSelect,
  createRenderer = defaultRendererFactory,
}: PixiWorldProps) {
  const worldRef = useRef<HTMLElement>(null);
  const motionListener = useRef(onMotionEnd);
  motionListener.current = onMotionEnd;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WorldRenderer | null>(null);
  const [rendererState, setRendererState] = useState<'starting' | 'ready' | 'unavailable'>('starting');
  const [nativeProbeOutput, setNativeProbeOutput] = useState<string | null>(null);
  const visualAgentSlots = agents.map((agent) => ({
    agent_id: agent.agent_id,
    task_phase: own(motions, agent.agent_id)?.placementPhase ?? visualPhaseForAgent(agent),
  }));

  const snapshot: PixiSceneSnapshot = {
    reducedMotion,
    paused,
    kanban,
    agents: agents.map((agent) => {
      const motion = own(motions, agent.agent_id);
      const visualPhase = visualPhaseForAgent(agent);
      const placementPhase = motion?.placementPhase ?? visualPhase;
      const visualAgent = visualPhase === agent.task_phase
        ? agent
        : { ...agent, task_phase: visualPhase };
      const placement = placementFor(
        agent.agent_id,
        placementPhase,
        placementPhase === 'available' ? 'break-room' : 'control-room',
        motion?.slotIndex ?? phaseSlotIndex(agent.agent_id, placementPhase, visualAgentSlots),
      );
      return {
        agent: visualAgent,
        hidden: placement.overflow,
        interaction: placement.interaction,
        selected: selectedId === agent.agent_id,
        motion: motion ?? {
          origin: placement.start,
          destination: placement.destination,
          moving: false,
        },
      };
    }),
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let active = true;
    const renderer = createRenderer(canvas, onSelect);
    rendererRef.current = renderer;
    renderer.setMotionListener?.((id, point, blocked) => motionListener.current?.(id, point, blocked));
    void renderer.start()
      .then(() => {
        if (active) setRendererState('ready');
      })
      .catch(() => {
        if (active) setRendererState('unavailable');
      });

    return () => {
      active = false;
      renderer.destroy();
      if (rendererRef.current === renderer) rendererRef.current = null;
    };
  }, [createRenderer, onSelect]);

  useEffect(() => {
    rendererRef.current?.sync(snapshot);
  }, [agents, kanban, motions, reducedMotion, paused, selectedId]);

  useEffect(() => {
    if (
      !nativeCanvasProbeEnabled() ||
      rendererState !== 'ready'
    ) {
      return undefined;
    }

    let active = true;
    let interactionTimer: number | undefined;
    const errors = { error: 0, unhandledrejection: 0 };
    const countError = () => {
      errors.error += 1;
    };
    const countUnhandledRejection = () => {
      errors.unhandledrejection += 1;
    };
    window.addEventListener('error', countError);
    window.addEventListener('unhandledrejection', countUnhandledRejection);

    const reportTimer = window.setTimeout(() => {
      const world = worldRef.current;
      const canvas = canvasRef.current;
      if (!world || !canvas) return;
      const firstControl = world.querySelector<HTMLButtonElement>('.pixi-agent-control');
      const interactionAttempted = Boolean(firstControl);
      firstControl?.click();
      interactionTimer = window.setTimeout(() => {
        if (!active) return;
        const output = createNativeCanvasProbeReport(
          canvas,
          world,
          { ...errors },
          interactionAttempted,
        );
        setNativeProbeOutput(output);
        console.info(output);
      }, 0);
    }, NATIVE_CANVAS_PROBE_DELAY_MS);

    return () => {
      active = false;
      window.clearTimeout(reportTimer);
      if (interactionTimer !== undefined) window.clearTimeout(interactionTimer);
      window.removeEventListener('error', countError);
      window.removeEventListener('unhandledrejection', countUnhandledRejection);
    };
  }, [rendererState]);

  return (
    <section
      ref={worldRef}
      className="pixi-world"
      aria-labelledby="pixi-world-title"
      data-renderer-state={rendererState}
    >
      <div className="screen-reader-world-copy">
        <h2 id="pixi-world-title">Monde opérationnel continu</h2>
        <h3>Laboratoire</h3>
        <p>Zone de travail avec bureaux, écrans, expériences, Kanban et tableau de réflexion.</p>
        <h3>Salle de repos</h3>
        <p>Salon chaleureux avec canapé, table basse, bibliothèque et coin café.</p>
        <p>Les deux zones forment un seul laboratoire AM Labs continu.</p>
        <h3>Kanban réel</h3>
        {kanban.tasks.length === 0 ? (
          <p>Aucune tâche active dans les boards lisibles.</p>
        ) : (
          <ul>
            {kanban.tasks.map((task) => (
              <li key={`${task.board_slug}:${task.task_id}`}>
                {task.status} · {task.title} · {task.assignee ?? 'non assignée'} · {task.board_slug}
              </li>
            ))}
          </ul>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className="pixi-world-canvas"
        data-testid="pixi-world-canvas"
        aria-hidden="true"
      />
      {onOpenKanban && <button className="kanban-hotspot" aria-label="Ouvrir le Kanban détaillé" onClick={onOpenKanban} />}
      <div className="pixi-agent-controls" aria-label="Opérateurs du monde">
        {snapshot.agents.map(({ agent, motion }) => {
          const visualPhase = visualPhaseForAgent(agent);
          const placementPhase = motion.placementPhase ?? visualPhase;
          const placement = placementFor(
            agent.agent_id,
            placementPhase,
            placementPhase === 'available' ? 'break-room' : 'control-room',
            motion.slotIndex ?? phaseSlotIndex(agent.agent_id, placementPhase, visualAgentSlots),
          );
          return (
            <button
              key={agent.agent_id}
              type="button"
              className="pixi-agent-control"
              aria-label={`Opérateur ${agent.display_name}`}
              aria-pressed={selectedId === agent.agent_id}
              data-testid="pixi-agent-control"
              data-state={visualPhase}
              data-zone={placement.zone}
              data-interaction={placement.interaction}
              data-origin-x={motion.origin.x}
              data-origin-y={motion.origin.y}
              data-destination-x={motion.destination.x}
              data-destination-y={motion.destination.y}
              data-route-points={JSON.stringify(routeBetween(motion.origin, motion.destination))}
              data-moving={reducedMotion ? 'false' : String(motion.moving)}
              title={`${agent.display_name} · ${visualPhase}${agent.task_title ? ` · ${agent.task_title}` : ''}`}
              onClick={() => onSelect(agent.agent_id)}
            >
              <span className="visually-hidden">
                Sélectionner {agent.display_name} · {phasePresentation(visualPhase).label}
              </span>
            </button>
          );
        })}
      </div>
      {rendererState === 'unavailable' && (
        <p className="renderer-warning" role="status">
          Le rendu graphique est indisponible, les contrôles accessibles restent utilisables.
        </p>
      )}
      {nativeProbeOutput && (
        <output className="visually-hidden" data-testid="pixi-native-probe" aria-live="polite">
          {nativeProbeOutput}
        </output>
      )}
    </section>
  );
}

export default PixiWorld;
