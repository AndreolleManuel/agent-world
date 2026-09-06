import { describe, expect, it } from 'vitest';
import { EDITABLE_DESKS, emptyLayout, exportLayout, moveDesk, readLayout } from './layoutDraft';
import { LAB_WORK_SLOTS, SHARED_LAB_DESK, WORKSTATION_SLOTS } from './furniture';

describe('isolated furniture layout draft', () => {
  it('groups all eight seated positions into six draggable pieces', () => {
    expect(EDITABLE_DESKS).toHaveLength(6);
    const shared = EDITABLE_DESKS.find((desk) => desk.id === SHARED_LAB_DESK.id)!;
    for (const label of ['shared-lab-worktop', 'shared-lab-pedestal-0', 'premium-lab-desk-1-chair',
      'premium-lab-desk-2-keyboard', 'dynamic-lab-desk-3-glow']) expect(shared.matches(label)).toBe(true);
    expect(shared.matches('premium-lab-desk-4-chair')).toBe(false);
    expect(shared.matches('premium-desk-1-chair')).toBe(false);
  });

  it('exports a rigid triple translation without changing the live constants', () => {
    const before = JSON.stringify({ WORKSTATION_SLOTS, LAB_WORK_SLOTS, SHARED_LAB_DESK });
    const draft = moveDesk(emptyLayout(), SHARED_LAB_DESK.id, 15, 35);
    const result = exportLayout(draft);
    expect(result.sharedDesk.pixelY).toBe(SHARED_LAB_DESK.pixelY + 35);
    expect(result.sharedDesk.left).toBe(SHARED_LAB_DESK.left + 15);
    expect(result.sharedDesk.right - result.sharedDesk.left).toBe(330);
    result.labWorkstations.slice(0, 3).forEach((slot, i) => {
      expect(slot.pixelX).toBe(LAB_WORK_SLOTS[i].pixelX + 15);
      expect(slot.pixelY).toBe(LAB_WORK_SLOTS[i].pixelY + 35);
      expect(slot.seatOffsetY).toBe(38);
    });
    expect(result.workstations[0].pixelY).toBe(WORKSTATION_SLOTS[0].pixelY);
    expect(JSON.stringify({ WORKSTATION_SLOTS, LAB_WORK_SLOTS, SHARED_LAB_DESK })).toBe(before);
  });

  it('preserves chair-sized bounds within the image and rounds positions', () => {
    const draft = moveDesk(emptyLayout(), 'desk-1', 9999, 9999);
    const desk = EDITABLE_DESKS[0];
    expect(desk.x + draft['desk-1'].x + desk.width).toBe(1280);
    expect(desk.y + draft['desk-1'].y + desk.height).toBe(720);
    expect(moveDesk(draft, 'desk-1', 1.4, 2.8)['desk-1']).toEqual({ x: 1, y: 3 });
  });

  it('restores valid drafts and tolerates malformed storage', () => {
    const draft = moveDesk(emptyLayout(), 'desk-2', -20, 15);
    expect(readLayout(JSON.stringify(draft))).toEqual(draft);
    expect(readLayout('{bad')).toEqual(emptyLayout());
    expect(readLayout('{"desk-1":{"x":"wrong","y":null}}')).toEqual(emptyLayout());
    expect(moveDesk(draft, 'desk-1', NaN, 0)).toBe(draft);
  });
});
