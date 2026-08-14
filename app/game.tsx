"use client";

import Matter from "matter-js";
import { useCallback, useEffect, useRef, useState } from "react";

const { Bodies, Body, Composite, Engine, World } = Matter;

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 700;
const BASE_X = 500;
const BASE_Y = 590;
const PIXELS_PER_METER = 5;
const RECOVERY_Y = BASE_Y + 94;

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

type GameStatus = "building" | "cleared" | "failed";

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
  targetOffset: number;
}

interface HeldItem {
  itemId: ItemId;
  x: number;
  y: number;
  angle: number;
  pointerId?: number;
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
}

const ITEMS: Record<ItemId, ItemDefinition> = {
  pallet: {
    id: "pallet", name: "木托盘", shortName: "托", role: "foundation", shape: "box", width: 160, height: 17,
    density: 0.0022, friction: 0.88, frictionStatic: 1.05, restitution: 0.01, color: "#9b6b45", accent: "#d3a271", trait: "宽 · 稳",
  },
  slab: {
    id: "slab", name: "混凝土板", shortName: "板", role: "foundation", shape: "box", width: 174, height: 23,
    density: 0.0044, friction: 0.94, frictionStatic: 1.2, restitution: 0.005, color: "#66747a", accent: "#9ba9a9", trait: "极重 · 防滑",
  },
  container: {
    id: "container", name: "旧集装箱", shortName: "箱", role: "foundation", shape: "box", width: 112, height: 66,
    density: 0.0033, friction: 0.78, frictionStatic: 0.96, restitution: 0.01, color: "#536f74", accent: "#a2b8a7", trait: "重 · 可堆高",
  },
  car: {
    id: "car", name: "报废车壳", shortName: "车", role: "foundation", shape: "box", width: 148, height: 55,
    density: 0.0048, friction: 0.74, frictionStatic: 0.9, restitution: 0.02, color: "#785751", accent: "#c18c68", trait: "宽 · 压重",
  },
  cabinet: {
    id: "cabinet", name: "铁皮柜", shortName: "柜", role: "tall", shape: "box", width: 47, height: 84,
    density: 0.0031, friction: 0.73, frictionStatic: 0.9, restitution: 0.02, color: "#6c7c65", accent: "#b9c697", trait: "高 · 偏重",
  },
  sofa: {
    id: "sofa", name: "旧沙发", shortName: "沙", role: "foundation", shape: "box", width: 116, height: 43,
    density: 0.0028, friction: 0.85, frictionStatic: 1.05, restitution: 0.02, color: "#75554c", accent: "#ca9880", trait: "宽 · 高摩擦",
  },
  beam: {
    id: "beam", name: "废旧钢梁", shortName: "梁", role: "bridge", shape: "box", width: 176, height: 15,
    density: 0.0032, friction: 0.8, frictionStatic: 0.98, restitution: 0.01, color: "#7e8382", accent: "#d1c9a8", trait: "长 · 可桥接",
  },
  ladder: {
    id: "ladder", name: "金属梯", shortName: "梯", role: "bridge", shape: "box", width: 136, height: 15,
    density: 0.0019, friction: 0.63, frictionStatic: 0.75, restitution: 0.03, color: "#8b9d87", accent: "#d6dfba", trait: "轻 · 易翘",
  },
  pipes: {
    id: "pipes", name: "管束", shortName: "管", role: "bridge", shape: "box", width: 128, height: 25,
    density: 0.0029, friction: 0.58, frictionStatic: 0.7, restitution: 0.04, color: "#647a82", accent: "#b1c2c6", trait: "长 · 易滑",
  },
  crate: {
    id: "crate", name: "回收箱", shortName: "箱", role: "block", shape: "box", width: 58, height: 31,
    density: 0.0025, friction: 0.81, frictionStatic: 0.98, restitution: 0.015, color: "#b7784f", accent: "#e2ae70", trait: "规则 · 易堆",
  },
  fridge: {
    id: "fridge", name: "旧冰箱", shortName: "冰", role: "tall", shape: "box", width: 45, height: 74,
    density: 0.0038, friction: 0.74, frictionStatic: 0.88, restitution: 0.01, color: "#7790a0", accent: "#d6e0d5", trait: "高 · 可封顶",
  },
  washer: {
    id: "washer", name: "洗衣机", shortName: "洗", role: "block", shape: "box", width: 51, height: 51,
    density: 0.0034, friction: 0.76, frictionStatic: 0.93, restitution: 0.01, color: "#8e9e9a", accent: "#cbd6cd", trait: "方正 · 压重",
  },
  computer: {
    id: "computer", name: "旧电脑", shortName: "机", role: "block", shape: "box", width: 54, height: 30,
    density: 0.0018, friction: 0.64, frictionStatic: 0.74, restitution: 0.04, color: "#57636b", accent: "#9daeb5", trait: "小 · 填缝",
  },
  scaffold: {
    id: "scaffold", name: "脚手架", shortName: "架", role: "tall", shape: "box", width: 68, height: 108,
    density: 0.0022, friction: 0.68, frictionStatic: 0.81, restitution: 0.02, color: "#76866c", accent: "#d6cc88", trait: "很高 · 须居中",
  },
  barrel: {
    id: "barrel", name: "旧油桶", shortName: "桶", role: "risky", shape: "circle", width: 42, height: 42,
    density: 0.0024, friction: 0.38, frictionStatic: 0.48, restitution: 0.15, color: "#a37445", accent: "#edc161", trait: "会滚动",
  },
  tire: {
    id: "tire", name: "轮胎", shortName: "胎", role: "risky", shape: "circle", width: 46, height: 46,
    density: 0.0027, friction: 0.54, frictionStatic: 0.68, restitution: 0.2, color: "#333b3a", accent: "#9fa78c", trait: "弹性 · 可配重",
  },
  bicycle: {
    id: "bicycle", name: "旧自行车", shortName: "车", role: "risky", shape: "box", width: 95, height: 42,
    density: 0.0013, friction: 0.34, frictionStatic: 0.42, restitution: 0.08, color: "#6e7e5f", accent: "#d2b86a", trait: "轻 · 难稳定",
  },
  chair: {
    id: "chair", name: "办公椅", shortName: "椅", role: "risky", shape: "box", width: 53, height: 66,
    density: 0.0016, friction: 0.4, frictionStatic: 0.52, restitution: 0.05, color: "#745f56", accent: "#c5a477", trait: "偏心 · 易倒",
  },
};

const LEVELS: LevelConfig[] = [
  { id: 1, target: 3, title: "枯竭广场", subtitle: "先铺出第一块稳固地基。", baseWidth: 356, wind: 0, targetOffset: 0, inventory: ["pallet", "crate", "crate", "beam", "tire", "computer"], hintItems: ["pallet", "crate", "beam"] },
  { id: 2, target: 5, title: "废弃街角", subtitle: "学会旋转横梁，保持重心居中。", baseWidth: 334, wind: 0, targetOffset: 0, inventory: ["pallet", "pallet", "crate", "fridge", "computer", "tire", "chair"], hintItems: ["pallet", "crate", "fridge"] },
  { id: 3, target: 8, title: "分类废品站", subtitle: "重物在下，轻物在上。", baseWidth: 314, wind: 0, targetOffset: 0, inventory: ["slab", "container", "crate", "fridge", "washer", "beam", "tire", "bicycle"], hintItems: ["slab", "container", "fridge"] },
  { id: 4, target: 14, title: "地下停车场", subtitle: "地基收窄，给塔身留出双侧支撑。", baseWidth: 270, wind: 0, targetOffset: 0, inventory: ["slab", "slab", "container", "container", "beam", "cabinet", "crate", "fridge", "tire", "chair"], hintItems: ["slab", "beam", "cabinet"] },
  { id: 5, target: 23, title: "废弃商场", subtitle: "横梁跨过缺口，再向上延伸。", baseWidth: 246, wind: 0, targetOffset: 0, inventory: ["slab", "container", "container", "sofa", "beam", "beam", "scaffold", "fridge", "washer", "crate", "barrel", "bicycle"], hintItems: ["slab", "beam", "scaffold"] },
  { id: 6, target: 35, title: "工业堆场", subtitle: "上层侧风已经出现，注意塔的重心。", baseWidth: 224, wind: 0.000004, targetOffset: 0, inventory: ["slab", "container", "container", "container", "car", "beam", "beam", "scaffold", "fridge", "cabinet", "washer", "crate", "pipes", "barrel"], hintItems: ["car", "beam", "scaffold"] },
  { id: 7, target: 50, title: "高架桥残骸", subtitle: "干扰物更多，稳定物料更珍贵。", baseWidth: 204, wind: 0.000006, targetOffset: 0, inventory: ["slab", "car", "container", "container", "container", "scaffold", "scaffold", "beam", "beam", "fridge", "cabinet", "washer", "crate", "pipes", "tire", "bicycle"], hintItems: ["car", "beam", "scaffold"] },
  { id: 8, target: 68, title: "旧港口", subtitle: "风向会变化，降低顶端摆动。", baseWidth: 184, wind: 0.000008, targetOffset: 0, inventory: ["slab", "slab", "car", "container", "container", "container", "container", "scaffold", "scaffold", "beam", "beam", "fridge", "cabinet", "washer", "crate", "ladder", "pipes", "tire"], hintItems: ["slab", "container", "scaffold"] },
  { id: 9, target: 83, title: "污染塔外环", subtitle: "拉绳偏离中心，先横向架桥。", baseWidth: 164, wind: 0.00001, targetOffset: 78, inventory: ["slab", "slab", "car", "container", "container", "container", "container", "scaffold", "scaffold", "scaffold", "beam", "beam", "beam", "fridge", "cabinet", "washer", "crate", "ladder", "pipes", "tire"], hintItems: ["car", "beam", "scaffold"] },
  { id: 10, target: 99, title: "黎明光塔", subtitle: "最后一座塔，穿过风带点亮世界。", baseWidth: 144, wind: 0.000013, targetOffset: 48, inventory: ["slab", "slab", "car", "container", "container", "container", "container", "container", "scaffold", "scaffold", "scaffold", "scaffold", "beam", "beam", "beam", "fridge", "fridge", "cabinet", "washer", "crate", "ladder", "pipes"], hintItems: ["car", "beam", "scaffold"] },
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
    { itemId: third, xMeters: level.targetOffset / PIXELS_PER_METER, yMeters: finalHeight, rotation: 0, text: `最后用「${ITEMS[third].name}」封顶，保持水平接近拉绳。` },
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
  private clearAt = 0;
  private frameId = 0;
  private baseBody: Matter.Body | null = null;

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
    this.createWorld();
  }

  start() {
    window.addEventListener("pointermove", this.onPointerMove, { passive: false });
    window.addEventListener("pointerup", this.onPointerUp, { passive: false });
    window.addEventListener("keydown", this.onKeyDown);
    this.emit(true);
    this.frameId = window.requestAnimationFrame(this.tick);
  }

  destroy() {
    window.cancelAnimationFrame(this.frameId);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
    Composite.clear(this.engine.world, false, true);
    Engine.clear(this.engine);
  }

  startHolding(itemId: ItemId, clientX: number, clientY: number, pointerId: number) {
    if (this.status !== "building" || this.inventory[itemId] <= 0) return;
    const point = this.clientToWorld(clientX, clientY);
    this.held = { itemId, x: point.x, y: point.y, angle: 0, pointerId };
    this.message = `正在搬运「${ITEMS[itemId].name}」：拖到中央区域后松手。Q / E 也可旋转。`;
    this.emit(true);
  }

  pickOnCanvas(clientX: number, clientY: number, pointerId: number) {
    if (!this.held || this.status !== "building") return;
    const point = this.clientToWorld(clientX, clientY);
    this.held.x = point.x;
    this.held.y = point.y;
    this.held.pointerId = pointerId;
  }

  rotateHeld(direction: -1 | 1) {
    if (!this.held || this.status !== "building") return;
    this.held.angle += direction * (Math.PI / 12);
    this.message = `「${ITEMS[this.held.itemId].name}」已旋转 ${direction > 0 ? "+" : "-"}15°。`;
    this.emit(true);
  }

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
    this.inventory = inventoryFor(this.level);
    this.height = 0;
    this.stableHeight = 0;
    this.stableElapsed = 0;
    this.collapseElapsed = 0;
    this.hintIndex = 0;
    this.hintsLeft = 3;
    this.activeHint = null;
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
      positionIterations: 10,
      velocityIterations: 8,
      constraintIterations: 3,
      gravity: { x: 0, y: 1, scale: 0.001 },
    });
  }

  private createWorld() {
    const base = Bodies.rectangle(BASE_X, BASE_Y + 11, this.level.baseWidth, 22, {
      isStatic: true,
      friction: 1,
      frictionStatic: 1,
      label: "base",
    });
    const recoveryFloor = Bodies.rectangle(WORLD_WIDTH / 2, RECOVERY_Y + 13, WORLD_WIDTH, 26, {
      isStatic: true,
      friction: 0.8,
      label: "recovery-floor",
    });
    const leftWall = Bodies.rectangle(16, RECOVERY_Y - 10, 32, 180, { isStatic: true, label: "boundary" });
    const rightWall = Bodies.rectangle(WORLD_WIDTH - 16, RECOVERY_Y - 10, 32, 180, { isStatic: true, label: "boundary" });
    this.baseBody = base;
    World.add(this.engine.world, [base, recoveryFloor, leftWall, rightWall]);
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    if (!this.held || this.held.pointerId !== event.pointerId || this.status !== "building") return;
    event.preventDefault();
    const point = this.clientToWorld(event.clientX, event.clientY);
    this.held.x = point.x;
    this.held.y = point.y;
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (!this.held || this.held.pointerId !== event.pointerId) return;
    const point = this.clientToWorld(event.clientX, event.clientY);
    const inCanvas = point.x >= 38 && point.x <= WORLD_WIDTH - 38 && point.y >= 52 && point.y <= BASE_Y - 3;
    this.held.pointerId = undefined;
    if (inCanvas) {
      event.preventDefault();
      this.placeHeld(point.x, point.y);
    } else {
      this.message = `已选择「${ITEMS[this.held.itemId].name}」，点击或拖入建造区后松手。`;
      this.emit(true);
    }
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
    if (event.key === "Escape" && this.held) {
      this.held = null;
      this.message = "已放回当前物料，不会消耗数量。";
      this.emit(true);
    }
  };

  private placeHeld(x: number, y: number) {
    if (!this.held || this.status !== "building") return;
    const item = ITEMS[this.held.itemId];
    const snappedX = Math.round(x / 5) * 5;
    const snappedY = Math.round(y / 5) * 5;
    const body = this.makeBody(item, snappedX, snappedY, this.held.angle);
    this.dynamicBodies.push(body);
    World.add(this.engine.world, body);
    this.inventory[item.id] -= 1;
    if (this.activeHint?.itemId === item.id) this.activeHint = null;
    this.message = `「${item.name}」已释放，等待塔身稳定。`;
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
      slop: 0.04,
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
    this.accumulator += delta;
    while (this.accumulator >= 16.667) {
      Engine.update(this.engine, 16.667);
      this.accumulator -= 16.667;
    }
    this.updateSimulation(delta);
    this.render(now);
    if (now - this.lastUiUpdate > 110) {
      this.emit();
      this.lastUiUpdate = now;
    }
    this.frameId = window.requestAnimationFrame(this.tick);
  };

  private updateSimulation(delta: number) {
    if (this.status !== "building") return;
    const towerBodies = this.towerBodies();
    if (this.level.wind > 0 && towerBodies.length > 0) {
      const phase = Math.sin(this.elapsed / 850) + Math.sin(this.elapsed / 1600) * 0.55;
      towerBodies.forEach((body) => {
        const aboveBase = Math.max(0, BASE_Y - body.position.y) / 240;
        if (aboveBase > 0.22) {
          Body.applyForce(body, body.position, { x: phase * this.level.wind * body.mass * aboveBase, y: 0 });
        }
      });
    }

    this.recoverMisplacedBodies();
    const currentHeight = this.measureHeight();
    this.height = currentHeight;
    const stable = towerBodies.length > 0 && towerBodies.every((body) => body.speed < 0.33 && Math.abs(body.angularVelocity) < 0.035);
    if (stable) {
      this.stableElapsed += delta;
      if (this.stableElapsed > 620) this.stableHeight = Math.max(this.stableHeight, currentHeight);
    } else {
      this.stableElapsed = 0;
    }

    const fallenCount = this.dynamicBodies.filter((body) => this.isFallen(body)).length;
    const meaningfulCollapse = this.stableHeight > Math.max(5, this.level.target * 0.34)
      && currentHeight < this.stableHeight * 0.63;
    if ((fallenCount >= 2 && this.dynamicBodies.length >= 3) || meaningfulCollapse) {
      this.collapseElapsed += delta;
      if (this.collapseElapsed > 720) this.fail();
    } else {
      this.collapseElapsed = 0;
    }

    if (currentHeight >= this.level.target && stable && this.stableElapsed > 1250) this.clear();
  }

  private recoverMisplacedBodies() {
    const refundable = this.dynamicBodies.filter((body) =>
      this.isFallen(body)
      && this.stableHeight < this.level.target * 0.35
      && this.elapsed - (body.gameBornAt ?? this.elapsed) > 900,
    );
    refundable.forEach((body) => {
      const item = body.gameItem;
      if (item) this.inventory[item.id] += 1;
      World.remove(this.engine.world, body);
      this.dynamicBodies = this.dynamicBodies.filter((candidate) => candidate !== body);
      this.message = "物件掉入回收带，已退回物料库。";
    });
  }

  private towerBodies() {
    return this.dynamicBodies.filter((body) => !this.isFallen(body));
  }

  private isFallen(body: Matter.Body) {
    return body.position.y > BASE_Y + 62 || body.position.x < 42 || body.position.x > WORLD_WIDTH - 42;
  }

  private measureHeight() {
    const tower = this.towerBodies();
    if (!tower.length) return 0;
    const top = Math.min(...tower.map((body) => body.bounds.min.y));
    return Math.max(0, (BASE_Y - top) / PIXELS_PER_METER);
  }

  private clear() {
    if (this.status !== "building") return;
    this.status = "cleared";
    this.clearAt = this.elapsed;
    this.message = this.level.id === 10 ? "最后的光源已启动，世界重新拥有黎明。" : "塔身稳定！拾光者正在拉下点亮世界的绳索。";
    this.onClear();
    this.emit(true);
  }

  private fail() {
    if (this.status !== "building") return;
    this.status = "failed";
    this.message = "塔身失去支撑并倒塌了。调整底座和重心后再试一次。";
    this.emit(true);
  }

  private clientToWorld(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * WORLD_WIDTH,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * WORLD_HEIGHT,
    };
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
    });
  }

  private render(now: number) {
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

    const illuminate = this.status === "cleared" ? clamp((this.elapsed - this.clearAt) / 3600, 0, 1) : 0;
    this.drawScene(illuminate, now);
    this.drawWorld(illuminate);
  }

  private drawScene(illuminate: number, now: number) {
    const ctx = this.context;
    const sky = ctx.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
    sky.addColorStop(0, colorMix([26, 46, 49], [99, 177, 195], illuminate));
    sky.addColorStop(0.62, colorMix([47, 63, 60], [201, 227, 192], illuminate));
    sky.addColorStop(1, colorMix([67, 71, 63], [111, 166, 97], illuminate));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    ctx.fillStyle = `rgba(22, 31, 31, ${0.56 - illuminate * 0.35})`;
    for (let index = 0; index < 13; index += 1) {
      const x = index * 88 - 20;
      const h = 48 + ((index * 37) % 92);
      ctx.fillRect(x, BASE_Y - 48 - h, 58, h);
      ctx.fillStyle = `rgba(117, 145, 125, ${0.18 + illuminate * 0.32})`;
      ctx.fillRect(x + 9, BASE_Y - 40 - h, 10, 5);
      ctx.fillStyle = `rgba(22, 31, 31, ${0.56 - illuminate * 0.35})`;
    }

    const lightX = BASE_X + this.level.targetOffset;
    const goalY = BASE_Y - this.level.target * PIXELS_PER_METER;
    if (illuminate > 0) {
      const glow = ctx.createRadialGradient(lightX, 72, 5, lightX, 72, 330);
      glow.addColorStop(0, `rgba(255, 242, 169, ${0.55 * illuminate})`);
      glow.addColorStop(1, "rgba(255, 242, 169, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      ctx.fillStyle = `rgba(111, 181, 83, ${0.58 * illuminate})`;
      ctx.fillRect(0, RECOVERY_Y, WORLD_WIDTH, WORLD_HEIGHT - RECOVERY_Y);
      ctx.strokeStyle = `rgba(52, 120, 60, ${0.75 * illuminate})`;
      ctx.lineWidth = 2;
      for (let x = 18; x < WORLD_WIDTH; x += 23) {
        const wiggle = Math.sin((x + now / 11) / 28) * 4;
        ctx.beginPath();
        ctx.moveTo(x, RECOVERY_Y + 12);
        ctx.lineTo(x + wiggle, RECOVERY_Y + 3);
        ctx.stroke();
      }
    }

    ctx.fillStyle = "rgba(21, 29, 30, 0.86)";
    ctx.fillRect(0, RECOVERY_Y + 15, WORLD_WIDTH, WORLD_HEIGHT - RECOVERY_Y);
    ctx.fillStyle = colorMix([113, 88, 69], [116, 158, 79], illuminate);
    ctx.fillRect(0, RECOVERY_Y - 2, WORLD_WIDTH, 18);

    ctx.strokeStyle = "rgba(227, 204, 145, 0.92)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lightX, 82);
    ctx.lineTo(lightX, goalY + 12);
    ctx.stroke();
    ctx.fillStyle = colorMix([50, 54, 54], [255, 218, 112], illuminate);
    ctx.beginPath();
    ctx.arc(lightX, 70, 16 + illuminate * 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 242, 180, 0.75)";
    ctx.stroke();

    ctx.save();
    ctx.setLineDash([7, 8]);
    ctx.strokeStyle = "rgba(255, 217, 122, 0.88)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(46, goalY);
    ctx.lineTo(WORLD_WIDTH - 46, goalY);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#ffe49b";
    ctx.font = "700 14px Microsoft YaHei";
    ctx.fillText(`目标 ${this.level.target}m`, 58, goalY - 10);

    if (this.level.wind > 0) {
      const windShift = Math.sin(this.elapsed / 850);
      ctx.fillStyle = "rgba(222, 242, 211, 0.66)";
      ctx.font = "12px Microsoft YaHei";
      ctx.fillText(`${windShift > 0 ? "→" : "←"} 顶部侧风`, WORLD_WIDTH - 138, 49);
    }

    this.drawRobot(lightX - 34, Math.max(101, goalY - 49), illuminate);
  }

  private drawWorld(illuminate: number) {
    const ctx = this.context;
    const baseWidth = this.level.baseWidth;
    ctx.fillStyle = "#46575a";
    roundedRect(ctx, BASE_X - baseWidth / 2, BASE_Y - 3, baseWidth, 20, 6);
    ctx.fill();
    ctx.fillStyle = "rgba(187, 209, 196, 0.38)";
    ctx.fillRect(BASE_X - baseWidth / 2 + 10, BASE_Y + 3, baseWidth - 20, 3);
    ctx.fillStyle = "rgba(241, 126, 93, 0.55)";
    ctx.fillRect(0, RECOVERY_Y + 4, WORLD_WIDTH, 2);
    ctx.fillStyle = "rgba(222, 192, 163, 0.55)";
    ctx.font = "12px Microsoft YaHei";
    ctx.fillText("回收带", 32, RECOVERY_Y + 34);

    this.dynamicBodies.forEach((body) => this.drawItem(body));
    if (this.activeHint) this.drawHint(this.activeHint);
    if (this.held) this.drawGhost(this.held);

    if (this.status === "cleared") {
      ctx.fillStyle = `rgba(255, 240, 166, ${0.12 + illuminate * 0.18})`;
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    }
  }

  private drawItem(body: TaggedBody) {
    const item = body.gameItem;
    if (!item) return;
    const ctx = this.context;
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    if (item.shape === "circle") {
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(0, 0, item.width / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = item.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, item.width * 0.22, 0, Math.PI * 2);
      ctx.stroke();
    } else {
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
    if (item.width >= 45 && item.height >= 25) {
      ctx.fillStyle = "rgba(246, 243, 219, 0.9)";
      ctx.font = `700 ${Math.min(16, Math.max(10, item.height * 0.34))}px Microsoft YaHei`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(item.shortName, 0, 1);
    }
    ctx.restore();
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
    if (item.shape === "circle") {
      ctx.beginPath();
      ctx.arc(0, 0, item.width / 2, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      roundedRect(ctx, -item.width / 2, -item.height / 2, item.width, item.height, Math.min(8, item.height / 3));
      ctx.stroke();
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
    if (item.shape === "circle") {
      ctx.beginPath();
      ctx.arc(0, 0, item.width / 2 + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      roundedRect(ctx, -item.width / 2 - 4, -item.height / 2 - 4, item.width + 8, item.height + 8, 7);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = "#d9f7b7";
    ctx.font = "700 13px Microsoft YaHei";
    ctx.fillText("提示落点", x + 10, y - item.height / 2 - 12);
  }

  private drawRobot(x: number, y: number, illuminate: number) {
    const ctx = this.context;
    const pulling = this.status === "cleared" ? clamp((this.elapsed - this.clearAt - 450) / 900, 0, 1) : 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#d8b95d";
    roundedRect(ctx, 0, 13, 38, 30, 7);
    ctx.fill();
    ctx.fillStyle = "#25343b";
    roundedRect(ctx, 7, 4, 24, 18, 5);
    ctx.fill();
    ctx.fillStyle = colorMix([112, 170, 159], [255, 241, 161], illuminate);
    ctx.beginPath();
    ctx.arc(19, 13, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c3a95e";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(34, 22);
    ctx.lineTo(44, 12 - pulling * 18);
    ctx.lineTo(45 + pulling * 3, 3);
    ctx.stroke();
    ctx.fillStyle = "#3a4b47";
    ctx.fillRect(5, 42, 9, 7);
    ctx.fillRect(24, 42, 9, 7);
    ctx.restore();
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function colorMix(from: [number, number, number], to: [number, number, number], amount: number) {
  const mix = (index: number) => Math.round(from[index] + (to[index] - from[index]) * amount);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
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
  onClear: () => void;
  onNext: () => void;
}

function GameStage({ level, onClear, onNext }: GameStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<TowerPhysicsGame | null>(null);
  const onClearRef = useRef(onClear);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() => initialSnapshot(level));

  useEffect(() => { onClearRef.current = onClear; }, [onClear]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = new TowerPhysicsGame(canvas, level, setSnapshot, () => onClearRef.current());
    gameRef.current = game;
    game.start();
    return () => {
      game.destroy();
      gameRef.current = null;
    };
  }, [level]);

  const heightLimit = Math.max(level.target * 1.13, 8);
  const currentPercent = clamp(snapshot.height / heightLimit, 0, 1) * 100;
  const targetPercent = clamp(level.target / heightLimit, 0, 1) * 100;
  const isInteractive = snapshot.status === "building";

  return (
    <section className="game-layout" aria-label={`第 ${level.id} 关：${level.title}`}>
      <aside className="height-panel panel">
        <div className="panel-kicker">高度仪</div>
        <div className="height-reading"><strong>{snapshot.height.toFixed(1)}</strong><span>m</span></div>
        <div className="height-sub">稳定记录 {snapshot.stableHeight.toFixed(1)}m</div>
        <div className="ruler-wrap" aria-label={`当前 ${snapshot.height.toFixed(1)} 米，目标 ${level.target} 米`}>
          <div className="ruler-track">
            <div className="ruler-fill" style={{ height: `${currentPercent}%` }} />
            <div className="goal-tick" style={{ bottom: `${targetPercent}%` }}><span>{level.target}m</span></div>
            {Array.from({ length: 6 }, (_, index) => <span className="minor-tick" key={index} style={{ bottom: `${index * 20}%` }} />)}
            <div className="current-pin" style={{ bottom: `${currentPercent}%` }}><span>{snapshot.height.toFixed(1)}</span></div>
          </div>
          <span className="zero-label">0m</span>
        </div>
      </aside>

      <div className="stage-stack">
        <div className="stage-caption">
          <div><span className="level-badge">关卡 {level.id}</span><strong>{level.title}</strong></div>
          <span className={snapshot.wind ? "wind-on" : "wind-off"}>{snapshot.wind ? "侧风活跃" : "无侧风"}</span>
        </div>
        <div className="canvas-wrap">
          <canvas
            ref={canvasRef}
            className="game-canvas"
            aria-label="垃圾物理堆叠建造区"
            onPointerDown={(event) => {
              event.preventDefault();
              gameRef.current?.pickOnCanvas(event.clientX, event.clientY, event.pointerId);
            }}
          />
          <div className="scene-instruction">{snapshot.heldItem ? `正在搬运：${ITEMS[snapshot.heldItem].name}` : "按住右侧物料拖进场景"}</div>
          {snapshot.status !== "building" && (
            <div className={`result-overlay ${snapshot.status}`}>
              <div className="result-symbol">{snapshot.status === "cleared" ? "✦" : "↯"}</div>
              <strong>{snapshot.status === "cleared" ? (level.id === 10 ? "黎明归来" : "光源已点亮") : "高塔倒塌"}</strong>
              <p>{snapshot.status === "cleared" ? "土地正在恢复生机。" : "重新调整底座与重心，再挑战一次。"}</p>
              {snapshot.status === "cleared" && <button className="primary-action" onClick={level.id === 10 ? () => gameRef.current?.restart() : onNext}>{level.id === 10 ? "再次照亮" : "进入下一关"}</button>}
              {snapshot.status === "failed" && <button className="primary-action" onClick={() => gameRef.current?.restart()}>重新搭建</button>}
            </div>
          )}
        </div>
        <div className="message-bar" role="status"><span>◆</span>{snapshot.message}</div>
        <div className="build-controls">
          <button className="hint-button" disabled={!isInteractive || snapshot.hintsLeft === 0} onClick={() => gameRef.current?.useHint()}>
            <span>提示</span><b>{snapshot.hintsLeft}/3</b>
          </button>
          <div className="rotate-group" aria-label="旋转当前物件">
            <button disabled={!snapshot.heldItem || !isInteractive} onClick={() => gameRef.current?.rotateHeld(-1)}>↺ 15°</button>
            <button disabled={!snapshot.heldItem || !isInteractive} onClick={() => gameRef.current?.rotateHeld(1)}>15° ↻</button>
          </div>
          <button className="restart-button" onClick={() => gameRef.current?.restart()}>重试本关</button>
        </div>
        {snapshot.hint && <div className="hint-copy"><b>明确提示</b>{snapshot.hint.text}</div>}
      </div>

      <aside className="inventory-panel panel">
        <div className="inventory-head"><div><div className="panel-kicker">可用物料</div><strong>{level.inventory.length} 件</strong></div><span>拖拽使用</span></div>
        <div className="inventory-list">
          {Object.entries(snapshot.inventory)
            .filter(([, count]) => count > 0)
            .map(([id, count]) => {
              const item = ITEMS[id as ItemId];
              const highlighted = snapshot.hint?.itemId === item.id;
              return (
                <button
                  className={`material-card ${highlighted ? "recommended" : ""}`}
                  type="button"
                  key={item.id}
                  disabled={!isInteractive}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    gameRef.current?.startHolding(item.id, event.clientX, event.clientY, event.pointerId);
                  }}
                  aria-label={`拖拽 ${item.name}，剩余 ${count} 件`}
                >
                  <span className={`material-icon ${item.role}`}>{item.shortName}</span>
                  <span className="material-copy"><b>{item.name}</b><small>{item.trait}</small></span>
                  <span className="material-count">×{count}</span>
                </button>
              );
            })}
          {Object.values(snapshot.inventory).every((count) => count === 0) && <p className="empty-inventory">物料已经用完，建议重试本关。</p>}
        </div>
      </aside>
    </section>
  );
}

export function DawnTowerGame() {
  const [unlocked, setUnlocked] = useState(1);
  const [activeLevel, setActiveLevel] = useState(1);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem("dawn-tower-unlocked"));
    if (Number.isFinite(saved) && saved >= 1 && saved <= 10) setUnlocked(saved);
  }, []);

  useEffect(() => {
    if (unlocked > 1) window.localStorage.setItem("dawn-tower-unlocked", String(unlocked));
  }, [unlocked]);

  const level = LEVELS[activeLevel - 1];
  const clearLevel = useCallback(() => {
    setUnlocked((current) => Math.max(current, Math.min(10, activeLevel + 1)));
  }, [activeLevel]);
  const nextLevel = useCallback(() => {
    setActiveLevel((current) => (current === 10 ? 10 : current + 1));
  }, []);

  return (
    <main className="game-app">
      <header className="game-header">
        <div className="brand-lockup">
          <span className="brand-sun">✦</span>
          <div><p>ASHES TO AURORA · PHYSICS PUZZLE</p><h1>余烬之光</h1></div>
        </div>
        <div className="story-copy">用垃圾搭出一座不会倒的高塔。够高、够稳，拾光者便会拉下替代太阳的拉绳。</div>
      </header>

      <nav className="level-rail" aria-label="选择关卡">
        {LEVELS.map((candidate) => {
          const isLocked = candidate.id > unlocked;
          return (
            <button
              key={candidate.id}
              className={`${candidate.id === activeLevel ? "active" : ""} ${isLocked ? "locked" : ""}`}
              disabled={isLocked}
              onClick={() => setActiveLevel(candidate.id)}
              aria-label={isLocked ? `第 ${candidate.id} 关尚未解锁` : `进入第 ${candidate.id} 关，目标 ${candidate.target} 米`}
            >
              <span>{isLocked ? "⌁" : candidate.id}</span><small>{candidate.target}m</small>
            </button>
          );
        })}
      </nav>

      <section className="level-summary">
        <div><span>目标高度</span><strong>{level.target}m</strong></div>
        <p>{level.subtitle}</p>
        <div className="progress-note">已解锁 <b>{unlocked}</b> / 10 关</div>
      </section>

      <GameStage key={level.id} level={level} onClear={clearLevel} onNext={nextLevel} />

      <footer className="game-footer">原创回收机器人「拾光者」· 物理堆叠原型 · 鼠标/触摸拖拽 · Q/E 旋转</footer>
    </main>
  );
}
