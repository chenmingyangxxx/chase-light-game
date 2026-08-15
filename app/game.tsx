"use client";

import Matter from "matter-js";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const { Bodies, Body, Composite, Engine, Events, World } = Matter;

// The playable camera is portrait first. The physics world remains taller than
// one viewport so the full 0–99 m climb can be inspected by swiping upward.
const WORLD_WIDTH = 720;
const WORLD_HEIGHT = 1000;
// The physical floor is wider than any supported viewport. The visible drop
// zone is calculated from the canvas and the overlaid inventory rail, so wide
// monitors gain usable ground without changing the world's metre scale.
const PHYSICS_GROUND_WIDTH = 4096;
// The build plate and the suspended goal share this left-of-centre axis, leaving
// the right side clear for the portrait material tray.
const BASE_X = 306;
// Keep a single physical scale across the scene: 12 virtual pixels are one
// metre.  The 99 m ascent is therefore 1188 px tall and deliberately scrolls
// beyond one portrait viewport, while the real-world-sized props are large
// enough to read and manipulate on a phone.
const BASE_Y = 2058;
const PIXELS_PER_METER = 12;
const GOAL_BASKET_X = BASE_X + 14;
// The basket's lower rail is exactly the 99 m success position. Its crane,
// rope and flower are placed around that fixed world-space altitude.
const GOAL_REACH_HEIGHT = 99;
const GOAL_REACH_Y = BASE_Y - GOAL_REACH_HEIGHT * PIXELS_PER_METER;
const GOAL_BASKET_Y = GOAL_REACH_Y - 86;
const GOAL_RIG_TOP_Y = GOAL_BASKET_Y - 180;
const GOAL_REACH_HALF_WIDTH = 139;
// The deliberate 22 second ascent is 50% slower than the previous version.
// Short grip holds inside each step keep the reduced speed feeling purposeful
// instead of like a uniformly slowed video.
const ROBOT_CLIMB_DURATION = 22000;
const ROBOT_PLUCK_DURATION = 2200;
const ACTIVATION_DURATION = ROBOT_CLIMB_DURATION + ROBOT_PLUCK_DURATION;
const ROBOT_CLIMB_HEIGHT = 86;
const ROBOT_PLUCK_HEIGHT = 91;
const PHYSICS_MASS_PER_KG = 0.045;
const STRENGTH_MULTIPLIER = 3;
// Keep the robot's authored real-world profile, but soften the effective
// moving payload by 50% so the climb remains readable without making every
// otherwise sound tower fail under a single gait cycle.
const ROBOT_CLIMB_LOAD_MULTIPLIER = 0.5;
const RECOVERY_Y = BASE_Y + 113;
// Both user-supplied gameplay paintings cover the complete camera range, from
// the highest crane view down to the physical floor. No separate sky patch is
// composited, avoiding a visible seam at the top of the scene.
const BACKDROP_SKY_TOP = 410;
const BACKDROP_BOTTOM = BASE_Y + 149;
// Keep the physical floor close to the lower edge of the build viewport. The
// former 84 px world-space margin made placed props appear to hover above the
// foreground road in wide layouts.
const VIEW_GROUND_CAMERA = WORLD_HEIGHT - BASE_Y - 24;
const MIN_CAMERA_OFFSET = VIEW_GROUND_CAMERA - 20;
// At maximum ascent the crane arm, basket, flower and tower crown all remain
// inside the portrait viewport instead of being clipped above its top edge.
const MAX_CAMERA_OFFSET = 100 - GOAL_RIG_TOP_Y;

type Shape = "box" | "circle";
type ItemRole = "foundation" | "bridge" | "block" | "tall" | "risky";
type ItemId =
  | "pallet"
  | "slab"
  | "container"
  | "car"
  | "cabinet"
  | "sofa"
  | "beam"
  | "ladder"
  | "pipes"
  | "crate"
  | "fridge"
  | "washer"
  | "computer"
  | "scaffold"
  | "barrel"
  | "tire"
  | "bicycle"
  | "chair";

type GameStatus = "building" | "activating" | "cleared" | "failed";

interface ArtSprite {
  asset: "junk-sprite-atlas.png" | "risky-props.png" | "monitor";
  column: number;
  row: number;
  columns: number;
  rows: number;
  /**
   * The opaque artwork footprint inside its atlas cell, expressed as
   * [left, top, right, bottom] percentages.  Generated cutouts deliberately
   * have different safety margins, so a generic cell crop makes objects look
   * as if they are floating even while their Matter bodies are in contact.
   */
  visibleBounds: [number, number, number, number];
}

interface IconSprite {
  asset: "front-prop-atlas.png" | "front-risky-props.png";
  column: number;
  row: number;
  columns: number;
  rows: number;
}

interface ItemDefinition {
  id: ItemId;
  name: string;
  shortName: string;
  role: ItemRole;
  shape: Shape;
  width: number;
  height: number;
  density: number;
  friction: number;
  frictionStatic: number;
  restitution: number;
  color: string;
  accent: string;
  trait: string;
}

interface MaterialPhysics {
  massKg: number;
  safeLoadKg: number;
  stability: number;
  flexibility: number;
  failureLabel: string;
}

interface HintSpec {
  itemId: ItemId;
  xMeters: number;
  yMeters: number;
  rotation: number;
  text: string;
}

interface LevelConfig {
  id: number;
  target: number;
  title: string;
  subtitle: string;
  baseWidth: number;
  wind: number;
  inventory: ItemId[];
  hintItems: [ItemId, ItemId, ItemId];
}

interface HeldItem {
  itemId: ItemId;
  x: number;
  y: number;
  angle: number;
  pointerId?: number;
}

interface AdjustedBody {
  body: TaggedBody;
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

interface TaggedBody extends Matter.Body {
  gameItem?: ItemDefinition;
  gameBornAt?: number;
  gameBaseInertia?: number;
  gameStressRatio?: number;
  gameStressDamage?: number;
  gameDeformation?: number;
  gameBendDirection?: number;
  gameFracturedAt?: number;
}

interface ClimbPoint {
  x: number;
  y: number;
  support: TaggedBody;
}

interface GameSnapshot {
  status: GameStatus;
  height: number;
  stableHeight: number;
  hintsLeft: number;
  inventory: Record<ItemId, number>;
  heldItem: ItemId | null;
  hint: HintSpec | null;
  message: string;
  wind: number;
  activationProgress: number;
}

const ITEM_ART: Record<ItemId, ArtSprite> = {
  // Bounds are measured against the current v2 orthographic atlases. Some
  // generated cutouts cross their nominal grid cells (notably the bicycle),
  // so values may legitimately extend beyond 1.0 instead of clipping wheels.
  pallet: { asset: "junk-sprite-atlas.png", column: 0, row: 0, columns: 4, rows: 4, visibleBounds: [0.075, 0.17, 0.93, 0.925] },
  slab: { asset: "junk-sprite-atlas.png", column: 1, row: 0, columns: 4, rows: 4, visibleBounds: [0.035, 0.165, 0.96, 0.93] },
  container: { asset: "junk-sprite-atlas.png", column: 2, row: 0, columns: 4, rows: 4, visibleBounds: [0.07, 0.08, 0.905, 0.98] },
  car: { asset: "junk-sprite-atlas.png", column: 3, row: 0, columns: 4, rows: 4, visibleBounds: [0, 0.41, 0.955, 0.78] },
  cabinet: { asset: "junk-sprite-atlas.png", column: 0, row: 1, columns: 4, rows: 4, visibleBounds: [0.25, 0.015, 0.74, 1] },
  sofa: { asset: "junk-sprite-atlas.png", column: 1, row: 1, columns: 4, rows: 4, visibleBounds: [0.02, 0.28, 0.97, 0.835] },
  beam: { asset: "junk-sprite-atlas.png", column: 2, row: 1, columns: 4, rows: 4, visibleBounds: [0.04, 0.36, 0.965, 0.655] },
  ladder: { asset: "junk-sprite-atlas.png", column: 3, row: 1, columns: 4, rows: 4, visibleBounds: [0.29, 0, 0.685, 1] },
  pipes: { asset: "junk-sprite-atlas.png", column: 0, row: 2, columns: 4, rows: 4, visibleBounds: [0.035, 0.28, 0.985, 0.8] },
  crate: { asset: "junk-sprite-atlas.png", column: 1, row: 2, columns: 4, rows: 4, visibleBounds: [0.085, 0.15, 0.935, 1] },
  fridge: { asset: "junk-sprite-atlas.png", column: 2, row: 2, columns: 4, rows: 4, visibleBounds: [0.235, 0.005, 0.755, 0.96] },
  washer: { asset: "junk-sprite-atlas.png", column: 3, row: 2, columns: 4, rows: 4, visibleBounds: [0.155, 0.04, 0.82, 0.95] },
  computer: { asset: "monitor", column: 0, row: 0, columns: 1, rows: 1, visibleBounds: [0.075, 0.02, 0.925, 0.975] },
  scaffold: { asset: "junk-sprite-atlas.png", column: 1, row: 3, columns: 4, rows: 4, visibleBounds: [0.125, 0, 0.91, 0.925] },
  barrel: { asset: "junk-sprite-atlas.png", column: 2, row: 3, columns: 4, rows: 4, visibleBounds: [0.23, 0.015, 0.77, 0.915] },
  tire: { asset: "junk-sprite-atlas.png", column: 3, row: 3, columns: 4, rows: 4, visibleBounds: [0.085, 0.04, 0.89, 0.86] },
  bicycle: { asset: "risky-props.png", column: 0, row: 0, columns: 2, rows: 1, visibleBounds: [0.015, 0.08, 1.33, 0.9] },
  chair: { asset: "risky-props.png", column: 1, row: 0, columns: 2, rows: 1, visibleBounds: [0.38, 0.075, 0.96, 0.94] },
};

const ITEM_ICON_ART: Record<ItemId, IconSprite> = {
  pallet: { asset: "front-prop-atlas.png", column: 0, row: 0, columns: 4, rows: 4 },
  slab: { asset: "front-prop-atlas.png", column: 1, row: 0, columns: 4, rows: 4 },
  container: { asset: "front-prop-atlas.png", column: 2, row: 0, columns: 4, rows: 4 },
  car: { asset: "front-prop-atlas.png", column: 3, row: 0, columns: 4, rows: 4 },
  cabinet: { asset: "front-prop-atlas.png", column: 0, row: 1, columns: 4, rows: 4 },
  sofa: { asset: "front-prop-atlas.png", column: 1, row: 1, columns: 4, rows: 4 },
  beam: { asset: "front-prop-atlas.png", column: 2, row: 1, columns: 4, rows: 4 },
  ladder: { asset: "front-prop-atlas.png", column: 3, row: 1, columns: 4, rows: 4 },
  pipes: { asset: "front-prop-atlas.png", column: 0, row: 2, columns: 4, rows: 4 },
  crate: { asset: "front-prop-atlas.png", column: 1, row: 2, columns: 4, rows: 4 },
  fridge: { asset: "front-prop-atlas.png", column: 2, row: 2, columns: 4, rows: 4 },
  washer: { asset: "front-prop-atlas.png", column: 3, row: 2, columns: 4, rows: 4 },
  computer: { asset: "front-prop-atlas.png", column: 0, row: 3, columns: 4, rows: 4 },
  scaffold: { asset: "front-prop-atlas.png", column: 1, row: 3, columns: 4, rows: 4 },
  barrel: { asset: "front-prop-atlas.png", column: 2, row: 3, columns: 4, rows: 4 },
  tire: { asset: "front-prop-atlas.png", column: 3, row: 3, columns: 4, rows: 4 },
  bicycle: { asset: "front-risky-props.png", column: 0, row: 0, columns: 2, rows: 1 },
  chair: { asset: "front-risky-props.png", column: 1, row: 0, columns: 2, rows: 1 },
};

const ITEMS: Record<ItemId, ItemDefinition> = {
  pallet: {
    id: "pallet", name: "木托盘", shortName: "托", role: "foundation", shape: "box", width: 112, height: 84,
    density: 0.0022, friction: 0.88, frictionStatic: 1.05, restitution: 0.01, color: "#9b6b45", accent: "#d3a271", trait: "宽 · 稳",
  },
  slab: {
    id: "slab", name: "混凝土板", shortName: "板", role: "foundation", shape: "box", width: 120, height: 96,
    density: 0.0044, friction: 0.94, frictionStatic: 1.2, restitution: 0.005, color: "#66747a", accent: "#9ba9a9", trait: "极重 · 防滑",
  },
  container: {
    id: "container", name: "旧集装箱", shortName: "箱", role: "foundation", shape: "box", width: 148, height: 156,
    density: 0.0033, friction: 0.78, frictionStatic: 0.96, restitution: 0.01, color: "#536f74", accent: "#a2b8a7", trait: "重 · 可堆高",
  },
  car: {
    id: "car", name: "报废车壳", shortName: "车", role: "foundation", shape: "box", width: 246, height: 104,
    density: 0.0048, friction: 0.74, frictionStatic: 0.9, restitution: 0.02, color: "#785751", accent: "#c18c68", trait: "宽 · 压重",
  },
  cabinet: {
    id: "cabinet", name: "铁皮柜", shortName: "柜", role: "tall", shape: "box", width: 72, height: 142,
    density: 0.0031, friction: 0.73, frictionStatic: 0.9, restitution: 0.02, color: "#6c7c65", accent: "#b9c697", trait: "高 · 偏重",
  },
  sofa: {
    id: "sofa", name: "旧沙发", shortName: "沙", role: "foundation", shape: "box", width: 156, height: 92,
    density: 0.0028, friction: 0.85, frictionStatic: 1.05, restitution: 0.02, color: "#75554c", accent: "#ca9880", trait: "宽 · 高摩擦",
  },
  beam: {
    id: "beam", name: "废旧钢梁", shortName: "梁", role: "bridge", shape: "box", width: 226, height: 60,
    density: 0.0032, friction: 0.8, frictionStatic: 0.98, restitution: 0.01, color: "#7e8382", accent: "#d1c9a8", trait: "长 · 可桥接",
  },
  ladder: {
    id: "ladder", name: "金属梯", shortName: "梯", role: "tall", shape: "box", width: 58, height: 218,
    density: 0.0019, friction: 0.63, frictionStatic: 0.75, restitution: 0.03, color: "#8b9d87", accent: "#d6dfba", trait: "轻 · 易翘",
  },
  pipes: {
    id: "pipes", name: "管束", shortName: "管", role: "bridge", shape: "box", width: 184, height: 90,
    density: 0.0029, friction: 0.58, frictionStatic: 0.7, restitution: 0.04, color: "#647a82", accent: "#b1c2c6", trait: "长 · 易滑",
  },
  crate: {
    id: "crate", name: "回收箱", shortName: "箱", role: "block", shape: "box", width: 92, height: 74,
    density: 0.0025, friction: 0.81, frictionStatic: 0.98, restitution: 0.015, color: "#b7784f", accent: "#e2ae70", trait: "规则 · 易堆",
  },
  fridge: {
    id: "fridge", name: "旧冰箱", shortName: "冰", role: "tall", shape: "box", width: 72, height: 132,
    density: 0.0038, friction: 0.74, frictionStatic: 0.88, restitution: 0.01, color: "#7790a0", accent: "#d6e0d5", trait: "高 · 可封顶",
  },
  washer: {
    id: "washer", name: "洗衣机", shortName: "洗", role: "block", shape: "box", width: 74, height: 98,
    density: 0.0034, friction: 0.76, frictionStatic: 0.93, restitution: 0.01, color: "#8e9e9a", accent: "#cbd6cd", trait: "方正 · 压重",
  },
  computer: {
    id: "computer", name: "破旧显示器", shortName: "屏", role: "block", shape: "box", width: 88, height: 70,
    density: 0.0018, friction: 0.64, frictionStatic: 0.74, restitution: 0.04, color: "#57636b", accent: "#9daeb5", trait: "宽 · 填缝",
  },
  scaffold: {
    id: "scaffold", name: "脚手架", shortName: "架", role: "tall", shape: "box", width: 100, height: 144,
    density: 0.0022, friction: 0.68, frictionStatic: 0.81, restitution: 0.02, color: "#76866c", accent: "#d6cc88", trait: "很高 · 须居中",
  },
  barrel: {
    id: "barrel", name: "旧油桶", shortName: "桶", role: "risky", shape: "box", width: 72, height: 104,
    density: 0.0024, friction: 0.48, frictionStatic: 0.58, restitution: 0.07, color: "#a37445", accent: "#edc161", trait: "高 · 易倒",
  },
  tire: {
    id: "tire", name: "轮胎", shortName: "胎", role: "risky", shape: "circle", width: 82, height: 82,
    density: 0.0027, friction: 0.54, frictionStatic: 0.68, restitution: 0.2, color: "#333b3a", accent: "#9fa78c", trait: "弹性 · 可配重",
  },
  bicycle: {
    id: "bicycle", name: "旧自行车", shortName: "车", role: "risky", shape: "box", width: 170, height: 104,
    density: 0.0013, friction: 0.34, frictionStatic: 0.42, restitution: 0.08, color: "#6e7e5f", accent: "#d2b86a", trait: "轻 · 难稳定",
  },
  chair: {
    id: "chair", name: "办公椅", shortName: "椅", role: "risky", shape: "box", width: 82, height: 126,
    density: 0.0016, friction: 0.4, frictionStatic: 0.52, restitution: 0.05, color: "#745f56", accent: "#c5a477", trait: "偏心 · 易倒",
  },
};

// Representative real-world masses and working loads. Gameplay multiplies
// each working load by three so discarded objects remain useful at 99 m while
// preserving their relative strengths, weight classes and failure character.
const ITEM_PHYSICS: Record<ItemId, MaterialPhysics> = {
  pallet: { massKg: 25, safeLoadKg: 1500, stability: 1.18, flexibility: 0.58, failureLabel: "木板持续弯曲并劈裂" },
  slab: { massKg: 680, safeLoadKg: 8000, stability: 1.34, flexibility: 0.08, failureLabel: "混凝土开裂并突然断裂" },
  container: { massKg: 2180, safeLoadKg: 28280, stability: 1.16, flexibility: 0.3, failureLabel: "箱体钢板屈曲并塌陷" },
  car: { massKg: 1250, safeLoadKg: 1500, stability: 1.02, flexibility: 0.38, failureLabel: "车顶与立柱弯折失效" },
  cabinet: { massKg: 75, safeLoadKg: 350, stability: 0.68, flexibility: 0.54, failureLabel: "薄钢板发生侧向屈曲" },
  sofa: { massKg: 65, safeLoadKg: 450, stability: 1.12, flexibility: 0.88, failureLabel: "框架受压变形并侧翻" },
  beam: { massKg: 520, safeLoadKg: 6000, stability: 1.22, flexibility: 0.24, failureLabel: "钢梁产生永久弯曲" },
  ladder: { massKg: 18, safeLoadKg: 136, stability: 0.46, flexibility: 0.62, failureLabel: "梯框弯折并失去支撑" },
  pipes: { massKg: 260, safeLoadKg: 3500, stability: 0.58, flexibility: 0.42, failureLabel: "管束弯曲后滚离受力点" },
  crate: { massKg: 18, safeLoadKg: 250, stability: 0.92, flexibility: 0.68, failureLabel: "箱壁受压弯折并破裂" },
  fridge: { massKg: 85, safeLoadKg: 350, stability: 0.76, flexibility: 0.34, failureLabel: "冰箱外壳屈曲变形" },
  washer: { massKg: 72, safeLoadKg: 400, stability: 0.9, flexibility: 0.26, failureLabel: "机壳受压凹陷并倾倒" },
  computer: { massKg: 12, safeLoadKg: 60, stability: 0.62, flexibility: 0.18, failureLabel: "显示器外壳碎裂失效" },
  scaffold: { massKg: 95, safeLoadKg: 900, stability: 0.72, flexibility: 0.48, failureLabel: "脚手架杆件弯折失稳" },
  barrel: { massKg: 22, safeLoadKg: 300, stability: 0.5, flexibility: 0.58, failureLabel: "桶壁压瘪并向侧面滚动" },
  tire: { massKg: 11, safeLoadKg: 750, stability: 0.3, flexibility: 0.96, failureLabel: "轮胎被压扁后弹出支撑面" },
  bicycle: { massKg: 16, safeLoadKg: 90, stability: 0.24, flexibility: 0.76, failureLabel: "车架弯折并侧向滑落" },
  chair: { massKg: 15, safeLoadKg: 160, stability: 0.36, flexibility: 0.74, failureLabel: "椅架弯折并侧翻" },
};

const ROBOT_PHYSICS: MaterialPhysics = {
  massKg: 47.5,
  safeLoadKg: 225,
  stability: 0.86,
  flexibility: 0.28,
  failureLabel: "机械关节过载",
};

// Final world-space sizes use one calibrated presentation scale. Ratios follow
// familiar real objects (a car is about 1.8x a container door, a ladder is
// markedly taller and narrower than a fridge), with only thin objects slightly
// thickened so they remain comfortable to grab on a phone.

const LEVELS: LevelConfig[] = [
  {
    id: 1,
    target: GOAL_REACH_HEIGHT,
    title: "新芽吊篮",
    subtitle: "把稳定的废料塔堆到吊篮下沿，攀爬助手便会出发摘取新芽。",
    baseWidth: 242,
    wind: 0,
    inventory: ["slab", "slab", "slab", "pallet", "pallet", "container", "container", "container", "container", "container", "container", "car", "car", "scaffold", "scaffold", "scaffold", "scaffold", "scaffold", "scaffold", "fridge", "fridge", "fridge", "cabinet", "cabinet", "washer", "washer", "crate", "crate", "crate", "crate", "beam", "beam", "beam", "beam", "ladder", "pipes", "computer", "computer", "computer", "bicycle", "bicycle", "chair", "chair"],
    hintItems: ["slab", "scaffold", "beam"],
  },
];

function inventoryFor(level: LevelConfig): Record<ItemId, number> {
  const inventory = Object.fromEntries(Object.keys(ITEMS).map((id) => [id, 0])) as Record<ItemId, number>;
  level.inventory.forEach((itemId) => { inventory[itemId] += 1; });
  return inventory;
}

function hintsFor(level: LevelConfig): HintSpec[] {
  const secondHeight = Math.max(5, Math.min(level.target * 0.45, 24));
  const finalHeight = Math.max(7, level.target - 4);
  const [first, second, third] = level.hintItems;
  return [
    { itemId: first, xMeters: 0, yMeters: 1.8, rotation: 0, text: `先选择「${ITEMS[first].name}」，横放在绿色落点上，铺出宽底座。` },
    { itemId: second, xMeters: 0, yMeters: secondHeight, rotation: 0, text: `接着用「${ITEMS[second].name}」补高，重心尽量对准中线。` },
    { itemId: third, xMeters: 0, yMeters: finalHeight, rotation: 0, text: `最后用「${ITEMS[third].name}」封顶，保持水平接近吊篮下沿。` },
  ];
}

function initialSnapshot(level: LevelConfig): GameSnapshot {
  return {
    status: "building",
    height: 0,
    stableHeight: 0,
    hintsLeft: 3,
    inventory: inventoryFor(level),
    heldItem: null,
    hint: null,
    message: "按住右侧物料拖入场景；松手后它会遵循物理规律落下。",
    wind: level.wind,
    activationProgress: 0,
  };
}

/**
 * Layered game sound: a clean procedural score supports the build scene while
 * material-aware effects stay responsive to the physics simulation. The login
 * film soundtrack is intentionally not reused here because it contains
 * diegetic footsteps that read as stray noise during construction.
 */
class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private effects: GainNode | null = null;
  private ambience: GainNode | null = null;
  private ambientSources: AudioScheduledSourceNode[] = [];
  private enabled = true;
  private gameplayActive = false;
  private lastImpactAt = 0;
  private lastStrainAt = 0;

  async unlock() {
    if (!this.context) {
      const context = new AudioContext();
      const master = context.createGain();
      const effects = context.createGain();
      const ambience = context.createGain();
      master.gain.value = this.enabled ? 0.72 : 0;
      effects.gain.value = 0.92;
      ambience.gain.value = 0.34;
      effects.connect(master);
      ambience.connect(master);
      master.connect(context.destination);
      this.context = context;
      this.master = master;
      this.effects = effects;
      this.ambience = ambience;
    }
    if (this.context.state === "suspended") await this.context.resume();
    if (this.gameplayActive) {
      this.startAmbience();
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(enabled ? 0.72 : 0, now, 0.035);
    if (enabled && this.gameplayActive) {
      this.startAmbience();
    }
  }

  startGameplay() {
    this.gameplayActive = true;
    this.startAmbience();
  }

  stopGameplay() {
    this.gameplayActive = false;
    this.stopAmbience();
  }

  ui() {
    this.tone(640, 920, 0.065, 0.038, "triangle");
  }

  hint() {
    this.tone(520, 780, 0.11, 0.045, "sine");
    this.tone(780, 1040, 0.1, 0.032, "sine", 0.075);
  }

  pickup(item: ItemDefinition) {
    const mass = ITEM_PHYSICS[item.id].massKg;
    const base = clamp(430 - Math.log10(Math.max(1, mass)) * 95, 145, 390);
    this.tone(base * 1.35, base, 0.085, 0.052, "triangle");
    this.noise(0.045, 0.02, 2300);
  }

  place(item: ItemDefinition) {
    const mass = ITEM_PHYSICS[item.id].massKg;
    const weight = clamp(Math.log10(Math.max(10, mass)) / 3.4, 0.25, 1);
    this.tone(125 + (1 - weight) * 70, 58 + (1 - weight) * 35, 0.16, 0.065 + weight * 0.035, "sine");
    this.noise(0.1, 0.025 + weight * 0.025, 900 + (1 - weight) * 900);
  }

  impact(intensity: number) {
    const nowMs = performance.now();
    if (nowMs - this.lastImpactAt < 95 || intensity < 0.07) return;
    this.lastImpactAt = nowMs;
    const strength = clamp(intensity, 0.08, 1);
    this.tone(110, 48, 0.09 + strength * 0.08, 0.025 + strength * 0.055, "sine");
    this.noise(0.05 + strength * 0.07, 0.012 + strength * 0.035, 680 + strength * 1200);
  }

  strain(stress: number) {
    const nowMs = performance.now();
    if (nowMs - this.lastStrainAt < 680) return;
    this.lastStrainAt = nowMs;
    const amount = clamp(stress, 0, 2);
    this.tone(190 + amount * 28, 88, 0.32, 0.025 + amount * 0.018, "sawtooth");
    this.noise(0.24, 0.022 + amount * 0.012, 520);
  }

  robotStep(step: number) {
    const variation = (step % 3) * 7;
    // A soft joint servo, padded foot contact and brief metal grip. Avoid the
    // former rising square wave, which sounded like an electronic alert.
    this.tone(176 + variation, 128 + variation * 0.5, 0.14, 0.018, "triangle");
    this.tone(94 + variation * 0.35, 58, 0.16, 0.034, "sine", 0.028);
    this.noise(0.065, 0.009, 760);
  }

  failure() {
    this.tone(210, 46, 0.68, 0.105, "sawtooth");
    this.noise(0.72, 0.09, 560);
    this.tone(118, 38, 0.58, 0.075, "sine", 0.18);
  }

  private startAmbience() {
    if (!this.enabled || !this.gameplayActive || !this.context || !this.ambience || this.ambientSources.length) return;
    const context = this.context;
    const seconds = 3;
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const data = buffer.getChannelData(0);
    let drift = 0;
    for (let index = 0; index < data.length; index += 1) {
      drift = drift * 0.985 + (Math.random() * 2 - 1) * 0.015;
      data[index] = drift + (Math.random() * 2 - 1) * 0.07;
    }
    const wind = context.createBufferSource();
    const windFilter = context.createBiquadFilter();
    const windGain = context.createGain();
    wind.buffer = buffer;
    wind.loop = true;
    windFilter.type = "bandpass";
    windFilter.frequency.value = 410;
    windFilter.Q.value = 0.48;
    windGain.gain.value = 0.075;
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.ambience);

    const hum = context.createOscillator();
    const humFilter = context.createBiquadFilter();
    const humGain = context.createGain();
    hum.type = "sine";
    hum.frequency.value = 42;
    humFilter.type = "lowpass";
    humFilter.frequency.value = 120;
    humGain.gain.value = 0.018;
    hum.connect(humFilter);
    humFilter.connect(humGain);
    humGain.connect(this.ambience);

    // A sparse A-minor suspended pad supplies the musical bed without any
    // recorded footsteps or other scene-specific transient noise.
    const padBus = context.createGain();
    const padFilter = context.createBiquadFilter();
    padBus.gain.value = 0.032;
    padFilter.type = "lowpass";
    padFilter.frequency.value = 520;
    padFilter.Q.value = 0.42;
    padBus.connect(padFilter);
    padFilter.connect(this.ambience);
    const padFrequencies = [55, 82.41, 110];
    const pads = padFrequencies.map((frequency, index) => {
      const oscillator = context.createOscillator();
      const voiceGain = context.createGain();
      oscillator.type = index === 1 ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index === 0 ? -5 : index === 2 ? 4 : 0;
      voiceGain.gain.value = index === 1 ? 0.16 : 0.11;
      oscillator.connect(voiceGain);
      voiceGain.connect(padBus);
      oscillator.start();
      return oscillator;
    });
    const padBreath = context.createOscillator();
    const padBreathDepth = context.createGain();
    padBreath.type = "sine";
    padBreath.frequency.value = 0.045;
    padBreathDepth.gain.value = 0.009;
    padBreath.connect(padBreathDepth);
    padBreathDepth.connect(padBus.gain);
    padBreath.start();
    wind.start();
    hum.start();
    this.ambientSources = [wind, hum, ...pads, padBreath];
  }

  private stopAmbience() {
    this.ambientSources.forEach((source) => {
      try { source.stop(); } catch { /* source already stopped */ }
      source.disconnect();
    });
    this.ambientSources = [];
  }

  private tone(
    startFrequency: number,
    endFrequency: number,
    duration: number,
    volume: number,
    type: OscillatorType,
    delay = 0,
  ) {
    if (!this.enabled || !this.context || !this.effects) return;
    const context = this.context;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, startFrequency), start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.effects);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(duration: number, volume: number, cutoff: number) {
    if (!this.enabled || !this.context || !this.effects) return;
    const context = this.context;
    const frameCount = Math.ceil(context.sampleRate * duration);
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.effects);
    source.start();
  }
}

class TowerPhysicsGame {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly level: LevelConfig;
  private readonly onUpdate: (snapshot: GameSnapshot) => void;
  private readonly onClear: () => void;
  private readonly audio: GameAudio;
  private engine: Matter.Engine;
  private dynamicBodies: TaggedBody[] = [];
  private inventory: Record<ItemId, number>;
  private held: HeldItem | null = null;
  private adjusting: AdjustedBody | null = null;
  private status: GameStatus = "building";
  private height = 0;
  private stableHeight = 0;
  private stableElapsed = 0;
  private collapseElapsed = 0;
  private hintIndex = 0;
  private hintsLeft = 3;
  private activeHint: HintSpec | null = null;
  private message = "按住右侧物料拖入场景；松手后它会遵循物理规律落下。";
  private elapsed = 0;
  private lastFrame = 0;
  private accumulator = 0;
  private lastUiUpdate = 0;
  private activationAt = 0;
  private lastRobotAudioStep = -1;
  private frameId = 0;
  private cameraOffsetY = VIEW_GROUND_CAMERA;
  private cameraManualOffsetY = 0;
  private cameraAutoFollowPeakHeight = 0;
  private viewportWorldWidth = WORLD_WIDTH;
  private viewportWorldLeft = 0;
  private panning: { pointerId: number; lastClientY: number } | null = null;
  private baseBody: Matter.Body | null = null;
  private readonly artwork: Record<
    | "polluted"
    | "revived"
    | "junk"
    | "risky"
    | "debris"
    | "goal"
    | "monitor"
    | "robotClimb"
    | "robotPluck",
    HTMLImageElement
  >;

  constructor(
    canvas: HTMLCanvasElement,
    level: LevelConfig,
    onUpdate: (snapshot: GameSnapshot) => void,
    onClear: () => void,
    audio: GameAudio,
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持 Canvas 渲染。");
    this.canvas = canvas;
    this.context = context;
    this.level = level;
    this.onUpdate = onUpdate;
    this.onClear = onClear;
    this.audio = audio;
    this.inventory = inventoryFor(level);
    this.engine = this.createEngine();
    this.artwork = {
      // These two complete-width paintings are the canonical gameplay pair.
      // Cover cropping adapts them to phone and desktop without stretching.
      polluted: this.loadArtwork("/assets/wasteland-gameplay-polluted-full-v7.png"),
      revived: this.loadArtwork("/assets/wasteland-gameplay-revived-full-v7.png"),
      // The same orthographic asset sheets are used both in the inventory and
      // in the physical world so a placed object keeps its front-facing form.
      junk: this.loadArtwork("/assets/front-prop-atlas-v2.png"),
      risky: this.loadArtwork("/assets/front-risky-props-v2.png"),
      monitor: this.loadArtwork("/assets/worn-monitor.png"),
      debris: this.loadArtwork("/assets/ground-debris-foreground.png"),
      goal: this.loadArtwork("/assets/crane-basket-sprout.png"),
      robotClimb: this.loadArtwork("/assets/robot-climb-frames-v2.png"),
      robotPluck: this.loadArtwork("/assets/robot-pluck-grid-v3.png"),
    };
    this.createWorld();
  }

  private loadArtwork(source: string) {
    const image = new Image();
    image.decoding = "async";
    image.src = source;
    return image;
  }

  start() {
    window.addEventListener("pointermove", this.onPointerMove, { passive: false, capture: true });
    // Capture-phase listeners still receive the release when a browser has
    // pointer-captured it on an inventory card or on the canvas.
    window.addEventListener("pointerup", this.onPointerUp, { passive: false, capture: true });
    window.addEventListener("pointercancel", this.onPointerCancel, { passive: false, capture: true });
    window.addEventListener("blur", this.releaseInterruptedInteraction);
    window.addEventListener("keydown", this.onKeyDown);
    this.emit(true);
    this.frameId = window.requestAnimationFrame(this.tick);
  }

  destroy() {
    window.cancelAnimationFrame(this.frameId);
    window.removeEventListener("pointermove", this.onPointerMove, true);
    window.removeEventListener("pointerup", this.onPointerUp, true);
    window.removeEventListener("pointercancel", this.onPointerCancel, true);
    window.removeEventListener("blur", this.releaseInterruptedInteraction);
    window.removeEventListener("keydown", this.onKeyDown);
    Composite.clear(this.engine.world, false, true);
    Engine.clear(this.engine);
  }

  startHolding(itemId: ItemId, clientX: number, clientY: number, pointerId: number) {
    if (this.status !== "building" || this.inventory[itemId] <= 0) return;
    this.panning = null;
    if (this.adjusting) this.releaseAdjustedBody();
    if (this.status !== "building") return;
    const point = this.clientToWorld(clientX, clientY);
    this.held = { itemId, x: point.x, y: point.y, angle: 0, pointerId };
    this.audio.pickup(ITEMS[itemId]);
    this.message = `正在搬运「${ITEMS[itemId].name}」，松手即可放下。`;
    this.emit(true);
  }

  beginCanvasInteraction(clientX: number, clientY: number, pointerId: number) {
    if (this.status !== "building") return;
    const point = this.clientToWorld(clientX, clientY);
    if (this.held) {
      this.held.x = point.x;
      this.held.y = point.y;
      this.held.pointerId = pointerId;
      return;
    }
    const body = [...this.dynamicBodies].reverse().find((candidate) =>
      !this.isFallen(candidate)
      && point.x >= candidate.bounds.min.x
      && point.x <= candidate.bounds.max.x
      && point.y >= candidate.bounds.min.y
      && point.y <= candidate.bounds.max.y,
    );
    if (!body) {
      this.panning = { pointerId, lastClientY: clientY };
      return;
    }
    this.adjusting = {
      body,
      pointerId,
      offsetX: point.x - body.position.x,
      offsetY: point.y - body.position.y,
    };
    // A deliberate reposition starts a new structure; it must never be mistaken for a collapse.
    this.stableHeight = 0;
    this.stableElapsed = 0;
    this.collapseElapsed = 0;
    Body.setStatic(body, true);
    Body.setVelocity(body, { x: 0, y: 0 });
    Body.setAngularVelocity(body, 0);
    this.message = `正在调整「${body.gameItem?.name ?? "物件"}」，松手后重新结算稳定性。`;
    this.emit(true);
  }

  rotateHeld(direction: -1 | 1) {
    if (!this.held || this.status !== "building") return;
    this.held.angle += direction * (Math.PI / 12);
    this.message = `「${ITEMS[this.held.itemId].name}」已旋转 ${direction > 0 ? "+" : "-"}15°。`;
    this.emit(true);
  }

  cancelHeld() {
    if (this.status !== "building") return;
    if (this.releaseAdjustedBody()) {
      this.message = "已结束调整，物件会重新遵循物理规律。";
    } else if (this.held) {
      this.held = null;
      this.message = "已放回当前物料，不会消耗数量。";
    } else {
      return;
    }
    this.emit(true);
  }

  private readonly releaseInterruptedInteraction = () => {
    if (this.adjusting) {
      this.releaseAdjustedBody();
      this.message = "拖拽已中断，物件已恢复为受重力影响的状态。";
      this.emit(true);
      return;
    }
    if (this.held) {
      this.held = null;
      this.message = "拖拽已取消，物料未被消耗。";
      this.emit(true);
    }
  };

  useHint() {
    if (this.status !== "building" || this.hintsLeft <= 0) return;
    const hints = hintsFor(this.level);
    this.activeHint = hints[this.hintIndex];
    this.audio.hint();
    this.message = this.activeHint.text;
    this.hintsLeft -= 1;
    this.hintIndex = Math.min(this.hintIndex + 1, hints.length - 1);
    this.emit(true);
  }

  restart() {
    this.status = "building";
    this.dynamicBodies = [];
    this.held = null;
    this.adjusting = null;
    this.inventory = inventoryFor(this.level);
    this.height = 0;
    this.stableHeight = 0;
    this.stableElapsed = 0;
    this.collapseElapsed = 0;
    this.activationAt = 0;
    this.lastRobotAudioStep = -1;
    this.hintIndex = 0;
    this.hintsLeft = 3;
    this.activeHint = null;
    this.cameraOffsetY = VIEW_GROUND_CAMERA;
    this.cameraManualOffsetY = 0;
    this.cameraAutoFollowPeakHeight = 0;
    this.panning = null;
    this.message = "已重置本关。物料和 3 次提示已恢复。";
    Composite.clear(this.engine.world, false, true);
    Engine.clear(this.engine);
    this.engine = this.createEngine();
    this.createWorld();
    this.emit(true);
  }

  private createEngine() {
    const engine = Engine.create({
      enableSleeping: true,
      positionIterations: 16,
      velocityIterations: 14,
      constraintIterations: 4,
      gravity: { x: 0, y: 1, scale: 0.00108 },
    });
    Events.on(engine, "collisionStart", (event) => {
      event.pairs.forEach((pair) => {
        if (!(pair.bodyA as TaggedBody).gameItem && !(pair.bodyB as TaggedBody).gameItem) return;
        const relativeX = pair.bodyA.velocity.x - pair.bodyB.velocity.x;
        const relativeY = pair.bodyA.velocity.y - pair.bodyB.velocity.y;
        this.audio.impact(Math.hypot(relativeX, relativeY) / 5.5);
      });
    });
    return engine;
  }

  private createWorld() {
    const groundLeft = BASE_X - PHYSICS_GROUND_WIDTH / 2;
    const groundRight = BASE_X + PHYSICS_GROUND_WIDTH / 2;
    const base = Bodies.rectangle(BASE_X, BASE_Y + 11, PHYSICS_GROUND_WIDTH, 22, {
      isStatic: true,
      friction: 1,
      frictionStatic: 1,
      label: "open-ground",
    });
    const recoveryFloor = Bodies.rectangle(BASE_X, RECOVERY_Y + 13, PHYSICS_GROUND_WIDTH, 26, {
      isStatic: true,
      friction: 0.8,
      label: "recovery-floor",
    });
    const leftWall = Bodies.rectangle(groundLeft + 16, RECOVERY_Y - 10, 32, 180, { isStatic: true, label: "boundary" });
    const rightWall = Bodies.rectangle(groundRight - 16, RECOVERY_Y - 10, 32, 180, { isStatic: true, label: "boundary" });
    this.baseBody = base;
    World.add(this.engine.world, [base, recoveryFloor, leftWall, rightWall]);
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    if (this.status !== "building") return;
    const holding = this.held?.pointerId === event.pointerId;
    const adjusted = this.adjusting;
    const movingBody = adjusted?.pointerId === event.pointerId;
    const panning = this.panning?.pointerId === event.pointerId;
    if (!holding && !movingBody && !panning) return;
    event.preventDefault();
    if (panning && this.panning) {
      this.panCamera(event.clientY - this.panning.lastClientY);
      this.panning.lastClientY = event.clientY;
      return;
    }
    const point = this.clientToWorld(event.clientX, event.clientY);
    if (holding && this.held) {
      this.held.x = point.x;
      this.held.y = point.y;
      return;
    }
    if (!adjusted) return;
    const item = adjusted.body.gameItem;
    const halfWidth = (item?.width ?? 40) / 2;
    const halfHeight = (item?.height ?? 40) / 2;
    const dropZone = this.dropZoneWorldBounds();
    const x = clamp(point.x - adjusted.offsetX, dropZone.left + halfWidth + 3, dropZone.right - halfWidth - 3);
    const y = clamp(point.y - adjusted.offsetY, 52, BASE_Y - halfHeight);
    Body.setPosition(adjusted.body, { x, y });
    Body.setVelocity(adjusted.body, { x: 0, y: 0 });
    Body.setAngularVelocity(adjusted.body, 0);
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (this.panning?.pointerId === event.pointerId) {
      event.preventDefault();
      this.panning = null;
      return;
    }
    if (this.adjusting?.pointerId === event.pointerId) {
      event.preventDefault();
      const itemName = this.adjusting.body.gameItem?.name ?? "物件";
      if (!this.releaseAdjustedBody()) return;
      this.message = `「${itemName}」已重新放置，继续把塔堆得更高。`;
      this.emit(true);
      return;
    }
    if (!this.held || this.held.pointerId !== event.pointerId) return;
    const point = this.clientToWorld(event.clientX, event.clientY);
    const item = ITEMS[this.held.itemId];
    const dropZone = this.dropZoneWorldBounds();
    const inDropZone = this.isClientInsideDropZone(event.clientX, event.clientY)
      && point.x >= dropZone.left + item.width / 2 + 3
      && point.x <= dropZone.right - item.width / 2 - 3
      && point.y >= 52
      && point.y <= BASE_Y - 3;
    this.held.pointerId = undefined;
    if (inDropZone) {
      event.preventDefault();
      this.placeHeld(point.x, point.y);
    } else {
      this.held = null;
      this.message = "物料没有进入建造区，未被消耗。";
      this.emit(true);
    }
  };

  private readonly onPointerCancel = (event: PointerEvent) => {
    if (this.panning?.pointerId === event.pointerId) {
      event.preventDefault();
      this.panning = null;
      return;
    }
    if (this.adjusting?.pointerId === event.pointerId) {
      event.preventDefault();
      this.cancelHeld();
      return;
    }
    if (!this.held || this.held.pointerId !== event.pointerId) return;
    event.preventDefault();
    this.cancelHeld();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === "q") {
      event.preventDefault();
      this.rotateHeld(-1);
    }
    if (event.key.toLowerCase() === "e") {
      event.preventDefault();
      this.rotateHeld(1);
    }
    if (event.key === "Escape" && (this.held || this.adjusting)) {
      this.cancelHeld();
    }
  };

  private releaseAdjustedBody() {
    const adjusted = this.adjusting;
    if (!adjusted) return false;
    Body.setStatic(adjusted.body, false);
    adjusted.body.isSleeping = false;
    adjusted.body.sleepCounter = 0;
    Body.setVelocity(adjusted.body, { x: 0, y: 0 });
    Body.setAngularVelocity(adjusted.body, 0);
    if (adjusted.body.gameItem) this.audio.place(adjusted.body.gameItem);
    this.adjusting = null;
    return true;
  }

  private placeHeld(x: number, y: number) {
    if (!this.held || this.status !== "building") return;
    const item = ITEMS[this.held.itemId];
    // Drop exactly where the player releases it. Matter handles collision,
    // gravity and any resulting fall instead of snapping to a preset point.
    const halfHeight = item.height / 2;
    const dropZone = this.dropZoneWorldBounds();
    const dropX = clamp(x, dropZone.left + item.width / 2 + 3, dropZone.right - item.width / 2 - 3);
    const dropY = clamp(y, halfHeight + 8, BASE_Y - halfHeight - 3);
    const body = this.makeBody(item, dropX, dropY, this.held.angle);
    this.dynamicBodies.push(body);
    World.add(this.engine.world, body);
    this.audio.place(item);
    this.inventory[item.id] -= 1;
    if (this.activeHint?.itemId === item.id) this.activeHint = null;
    this.message = `「${item.name}」已投入建造区，物理引擎正在结算受力与重心。`;
    this.held = null;
    this.emit(true);
  }

  private makeBody(item: ItemDefinition, x: number, y: number, angle: number): TaggedBody {
    const physics = ITEM_PHYSICS[item.id];
    const options: Matter.IChamferableBodyDefinition = {
      density: item.density,
      friction: item.friction,
      frictionStatic: item.frictionStatic,
      restitution: item.restitution,
      // Lower air damping leaves genuine wobble visible. Stability must come
      // from a wide support footprint and a centred load, not hidden damping.
      frictionAir: 0.006,
      // Tight contact tolerance reduces the visible air gaps in a carefully
      // placed stack while retaining normal Matter collision resolution.
      slop: 0.001,
      label: `item:${item.id}`,
    };
    const body = (item.shape === "circle"
      ? Bodies.circle(x, y, item.width / 2, options)
      : Bodies.rectangle(x, y, item.width, item.height, options)) as TaggedBody;
    Body.setAngle(body, angle);
    // Convert kilograms to one consistent Matter mass scale. This preserves
    // the large real-world differences between a pallet, appliance, car and
    // shipping container instead of deriving weight only from sprite area.
    Body.setMass(body, physics.massKg * PHYSICS_MASS_PER_KG);
    // Keep the visual centre and collision centre identical. Shifting Matter's
    // centre without compensating the sprite made physically touching pieces
    // look suspended or overlapping, especially tall appliances.
    Body.setInertia(body, body.inertia * physics.stability);
    body.gameItem = item;
    body.gameBornAt = this.elapsed;
    body.gameBaseInertia = body.inertia;
    body.gameStressRatio = 0;
    body.gameStressDamage = 0;
    body.gameDeformation = 0;
    return body;
  }

  private readonly tick = (now: number) => {
    const delta = this.lastFrame ? Math.min(33, now - this.lastFrame) : 16.667;
    this.lastFrame = now;
    this.elapsed += delta;
    // Reaching 99 m locks victory before another physics step can turn a valid
    // arrival into a loss. Any collapse before this exact height still fails in
    // updateSimulation below.
    if (this.status === "activating" && this.robotHasReachedGoal()) this.finishClear();
    if (this.status === "building" || this.status === "activating") {
      this.accumulator += delta;
      while (this.accumulator >= 16.667) {
        if (this.status === "activating") this.applyRobotWeight();
        Engine.update(this.engine, 16.667);
        this.accumulator -= 16.667;
      }
    } else {
      this.accumulator = 0;
    }
    this.updateSimulation(delta);
    this.render();
    if (now - this.lastUiUpdate > 110) {
      this.emit();
      this.lastUiUpdate = now;
    }
    this.frameId = window.requestAnimationFrame(this.tick);
  };

  private updateSimulation(delta: number) {
    const isClimbing = this.status === "activating";
    if (this.status !== "building" && !isClimbing) return;
    const nonFirstBodies = this.dynamicBodies.slice(1);
    const firstBody = this.dynamicBodies[0];
    const escapedBody = nonFirstBodies.find((body) => body !== this.adjusting?.body && this.isFallen(body))
      ?? (firstBody && firstBody !== this.adjusting?.body && this.isFallen(firstBody) && this.dynamicBodies.length > 1 ? firstBody : undefined);
    if (escapedBody) {
      const itemName = escapedBody.gameItem?.name ?? "一件废料";
      this.fail(isClimbing
        ? `机器人攀爬时，重量压在「${itemName}」附近，塔体侧向失稳并倒塌。把底座加宽、让重心更居中，再试一次，你已经很接近了！`
        : `「${itemName}」脱离了有效堆叠区域，塔体发生侧翻。先稳住底座再继续向上，你一定可以搭得更牢！`);
      return;
    }
    // This is the only single-piece failure: the first prop may always rest
    // directly on the ground; every later prop must remain carried by the
    // structure. We intentionally wait for a real ground contact instead of
    // failing at pointer release or during a short settling wobble.
    const groundedBody = nonFirstBodies.find((body) => body !== this.adjusting?.body && body.bounds.max.y >= BASE_Y - 1);
    if (groundedBody) {
      const itemName = groundedBody.gameItem?.name ?? "一件废料";
      this.fail(isClimbing
        ? `机器人经过时，「${itemName}」从支撑面滑落并触地。增大上下物件的接触面后再试，你已经离新芽很近了！`
        : `「${itemName}」没有被上一件物品承托，掉到了地面。调整落点并扩大接触面，再试一次！`);
      return;
    }
    const supportGraph = this.supportGraph();
    const towerBodies = supportGraph.bodies;
    this.updateStructuralStress(supportGraph, delta);
    if (this.status === "failed") return;
    if (this.level.wind > 0 && towerBodies.length > 0) {
      const phase = Math.sin(this.elapsed / 850) + Math.sin(this.elapsed / 1600) * 0.55;
      towerBodies.forEach((body) => {
        const aboveBase = Math.max(0, BASE_Y - body.position.y) / 240;
        if (aboveBase > 0.22) {
          Body.applyForce(body, body.position, { x: phase * this.level.wind * body.mass * aboveBase, y: 0 });
        }
      });
    }

    const currentHeight = this.measureHeight(supportGraph.bodies);
    this.height = currentHeight;
    if (this.status === "building" && currentHeight > this.cameraAutoFollowPeakHeight + 0.35) {
      // A downward manual inspection must not hide newly added material. Once
      // the tower grows, the automatic camera regains priority and follows it.
      this.cameraManualOffsetY = Math.max(0, this.cameraManualOffsetY);
      this.cameraAutoFollowPeakHeight = currentHeight;
    }
    const settledBodies = this.dynamicBodies.filter((body) => !this.isFallen(body));
    const stable = !this.adjusting && towerBodies.length > 0 && settledBodies.every((body) => body.speed < 0.25 && Math.abs(body.angularVelocity) < 0.025);
    if (stable) {
      this.stableElapsed += delta;
      if (this.stableElapsed > 620) this.stableHeight = Math.max(this.stableHeight, currentHeight);
    } else {
      this.stableElapsed = 0;
    }

    const meaningfulCollapse = this.stableHeight > Math.max(5, this.level.target * 0.34)
      && currentHeight < this.stableHeight * 0.63;
    if (meaningfulCollapse) {
      this.collapseElapsed += delta;
      if (this.collapseElapsed > 720) {
        this.fail(isClimbing
          ? "机器人向上攀爬时，移动载荷让塔的重心越过了支撑范围，垃圾堆整体倒塌。把较重、较宽的物件放在下方并对齐重心，再挑战一次，你可以做到！"
          : undefined);
      }
    } else {
      this.collapseElapsed = 0;
    }

    if (isClimbing) return;
    const hasRealStack = towerBodies.some((body) => (supportGraph.depth.get(body) ?? 0) >= 2);
    if (this.hasReachedBasket(towerBodies, supportGraph.depth) && hasRealStack && stable && this.stableElapsed > 1250) this.activateLight();
  }

  private towerBodies() {
    return this.supportGraph().bodies;
  }

  private hasReachedBasket(towerBodies: TaggedBody[], depth: Map<TaggedBody, number>) {
    const reachableTop = towerBodies
      .filter((body) => (depth.get(body) ?? 0) >= 2)
      .filter((body) => body.bounds.max.x >= GOAL_BASKET_X - GOAL_REACH_HALF_WIDTH && body.bounds.min.x <= GOAL_BASKET_X + GOAL_REACH_HALF_WIDTH)
      .sort((a, b) => a.bounds.min.y - b.bounds.min.y)[0];
    return Boolean(reachableTop && reachableTop.bounds.min.y <= GOAL_REACH_Y);
  }

  private supportGraph() {
    const candidates = this.dynamicBodies.filter((body) => !this.isFallen(body));
    const depth = new Map<TaggedBody, number>();
    const firstBody = this.dynamicBodies.find((body) => !this.isFallen(body));
    if (
      firstBody
      && firstBody.bounds.max.y >= BASE_Y - 7
      && firstBody.bounds.min.y <= BASE_Y + 18
    ) depth.set(firstBody, 1);

    let changed = true;
    while (changed) {
      changed = false;
      candidates.forEach((body) => {
        let bodyDepth = depth.get(body) ?? 0;
        depth.forEach((supportDepth, support) => {
          if (support === body || !this.isRestingOn(body, support)) return;
          const nextDepth = supportDepth + 1;
          if (nextDepth > bodyDepth) {
            bodyDepth = nextDepth;
            depth.set(body, nextDepth);
            changed = true;
          }
        });
      });
    }
    return { bodies: [...depth.keys()], depth };
  }

  private updateStructuralStress(
    graph: { bodies: TaggedBody[]; depth: Map<TaggedBody, number> },
    delta: number,
  ) {
    const { bodies, depth } = graph;
    if (!bodies.length) return;
    const carriedKg = new Map<TaggedBody, number>();
    const loadAboveKg = new Map<TaggedBody, number>();
    bodies.forEach((body) => {
      const item = body.gameItem;
      carriedKg.set(body, item ? ITEM_PHYSICS[item.id].massKg : 0);
    });

    // The robot is a moving payload. Its calibrated mass is added to the exact piece
    // currently carrying its feet/hands, then propagated through every lower
    // support just like the mass of the junk above it.
    if (this.status === "activating") {
      const route = this.climbRoute();
      if (route.length >= 2) {
        const support = this.robotClimbPose(route).anchor.support;
        carriedKg.set(
          support,
          (carriedKg.get(support) ?? 0) + ROBOT_PHYSICS.massKg * ROBOT_CLIMB_LOAD_MULTIPLIER,
        );
      }
    }

    [...bodies]
      .sort((a, b) => (depth.get(b) ?? 0) - (depth.get(a) ?? 0))
      .forEach((body) => {
        const item = body.gameItem;
        if (!item) return;
        const ownKg = ITEM_PHYSICS[item.id].massKg;
        const totalKg = Math.max(ownKg, carriedKg.get(body) ?? ownKg);
        loadAboveKg.set(body, Math.max(0, totalKg - ownKg));
        const bodyDepth = depth.get(body) ?? 0;
        if (bodyDepth <= 1) return;
        const supports = bodies.filter((support) =>
          (depth.get(support) ?? 0) === bodyDepth - 1 && this.isRestingOn(body, support));
        if (!supports.length) return;
        const overlaps = supports.map((support) => Math.max(1,
          Math.min(body.bounds.max.x, support.bounds.max.x) - Math.max(body.bounds.min.x, support.bounds.min.x)));
        const totalOverlap = overlaps.reduce((sum, overlap) => sum + overlap, 0);
        supports.forEach((support, index) => {
          const share = overlaps[index] / Math.max(1, totalOverlap);
          carriedKg.set(support, (carriedKg.get(support) ?? 0) + totalKg * share);
        });
      });

    bodies.forEach((body) => {
      const item = body.gameItem;
      if (!item) return;
      const physics = ITEM_PHYSICS[item.id];
      const strengthenedCapacityKg = physics.safeLoadKg * STRENGTH_MULTIPLIER;
      const loadKg = loadAboveKg.get(body) ?? 0;
      const stressRatio = loadKg / Math.max(1, strengthenedCapacityKg);
      const overload = Math.max(0, stressRatio - 1);
      let damage = body.gameStressDamage ?? 0;
      if (overload > 0) {
        this.audio.strain(overload + damage);
        damage += delta * (0.0002 + overload * 0.00055) * (1.08 - physics.flexibility * 0.18);
      } else if (!body.gameFracturedAt) {
        damage = Math.max(0, damage - delta * 0.00006);
      }
      const deformation = clamp(
        (damage * 0.72 + overload * 0.2) * (0.38 + physics.flexibility * 0.8),
        0,
        1,
      );
      body.gameStressRatio = stressRatio;
      body.gameStressDamage = damage;
      body.gameDeformation = Math.max(body.gameFracturedAt ? 0.72 : 0, deformation);
      if (!body.gameBendDirection) body.gameBendDirection = body.position.x < BASE_X ? -1 : 1;

      const weakened = 1 - body.gameDeformation * 0.68;
      body.friction = Math.max(0.12, item.friction * weakened);
      body.frictionStatic = Math.max(0.16, item.frictionStatic * weakened);
      if (body.gameBaseInertia && Number.isFinite(body.gameBaseInertia)) {
        Body.setInertia(body, Math.max(body.gameBaseInertia * 0.28, body.gameBaseInertia * weakened));
      }

      if (overload > 0) {
        Matter.Sleeping.set(body, false);
        const direction = body.gameBendDirection;
        const halfWidth = (body.bounds.max.x - body.bounds.min.x) / 2;
        Body.applyForce(
          body,
          { x: body.position.x - direction * halfWidth * 0.42, y: body.bounds.min.y + 4 },
          { x: direction * body.mass * 0.000025 * Math.min(3, overload + 0.2), y: 0 },
        );
      }

      if (damage < 1) return;
      if (!body.gameFracturedAt) body.gameFracturedAt = this.elapsed;
      const direction = body.gameBendDirection;
      Body.setAngularVelocity(body, body.angularVelocity + direction * 0.0024 * Math.min(2.2, Math.max(1, stressRatio)));
      if (this.elapsed - body.gameFracturedAt < 900) return;
      const shownLoad = Math.max(10, Math.round(loadKg / 10) * 10);
      const shownCapacity = Math.round(strengthenedCapacityKg / 10) * 10;
      this.fail(
        `「${item.name}」承受约 ${shownLoad} kg，超过强化承重 ${shownCapacity} kg，${physics.failureLabel}，最终引发垮塌。换用更宽、更强的材料分担载荷，再试一次，你已经掌握关键了！`,
      );
    });
  }

  private isRestingOn(body: TaggedBody, support: TaggedBody) {
    const overlap = Math.min(body.bounds.max.x, support.bounds.max.x) - Math.max(body.bounds.min.x, support.bounds.min.x);
    const narrowest = Math.min(body.bounds.max.x - body.bounds.min.x, support.bounds.max.x - support.bounds.min.x);
    const verticalGap = support.bounds.min.y - body.bounds.max.y;
    return body.position.y < support.position.y - 2
      && overlap >= Math.max(4, narrowest * 0.32)
      // The small tolerance is intentionally tighter than Matter's default
      // resting slop: a stack now reads as physically touching instead of
      // showing a visible gap between two connected props.
      && verticalGap >= -4
      && verticalGap <= 7;
  }

  private isFallen(body: Matter.Body) {
    const dropZone = this.dropZoneWorldBounds();
    return body.position.y > BASE_Y + 62 || body.position.x < dropZone.left - 42 || body.position.x > dropZone.right + 42;
  }

  private measureHeight(tower = this.towerBodies()) {
    if (!tower.length) return 0;
    const top = Math.min(...tower.map((body) => body.bounds.min.y));
    return Math.max(0, (BASE_Y - top) / PIXELS_PER_METER);
  }

  private activateLight() {
    if (this.status !== "building") return;
    this.status = "activating";
    this.activationAt = this.elapsed;
    this.lastRobotAudioStep = -1;
    this.dynamicBodies.forEach((body) => Matter.Sleeping.set(body, false));
    // Start the cinematic at ground level even if the player was inspecting
    // the top of the tower, then hand control to the robot-follow camera.
    this.cameraManualOffsetY = 0;
    this.cameraOffsetY = VIEW_GROUND_CAMERA;
    this.message = "废料塔已抵达吊篮下沿，攀爬助手开始登塔。";
    this.emit(true);
  }

  private finishClear() {
    if (this.status !== "activating") return;
    this.status = "cleared";
    this.message = "攀爬助手已抵达 99 米，胜利已经锁定。";
    this.onClear();
    this.emit(true);
  }

  private robotHasReachedGoal() {
    if (this.status !== "activating") return false;
    const route = this.climbRoute();
    if (route.length < 2) return false;
    return this.robotClimbPose(route).anchor.y <= GOAL_REACH_Y;
  }

  private fail(reason = "塔身失去支撑并整体倒塌。把宽重物件放在底部、让重心保持居中，再试一次，你一定能搭得更稳！") {
    if (this.status !== "building" && this.status !== "activating") return;
    this.status = "failed";
    this.audio.failure();
    this.message = reason;
    this.emit(true);
  }

  private clientToWorld(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: this.viewportWorldLeft + ((clientX - rect.left) / Math.max(1, rect.width)) * this.viewportWorldWidth,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * WORLD_HEIGHT - this.cameraOffsetY,
    };
  }

  private dropZoneClientBounds() {
    const canvasRect = this.canvas.getBoundingClientRect();
    const inventory = this.canvas.parentElement?.querySelector<HTMLElement>(".inventory-panel");
    const inventoryRect = inventory?.getBoundingClientRect();
    const inventoryOverlaysCanvas = inventoryRect
      && inventoryRect.left < canvasRect.right
      && inventoryRect.right > canvasRect.left
      && inventoryRect.top < canvasRect.bottom
      && inventoryRect.bottom > canvasRect.top;
    return {
      left: canvasRect.left,
      right: inventoryOverlaysCanvas ? Math.max(canvasRect.left, inventoryRect.left - 7) : canvasRect.right,
      top: canvasRect.top,
      bottom: canvasRect.bottom,
      canvasRect,
    };
  }

  private dropZoneWorldBounds() {
    const bounds = this.dropZoneClientBounds();
    const toWorldX = (clientX: number) => this.viewportWorldLeft
      + ((clientX - bounds.canvasRect.left) / Math.max(1, bounds.canvasRect.width)) * this.viewportWorldWidth;
    return { left: toWorldX(bounds.left), right: toWorldX(bounds.right) };
  }

  private isClientInsideDropZone(clientX: number, clientY: number) {
    const bounds = this.dropZoneClientBounds();
    return clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom;
  }

  panCamera(screenDeltaY: number) {
    if (!Number.isFinite(screenDeltaY)) return;
    if (this.status === "activating" || this.status === "cleared") return;
    const rect = this.canvas.getBoundingClientRect();
    const virtualDelta = -screenDeltaY / Math.max(0.1, rect.height / WORLD_HEIGHT);
    const automatic = this.automaticCameraOffset();
    const next = clamp(automatic + this.cameraManualOffsetY + virtualDelta, MIN_CAMERA_OFFSET, MAX_CAMERA_OFFSET);
    this.cameraManualOffsetY = next - automatic;
    this.cameraOffsetY = next;
  }

  private activationProgress() {
    if (this.status === "building" || this.status === "failed") return 0;
    const route = this.climbRoute();
    if (route.length < 2) return 0;
    const { anchor } = this.robotClimbPose(route);
    return clamp((BASE_Y - anchor.y) / (BASE_Y - GOAL_REACH_Y), 0, 1);
  }

  private emit(force = false) {
    if (!force && this.status === "building" && this.lastUiUpdate === 0) return;
    this.onUpdate({
      status: this.status,
      height: this.height,
      stableHeight: this.stableHeight,
      hintsLeft: this.hintsLeft,
      inventory: { ...this.inventory },
      heldItem: this.held?.itemId ?? null,
      hint: this.activeHint,
      message: this.message,
      wind: this.level.wind,
      activationProgress: this.activationProgress(),
    });
  }

  private render() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    // Use one uniform scene scale at every aspect ratio. The phone viewport
    // keeps the original 720 x 1000 framing; wider desktop windows reveal
    // more of the environment instead of stretching the front-facing props.
    const scale = rect.height / WORLD_HEIGHT;
    this.viewportWorldWidth = rect.width / Math.max(scale, 0.001);
    this.viewportWorldLeft = BASE_X - this.viewportWorldWidth / 2;
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.setTransform(dpr * scale, 0, 0, dpr * scale, -this.viewportWorldLeft * dpr * scale, 0);
    this.updateCamera();

    const activating = this.status === "activating" || this.status === "cleared";
    const illuminate = activating
      ? clamp((this.elapsed - this.activationAt - ROBOT_CLIMB_DURATION - 900) / 1300, 0, 1)
      : 0;
    this.context.save();
    this.context.translate(0, this.cameraOffsetY);
    this.drawScene(illuminate);
    this.drawWorld();
    this.context.restore();
  }

  private updateCamera() {
    const target = clamp(this.automaticCameraOffset() + this.cameraManualOffsetY, MIN_CAMERA_OFFSET, MAX_CAMERA_OFFSET);
    const easing = target > this.cameraOffsetY ? 0.075 : 0.12;
    this.cameraOffsetY += (target - this.cameraOffsetY) * easing;
    if (Math.abs(target - this.cameraOffsetY) < 0.05) this.cameraOffsetY = target;
  }

  private automaticCameraOffset() {
    if (this.status === "activating" || this.status === "cleared") {
      const route = this.climbRoute();
      if (route.length >= 2) {
        const { anchor } = this.robotClimbPose(route);
        const ascent = clamp((BASE_Y - anchor.y) / (BASE_Y - GOAL_REACH_Y), 0, 1);
        return clamp(
          VIEW_GROUND_CAMERA + (MAX_CAMERA_OFFSET - VIEW_GROUND_CAMERA) * smoothStep(ascent),
          MIN_CAMERA_OFFSET,
          MAX_CAMERA_OFFSET,
        );
      }
      return VIEW_GROUND_CAMERA;
    }
    // Keep the physical crown comfortably below the top edge. During the last
    // seven metres, reveal the complete crane rig as well so reaching 99 m
    // never leaves the basket, flower or their support cropped off-screen.
    const height = clamp(this.height, 0, GOAL_REACH_HEIGHT);
    const towerTopY = BASE_Y - height * PIXELS_PER_METER;
    const towerFollowOffset = clamp(260 - towerTopY, VIEW_GROUND_CAMERA, MAX_CAMERA_OFFSET);
    const goalReveal = smoothStep((height - 92) / (GOAL_REACH_HEIGHT - 92));
    return clamp(
      towerFollowOffset + (MAX_CAMERA_OFFSET - towerFollowOffset) * goalReveal,
      MIN_CAMERA_OFFSET,
      MAX_CAMERA_OFFSET,
    );
  }

  private imageReady(image: HTMLImageElement) {
    return image.complete && image.naturalWidth > 0;
  }

  private drawScene(illuminate: number) {
    const ctx = this.context;
    const polluted = this.artwork.polluted;
    const revived = this.artwork.revived;

    this.drawFallbackSky(illuminate);
    if (this.imageReady(polluted)) {
      ctx.globalAlpha = 0.96;
      this.drawLongBackdrop(polluted);
      ctx.globalAlpha = 1;
    }
    if (illuminate > 0 && this.imageReady(revived)) {
      ctx.save();
      ctx.globalAlpha = illuminate;
      this.drawLongBackdrop(revived);
      ctx.restore();
    }

    ctx.fillStyle = `rgba(5, 13, 15, ${0.22 - illuminate * 0.14})`;
    ctx.fillRect(this.viewportWorldLeft, BACKDROP_SKY_TOP, this.viewportWorldWidth, BACKDROP_BOTTOM - BACKDROP_SKY_TOP);

    // Sunlight exists only around the 99 m goal. From the ground this entire
    // world-space band is above the viewport; it is revealed naturally as the
    // player climbs and pans upward.
    this.drawGoalSkylight(illuminate);

    if (this.imageReady(this.artwork.debris)) {
      ctx.save();
      ctx.globalAlpha = 0.94 - illuminate * 0.2;
      this.drawResponsiveGroundDebris(this.artwork.debris);
      ctx.restore();
    }
    this.drawGoalRig(this.activationProgress());
    this.drawGrowth(illuminate, this.elapsed);

  }

  private drawGoalSkylight(illuminate: number) {
    const ctx = this.context;
    const focusX = GOAL_BASKET_X;
    const focusY = GOAL_BASKET_Y + 18;
    const beamTopY = BACKDROP_SKY_TOP - 24;
    const beamBottomY = focusY + 66;
    // A small lateral drift suggests moving haze rather than a mechanical
    // spotlight. The light remains present before success because 99 m is the
    // first altitude where sunlight reaches this world.
    const sourceX = focusX - 72 + Math.sin(this.elapsed / 3100) * 4;
    const pulse = 0.96 + Math.sin(this.elapsed / 1500) * 0.04;
    const strength = (0.12 + illuminate * 0.13) * pulse;

    ctx.save();
    ctx.globalCompositeOperation = "screen";

    // A broad, blurred atmospheric veil is the body of the Tyndall effect.
    // Its edges deliberately dissolve into the polluted air.
    ctx.save();
    ctx.filter = "blur(18px)";
    const veil = ctx.createLinearGradient(sourceX, beamTopY, focusX, beamBottomY);
    veil.addColorStop(0, "rgba(255, 252, 226, 0)");
    veil.addColorStop(0.16, `rgba(255, 248, 213, ${strength * 0.34})`);
    veil.addColorStop(0.7, `rgba(255, 235, 173, ${strength * 0.54})`);
    veil.addColorStop(1, "rgba(255, 224, 143, 0)");
    ctx.fillStyle = veil;
    ctx.beginPath();
    ctx.moveTo(sourceX - 34, beamTopY);
    ctx.lineTo(sourceX + 44, beamTopY);
    ctx.lineTo(focusX + 106, beamBottomY);
    ctx.lineTo(focusX - 92, beamBottomY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Several unequally spaced shafts make the light feel filtered through
    // broken cloud and suspended dust instead of drawn as one solid cone.
    const shafts = [
      { start: -31, end: -48, topWidth: 5, bottomWidth: 18, opacity: 0.62 },
      { start: -12, end: -15, topWidth: 8, bottomWidth: 25, opacity: 0.82 },
      { start: 9, end: 24, topWidth: 4, bottomWidth: 16, opacity: 0.48 },
      { start: 27, end: 51, topWidth: 6, bottomWidth: 22, opacity: 0.68 },
    ];
    for (const shaft of shafts) {
      const startX = sourceX + shaft.start;
      const endX = focusX + shaft.end;
      const ray = ctx.createLinearGradient(startX, beamTopY, endX, beamBottomY);
      ray.addColorStop(0, "rgba(255, 253, 231, 0)");
      ray.addColorStop(0.12, `rgba(255, 250, 221, ${strength * shaft.opacity})`);
      ray.addColorStop(0.72, `rgba(255, 237, 184, ${strength * shaft.opacity * 0.86})`);
      ray.addColorStop(1, "rgba(255, 225, 151, 0)");
      ctx.save();
      ctx.filter = "blur(4px)";
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(startX - shaft.topWidth, beamTopY);
      ctx.lineTo(startX + shaft.topWidth, beamTopY);
      ctx.lineTo(endX + shaft.bottomWidth, beamBottomY);
      ctx.lineTo(endX - shaft.bottomWidth, beamBottomY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // A low, elliptical pool connects the rays to the flower without looking
    // like a circular UI halo.
    const halo = ctx.createRadialGradient(0, 0, 1, 0, 0, 58);
    halo.addColorStop(0, `rgba(255, 246, 190, ${0.22 + illuminate * 0.12})`);
    halo.addColorStop(0.46, `rgba(244, 232, 167, ${0.09 + illuminate * 0.07})`);
    halo.addColorStop(1, "rgba(225, 231, 171, 0)");
    ctx.save();
    ctx.translate(focusX, focusY);
    ctx.scale(1.45, 0.58);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Deterministic drifting dust keeps the effect alive without allocating
    // particles or introducing frame-rate-dependent simulation state.
    for (let index = 0; index < 19; index += 1) {
      const travel = ((this.elapsed * (0.008 + index * 0.00033) + index * 41) % 240) / 240;
      const y = beamBottomY - travel * (beamBottomY - beamTopY);
      const centerX = focusX + (sourceX - focusX) * travel;
      const spread = 24 + (1 - travel) * 58;
      const x = centerX + Math.sin(index * 4.13 + this.elapsed / 920) * spread;
      const alpha = Math.sin(travel * Math.PI) * (0.1 + illuminate * 0.055);
      ctx.fillStyle = `rgba(255, 242, 188, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.55 + (index % 3) * 0.36, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawLongBackdrop(image: HTMLImageElement) {
    const ctx = this.context;
    const areaWidth = this.viewportWorldWidth;
    const areaHeight = BACKDROP_BOTTOM - BACKDROP_SKY_TOP;
    // Portrait screens still use cover cropping. On desktop, map a wider field
    // of view into the same world so the refinery remains background scale
    // instead of competing with the real-size draggable props.
    const sourceAspect = image.naturalWidth / image.naturalHeight;
    const areaAspect = areaWidth / areaHeight;
    let renderedWidth = areaWidth;
    let renderedHeight = areaWidth / sourceAspect;
    if (areaWidth >= WORLD_WIDTH * 1.3) {
      renderedHeight = Math.max(WORLD_HEIGHT + 120, (areaWidth * 1.06) / sourceAspect);
      renderedWidth = renderedHeight * sourceAspect;
    } else if (areaAspect < sourceAspect) {
      renderedHeight = areaHeight;
      renderedWidth = areaHeight * sourceAspect;
    }
    // Ground remains pinned to the physical floor and the image now covers the
    // sky range directly, so no generated extension or dark strip is needed.
    const renderedX = BASE_X - renderedWidth / 2;
    const renderedY = BACKDROP_BOTTOM - renderedHeight;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.viewportWorldLeft, BACKDROP_SKY_TOP, areaWidth, BACKDROP_BOTTOM - BACKDROP_SKY_TOP);
    ctx.clip();
    ctx.drawImage(image, renderedX, renderedY, renderedWidth, renderedHeight);
    ctx.restore();
  }

  private drawResponsiveGroundDebris(image: HTMLImageElement) {
    const ctx = this.context;
    // The source was authored as a 720-world-unit foreground strip. Preserve
    // that scale on narrow screens; on wider screens split it at its empty
    // centre and pin each half to an outer edge. The heaps move apart instead
    // of being stretched wider.
    const renderedHeight = 240;
    const renderedWidth = image.naturalWidth * (renderedHeight / image.naturalHeight);
    const y = BACKDROP_BOTTOM - renderedHeight;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.viewportWorldLeft, y, this.viewportWorldWidth, renderedHeight);
    ctx.clip();

    if (this.viewportWorldWidth <= renderedWidth) {
      ctx.drawImage(image, BASE_X - renderedWidth / 2, y, renderedWidth, renderedHeight);
    } else {
      const sourceHalfWidth = image.naturalWidth / 2;
      const renderedHalfWidth = renderedWidth / 2;
      ctx.drawImage(
        image,
        0,
        0,
        sourceHalfWidth,
        image.naturalHeight,
        this.viewportWorldLeft,
        y,
        renderedHalfWidth,
        renderedHeight,
      );
      ctx.drawImage(
        image,
        sourceHalfWidth,
        0,
        sourceHalfWidth,
        image.naturalHeight,
        this.viewportWorldLeft + this.viewportWorldWidth - renderedHalfWidth,
        y,
        renderedHalfWidth,
        renderedHeight,
      );
    }
    ctx.restore();
  }

  private drawFallbackSky(illuminate: number) {
    const ctx = this.context;
    const sky = ctx.createLinearGradient(0, BACKDROP_SKY_TOP, 0, BACKDROP_BOTTOM);
    sky.addColorStop(0, colorMix([26, 46, 49], [99, 177, 195], illuminate));
    sky.addColorStop(0.62, colorMix([47, 63, 60], [201, 227, 192], illuminate));
    sky.addColorStop(1, colorMix([67, 71, 63], [111, 166, 97], illuminate));
    ctx.fillStyle = sky;
    ctx.fillRect(this.viewportWorldLeft, BACKDROP_SKY_TOP, this.viewportWorldWidth, BACKDROP_BOTTOM - BACKDROP_SKY_TOP);
  }

  private drawGrowth(illuminate: number, now: number) {
    if (illuminate <= 0.03) return;
    const ctx = this.context;
    ctx.save();
    ctx.globalAlpha = Math.min(0.78, illuminate * 0.92);
    ctx.strokeStyle = "#79b55c";
    ctx.lineWidth = 2;
    for (let x = 18; x < WORLD_WIDTH; x += 27) {
      const progress = clamp((illuminate - ((x % 95) / 1600)) * 1.4, 0, 1);
      if (progress <= 0) continue;
      const baseY = BASE_Y + 10;
      const stem = 5 + progress * 11;
      const sway = Math.sin((x + now / 12) / 31) * 3;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.quadraticCurveTo(x + sway, baseY - stem * 0.55, x + sway * 0.75, baseY - stem);
      ctx.stroke();
      ctx.strokeStyle = "#a6d879";
      ctx.beginPath();
      ctx.moveTo(x + sway * 0.5, baseY - stem * 0.55);
      ctx.lineTo(x + sway + 4, baseY - stem * 0.7);
      ctx.stroke();
      ctx.strokeStyle = "#79b55c";
    }
    ctx.restore();
  }

  private drawGoalRig(collectProgress: number) {
    const ctx = this.context;
    const basketX = GOAL_BASKET_X;
    const basketY = GOAL_BASKET_Y;
    const boomY = basketY - 180;
    ctx.save();
    ctx.strokeStyle = "rgba(41, 50, 49, 0.94)";
    ctx.lineWidth = 13;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(this.viewportWorldLeft - 30, boomY);
    ctx.lineTo(basketX + 4, boomY);
    ctx.stroke();
    ctx.strokeStyle = "rgba(102, 106, 92, 0.52)";
    ctx.lineWidth = 2;
    for (let x = this.viewportWorldLeft + 18; x < basketX - 24; x += 62) {
      ctx.beginPath();
      ctx.moveTo(x, boomY + 7);
      ctx.lineTo(x + 32, boomY + 37);
      ctx.lineTo(x + 62, boomY + 7);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(27, 34, 33, 0.92)";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(basketX, boomY + 5);
    ctx.lineTo(basketX, basketY - 78);
    ctx.stroke();
    if (this.imageReady(this.artwork.goal)) {
      ctx.drawImage(this.artwork.goal, basketX - 77, basketY - 86, 154, 172);
    } else {
      ctx.strokeStyle = "rgba(137, 133, 100, 0.92)";
      ctx.lineWidth = 3;
      ctx.strokeRect(basketX - 38, basketY - 18, 76, 44);
      ctx.strokeStyle = "#7eb65d";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(basketX, basketY - 17);
      ctx.quadraticCurveTo(basketX - 4, basketY - 42, basketX + 2, basketY - 56);
      ctx.stroke();
      ctx.fillStyle = "#d6df8e";
      ctx.beginPath();
      ctx.arc(basketX + 2, basketY - 60, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // A long, slightly swaying rescue rope gives the suspended basket a clear
    // vertical connection that remains visible in the same phone viewport.
    const ropeStartY = basketY + 56;
    const ropeEndY = basketY + 610;
    const ropeSway = Math.sin(this.elapsed / 760) * 5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(29, 28, 23, 0.92)";
    ctx.lineWidth = 5.4;
    ctx.beginPath();
    ctx.moveTo(basketX + 10, ropeStartY);
    ctx.bezierCurveTo(basketX + 8 + ropeSway, basketY + 205, basketX - 4 - ropeSway, basketY + 425, basketX + ropeSway, ropeEndY);
    ctx.stroke();
    ctx.strokeStyle = "rgba(169, 143, 94, 0.74)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(basketX + 10, ropeStartY);
    ctx.bezierCurveTo(basketX + 8 + ropeSway, basketY + 205, basketX - 4 - ropeSway, basketY + 425, basketX + ropeSway, ropeEndY);
    ctx.stroke();
    ctx.fillStyle = "rgba(74, 62, 40, 0.96)";
    ctx.beginPath();
    ctx.arc(basketX + ropeSway, ropeEndY + 3, 4.5, 0, Math.PI * 2);
    ctx.fill();
    const collectStart = ROBOT_CLIMB_DURATION / ACTIVATION_DURATION;
    if (collectProgress > collectStart) {
      const glow = ctx.createRadialGradient(basketX, basketY - 51, 1, basketX, basketY - 51, 24);
      glow.addColorStop(0, `rgba(211, 243, 150, ${Math.min(0.35, (collectProgress - collectStart) * 2.2)})`);
      glow.addColorStop(1, "rgba(211, 243, 150, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(basketX, basketY - 51, 24, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawWorld() {
    this.dynamicBodies.forEach((body) => this.drawItem(body));
    if (this.held) this.drawGhost(this.held);

    if (this.status === "activating" || this.status === "cleared") {
      // The scene itself cross-fades from polluted to revived. A previous
      // fixed-width yellow wash exposed hard vertical edges on wide screens
      // and made the transition feel artificial, so the colour block is gone.
      this.drawSuccessRobot();
    }
  }

  private drawSuccessRobot() {
    const basketX = GOAL_BASKET_X;
    const basketY = GOAL_BASKET_Y;
    const route = this.climbRoute();
    if (route.length < 2) return;
    const pose = this.robotClimbPose(route);

    // The six-frame climb is 30% larger, with each reach/pull beat tied to a
    // physical route segment and shared with the load simulation below.
    const transition = smoothStep((pose.sequenceElapsed - (ROBOT_CLIMB_DURATION - 500)) / 700);
    this.drawRobotFrame(
      this.artwork.robotClimb,
      6,
      1,
      pose.frame,
      pose.anchor.x,
      pose.anchor.y + 7,
      ROBOT_CLIMB_HEIGHT,
      1 - transition,
    );

    if (transition <= 0) return;

    // At the basket the ten-frame picking sequence takes over. The first frame
    // cross-fades with the climb cycle so there is no visual pop between the
    // two independently extracted action strips.
    const pluckProgress = smoothStep((pose.sequenceElapsed - ROBOT_CLIMB_DURATION) / ROBOT_PLUCK_DURATION);
    const pluckFrame = Math.min(9, Math.floor(pluckProgress * 10));
    const finalAnchor = { x: basketX - 30, y: basketY + 31 };
    this.drawRobotFrame(this.artwork.robotPluck, 5, 2, pluckFrame, finalAnchor.x, finalAnchor.y, ROBOT_PLUCK_HEIGHT, transition);

    if (pluckProgress < 0.72) return;
    const collect = smoothStep((pluckProgress - 0.72) / 0.28);
    this.drawCollectedSprout(
      basketX - 5 - collect * 11,
      basketY - 50 + collect * 16,
      0.48 + collect * 0.08,
    );
  }

  private robotClimbPose(route: ClimbPoint[]) {
    const sequenceElapsed = Math.max(0, this.elapsed - this.activationAt);
    const climb = smoothStep((sequenceElapsed - 260) / (ROBOT_CLIMB_DURATION - 520));
    const routePosition = climb * (route.length - 1);
    const routeIndex = Math.min(route.length - 2, Math.max(0, Math.floor(routePosition)));
    const localStep = routePosition - routeIndex;
    const from = route[routeIndex] ?? route[0];
    const to = route[routeIndex + 1] ?? from;
    // Hold the current grip briefly, pull through the middle of the motion,
    // then settle both feet before starting the next reach. This removes the
    // old constant-rate floating sensation at the slower climb speed.
    const actionStep = clamp((localStep - 0.12) / 0.76, 0, 1);
    const travel = smoothStep(actionStep);
    const anchor: ClimbPoint = {
      x: from.x + (to.x - from.x) * travel,
      y: from.y + (to.y - from.y) * travel - Math.sin(actionStep * Math.PI) * 3.4,
      support: localStep < 0.52 ? from.support : to.support,
    };
    const frameProgress = clamp((localStep - 0.05) / 0.9, 0, 0.999);
    const frame = climb >= 0.995
      ? 5
      : routeIndex === 0
        ? Math.min(5, Math.floor(frameProgress * 6))
        : 2 + Math.min(3, Math.floor(frameProgress * 4));
    return { anchor, climb, frame, routePosition, routeIndex, sequenceElapsed };
  }

  private applyRobotWeight() {
    const route = this.climbRoute();
    if (route.length < 2) return;
    const pose = this.robotClimbPose(route);
    const support = pose.anchor.support;
    if (pose.routeIndex !== this.lastRobotAudioStep) {
      this.lastRobotAudioStep = pose.routeIndex;
      this.audio.robotStep(pose.routeIndex);
    }
    Matter.Sleeping.set(support, false);
    const gait = Math.sin(pose.routePosition * Math.PI * 2);
    const gravityScale = this.engine.gravity.scale || 0.001;
    const robotMatterMass = ROBOT_PHYSICS.massKg * PHYSICS_MASS_PER_KG * ROBOT_CLIMB_LOAD_MULTIPLIER;
    const gaitPulse = 1 + Math.abs(gait) * (0.16 - ROBOT_PHYSICS.flexibility * 0.08);
    const downwardForce = robotMatterMass * gravityScale * gaitPulse;
    const lateralForce = pose.sequenceElapsed < ROBOT_CLIMB_DURATION
      ? gait * robotMatterMass * gravityScale * (0.085 - ROBOT_PHYSICS.stability * 0.025)
      : 0;
    const contactPoint = {
      x: clamp(pose.anchor.x, support.bounds.min.x + 2, support.bounds.max.x - 2),
      y: clamp(pose.anchor.y, support.bounds.min.y + 2, support.bounds.max.y - 2),
    };
    Body.applyForce(support, contactPoint, { x: lateralForce, y: downwardForce });
  }

  private drawRobotFrame(
    sheet: HTMLImageElement,
    columns: number,
    rows: number,
    frame: number,
    centerX: number,
    footY: number,
    targetHeight: number,
    alpha = 1,
  ) {
    if (!sheet.complete || sheet.naturalWidth <= 0 || alpha <= 0) return;
    const cellWidth = sheet.naturalWidth / columns;
    const cellHeight = sheet.naturalHeight / rows;
    const column = frame % columns;
    const row = Math.floor(frame / columns);
    const drawWidth = targetHeight * (cellWidth / cellHeight);
    const ctx = this.context;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.drawImage(
      sheet,
      column * cellWidth,
      row * cellHeight,
      cellWidth,
      cellHeight,
      centerX - drawWidth / 2,
      footY - targetHeight * 0.96,
      drawWidth,
      targetHeight,
    );
    ctx.restore();
  }

  private climbRoute() {
    const { bodies, depth } = this.supportGraph();
    const candidates = bodies
      .filter((body) => (depth.get(body) ?? 0) >= 2)
      .filter((body) => body.bounds.max.x >= GOAL_BASKET_X - GOAL_REACH_HALF_WIDTH && body.bounds.min.x <= GOAL_BASKET_X + GOAL_REACH_HALF_WIDTH)
      .sort((a, b) => a.bounds.min.y - b.bounds.min.y);
    let current = candidates[0];
    if (!current) return [] as ClimbPoint[];
    const chain = [current];
    while ((depth.get(current) ?? 0) > 1) {
      const currentDepth = depth.get(current) ?? 0;
      const support = bodies
        .filter((body) => (depth.get(body) ?? 0) === currentDepth - 1 && this.isRestingOn(current, body))
        .sort((a, b) => Math.abs(a.position.x - current.position.x) - Math.abs(b.position.x - current.position.x))[0];
      if (!support) break;
      chain.push(support);
      current = support;
    }
    const ordered = chain.reverse();
    const route: ClimbPoint[] = [];
    const appendSegment = (target: ClimbPoint) => {
      const from = route[route.length - 1];
      if (!from) {
        route.push(target);
        return;
      }
      const distance = Math.hypot(target.x - from.x, target.y - from.y);
      const segments = Math.max(1, Math.ceil(distance / 34));
      for (let index = 1; index <= segments; index += 1) {
        const amount = index / segments;
        route.push({
          x: from.x + (target.x - from.x) * amount,
          y: from.y + (target.y - from.y) * amount,
          support: target.support,
        });
      }
    };

    // Follow the left/front edge of every supported body. Breaking tall props
    // into reachable 34 px holds avoids the old visual of sliding up a cabinet
    // or container in one impossible stride.
    ordered.forEach((body, bodyIndex) => {
      const bodyWidth = body.bounds.max.x - body.bounds.min.x;
      const x = clamp(
        body.bounds.min.x + Math.min(18, bodyWidth * 0.28),
        body.bounds.min.x + 7,
        body.bounds.max.x - 7,
      );
      const bottomY = Math.min(BASE_Y - 4, body.bounds.max.y - 7);
      const topY = body.bounds.min.y + 6;
      if (bodyIndex === 0) appendSegment({ x, y: bottomY, support: body });
      else appendSegment({ x, y: Math.min(bottomY, route[route.length - 1].y), support: body });
      appendSegment({ x, y: topY, support: body });
    });

    // Once the pile reaches the lower rail, the last few holds belong to the
    // basket frame itself, giving the robot a believable path to the flower.
    const topSupport = ordered[ordered.length - 1];
    [
      { x: GOAL_BASKET_X - 44, y: GOAL_REACH_Y - 4, support: topSupport },
      { x: GOAL_BASKET_X - 42, y: GOAL_BASKET_Y + 58, support: topSupport },
      { x: GOAL_BASKET_X - 38, y: GOAL_BASKET_Y + 32, support: topSupport },
    ].forEach(appendSegment);
    return route;
  }

  private drawCollectedSprout(x: number, y: number, scale: number) {
    const ctx = this.context;
    ctx.save();
    ctx.strokeStyle = "#91c968";
    ctx.lineWidth = 1.8 * scale;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y + 11 * scale);
    ctx.quadraticCurveTo(x - 2 * scale, y + 3 * scale, x, y - 5 * scale);
    ctx.stroke();
    ctx.fillStyle = "#a8d976";
    ctx.beginPath();
    ctx.ellipse(x - 4 * scale, y + 2 * scale, 4 * scale, 1.8 * scale, -0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 3 * scale, y - 1 * scale, 4 * scale, 1.8 * scale, 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f1e79a";
    for (let petal = 0; petal < 5; petal += 1) {
      const angle = (petal / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(angle) * 3.1 * scale, y - 6 * scale + Math.sin(angle) * 3.1 * scale, 2.2 * scale, 1.5 * scale, angle, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#e1b86a";
    ctx.beginPath();
    ctx.arc(x, y - 6 * scale, 1.7 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawSceneRuler() {
    const ctx = this.context;
    const maximumMeters = 99;
    const rulerHeight = maximumMeters * PIXELS_PER_METER;
    const left = 20;
    const top = BASE_Y - rulerHeight - 14;
    const width = 82;

    ctx.save();
    ctx.fillStyle = "rgba(240, 246, 247, 0.11)";
    ctx.strokeStyle = "rgba(246, 250, 251, 0.42)";
    ctx.lineWidth = 1;
    roundedRect(ctx, left, top, width, rulerHeight + 28, 8);
    ctx.fill();
    ctx.stroke();
    const railX = left + 24;
    ctx.strokeStyle = "rgba(252, 255, 255, 0.72)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(railX, BASE_Y);
    ctx.lineTo(railX, BASE_Y - rulerHeight);
    ctx.stroke();

    for (let meter = 0; meter <= maximumMeters; meter += 1) {
      const y = BASE_Y - meter * PIXELS_PER_METER;
      const major = meter % 10 === 0 || meter === maximumMeters;
      const medium = meter % 5 === 0;
      ctx.strokeStyle = major ? "rgba(255, 255, 255, 0.86)" : "rgba(245, 251, 253, 0.46)";
      ctx.lineWidth = major ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(railX, y);
      ctx.lineTo(railX + (major ? 19 : medium ? 13 : 8), y);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = "rgba(250, 254, 255, 0.86)";
        ctx.font = "10px Microsoft YaHei";
        ctx.fillText(`${meter}m`, railX + 24, y + 3);
      }
    }

    const currentY = clamp(BASE_Y - this.height * PIXELS_PER_METER, BASE_Y - rulerHeight, BASE_Y);
    ctx.fillStyle = "rgba(216, 255, 210, 0.9)";
    ctx.fillRect(railX - 2, currentY - 1, 29, 3);
    ctx.restore();
  }

  private drawItem(body: TaggedBody) {
    const item = body.gameItem;
    if (!item) return;
    const ctx = this.context;
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    const deformation = body.gameDeformation ?? 0;
    const bendDirection = body.gameBendDirection ?? 1;
    if (item.shape === "circle") {
      ctx.scale(1 + deformation * 0.08, 1 - deformation * 0.1);
    } else if (deformation > 0) {
      ctx.transform(1, 0, bendDirection * deformation * 0.16, 1 - deformation * 0.065, 0, item.height * deformation * 0.025);
    }
    const drewArtwork = this.drawItemArtwork(item);
    if (!drewArtwork && item.shape === "circle") {
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(0, 0, item.width / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = item.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, item.width * 0.22, 0, Math.PI * 2);
      ctx.stroke();
    } else if (!drewArtwork) {
      ctx.fillStyle = item.color;
      roundedRect(ctx, -item.width / 2, -item.height / 2, item.width, item.height, Math.min(8, item.height / 3));
      ctx.fill();
      ctx.strokeStyle = "rgba(15, 27, 28, 0.5)";
      ctx.lineWidth = 2;
      roundedRect(ctx, -item.width / 2, -item.height / 2, item.width, item.height, Math.min(8, item.height / 3));
      ctx.stroke();
      ctx.fillStyle = item.accent;
      ctx.globalAlpha = 0.62;
      ctx.fillRect(-item.width / 2 + 7, -item.height / 2 + 6, Math.max(8, item.width - 14), Math.min(6, item.height / 5));
      ctx.globalAlpha = 1;
    }
    if (!drewArtwork && item.width >= 45 && item.height >= 25) {
      ctx.fillStyle = "rgba(246, 243, 219, 0.9)";
      ctx.font = `700 ${Math.min(16, Math.max(10, item.height * 0.34))}px Microsoft YaHei`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(item.shortName, 0, 1);
    }
    if (deformation > 0.18 && item.shape !== "circle") {
      ctx.globalAlpha = clamp((deformation - 0.18) * 1.45, 0, 0.78);
      ctx.strokeStyle = deformation > 0.72 ? "rgba(255, 171, 105, 0.9)" : "rgba(35, 30, 25, 0.9)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-item.width * 0.22, -item.height * 0.42);
      ctx.lineTo(-item.width * 0.06, -item.height * 0.12);
      ctx.lineTo(-item.width * 0.17, item.height * 0.08);
      ctx.moveTo(item.width * 0.18, -item.height * 0.34);
      ctx.lineTo(item.width * 0.04, item.height * 0.02);
      ctx.lineTo(item.width * 0.2, item.height * 0.28);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  private drawItemArtwork(item: ItemDefinition, opacity = 1) {
    const sprite = ITEM_ART[item.id];
    const image = sprite.asset === "junk-sprite-atlas.png"
      ? this.artwork.junk
      : sprite.asset === "risky-props.png"
        ? this.artwork.risky
        : this.artwork.monitor;
    if (!this.imageReady(image)) return false;
    const sourceWidth = image.naturalWidth / sprite.columns;
    const sourceHeight = image.naturalHeight / sprite.rows;
    const [left, top, right, bottom] = sprite.visibleBounds;
    const cropX = sprite.column * sourceWidth + sourceWidth * left;
    const cropY = sprite.row * sourceHeight + sourceHeight * top;
    const cropWidth = sourceWidth * (right - left);
    const cropHeight = sourceHeight * (bottom - top);
    // Map the tightly-trimmed artwork to the Matter body instead of to a
    // square atlas cell. A very small vertical overlap covers Matter's normal
    // contact slop, so two pieces that are physically touching also look
    // seamless rather than leaving a distracting transparent gap.
    const seamBleed = Math.min(1, Math.max(0.55, item.height * 0.012));
    const ctx = this.context;
    const previousAlpha = ctx.globalAlpha;
    const previousFilter = ctx.filter;
    ctx.globalAlpha = previousAlpha * opacity;
    // One material pass unifies the art set: every recovered object carries
    // soot, low saturation and a little oxidised age, even when the source
    // cutout is relatively clean.
    ctx.filter = "saturate(0.58) brightness(0.76) contrast(1.14) sepia(0.13)";
    ctx.drawImage(
      image,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      -item.width / 2,
      -item.height / 2 - seamBleed,
      item.width,
      item.height + seamBleed * 2,
    );
    ctx.globalAlpha = previousAlpha;
    ctx.filter = previousFilter;
    return true;
  }

  private drawGhost(held: HeldItem) {
    const item = ITEMS[held.itemId];
    const ctx = this.context;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.translate(held.x, held.y);
    ctx.rotate(held.angle);
    ctx.strokeStyle = "#c8f29b";
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    const drewArtwork = this.drawItemArtwork(item, 0.75);
    if (item.shape === "circle") {
      ctx.beginPath();
      ctx.arc(0, 0, item.width / 2, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      roundedRect(ctx, -item.width / 2, -item.height / 2, item.width, item.height, Math.min(8, item.height / 3));
      ctx.stroke();
    }
    if (!drewArtwork) {
      ctx.fillStyle = "rgba(171, 240, 138, 0.12)";
      ctx.fill();
    }
    ctx.restore();
  }

  private drawHint(hint: HintSpec) {
    const item = ITEMS[hint.itemId];
    const x = BASE_X + hint.xMeters * PIXELS_PER_METER;
    const y = BASE_Y - hint.yMeters * PIXELS_PER_METER;
    const ctx = this.context;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.translate(x, y);
    ctx.rotate(hint.rotation);
    ctx.fillStyle = "rgba(155, 239, 125, 0.25)";
    ctx.strokeStyle = "#b9f392";
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    const drewArtwork = this.drawItemArtwork(item, 0.38);
    if (item.shape === "circle") {
      ctx.beginPath();
      ctx.arc(0, 0, item.width / 2 + 4, 0, Math.PI * 2);
      if (!drewArtwork) ctx.fill();
      ctx.stroke();
    } else {
      roundedRect(ctx, -item.width / 2 - 4, -item.height / 2 - 4, item.width + 8, item.height + 8, 7);
      if (!drewArtwork) ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = "#d9f7b7";
    ctx.font = "700 13px Microsoft YaHei";
    ctx.fillText("提示落点", x + 10, y - item.height / 2 - 12);
  }

}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothStep(value: number) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function colorMix(from: [number, number, number], to: [number, number, number], amount: number) {
  const mix = (index: number) => Math.round(from[index] + (to[index] - from[index]) * amount);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

function materialThumbnailStyle(itemId: ItemId): CSSProperties {
  const sprite = ITEM_ICON_ART[itemId];
  if (itemId === "computer") {
    return {
      backgroundImage: "url(/assets/worn-monitor.png)",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundSize: "92% auto",
      filter: "saturate(.58) brightness(.76) contrast(1.14) sepia(.13)",
    };
  }
  const x = sprite.columns === 1 ? 0 : (sprite.column / (sprite.columns - 1)) * 100;
  const y = sprite.rows === 1 ? 0 : (sprite.row / (sprite.rows - 1)) * 100;
  const asset = sprite.asset === "front-prop-atlas.png" ? "front-prop-atlas-v2.png" : "front-risky-props-v2.png";
  return {
    backgroundImage: `url(/assets/${asset})`,
    backgroundPosition: `${x}% ${y}%`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${sprite.columns * 100}% ${sprite.rows * 100}%`,
    filter: "saturate(.58) brightness(.76) contrast(1.14) sepia(.13)",
  };
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

interface GameStageProps {
  level: LevelConfig;
  onExit: () => void;
  audio: GameAudio;
}

type ConfirmationAction = "reset" | "exit" | null;

function GameStage({ level, onExit, audio }: GameStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<TowerPhysicsGame | null>(null);
  const endingVideoRef = useRef<HTMLVideoElement>(null);
  const endingMusicRef = useRef<HTMLAudioElement>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() => initialSnapshot(level));
  const [confirmation, setConfirmation] = useState<ConfirmationAction>(null);
  const [endingPlaying, setEndingPlaying] = useState(false);
  const [endingComplete, setEndingComplete] = useState(false);
  const [endingNeedsGesture, setEndingNeedsGesture] = useState(false);
  const [endingReady, setEndingReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    audio.startGameplay();
    const game = new TowerPhysicsGame(canvas, level, setSnapshot, () => {
      audio.stopGameplay();
      setEndingComplete(false);
      setEndingNeedsGesture(false);
      setEndingReady(false);
      setEndingPlaying(true);
    }, audio);
    gameRef.current = game;
    game.start();
    return () => {
      game.destroy();
      audio.stopGameplay();
      gameRef.current = null;
    };
  }, [audio, level]);

  useEffect(() => {
    if (!confirmation) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmation(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmation]);

  useEffect(() => {
    if (!endingPlaying) return;
    const video = endingVideoRef.current;
    const soundtrack = endingMusicRef.current;
    if (!video || !soundtrack) return;
    video.currentTime = 0;
    soundtrack.currentTime = 0;
    soundtrack.volume = 1;
    void Promise.all([video.play(), soundtrack.play()]).catch(() => setEndingNeedsGesture(true));
  }, [endingPlaying]);

  const isInteractive = snapshot.status === "building";
  const availablePieces = Object.values(snapshot.inventory).reduce((total, count) => total + count, 0);
  const inventoryItems = (Object.keys(ITEMS) as ItemId[]).filter((itemId) => level.inventory.includes(itemId));

  return (
    <section className="game-layout" aria-label={`第 ${level.id} 关：${level.title}`}>
      <div className="stage-stack">
        <div className="canvas-wrap">
          <canvas
            ref={canvasRef}
            className="game-canvas"
            aria-label="垃圾物理堆叠建造区"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              gameRef.current?.beginCanvasInteraction(event.clientX, event.clientY, event.pointerId);
            }}
            onWheel={(event) => {
              event.preventDefault();
              gameRef.current?.panCamera(event.deltaY);
            }}
          />
          {isInteractive && (
            <div className="stage-actions" aria-label="游戏操作">
              <button className="stage-action reset-action" type="button" onClick={() => { audio.ui(); setConfirmation("reset"); }}>重置</button>
              <button className="stage-action exit-action" type="button" onClick={() => { audio.ui(); setConfirmation("exit"); }}>退出</button>
            </div>
          )}
          {snapshot.status === "activating" && (
            <div className="activation-strip" aria-live="polite">
              <span>机器人攀爬中</span><div><i style={{ width: `${snapshot.activationProgress * 100}%` }} /></div><b>{Math.round(snapshot.activationProgress * 100)}%</b>
            </div>
          )}
          <aside className="inventory-panel panel" aria-label="垃圾物品列表">
            <div className="inventory-head"><strong>垃圾物品</strong><span>{availablePieces}</span></div>
            <div className="inventory-list">
              {inventoryItems
                .map((id) => {
                  const item = ITEMS[id];
                  const count = snapshot.inventory[id];
                  const highlighted = snapshot.hint?.itemId === item.id;
                  return (
                    <button
                      className={`material-card ${highlighted ? "recommended" : ""} ${count === 0 ? "depleted" : ""}`}
                      type="button"
                      key={item.id}
                      disabled={!isInteractive || count === 0}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.currentTarget.setPointerCapture?.(event.pointerId);
                        gameRef.current?.startHolding(item.id, event.clientX, event.clientY, event.pointerId);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        const rect = event.currentTarget.getBoundingClientRect();
                        gameRef.current?.startHolding(item.id, rect.left + rect.width / 2, rect.top + rect.height / 2, -1);
                      }}
                      aria-label={`拖拽 ${item.name}，剩余 ${count} 件`}
                    >
                      <span className={`material-icon ${item.role}`} style={materialThumbnailStyle(item.id)} aria-hidden="true" />
                      <span className="material-copy"><b>{item.name}</b></span>
                      <span className="material-count">×{count}</span>
                    </button>
                  );
                })}
              {Object.values(snapshot.inventory).every((count) => count === 0) && <p className="empty-inventory">物料已经用完，建议重试本关。</p>}
            </div>
          </aside>
          {snapshot.status === "failed" && (
            <div className="modal-scrim result-scrim">
              <div className="secondary-dialog result-dialog failed" role="alertdialog" aria-modal="true" aria-labelledby="result-title">
                <div className="result-symbol" aria-hidden="true">↯</div>
                <strong id="result-title">高塔失稳</strong>
                <p>{snapshot.message}</p>
                <div className="dialog-actions single-action">
                  <button className="dialog-button primary" type="button" onClick={() => {
                    audio.ui();
                    setConfirmation(null);
                    gameRef.current?.restart();
                  }}>
                    重新搭建
                  </button>
                </div>
              </div>
            </div>
          )}
          {confirmation && isInteractive && (
            <div className="modal-scrim confirmation-scrim" onPointerDown={() => setConfirmation(null)}>
              <div
                className="secondary-dialog confirmation-dialog"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="confirmation-title"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <span className="dialog-kicker">操作确认</span>
                <strong id="confirmation-title">{confirmation === "reset" ? "重新搭建？" : "退出游戏？"}</strong>
                <p>{confirmation === "reset" ? "当前堆叠进度将被清空。" : "将返回游戏启动页面。"}</p>
                <div className="dialog-actions">
                  <button className="dialog-button ghost" type="button" onClick={() => { audio.ui(); setConfirmation(null); }}>取消</button>
                  <button
                    className="dialog-button primary"
                    type="button"
                    onClick={() => {
                      audio.ui();
                      setConfirmation(null);
                      if (confirmation === "reset") gameRef.current?.restart();
                      else onExit();
                    }}
                  >
                    {confirmation === "reset" ? "确认重置" : "确认退出"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {endingPlaying && (
            <div className={`ending-cinematic ${endingReady ? "is-ready" : ""} ${endingComplete ? "is-complete" : ""}`} aria-label="通关结尾">
              <video
                ref={endingVideoRef}
                className="ending-cinematic-video"
                autoPlay
                muted
                playsInline
                preload="auto"
                onCanPlay={() => setEndingReady(true)}
                onEnded={() => setEndingComplete(true)}
                onError={() => setEndingComplete(true)}
              >
                <source src="/assets/victory-ending.mp4" type="video/mp4" />
              </video>
              <audio ref={endingMusicRef} loop preload="auto" aria-hidden="true">
                <source src="/assets/victory-ending.mp4" type="audio/mp4" />
              </audio>
              {endingNeedsGesture && !endingComplete && (
                <button
                  className="ending-play-button"
                  type="button"
                  onClick={() => {
                    setEndingNeedsGesture(false);
                    const videoPlayback = endingVideoRef.current?.play();
                    const soundtrackPlayback = endingMusicRef.current?.play();
                    const attempts = [videoPlayback, soundtrackPlayback].filter((attempt): attempt is Promise<void> => Boolean(attempt));
                    void Promise.all(attempts).catch(() => setEndingNeedsGesture(true));
                  }}
                >
                  播放结局与音乐
                </button>
              )}
              {endingComplete && (
                <>
                  <img
                    className="ending-epilogue-background"
                    src="/assets/ending-epilogue-og.png"
                    alt="阳光重返废墟，新生命在城市中生长"
                  />
                  <div className="ending-wordmark" aria-label="追光">
                    <img src="/assets/chase-light-brush-wordmark.png" alt="追光" />
                    <p>以心筑塔，向光而生</p>
                  </div>
                  <button
                    className="ending-home-button"
                    type="button"
                    onClick={() => {
                      audio.ui();
                      const soundtrack = endingMusicRef.current;
                      if (soundtrack) {
                        soundtrack.pause();
                        soundtrack.currentTime = 0;
                      }
                      setEndingPlaying(false);
                      setEndingComplete(false);
                      onExit();
                    }}
                  >
                    返回主页
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function DawnTowerGame() {
  const level = LEVELS[0];
  const audioRef = useRef<GameAudio | null>(null);
  const launchAudioRef = useRef<HTMLAudioElement>(null);
  if (!audioRef.current) audioRef.current = new GameAudio();
  const audio = audioRef.current;
  const [loading, setLoading] = useState(8);
  const [started, setStarted] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [launchLeaving, setLaunchLeaving] = useState(false);
  const [sceneLoading, setSceneLoading] = useState(false);
  const [sceneLoadProgress, setSceneLoadProgress] = useState(0);

  const ensureAutomaticSound = async () => {
    try {
      await audio.unlock();
      audio.setEnabled(true);
      const player = launchAudioRef.current;
      if (!started && !sceneLoading && player?.paused) {
        player.volume = 0.78;
        await player.play();
      }
    } catch {
      // Audible autoplay is retried silently on the first player interaction.
    }
  };

  const fadeOutLaunchMusic = () => {
    const player = launchAudioRef.current;
    if (!player) return;
    const startVolume = player.volume;
    let step = 0;
    const timer = window.setInterval(() => {
      step += 1;
      player.volume = Math.max(0, startVolume * (1 - step / 12));
      if (step < 12) return;
      window.clearInterval(timer);
      player.pause();
      player.volume = 0.78;
    }, 50);
  };

  const startGame = async () => {
    if (launchLeaving) return;
    setLaunchLeaving(true);
    try {
      await audio.unlock();
      audio.setEnabled(true);
      audio.ui();
    } catch {
      // Gameplay audio will retry on the next interaction if it is blocked.
    }
    fadeOutLaunchMusic();
    window.setTimeout(() => {
      setSceneLoadProgress(0);
      setSceneLoading(true);
      const progressTimer = window.setInterval(() => {
        setSceneLoadProgress((value) => Math.min(94, value + (value < 60 ? 11 : 5)));
      }, 70);
      window.setTimeout(() => {
        window.clearInterval(progressTimer);
        setSceneLoadProgress(100);
        window.setTimeout(() => {
          setStarted(true);
          setSceneLoading(false);
          setLaunchLeaving(false);
        }, 140);
      }, 820);
    }, 620);
  };

  useEffect(() => {
    if (started) return;
    const timer = window.setInterval(() => {
      setLoading((value) => {
        if (value >= 100) {
          window.clearInterval(timer);
          return 100;
        }
        return Math.min(100, value + (value < 72 ? 8 : 4));
      });
    }, 90);
    return () => window.clearInterval(timer);
  }, [started]);

  useEffect(() => {
    if (started || sceneLoading) return;
    const player = launchAudioRef.current;
    if (!player) return;
    player.volume = 0.78;
    void player.play().catch(() => undefined);
  }, [sceneLoading, started]);

  useEffect(() => {
    if (!guideOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGuideOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [guideOpen]);

  if (!started) {
    const ready = loading >= 100;
    if (sceneLoading) {
      return (
        <main className="scene-loading-screen" aria-live="polite" aria-label={`正在进入游戏场景 ${sceneLoadProgress}%`}>
          <div className="scene-loading-visual" aria-hidden="true">
            <span className="scene-loading-ring" />
            <b className="scene-loading-percent">{sceneLoadProgress}%</b>
          </div>
          <strong>正在进入废土</strong>
          <span>光在 99 米之上</span>
        </main>
      );
    }
    return (
      <main
        className={launchLeaving ? "launch-screen is-leaving" : "launch-screen"}
        aria-labelledby="launch-title"
        onPointerDown={() => { void ensureAutomaticSound(); }}
        onKeyDown={() => { void ensureAutomaticSound(); }}
      >
        <video
          className="launch-art"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster="/assets/startup-wasteland-sprout.png"
          aria-hidden="true"
        >
          <source src="/assets/launch-background-pingpong.mp4" type="video/mp4" />
        </video>
        <audio ref={launchAudioRef} loop preload="auto" aria-hidden="true">
          <source src="/assets/launch-original-with-music.mp4" type="audio/mp4" />
        </audio>
        <div className="launch-shade" aria-hidden="true" />
        {!ready && (
          <div className="launch-loader" role="status" aria-label={`正在载入游戏 ${loading}%`}>
            <span className="launch-loader-ring" aria-hidden="true" />
            <b className="launch-loader-percent">{loading}%</b>
          </div>
        )}
        <section className="launch-content">
          <div className="launch-brand">
            <img className="launch-emblem" src="/assets/pursue-light-hook-logo-thin-clean.png" alt="" />
            <h1 id="launch-title" className="launch-wordmark" aria-label="追.光">
              <img src="/assets/chase-light-brush-wordmark.png" alt="" />
              <i aria-hidden="true">.</i>
            </h1>
            <p className="launch-english">CHASE THE LIGHT</p>
            <p className="launch-story">光之故事 · 99米新生</p>
          </div>

          <div className="launch-actions">
            {ready && (
              <>
                <button className="launch-start" type="button" disabled={launchLeaving} onClick={() => { void startGame(); }}>
                  <span className="launch-start-label">开始游戏</span>
                </button>
                <button
                  className="launch-guide-button"
                  type="button"
                  aria-haspopup="dialog"
                  aria-controls="launch-guide-dialog"
                  onClick={() => { audio.ui(); setGuideOpen(true); }}
                >
                  故事及玩法说明
                </button>
              </>
            )}
          </div>
        </section>

        {guideOpen && (
          <div
            className="launch-guide-backdrop"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setGuideOpen(false);
            }}
          >
            <section
              id="launch-guide-dialog"
              className="launch-guide-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="launch-guide-title"
            >
              <header className="launch-guide-header">
                <div>
                  <span>CHASING THE LIGHT</span>
                  <h2 id="launch-guide-title">故事及玩法说明</h2>
                </div>
                <button type="button" aria-label="关闭故事及玩法说明" onClick={() => { audio.ui(); setGuideOpen(false); }}>
                  ×
                </button>
              </header>

              <div className="launch-guide-scroll">
                <article>
                  <h3>故事背景</h3>
                  <p>
                    污染遮蔽了天空，城市在昏暗中沉寂。只有抵达 99 米以上，才能再次触碰阳光与新生。废墟顶端的吊篮里，
                    一株刚刚发芽的小花正等待被发现。
                  </p>
                </article>
                <article>
                  <h3>游戏目标</h3>
                  <p>利用散落的生活与建筑废料搭建高塔，让机器人沿着稳定的垃圾堆攀爬至 99 米，摘取新生的小花。</p>
                </article>
                <article>
                  <h3>堆叠规则</h3>
                  <ol>
                    <li>从右侧物品栏拖出垃圾，放入场景中的有效搭建区域。</li>
                    <li>第一件物品可以直接落在地面；从第二件开始，必须堆放在上一件物品之上。</li>
                    <li>松手后物品会受到重力、碰撞和重心影响；已经放置的物品仍可拖动调整。</li>
                    <li>每种废料具有接近现实的相对重量、摩擦稳定性与承重差异；承重强度统一按现实参考值强化至约 3 倍。</li>
                    <li>持续超出承重上限时，物件会先弯折、压瘪或开裂，随后摩擦与稳定性下降，并可能引发整体垮塌。</li>
                    <li>垃圾堆抵达吊篮下方的 99 米位置并保持稳定后，机器人会开始攀爬。</li>
                    <li>机器人本身具有重量，攀爬时会把移动载荷传给脚下和手边的废料，因此塔体必须能承受偏心受力。</li>
                    <li>机器人抵达 99 米即锁定胜利；此后塔体即使继续晃动或倒塌，也不会改变通关结果。</li>
                  </ol>
                </article>
                <aside>
                  失败条件：机器人抵达 99 米之前，非第一件物品掉落到地面，或垃圾堆在建造、攀爬过程中整体倒塌。失败提示会说明具体失稳原因。
                </aside>
              </div>

              <footer>
                <button type="button" onClick={() => { audio.ui(); setGuideOpen(false); }}>我明白了</button>
              </footer>
            </section>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="game-app minimal-game is-entering">
      <h1 className="sr-only">追.光</h1>
      <GameStage
        key={level.id}
        level={level}
        audio={audio}
        onExit={() => {
          audio.stopGameplay();
          setStarted(false);
        }}
      />
    </main>
  );
}
