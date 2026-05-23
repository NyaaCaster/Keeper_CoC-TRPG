/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 骰子公式解析与求值 — 用于"效果骰"（伤害、SAN 损失、治疗等）。
 *
 * 支持文法（不分大小写、忽略空格）：
 *   - 纯数字：             0 / 1 / 5
 *   - 单组骰：             1d6 / 2d10 / 3d4
 *   - 加常数：             1d6+2 / 2d4+1
 *   - 减常数：             1d10-1
 *   - 除常数（向下取整）：  1d6/2 / 1d10/2
 *
 * 不支持（CoC 7e 罕用，遇到会按"无效公式"回退为 0）：
 *   - 多组骰相加：         1d6+1d4
 *   - keep highest / drop lowest
 *   - 复合表达式
 *
 * 解析失败时 isValid=false，total=0；调用方应当把整个公式作为字符串展示给玩家与 KP，
 * 而不是默认成 1（后者是旧 parseAndRollDice 的隐藏坑）。
 */

export interface DiceFormulaResult {
  /** 原始公式字符串，原样回显 */
  formula: string;
  /** 公式是否被成功解析 */
  isValid: boolean;
  /** 是否为纯数字（不需要弹效果骰浮窗） */
  isStatic: boolean;
  /** 骰子参数：1d6 → { count: 1, sides: 6 }；纯数字时为 null */
  dice: { count: number; sides: number } | null;
  /** 加减常数（默认 0） */
  constant: number;
  /** 除常数（默认 1） */
  divisor: number;
  /** 每颗骰子的实际点数（按掷骰顺序） */
  rolls: number[];
  /** 最终结果（已应用 constant / divisor，向下取整，下限 0） */
  total: number;
}

const FORMULA_RE = /^(?:(\d+)d(\d+))?\s*([+\-]\s*\d+)?\s*(\/\s*\d+)?$/i;

export function rollDiceFormula(rawFormula: string): DiceFormulaResult {
  const formula = (rawFormula ?? "").trim();

  // 空字符串 / "0" → 静态 0
  if (!formula || formula === "0") {
    return {
      formula,
      isValid: true,
      isStatic: true,
      dice: null,
      constant: 0,
      divisor: 1,
      rolls: [],
      total: 0,
    };
  }

  // 纯数字
  if (/^\d+$/.test(formula)) {
    const n = parseInt(formula, 10);
    return {
      formula,
      isValid: true,
      isStatic: true,
      dice: null,
      constant: n,
      divisor: 1,
      rolls: [],
      total: n,
    };
  }

  // 标准化：去空格再匹配
  const normalized = formula.replace(/\s+/g, "").toLowerCase();
  const m = normalized.match(FORMULA_RE);
  if (!m || (!m[1] && !m[3] && !m[4])) {
    return {
      formula,
      isValid: false,
      isStatic: false,
      dice: null,
      constant: 0,
      divisor: 1,
      rolls: [],
      total: 0,
    };
  }

  const count = m[1] ? parseInt(m[1], 10) : 0;
  const sides = m[2] ? parseInt(m[2], 10) : 0;
  const constant = m[3] ? parseInt(m[3].replace(/\s/g, ""), 10) : 0;
  const divisor = m[4] ? Math.max(1, parseInt(m[4].replace(/[\s/]/g, ""), 10)) : 1;

  if (count > 0 && sides < 1) {
    return {
      formula,
      isValid: false,
      isStatic: false,
      dice: null,
      constant: 0,
      divisor: 1,
      rolls: [],
      total: 0,
    };
  }

  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(Math.random() * sides) + 1);
  }
  const sum = rolls.reduce((a, b) => a + b, 0) + constant;
  const total = Math.max(0, Math.floor(sum / divisor));

  return {
    formula,
    isValid: true,
    isStatic: count === 0,
    dice: count > 0 ? { count, sides } : null,
    constant,
    divisor,
    rolls,
    total,
  };
}
