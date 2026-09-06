import type { AgentInteraction, SpritePoint } from './placement';

export interface InteractionSlot {
  id: string;
  objectId: string;
  point: SpritePoint;
  interaction: AgentInteraction;
}

export interface WorkstationSlot extends InteractionSlot {
  objectId: `desk-${number}`;
  interaction: 'typing-at-desk';
  pixelX: number;
  pixelY: number;
}

export interface LabWorkSlot extends InteractionSlot {
  interaction: 'researching-at-lab';
  pixelX: number;
  pixelY: number;
  seatOffsetY: number;
}

export interface AddedLoungeSeat extends InteractionSlot {
  objectId: 'lounge-added-seat';
  interaction: 'reading-in-lounge' | 'playing-handheld' | 'drinking-coffee';
  kind: 'stool' | 'cushion' | 'existing-stool';
  pixelX: number;
  pixelY: number;
}

// Manu's exported placement-bureaux.json (2026-09-05): two large desks above,
// two staggered in the middle, a compact on the right and the triple below.
// Derive the pelvis from the physical furniture so moving a desk cannot leave
// its occupant or chair behind. The room on the right is unchanged.
function workDesk(id: number, pixelX: number, pixelY: number): WorkstationSlot {
  return { id: `desk-${id}-seat`, objectId: `desk-${id}`, interaction: 'typing-at-desk',
    pixelX, pixelY, point: { x: pixelX / 12.8, y: (pixelY + 55) / 7.2 } };
}
function labDesk(id: string, pixelX: number, pixelY: number, objectId = `laboratory-desk-${id}`): LabWorkSlot {
  const seatOffsetY = objectId === SHARED_LAB_DESK.id ? SHARED_LAB_DESK.seatOffsetY : 48;
  return { id: `lab-${id}`, objectId, interaction: 'researching-at-lab',
    pixelX, pixelY, seatOffsetY, point: { x: pixelX / 12.8, y: (pixelY + seatOffsetY) / 7.2 } };
}
export const WORKSTATION_SLOTS: readonly WorkstationSlot[] = [
  workDesk(1, 348, 276), workDesk(2, 601, 277),
  workDesk(3, 174, 448), workDesk(4, 452, 417),
];
export const SHARED_LAB_DESK = { id: 'laboratory-desk-shared', left: 229, right: 559, pixelY: 567, seatOffsetY: 38 } as const;
export const LAB_WORK_SLOTS: readonly LabWorkSlot[] = [
  labDesk('left', 279, SHARED_LAB_DESK.pixelY, SHARED_LAB_DESK.id),
  labDesk('right', 394, SHARED_LAB_DESK.pixelY, SHARED_LAB_DESK.id),
  labDesk('analysis-upper', 509, SHARED_LAB_DESK.pixelY, SHARED_LAB_DESK.id),
  labDesk('analysis-lower', 656, 445),
];

export const LAB_BENCH_SLOTS: readonly InteractionSlot[] = [
  { id: 'bench-microscope', objectId: 'laboratory-bench', interaction: 'inspecting-lab', point: { x: 14, y: 30.5 } },
  { id: 'bench-experiments', objectId: 'laboratory-bench', interaction: 'inspecting-lab', point: { x: 20, y: 30 } },
];

export const WORKING_SLOTS: readonly InteractionSlot[] = [
  ...WORKSTATION_SLOTS,
  ...LAB_WORK_SLOTS,
  ...LAB_BENCH_SLOTS,
];

export const KANBAN_SLOTS: readonly InteractionSlot[] = [
  { id: 'kanban-1', objectId: 'kanban-board', interaction: 'reading-kanban', point: { x: 49, y: 35 } },
  { id: 'kanban-2', objectId: 'kanban-board', interaction: 'reading-kanban', point: { x: 57, y: 35 } },
  { id: 'kanban-3', objectId: 'kanban-board', interaction: 'reading-kanban', point: { x: 65, y: 35 } },
  { id: 'kanban-4', objectId: 'kanban-board', interaction: 'reading-kanban', point: { x: 52, y: 41 } },
  { id: 'kanban-5', objectId: 'kanban-board', interaction: 'reading-kanban', point: { x: 61, y: 41 } },
];

export const THINKING_SLOTS: readonly InteractionSlot[] = [
  { id: 'thinking-1', objectId: 'thinking-board', interaction: 'thinking-at-board', point: { x: 50, y: 60 } },
  { id: 'thinking-2', objectId: 'thinking-board', interaction: 'thinking-at-board', point: { x: 58, y: 60 } },
];

export const BLOCKED_SLOTS: readonly InteractionSlot[] = [
  { id: 'blocked-1', objectId: 'thinking-board', interaction: 'blocked-at-board', point: { x: 47, y: 61 } },
  { id: 'blocked-2', objectId: 'thinking-board', interaction: 'blocked-at-board', point: { x: 53, y: 63 } },
  { id: 'blocked-3', objectId: 'thinking-board', interaction: 'blocked-at-board', point: { x: 59, y: 61 } },
  { id: 'blocked-4', objectId: 'thinking-board', interaction: 'blocked-at-board', point: { x: 50, y: 69 } },
  { id: 'blocked-5', objectId: 'thinking-board', interaction: 'blocked-at-board', point: { x: 57, y: 69 } },
];

export const ADDED_LOUNGE_SEATS: readonly AddedLoungeSeat[] = [
  { id: 'door-stool-left', objectId: 'lounge-added-seat', interaction: 'drinking-coffee', kind: 'stool', point: { x: 69.5, y: 31 }, pixelX: 890, pixelY: 223 },
  { id: 'door-stool-right', objectId: 'lounge-added-seat', interaction: 'reading-in-lounge', kind: 'stool', point: { x: 79.5, y: 31 }, pixelX: 1_018, pixelY: 223 },
  { id: 'rug-cushion-left', objectId: 'lounge-added-seat', interaction: 'playing-handheld', kind: 'cushion', point: { x: 75, y: 71.5 }, pixelX: 960, pixelY: 515 },
  { id: 'rug-cushion-right', objectId: 'lounge-added-seat', interaction: 'drinking-coffee', kind: 'cushion', point: { x: 82, y: 73 }, pixelX: 1_050, pixelY: 526 },
  { id: 'side-stool', objectId: 'lounge-added-seat', interaction: 'reading-in-lounge', kind: 'existing-stool', point: { x: 95, y: 65 }, pixelX: 1_216, pixelY: 468 },
];

export const BREAK_ROOM_SLOTS: readonly InteractionSlot[] = [
  { id: 'sofa-left', objectId: 'lounge-sofa', interaction: 'reading-in-lounge', point: { x: 72.5, y: 49.5 } },
  { id: 'sofa-middle', objectId: 'lounge-sofa', interaction: 'playing-handheld', point: { x: 79, y: 49.5 } },
  { id: 'sofa-right', objectId: 'lounge-sofa', interaction: 'drinking-coffee', point: { x: 85.5, y: 49.5 } },
  { id: 'pouf', objectId: 'lounge-pouf', interaction: 'playing-handheld', point: { x: 68, y: 70 } },
  { id: 'armchair', objectId: 'lounge-armchair', interaction: 'reading-in-lounge', point: { x: 86.8, y: 67.5 } },
  ...ADDED_LOUNGE_SEATS,
];

export const BREAK_ROOM_SEAT_COUNT = 10;

const PHASE_SLOTS: Record<string, readonly InteractionSlot[]> = {
  live_run: WORKING_SLOTS,
  live_session: WORKING_SLOTS,
  review_pending: WORKING_SLOTS,
  blocked: WORKING_SLOTS,
  ready_unclaimed: WORKING_SLOTS,
  todo_not_started: WORKING_SLOTS,
  telemetry_unavailable: WORKING_SLOTS,
  available: BREAK_ROOM_SLOTS,
};

export function slotsForPhase(phase: string): readonly InteractionSlot[] | undefined {
  return PHASE_SLOTS[phase];
}

export function interactionSlotFor(phase: string, slotIndex: number): InteractionSlot | undefined {
  const slots = slotsForPhase(phase);
  if (!slots?.length) return undefined;
  return slots[slotIndex];
}

export function workstationIndexFor(point: SpritePoint): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  WORKSTATION_SLOTS.forEach(({ point: interactionPoint }, index) => {
    const distance = ((point.x - interactionPoint.x) ** 2)
      + ((point.y - interactionPoint.y) ** 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

export function labWorkstationIndexFor(point: SpritePoint): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  LAB_WORK_SLOTS.forEach(({ point: interactionPoint }, index) => {
    const distance = ((point.x - interactionPoint.x) ** 2)
      + ((point.y - interactionPoint.y) ** 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}
