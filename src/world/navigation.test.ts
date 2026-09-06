import { describe, expect, it } from 'vitest';
import { navigate, safeRouteSegment, movementDuration, routeLength } from './navigation';
import { WORKING_SLOTS, BREAK_ROOM_SLOTS } from './furniture';
import { placementFor, reconcilePhaseSlots } from './placement';

describe('safe circulation and capacity', () => {
  it('routes around another actor and refuses an occupied destination', () => {
    const from = { x: 52, y: 89 }, to = { x: 52, y: 69 }, body = { x: 52, y: 79 };
    const route = navigate(from, to, [body]);
    expect(route.at(-1)).toEqual(to);
    expect(route.length).toBeGreaterThan(2);
    expect(navigate(from, to, [to])).toEqual([from]);
    for (let i = 0; i < route.length - 1; i++) for (let step = 0; step <= 100; step++) {
      const p = { x: route[i].x + (route[i + 1].x - route[i].x) * step / 100, y: route[i].y + (route[i + 1].y - route[i].y) * step / 100 };
      expect(Math.abs(p.x - body.x) * 12.8 >= 18 || Math.abs(p.y - body.y) * 7.2 >= 14).toBe(true);
    }
  });
  it('can transfer a full ten-agent team in both directions with occupied seats', () => {
    const work = WORKING_SLOTS.map((s) => s.point), rest = BREAK_ROOM_SLOTS.map((s) => s.point);
    for (const [origins, destinations] of [[work, rest], [rest, work]]) {
      const positions = origins.map((p) => ({ ...p }));
      const pending = new Set(positions.map((_, i) => i));
      while (pending.size) {
        let moved = false;
        for (const i of pending) {
          const route = navigate(positions[i], destinations[i], positions.filter((_, j) => j !== i));
          if (route.length < 2) continue;
          expect(route.at(-1)).toEqual(destinations[i]);
          positions[i] = destinations[i]; pending.delete(i); moved = true; break;
        }
        expect(moved, `Blocked transfers: ${[...pending].join(',')}`).toBe(true);
      }
    }
  });
  it('keeps all ten agents visible in every lab state and in mixed states without duplicate seats', () => {
    const phases = ['live_run', 'live_session', 'blocked', 'review_pending', 'todo_not_started', 'ready_unclaimed', 'telemetry_unavailable'];
    for (const phase of [...phases, 'mixed']) {
      const agents = Array.from({ length: 10 }, (_, i) => ({ agent_id: `agent-${i}`, task_phase: phase === 'mixed' ? phases[i % phases.length] : phase }));
      const assignments = reconcilePhaseSlots({}, agents);
      const positions = agents.map((a) => placementFor(a.agent_id, a.task_phase, 'control-room', assignments[a.agent_id].slotIndex));
      expect(positions.every((p) => !p.overflow && p.destination.x < 61)).toBe(true);
      expect(new Set(positions.map((p) => JSON.stringify(p.destination))).size).toBe(10);
    }
  });
  it('connects every real seat without crossing any furniture or partition footprint', () => {
    const points = [...WORKING_SLOTS, ...BREAK_ROOM_SLOTS].map((s) => s.point);
    for (const from of points) for (const to of points) {
      const route = navigate(from, to);
      expect(route.at(-1), JSON.stringify([from, to])).toEqual(to);
      route.slice(1).forEach((p, i) => expect(safeRouteSegment(route[i], p), JSON.stringify(route)).toBe(true));
    }
  });
  it('refuses invalid destinations and preserves constant world speed', () => {
    const origin = { x: 52, y: 89 };
    expect(navigate(origin, { x: 77, y: 60 })).toEqual([origin]);
    const short = [origin, { x: 52, y: 79 }], long = [origin, { x: 52, y: 69 }];
    expect(movementDuration(long) / movementDuration(short)).toBeCloseTo(2);
    expect(routeLength(long) / (movementDuration(long) / 1000)).toBeCloseTo(160);
  });
  it('never duplicates occupied slots across phases and refills freed work seats', () => {
    const agents = Array.from({ length: 40 }, (_, i) => ({ agent_id: `agent-${i.toString().padStart(2, '0')}`, task_phase: i % 2 ? 'live_run' : 'live_session' }));
    const slots = reconcilePhaseSlots({}, agents);
    const placements = agents.map((a) => placementFor(a.agent_id, a.task_phase, 'control-room', slots[a.agent_id].slotIndex));
    expect(placements.filter((p) => !p.overflow)).toHaveLength(10);
    expect(new Set(placements.filter((p) => !p.overflow).map((p) => JSON.stringify(p.destination))).size).toBe(10);
    const next = reconcilePhaseSlots(slots, agents.slice(1));
    expect(next['agent-10'].slotIndex).toBe(0);
  });
});
