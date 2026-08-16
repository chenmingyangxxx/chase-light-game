export type FixingMaterialId =
  | "woodPlank"
  | "hempRope"
  | "steelWire"
  | "ironPlate"
  | "rebar"
  | "ductTape"
  | "leatherBelt"
  | "ratchetStrap"
  | "chain"
  | "steelBand"
  | "nylonRope";

export type FixingMode = "brace" | "tie";

export interface FixingDefinition {
  id: FixingMaterialId;
  name: string;
  shortName: string;
  mode: FixingMode;
  massKg: number;
  tensileN: number;
  compressiveN: number;
  shearN: number;
  stiffness: number;
  damping: number;
  maxStrain: number;
  minLength: number;
  maxLength: number;
  width: number;
  failureLabel: string;
  column: number;
  row: number;
  quantity: number;
}

/**
 * Raw, real-world-inspired baseline values. The game's global three-times
 * strength multiplier is deliberately applied by the simulation, not here.
 * Length and width values use world metres; force values use newtons.
 */
export const FIXING_MATERIALS: Readonly<
  Record<FixingMaterialId, Readonly<FixingDefinition>>
> = {
  woodPlank: {
    id: "woodPlank",
    name: "废旧木板",
    shortName: "木板",
    mode: "brace",
    massKg: 7.2,
    tensileN: 18_000,
    compressiveN: 26_000,
    shearN: 5_500,
    stiffness: 0.72,
    damping: 0.12,
    maxStrain: 0.035,
    minLength: 0.5,
    maxLength: 4,
    width: 0.18,
    failureLabel: "木板已断裂",
    column: 0,
    row: 0,
    quantity: 3,
  },
  hempRope: {
    id: "hempRope",
    name: "旧麻绳",
    shortName: "麻绳",
    mode: "tie",
    massKg: 1.1,
    tensileN: 4_500,
    compressiveN: 0,
    shearN: 2_500,
    stiffness: 0.38,
    damping: 0.18,
    maxStrain: 0.16,
    minLength: 0.35,
    maxLength: 6,
    width: 0.07,
    failureLabel: "麻绳已绷断",
    column: 1,
    row: 0,
    quantity: 4,
  },
  steelWire: {
    id: "steelWire",
    name: "锈蚀钢丝绳",
    shortName: "钢丝",
    mode: "tie",
    massKg: 1.8,
    tensileN: 14_000,
    compressiveN: 0,
    shearN: 7_500,
    stiffness: 0.75,
    damping: 0.12,
    maxStrain: 0.045,
    minLength: 0.25,
    maxLength: 8,
    width: 0.035,
    failureLabel: "钢丝绳已崩断",
    column: 2,
    row: 0,
    quantity: 3,
  },
  ironPlate: {
    id: "ironPlate",
    name: "锈蚀铁板",
    shortName: "铁板",
    mode: "brace",
    massKg: 18,
    tensileN: 65_000,
    compressiveN: 90_000,
    shearN: 40_000,
    stiffness: 0.94,
    damping: 0.16,
    maxStrain: 0.018,
    minLength: 0.45,
    maxLength: 3.2,
    width: 0.32,
    failureLabel: "铁板已屈曲失效",
    column: 3,
    row: 0,
    quantity: 2,
  },
  rebar: {
    id: "rebar",
    name: "废旧钢筋",
    shortName: "钢筋",
    mode: "brace",
    massKg: 6.5,
    tensileN: 50_000,
    compressiveN: 50_000,
    shearN: 26_000,
    stiffness: 0.9,
    damping: 0.13,
    maxStrain: 0.024,
    minLength: 0.4,
    maxLength: 4.5,
    width: 0.06,
    failureLabel: "钢筋已弯折",
    column: 0,
    row: 1,
    quantity: 3,
  },
  ductTape: {
    id: "ductTape",
    name: "破旧布基胶带",
    shortName: "胶布",
    mode: "tie",
    massKg: 0.3,
    tensileN: 800,
    compressiveN: 0,
    shearN: 500,
    stiffness: 0.2,
    damping: 0.24,
    maxStrain: 0.3,
    minLength: 0.15,
    maxLength: 2.2,
    width: 0.12,
    failureLabel: "胶布已撕裂",
    column: 1,
    row: 1,
    quantity: 4,
  },
  leatherBelt: {
    id: "leatherBelt",
    name: "磨损皮带",
    shortName: "皮带",
    mode: "tie",
    massKg: 0.55,
    tensileN: 3_500,
    compressiveN: 0,
    shearN: 2_200,
    stiffness: 0.35,
    damping: 0.2,
    maxStrain: 0.14,
    minLength: 0.3,
    maxLength: 1.6,
    width: 0.09,
    failureLabel: "皮带已拉断",
    column: 3,
    row: 1,
    quantity: 3,
  },
  ratchetStrap: {
    id: "ratchetStrap",
    name: "旧棘轮捆绑带",
    shortName: "捆绑带",
    mode: "tie",
    massKg: 0.9,
    tensileN: 11_000,
    compressiveN: 0,
    shearN: 7_500,
    stiffness: 0.68,
    damping: 0.19,
    maxStrain: 0.07,
    minLength: 0.35,
    maxLength: 5,
    width: 0.08,
    failureLabel: "捆绑带已失效",
    column: 0,
    row: 2,
    quantity: 3,
  },
  chain: {
    id: "chain",
    name: "锈蚀铁链",
    shortName: "铁链",
    mode: "tie",
    massKg: 3.5,
    tensileN: 30_000,
    compressiveN: 0,
    shearN: 18_000,
    stiffness: 0.62,
    damping: 0.22,
    maxStrain: 0.08,
    minLength: 0.3,
    maxLength: 5,
    width: 0.09,
    failureLabel: "铁链已断裂",
    column: 1,
    row: 2,
    quantity: 2,
  },
  steelBand: {
    id: "steelBand",
    name: "废旧钢箍带",
    shortName: "钢箍带",
    mode: "tie",
    massKg: 2.2,
    tensileN: 18_000,
    compressiveN: 1_000,
    shearN: 10_000,
    stiffness: 0.8,
    damping: 0.14,
    maxStrain: 0.035,
    minLength: 0.3,
    maxLength: 4,
    width: 0.11,
    failureLabel: "钢箍带已崩开",
    column: 2,
    row: 2,
    quantity: 3,
  },
  nylonRope: {
    id: "nylonRope",
    name: "退色尼龙绳",
    shortName: "尼龙绳",
    mode: "tie",
    massKg: 0.8,
    tensileN: 6_500,
    compressiveN: 0,
    shearN: 3_900,
    stiffness: 0.32,
    damping: 0.2,
    maxStrain: 0.22,
    minLength: 0.35,
    maxLength: 7,
    width: 0.065,
    failureLabel: "尼龙绳已绷断",
    column: 3,
    row: 2,
    quantity: 4,
  },
};

export const FIXING_MATERIAL_ORDER = [
  "woodPlank",
  "hempRope",
  "steelWire",
  "ironPlate",
  "rebar",
  "ductTape",
  "leatherBelt",
  "ratchetStrap",
  "chain",
  "steelBand",
  "nylonRope",
] as const satisfies readonly FixingMaterialId[];

export function fixingInventoryFor(): Record<FixingMaterialId, number> {
  return FIXING_MATERIAL_ORDER.reduce<Record<FixingMaterialId, number>>(
    (inventory, id) => {
      inventory[id] = FIXING_MATERIALS[id].quantity;
      return inventory;
    },
    {} as Record<FixingMaterialId, number>,
  );
}
