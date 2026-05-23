/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 命运博弈（Fate Gamble）规则判定 — 详见 .docs/fate-gamble.md
 * 包含：孤注一掷（Push）/ 燃运（Burn Luck）的允许条件计算。
 * 所有判定均为前端硬规则，与 LLM 无关。
 */

import type { RollRequest, RollResult } from "../types";

const COMBAT_KEYWORDS = [
  "闪避", "斗殴", "招架", "格斗", "近战", "武术",
  "射击", "手枪", "步枪", "霰弹枪", "机枪", "冲锋枪", "狙击",
  "弓", "弩", "投掷",
];

const COMBAT_WEAPON_REGEX = /枪|箭|刀|剑|斧|锤|镖/;

const LUCK_KEYWORDS = ["幸运", "运气", "luck"];

export function isCombatSkill(skillName: string): boolean {
  if (!skillName) return false;
  const lower = skillName.toLowerCase();
  if (COMBAT_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()))) return true;
  if (COMBAT_WEAPON_REGEX.test(skillName)) return true;
  return false;
}

export function isLuckCheck(skillName: string): boolean {
  if (!skillName) return false;
  const lower = skillName.toLowerCase();
  return LUCK_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

export function isSanityCheck(req: { skillName: string }): boolean {
  return req.skillName.includes("SAN");
}

export function canPushRoll(req: RollRequest, result: RollResult): boolean {
  if (req.isKeeperRoll) return false;
  if (isSanityCheck(req)) return false;
  if (isCombatSkill(req.skillName)) return false;
  if (isLuckCheck(req.skillName)) return false;
  if (result.successType !== "failure") return false;
  return true;
}

export interface BurnLuckEvaluation {
  /** 路径与状态本身允许燃运（不计 LUC 余额） */
  ruleAllowed: boolean;
  /** 把骰点压到 targetValue 所需的幸运点数（>=1 才有意义） */
  cost: number;
  /** LUC 是否足够 */
  affordable: boolean;
}

export function evaluateBurnLuck(
  req: RollRequest,
  result: RollResult,
  remainingLuck: number,
): BurnLuckEvaluation {
  const denyEval: BurnLuckEvaluation = { ruleAllowed: false, cost: 0, affordable: false };
  if (req.isKeeperRoll) return denyEval;
  if (isSanityCheck(req)) return denyEval;
  if (isCombatSkill(req.skillName)) return denyEval;
  if (isLuckCheck(req.skillName)) return denyEval;
  if (result.successType !== "failure") return denyEval;
  const cost = result.total - result.targetValue;
  if (cost < 1) return denyEval;
  return {
    ruleAllowed: true,
    cost,
    affordable: remainingLuck >= cost,
  };
}
