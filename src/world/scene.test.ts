import { describe, expect, it } from 'vitest';
import { buildSceneManifest } from './scene';

describe('shared scene geometry', () => {
  it('describes real objects, colliders and every seat approach without fictitious furniture', () => {
    const objects = buildSceneManifest();
    expect(objects.find((o) => o.id === 'laboratory-desk-shared')?.seats).toHaveLength(3);
    expect(new Set(objects.map((o) => o.id)).size).toBe(objects.length);
    expect(objects.flatMap((o) => o.seats)).toHaveLength(20);
    expect(objects.some((o) => ['television', 'beds'].includes(o.id))).toBe(false);
    for (const seat of objects.flatMap((o) => o.seats)) {
      expect(seat.approach.x).toBe(seat.point.x);
      if (seat.interaction === 'inspecting-lab') expect(seat.approach).toEqual(seat.point);
      else expect(seat.approach.y).toBeGreaterThan(seat.point.y);
    }
  });
});
