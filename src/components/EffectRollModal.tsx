/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EffectRollModal — 二阶段投骰中的"效果骰"轻量浮窗。
 *
 * 用途：技能判定本身用 RollDiceModal 走完后，若结果需要继续掷一个 nDn 公式来确定
 * 实际数值（典型例：SAN 失败后的 1d6 失血、武器伤害等），用此组件展示。
 *
 * 设计要点：
 *   - **没有任何按钮**：CoC 7e 规则不允许对效果骰用 push/燃运。掷出来即生效。
 *   - 800ms 滚动动画 + 揭晓 + 1.5s 后自动调用 onResolve(result)。
 *   - 父组件持有 useState<{ formula, label, theme, onResolve }>，子组件只负责演出。
 *   - 解析与求值由父组件预先完成（`rollDiceFormula`），传入 `result`；本组件仅渲染。
 *     这样保证"骰子结果"只在一处生成，避免子组件 unmount 又 mount 后重新随机。
 */

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Dices, Skull } from "lucide-react";
import { DiceFormulaResult } from "../lib/diceFormula";

type Theme = "sanity" | "default";

interface EffectRollModalProps {
  /** 顶部标签，例如 "理智损失"、"伤害值" */
  label: string;
  /** 公式字符串原样回显，例如 "1d6"、"1d10+2" */
  formulaDisplay: string;
  /** 已经在父组件求值好的结果（不在此组件里再随机，避免重渲染抖动） */
  result: DiceFormulaResult;
  /** 主题：sanity = 紫色，default = 暖色 */
  theme?: Theme;
  /** 揭晓后多久自动关闭并 resolve（毫秒，默认 1500） */
  autoCloseMs?: number;
  /** 揭晓动画时长（毫秒，默认 800） */
  rollMs?: number;
  /** 浮窗结束时回调，把结果交回父组件应用游戏副作用 */
  onResolve: (result: DiceFormulaResult) => void;
}

export default function EffectRollModal({
  label,
  formulaDisplay,
  result,
  theme = "sanity",
  autoCloseMs = 1500,
  rollMs = 800,
  onResolve,
}: EffectRollModalProps) {
  const [phase, setPhase] = useState<"rolling" | "settled">("rolling");
  const [simValue, setSimValue] = useState<number>(0);

  const isSanity = theme === "sanity";

  // 滚动动画 → 揭晓 → 自动关闭
  useEffect(() => {
    let tickInterval: ReturnType<typeof setInterval> | null = null;
    if (result.dice) {
      tickInterval = setInterval(() => {
        setSimValue(Math.floor(Math.random() * (result.dice!.sides * result.dice!.count)) + 1);
      }, 60);
    }
    const settleTimer = setTimeout(() => {
      if (tickInterval) clearInterval(tickInterval);
      setPhase("settled");
    }, rollMs);
    return () => {
      if (tickInterval) clearInterval(tickInterval);
      clearTimeout(settleTimer);
    };
  }, [result, rollMs]);

  useEffect(() => {
    if (phase !== "settled") return;
    const closeTimer = setTimeout(() => onResolve(result), autoCloseMs);
    return () => clearTimeout(closeTimer);
  }, [phase, autoCloseMs, onResolve, result]);

  const accent = isSanity
    ? {
      border: "border-purple-500",
      bg: "bg-[#160e1c]",
      headBg: "bg-[#1b1424]",
      headBorder: "border-purple-500/30",
      text: "text-purple-200",
      mute: "text-purple-300/80",
      tile: "from-purple-950 to-purple-700 border-purple-400 text-purple-100 shadow-purple-500/20",
      tileSettled: "from-purple-900 to-[#160b1f] border-purple-400 text-purple-200 shadow-purple-500/20",
      icon: <Skull className="w-5 h-5 text-purple-300 animate-pulse" />,
    }
    : {
      border: "border-[#c1a067]",
      bg: "bg-[#141617]",
      headBg: "bg-[#1b1e20]",
      headBorder: "border-[#c1a067]/20",
      text: "text-[#c1a067]",
      mute: "text-gray-400",
      tile: "from-amber-950 to-amber-700 border-[#c1a067] text-amber-200",
      tileSettled: "from-amber-900 to-[#1f1408] border-[#c1a067] text-amber-200",
      icon: <Dices className="w-5 h-5 text-[#c1a067] animate-pulse" />,
    };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-[60] select-none backdrop-blur-sm"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          className={`w-full max-w-sm ${accent.bg} border-2 ${accent.border} rounded-lg shadow-2xl overflow-hidden font-sans`}
        >
          <div className={`${accent.headBg} border-b ${accent.headBorder} px-4 py-2.5 flex items-center gap-2`}>
            {accent.icon}
            <span className={`text-xs font-semibold uppercase tracking-wider font-mono ${accent.text}`}>
              {label} · 效果骰
            </span>
            <span className={`ml-auto text-[10px] font-mono ${accent.mute}`}>
              {formulaDisplay}
            </span>
          </div>

          <div className={`p-6 flex flex-col items-center justify-center ${isSanity ? "bg-radial from-[#2a1638] to-[#120819]" : "bg-radial from-[#152e25] to-[#0d1613]"} relative`}>
            <div className={`absolute w-32 h-32 rounded-full border ${isSanity ? "border-purple-700/30" : "border-emerald-950/20"} animate-spin-slow pointer-events-none`} />

            {phase === "rolling" ? (
              <motion.div
                key="rolling"
                animate={{ rotate: [0, 180, 360], scale: [1, 1.08, 1] }}
                transition={{ repeat: Infinity, duration: 0.6 }}
                className={`w-20 h-20 z-10 rounded-xl border-2 flex items-center justify-center text-3xl font-mono font-bold shadow-2xl bg-gradient-to-tr ${accent.tile}`}
              >
                {result.dice ? simValue : "?"}
              </motion.div>
            ) : (
              <motion.div
                key="settled"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className={`w-24 h-24 z-10 rounded-xl border-2 flex items-center justify-center text-4xl font-mono font-extrabold shadow-2xl bg-gradient-to-br ${accent.tileSettled}`}
              >
                {result.total}
              </motion.div>
            )}

            <div className={`mt-4 text-[11px] font-mono ${accent.mute}`}>
              {phase === "rolling"
                ? "命运正在落下..."
                : result.dice
                  ? `[${result.rolls.join(", ")}]${result.constant ? ` ${result.constant >= 0 ? "+" : ""}${result.constant}` : ""}${result.divisor > 1 ? ` ÷${result.divisor}` : ""} = ${result.total}`
                  : `${result.total}`}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
