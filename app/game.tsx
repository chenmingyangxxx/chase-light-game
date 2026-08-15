"use client";

import Matter from "matter-js";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const { Bodies, Body, Composite, Engine, World } = Matter;

// The playable camera is portrait first. The physics world remains taller than
// one viewport so the full 0–99 m climb can be inspected by swiping upward.
const WORLD_WIDTH = 720;
const WORLD_HEIGHT = 1000;
const BASE_X = WORLD_WIDTH / 2;
// The simulation is a tall world: the 99 m ruler spans 990 virtual pixels and
// can be inspected by panning, rather than being compressed into one viewport.
const BASE_Y = 1860;
const PIXELS_PER_METER = 10;
const STACK_PLATFORM_WIDTH = 242;
const GOAL_BASKET_X = BASE_X + 14;
const RECOVERY_Y = BASE_Y + 94;
const BACKDROP_TOP = 600;
const BACKDROP_BOTTOM = BASE_Y + 124;
const VIEW_GROUND_CAMERA = WORLD_HEIGHT - BASE_Y - 70;
const MIN_CAMERA_OFFSET = VIEW_GROUND_CAMERA - 20;
const MAX_CAMERA_OFFSET = 154 - (BASE_Y - 99 * PIXELS_PER_METER);

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
  asset: "junk-sprite-atlas.png" | "risky-props.png";
  column: number;
  row: number;
  columns: number;
  rows: number;
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
  pallet: { asset: "junk-sprite-atlas.png", column: 0, row: 0, columns: 4, rows: 4 },
  slab: { asset: "junk-sprite-atlas.png", column: 1, row: 0, columns: 4, rows: 4 },
  container: { asset: "junk-sprite-atlas.png", column: 2, row: 0, columns: 4, rows: 4 },
  car: { asset: "junk-sprite-atlas.png", column: 3, row: 0, columns: 4, rows: 4 },
  cabinet: { asset: "junk-sprite-atlas.png", column: 0, row: 1, columns: 4, rows: 4 },
  sofa: { asset: "junk-sprite-atlas.png", column: 1, row: 1, columns: 4, rows: 4 },
  beam: { asset: "junk-sprite-atlas.png", column: 2, row: 1, columns: 4, rows: 4 },
  ladder: { asset: "junk-sprite-atlas.png", column: 3, row: 1, columns: 4, rows: 4 },
  pipes: { asset: "junk-sprite-atlas.png", column: 0, row: 2, columns: 4, rows: 4 },
  crate: { asset: "junk-sprite-atlas.png", column: 1, row: 2, columns: 4, rows: 4 },
  fridge: { asset: "junk-sprite-atlas.png", column: 2, row: 2, columns: 4, rows: 4 },
  washer: { asset: "junk-sprite-atlas.png", column: 3, row: 2, columns: 4, rows: 4 },
  computer: { asset: "junk-sprite-atlas.png", column: 0, row: 3, columns: 4, rows: 4 },
  scaffold: { asset: "junk-sprite-atlas.png", column: 1, row: 3, columns: 4, rows: 4 },
  barrel: { asset: "junk-sprite-atlas.png", column: 2, row: 3, columns: 4, rows: 4 },
  tire: { asset: "junk-sprite-atlas.png", column: 3, row: 3, columns: 4, rows: 4 },
  bicycle: { asset: "risky-props.png", column: 0, row: 0, columns: 2, rows: 1 },
  chair: { asset: "risky-props.png", column: 1, row: 0, columns: 2, rows: 1 },
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
    id: "pallet", name: "木托盘", shortName: "托", role: "foundation", shape: "box", width: 126, height: 94,
    density: 0.0022, friction: 0.88, frictionStatic: 1.05, restitution: 0.01, color: "#9b6b45", accent: "#d3a271", trait: "宽 · 稳",
  },
  slab: {
    id: "slab", name: "混凝土板", shortName: "板", role: "foundation", shape: "box", width: 140, height: 86,
    density: 0.0044, friction: 0.94, frictionStatic: 1.2, restitution: 0.005, color: "#66747a", accent: "#9ba9a9", trait: "极重 · 防滑",
  },
  container: {
    // This is an orthographic end-front container prop, so its collider follows
    // the visible face instead of an unrelated side-view shipping-container ratio.
    id: "container", name: "旧集装箱", shortName: "箱", role: "foundation", shape: "box", width: 177, height: 112,
    density: 0.0033, friction: 0.78, frictionStatic: 0.96, restitution: 0.01, color: "#536f74", accent: "#a2b8a7", trait: "重 · 可堆高",
  },
  car: {
    id: "car", name: "报废车壳", shortName: "车", role: "foundation", shape: "box", width: 148, height: 64,
    density: 0.0048, friction: 0.74, frictionStatic: 0.9, restitution: 0.02, color: "#785751", accent: "#c18c68", trait: "宽 · 压重",
  },
  cabinet: {
    id: "cabinet", name: "铁皮柜", shortName: "柜", role: "tall", shape: "box", width: 47, height: 84,
    density: 0.0031, friction: 0.73, frictionStatic: 0.9, restitution: 0.02, color: "#6c7c65", accent: "#b9c697", trait: "高 · 偏重",
  },
  sofa: {
    id: "sofa", name: "旧沙发", shortName: "沙", role: "foundation", shape: "box", width: 116, height: 70,
    density: 0.0028, friction: 0.85, frictionStatic: 1.05, restitution: 0.02, color: "#75554c", accent: "#ca9880", trait: "宽 · 高摩擦",
  },
  beam: {
    id: "beam", name: "废旧钢梁", shortName: "梁", role: "bridge", shape: "box", width: 178, height: 49,
    density: 0.0032, friction: 0.8, frictionStatic: 0.98, restitution: 0.01, color: "#7e8382", accent: "#d1c9a8", trait: "长 · 可桥接",
  },
  ladder: {
    id: "ladder", name: "金属梯", shortName: "梯", role: "tall", shape: "box", width: 44, height: 136,
    density: 0.0019, friction: 0.63, frictionStatic: 0.75, restitution: 0.03, color: "#8b9d87", accent: "#d6dfba", trait: "轻 · 易翘",
  },
  pipes: {
    id: "pipes", name: "管束", shortName: "管", role: "bridge", shape: "box", width: 128, height: 62,
    density: 0.0029, friction: 0.58, frictionStatic: 0.7, restitution: 0.04, color: "#647a82", accent: "#b1c2c6", trait: "长 · 易滑",
  },
  crate: {
    id: "crate", name: "回收箱", shortName: "箱", role: "block", shape: "box", width: 60, height: 47,
    density: 0.0025, friction: 0.81, frictionStatic: 0.98, restitution: 0.015, color: "#b7784f", accent: "#e2ae70", trait: "规则 · 易堆",
  },
  fridge: {
    id: "fridge", name: "旧冰箱", shortName: "冰", role: "tall", shape: "box", width: 46, height: 82,
    density: 0.0038, friction: 0.74, frictionStatic: 0.88, restitution: 0.01, color: "#7790a0", accent: "#d6e0d5", trait: "高 · 可封顶",
  },
  washer: {
    id: "washer", name: "洗衣机", shortName: "洗", role: "block", shape: "box", width: 60, height: 68,
    density: 0.0034, friction: 0.76, frictionStatic: 0.93, restitution: 0.01, color: "#8e9e9a", accent: "#cbd6cd", trait: "方正 · 压重",
  },
  computer: {
    id: "computer", name: "旧电脑", shortName: "机", role: "block", shape: "box", width: 64, height: 57,
    density: 0.0018, friction: 0.64, frictionStatic: 0.74, restitution: 0.04, color: "#57636b", accent: "#9daeb5", trait: "小 · 填缝",
  },
  scaffold: {
    id: "scaffold", name: "脚手架", shortName: "架", role: "tall", shape: "box", width: 68, height: 108,
    density: 0.0022, friction: 0.68, frictionStatic: 0.81, restitution: 0.02, color: "#76866c", accent: "#d6cc88", trait: "很高 · 须居中",
  },
  barrel: {
    id: "barrel", name: "旧油桶", shortName: "桶", role: "risky", shape: "box", width: 50, height: 70,
    density: 0.0024, friction: 0.48, frictionStatic: 0.58, restitution: 0.07, color: "#a37445", accent: "#edc161", trait: "高 · 易倒",
  },
  tire: {
    id: "tire", name: "轮胎", shortName: "胎", role: "risky", shape: "circle", width: 46, height: 46,
    density: 0.0027, friction: 0.54, frictionStatic: 0.68, restitution: 0.2, color: "#333b3a", accent: "#9fa78c", trait: "弹性 · 可配重",
  },
  bicycle: {
    id: "bicycle", name: "旧自行车", shortName: "车", role: "risky", shape: "box", width: 116, height: 82,
    density: 0.0013, friction: 0.34, frictionStatic: 0.42, restitution: 0.08, color: "#6e7e5f", accent: "#d2b86a", trait: "轻 · 难稳定",
  },
  chair: {
    id: "chair", name: "办公椅", shortName: "椅", role: "risky", shape: "box", width: 64, height: 100,
    density: 0.0016, friction: 0.4, frictionStatic: 0.52, restitution: 0.05, color: "#745f56", accent: "#c5a477", trait: "偏心 · 易倒",
  },
};

// Keep displayed prop dimensions close to their physical collision footprint.
// The original scale was too small to make a recognisable, readable tower.
const PROP_SCALE = 1.35;
Object.values(ITEMS).forEach((item) => {
  item.width = Math.round(item.width * PROP_SCALE);
  item.height = Math.round(item.height * PROP_SCALE);
});

const LEVELS: LevelConfig[] = [
  {
    id: 1,
    target: 99,
    title: "新芽吊篮",
    subtitle: "在悬空的新生花朵下，把稳定的废料塔堆至 99 米。",
    baseWidth: 242,
    wind: 0,
    inventory: ["slab", "slab", "slab", "pallet", "pallet", "container", "container", "container", "container", "car", "car", "scaffold", "scaffold", "scaffold", "scaffold", "fridge", "fridge", "fridge", "cabinet", "cabinet", "washer", "washer", "crate", "crate", "crate", "crate", "beam", "beam", "beam", "beam", "ladder", "pipes"],
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
    { itemId: third, xMeters: 0, yMeters: finalHeight, rotation: 0, text: `最后用「${ITEMS[third].name}」封顶，保持水平接近 99 米的新芽。` },
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

class TowerPhysicsGame {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly level: LevelConfig;
  private readonly onUpdate: (snapshot: GameSnapshot) => void;
  private readonly onClear: () => void;
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
  private frameId = 0;
  private cameraOffsetY = VIEW_GROUND_CAMERA;
  private cameraManualOffsetY = 0;
  private panning: { pointerId: number; lastClientY: number } | null = null;
  private baseBody: Matter.Body | null = null;
  private readonly artwork: Record<"polluted" | "revived" | "junk" | "risky" | "debris" | "goal" | "robot", HTMLImageElement>;

  constructor(canvas: HTMLCanvasElement, level: LevelConfig, onUpdate: (snapshot: GameSnapshot) => void, onClear: () => void) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持 Canvas 渲染。");
    this.canvas = canvas;
    this.context = context;
    this.level = level;
    this.onUpdate = onUpdate;
    this.onClear = onClear;
    this.inventory = inventoryFor(level);
    this.engine = this.createEngine();
    this.artwork = {
      polluted: this.loadArtwork("/assets/wasteland-flat-polluted.png"),
      revived: this.loadArtwork("/assets/wasteland-flat-revived.png"),
      // The same orthographic asset sheets are used both in the inventory and
      // in the physical world so a placed object keeps its front-facing form.
      junk: this.loadArtwork("/assets/front-prop-atlas.png"),
      risky: this.loadArtwork("/assets/front-risky-props.png"),
      debris: this.loadArtwork("/assets/ground-debris-foreground.png"),
      goal: this.loadArtwork("/assets/crane-basket-sprout.png"),
      robot: this.loadArtwork("/assets/sprout-helper-robot.png"),
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
    this.hintIndex = 0;
    this.hintsLeft = 3;
    this.activeHint = null;
    this.cameraOffsetY = VIEW_GROUND_CAMERA;
    this.cameraManualOffsetY = 0;
    this.panning = null;
    this.message = "已重置本关。物料和 3 次提示已恢复。";
    Composite.clear(this.engine.world, false, true);
    Engine.clear(this.engine);
    this.engine = this.createEngine();
    this.createWorld();
    this.emit(true);
  }

  private createEngine() {
    return Engine.create({
      enableSleeping: true,
      positionIterations: 14,
      velocityIterations: 12,
      constraintIterations: 3,
      gravity: { x: 0, y: 1, scale: 0.001 },
    });
  }

  private createWorld() {
    const base = Bodies.rectangle(WORLD_WIDTH / 2, BASE_Y + 11, WORLD_WIDTH, 22, {
      isStatic: true,
      friction: 1,
      frictionStatic: 1,
      label: "open-ground",
    });
    const recoveryFloor = Bodies.rectangle(WORLD_WIDTH / 2, RECOVERY_Y + 13, WORLD_WIDTH, 26, {
      isStatic: true,
      friction: 0.8,
      label: "recovery-floor",
    });
    const stackPlatform = Bodies.rectangle(BASE_X, BASE_Y - 12, STACK_PLATFORM_WIDTH, 24, {
      isStatic: true,
      friction: 1.08,
      frictionStatic: 1.2,
      label: "stack-platform",
    });
    const leftWall = Bodies.rectangle(16, RECOVERY_Y - 10, 32, 180, { isStatic: true, label: "boundary" });
    const rightWall = Bodies.rectangle(WORLD_WIDTH - 16, RECOVERY_Y - 10, 32, 180, { isStatic: true, label: "boundary" });
    this.baseBody = base;
    World.add(this.engine.world, [base, recoveryFloor, stackPlatform, leftWall, rightWall]);
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
    const halfHeight = (item?.height ?? 40) / 2;
    const x = clamp(point.x - adjusted.offsetX, 42, WORLD_WIDTH - 42);
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
    const inCanvas = point.x >= 38 && point.x <= WORLD_WIDTH - 38 && point.y >= 52 && point.y <= BASE_Y - 3;
    this.held.pointerId = undefined;
    if (inCanvas) {
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
    if (!this.hasValidStackPosition(adjusted.body.gameItem, adjusted.body.position.x, adjusted.body.position.y, adjusted.body)) {
      this.adjusting = null;
      Body.setStatic(adjusted.body, false);
      this.fail("物件必须放在上一件物品正上方；落到其他位置，挑战失败。");
      return false;
    }
    Body.setStatic(adjusted.body, false);
    adjusted.body.isSleeping = false;
    adjusted.body.sleepCounter = 0;
    Body.setVelocity(adjusted.body, { x: 0, y: 0 });
    Body.setAngularVelocity(adjusted.body, 0);
    this.adjusting = null;
    return true;
  }

  private placeHeld(x: number, y: number) {
    if (!this.held || this.status !== "building") return;
    const item = ITEMS[this.held.itemId];
    // Drop exactly where the player releases it. Matter handles collision,
    // gravity and any resulting fall instead of snapping to a preset point.
    const halfHeight = item.height / 2;
    const dropX = clamp(x, item.width / 2 + 3, WORLD_WIDTH - item.width / 2 - 3);
    const dropY = clamp(y, halfHeight + 8, BASE_Y - halfHeight - 3);
    if (!this.hasValidStackPosition(item, dropX, dropY)) {
      this.held = null;
      this.fail("物件必须落在废料平台或上一件物品正上方；落到其他位置，挑战失败。");
      return;
    }
    const body = this.makeBody(item, dropX, dropY, this.held.angle);
    this.dynamicBodies.push(body);
    World.add(this.engine.world, body);
    this.inventory[item.id] -= 1;
    if (this.activeHint?.itemId === item.id) this.activeHint = null;
    this.message = `「${item.name}」已投入建造区，等待物理结构稳定。`;
    this.held = null;
    this.emit(true);
  }

  private makeBody(item: ItemDefinition, x: number, y: number, angle: number): TaggedBody {
    const options: Matter.IChamferableBodyDefinition = {
      density: item.density,
      friction: item.friction,
      frictionStatic: item.frictionStatic,
      restitution: item.restitution,
      frictionAir: 0.018,
      // Tight contact tolerance reduces the visible air gaps in a carefully
      // placed stack while retaining normal Matter collision resolution.
      slop: 0.001,
      label: `item:${item.id}`,
    };
    const body = (item.shape === "circle"
      ? Bodies.circle(x, y, item.width / 2, options)
      : Bodies.rectangle(x, y, item.width, item.height, options)) as TaggedBody;
    Body.setAngle(body, angle);
    body.gameItem = item;
    body.gameBornAt = this.elapsed;
    return body;
  }

  private readonly tick = (now: number) => {
    const delta = this.lastFrame ? Math.min(33, now - this.lastFrame) : 16.667;
    this.lastFrame = now;
    this.elapsed += delta;
    if (this.status === "building") {
      this.accumulator += delta;
      while (this.accumulator >= 16.667) {
        Engine.update(this.engine, 16.667);
        this.accumulator -= 16.667;
      }
    } else {
      this.accumulator = 0;
    }
    this.updateSimulation(delta);
    if (this.status === "activating" && this.elapsed - this.activationAt >= 4100) this.finishClear();
    this.render();
    if (now - this.lastUiUpdate > 110) {
      this.emit();
      this.lastUiUpdate = now;
    }
    this.frameId = window.requestAnimationFrame(this.tick);
  };

  private updateSimulation(delta: number) {
    if (this.status !== "building") return;
    if (this.dynamicBodies.some((body) => this.isFallen(body))) {
      this.fail("物件脱离了堆叠结构并掉落，挑战失败。");
      return;
    }
    const supportGraph = this.supportGraph();
    const towerBodies = supportGraph.bodies;
    const unsupportedAtRest = this.dynamicBodies.some((body) =>
      !supportGraph.depth.has(body)
      && this.elapsed - (body.gameBornAt ?? this.elapsed) > 850
      && body.speed < 0.33
      && Math.abs(body.angularVelocity) < 0.035,
    );
    if (unsupportedAtRest) {
      this.fail("物件没有堆在上一件物品上，挑战失败。");
      return;
    }
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
    const settledBodies = this.dynamicBodies.filter((body) => !this.isFallen(body));
    const stable = !this.adjusting && towerBodies.length > 0 && settledBodies.every((body) => body.speed < 0.33 && Math.abs(body.angularVelocity) < 0.035);
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
      if (this.collapseElapsed > 720) this.fail();
    } else {
      this.collapseElapsed = 0;
    }

    const hasRealStack = towerBodies.some((body) => (supportGraph.depth.get(body) ?? 0) >= 2);
    if (currentHeight >= this.level.target && hasRealStack && stable && this.stableElapsed > 1250) this.activateLight();
  }

  private towerBodies() {
    return this.supportGraph().bodies;
  }

  private supportGraph() {
    const candidates = this.dynamicBodies.filter((body) => !this.isFallen(body));
    const depth = new Map<TaggedBody, number>();
    candidates.forEach((body) => {
      // Only the central platform is a valid first foundation. Open ground is
      // intentionally excluded: every later prop must sit on the stack above it.
      const platformOverlap = Math.min(body.bounds.max.x, BASE_X + STACK_PLATFORM_WIDTH / 2)
        - Math.max(body.bounds.min.x, BASE_X - STACK_PLATFORM_WIDTH / 2);
      if (
        body.bounds.max.y >= BASE_Y - 32
        && body.bounds.min.y <= BASE_Y + 16
        && platformOverlap >= Math.max(14, Math.min(body.bounds.max.x - body.bounds.min.x, STACK_PLATFORM_WIDTH) * 0.3)
      ) depth.set(body, 1);
    });

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

  private isRestingOn(body: TaggedBody, support: TaggedBody) {
    const overlap = Math.min(body.bounds.max.x, support.bounds.max.x) - Math.max(body.bounds.min.x, support.bounds.min.x);
    const narrowest = Math.min(body.bounds.max.x - body.bounds.min.x, support.bounds.max.x - support.bounds.min.x);
    const verticalGap = support.bounds.min.y - body.bounds.max.y;
    return body.position.y < support.position.y - 2
      && overlap >= Math.max(10, narrowest * 0.2)
      && verticalGap >= -8
      && verticalGap <= 9;
  }

  private hasValidStackPosition(item: ItemDefinition | undefined, x: number, y: number, excluded?: TaggedBody) {
    if (!item) return false;
    const left = x - item.width / 2;
    const right = x + item.width / 2;
    const candidates = this.dynamicBodies.filter((body) => body !== excluded && !this.isFallen(body));
    const proposedBottom = y + item.height / 2;
    if (candidates.length === 0) {
      const platformOverlap = Math.min(right, BASE_X + STACK_PLATFORM_WIDTH / 2) - Math.max(left, BASE_X - STACK_PLATFORM_WIDTH / 2);
      return platformOverlap >= Math.max(16, Math.min(item.width, STACK_PLATFORM_WIDTH) * 0.38)
        && proposedBottom <= BASE_Y - 14;
    }
    return candidates.some((support) => {
      const overlap = Math.min(right, support.bounds.max.x) - Math.max(left, support.bounds.min.x);
      const narrowest = Math.min(item.width, support.bounds.max.x - support.bounds.min.x);
      // The release may be slightly above its support so it can visibly fall,
      // but never beside it or from below it.
      return proposedBottom <= support.bounds.min.y + 8
        && overlap >= Math.max(14, narrowest * 0.34);
    });
  }

  private isFallen(body: Matter.Body) {
    return body.position.y > BASE_Y + 62 || body.position.x < 42 || body.position.x > WORLD_WIDTH - 42;
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
    this.message = "塔身稳定并达到目标高度，地表复苏系统启动。";
    this.emit(true);
  }

  private finishClear() {
    if (this.status !== "activating") return;
    this.status = "cleared";
    this.message = this.level.id === 10 ? "最后一座高塔达成，废土迎来了黎明。" : "目标高度已达成，土地正在恢复生机。";
    this.onClear();
    this.emit(true);
  }

  private fail(reason = "塔身失去支撑并倒塌了。调整底座和重心后再试一次。") {
    if (this.status !== "building") return;
    this.status = "failed";
    this.message = reason;
    this.emit(true);
  }

  private clientToWorld(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * WORLD_WIDTH,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * WORLD_HEIGHT - this.cameraOffsetY,
    };
  }

  panCamera(screenDeltaY: number) {
    if (!Number.isFinite(screenDeltaY)) return;
    const rect = this.canvas.getBoundingClientRect();
    const virtualDelta = -screenDeltaY / Math.max(0.1, rect.height / WORLD_HEIGHT);
    const automatic = this.automaticCameraOffset();
    const next = clamp(automatic + this.cameraManualOffsetY + virtualDelta, MIN_CAMERA_OFFSET, MAX_CAMERA_OFFSET);
    this.cameraManualOffsetY = next - automatic;
    this.cameraOffsetY = next;
  }

  private activationProgress() {
    if (this.status === "building" || this.status === "failed") return 0;
    return clamp((this.elapsed - this.activationAt) / 4100, 0, 1);
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
    const scaleX = rect.width / WORLD_WIDTH;
    const scaleY = rect.height / WORLD_HEIGHT;
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.setTransform(dpr * scaleX, 0, 0, dpr * scaleY, 0, 0);
    this.updateCamera();

    const activating = this.status === "activating" || this.status === "cleared";
    const illuminate = activating ? clamp((this.elapsed - this.activationAt - 1000) / 2200, 0, 1) : 0;
    this.context.save();
    this.context.translate(0, this.cameraOffsetY);
    this.drawScene(illuminate);
    this.drawWorld(illuminate);
    this.context.restore();
  }

  private updateCamera() {
    const target = clamp(this.automaticCameraOffset() + this.cameraManualOffsetY, MIN_CAMERA_OFFSET, MAX_CAMERA_OFFSET);
    const easing = target > this.cameraOffsetY ? 0.075 : 0.12;
    this.cameraOffsetY += (target - this.cameraOffsetY) * easing;
    if (Math.abs(target - this.cameraOffsetY) < 0.05) this.cameraOffsetY = target;
  }

  private automaticCameraOffset() {
    // Follow a growing tower, but preserve the player's manual pan to inspect
    // any section of the complete 0–99 m ruler.
    return clamp(VIEW_GROUND_CAMERA + clamp(this.height, 0, 99) * 2.35, MIN_CAMERA_OFFSET, MAX_CAMERA_OFFSET);
  }

  private imageReady(image: HTMLImageElement) {
    return image.complete && image.naturalWidth > 0;
  }

  private drawScene(illuminate: number) {
    const ctx = this.context;
    const polluted = this.artwork.polluted;
    const revived = this.artwork.revived;
    const backdropTop = BACKDROP_TOP;
    const backdropHeight = BACKDROP_BOTTOM - BACKDROP_TOP;

    ctx.fillStyle = "#101b1d";
    ctx.fillRect(0, backdropTop, WORLD_WIDTH, backdropHeight);
    if (this.imageReady(polluted)) {
      ctx.globalAlpha = 0.96;
      this.drawLongBackdrop(polluted);
      ctx.globalAlpha = 1;
    } else {
      this.drawFallbackSky(illuminate);
    }
    if (illuminate > 0 && this.imageReady(revived)) {
      ctx.save();
      ctx.globalAlpha = illuminate;
      this.drawLongBackdrop(revived);
      ctx.restore();
    }

    ctx.fillStyle = `rgba(5, 13, 15, ${0.22 - illuminate * 0.14})`;
    ctx.fillRect(0, backdropTop, WORLD_WIDTH, backdropHeight);

    if (this.imageReady(this.artwork.debris)) {
      ctx.save();
      ctx.globalAlpha = 0.94 - illuminate * 0.2;
      // Keep the ruin strip grounded instead of floating in the build space.
      ctx.drawImage(this.artwork.debris, 0, BASE_Y - 170, WORLD_WIDTH, BACKDROP_BOTTOM - (BASE_Y - 170));
      ctx.restore();
    }
    this.drawStackPlatform();
    this.drawGoalRig(this.activationProgress());
    this.drawGrowth(illuminate, this.elapsed);

  }

  private drawLongBackdrop(image: HTMLImageElement) {
    const ctx = this.context;
    const nativeHeight = image.naturalHeight * (WORLD_WIDTH / image.naturalWidth);
    const renderedHeight = Math.max(nativeHeight, BACKDROP_BOTTOM - BACKDROP_TOP);
    // Align the background to the very bottom of the camera world so no dark
    // unused seam opens underneath the physical ground and steel platform.
    ctx.drawImage(image, 0, BACKDROP_BOTTOM - renderedHeight, WORLD_WIDTH, renderedHeight);
  }

  private drawFallbackSky(illuminate: number) {
    const ctx = this.context;
    const sky = ctx.createLinearGradient(0, BACKDROP_TOP, 0, BACKDROP_BOTTOM);
    sky.addColorStop(0, colorMix([26, 46, 49], [99, 177, 195], illuminate));
    sky.addColorStop(0.62, colorMix([47, 63, 60], [201, 227, 192], illuminate));
    sky.addColorStop(1, colorMix([67, 71, 63], [111, 166, 97], illuminate));
    ctx.fillStyle = sky;
    ctx.fillRect(0, BACKDROP_TOP, WORLD_WIDTH, BACKDROP_BOTTOM - BACKDROP_TOP);
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

  private drawStackPlatform() {
    const ctx = this.context;
    const width = STACK_PLATFORM_WIDTH;
    const height = 24;
    const x = BASE_X - width / 2;
    const y = BASE_Y - 24;
    ctx.save();

    // A single weathered steel plate sits flush with the ruined floor; its
    // outline exactly mirrors the static Matter collision platform.
    ctx.fillStyle = "rgba(10, 15, 16, 0.52)";
    ctx.beginPath();
    ctx.ellipse(BASE_X, BASE_Y - 2, 138, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    roundedRect(ctx, x, y, width, height, 5);
    const plate = ctx.createLinearGradient(x, y, x, y + height);
    plate.addColorStop(0, "#4d5450");
    plate.addColorStop(0.22, "#353e3c");
    plate.addColorStop(1, "#1a2424");
    ctx.fillStyle = plate;
    ctx.fill();
    ctx.strokeStyle = "rgba(11, 18, 19, 0.96)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "rgba(180, 173, 143, 0.18)";
    ctx.fillRect(x + 10, y + 5, width - 20, 2);
    ctx.strokeStyle = "rgba(90, 65, 45, 0.42)";
    ctx.lineWidth = 1.2;
    for (let scratch = 0; scratch < 7; scratch += 1) {
      const scratchX = x + 26 + scratch * 28;
      ctx.beginPath();
      ctx.moveTo(scratchX, y + 13);
      ctx.lineTo(scratchX + 9, y + 17);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(141, 145, 127, 0.6)";
    for (const boltX of [x + 12, x + width - 12, BASE_X - 42, BASE_X + 42]) {
      ctx.beginPath();
      ctx.arc(boltX, y + 15, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawGoalRig(collectProgress: number) {
    const ctx = this.context;
    const basketX = GOAL_BASKET_X;
    const basketY = BASE_Y - 99 * PIXELS_PER_METER + 16;
    const boomY = basketY - 150;
    ctx.save();
    ctx.strokeStyle = "rgba(41, 50, 49, 0.94)";
    ctx.lineWidth = 11;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(-30, boomY);
    ctx.lineTo(basketX + 4, boomY);
    ctx.stroke();
    ctx.strokeStyle = "rgba(102, 106, 92, 0.52)";
    ctx.lineWidth = 2;
    for (let x = 18; x < basketX - 20; x += 52) {
      ctx.beginPath();
      ctx.moveTo(x, boomY + 6);
      ctx.lineTo(x + 27, boomY + 31);
      ctx.lineTo(x + 52, boomY + 6);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(27, 34, 33, 0.92)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(basketX, boomY + 4);
    ctx.lineTo(basketX, basketY - 65);
    ctx.stroke();
    if (this.imageReady(this.artwork.goal)) {
      ctx.drawImage(this.artwork.goal, basketX - 64, basketY - 72, 128, 144);
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
    if (collectProgress > 0.48) {
      const glow = ctx.createRadialGradient(basketX, basketY - 51, 1, basketX, basketY - 51, 24);
      glow.addColorStop(0, `rgba(211, 243, 150, ${Math.min(0.35, (collectProgress - 0.48) * 1.1)})`);
      glow.addColorStop(1, "rgba(211, 243, 150, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(basketX, basketY - 51, 24, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawWorld(illuminate: number) {
    const ctx = this.context;
    this.dynamicBodies.forEach((body) => this.drawItem(body));
    if (this.held) this.drawGhost(this.held);

    if (this.status === "activating" || this.status === "cleared") {
      ctx.fillStyle = `rgba(255, 240, 166, ${0.12 + illuminate * 0.18})`;
      ctx.fillRect(0, BACKDROP_TOP, WORLD_WIDTH, BACKDROP_BOTTOM - BACKDROP_TOP);
      this.drawSuccessRobot();
    }
  }

  private drawSuccessRobot() {
    if (!this.imageReady(this.artwork.robot)) return;
    const ctx = this.context;
    const basketX = GOAL_BASKET_X;
    const basketY = BASE_Y - 99 * PIXELS_PER_METER + 16;
    const progress = this.activationProgress();
    const arrival = clamp((progress - 0.1) / 0.38, 0, 1);
    const grasp = clamp((progress - 0.56) / 0.26, 0, 1);
    const easeArrival = 1 - (1 - arrival) * (1 - arrival);
    const robotWidth = 98;
    const robotHeight = 147;
    const robotX = basketX - 152 + 88 * easeArrival;
    const robotY = basketY - 86 + Math.sin(this.elapsed / 150) * 1.3;

    ctx.save();
    ctx.globalAlpha = Math.min(1, arrival * 2.2);
    ctx.translate(robotX, robotY + (1 - arrival) * 12);
    ctx.rotate(-0.06 + Math.sin(this.elapsed / 190) * 0.018);
    ctx.drawImage(this.artwork.robot, -robotWidth / 2, 0, robotWidth, robotHeight);
    ctx.restore();

    if (grasp <= 0) return;
    const flowerX = basketX + (robotX + 43 - basketX) * grasp;
    const flowerY = basketY - 52 + (robotY + 34 - (basketY - 52)) * grasp;
    this.drawCollectedSprout(flowerX, flowerY, 0.9 + grasp * 0.18);
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
    ctx.restore();
  }

  private drawItemArtwork(item: ItemDefinition, opacity = 1) {
    const sprite = ITEM_ART[item.id];
    const image = sprite.asset === "junk-sprite-atlas.png" ? this.artwork.junk : this.artwork.risky;
    if (!this.imageReady(image)) return false;
    const sourceWidth = image.naturalWidth / sprite.columns;
    const sourceHeight = image.naturalHeight / sprite.rows;
    // Atlas cells are square. Drawing each cell at a uniform scale keeps the
    // front-view props from being stretched or flattened by a rectangular body.
    const visualSize = Math.max(item.width, item.height) * (item.shape === "circle" ? 1.1 : 1.06);
    const ctx = this.context;
    const previousAlpha = ctx.globalAlpha;
    ctx.globalAlpha = previousAlpha * opacity;
    ctx.drawImage(
      image,
      sprite.column * sourceWidth,
      sprite.row * sourceHeight,
      sourceWidth,
      sourceHeight,
      -visualSize / 2,
      -visualSize / 2,
      visualSize,
      visualSize,
    );
    ctx.globalAlpha = previousAlpha;
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

function colorMix(from: [number, number, number], to: [number, number, number], amount: number) {
  const mix = (index: number) => Math.round(from[index] + (to[index] - from[index]) * amount);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

function materialThumbnailStyle(itemId: ItemId): CSSProperties {
  const sprite = ITEM_ICON_ART[itemId];
  const x = sprite.columns === 1 ? 0 : (sprite.column / (sprite.columns - 1)) * 100;
  const y = sprite.rows === 1 ? 0 : (sprite.row / (sprite.rows - 1)) * 100;
  return {
    backgroundImage: `url(/assets/${sprite.asset})`,
    backgroundPosition: `${x}% ${y}%`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${sprite.columns * 100}% ${sprite.rows * 100}%`,
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
}

function GameStage({ level }: GameStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<TowerPhysicsGame | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() => initialSnapshot(level));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = new TowerPhysicsGame(canvas, level, setSnapshot, () => undefined);
    gameRef.current = game;
    game.start();
    return () => {
      game.destroy();
      gameRef.current = null;
    };
  }, [level]);

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
          {isInteractive && <button className="reset-action" type="button" aria-label="重新开始本关" onClick={() => gameRef.current?.restart()}>↻</button>}
          {snapshot.status === "activating" && (
            <div className="activation-strip" aria-live="polite">
              <span>地表复苏中</span><div><i style={{ width: `${snapshot.activationProgress * 100}%` }} /></div><b>{Math.round(snapshot.activationProgress * 100)}%</b>
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
          {(snapshot.status === "cleared" || snapshot.status === "failed") && (
            <div className={`result-overlay ${snapshot.status}`}>
              <div className="result-symbol">{snapshot.status === "cleared" ? "✦" : "↯"}</div>
              <strong>{snapshot.status === "cleared" ? "抵达新芽" : "堆叠失败"}</strong>
              <p>{snapshot.status === "cleared" ? "99 米处的生命正在复苏。" : "物件必须连续堆在上一件物品上。"}</p>
              {snapshot.status === "cleared" && <button className="primary-action" onClick={() => gameRef.current?.restart()}>再次挑战</button>}
              {snapshot.status === "failed" && <button className="primary-action" onClick={() => gameRef.current?.restart()}>重新搭建</button>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function DawnTowerGame() {
  const level = LEVELS[0];

  return (
    <main className="game-app minimal-game">
      <h1 className="sr-only">余烬之光</h1>
      <GameStage key={level.id} level={level} />
    </main>
  );
}
