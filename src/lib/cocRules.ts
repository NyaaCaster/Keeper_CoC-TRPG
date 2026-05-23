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
