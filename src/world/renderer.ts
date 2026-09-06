import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';

import type { AgentHeartbeatDto, KanbanSnapshotDto, KanbanTaskDto } from '../heartbeat';
import {
  animateDynamicEnvironment,
  buildDynamicEnvironment,
  type DynamicEnvironment,
  type EnvironmentTextures,
} from './environment';
import { labWorkstationIndexFor, workstationIndexFor } from './furniture';
import {
  availableAvatarVariantFor,
  routeBetween,
} from './placement';
import type { AgentInteraction, SpritePoint } from './placement';
import {
  depthFor,
  interpolateRoute,
  projectWorldPoint,
  walkPose,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './projection';
import { persistentAvatar } from '../preferences';
import { movementDuration, navigate } from './navigation';
import { buildNeonSign } from './neon';
import { initializePixiAssets } from './pixiRuntime';

export const AGENT_SEATING_DURATION_MS = 650;
const RENDERER_PREFERENCES = ['canvas', 'webgl'] as const;
const WORLD_BACKGROUND_URL = new URL(
  '../assets/am-labs-restored-static-v1.png',
  import.meta.url,
).href;
const ENVIRONMENT_TEXTURE_URLS = {
  workstationKit: new URL('../assets/am-labs-workstation-kit-16bit-v1.png', import.meta.url).href,
  humanPoses: new URL('../assets/am-labs-human-poses-16bit-v1.png', import.meta.url).href,
  humanVariants: new URL('../assets/am-labs-human-variants-16bit-v1.png', import.meta.url).href,
  humanVariantsV2: new URL('../assets/am-labs-human-variants-16bit-v2.png', import.meta.url).href,
  humanVariantsV3: new URL('../assets/am-labs-human-variants-16bit-v3.png', import.meta.url).href,
  humanRearSeated: new URL('../assets/am-labs-human-rear-seated-16bit-v1.png', import.meta.url).href,
  loungeStool: new URL('../assets/am-labs-lounge-stool-16bit-v1.png', import.meta.url).href,
  loungePouf: new URL('../assets/am-labs-lounge-pouf-16bit-v1.png', import.meta.url).href,
} as const;
const PREMIUM_POSE_FRAMES = {
  standingFront: [{ x: 20, y: 0, width: 205, height: 250 }],
  standingBack: [{ x: 715, y: 0, width: 205, height: 250 }],
  walkingFront: [
    { x: 20, y: 245, width: 205, height: 270 },
    { x: 220, y: 245, width: 205, height: 270 },
    { x: 420, y: 245, width: 205, height: 270 },
  ],
  walkingBack: [
    { x: 20, y: 500, width: 205, height: 270 },
    { x: 220, y: 500, width: 205, height: 270 },
    { x: 420, y: 500, width: 205, height: 270 },
    { x: 620, y: 500, width: 205, height: 270 },
  ],
  typing: [
    { x: 310, y: 760, width: 190, height: 250 },
    { x: 515, y: 760, width: 190, height: 250 },
    { x: 715, y: 760, width: 190, height: 250 },
  ],
  seatedFront: [
    { x: 285, y: 990, width: 210, height: 264 },
    { x: 490, y: 990, width: 210, height: 264 },
    { x: 695, y: 990, width: 210, height: 264 },
  ],
} as const;

type PremiumPoseName = keyof typeof PREMIUM_POSE_FRAMES;
type PremiumPoseTextures = Record<PremiumPoseName, Texture[]> & {
  typingLayout: { width: number; height: number; pelvisY: number };
  typingUpper: Texture[];
  typingLower: Texture[];
};

const VARIANT_ATLAS_CELL_SIZE = 256;
const VARIANT_FRAME_X_INSET = 32;
const VARIANT_FRAME_WIDTH = 192;
const VARIANT_COUNT = 4;

const REAR_SEATED_FRAMES: readonly RectSpec[] = [
  { x: 100, y: 30, width: 176, height: 272 },
  { x: 532, y: 30, width: 176, height: 272 },
  { x: 952, y: 30, width: 192, height: 272 },
  { x: 88, y: 344, width: 192, height: 272 },
  { x: 524, y: 344, width: 192, height: 272 },
  { x: 952, y: 332, width: 192, height: 288 },
  { x: 96, y: 640, width: 176, height: 312 },
  { x: 532, y: 640, width: 176, height: 312 },
  { x: 954, y: 640, width: 176, height: 312 },
  { x: 84, y: 942, width: 192, height: 256 },
  { x: 526, y: 944, width: 176, height: 256 },
  { x: 952, y: 944, width: 176, height: 256 },
];

function variantFrame(row: number, column: number): RectSpec {
  return {
    x: (column * VARIANT_ATLAS_CELL_SIZE) + VARIANT_FRAME_X_INSET,
    y: row * VARIANT_ATLAS_CELL_SIZE,
    width: VARIANT_FRAME_WIDTH,
    height: VARIANT_ATLAS_CELL_SIZE,
  };
}

function splitTypingFrames(frames: Texture[]): Pick<PremiumPoseTextures, 'typingUpper' | 'typingLower'> {
  return {
    typingUpper: frames.map((texture) => {
      const frame = texture.frame;
      return new Texture({
        source: texture.source,
        frame: new Rectangle(frame.x, frame.y, frame.width, Math.round(frame.height * 0.58)),
      });
    }),
    typingLower: frames.map((texture) => {
      const frame = texture.frame;
      // Both pieces must cover the complete original frame, with no missing
      // strip. Furniture depth is handled by layers, never by amputating pixels.
      const top = Math.round(frame.height * 0.58);
      return new Texture({
        source: texture.source,
        frame: new Rectangle(frame.x, frame.y + top, frame.width, frame.height - top),
      });
    }),
  };
}

function buildVariantPoseSet(
  texture: Texture,
  row: number,
  humanRearSeated: Texture,
  rearSeatedFrame: RectSpec,
): PremiumPoseTextures {
  const typing = cropPoseFrames(humanRearSeated, [rearSeatedFrame]);
  return {
    standingFront: cropPoseFrames(texture, [variantFrame(row, 0)]),
    typingLayout: { width: 40, height: 88, pelvisY: -42 },
    standingBack: cropPoseFrames(texture, [variantFrame(row, 1)]),
    walkingFront: cropPoseFrames(texture, [variantFrame(row, 2)]),
    walkingBack: cropPoseFrames(texture, [variantFrame(row, 1)]),
    typing,
    seatedFront: cropPoseFrames(texture, [variantFrame(row, 4)]),
    ...splitTypingFrames(typing),
  };
}

export interface AgentMotion {
  origin: SpritePoint;
  destination: SpritePoint;
  moving: boolean;
  slotIndex?: number;
}

export interface PixiAgentModel {
  hidden?: boolean;
  agent: AgentHeartbeatDto;
  motion: AgentMotion;
  selected: boolean;
  interaction?: AgentInteraction;
}

export interface PixiSceneSnapshot {
  agents: PixiAgentModel[];
  kanban?: KanbanSnapshotDto;
  reducedMotion: boolean;
  paused?: boolean;
}

export interface WorldRenderer {
  start(): Promise<void>;
  sync(snapshot: PixiSceneSnapshot): void;
  destroy(): void;
  setMotionListener?(listener: (id: string, destination: SpritePoint, blocked: boolean) => void): void;
}

interface AgentNode {
  queued: boolean;
  routeBlocked: boolean;
  agentId: string;
  model: PixiAgentModel | null;
  currentPoint: SpritePoint;
  duration: number;
  animationOffset: number;
  container: Container;
  hud: Container;
  premiumPose: Sprite;
  deskUpperPose: Sprite;
  deskLowerPose: Sprite;
  premiumPoses: PremiumPoseTextures;
  activityProp: Graphics;
  activityPropOrigin: { x: number; y: number };
  status: Graphics;
  selection: Graphics;
  namePlate: Graphics;
  nameLabel: Text;
  symbolBubble: Graphics;
  symbolLabel: Text;
  route: SpritePoint[];
  startedAt: number;
  destination: SpritePoint;
  reducedMotion: boolean;
  phase: string;
  interaction: AgentInteraction;
  visualKey: string;
  moving: boolean;
  settlingStartedAt: number | null;
}



interface WorldTextures extends EnvironmentTextures {
  background: Texture;
  humanPoses: Texture;
  humanVariants: Texture;
  humanVariantsV2: Texture;
  humanVariantsV3: Texture;
  humanRearSeated: Texture;
}

interface RectSpec {
  x: number;
  y: number;
  width: number;
  height: number;
}

function cropPoseFrames(texture: Texture, frames: readonly RectSpec[]): Texture[] {
  return frames.map((frame) => new Texture({
    source: texture.source,
    frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
  }));
}



const COLORS = {
  ink: 0x242036,
  cream: 0xfff7df,
  selection: 0xffdf69,
  namePlate: 0x2b2440,
  shadow: 0x211c31,
};

const STATUS_COLORS: Record<string, number> = {
  connected: 0x55d88f,
  disconnected: 0xffa350,
  unavailable: 0xef6f80,
};

const PHASE_STYLES: Record<string, { label: string; color: number; symbol?: string }> = {
  live_run: { label: 'RUN CONFIRMÉ', color: 0x287f6e },
  live_session: { label: 'SESSION ACTIVE', color: 0x318ca8 },
  review_pending: { label: 'RÉFLÉCHIT', color: 0x6f5cc2, symbol: '…' },
  blocked: { label: 'BLOQUÉ', color: 0xd84f62, symbol: '?' },
  ready_unclaimed: { label: 'CARTE PRÊTE', color: 0xd88635 },
  todo_not_started: { label: 'CARTE TODO', color: 0xb68135 },
  available: { label: 'EN PAUSE', color: 0x4a8faa },
  telemetry_unavailable: { label: 'HORS LIGNE', color: 0x6f6b7c, symbol: '!' },
};

const SEATED_INTERACTIONS = new Set<AgentInteraction>([
  'typing-at-desk',
  'researching-at-lab',
  'sitting-on-sofa',
  'sitting-in-armchair',
  'sitting-on-pouf',
  'reading-in-lounge',
  'playing-handheld',
  'drinking-coffee',
]);
const LOUNGE_SEATED_INTERACTIONS = new Set<AgentInteraction>([
  'sitting-on-sofa',
  'sitting-in-armchair',
  'sitting-on-pouf',
  'reading-in-lounge',
  'playing-handheld',
  'drinking-coffee',
]);
const LOUNGE_SEATED_SPRITE_Y = -21;
const CONTINUOUS_INTERACTIONS = new Set<AgentInteraction>([
  'typing-at-desk',
  'researching-at-lab',
  'reading-in-lounge',
  'playing-handheld',
  'drinking-coffee',
  'reading-at-bookshelf',
  'checking-whiteboard',
  'watering-plants',
  'checking-phone',
  'thinking-at-board',
  'blocked-at-board',
  'having-coffee',
  'cooking-at-counter',
  'washing-dishes',
]);

function hasContinuousActivity(node: AgentNode): boolean {
  return CONTINUOUS_INTERACTIONS.has(node.interaction)
    && (node.phase === 'available' || node.phase === 'live_run' || node.phase === 'live_session');
}



function phaseStyle(phase: string): { label: string; color: number; symbol?: string } {
  return PHASE_STYLES[phase] ?? PHASE_STYLES.available;
}

function shortName(agent: AgentHeartbeatDto): string {
  const value = agent.display_name.trim() || agent.agent_id;
  return value.length > 12 ? `${value.slice(0, 10)}…` : value;
}

function buildWorld(stage: Container, textures: WorldTextures): {
  kanbanLayer: Container;
  environmentFx: DynamicEnvironment;
} {
  stage.sortableChildren = true;

  const background = new Sprite(textures.background);
  background.label = 'am-labs-world-background';
  background.width = WORLD_WIDTH;
  background.height = WORLD_HEIGHT;
  background.zIndex = 0;
  stage.addChild(background);

  // Two narrow remnants in the restored background used to be hidden by a
  // desk. Reuse neighbouring floor pixels for this small exposed strip only;
  // no change to the original bitmap or any furniture/character texture.
  const floorRepair = new Sprite(new Texture({
    source: textures.background.source,
    frame: new Rectangle(596, 433, 24, 63),
  }));
  floorRepair.label = 'central-floor-repair';
  floorRepair.position.set(480, 331);
  floorRepair.width = 24 * WORLD_WIDTH / 1672;
  floorRepair.height = 63 * WORLD_HEIGHT / 941;
  floorRepair.zIndex = 1;
  stage.addChild(floorRepair);

  const environmentFx = buildDynamicEnvironment(stage, textures);

  stage.addChild(buildNeonSign());

  const kanbanLayer = new Container();
  kanbanLayer.label = 'live-kanban';
  kanbanLayer.zIndex = 1_010;
  stage.addChild(kanbanLayer);
  return { kanbanLayer, environmentFx };
}

const KANBAN_COLUMNS = [
  { label: 'À FAIRE', statuses: ['todo', 'ready'], color: 0xe0a54b },
  { label: 'RUN', statuses: ['running'], color: 0x48bca3 },
  { label: 'REVUE', statuses: ['review'], color: 0x8876d2 },
  { label: 'BLOQ.', statuses: ['blocked', 'triage'], color: 0xd75b72 },
] as const;

function drawKanban(
  layer: Container,
  snapshot: KanbanSnapshotDto,
  agents: readonly PixiAgentModel[],
): void {
  for (const child of [...layer.children]) {
    layer.removeChild(child);
    child.destroy({ children: true });
  }
  const board = new Graphics()
    .roundRect(646, 59, 181, 111, 3)
    .fill(0xf4eedc)
    .stroke({ color: 0x332d42, width: 3 });
  layer.addChild(board);

  const title = makeText(snapshot.tasks.length === 0 ? 'AUCUNE TÂCHE ACTIVE' : 'KANBAN RÉEL', 7, COLORS.ink);
  title.position.set(736, 66);
  layer.addChild(title);

  const names = new Map(agents.map(({ agent }) => [agent.profile, shortName(agent)]));
  const columnWidth = 43;
  KANBAN_COLUMNS.forEach((column, columnIndex) => {
    const x = 649 + (columnIndex * columnWidth);
    const header = new Graphics().rect(x, 72, 40, 11).fill(column.color);
    const headerLabel = makeText(column.label, 5, 0xffffff);
    headerLabel.position.set(x + 20, 77.5);
    layer.addChild(header, headerLabel);

    const tasks = snapshot.tasks.filter((task) =>
      (column.statuses as readonly string[]).includes(task.status));
    tasks.slice(0, 4).forEach((task: KanbanTaskDto, row) => {
      const y = 86 + (row * 19);
      const card = new Graphics()
        .roundRect(x + 1, y, 38, 16, 2)
        .fill({ color: column.color, alpha: 0.22 })
        .stroke({ color: column.color, width: 1 });
      const assignee = task.assignee ? (names.get(task.assignee) ?? task.assignee) : 'Libre';
      const cardLabel = makeText(assignee.slice(0, 8), 5, COLORS.ink);
      cardLabel.position.set(x + 20, y + 5);
      const boardLabel = makeText(task.board_slug.slice(0, 8), 4, 0x625b6e);
      boardLabel.position.set(x + 20, y + 11);
      layer.addChild(card, cardLabel, boardLabel);
    });
    if (tasks.length > 4) {
      const overflow = makeText(`+${tasks.length - 4}`, 5, COLORS.ink);
      overflow.position.set(x + 34, 166);
      layer.addChild(overflow);
    }
  });

  if (snapshot.partial) {
    const partial = makeText('LECTURE PARTIELLE', 4, 0x8f4353);
    partial.position.set(736, 166);
    layer.addChild(partial);
  }
}

function configurePremiumPose(
  node: AgentNode,
  interaction: AgentInteraction,
  moving: boolean,
): void {
  let poseName: PremiumPoseName = 'standingFront';
  let width = 66;
  let height = 88;
  let y = -35;

  if (moving) {
    poseName = 'walkingFront';
    width = 70;
    height = 94;
    y = -37;
  } else if (interaction === 'typing-at-desk' || interaction === 'researching-at-lab') {
    configureTypingPose(node, 0);
    return;
  } else if (SEATED_INTERACTIONS.has(interaction) || interaction === 'reading-in-lounge') {
    poseName = 'seatedFront';
    width = 70;
    height = 92;
    y = LOUNGE_SEATED_INTERACTIONS.has(interaction) ? LOUNGE_SEATED_SPRITE_Y : -28;
  } else if (
    interaction === 'inspecting-lab'
    || interaction === 'reading-kanban'
    || interaction === 'thinking-at-board'
    || interaction === 'checking-whiteboard'
    || interaction === 'cooking-at-counter'
    || interaction === 'washing-dishes'
  ) {
    poseName = 'standingBack';
  }

  const frames = node.premiumPoses[poseName];
  if (frames[0]) node.premiumPose.texture = frames[0];
  node.premiumPose.visible = true;
  node.deskUpperPose.visible = false;
  node.deskLowerPose.visible = false;
  node.premiumPose.width = width;
  node.premiumPose.height = height;
  node.premiumPose.position.set(0, y);
}

function configureTypingPose(node: AgentNode, frameIndex: number, breath?: number): void {
  const full = node.premiumPoses.typing[frameIndex] ?? node.premiumPoses.typing[0];
  if (!full) return;

  const layout = node.premiumPoses.typingLayout;

  node.premiumPose.visible = true;
  node.deskUpperPose.visible = false;
  node.deskLowerPose.visible = false;
  node.premiumPose.texture = full;
  node.premiumPose.width = layout.width;
  node.premiumPose.height = layout.height;
  node.premiumPose.position.set(0, layout.pelvisY);
  if (breath === undefined) return;

  const upper = node.premiumPoses.typingUpper[frameIndex] ?? node.premiumPoses.typingUpper[0];
  const lower = node.premiumPoses.typingLower[frameIndex] ?? node.premiumPoses.typingLower[0];
  if (!upper || !lower) return;
  const upperHeight = layout.height * upper.frame.height / full.frame.height;
  const seam = layout.pelvisY - layout.height / 2 + upperHeight;
  node.premiumPose.visible = false;
  node.deskUpperPose.visible = true;
  node.deskLowerPose.visible = true;
  node.deskUpperPose.texture = upper;
  node.deskLowerPose.texture = lower;
  node.deskUpperPose.width = node.deskLowerPose.width = layout.width;
  // One-pixel breathing/working motion, anchored at the seam. The pelvis,
  // lower body and feet never bob, rotate or slide over the chair.
  node.deskUpperPose.height = upperHeight + Math.max(0, Math.min(1, breath));
  node.deskLowerPose.height = layout.height - upperHeight;
  node.deskUpperPose.position.set(0, seam);
  node.deskLowerPose.position.set(0, seam);
}

function drawActivityProp(node: AgentNode, interaction: AgentInteraction): void {
  const prop = node.activityProp;
  prop.clear();
  prop.position.set(0, 0);
  prop.rotation = 0;
  prop.alpha = 1;

  switch (interaction) {
    case 'reading-in-lounge':
      prop
        .roundRect(-15, -5, 30, 17, 2)
        .fill(0x653e68)
        .stroke({ color: COLORS.ink, width: 2 })
        .roundRect(-11, -3, 22, 12, 1)
        .fill(0xf1dfb9)
        .rect(-7, 0, 14, 1)
        .rect(-7, 4, 11, 1)
        .fill(0xb28d72);
      prop.position.set(0, -12);
      break;
    case 'reading-at-bookshelf':
      prop
        .roundRect(-8, -28, 16, 24, 2)
        .fill(0x653e68)
        .stroke({ color: COLORS.ink, width: 2 })
        .rect(-5, -23, 10, 7)
        .fill(0xd6b56f)
        .rect(-5, -12, 9, 2)
        .fill(0xf1dfb9);
      prop.position.set(11, 0);
      break;
    case 'checking-whiteboard':
      break;
    case 'watering-plants':
      prop
        .roundRect(-10, -15, 20, 15, 4)
        .fill(0x65a899)
        .stroke({ color: COLORS.ink, width: 2 })
        .moveTo(9, -11).lineTo(20, -18).lineTo(23, -15)
        .stroke({ color: 0x65a899, width: 5 })
        .circle(-10, -8, 6)
        .stroke({ color: 0xb7e2d7, width: 3 });
      prop.position.set(12, -9);
      break;
    case 'checking-phone':
      prop
        .roundRect(-6, -20, 12, 20, 3)
        .fill(0x302744)
        .stroke({ color: 0x9d86bc, width: 2 })
        .rect(-3, -16, 6, 10)
        .fill(0x65d9d0);
      prop.position.set(10, -8);
      break;
    case 'playing-handheld':
      prop
        .roundRect(-11, -6, 22, 17, 3)
        .fill(0x665b8f)
        .stroke({ color: COLORS.ink, width: 2 })
        .rect(-6, -2, 12, 7)
        .fill(0x78d7c8)
        .circle(6, 7, 2)
        .fill(0xf2b94b)
        .rect(-7, 6, 5, 2)
        .rect(-5.5, 4.5, 2, 5)
        .fill(0xe9e0f3);
      prop.position.set(0, -12);
      break;
    case 'drinking-coffee':
      prop
        .roundRect(-5, -7, 11, 13, 3)
        .fill(0xf6ead3)
        .stroke({ color: COLORS.ink, width: 2 })
        .circle(8, -1, 4)
        .stroke({ color: 0xf6ead3, width: 3 });
      prop.position.set(14, -16);
      break;
    case 'having-coffee':
      prop
        .roundRect(-5, -7, 11, 13, 3)
        .fill(0xf6ead3)
        .stroke({ color: COLORS.ink, width: 2 })
        .circle(8, -1, 4)
        .stroke({ color: 0xf6ead3, width: 3 });
      prop.position.set(17, -27);
      break;
    case 'researching-at-lab':
    case 'cooking-at-counter':
    case 'washing-dishes':
      break;
    default:
      break;
  }
  node.activityPropOrigin = { x: prop.position.x, y: prop.position.y };
}

function drawCharacter(node: AgentNode, model: PixiAgentModel): void {
  const { agent } = model;
  const interaction = model.interaction ?? 'standing-idle';
  const poseInteraction = model.motion.moving ? 'standing-idle' : interaction;
  const style = phaseStyle(agent.task_phase);
  configurePremiumPose(node, poseInteraction, model.motion.moving);
  drawActivityProp(node, poseInteraction);

  node.status
    .clear()
    .circle(19, -35, 7)
    .fill(STATUS_COLORS[agent.observed_state] ?? STATUS_COLORS.unavailable)
    .stroke({ color: COLORS.cream, width: 3 });

  node.selection.clear();
  if (model.selected) {
    node.selection
      .roundRect(-26, -67, 52, 86, 8)
      .stroke({ color: COLORS.selection, width: 4 });
  }

  node.namePlate
    .clear()
    .roundRect(-37, -70, 74, 15, 3)
    .fill({ color: COLORS.namePlate, alpha: 0.94 })
    .stroke({ color: style.color, width: 2 });
  node.nameLabel.text = shortName(agent);

  node.symbolBubble.clear();
  node.symbolLabel.text = style.symbol ?? '';
  node.symbolBubble.visible = Boolean(style.symbol);
  node.symbolLabel.visible = Boolean(style.symbol);
  if (style.symbol) {
    node.symbolBubble
      .roundRect(17, -61, 25, 25, 7)
      .fill(COLORS.cream)
      .stroke({ color: style.color, width: 3 })
      .poly([21, -37, 25, -30, 30, -37])
      .fill(COLORS.cream)
      .stroke({ color: style.color, width: 2 });
  }

  node.phase = agent.task_phase;
  node.interaction = interaction;
  node.destination = model.motion.destination;
}

function makeText(text: string, fontSize: number, color: number): Text {
  const label = new Text({
    text,
    style: {
      fill: color,
      fontFamily: 'Menlo, Monaco, monospace',
      fontSize,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
  });
  label.anchor.set(0.5, 0.5);
  return label;
}

function createAgentNode(
  agentId: string,
  onSelect: (agentId: string) => void,
  premiumPoses: PremiumPoseTextures,
): AgentNode {
  const container = new Container();
  container.label = `agent:${agentId}`;
  const hud = new Container();
  hud.label = `agent-hud:${agentId}`;
  const premiumPose = new Sprite(premiumPoses.standingFront[0]);
  premiumPose.label = 'agent-premium-pose';
  premiumPose.anchor.set(0.5, 0.5);
  premiumPose.position.set(0, -35);
  premiumPose.width = 66;
  premiumPose.height = 88;
  const deskUpperPose = new Sprite(premiumPoses.typingUpper[0]);
  deskUpperPose.label = 'agent-desk-upper-pose';
  deskUpperPose.anchor.set(0.5, 1);
  deskUpperPose.visible = false;
  const deskLowerPose = new Sprite(premiumPoses.typingLower[0]);
  deskLowerPose.label = 'agent-desk-lower-pose';
  deskLowerPose.anchor.set(0.5, 0);
  deskLowerPose.visible = false;
  const activityProp = new Graphics();
  activityProp.label = 'agent-activity-prop';
  const selection = new Graphics();
  const status = new Graphics();
  const namePlate = new Graphics();
  const nameLabel = makeText('', 7, 0xffffff);
  const symbolBubble = new Graphics();
  const symbolLabel = makeText('', 18, COLORS.ink);

  nameLabel.position.set(0, -62.5);
  symbolLabel.position.set(29, -49);
  hud.addChild(
    namePlate,
    nameLabel,
    symbolBubble,
    symbolLabel,
  );
  container.addChild(premiumPose, deskUpperPose, deskLowerPose, activityProp, selection, status);
  container.eventMode = 'static';
  container.cursor = 'pointer';
  container.hitArea = {
    contains: (x: number, y: number) => x >= -40 && x <= 40 && y >= -74 && y <= 34,
  };
  container.on('pointertap', () => onSelect(agentId));

  return {
    container,
    animationOffset: [...agentId].reduce((sum, letter) => sum + letter.charCodeAt(0) * 71, 0),
    hud,
    premiumPose,
    deskUpperPose,
    deskLowerPose,
    premiumPoses,
    activityProp,
    activityPropOrigin: { x: 0, y: 0 },
    status,
    selection,
    namePlate,
    nameLabel,
    symbolBubble,
    symbolLabel,
    route: [],
    startedAt: 0,
    destination: { x: 0, y: 0 },
    reducedMotion: false,
    phase: 'available',
    interaction: 'standing-idle',
    visualKey: '',
    moving: false,
    settlingStartedAt: null,
    agentId,
    routeBlocked: false,
    queued: false,
    model: null,
    currentPoint: { x: 0, y: 0 },
    duration: 0,
  };
}

export class PixiWorldRenderer implements WorldRenderer {
  private app: Application | null = null;
  private readonly nodes = new Map<string, AgentNode>();
  private started = false;
  private disposed = false;
  private pendingSnapshot: PixiSceneSnapshot | null = null;
  private kanbanLayer: Container | null = null;
  private environmentFx: DynamicEnvironment | null = null;
  private premiumPoseSets: PremiumPoseTextures[] = [];
  private readonly avatarAssignments = new Map<string, number>();
  private kanbanKey = '';
  private suspendedAt: number | null = null;
  private trafficNeedsPlanning = true;
  private motionListener: (id: string, destination: SpritePoint, blocked: boolean) => void = () => {};
  setMotionListener(listener: typeof this.motionListener): void { this.motionListener = listener; }
  private readonly visibilityChanged = (): void => {
    if (document.hidden || this.pendingSnapshot?.paused) {
      this.suspendedAt ??= this.now(); this.app?.ticker.stop();
    } else if (this.suspendedAt !== null) {
      const now = this.now();
      for (const node of this.nodes.values()) {
        node.startedAt += now - Math.max(this.suspendedAt, node.startedAt);
        if (node.settlingStartedAt !== null) node.settlingStartedAt += now - Math.max(this.suspendedAt, node.settlingStartedAt);
      }
      this.suspendedAt = null;
      if (this.pendingSnapshot) this.applySnapshot(this.pendingSnapshot);
    }
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onSelect: (agentId: string) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async start(): Promise<void> {
    if (this.started || this.disposed) return;

    let app: Application | null = null;
    for (const preference of RENDERER_PREFERENCES) {
      const candidate = new Application();
      try {
        await candidate.init({
          canvas: this.canvas,
          width: WORLD_WIDTH,
          height: WORLD_HEIGHT,
          antialias: false,
          autoStart: false,
          autoDensity: true,
          backgroundColor: COLORS.ink,
          preference: [preference],
          resolution: 1,
        });
        app = candidate;
        break;
      } catch {
        try {
          candidate.destroy({ removeView: false }, { children: true });
        } catch {
          // Pixi may reject before assigning a renderer.
        }
        if (this.disposed) return;
      }
    }

    if (!app) throw new Error('Unable to initialize the Pixi renderer.');

    if (this.disposed) {
      app.destroy({ removeView: false }, { children: true });
      return;
    }

    let textures: WorldTextures;
    try {
      await initializePixiAssets();
      const [
        background,
        workstationKit,
        humanPoses,
        humanVariants,
        humanVariantsV2,
        humanVariantsV3,
        humanRearSeated,
        loungeStool,
        loungePouf,
      ] = await Promise.all([
        Assets.load<Texture>(WORLD_BACKGROUND_URL),
        Assets.load<Texture>(ENVIRONMENT_TEXTURE_URLS.workstationKit),
        Assets.load<Texture>(ENVIRONMENT_TEXTURE_URLS.humanPoses),
        Assets.load<Texture>(ENVIRONMENT_TEXTURE_URLS.humanVariants),
        Assets.load<Texture>(ENVIRONMENT_TEXTURE_URLS.humanVariantsV2),
        Assets.load<Texture>(ENVIRONMENT_TEXTURE_URLS.humanVariantsV3),
        Assets.load<Texture>(ENVIRONMENT_TEXTURE_URLS.humanRearSeated),
        Assets.load<Texture>(ENVIRONMENT_TEXTURE_URLS.loungeStool),
        Assets.load<Texture>(ENVIRONMENT_TEXTURE_URLS.loungePouf),
      ]);
      textures = {
        background,
        workstationKit,
        humanPoses,
        humanVariants,
        humanVariantsV2,
        humanVariantsV3,
        humanRearSeated,
        loungeStool,
        loungePouf,
      };
      const originalTyping = cropPoseFrames(humanPoses, PREMIUM_POSE_FRAMES.typing);
      const originalPoseSet: PremiumPoseTextures = {
        typingLayout: { width: 70, height: 92, pelvisY: -42 },
        standingFront: cropPoseFrames(humanPoses, PREMIUM_POSE_FRAMES.standingFront),
        standingBack: cropPoseFrames(humanPoses, PREMIUM_POSE_FRAMES.standingBack),
        walkingFront: cropPoseFrames(humanPoses, PREMIUM_POSE_FRAMES.walkingFront),
        walkingBack: cropPoseFrames(humanPoses, PREMIUM_POSE_FRAMES.walkingBack),
        typing: originalTyping,
        seatedFront: cropPoseFrames(humanPoses, PREMIUM_POSE_FRAMES.seatedFront),
        ...splitTypingFrames(originalTyping),
      };
      this.premiumPoseSets = [
        originalPoseSet,
        ...Array.from(
          { length: VARIANT_COUNT },
          (_, row) => buildVariantPoseSet(humanVariants, row, humanRearSeated, REAR_SEATED_FRAMES[row * 3]),
        ),
        ...Array.from(
          { length: VARIANT_COUNT },
          (_, row) => buildVariantPoseSet(humanVariantsV2, row, humanRearSeated, REAR_SEATED_FRAMES[(row * 3) + 1]),
        ),
        ...Array.from(
          { length: VARIANT_COUNT },
          (_, row) => buildVariantPoseSet(humanVariantsV3, row, humanRearSeated, REAR_SEATED_FRAMES[(row * 3) + 2]),
        ),
      ];
    } catch {
      app.destroy({ removeView: false }, { children: true });
      throw new Error('Unable to load the AM Labs world.');
    }

    if (this.disposed) {
      app.destroy({ removeView: false }, { children: true });
      return;
    }

    this.app = app;
    const world = buildWorld(app.stage, textures);
    this.kanbanLayer = world.kanbanLayer;
    this.environmentFx = world.environmentFx;
    app.ticker.maxFPS = 24;
    app.ticker.add(this.tick);
    this.started = true;
    document.addEventListener('visibilitychange', this.visibilityChanged);
    if (this.pendingSnapshot) this.applySnapshot(this.pendingSnapshot);
  }

  sync(snapshot: PixiSceneSnapshot): void {
    this.pendingSnapshot = snapshot;
    if (this.started && !this.disposed) { this.visibilityChanged(); this.applySnapshot(snapshot); }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    if (this.started && this.app) {
      this.app.ticker.remove(this.tick);
      this.app.destroy({ removeView: false }, { children: true });
    }
    this.app = null;
    this.nodes.clear();
    this.avatarAssignments.clear();
    this.kanbanLayer = null;
    this.environmentFx = null;
    this.premiumPoseSets = [];
  }

  private applySnapshot(snapshot: PixiSceneSnapshot): void {
    snapshot = { ...snapshot, agents: snapshot.agents.filter((agent) => !agent.hidden) };
    const app = this.app;
    const premiumPoseSets = this.premiumPoseSets;
    if (!app || premiumPoseSets.length === 0) return;
    const kanban = snapshot.kanban ?? { tasks: [], partial: false };
    const kanbanKey = JSON.stringify([kanban, snapshot.agents.map(({ agent }) => [agent.profile, agent.display_name])]);
    if (this.kanbanLayer && kanbanKey !== this.kanbanKey) {
      drawKanban(
        this.kanbanLayer,
        kanban,
        snapshot.agents,
      );
      this.kanbanKey = kanbanKey;
    }
    const liveIds = new Set(snapshot.agents.map(({ agent }) => agent.agent_id));
    this.trafficNeedsPlanning = true;
    for (const [agentId, node] of this.nodes) {
      if (!liveIds.has(agentId)) {
        app.stage.removeChild(node.container, node.hud);
        node.container.destroy({ children: true });
        node.hud.destroy({ children: true });
        this.nodes.delete(agentId);
        this.avatarAssignments.delete(agentId);
      }
    }

    for (const model of snapshot.agents) {
      const { agent, motion } = model;
      let node = this.nodes.get(agent.agent_id);
      if (!node) {
        const usedVariants = new Set(this.avatarAssignments.values());
        const avatarIndex = persistentAvatar(agent.agent_id, availableAvatarVariantFor(
          agent.agent_id,
          premiumPoseSets.length,
          usedVariants,
        ));
        this.avatarAssignments.set(agent.agent_id, avatarIndex);
        const poseSet = premiumPoseSets[avatarIndex];
        node = createAgentNode(agent.agent_id, this.onSelect, poseSet);
        this.nodes.set(agent.agent_id, node);
        app.stage.addChild(node.container, node.hud);
        node.currentPoint = motion.moving ? motion.origin : motion.destination;
      }

      const destinationChanged = node.model === null || node.destination.x !== motion.destination.x || node.destination.y !== motion.destination.y;
      node.model = model;
      node.reducedMotion = snapshot.reducedMotion;
      if (destinationChanged) {
        node.destination = motion.destination;
        node.route = routeBetween(node.currentPoint, motion.destination);
        node.duration = movementDuration(node.route);
        node.startedAt = this.now(); node.settlingStartedAt = null;
        node.queued = node.route.length >= 2;
        node.moving = false;
        const unreachable = node.route.length < 2 && (node.currentPoint.x !== motion.destination.x || node.currentPoint.y !== motion.destination.y);
        node.routeBlocked = unreachable;
        if (unreachable) this.motionListener(agent.agent_id, motion.destination, true);
      }
      if (snapshot.reducedMotion && (node.queued || node.moving)) {
        node.queued = false;
        node.currentPoint = motion.destination; node.route = [motion.destination]; node.moving = false;
        this.motionListener(agent.agent_id, motion.destination, false);
      }
      const visualKey = JSON.stringify([agent.display_name, agent.observed_state, agent.task_phase, model.interaction, model.selected, node.moving, node.queued, node.reducedMotion]);
      if (visualKey !== node.visualKey) {
        drawCharacter(node, { ...model, interaction: node.routeBlocked ? 'standing-idle' : node.queued ? node.interaction : model.interaction, motion: { ...motion, moving: node.moving } }); node.visualKey = visualKey;
      }
      this.positionNode(node, node.currentPoint);
    }
    if (!snapshot.paused && !document.hidden) this.startNextMovement();
    this.updateEnvironment(snapshot);

    this.animateEnvironment(this.now());
    app.render();
    const animationActive = [...this.nodes.values()].some((node) => !node.reducedMotion && node.moving)
      || [...this.nodes.values()].some((node) =>
        !node.reducedMotion
        && (node.settlingStartedAt !== null || hasContinuousActivity(node)));
    if (document.hidden || snapshot.paused) { this.suspendedAt ??= this.now(); app.ticker.stop(); }
    else if (animationActive) app.ticker.start();
    else app.ticker.stop();
  }

  private readonly tick = (): void => {
    if (document.hidden || this.pendingSnapshot?.paused) { this.visibilityChanged(); return; }
    const now = this.now();
    this.startNextMovement();
    this.animateEnvironment(now);
    let animationActive = false;
    for (const node of this.nodes.values()) {
      if (!node.reducedMotion && node.moving && node.route.length >= 2) {
        const progress = Math.min(1, (now - node.startedAt) / node.duration);
        const point = interpolateRoute(node.route, progress);
        const previousPoint = interpolateRoute(node.route, Math.max(0, progress - 0.01));
        this.positionNode(node, point);
        const pose = walkPose(previousPoint, point, progress);
        const walkingFrames = point.y < previousPoint.y
          ? node.premiumPoses.walkingBack
          : node.premiumPoses.walkingFront;
        const walkingFrameIndex = Math.floor(progress * 12) % walkingFrames.length;
        node.premiumPose.texture = walkingFrames[walkingFrameIndex];
        node.premiumPose.scale.x = pose.facing * Math.abs(node.premiumPose.scale.x);
        node.premiumPose.position.y = -37 + Math.round(Math.sin(progress * Math.PI * 12));
        if (progress === 1) {
          node.route = [node.destination]; node.moving = false;
          this.trafficNeedsPlanning = true;
          node.settlingStartedAt = SEATED_INTERACTIONS.has(node.interaction) ? now : null;
          if (node.model) drawCharacter(node, { ...node.model, motion: { ...node.model.motion, moving: false } });
          this.positionNode(node, node.destination);
          this.motionListener(node.agentId, node.destination, false);
          if (this.pendingSnapshot) this.updateEnvironment(this.pendingSnapshot);
          animationActive = true;
          this.resetPose(node);
        } else {
          animationActive = true;
        }
        continue;
      }

      if (!node.reducedMotion && node.settlingStartedAt !== null) {
        this.animateSeating(node, now);
        animationActive ||= node.settlingStartedAt !== null
          || hasContinuousActivity(node);
      } else if (!node.reducedMotion) {
        this.animateIdle(node, now);
        animationActive ||= hasContinuousActivity(node);
      }
    }
    if (!animationActive) {
      this.app?.ticker.stop();
      this.app?.render();
    }
  };

  // Deliberately serialize transfers through this small room. Other actors stay
  // on their seats, and their ground envelopes are obstacles for the traveller.
  // No teleporting through people and no pair of opposing walkers deadlocking.
  private startNextMovement(): void {
    if (!this.trafficNeedsPlanning || [...this.nodes.values()].some((n) => n.moving)) return;
    this.trafficNeedsPlanning = false;
    for (const node of this.nodes.values()) {
      if (!node.queued || node.reducedMotion) continue;
      const occupied = [...this.nodes.values()].filter((other) => other !== node && !other.model?.hidden).map((other) => other.currentPoint);
      const route = navigate(node.currentPoint, node.destination, occupied);
      if (route.length < 2) continue; // Another queued actor may first need to leave.
      node.route = route; node.queued = false; node.moving = true; node.routeBlocked = false;
      node.startedAt = this.now(); node.duration = movementDuration(route);
      if (node.model) drawCharacter(node, { ...node.model, motion: { ...node.model.motion, moving: true } });
      this.positionNode(node, node.currentPoint);
      return;
    }
    // No queued transfer is currently safe: stop explicitly, keep real states
    // in the HUD, and retry on the next source refresh instead of spinning.
    for (const node of this.nodes.values()) if (node.queued && !node.routeBlocked) {
      node.routeBlocked = true;
      this.motionListener(node.agentId, node.destination, true);
    }
  }

  private animateSeating(node: AgentNode, now: number): void {
    if (node.settlingStartedAt === null) return;
    const progress = Math.min(1, (now - node.settlingStartedAt) / AGENT_SEATING_DURATION_MS);
    // Keep the authored pelvis/feet anchors fixed; only settle the held object.
    this.resetPose(node);
    node.activityProp.alpha = progress;
    if (progress === 1) node.settlingStartedAt = null;
  }

  private animateIdle(node: AgentNode, now: number): void {
    const pulse = Math.sin((now + node.animationOffset) / 650);
    this.resetPose(node);
    node.symbolBubble.position.y = 0;
    node.symbolLabel.position.y = -49;

    // A place in the lab is not evidence of work: waiting/offline agents keep
    // their seat, but must not type or simulate research.
    if (node.phase !== 'available' && node.phase !== 'live_run' && node.phase !== 'live_session') return;

    if (node.interaction === 'typing-at-desk') {
      if (node.phase !== 'live_run' && node.phase !== 'live_session') return;
      const frameIndex = Math.floor(now / 180) % Math.max(1, node.premiumPoses.typing.length);
      if (node.premiumPoses.typing[frameIndex]) {
        configureTypingPose(node, frameIndex, (pulse + 1) / 2);
      }
    } else if (node.interaction === 'researching-at-lab') {
      if (node.phase !== 'live_run' && node.phase !== 'live_session') return;
      const frameIndex = Math.floor(now / 220) % Math.max(1, node.premiumPoses.typing.length);
      if (node.premiumPoses.typing[frameIndex]) {
        configureTypingPose(node, frameIndex, (pulse + 1) / 2);
      }
    } else if (SEATED_INTERACTIONS.has(node.interaction) || node.interaction === 'reading-in-lounge') {
      node.premiumPose.texture = node.premiumPoses.seatedFront[0];
      node.premiumPose.position.y = LOUNGE_SEATED_INTERACTIONS.has(node.interaction)
        ? LOUNGE_SEATED_SPRITE_Y
        : -28;
      if (node.interaction === 'playing-handheld') {
        node.activityProp.position.x += pulse > 0 ? 1 : -1;
      } else if (node.interaction === 'reading-in-lounge') {
        node.activityProp.rotation = pulse * 0.025;
      } else if (node.interaction === 'drinking-coffee') {
        node.activityProp.position.y += Math.round(pulse);
      }
    } else if (node.interaction === 'washing-dishes') {
      node.activityProp.rotation = pulse * 0.08;
    } else if (node.interaction === 'cooking-at-counter') {
      node.activityProp.position.x += Math.round(pulse * 2);
    } else if (node.interaction === 'having-coffee') {
      node.activityProp.position.y += Math.round(pulse);
    } else if (node.interaction === 'reading-at-bookshelf') {
      node.activityProp.rotation = pulse * 0.025;
    } else if (node.interaction === 'checking-whiteboard') {
      node.activityProp.position.y += pulse > 0 ? -1 : 0;
    } else if (node.interaction === 'watering-plants') {
      node.activityProp.rotation = -0.12 + (pulse * 0.08);
    } else if (node.interaction === 'checking-phone') {
      node.activityProp.position.y += Math.round(pulse);
    } else if (node.phase === 'available') {
      node.premiumPose.position.y = -35 + Math.round(pulse);
    }
  }

  private resetPose(node: AgentNode): void {
    node.activityProp.position.set(node.activityPropOrigin.x, node.activityPropOrigin.y);
    node.activityProp.rotation = 0; node.activityProp.alpha = 1;
  }

  private updateEnvironment(snapshot: PixiSceneSnapshot): void {
    snapshot = { ...snapshot, agents: snapshot.agents.filter((m) => !m.hidden).map((m) => {
      const node = this.nodes.get(m.agent.agent_id);
      return { ...m, interaction: node?.queued ? node.interaction : m.interaction,
        motion: { ...m.motion, destination: node?.queued ? node.currentPoint : m.motion.destination, moving: node?.moving ?? m.motion.moving } };
    }) };
    const fx = this.environmentFx;
    if (!fx) return;
    const interactions = snapshot.agents
      .filter(({ motion }) => !motion.moving)
      .map(({ interaction }) => interaction ?? 'standing-idle');
    const activeDeskIndexes = new Set(
      snapshot.agents
        .filter(({ interaction, motion }) => interaction === 'typing-at-desk' && !motion.moving)
        .map(({ motion }) => workstationIndexFor(motion.destination)),
    );
    fx.activeDeskIndexes = activeDeskIndexes;
    fx.activeLabIndexes = new Set(
      snapshot.agents
        .filter(({ interaction, motion }) => interaction === 'researching-at-lab' && !motion.moving)
        .map(({ motion }) => labWorkstationIndexFor(motion.destination)),
    );
    fx.deskGlows.forEach((glow, index) => {
      const working = snapshot.agents.some(({ agent, interaction, motion }) => !motion.moving
        && interaction === 'typing-at-desk' && workstationIndexFor(motion.destination) === index
        && (agent.task_phase === 'live_run' || agent.task_phase === 'live_session'));
      glow.visible = working;
      fx.deskScreens[index].visible = working;
    });
    fx.labGlows.forEach((glow, index) => {
      const working = snapshot.agents.some(({ agent, interaction, motion }) => !motion.moving
        && interaction === 'researching-at-lab' && labWorkstationIndexFor(motion.destination) === index
        && (agent.task_phase === 'live_run' || agent.task_phase === 'live_session'));
      glow.visible = working;
      fx.labScreens[index].visible = working;
    });
    fx.boardGlow.visible = interactions.some((value) =>
      value === 'reading-kanban' || value === 'thinking-at-board' || value === 'blocked-at-board');
    const drinkingCoffee = interactions.includes('having-coffee');
    fx.coffeeSteam.visible = drinkingCoffee;
    fx.coffeeBrew.visible = drinkingCoffee;
    fx.cookingSteam.visible = interactions.includes('cooking-at-counter');
    fx.cookingPan.visible = interactions.includes('cooking-at-counter');
    const washing = interactions.includes('washing-dishes');
    fx.sinkWater.visible = washing;
    fx.sinkSparkles.visible = washing;
    fx.televisionActive = interactions.some((value) =>
      value === 'sitting-on-sofa' || value === 'sitting-in-armchair');
    fx.reducedMotion = snapshot.reducedMotion;
  }

  private animateEnvironment(now: number): void {
    const fx = this.environmentFx;
    if (!fx) return;
    animateDynamicEnvironment(fx, now);
  }

  private positionNode(node: AgentNode, point: SpritePoint): void {
    node.currentPoint = { ...point };
    const projected = projectWorldPoint(point);
    node.activityProp.visible = !node.moving;
    node.container.position.set(Math.round(projected.x), Math.round(projected.y));
    const hudOffsetY = !node.moving ? (node.interaction === 'typing-at-desk' ? -70 : node.interaction === 'researching-at-lab' ? -35 : node.interaction === 'inspecting-lab' ? -25 : 0) : 0;
    node.hud.position.set(Math.round(projected.x), Math.round(projected.y + hudOffsetY));
    node.container.zIndex = depthFor(point.y, 50);
    node.hud.zIndex = 40_000 + depthFor(point.y, 50);
  }
}
