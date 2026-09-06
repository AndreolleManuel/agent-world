import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';

import {
  ADDED_LOUNGE_SEATS,
  LAB_WORK_SLOTS,
  SHARED_LAB_DESK,
  WORKSTATION_SLOTS,
} from './furniture';
import { WORLD_HEIGHT } from './projection';

export interface DynamicEnvironment {
  deskScreens: Graphics[];
  deskGlows: Graphics[];
  labScreens: Graphics[];
  labGlows: Graphics[];
  deskChairs: Array<{
    node: Container;
    foreground: Container;
    foregroundOffsetY: number;
    workingY: number;
    restingY: number;
    workingZ: number;
    restingZ: number;
  }>;
  labChairs: Array<{
    node: Container;
    foreground: Container;
    foregroundOffsetY: number;
    workingY: number;
    restingY: number;
    workingZ: number;
    restingZ: number;
  }>;
  boardGlow: Graphics;
  coffeeSteam: Container;
  cookingSteam: Container;
  sinkWater: Graphics;
  sinkSparkles: Container;
  coffeeBrew: Graphics;
  cookingPan: Container;
  neonAura: Graphics;
  reactorCore: Graphics;
  aquariumBubbles: Container;
  serverLights: Graphics;
  televisionScreen: Graphics;
  activeDeskIndexes: Set<number>;
  activeLabIndexes: Set<number>;
  televisionActive: boolean;
  reducedMotion: boolean;
}

export interface EnvironmentTextures {
  workstationKit: Texture;
  loungeStool: Texture;
  loungePouf: Texture;
}

const INK = 0x242036;
const WOOD = 0x9b5f3d;
const CYAN = 0x65d9d0;

const WORKSTATION_KIT_FRAMES = {
  desk: { x: 8, y: 145, width: 635, height: 420 },
  // The original atlas groups two screens AND two keyboards. Split it here:
  // retain both displays, then place just one keyboard at the user's centre.
  monitors: { x: 682, y: 180, width: 555, height: 250 },
  keyboard: { x: 740, y: 430, width: 212, height: 100 },
  sharedTop: { x: 8, y: 145, width: 635, height: 200 },
  pedestal: { x: 25, y: 345, width: 150, height: 205 },
  chair: { x: 145, y: 675, width: 385, height: 455 },
  chairFront: { x: 145, y: 805, width: 385, height: 145 },
  frontRail: { x: 680, y: 815, width: 565, height: 180 },
} as const;

function cropTexture(texture: Texture, frame: (typeof WORKSTATION_KIT_FRAMES)[keyof typeof WORKSTATION_KIT_FRAMES]): Texture {
  return new Texture({
    source: texture.source,
    frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
  });
}
function pixelDepth(pixelY: number, offset = 0): number {
  return Math.round((pixelY / WORLD_HEIGHT) * 10_000) + offset;
}

function addGraphic(stage: Container, label: string, zIndex: number, graphic: Graphics): Graphics {
  graphic.label = label;
  graphic.zIndex = zIndex;
  stage.addChild(graphic);
  return graphic;
}

function addContainer(stage: Container, label: string, zIndex: number, container: Container): Container {
  container.label = label;
  container.zIndex = zIndex;
  stage.addChild(container);
  return container;
}

function addSprite(
  stage: Container,
  texture: Texture,
  label: string,
  bounds: { x: number; y: number; width: number; height: number },
  zIndex: number,
): Sprite {
  const sprite = new Sprite(texture);
  sprite.label = label;
  sprite.position.set(bounds.x, bounds.y);
  sprite.width = bounds.width;
  sprite.height = bounds.height;
  sprite.zIndex = zIndex;
  stage.addChild(sprite);
  return sprite;
}

function makeSteam(label: string, x: number, y: number): Container {
  const steam = new Container();
  steam.label = label;
  steam.position.set(x, y);
  steam.zIndex = pixelDepth(y, 450);
  steam.visible = false;
  steam.addChild(
    new Graphics()
      .circle(-7, 2, 3)
      .circle(1, -5, 4)
      .circle(7, -13, 3)
      .fill({ color: 0xfff5df, alpha: 0.78 }),
  );
  return steam;
}

function buildWorkstation(
  stage: Container,
  textures: EnvironmentTextures | undefined,
  index: number,
  x: number,
  y: number,
): {
  screen: Graphics;
  glow: Graphics;
  chair: Container;
  chairForeground: Container;
  chairWorkingY: number;
  chairWorkingZ: number;
  chairRestingZ: number;
} {
  const seatY = y + 55;
  const monitorDepth = pixelDepth(y, 220);
  const chairDepth = pixelDepth(seatY, -260);
  const chairWorkingDepth = pixelDepth(seatY, -80);
  const chairForegroundDepth = pixelDepth(seatY, 120);
  const deskDepth = pixelDepth(y, 100);
  // The seated agent is on the near side of the desk. Keep the front rail
  // behind the body so it cannot visually slice through the torso.
  const railDepth = pixelDepth(seatY, 20);

  let chair: Container;
  let chairForeground: Container;
  if (textures) {
    const kit = textures.workstationKit;
    addSprite(stage, cropTexture(kit, WORKSTATION_KIT_FRAMES.monitors), `premium-desk-${index + 1}-monitors`, {
      x: x - 72,
      y: y - 72,
      width: 144,
      height: 93 * 250 / 360,
    }, monitorDepth);
    addSprite(stage, cropTexture(kit, WORKSTATION_KIT_FRAMES.keyboard), `premium-desk-${index + 1}-keyboard`, {
      x: x - 28, y: y - 7, width: 56, height: 26,
    }, monitorDepth + 1);
    chair = addSprite(stage, cropTexture(kit, WORKSTATION_KIT_FRAMES.chair), `premium-desk-${index + 1}-chair`, {
      x: x - 38,
      y: seatY - 50,
      width: 76,
      height: 90,
    }, chairDepth);
    chairForeground = addSprite(
      stage,
      cropTexture(kit, WORKSTATION_KIT_FRAMES.chairFront),
      `premium-desk-${index + 1}-chair-front`,
      {
        x: x - 38,
        y: seatY - 24,
        width: 76,
        height: 29,
      },
      chairForegroundDepth,
    );
    chairForeground.visible = false;
    addSprite(stage, cropTexture(kit, WORKSTATION_KIT_FRAMES.desk), `premium-desk-${index + 1}-desk`, {
      x: x - 82,
      y: y - 47,
      width: 164,
      height: 108,
    }, deskDepth);
    addSprite(stage, cropTexture(kit, WORKSTATION_KIT_FRAMES.frontRail), `premium-desk-${index + 1}-front`, {
      x: x - 76,
      y: y - 3,
      width: 152,
      height: 48,
    }, railDepth);
  } else {
    chair = addGraphic(
      stage,
      `dynamic-desk-${index + 1}-chair`,
      chairDepth,
      new Graphics().roundRect(x - 25, seatY - 31, 50, 57, 11)
        .fill(0x4c3f76)
        .stroke({ color: INK, width: 3 }),
    );
    chairForeground = addContainer(
      stage,
      `dynamic-desk-${index + 1}-chair-front`,
      chairForegroundDepth,
      new Container(),
    );
    chairForeground.visible = false;
    addGraphic(
      stage,
      `dynamic-desk-${index + 1}-desk`,
      deskDepth,
      new Graphics().rect(x - 78, y - 4, 156, 49)
        .fill(WOOD)
        .stroke({ color: INK, width: 3 }),
    );
  }

  const glow = new Graphics()
    .roundRect(x - 64, y - 57, 58, 35, 3)
    .fill({ color: 0x63e6ff, alpha: 0.2 })
    .roundRect(x + 6, y - 57, 58, 35, 3)
    .fill({ color: 0xc166ff, alpha: 0.18 });
  glow.visible = false;
  addGraphic(stage, `dynamic-desk-${index + 1}-glow`, monitorDepth + 20, glow);

  const screen = new Graphics()
    .rect(x - 55, y - 45, 29, 2)
    .fill(CYAN)
    .rect(x + 25, y - 45, 29, 2)
    .fill(0xc184ff);
  screen.visible = false;
  addGraphic(stage, `dynamic-desk-${index + 1}-screen`, monitorDepth + 30, screen);
  return {
    screen,
    glow,
    chair,
    chairForeground,
    chairWorkingY: chair.position.y,
    chairWorkingZ: chairWorkingDepth,
    chairRestingZ: chairDepth,
  };
}

function buildLabWorkstation(
  stage: Container,
  textures: EnvironmentTextures,
  index: number,
  x: number,
  y: number,
): {
  screen: Graphics;
  glow: Graphics;
  chair: Container;
  chairForeground: Container;
  chairWorkingY: number;
  chairWorkingZ: number;
  chairRestingZ: number;
} {
  const seatY = y + LAB_WORK_SLOTS[index].seatOffsetY;
  const monitorDepth = pixelDepth(y, 220);
  const chairDepth = pixelDepth(seatY, -260);
  const chairWorkingDepth = pixelDepth(seatY, -80);
  const chairForegroundDepth = pixelDepth(seatY, 120);
  const deskDepth = pixelDepth(y, 100);
  // Match the large workstations: the agent sits in front of this rail.
  const railDepth = pixelDepth(seatY, 20);
  const shared = LAB_WORK_SLOTS[index].objectId === SHARED_LAB_DESK.id;
  const kit = textures.workstationKit;

  addSprite(stage, cropTexture(kit, WORKSTATION_KIT_FRAMES.monitors), `premium-lab-desk-${index + 1}-monitors`, {
    x: x - 46,
    y: y - 60,
    width: 92,
    height: 60 * 250 / 360,
  }, monitorDepth);
  addSprite(stage, cropTexture(kit, WORKSTATION_KIT_FRAMES.keyboard), `premium-lab-desk-${index + 1}-keyboard`, {
    x: x - 18, y: y - 18, width: 36, height: 17,
  }, monitorDepth + 1);
  const chair = addSprite(stage, cropTexture(kit, WORKSTATION_KIT_FRAMES.chair), `premium-lab-desk-${index + 1}-chair`, {
    x: x - 26,
    y: seatY - 37,
    width: 52,
    height: 62,
  }, chairDepth);
  const chairForeground = addSprite(
    stage,
    cropTexture(kit, WORKSTATION_KIT_FRAMES.chairFront),
    `premium-lab-desk-${index + 1}-chair-front`,
    {
      x: x - 26,
      y: seatY - 19,
      width: 52,
      height: 20,
    },
    chairForegroundDepth,
  );
  chairForeground.visible = false;
  if (!shared) addSprite(stage, cropTexture(kit, WORKSTATION_KIT_FRAMES.desk), `premium-lab-desk-${index + 1}-desk`, {
    x: x - 53,
    y: y - 31,
    width: 106,
    height: 70,
  }, deskDepth);
  if (!shared) addSprite(stage, cropTexture(kit, WORKSTATION_KIT_FRAMES.frontRail), `premium-lab-desk-${index + 1}-front`, {
    x: x - 50,
    y: y - 2,
    width: 100,
    height: 32,
  }, railDepth);

  const glow = addGraphic(
    stage,
    `dynamic-lab-desk-${index + 1}-glow`,
    monitorDepth + 20,
    new Graphics()
      .roundRect(x - 40, y - 51, 36, 23, 3).fill({ color: CYAN, alpha: 0.2 })
      .roundRect(x + 4, y - 51, 36, 23, 3).fill({ color: 0xc166ff, alpha: 0.18 }),
  );
  glow.visible = false;
  const screen = addGraphic(
    stage,
    `dynamic-lab-desk-${index + 1}-screen`,
    monitorDepth + 30,
    new Graphics()
      .rect(x - 33, y - 42, 21, 2).fill(CYAN)
      .rect(x + 12, y - 42, 21, 2).fill(0xd49aff),
  );
  screen.visible = false;
  return {
    screen,
    glow,
    chair,
    chairForeground,
    chairWorkingY: chair.position.y,
    chairWorkingZ: chairWorkingDepth,
    chairRestingZ: chairDepth,
  };
}

function buildKanbanBoard(stage: Container): Graphics {
  return addGraphic(
    stage,
    'kanban-attention-glow',
    1_020,
    new Graphics().roundRect(622, 52, 210, 134, 5)
      .stroke({ color: 0xd7b7ff, width: 4, alpha: 0.86 }),
  );
}

function buildKitchen(
  stage: Container,
): {
  coffeeSteam: Container;
  cookingSteam: Container;
  sinkWater: Graphics;
  sinkSparkles: Container;
  coffeeBrew: Graphics;
  cookingPan: Container;
} {
  const coffeeBrew = addGraphic(
    stage,
    'coffee-machine-brewing',
    pixelDepth(294, 120),
    new Graphics()
      .roundRect(1_215, 245, 35, 57, 5).fill(0x34263f).stroke({ color: 0xc59b6d, width: 3 })
      .rect(1_223, 258, 19, 16).fill(0x171526)
      .roundRect(1_220, 282, 25, 16, 3).fill(0xf4e2c0).stroke({ color: 0x4b3140, width: 2 }),
  );
  coffeeBrew.visible = false;

  const coffeeSteam = makeSteam('coffee-steam', 1_232, 278);
  const cookingSteam = makeSteam('cooking-steam', 1_166, 274);
  stage.addChild(coffeeSteam, cookingSteam);

  const sinkWater = addGraphic(
    stage,
    'sink-running-water',
    pixelDepth(302, 180),
    new Graphics().rect(1_112, 260, 4, 27).fill({ color: 0x7fe8ff, alpha: 0.9 })
      .rect(1_101, 287, 25, 3).fill({ color: 0xb9f3ff, alpha: 0.75 }),
  );
  sinkWater.visible = false;
  const sinkSparkles = new Container();
  sinkSparkles.position.set(1_114, 287);
  sinkSparkles.visible = false;
  sinkSparkles.addChild(new Graphics()
    .rect(-12, -2, 3, 3).rect(1, -11, 3, 3).rect(12, 1, 3, 3).fill(0xe8fbff));
  addContainer(stage, 'sink-sparkles', pixelDepth(305, 190), sinkSparkles);

  const cookingPan = new Container();
  cookingPan.position.set(1_165, 284);
  cookingPan.visible = false;
  cookingPan.addChild(new Graphics()
    .ellipse(0, 0, 17, 7).fill(0x30283c).stroke({ color: 0xd59a52, width: 2 })
    .rect(14, -2, 24, 4).fill(0x4a3a4d)
    .circle(-5, -1, 3).circle(4, 1, 3).fill(0xf08a4b));
  addContainer(stage, 'kitchen-pan-active', pixelDepth(306, 200), cookingPan);
  return { coffeeSteam, cookingSteam, sinkWater, sinkSparkles, coffeeBrew, cookingPan };
}

function buildRestoredDecorEffects(stage: Container): {
  reactorCore: Graphics;
  aquariumBubbles: Container;
  serverLights: Graphics;
} {
  const reactorCore = addGraphic(
    stage,
    'ambient-reactor-core',
    pixelDepth(350, 120),
    new Graphics()
      .circle(145, 342, 25).fill({ color: 0xae62ff, alpha: 0.18 })
      .circle(145, 342, 8).fill({ color: 0xf1c6ff, alpha: 0.52 }),
  );
  const aquariumBubbles = new Container();
  aquariumBubbles.position.set(558, 160);
  aquariumBubbles.addChild(
    new Graphics().circle(-7, 4, 3).circle(5, -8, 2).circle(11, 9, 2)
      .stroke({ color: 0xb8f3ff, width: 2, alpha: 0.72 }),
  );
  addContainer(stage, 'ambient-aquarium-bubbles', 1_470, aquariumBubbles);
  const serverLights = addGraphic(
    stage,
    'ambient-server-lights',
    1_520,
    new Graphics()
      .rect(78, 81, 4, 4).rect(91, 81, 4, 4)
      .rect(68, 101, 4, 4).rect(102, 119, 4, 4)
      .fill(0x65ffd1),
  );
  return { reactorCore, aquariumBubbles, serverLights };
}

function buildAddedLoungeSeats(stage: Container, textures?: EnvironmentTextures): void {
  if (!textures) return;

  ADDED_LOUNGE_SEATS.forEach(({ id, kind, pixelX: x, pixelY: y }) => {
    if (kind === 'existing-stool') return;
    const backDepth = pixelDepth(y, -110);

    if (kind === 'cushion') {
      addSprite(
        stage,
        textures.loungePouf,
        `pause-${id}-back`,
        { x: x - 44, y: y - 32, width: 88, height: 88 },
        backDepth,
      );
      return;
    }

    addSprite(
      stage,
      textures.loungeStool,
      `pause-${id}-back`,
      { x: x - 44, y: y - 34, width: 88, height: 100 },
      backDepth,
    );
  });
}

export function buildDynamicEnvironment(
  stage: Container,
  textures?: EnvironmentTextures,
): DynamicEnvironment {
  const deskScreens: Graphics[] = [];
  const deskGlows: Graphics[] = [];
  const labScreens: Graphics[] = [];
  const labGlows: Graphics[] = [];
  const deskChairs: DynamicEnvironment['deskChairs'] = [];
  const labChairs: DynamicEnvironment['labChairs'] = [];
  WORKSTATION_SLOTS.forEach((slot, index) => {
    const workstation = buildWorkstation(stage, textures, index, slot.pixelX, slot.pixelY);
    deskScreens.push(workstation.screen);
    deskGlows.push(workstation.glow);
    deskChairs.push({
      node: workstation.chair,
      foreground: workstation.chairForeground,
      foregroundOffsetY: workstation.chairForeground.position.y - workstation.chair.position.y,
      workingY: workstation.chairWorkingY,
      restingY: workstation.chairWorkingY + 12,
      workingZ: workstation.chairWorkingZ,
      restingZ: workstation.chairRestingZ,
    });
    workstation.chair.position.y = workstation.chairWorkingY + 12;
  });
  if (textures) {
    const { left, right, pixelY: y } = SHARED_LAB_DESK;
    // One continuous top and two end cabinets; the three chair/monitor rigs
    // remain independent, at their original scale and with one keyboard each.
    for (const [i, x] of [left + 4, right - 29].entries()) {
      addSprite(stage, cropTexture(textures.workstationKit, WORKSTATION_KIT_FRAMES.pedestal), `shared-lab-pedestal-${i}`,
        { x, y: y + 2, width: 25, height: 37 }, pixelDepth(y, 90));
    }
    addSprite(stage, cropTexture(textures.workstationKit, WORKSTATION_KIT_FRAMES.sharedTop), 'shared-lab-worktop',
      { x: left, y: y - 31, width: right - left, height: 34 }, pixelDepth(y, 100));
    LAB_WORK_SLOTS.forEach((slot, index) => {
      const pullback = slot.objectId === SHARED_LAB_DESK.id ? 4 : 10;
      const workstation = buildLabWorkstation(stage, textures, index, slot.pixelX, slot.pixelY);
      labScreens.push(workstation.screen);
      labGlows.push(workstation.glow);
      labChairs.push({
        node: workstation.chair,
        foreground: workstation.chairForeground,
        foregroundOffsetY: workstation.chairForeground.position.y - workstation.chair.position.y,
        workingY: workstation.chairWorkingY,
        restingY: workstation.chairWorkingY + pullback,
        workingZ: workstation.chairWorkingZ,
        restingZ: workstation.chairRestingZ,
      });
      workstation.chair.position.y = workstation.chairWorkingY + pullback;
    });
  }
  const boardGlow = buildKanbanBoard(stage);
  boardGlow.visible = false;
  const lab = buildRestoredDecorEffects(stage);
  buildAddedLoungeSeats(stage, textures);
  const televisionScreen = new Graphics();
  televisionScreen.visible = false;
  const kitchen = buildKitchen(stage);

  const neonAura = addGraphic(
    stage,
    'ambient-neon-aura',
    1_100,
    new Graphics()
      .ellipse(965, 54, 112, 25).fill({ color: 0x8f32d8, alpha: 0.08 })
      .ellipse(965, 54, 82, 16).fill({ color: 0xc45cff, alpha: 0.13 }),
  );

  return {
    deskScreens,
    deskGlows,
    labScreens,
    labGlows,
    deskChairs,
    labChairs,
    boardGlow,
    ...kitchen,
    neonAura,
    reactorCore: lab.reactorCore,
    aquariumBubbles: lab.aquariumBubbles,
    serverLights: lab.serverLights,
    televisionScreen,
    activeDeskIndexes: new Set<number>(),
    activeLabIndexes: new Set<number>(),
    televisionActive: false,
    reducedMotion: false,
  };
}

export function animateDynamicEnvironment(environment: DynamicEnvironment, now: number): void {
  const pulse = environment.reducedMotion ? 0.5 : (Math.sin(now / 240) + 1) / 2;
  environment.deskGlows.forEach((glow, index) => {
    glow.alpha = 0.45 + (pulse * 0.4);
    const screen = environment.deskScreens[index];
    screen.alpha = 0.72 + (pulse * 0.28);
    screen.position.y = environment.reducedMotion ? 0 : Math.round((pulse - 0.5) * 2);
  });
  environment.labGlows.forEach((glow, index) => {
    glow.alpha = 0.45 + (pulse * 0.4);
    const screen = environment.labScreens[index];
    screen.alpha = 0.72 + (pulse * 0.28);
    screen.position.y = environment.reducedMotion ? 0 : Math.round((pulse - 0.5) * 2);
  });
  environment.deskChairs.forEach(({
    node,
    foreground,
    foregroundOffsetY,
    workingY,
    restingY,
    workingZ,
    restingZ,
  }, index) => {
    const occupied = environment.activeDeskIndexes.has(index);
    foreground.visible = occupied;
    const targetY = occupied ? workingY : restingY;
    node.zIndex = occupied ? workingZ : restingZ;
    if (environment.reducedMotion) {
      node.position.y = targetY;
      foreground.position.y = targetY + foregroundOffsetY;
      return;
    }
    const distance = targetY - node.position.y;
    node.position.y = Math.abs(distance) < 0.35
      ? targetY
      : node.position.y + (distance * 0.24);
    foreground.position.y = node.position.y + foregroundOffsetY;
  });
  environment.labChairs.forEach(({
    node,
    foreground,
    foregroundOffsetY,
    workingY,
    restingY,
    workingZ,
    restingZ,
  }, index) => {
    const occupied = environment.activeLabIndexes.has(index);
    foreground.visible = occupied;
    const targetY = occupied ? workingY : restingY;
    node.zIndex = occupied ? workingZ : restingZ;
    if (environment.reducedMotion) {
      node.position.y = targetY;
      foreground.position.y = targetY + foregroundOffsetY;
      return;
    }
    node.position.y += (targetY - node.position.y) * 0.18;
    foreground.position.y = node.position.y + foregroundOffsetY;
  });
  environment.boardGlow.alpha = 0.5 + (pulse * 0.45);
  environment.coffeeSteam.position.y = 278 - (pulse * 6);
  environment.cookingSteam.position.y = 274 - (pulse * 7);
  environment.sinkWater.alpha = 0.65 + (pulse * 0.35);
  environment.sinkSparkles.rotation = environment.reducedMotion ? 0 : pulse * 0.35;
  environment.coffeeBrew.alpha = 0.78 + (pulse * 0.22);
  environment.cookingPan.rotation = environment.reducedMotion ? 0 : (pulse - 0.5) * 0.08;
  environment.neonAura.alpha = 0.45 + (pulse * 0.5);
  environment.reactorCore.alpha = 0.48 + (pulse * 0.5);
  environment.aquariumBubbles.position.y = 160 - (pulse * 12);
  environment.serverLights.alpha = pulse > 0.48 ? 1 : 0.25;

  environment.televisionScreen.visible = environment.televisionActive;
  environment.televisionScreen.alpha = 0.8 + (pulse * 0.2);
}
