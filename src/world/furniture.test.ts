import { describe, expect, it } from 'vitest';

import {
  BREAK_ROOM_SLOTS,
  LAB_WORK_SLOTS,
  SHARED_LAB_DESK,
  WORKSTATION_SLOTS,
  interactionSlotFor,
  workstationIndexFor,
} from './furniture';

describe('workstation furniture slots', () => {
  it('matches Manu’s exported coordinates exactly, including the triple below and compact on the right', () => {
    expect(WORKSTATION_SLOTS.map((s) => [s.pixelX, s.pixelY])).toEqual([[348, 276], [601, 277], [174, 448], [452, 417]]);
    expect(LAB_WORK_SLOTS.map((s) => [s.pixelX, s.pixelY])).toEqual([[279, 567], [394, 567], [509, 567], [656, 445]]);
    expect(SHARED_LAB_DESK).toMatchObject({ left: 229, right: 559, pixelY: 567, seatOffsetY: 38 });
  });
  it('declares every desk as an independent interactive object', () => {
    expect(WORKSTATION_SLOTS).toHaveLength(4);
    expect(WORKSTATION_SLOTS.map(({ objectId }) => objectId)).toEqual([
      'desk-1', 'desk-2', 'desk-3', 'desk-4',
    ]);
    expect(new Set(WORKSTATION_SLOTS.map(({ point }) => JSON.stringify(point))).size).toBe(4);
  });

  it('maps every seated agent to the physical desk centered under it', () => {
    WORKSTATION_SLOTS.forEach(({ point }, index) => {
      expect(workstationIndexFor(point)).toBe(index);
    });
    for (const s of WORKSTATION_SLOTS) {
      expect(s.point.x * 12.8).toBeCloseTo(s.pixelX);
      expect(s.point.y * 7.2).toBeCloseTo(s.pixelY + 55);
    }
    for (const s of LAB_WORK_SLOTS) {
      expect(s.point.x * 12.8).toBeCloseTo(s.pixelX);
      expect(s.point.y * 7.2).toBeCloseTo(s.pixelY + s.seatOffsetY);
    }
    expect(new Set(WORKSTATION_SLOTS.map((s) => s.pixelY)).size).toBe(4);
  });

  it('leaves a floor margin below the entire pulled-back chair, not just the desktop', () => {
    // Large chair bottom: desk Y + 55 seat - 50 top + 90 height + 12 pullback.
    for (const s of WORKSTATION_SLOTS) expect(s.pixelY + 107).toBeLessThanOrEqual(625);
  });

  it('uses four large desks, four compact desks and two existing bench places before overflow', () => {
    expect(interactionSlotFor('live_run', 0)?.interaction).toBe('typing-at-desk');
    expect(interactionSlotFor('live_run', 1)?.interaction).toBe('typing-at-desk');
    expect(interactionSlotFor('live_run', 4)).toMatchObject({
      objectId: 'laboratory-desk-shared',
      interaction: 'researching-at-lab',
    });
    expect(interactionSlotFor('live_run', 5)).toMatchObject({
      objectId: 'laboratory-desk-shared',
      interaction: 'researching-at-lab',
    });
    expect(interactionSlotFor('live_run', 8)?.objectId).toBe('laboratory-bench');
    expect(interactionSlotFor('live_run', 9)?.interaction).toBe('inspecting-lab');
    expect(interactionSlotFor('live_run', 10)).toBeUndefined();
    expect(interactionSlotFor('live_run', 100)).toBeUndefined();
    expect(LAB_WORK_SLOTS).toHaveLength(4);
  });

  it('keeps desk rectangles separated and the entrance corridor clear', () => {
    const largeDeskBounds = WORKSTATION_SLOTS.map(({ pixelX, pixelY }) => ({
      left: pixelX - 82,
      right: pixelX + 82,
      top: pixelY - 47,
      bottom: pixelY + 61,
    }));
    largeDeskBounds.forEach((bounds, index) => {
      largeDeskBounds.slice(index + 1).forEach((other) => {
        const overlaps = bounds.left < other.right
          && bounds.right > other.left
          && bounds.top < other.bottom
          && bounds.bottom > other.top;
        expect(overlaps).toBe(false);
      });
    });
    expect(Math.max(...largeDeskBounds.filter(({ top }) => top > 400).map(({ right }) => right)))
      .toBeLessThan(650);
  });

  it('binds break-room activities to actual furniture slots', () => {
    expect(BREAK_ROOM_SLOTS).toHaveLength(10);
    expect(interactionSlotFor('available', 0)).toMatchObject({
      objectId: 'lounge-sofa',
      interaction: 'reading-in-lounge',
      point: { x: 72.5, y: 49.5 },
    });
    expect(interactionSlotFor('available', 3)).toMatchObject({
      objectId: 'lounge-pouf',
      interaction: 'playing-handheld',
    });
    expect(interactionSlotFor('available', 4)).toMatchObject({
      objectId: 'lounge-armchair',
      interaction: 'reading-in-lounge',
    });
    expect(BREAK_ROOM_SLOTS.slice(5, 10).every(({ objectId, interaction }) =>
      objectId === 'lounge-added-seat' && [
        'reading-in-lounge',
        'playing-handheld',
        'drinking-coffee',
      ].includes(interaction)))
      .toBe(true);
    expect(interactionSlotFor('available', 10)).toBeUndefined();
    expect(BREAK_ROOM_SLOTS.some(({ objectId }) => [
      'coffee-machine',
      'kitchen-counter',
      'kitchen-sink',
      'lounge-bookshelf',
      'lounge-plants',
      'lounge-side-table',
    ].includes(objectId))).toBe(false);
  });
});
