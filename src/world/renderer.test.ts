import { WORKSTATION_SLOTS, LAB_WORK_SLOTS } from './furniture';
import { navigate, movementDuration } from './navigation';
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const pixi = vi.hoisted(() => {
  class FakePoint {
    x = 0;
    y = 0;

    set(x: number, y: number): void {
      this.x = x;
      this.y = y;
    }
  }

  class FakeContainer {
    alpha = 1;
    anchor = new FakePoint();
    children: FakeContainer[] = [];
    cursor = '';
    eventMode = '';
    hitArea: unknown;
    label = '';
    position = new FakePoint();
    rotation = 0;
    scale = { x: 1 };
    sortableChildren = false;
    style: Record<string, unknown> = {};
    text = '';
    visible = true;
    zIndex = 0;
    private readonly handlers = new Map<string, () => void>();

    addChild(...children: FakeContainer[]): FakeContainer {
      this.children.push(...children);
      return children[0];
    }

    removeChild(child: FakeContainer): void {
      this.children = this.children.filter((candidate) => candidate !== child);
    }

    on(event: string, handler: () => void): this {
      this.handlers.set(event, handler);
      return this;
    }

    emit(event: string): void {
      this.handlers.get(event)?.();
    }

    destroy(): void {
      this.children = [];
    }
  }

  class FakeGraphics extends FakeContainer {
    clear(): this { return this; }
    circle(): this { return this; }
    ellipse(): this { return this; }
    fill(): this { return this; }
    lineTo(): this { return this; }
    moveTo(): this { return this; }
    poly(): this { return this; }
    rect(): this { return this; }
    roundRect(): this { return this; }
    stroke(): this { return this; }
  }

  class FakeText extends FakeContainer {
    constructor(options: { text: string; style: Record<string, unknown> }) {
      super();
      this.text = options.text;
      this.style = options.style;
    }
  }

  class FakeSprite extends FakeContainer {
    height = 0;
    texture: unknown;
    width = 0;

    constructor(texture?: unknown) {
      super();
      this.texture = texture;
    }
  }

  class FakeRectangle {
    constructor(
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) {}
  }

  class FakeTexture {
    source: unknown;
    frame: unknown;

    constructor(options: { source?: unknown; frame?: unknown } = {}) {
      this.source = options.source ?? 'am-labs-world';
      this.frame = options.frame;
    }
  }

  class FakeAssets {
    static init = vi.fn(async () => {});
    static load = vi.fn(async () => ({ source: 'am-labs-world' }));
  }

  class FakeTicker {
    callback: (() => void) | null = null;
    started = false;

    add(callback: () => void): void {
      this.callback = callback;
    }

    start(): void { this.started = true; }

    stop(): void { this.started = false; }

    remove(callback: () => void): void {
      if (this.callback === callback) this.callback = null;
    }

    update(): void {
      this.callback?.();
    }
  }

  class FakeApplication {
    static instances: FakeApplication[] = [];
    static initCalls: Array<Record<string, unknown>> = [];
    static rejectedPreferences = new Set<string>();
    destroyed = false;
    stage = new FakeContainer();
    ticker = new FakeTicker();

    constructor() {
      FakeApplication.instances.push(this);
    }

    async init(options: Record<string, unknown>): Promise<void> {
      FakeApplication.initCalls.push(options);
      const preference = Array.isArray(options.preference)
        ? options.preference[0]
        : options.preference;
      if (typeof preference === 'string' && FakeApplication.rejectedPreferences.has(preference)) {
        throw new Error(`Renderer ${preference} failed with a sensitive native detail`);
      }
    }

    render(): void {}

    destroy(): void {
      this.destroyed = true;
    }
  }

  return {
    FakeApplication,
    FakeAssets,
    FakeContainer,
    FakeGraphics,
    FakeRectangle,
    FakeSprite,
    FakeText,
    FakeTexture,
  };
});

vi.mock('pixi.js', () => ({
  Application: pixi.FakeApplication,
  Assets: pixi.FakeAssets,
  Container: pixi.FakeContainer,
  Graphics: pixi.FakeGraphics,
  Rectangle: pixi.FakeRectangle,
  Sprite: pixi.FakeSprite,
  Text: pixi.FakeText,
  Texture: pixi.FakeTexture,
}));

import type { AgentHeartbeatDto } from '../heartbeat';
import { projectWorldPoint } from './projection';
import {
  AGENT_SEATING_DURATION_MS,
  PixiWorldRenderer,
} from './renderer';

function fixture(id: string): AgentHeartbeatDto {
  return {
    agent_id: id,
    display_name: `Operator ${id}`,
    observed_state: 'connected',
    task_phase: 'live_run',
  } as AgentHeartbeatDto;
}

function agentNode(id: string): InstanceType<typeof pixi.FakeContainer> {
  const node = pixi.FakeApplication.instances.at(-1)?.stage.children
    .find(({ label }) => label === `agent:${id}`);
  if (!node) throw new Error(`Missing Pixi node for ${id}`);
  return node;
}

function descendants(node: InstanceType<typeof pixi.FakeContainer>): InstanceType<typeof pixi.FakeContainer>[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

afterEach(() => {
  pixi.FakeApplication.instances = [];
  pixi.FakeApplication.initCalls = [];
  pixi.FakeApplication.rejectedPreferences = new Set();
  pixi.FakeAssets.load.mockClear();
});

describe('PixiWorldRenderer', () => {
  it('starts with the Canvas compatibility renderer backend', async () => {
    const canvas = document.createElement('canvas');
    const renderer = new PixiWorldRenderer(canvas, vi.fn());

    await renderer.start();

    expect(pixi.FakeApplication.initCalls).toHaveLength(1);
    expect(pixi.FakeApplication.initCalls[0]).toMatchObject({
      canvas,
      preference: ['canvas'],
      width: 1280,
      height: 720,
    });
    expect(pixi.FakeAssets.load).toHaveBeenCalledTimes(9);
    expect(pixi.FakeApplication.instances.at(-1)?.stage.children)
      .toContainEqual(expect.objectContaining({ label: 'am-labs-world-background' }));
  });

  it('builds workstation layers over the restored static decor without runtime masks', async () => {
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), vi.fn());

    await renderer.start();

    const labels = pixi.FakeApplication.instances.at(-1)?.stage.children
      .map(({ label }) => label) ?? [];
    expect(labels).toContain('premium-desk-1-monitors');
    expect(labels.filter((label) => label === 'shared-lab-worktop')).toHaveLength(1);
    expect(labels.filter((label) => label.startsWith('shared-lab-pedestal-'))).toHaveLength(2);
    expect(labels).not.toContain('premium-lab-desk-1-desk');
    expect(labels).not.toContain('premium-lab-desk-2-desk');
    expect(labels).not.toContain('premium-lab-desk-3-desk');
    expect(labels.filter((label) => /^premium-(lab-)?desk-\d+-keyboard$/.test(label))).toHaveLength(8);
    const monitorSprite = pixi.FakeApplication.instances.at(-1)?.stage.children.find(({ label }) => label === 'premium-desk-1-monitors') as InstanceType<typeof pixi.FakeSprite>;
    expect(monitorSprite.texture).toMatchObject({ frame: { height: 250 } }); // No keyboard baked into this crop.
    expect(labels).toContain('premium-desk-1-chair');
    expect(labels).toContain('premium-desk-1-desk');
    expect(labels).toContain('premium-desk-1-front');
    expect(labels).toContain('premium-desk-2-chair');
    expect(labels).toContain('premium-desk-3-front');
    expect(labels).toContain('premium-desk-4-monitors');
    expect(labels).not.toContain('premium-desk-5-monitors');
    expect(labels).toContain('premium-lab-desk-4-desk');
    expect(labels).toContain('premium-lab-desk-4-front');
    expect(labels).toContain('pause-door-stool-left-back');
    expect(labels).toContain('pause-door-stool-right-back');
    expect(labels).toContain('pause-rug-cushion-left-back');
    expect(labels).toContain('pause-rug-cushion-right-back');
    expect(labels.some((label) => label.startsWith('pause-') && label.endsWith('-front'))).toBe(false);
    expect(labels).not.toContain('layered-sofa-front-plane');
    expect(labels).not.toContain('layered-armchair-front-plane');
    expect(labels).not.toContain('layered-pouf-front-plane');
    expect(labels).not.toContain('premium-lounge-sofa-back');
    expect(labels).not.toContain('premium-kitchen-counter-back');
    expect(labels.some((label) => label.endsWith('-mask'))).toBe(false);
  });

  it('falls back to WebGL when Canvas initialization fails', async () => {
    pixi.FakeApplication.rejectedPreferences.add('canvas');
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), vi.fn());

    await renderer.start();

    expect(pixi.FakeApplication.initCalls.map(({ preference }) => preference)).toEqual([
      ['canvas'],
      ['webgl'],
    ]);
    expect(pixi.FakeApplication.instances).toHaveLength(2);
    expect(pixi.FakeApplication.instances[0].destroyed).toBe(true);
    expect(pixi.FakeApplication.instances[1].destroyed).toBe(false);
  });

  it('rejects with an expurgated error when every renderer backend fails', async () => {
    pixi.FakeApplication.rejectedPreferences = new Set(['canvas', 'webgl']);
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), vi.fn());

    await expect(renderer.start()).rejects.toThrow('Unable to initialize the Pixi renderer.');
    expect(pixi.FakeApplication.instances).toHaveLength(2);
    expect(pixi.FakeApplication.instances.every(({ destroyed }) => destroyed)).toBe(true);
  });

  it('replays the Pixi ticker with injected time and reaches the exact destination', async () => {
    let now = 1_000;
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), vi.fn(), () => now);
    renderer.sync({
      reducedMotion: false,
      agents: [{
        agent: fixture('alpha'),
        interaction: 'reading-at-bookshelf',
        selected: false,
        motion: { origin: { x: 52, y: 89 }, destination: { x: 72, y: 68 }, moving: true },
      }],
    });
    await renderer.start();

    const node = agentNode('alpha');
    expect(descendants(node)
      .find(({ label }) => label === 'agent-activity-prop')?.visible).toBe(false);
    const destination = projectWorldPoint({ x: 72, y: 68 });
    expect({ x: node.position.x, y: node.position.y }).not.toEqual(destination);

    now += movementDuration(navigate({ x: 52, y: 89 }, { x: 72, y: 68 }));
    pixi.FakeApplication.instances.at(-1)?.ticker.update();

    expect({ x: node.position.x, y: node.position.y }).toEqual({
      x: Math.round(destination.x),
      y: Math.round(destination.y),
    });
  });

  it('finishes the walk to a retained desk when work ends before arrival', async () => {
    let now = 1000;
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), vi.fn(), () => now);
    const arrived = vi.fn(); renderer.setMotionListener(arrived);
    const model = { agent: fixture('short-task'), interaction: 'typing-at-desk' as const, selected: false,
      motion: { origin: { x: 52, y: 89 }, destination: WORKSTATION_SLOTS[0].point, moving: true } };
    renderer.sync({ reducedMotion: false, agents: [model] }); await renderer.start();
    now += 400; pixi.FakeApplication.instances.at(-1)?.ticker.update();
    const node = agentNode('short-task');
    const before = { x: node.position.x, y: node.position.y };
    renderer.sync({ reducedMotion: false, agents: [{ ...model,
      agent: { ...model.agent, task_phase: 'available' },
      motion: { ...model.motion, origin: model.motion.destination, moving: false, placementPhase: 'live_run' },
    }] });
    expect({ x: node.position.x, y: node.position.y }).toEqual(before);
    now += movementDuration(navigate(model.motion.origin, model.motion.destination));
    pixi.FakeApplication.instances.at(-1)?.ticker.update();
    const target = projectWorldPoint(model.motion.destination);
    expect(node.position).toMatchObject({ x: Math.round(target.x), y: Math.round(target.y) });
    expect(arrived).toHaveBeenCalledWith('short-task', model.motion.destination, false);
    renderer.destroy();
  });

  it('queues simultaneous transfers and starts the next only after arrival', async () => {
    let now = 1000;
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), vi.fn(), () => now);
    const arrived = vi.fn(); renderer.setMotionListener(arrived);
    const a = { agent: fixture('queue-a'), selected: false, motion: { origin: { x: 52, y: 89 }, destination: { x: 52, y: 69 }, moving: true } };
    const b = { agent: fixture('queue-b'), selected: false, motion: { origin: { x: 57, y: 89 }, destination: { x: 57, y: 69 }, moving: true } };
    renderer.sync({ reducedMotion: false, agents: [a, b] }); await renderer.start();
    const bOrigin = { ...agentNode('queue-b').position };
    now += 500; pixi.FakeApplication.instances.at(-1)?.ticker.update();
    expect({ ...agentNode('queue-b').position }).toEqual(bOrigin);
    now += 10000; pixi.FakeApplication.instances.at(-1)?.ticker.update();
    expect(arrived).toHaveBeenCalledWith('queue-a', a.motion.destination, false);
    now += 1; pixi.FakeApplication.instances.at(-1)?.ticker.update();
    now += 10000; pixi.FakeApplication.instances.at(-1)?.ticker.update();
    expect(arrived).toHaveBeenCalledWith('queue-b', b.motion.destination, false);
    renderer.destroy();
  });

  it.each([false, true])('admits arrivals sharing the doorway across refreshes (returning from overflow: %s)', async (wasHidden) => {
    let now = 1000;
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), vi.fn(), () => now);
    const arrived = vi.fn(); renderer.setMotionListener(arrived);
    await renderer.start();
    const models = WORKSTATION_SLOTS.slice(0, 3).map((slot, i) => ({
      agent: fixture(`arrival-${i}`), selected: false, interaction: slot.interaction,
      motion: { origin: { x: 52, y: 89 }, destination: slot.point, moving: true },
    }));
    renderer.sync({ reducedMotion: false, agents: wasHidden ? models.map((m) => ({ ...m, hidden: true })) : [] });
    renderer.sync({ reducedMotion: false, agents: models });
    expect(models.filter((m) => agentNode(m.agent.agent_id).visible)).toHaveLength(1);
    // Polling reports the assigned destination before the renderer has arrived.
    renderer.sync({ reducedMotion: false, agents: models.map((m) => ({ ...m,
      motion: { ...m.motion, origin: m.motion.destination, moving: false },
    })) });
    expect(models.filter((m) => agentNode(m.agent.agent_id).visible)).toHaveLength(1);
    for (const model of models) {
      now += 1; pixi.FakeApplication.instances.at(-1)?.ticker.update();
      now += 10000; pixi.FakeApplication.instances.at(-1)?.ticker.update();
      expect(arrived).toHaveBeenCalledWith(model.agent.agent_id, model.motion.destination, false);
    }
    expect(arrived.mock.calls.some(([, , blocked]) => blocked)).toBe(false);
    expect(models.every((m) => agentNode(m.agent.agent_id).visible)).toBe(true);
    renderer.destroy();
  });

  it('keeps arrivals outside an occupied entrance and admits them after its occupant leaves', async () => {
    let now = 1000;
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), vi.fn(), () => now);
    const arrived = vi.fn(); renderer.setMotionListener(arrived);
    const entrance = { x: 52, y: 89 };
    const resident = { agent: fixture('resident'), selected: false,
      motion: { origin: entrance, destination: entrance, moving: false } };
    renderer.sync({ reducedMotion: false, agents: [resident] }); await renderer.start();
    const newcomer = { agent: fixture('newcomer'), selected: false,
      motion: { origin: entrance, destination: WORKSTATION_SLOTS[1].point, moving: true } };
    renderer.sync({ reducedMotion: false, agents: [resident, newcomer] });
    expect(agentNode('newcomer').visible).toBe(false);
    renderer.sync({ reducedMotion: false, agents: [{ ...resident,
      motion: { ...resident.motion, destination: WORKSTATION_SLOTS[0].point, moving: true },
    }, newcomer] });
    for (let i = 0; i < 4; i++) {
      now += 10000; pixi.FakeApplication.instances.at(-1)?.ticker.update();
    }
    expect(arrived).toHaveBeenCalledWith('resident', WORKSTATION_SLOTS[0].point, false);
    expect(arrived).toHaveBeenLastCalledWith('newcomer', newcomer.motion.destination, false);
    expect(agentNode('newcomer').visible).toBe(true);
    renderer.destroy();
  });
  it('finishes an ongoing transfer when reduced motion is enabled', async () => {
    let now = 1000;
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), vi.fn(), () => now);
    const model = { agent: fixture('reduce-during-walk'), selected: false, motion: { origin: { x: 52, y: 89 }, destination: { x: 52, y: 69 }, moving: true } };
    renderer.sync({ reducedMotion: false, agents: [model] }); await renderer.start();
    now += 100; pixi.FakeApplication.instances.at(-1)?.ticker.update();
    renderer.sync({ reducedMotion: true, agents: [model] });
    const target = projectWorldPoint(model.motion.destination);
    expect(agentNode('reduce-during-walk').position).toMatchObject({ x: Math.round(target.x), y: Math.round(target.y) });
    renderer.destroy();
  });

  it('renders the brand as thin tube graphics without bold text', async () => {
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), vi.fn());
    await renderer.start();
    const sign = descendants(pixi.FakeApplication.instances.at(-1)!.stage).find((n) => n.label === 'amlabs-dev-neon')!;
    expect(sign.position).toMatchObject({ x: 965, y: 54 });
    expect(sign.children.map((n) => n.label)).toEqual(['neon-wall-glow', 'neon-tube-glow', 'neon-tube-core']);
    expect(sign.children.some((n) => n instanceof pixi.FakeText)).toBe(false);
    renderer.destroy();
  });

  it('owns arrival, preserves current position during refresh and exposes only the real sprite', async () => {
    let now = 1000;
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), vi.fn(), () => now);
    const arrived = vi.fn(); renderer.setMotionListener(arrived);
    const model = { agent: fixture('desk-worker'), interaction: 'typing-at-desk' as const, selected: false,
      motion: { origin: { x: 52, y: 89 }, destination: WORKSTATION_SLOTS[0].point, moving: true } };
    renderer.sync({ reducedMotion: false, agents: [model] }); await renderer.start();
    now += 400; pixi.FakeApplication.instances.at(-1)?.ticker.update();
    const node = agentNode('desk-worker'), current = { x: node.position.x, y: node.position.y };
    renderer.sync({ reducedMotion: false, agents: [{ ...model, selected: true }] });
    expect({ x: node.position.x, y: node.position.y }).toEqual(current);
    now += movementDuration(navigate(model.motion.origin, model.motion.destination));
    pixi.FakeApplication.instances.at(-1)?.ticker.update();
    expect(arrived).toHaveBeenCalledWith('desk-worker', model.motion.destination, false);
    now += AGENT_SEATING_DURATION_MS; pixi.FakeApplication.instances.at(-1)?.ticker.update();
    expect(descendants(node).some(({ label }) => label === 'agent-actor')).toBe(false);
    expect(descendants(node).find(({ label }) => label === 'agent-premium-pose')?.visible).toBe(true);
    renderer.destroy();
  });

  it('animates only the upper desk body with contiguous pixels and stationary feet', async () => {
    let now = 0;
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), vi.fn(), () => now);
    await renderer.start();
    const model = { agent: fixture('breathing'), interaction: 'typing-at-desk' as const, selected: false,
      motion: { origin: WORKSTATION_SLOTS[0].point, destination: WORKSTATION_SLOTS[0].point, moving: false } };
    renderer.sync({ reducedMotion: false, agents: [model] });
    const sprites = descendants(agentNode('breathing'));
    const sprite = (label: string) => sprites.find((child) => child.label === label) as InstanceType<typeof pixi.FakeSprite>;
    const full = sprite('agent-premium-pose'), upper = sprite('agent-desk-upper-pose'), lower = sprite('agent-desk-lower-pose');
    const frame = (s: typeof full) => (s.texture as { frame: { y: number; height: number } }).frame;
    const fullHeight = full.height, feet = full.position.y + full.height / 2;
    const heights = new Set<number>();
    for (now = 2000; now < 6000; now += 100) {
      pixi.FakeApplication.instances.at(-1)?.ticker.update();
      expect(full.visible).toBe(false);
      expect(upper.visible && lower.visible).toBe(true);
      expect(frame(upper).y + frame(upper).height).toBe(frame(lower).y);
      expect(frame(upper).height + frame(lower).height).toBe(frame(full).height);
      expect(upper.anchor.y).toBe(1);
      expect(upper.position.y).toBe(lower.position.y);
      expect(lower.position.y + lower.height).toBeCloseTo(feet);
      expect(upper.height + lower.height).toBeGreaterThanOrEqual(fullHeight);
      expect(upper.height + lower.height).toBeLessThanOrEqual(fullHeight + 1);
      heights.add(upper.height);
    }
    expect(heights.size).toBeGreaterThan(2);
    renderer.sync({ reducedMotion: true, agents: [model] });
    pixi.FakeApplication.instances.at(-1)?.ticker.update();
    expect(full.visible).toBe(true);
    expect(upper.visible || lower.visible).toBe(false);
    expect(full.position.y + full.height / 2).toBe(feet);
    renderer.sync({ reducedMotion: false, agents: [{ ...model, agent: { ...model.agent, task_phase: 'telemetry_unavailable' } }] });
    now += 500; pixi.FakeApplication.instances.at(-1)?.ticker.update();
    expect(full.visible).toBe(true);
    expect(upper.visible || lower.visible).toBe(false);
    renderer.destroy();
  });

  it('selects the agent through the Pixi pointertap handler', async () => {
    const onSelect = vi.fn();
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), onSelect);
    await renderer.start();
    renderer.sync({
      reducedMotion: false,
      agents: [{
        agent: fixture('bravo'),
        selected: false,
        motion: { origin: { x: 10, y: 20 }, destination: { x: 20, y: 30 }, moving: false },
      }],
    });

    agentNode('bravo').emit('pointertap');

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('bravo');
  });

  it('freezes on stale data and while hidden without jumping on resume', async () => {
    let now = 0;
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), vi.fn(), () => now);
    const model = { agent: fixture('freeze'), selected: false, motion: { origin: { x: 52, y: 89 }, destination: { x: 72.5, y: 49.5 }, moving: true } };
    renderer.sync({ reducedMotion: false, agents: [model] }); await renderer.start();
    now = 300; pixi.FakeApplication.instances.at(-1)?.ticker.update();
    const node = agentNode('freeze'), before = { x: node.position.x, y: node.position.y };
    renderer.sync({ reducedMotion: false, paused: true, agents: [model] });
    now += 20000; pixi.FakeApplication.instances.at(-1)?.ticker.update();
    expect({ x: node.position.x, y: node.position.y }).toEqual(before);
    expect(pixi.FakeApplication.instances.at(-1)?.ticker.started).toBe(false);
    renderer.sync({ reducedMotion: false, paused: false, agents: [model] });
    pixi.FakeApplication.instances.at(-1)?.ticker.update();
    expect({ x: node.position.x, y: node.position.y }).toEqual(before);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(pixi.FakeApplication.instances.at(-1)?.ticker.started).toBe(false);
    hidden.mockRestore(); renderer.destroy();
  });

  it('uses the authored sprites with independent back and front furniture layers', async () => {
    let now = 0;
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), vi.fn(), () => now);
    await renderer.start();
    renderer.sync({
      reducedMotion: false,
      agents: [
        {
          agent: { ...fixture('sofa'), task_phase: 'available' },
          interaction: 'sitting-on-sofa',
          selected: false,
          motion: { origin: { x: 81, y: 62 }, destination: { x: 81, y: 62 }, moving: false },
        },
        {
          agent: fixture('worker'),
          interaction: 'typing-at-desk',
          selected: false,
          motion: { origin: WORKSTATION_SLOTS[0].point, destination: WORKSTATION_SLOTS[0].point, moving: false },
        },
        {
          agent: fixture('lab-worker'),
          interaction: 'researching-at-lab',
          selected: false,
          motion: { origin: LAB_WORK_SLOTS[0].point, destination: LAB_WORK_SLOTS[0].point, moving: false },
        },
      ],
    });

    const stage = pixi.FakeApplication.instances.at(-1)?.stage;
    const labels = (stage ? descendants(stage) : []).map(({ label }) => label);
    expect(labels).not.toContain('left-arm-upper');
    expect(labels).not.toContain('left-arm-forearm');
    expect(labels).not.toContain('right-arm-lower');
    expect(labels).not.toContain('lounge-tv-pixels');
    expect(labels.some((label) => label.endsWith('-foreground'))).toBe(false);
    const aquarium = (stage ? descendants(stage) : [])
      .find(({ label }) => label === 'ambient-aquarium-bubbles');
    expect(labels).not.toContain('desk-monitor-code-1-scrolling-code');
    expect(labels).toContain('premium-desk-1-monitors');
    expect(labels).toContain('dynamic-desk-1-screen');
    expect(labels).not.toContain('left-leg');
    expect(labels).not.toContain('right-leg');
    const sofaAgent = agentNode('sofa');
    const sofaPose = descendants(sofaAgent)
      .find(({ label }) => label === 'agent-premium-pose') as InstanceType<typeof pixi.FakeSprite>;
    expect(sofaPose.position.y).toBe(-21);
    const northDesk = stage?.children.find(({ label }) => label === 'premium-desk-1-monitors');
    const deskFront = stage?.children
      .find(({ label }) => label === 'premium-desk-1-front');
    const chair = stage?.children
      .find(({ label }) => label === 'premium-desk-1-chair');
    const chairFront = stage?.children
      .find(({ label }) => label === 'premium-desk-1-chair-front');
    const worker = agentNode('worker');
    expect(northDesk?.zIndex).toBeLessThan(worker.zIndex);
    expect(chair?.zIndex).toBeLessThan(worker.zIndex);
    expect(chairFront?.zIndex).toBeGreaterThan(worker.zIndex);
    expect(chairFront?.visible).toBe(true);
    expect(deskFront?.zIndex).toBeLessThan(worker.zIndex);
    const workerUpperPose = descendants(worker)
      .find(({ label }) => label === 'agent-desk-upper-pose') as InstanceType<typeof pixi.FakeSprite>;
    const workerLowerPose = descendants(worker)
      .find(({ label }) => label === 'agent-desk-lower-pose') as InstanceType<typeof pixi.FakeSprite>;
    expect(workerUpperPose.visible).toBe(false);
    expect(workerLowerPose.visible).toBe(false);
    const labMonitor = stage?.children.find(({ label }) => label === 'premium-lab-desk-1-monitors');
    const labChair = stage?.children.find(({ label }) => label === 'premium-lab-desk-1-chair');
    const labChairFront = stage?.children.find(({ label }) => label === 'premium-lab-desk-1-chair-front');
    const labFront = stage?.children.find(({ label }) => label === 'shared-lab-worktop');
    const labWorker = agentNode('lab-worker');
    expect(labMonitor?.zIndex).toBeLessThan(labWorker.zIndex);
    expect(labChair?.zIndex).toBeLessThan(labWorker.zIndex);
    expect(labChairFront?.zIndex).toBeGreaterThan(labWorker.zIndex);
    expect(labChairFront?.visible).toBe(true);
    expect(labFront?.zIndex).toBeLessThan(labWorker.zIndex);
    expect(descendants(worker).find(({ label }) => label === 'agent-actor')).toBeUndefined();
    expect(descendants(worker).find(({ label }) => label === 'agent-premium-pose')?.visible).toBe(true);
    pixi.FakeApplication.instances.at(-1)?.ticker.update();
    const firstBubbleY = aquarium?.position.y;
    now = 240;
    pixi.FakeApplication.instances.at(-1)?.ticker.update();
    expect(aquarium?.position.y).not.toBe(firstBubbleY);
  });

  it('keeps reduced-motion agents at their final destination without activity cartouches', async () => {
    let now = 4_000;
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), vi.fn(), () => now);
    await renderer.start();
    renderer.sync({
      reducedMotion: true,
      agents: [{
        agent: fixture('charlie'),
        selected: true,
        motion: { origin: { x: 52, y: 89 }, destination: { x: 85, y: 75 }, moving: true },
      }],
    });

    const node = agentNode('charlie');
    const expected = projectWorldPoint({ x: 85, y: 75 });
    expect({ x: node.position.x, y: node.position.y }).toEqual({
      x: Math.round(expected.x),
      y: Math.round(expected.y),
    });
    const labels = descendants(node)
      .filter((child) => child instanceof pixi.FakeText)
      .map(({ text }) => text);
    const hud = pixi.FakeApplication.instances.at(-1)?.stage.children
      .find(({ label }) => label === 'agent-hud:charlie');
    labels.push(...(hud ? descendants(hud) : [])
      .filter((child) => child instanceof pixi.FakeText)
      .map(({ text }) => text));
    expect(labels).toContain('Operator c…');
    expect(labels).not.toContain('TRAVAILLE');
    expect(labels).not.toContain('AU BUREAU');

    now += 10000;
    pixi.FakeApplication.instances.at(-1)?.ticker.update();
    expect({ x: node.position.x, y: node.position.y }).toEqual({
      x: Math.round(expected.x),
      y: Math.round(expected.y),
    });
  });
  it('keeps a resting-only room animated, preserves chatter across polls and clears it when paused', async () => {
    let now = 0;
    const renderer = new PixiWorldRenderer(document.createElement('canvas'), vi.fn(), () => now);
    await renderer.start();
    const model = { agent: { ...fixture('daydream'), task_phase: 'available' }, selected: false,
      interaction: 'sitting-on-sofa' as const,
      motion: { origin: { x: 80, y: 60 }, destination: { x: 80, y: 60 }, moving: false } };
    const snapshot = { reducedMotion: false, agents: [model] };
    renderer.sync(snapshot);
    const app = pixi.FakeApplication.instances.at(-1)!;
    expect(app.ticker.started).toBe(true);
    now = 1600; app.ticker.update();
    const chatter = app.stage.children.find(({ label }) => label === 'agent-chatter:daydream')!;
    expect(chatter.visible).toBe(true);
    const text = descendants(chatter).map((child) => child.text).join('');
    now = 2400; renderer.sync(snapshot);
    expect(chatter.visible).toBe(true);
    expect(descendants(chatter).map((child) => child.text).join('')).toBe(text);
    renderer.sync({ ...snapshot, paused: true });
    expect(chatter.visible).toBe(false);
    expect(app.ticker.started).toBe(false);
    renderer.sync({ ...snapshot, reducedMotion: true });
    expect(chatter.visible).toBe(false);
    expect(app.ticker.started).toBe(false);
    renderer.sync({ ...snapshot, agents: [{ ...model, agent: { ...model.agent, task_phase: 'telemetry_unavailable' } }] });
    now += 1000; app.ticker.update();
    expect(chatter.visible).toBe(false);
    expect(app.ticker.started).toBe(false);
    renderer.destroy();
  });

});
