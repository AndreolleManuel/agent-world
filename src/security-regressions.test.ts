import { describe, expect, it } from 'vitest';
import { reconcilePhaseSlots, placementFor, reconcileDeskPresence } from './world/placement';
import { slotsForPhase } from './world/furniture';
import { reconcileAvatars } from './preferences';

describe('untrusted identifiers', () => {
  it('assigns own, distinct positions to prototype-shaped profile IDs', () => {
    const agents = ['constructor', '__proto__', 'toString', 'default'].map((agent_id) => ({ agent_id, task_phase: 'available' }));
    const next = reconcilePhaseSlots({}, agents);
    expect(new Set(agents.map((a) => next[a.agent_id].slotIndex)).size).toBe(4);
    for (const { agent_id } of agents) expect(Object.hasOwn(next, agent_id)).toBe(true);
    expect(reconcilePhaseSlots(next, agents)).toEqual(next);
    expect(reconcileDeskPresence({}, agents, 100)).toEqual({});
  });

  it('does not mistake prototype properties for valid phases', () => {
    for (const phase of ['constructor', '__proto__', 'toString']) {
      expect(slotsForPhase(phase)).toBeUndefined();
      expect(() => placementFor('fixture', phase, 'control-room', 0)).not.toThrow();
    }
  });

  it('prunes departed avatars while preserving current selections at the limit', () => {
    const old = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`agent-${i}`, 4]));
    const ids = [...Object.keys(old).slice(1), 'constructor'];
    const next = reconcileAvatars(ids, old);
    expect(Object.keys(next)).toHaveLength(256);
    expect(Object.hasOwn(next, 'agent-0')).toBe(false);
    expect(next['agent-1']).toBe(4);
    expect(typeof next.constructor).toBe('number');
  });
});
