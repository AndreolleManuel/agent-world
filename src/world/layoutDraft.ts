import { LAB_WORK_SLOTS, SHARED_LAB_DESK, WORKSTATION_SLOTS } from './furniture';

export interface LayoutOffset { x: number; y: number }
export type LayoutDraft = Record<string, LayoutOffset>;
// Offsets belong to a specific base layout. Keep old drafts stored, but never
// reapply their translations on top of a newly accepted furniture placement.
export const LAYOUT_DRAFT_KEY = `pixel-ops-layout-draft-v2:${JSON.stringify([
  ...WORKSTATION_SLOTS.map((s) => [s.pixelX, s.pixelY]),
  ...LAB_WORK_SLOTS.map((s) => [s.pixelX, s.pixelY]),
  SHARED_LAB_DESK.left, SHARED_LAB_DESK.right,
])}`;
export const EDITABLE_DESKS = [
  ...WORKSTATION_SLOTS.map((slot, i) => ({ id: slot.objectId, name: `Bureau ${i + 1}`,
    x: slot.pixelX - 82, y: slot.pixelY - 72, width: 164, height: 179,
    matches: (label: string) => label.startsWith(`premium-desk-${i + 1}-`) || label.startsWith(`dynamic-desk-${i + 1}-`) })),
  { id: SHARED_LAB_DESK.id, name: 'Bureau triple', x: SHARED_LAB_DESK.left,
    y: SHARED_LAB_DESK.pixelY - 60, width: SHARED_LAB_DESK.right - SHARED_LAB_DESK.left, height: 127,
    matches: (label: string) => label.startsWith('shared-lab-') || /^(premium|dynamic)-lab-desk-[123]-/.test(label) },
  ...LAB_WORK_SLOTS.filter((slot) => slot.objectId !== SHARED_LAB_DESK.id).map((slot) => ({
    id: slot.objectId, name: 'Petit bureau', x: slot.pixelX - 53, y: slot.pixelY - 60, width: 106, height: 143,
    matches: (label: string) => /^(premium|dynamic)-lab-desk-4-/.test(label),
  })),
];

export function emptyLayout(): LayoutDraft {
  return Object.fromEntries(EDITABLE_DESKS.map(({ id }) => [id, { x: 0, y: 0 }]));
}

export function moveDesk(draft: LayoutDraft, id: string, x: number, y: number): LayoutDraft {
  const desk = EDITABLE_DESKS.find((item) => item.id === id);
  if (!desk || !Number.isFinite(x) || !Number.isFinite(y)) return draft;
  return { ...draft, [id]: {
    x: Math.round(Math.max(-desk.x, Math.min(1280 - desk.x - desk.width, x))),
    y: Math.round(Math.max(-desk.y, Math.min(720 - desk.y - desk.height, y))),
  } };
}

export function readLayout(raw: string | null): LayoutDraft {
  let draft = emptyLayout();
  try {
    const parsed = JSON.parse(raw ?? 'null');
    for (const { id } of EDITABLE_DESKS) {
      if (typeof parsed?.[id]?.x === 'number' && typeof parsed?.[id]?.y === 'number') {
        draft = moveDesk(draft, id, parsed[id].x, parsed[id].y);
      }
    }
  } catch { /* A broken draft must never prevent opening the editor. */ }
  return draft;
}

export function exportLayout(draft: LayoutDraft) {
  const shared = draft[SHARED_LAB_DESK.id];
  return {
    version: 1, world: { width: 1280, height: 720 }, proposalOnly: true,
    workstations: WORKSTATION_SLOTS.map((slot) => ({ id: slot.id,
      pixelX: slot.pixelX + draft[slot.objectId].x, pixelY: slot.pixelY + draft[slot.objectId].y })),
    sharedDesk: { ...SHARED_LAB_DESK, left: SHARED_LAB_DESK.left + shared.x,
      right: SHARED_LAB_DESK.right + shared.x, pixelY: SHARED_LAB_DESK.pixelY + shared.y },
    labWorkstations: LAB_WORK_SLOTS.map((slot) => ({ id: slot.id, objectId: slot.objectId,
      pixelX: slot.pixelX + draft[slot.objectId].x, pixelY: slot.pixelY + draft[slot.objectId].y,
      seatOffsetY: slot.seatOffsetY })),
  };
}
