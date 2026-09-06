import { WORKSTATION_SLOTS } from './furniture';
import { safeRouteSegment } from './navigation';
import { describe, expect, it } from 'vitest';

import {
  WORLD_PLAN,
  appearanceFor,
  availableAvatarVariantFor,
  avatarVariantFor,
  phaseSlotIndex,
  phasePresentation,
  placementFor,
  reconcilePhaseSlots,
  routeBetween,
} from './placement';

describe('placementFor', () => {
  it('distinguishes a confirmed Kanban run from an active Hermes session', () => {
    expect(phasePresentation('live_run').label).toBe('Run Kanban confirmé');
    expect(phasePresentation('live_session').label).toBe('Session Hermes active');
  });

  it('keeps avatar identities stable while distributing fixture agents', () => {
    const variants = Array.from(
      { length: 8 },
      (_, index) => avatarVariantFor(`fixture-${index + 1}`, 4),
    );

    expect(variants).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(avatarVariantFor('fixture-1', 4)).toBe(avatarVariantFor('fixture-1', 4));
  });

  it('allocates a different avatar while an unused identity remains', () => {
    const used = new Set<number>();
    const allocated = Array.from({ length: 12 }, (_, index) => {
      const variant = availableAvatarVariantFor(`agent-${index}`, 13, used);
      used.add(variant);
      return variant;
    });

    expect(new Set(allocated).size).toBe(12);
  });

  it('is stable for an agent and independent from render order', () => {
    const ids = ['unit-alpha', 'unit-bravo', 'unit-charlie'];
    const forward = Object.fromEntries(
      ids.map((id) => [id, placementFor(id, 'ready_unclaimed', 'control-room', phaseSlotIndex(id, 'ready_unclaimed', ids.map((agent_id) => ({ agent_id, task_phase: 'ready_unclaimed' }))))]),
    );
    const reversed = Object.fromEntries(
      [...ids].reverse().map((id) => [id, placementFor(id, 'ready_unclaimed', 'control-room', phaseSlotIndex(id, 'ready_unclaimed', ids.map((agent_id) => ({ agent_id, task_phase: 'ready_unclaimed' }))))]),
    );

    expect(reversed).toEqual(forward);
    expect(new Set(ids.map((id) => JSON.stringify(forward[id].destination))).size).toBe(ids.length);
    for (const placement of Object.values(forward)) {
      expect(placement.destination.x).toBeGreaterThanOrEqual(0);
      expect(placement.destination.x).toBeLessThanOrEqual(100);
      expect(placement.destination.y).toBeGreaterThanOrEqual(0);
      expect(placement.destination.y).toBeLessThanOrEqual(100);
    }
  });

  it('assigns distinct business destinations when an agent phase changes', () => {
    const queued = placementFor('unit-moving', 'todo_not_started', 'control-room');
    const working = placementFor('unit-moving', 'live_run', 'control-room');

    expect(working.destination).not.toEqual(queued.destination);
    expect(queued.zone).toBe('queue-todo');
    expect(working.zone).toBe('console');
  });

  it('places available agents only in the break-room rest zone', () => {
    const resting = placementFor('unit-resting', 'available', 'break-room');

    expect(resting.zone).toBe('rest');
    expect(resting.scene).toBe('break-room');
    expect(resting.destination.x).toBeGreaterThan(WORLD_PLAN.breakRoomStartX);
  });

  it('parks offline agents away from the front entrance', () => {
    const offline = placementFor('unit-offline', 'telemetry_unavailable', 'control-room', 0);

    expect(offline.interaction).toBe('typing-at-desk');
    expect(offline.destination).toEqual(WORKSTATION_SLOTS[0].point);
    expect(offline.destination).not.toEqual({ x: 52, y: 89 });
  });

  it('uses the interaction declared by each dynamic furniture slot', () => {
    expect(placementFor('sofa', 'available', 'break-room', 0).interaction)
      .toBe('reading-in-lounge');
    expect(placementFor('coffee', 'available', 'break-room', 5).interaction)
      .toBe('drinking-coffee');
    expect(placementFor('reader', 'available', 'break-room', 6).interaction)
      .toBe('reading-in-lounge');
    expect(placementFor('dishes', 'available', 'break-room', 7).interaction)
      .toBe('playing-handheld');
    expect(placementFor('reader', 'available', 'break-room', 8).interaction)
      .toBe('drinking-coffee');
    expect(placementFor('board', 'available', 'break-room', 9).interaction)
      .toBe('reading-in-lounge');
    expect(placementFor('overflow', 'available', 'break-room', 10)).toMatchObject({
      scene: 'break-room',
      interaction: 'standing-idle',
      overflow: true,
    });
  });

  it('routes agents through the physical doorway when they change rooms', () => {
    const working = placementFor('unit-crossing', 'live_run', 'control-room');
    const resting = placementFor('unit-crossing', 'available', 'break-room', 0);

    const outbound = routeBetween(working.destination, resting.destination);
    const inbound = routeBetween(resting.destination, working.destination);

    expect(outbound[0]).toEqual(working.destination);
    expect(outbound.at(-1)).toEqual(resting.destination);
    expect(inbound.at(-1)).toEqual(working.destination);
    for (const route of [inbound, outbound]) route.slice(1).forEach((p, i) => expect(safeRouteSegment(route[i], p)).toBe(true));
  });

  it('assigns stable human variations from identity rather than render order', () => {
    const ids = ['unit-alpha', 'unit-bravo', 'unit-charlie', 'unit-delta'];
    const forward = Object.fromEntries(ids.map((id) => [id, appearanceFor(id)]));
    const reversed = Object.fromEntries([...ids].reverse().map((id) => [id, appearanceFor(id)]));

    expect(reversed).toEqual(forward);
    expect(new Set(Object.values(forward).map((appearance) => appearance.shirt)).size).toBeGreaterThan(1);
    expect(new Set(Object.values(forward).map((appearance) => appearance.hairStyle)).size).toBeGreaterThan(1);
  });

  it('assigns unique phase slots independently from backend order', () => {
    const agents = [
      { agent_id: 'zulu', task_phase: 'available' },
      { agent_id: 'alpha', task_phase: 'available' },
      { agent_id: 'bravo', task_phase: 'blocked' },
    ];

    expect(phaseSlotIndex('alpha', 'available', agents)).toBe(0);
    expect(phaseSlotIndex('zulu', 'available', [...agents].reverse())).toBe(1);
    const alpha = placementFor('alpha', 'available', 'break-room', 0);
    const zulu = placementFor('zulu', 'available', 'break-room', 1);
    expect(alpha.destination).not.toEqual(zulu.destination);
  });

  it('does not move existing peers when another agent enters or leaves a work phase', () => {
    const initial = reconcilePhaseSlots({}, [
      { agent_id: 'atlas', task_phase: 'blocked' },
      { agent_id: 'berlin', task_phase: 'blocked' },
    ]);
    const expanded = reconcilePhaseSlots(initial, [
      { agent_id: 'alma', task_phase: 'blocked' },
      { agent_id: 'atlas', task_phase: 'blocked' },
      { agent_id: 'berlin', task_phase: 'blocked' },
    ]);
    const changed = reconcilePhaseSlots(expanded, [
      { agent_id: 'alma', task_phase: 'live_run' },
      { agent_id: 'atlas', task_phase: 'blocked' },
      { agent_id: 'berlin', task_phase: 'blocked' },
    ]);

    expect(expanded.atlas).toEqual(initial.atlas);
    expect(expanded.berlin).toEqual(initial.berlin);
    expect(changed.atlas).toEqual(initial.atlas);
    expect(changed.berlin).toEqual(initial.berlin);
    expect(changed.alma).toEqual({ phase: 'live_run', slotIndex: expanded.alma.slotIndex });
  });

  it('refills real lounge seats before using standing overflow positions', () => {
    const agents = Array.from({ length: 11 }, (_, index) => ({
      agent_id: `agent-${String(index).padStart(2, '0')}`,
      task_phase: 'available',
    }));
    const crowded = reconcilePhaseSlots({}, agents);
    expect(crowded['agent-10'].slotIndex).toBe(10);

    const compacted = reconcilePhaseSlots(crowded, agents.slice(1));

    expect(compacted['agent-10'].slotIndex).toBe(0);
    expect(placementFor('agent-10', 'available', 'break-room', compacted['agent-10'].slotIndex).interaction)
      .toBe('reading-in-lounge');
  });

  it('shares workstation slots between Kanban runs and live Hermes sessions', () => {
    const assignments = reconcilePhaseSlots({}, [
      { agent_id: 'atlas', task_phase: 'live_run' },
      { agent_id: 'dublin', task_phase: 'live_session' },
    ]);
    expect(assignments.atlas.slotIndex).not.toBe(assignments.dublin.slotIndex);

    const transitioned = reconcilePhaseSlots(assignments, [
      { agent_id: 'atlas', task_phase: 'live_session' },
      { agent_id: 'dublin', task_phase: 'live_session' },
    ]);
    expect(transitioned.atlas.slotIndex).toBe(assignments.atlas.slotIndex);
    expect(transitioned.dublin.slotIndex).toBe(assignments.dublin.slotIndex);
  });

  it('keeps three waiting agents at their stations on distinct clickable positions', () => {
    const agents = ['amlabsgrowth', 'default', 'prospectscout'].map((agent_id) => ({
      agent_id,
      task_phase: 'todo_not_started',
    }));
    const destinations = agents.map((agent) => placementFor(
      agent.agent_id,
      agent.task_phase,
      'control-room',
      phaseSlotIndex(agent.agent_id, agent.task_phase, agents),
    ).destination);

    for (let left = 0; left < destinations.length; left += 1) {
      for (let right = left + 1; right < destinations.length; right += 1) {
        expect(Math.hypot((destinations[left].x - destinations[right].x) * 12.8, (destinations[left].y - destinations[right].y) * 7.2)).toBeGreaterThanOrEqual(100);
      }
    }
  });
});
