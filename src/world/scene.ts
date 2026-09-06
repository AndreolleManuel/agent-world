import { WORKSTATION_SLOTS, LAB_WORK_SLOTS, LAB_BENCH_SLOTS, SHARED_LAB_DESK, BREAK_ROOM_SLOTS, type InteractionSlot } from './furniture';
import type { SpritePoint } from './placement';

export interface Obstacle { id: string; left: number; top: number; right: number; bottom: number }
// Floor footprints in the same percentage coordinates as furniture slots.
// The lower seat apron stays walkable; the final approach aligns the pelvis.
export const OBSTACLES: readonly Obstacle[] = [
  ...WORKSTATION_SLOTS.map((s) => ({ id: s.objectId, left: (s.pixelX - 90) / 12.8, right: (s.pixelX + 90) / 12.8, top: (s.pixelY - 47) / 7.2, bottom: (s.pixelY + 61) / 7.2 })),
  ...LAB_WORK_SLOTS.filter((s) => s.objectId !== SHARED_LAB_DESK.id).map((s) => ({ id: s.objectId, left: (s.pixelX - 57) / 12.8, right: (s.pixelX + 57) / 12.8, top: (s.pixelY - 31) / 7.2, bottom: (s.pixelY + 39) / 7.2 })),
  { id: SHARED_LAB_DESK.id, left: SHARED_LAB_DESK.left / 12.8, right: SHARED_LAB_DESK.right / 12.8, top: (SHARED_LAB_DESK.pixelY - 31) / 7.2, bottom: (SHARED_LAB_DESK.pixelY + 39) / 7.2 },
  { id: 'partition-north', left: 61, right: 64, top: 0, bottom: 52 },
  { id: 'partition-south', left: 61, right: 64, top: 69, bottom: 100 },
  { id: 'lounge-sofa', left: 70, right: 89, top: 36, bottom: 47.5 },
  { id: 'coffee-table', left: 72, right: 82.5, top: 55, bottom: 65 },
  { id: 'kitchen', left: 82.5, right: 98, top: 0, bottom: 35 },
  { id: 'lounge-cabinet', left: 74, right: 89, top: 80, bottom: 100 },
  { id: 'laboratory-bench', left: 0, right: 28, top: 0, bottom: 28 },
  { id: 'laboratory-equipment', left: 0, right: 16, top: 39, bottom: 53 },
];

export const SCENE_SEATS = [...WORKSTATION_SLOTS, ...LAB_WORK_SLOTS, ...LAB_BENCH_SLOTS, ...BREAK_ROOM_SLOTS];
export function seatApproach(seat: InteractionSlot): SpritePoint {
  // Standing bench operators can leave laterally; sending them south first
  // would push them into the nearby desk's safety envelope.
  if (seat.interaction === 'inspecting-lab') return { ...seat.point };
  return { x: seat.point.x, y: seat.point.y + (seat.interaction === 'typing-at-desk' ? 5 : 3) };
}
export interface SceneObject {
  id: string;
  obstacle?: Obstacle;
  seats: Array<InteractionSlot & { approach: SpritePoint }>;
  rendering: 'layered-workstation' | 'baked-decor' | 'added-seat';
}
export function buildSceneManifest(): SceneObject[] {
  const ids = new Set([...OBSTACLES.map((o) => o.id), ...SCENE_SEATS.map((s) => s.objectId)]);
  return [...ids].map((id) => ({ id, obstacle: OBSTACLES.find((o) => o.id === id),
    seats: SCENE_SEATS.filter((s) => s.objectId === id).map((s) => ({ ...s, approach: seatApproach(s) })),
    rendering: id.startsWith('desk-') || id.startsWith('laboratory-desk') ? 'layered-workstation' : id === 'lounge-added-seat' ? 'added-seat' : 'baked-decor',
  }));
}
