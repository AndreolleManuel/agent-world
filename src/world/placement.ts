import { own, dictionary } from '../records';
import {
  interactionSlotFor,
  slotsForPhase,
} from './furniture';
import { navigate } from './navigation';

export type WorldScene = 'control-room' | 'break-room';

export type PlacementZone =
  | 'console'
  | 'review-desk'
  | 'blocked-bay'
  | 'queue-ready'
  | 'queue-todo'
  | 'rest'
  | 'unknown';

export type AgentInteraction =
  | 'inspecting-lab'
  | 'typing-at-desk'
  | 'researching-at-lab'
  | 'thinking-at-board'
  | 'blocked-at-board'
  | 'reading-kanban'
  | 'sitting-on-sofa'
  | 'sitting-in-armchair'
  | 'sitting-on-pouf'
  | 'having-coffee'
  | 'cooking-at-counter'
  | 'washing-dishes'
  | 'reading-in-lounge'
  | 'playing-handheld'
  | 'drinking-coffee'
  | 'reading-at-bookshelf'
  | 'checking-whiteboard'
  | 'watering-plants'
  | 'checking-phone'
  | 'standing-idle'
  | 'offline';

export interface SpritePoint {
  x: number;
  y: number;
}

export interface AgentPlacement {
  overflow: boolean;
  scene: WorldScene;
  zone: PlacementZone;
  start: SpritePoint;
  destination: SpritePoint;
  interaction: AgentInteraction;
  animationDelaySeconds: number;
}

export interface AgentAppearance {
  skin: string;
  hair: string;
  shirt: string;
  trousers: string;
  shoes: string;
  hairStyle: 'crop' | 'bob' | 'curls' | 'tuft';
  glasses: boolean;
}

export interface WorldPlan {
  controlRoom: { minX: number; maxX: number; minY: number; maxY: number };
  breakRoom: { minX: number; maxX: number; minY: number; maxY: number };
  breakRoomStartX: number;
  controlDoorway: SpritePoint;
  breakRoomDoorway: SpritePoint;
}

export interface PhasePresentation {
  action: string;
  destination: PlacementZone | 'break-room';
  label: string;
}

export interface PhaseSlotAssignment {
  phase: string;
  slotIndex: number;
}

export type PhaseSlotAssignments = Record<string, PhaseSlotAssignment>;

export const DESK_IDLE_GRACE_MS = 90_000;
export type DeskPresence = Record<string, { phase: string; lastActiveAt: number }>;

// Keep the destination stable between short tasks, without retaining a work
// status. Only fresh observations can renew the grace period.
export function reconcileDeskPresence(
  previous: DeskPresence,
  agents: readonly { agent_id: string; task_phase: string }[],
  now: number,
): DeskPresence {
  return Object.fromEntries(agents.flatMap(({ agent_id, task_phase }) => {
    if (task_phase === 'live_run' || task_phase === 'live_session') {
      return [[agent_id, { phase: task_phase, lastActiveAt: now }]];
    }
    const recent = own(previous, agent_id);
    if (task_phase === 'available' && recent && now - recent.lastActiveAt < DESK_IDLE_GRACE_MS) {
      return [[agent_id, recent]];
    }
    return [];
  }));
}

function slotGroupForPhase(phase: string): string {
  return phase === 'available' ? 'available' : 'laboratory';
}

export function phasePresentation(phase: string): PhasePresentation {
  switch (phase) {
    case 'live_run':
      return { action: 'working', destination: 'console', label: 'Run Kanban confirmé' };
    case 'live_session':
      return { action: 'working', destination: 'console', label: 'Session Hermes active' };
    case 'review_pending':
      return { action: 'reviewing', destination: 'review-desk', label: 'Revue en attente' };
    case 'blocked':
      return { action: 'blocked', destination: 'blocked-bay', label: 'Bloquée' };
    case 'ready_unclaimed':
      return { action: 'queued', destination: 'queue-ready', label: 'Carte prête, aucun worker' };
    case 'todo_not_started':
      return { action: 'queued', destination: 'queue-todo', label: 'Carte assignée, non démarrée' };
    case 'telemetry_unavailable':
      return { action: 'unavailable', destination: 'unknown', label: 'Télémétrie indisponible' };
    default:
      return { action: 'resting', destination: 'break-room', label: 'Disponible' };
  }
}

export const WORLD_PLAN: WorldPlan = {
  controlRoom: { minX: 3, maxX: 60, minY: 8, maxY: 92 },
  breakRoom: { minX: 63, maxX: 97, minY: 8, maxY: 92 },
  breakRoomStartX: 63,
  controlDoorway: { x: 60, y: 58 },
  breakRoomDoorway: { x: 64, y: 58 },
};

interface PlacementRegion {
  scene: WorldScene;
  zone: PlacementZone;
  anchors: readonly SpritePoint[];
  interactions: readonly AgentInteraction[];
  jitterX: number;
  jitterY: number;
}

const PHASE_REGIONS: Record<string, PlacementRegion> = Object.fromEntries(
  ([
    ['live_run', 'console'], ['live_session', 'console'], ['review_pending', 'review-desk'],
    ['blocked', 'blocked-bay'], ['ready_unclaimed', 'queue-ready'], ['todo_not_started', 'queue-todo'],
    ['available', 'rest'], ['telemetry_unavailable', 'unknown'],
  ] as const).map(([phase, zone]) => [phase, {
    scene: phase === 'available' ? 'break-room' : 'control-room',
    zone,
    anchors: slotsForPhase(phase)!.map(({ point }) => point),
    interactions: slotsForPhase(phase)!.map(({ interaction }) => interaction),
    jitterX: 0, jitterY: 0,
  }]),
);

const UNKNOWN_REGION = PHASE_REGIONS.telemetry_unavailable;

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function avatarVariantFor(agentId: string, variantCount: number): number {
  if (!Number.isFinite(variantCount) || variantCount < 1) return 0;
  return stableHash(agentId) % Math.floor(variantCount);
}

export function availableAvatarVariantFor(
  agentId: string,
  variantCount: number,
  usedVariants: ReadonlySet<number>,
): number {
  if (!Number.isFinite(variantCount) || variantCount < 1) return 0;
  const count = Math.floor(variantCount);
  const preferred = avatarVariantFor(agentId, count);
  for (let offset = 0; offset < count; offset += 1) {
    const candidate = (preferred + offset) % count;
    if (!usedVariants.has(candidate)) return candidate;
  }
  return preferred;
}

const APPEARANCE_PALETTES = {
  skin: ['#f8cfa9', '#e9ad7b', '#bd7958', '#7a4938'],
  hair: ['#44302b', '#7b492f', '#d08a38', '#252d50', '#783f63'],
  shirt: ['#38bfa8', '#ef6f61', '#f2b94b', '#7b78d2', '#65aee8', '#79b66b'],
  trousers: ['#40577d', '#614c73', '#39736d', '#8d6045'],
  shoes: ['#483b45', '#3f5265', '#70493f'],
  hairStyle: ['crop', 'bob', 'curls', 'tuft'] as const,
};

export function appearanceFor(agentId: string): AgentAppearance {
  const hash = stableHash(agentId);

  return {
    skin: APPEARANCE_PALETTES.skin[hash % APPEARANCE_PALETTES.skin.length],
    hair: APPEARANCE_PALETTES.hair[(hash >>> 3) % APPEARANCE_PALETTES.hair.length],
    shirt: APPEARANCE_PALETTES.shirt[(hash >>> 6) % APPEARANCE_PALETTES.shirt.length],
    trousers: APPEARANCE_PALETTES.trousers[(hash >>> 9) % APPEARANCE_PALETTES.trousers.length],
    shoes: APPEARANCE_PALETTES.shoes[(hash >>> 11) % APPEARANCE_PALETTES.shoes.length],
    hairStyle: APPEARANCE_PALETTES.hairStyle[(hash >>> 13) % APPEARANCE_PALETTES.hairStyle.length],
    glasses: ((hash >>> 15) & 1) === 1,
  };
}

function destinationFor(seed: string, region: PlacementRegion, slotIndex?: number): SpritePoint {
  return region.anchors[slotIndex ?? stableHash(seed) % region.anchors.length] ?? { x: 52, y: 89 };
}

export function placementFor(
  agentId: string,
  taskPhase: string,
  _scene: WorldScene,
  slotIndex?: number,
): AgentPlacement {
  const region = own(PHASE_REGIONS, taskPhase) ?? UNKNOWN_REGION;
  const objectSlot = slotIndex === undefined
    ? undefined
    : interactionSlotFor(taskPhase, slotIndex);
  const effectiveScene = region.scene;
  const destinationSeed = `${agentId}:${taskPhase}:${effectiveScene}`;
  const startRegion = effectiveScene === 'break-room'
    ? { x: 64, y: 58 }
    : { x: 52, y: 89 };


  return {
    overflow: slotIndex !== undefined && slotIndex >= (slotsForPhase(taskPhase)?.length ?? 6),
    scene: effectiveScene,
    zone: region.zone,
    start: {
      ...startRegion,
    },
    destination: objectSlot?.point ?? destinationFor(destinationSeed, region, slotIndex),
    interaction: slotIndex !== undefined && !objectSlot ? 'standing-idle' : objectSlot?.interaction ?? region.interactions[
      (slotIndex ?? stableHash(`${destinationSeed}:interaction`)) % region.interactions.length
    ],
    animationDelaySeconds: -(stableHash(`${agentId}:animation`) % 60) / 100,
  };
}

export function phaseSlotIndex(
  agentId: string,
  taskPhase: string,
  agents: readonly { agent_id: string; task_phase: string }[],
): number {
  const peerIds = agents
    .filter((agent) => slotGroupForPhase(agent.task_phase) === slotGroupForPhase(taskPhase))
    .map((agent) => agent.agent_id)
    .sort((left, right) => left.localeCompare(right));
  const index = peerIds.indexOf(agentId);
  return index < 0 ? 0 : index;
}

export function reconcilePhaseSlots(
  previous: PhaseSlotAssignments,
  agents: readonly { agent_id: string; task_phase: string }[],
): PhaseSlotAssignments {
  const next = dictionary<PhaseSlotAssignment>();
  const usedByPhase = new Map<string, Set<number>>();
  const orderedAgents = [...agents]
    .sort((left, right) => left.agent_id.localeCompare(right.agent_id));

  for (const agent of orderedAgents) {
    const existing = own(previous, agent.agent_id);
    const group = slotGroupForPhase(agent.task_phase);
    // Keep occupants already on a real seat stable. Only overflow occupants are
    // compacted when one of those seats becomes available.
    if (existing && existing.slotIndex >= (slotsForPhase(agent.task_phase)?.length ?? 0)) continue;
    if (!existing || slotGroupForPhase(existing.phase) !== group) continue;
    const used = usedByPhase.get(group) ?? new Set<number>();
    if (used.has(existing.slotIndex)) continue;
    used.add(existing.slotIndex);
    usedByPhase.set(group, used);
    next[agent.agent_id] = { phase: agent.task_phase, slotIndex: existing.slotIndex };
  }

  for (const agent of orderedAgents) {
    if (next[agent.agent_id]) continue;
    const group = slotGroupForPhase(agent.task_phase);
    const used = usedByPhase.get(group) ?? new Set<number>();
    let slotIndex = 0;
    while (used.has(slotIndex)) slotIndex += 1;
    used.add(slotIndex);
    usedByPhase.set(group, used);
    next[agent.agent_id] = { phase: agent.task_phase, slotIndex };
  }

  return next;
}

export function routeBetween(origin: SpritePoint, destination: SpritePoint): SpritePoint[] {
  return navigate(origin, destination);
}
