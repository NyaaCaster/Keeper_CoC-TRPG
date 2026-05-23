/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CoC 7e 战斗派生数值（Damage Bonus / Build / Move Rate）。
 *
 * 三者完全由 STR / SIZ / DEX / age 决定，所以不进 CharacterSheet，
 * 在需要结算或注入 Keeper prompt 时现算。
 *
 * 调用入口：deriveCombatStats(sheet)
 *
 * 数据源：CoC 7e Keeper Rulebook, "Characteristics" 章节 STR+SIZ 对照表。
 */
import type { CharacterSheet } from "../types";

/**
 * Damage Bonus 既可能是定值（-2 / -1 / 0），也可能是骰子（+1d4 / +1d6 / +2d6 ...）。
 * 用结构化对象描述，便于伤害结算时直接拼到 hpDamageFormula 上。
 *
 * - flat: 定值加成（含负值）。仅在 dice == null 时有意义；dice 存在时定值固定为 0。
 * - dice: 骰子表达，例如 "1d4" / "1d6" / "2d6"；无骰子加成时为 null。
 * - display: 给玩家看 / 拼 prompt 用的人类可读字符串，例如 "-2" / "0" / "+1d6"。
 */
export interface DamageBonus {
  flat: number;
  dice: string | null;
  display: string;
}

export interface CombatDerived {
  db: DamageBonus;
  build: number;
  mov: number;
}

/**
 * 八维属性的"半值 / 五分之一值"对照表（CoC 7e 卡面预印的 Half / Fifth 列）。
 *
 * 使用场景：
 *   - 困难成功（Hard）阈值 = floor(value / 2)
 *   - 极难成功（Extreme）阈值 = floor(value / 5)
 * 同时也用于属性对抗（例如 STR vs STR 困难/极难比较）。
 *
 * 不进 CharacterSheet——和 DB/Build/MOV 一样按需现算，不污染类型。
 */
export interface AttributeBreakpoint {
  full: number;
  half: number;   // floor(full / 2)
  fifth: number;  // floor(full / 5)
}

export type AttributeKey = "str" | "con" | "siz" | "dex" | "app" | "int" | "pow" | "edu" | "luck";

export type AttributeBreakpoints = Record<AttributeKey, AttributeBreakpoint>;

export function breakpointOf(value: number): AttributeBreakpoint {
  const full = Math.max(0, Math.floor(value));
  return {
    full,
    half: Math.floor(full / 2),
    fifth: Math.floor(full / 5),
  };
}

export function deriveAttributeBreakpoints(sheet: CharacterSheet): AttributeBreakpoints {
  const a = sheet.attributes;
  return {
    str: breakpointOf(a.str),
    con: breakpointOf(a.con),
    siz: breakpointOf(a.siz),
    dex: breakpointOf(a.dex),
    app: breakpointOf(a.app),
    int: breakpointOf(a.int),
    pow: breakpointOf(a.pow),
    edu: breakpointOf(a.edu),
    luck: breakpointOf(a.luck),
  };
}

/**
 * STR + SIZ → DB / Build。CoC 7e 标准对照表，超过 524 后每多 80 点 STR+SIZ
 * 多 +1d6 / +1 Build。
 */
export function computeDamageBonusAndBuild(strPlusSiz: number): { db: DamageBonus; build: number } {
  const sum = Math.max(0, strPlusSiz);
  if (sum <= 64) return { db: { flat: -2, dice: null, display: "-2" }, build: -2 };
  if (sum <= 84) return { db: { flat: -1, dice: null, display: "-1" }, build: -1 };
  if (sum <= 124) return { db: { flat: 0, dice: null, display: "0" }, build: 0 };
  if (sum <= 164) return { db: { flat: 0, dice: "1d4", display: "+1d4" }, build: 1 };
  if (sum <= 204) return { db: { flat: 0, dice: "1d6", display: "+1d6" }, build: 2 };

  // 205+：从 205 起每 80 点 STR+SIZ 多 +1d6 / +1 Build。
  // 205-284 → 2d6/B3, 285-364 → 3d6/B4, 365-444 → 4d6/B5, 445-524 → 5d6/B6 ...
  const diceCount = Math.max(2, Math.floor((sum - 125) / 80) + 1);
  const dice = `${diceCount}d6`;
  const build = diceCount + 1;
  return { db: { flat: 0, dice, display: `+${dice}` }, build };
}

/**
 * MOV 计算：
 * - DEX < SIZ 且 STR < SIZ → 7
 * - STR ≥ SIZ 或 DEX ≥ SIZ（其一）→ 8
 * - STR > SIZ 且 DEX > SIZ → 9
 * 年龄修正：40+ -1，50+ -2，60+ -3，70+ -4，80+ -5。
 * 下限固定为 1。
 */
export function computeMov(str: number, dex: number, siz: number, age: number): number {
  let base: number;
  if (str > siz && dex > siz) base = 9;
  else if (str < siz && dex < siz) base = 7;
  else base = 8;

  let penalty = 0;
  if (age >= 80) penalty = 5;
  else if (age >= 70) penalty = 4;
  else if (age >= 60) penalty = 3;
  else if (age >= 50) penalty = 2;
  else if (age >= 40) penalty = 1;

  return Math.max(1, base - penalty);
}

export function deriveCombatStats(sheet: CharacterSheet): CombatDerived {
  const { str, siz, dex } = sheet.attributes;
  const age = sheet.age || 30;
  const { db, build } = computeDamageBonusAndBuild(str + siz);
  const mov = computeMov(str, dex, siz, age);
  return { db, build, mov };
}

/**
 * 闪避基础值 = floor(DEX / 2)。
 *
 * 在 CoC 7e 规则里闪避是技能（可通过经验成长），但本项目把它当作派生战斗值现算，
 * 不写入 skills 表。如果未来要支持经验阶段加点，再改成"基础值 + 加点"的存量字段。
 */
export function dodgeOf(dex: number): number {
  return Math.max(0, Math.floor((dex || 0) / 2));
}

/**
 * 母语技能值 = EDU。
 *
 * 在 CoC 7e 规则里 Own Language 也是技能（基础值 = EDU，可通过经验成长），但本项目
 * 把"语言名称"作为叙事字段（CharacterSheet.motherTongue）、把"技能值"派生现算，
 * 不写入 skills 表。
 */
export function motherTongueValue(edu: number): number {
  return Math.max(0, Math.floor(edu || 0));
}

/**
 * 把 DB 拼到一个伤害公式后面。空伤害（"" / "0" / 等价 0）时返回原串，
 * 让上游照常按"无伤害"处理。
 *
 * 注意：CoC 7e 中只有近战 / 投掷武器吃 DB；火器伤害不加 DB。
 * 所以是否调用本函数应由调用方根据武器类型判断，而不是无条件拼上。
 */
export function appendDamageBonus(formula: string, db: DamageBonus): string {
  const trimmed = (formula ?? "").trim();
  if (!trimmed || trimmed === "0") return trimmed;
  if (db.dice) return `${trimmed}+${db.dice}`;
  if (db.flat > 0) return `${trimmed}+${db.flat}`;
  if (db.flat < 0) return `${trimmed}${db.flat}`;
  return trimmed;
}

/**
 * 起始现金（CoC 7e 玩家手册 Step 7 表）。
 * - 1920s: CR × $1
 * - modern: CR × $20
 *
 * 创建期不可调（玩家不应在 UI 直接编辑现金）；
 * 跑团时由 KP 维护"游戏中余额"，初值即本函数。
 */
export function startingCashOf(creditRating: number, era: "1920s" | "modern"): number {
  const cr = Math.max(0, Math.min(99, Math.floor(creditRating || 0)));
  return era === "modern" ? cr * 20 : cr;
}

export type LivingStandardTier = "penniless" | "poor" | "average" | "wealthy" | "rich" | "superRich";

/** 生活水准（CR → 阶级标签）。CoC 7e 玩家手册 Step 7 分级表。 */
export function livingStandardOf(creditRating: number): LivingStandardTier {
  const cr = Math.max(0, Math.min(99, Math.floor(creditRating || 0)));
  if (cr === 0) return "penniless";
  if (cr <= 9) return "poor";
  if (cr <= 49) return "average";
  if (cr <= 89) return "wealthy";
  if (cr <= 98) return "rich";
  return "superRich";
}

/** 阶级标签 → 中文显示名。 */
export function livingStandardLabel(tier: LivingStandardTier): string {
  switch (tier) {
    case "penniless": return "身无分文";
    case "poor": return "贫困";
    case "average": return "中等";
    case "wealthy": return "富有";
    case "rich": return "富豪";
    case "superRich": return "超级富豪";
  }
}

// ============================================================================
// 阶段 10：SAN 三层钳制 + 派生战斗值持久化
// ============================================================================

/**
 * SAN 硬上限 = 99 − 克苏鲁神话。
 *
 * 仅供规则计算，UI 不展示（游戏 UI 的 SAN 仪表只显示 san / maxSan）。
 * 在 mythos 变化时由 clampSanityLayers 用本函数收敛 sheet.maxSanLimit 与 maxSan / san。
 */
export function maxSanLimitOf(mythos: number): number {
  return Math.max(0, 99 - Math.max(0, mythos | 0));
}

/**
 * SAN 三层钳制：maxSanLimit → maxSan → san。
 *
 * mythos 上涨、永久 SAN 受损、临时 SAN 受损都走这一个函数收敛，避免分散修改导致漂移。
 * 调用前调用方自己更新 mythos / maxSan / san 的"当下值"，本函数只做夹紧不做加减。
 *
 * 返回值是新的字段子集（而非 mutate），调用方按需 spread 进 sheet。
 */
export function clampSanityLayers(
  sheet: Pick<CharacterSheet, "mythos" | "maxSan" | "san" | "maxSanLimit">,
): { mythos: number; maxSanLimit: number; maxSan: number; san: number } {
  const mythos = Math.max(0, sheet.mythos | 0);
  const maxSanLimit = maxSanLimitOf(mythos);
  const maxSan = Math.max(0, Math.min(sheet.maxSan, maxSanLimit));
  const san = Math.max(0, Math.min(sheet.san, maxSan));
  return { mythos, maxSanLimit, maxSan, san };
}

/**
 * 刷新 sheet.combatDerived 快照（不 mutate 入参，返回新 sheet 引用）。
 *
 * 在 server 任何修改 attributes.str / con / siz / dex 或 age 的出口处统一调用。
 * 客户端不直接调用。dodge 也一并写入快照（与 dodgeOf 口径一致）。
 */
export function refreshCombatDerived(sheet: CharacterSheet): CharacterSheet {
  const stats = deriveCombatStats(sheet);
  const dodge = dodgeOf(sheet.attributes.dex);
  return {
    ...sheet,
    combatDerived: {
      db: stats.db,
      build: stats.build,
      mov: stats.mov,
      dodge,
    },
  };
}
