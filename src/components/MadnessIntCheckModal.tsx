/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Brain, Eye, AlertTriangle } from "lucide-react";

interface MadnessIntCheckModalProps {
  targetValue: number;
  sanLoss: number;
  onResolve: (passed: boolean, total: number) => void;
}

/**
 * 规则 10 INT 检定 modal — 单次 SAN 损失 ≥ 5 时弹出。
 * CoC 7e 反直觉:**通过 = 理解恐怖 → 进入临时疯狂**;失败 = 心智封闭保住清醒。
 */
export default function MadnessIntCheckModal({
  targetValue,
  sanLoss,
  onResolve,
}: MadnessIntCheckModalProps) {
  const [phase, setPhase] = useState<"idle" | "rolling" | "settled">("idle");
  const [tens, setTens] = useState(0);
  const [units, setUnits] = useState(0);
  const [total, setTotal] = useState(0);
  const [passed, setPassed] = useState(false);

  useEffect(() => {
    if (phase !== "rolling") return;
    let frame = 0;
    const id = setInterval(() => {
      setTens(Math.floor(Math.random() * 10) * 10);
      setUnits(Math.floor(Math.random() * 10));
      frame += 1;
      if (frame >= 18) {
        clearInterval(id);
        const t = Math.floor(Math.random() * 10) * 10;
        const u = Math.floor(Math.random() * 10);
        const finalTotal = t + u === 0 ? 100 : t + u;
        setTens(t);
        setUnits(u);
        setTotal(finalTotal);
        setPassed(finalTotal <= targetValue);
        setPhase("settled");
      }
    }, 70);
    return () => clearInterval(id);
  }, [phase, targetValue]);

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50 select-none backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg bg-[#160a1f] border-2 border-fuchsia-600/70 rounded-lg shadow-2xl overflow-hidden font-sans shadow-fuchsia-900/40"
      >
        <div className="bg-[#1f1129] border-b border-fuchsia-600/30 p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-fuchsia-300 animate-pulse" />
            <span className="text-sm font-semibold uppercase tracking-wider font-mono text-fuchsia-200">
              领悟检定 (Sanity-Loss INT Check)
            </span>
          </div>
          <div className="text-xs bg-black/50 border border-fuchsia-500/40 text-fuchsia-300/80 px-2 py-0.5 rounded font-mono">
            CoC 7E · KRB p.157
          </div>
        </div>

        <div className="p-5 bg-black/50 border-b border-fuchsia-950/60 text-center leading-relaxed">
          <div className="text-xs uppercase tracking-widest font-mono mb-1 text-fuchsia-400/80">
            COMPREHENSION THRESHOLD · 是否要"理解"眼前的恐怖
          </div>
          <h3 className="text-xl font-bold text-fuchsia-50 flex items-center justify-center gap-1">
            <span>智力 (INT)</span>
            <span className="font-mono text-lg text-fuchsia-300">({targetValue}%)</span>
          </h3>
          <p className="text-xs italic mt-2 max-w-sm mx-auto text-fuchsia-200/80 font-sans">
            "她目睹了无法命名的事物。本次 SAN 损失 {sanLoss} 点撕开了某道防御。她的智力会接住这一击吗?"
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded border border-fuchsia-900/60 bg-fuchsia-950/30">
            <AlertTriangle className="w-3.5 h-3.5 text-fuchsia-300" />
            <span className="text-fuchsia-200/90">通过 = 理解恐怖 → 急性发作 + 临时疯狂 + 神话 +1</span>
          </div>
          <div className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded border border-purple-900/60 bg-purple-950/30">
            <Eye className="w-3.5 h-3.5 text-purple-300" />
            <span className="text-purple-200/90">失败 = 心智封闭 → 保持清醒,无后效</span>
          </div>
        </div>

        <div className="p-8 flex flex-col items-center justify-center bg-radial from-[#2a1638] to-[#120819] border-b border-gray-900 relative min-h-[220px]">
          <div className="absolute w-44 h-44 rounded-full border border-fuchsia-700/30 animate-spin-slow pointer-events-none" />

          {phase === "idle" && (
            <div className="z-10 flex flex-col items-center">
              <button
                type="button"
                onClick={() => setPhase("rolling")}
                className="w-24 h-24 bg-gradient-to-tr from-fuchsia-700 to-purple-500 text-white font-semibold rounded-full shadow-[0_0_40px_rgba(217,70,239,0.55)] hover:scale-105 active:scale-95 transition-all flex flex-col items-center justify-center border-2 border-fuchsia-200/40"
              >
                <Brain className="w-6 h-6 mb-0.5" />
                <span className="text-xs">面 对!</span>
              </button>
              <p className="text-xs font-sans mt-3 text-fuchsia-300/90">掷出 D100 — 越低越接近"理解",也就越接近发狂</p>
            </div>
          )}

          {phase === "rolling" && (
            <div className="z-10 flex gap-4">
              <motion.div
                className="w-20 h-20 bg-gradient-to-tr from-purple-950 to-purple-700 text-purple-100 border-2 border-purple-400 rounded-xl flex items-center justify-center text-3xl font-mono font-bold shadow-2xl"
                animate={{ rotate: [0, 180, 360, 540, 720], scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 0.6 }}
              >
                {tens === 0 ? "00" : tens}
              </motion.div>
              <motion.div
                className="w-20 h-20 bg-gradient-to-tr from-fuchsia-950 to-fuchsia-700 text-fuchsia-100 border-2 border-fuchsia-400 rounded-xl flex items-center justify-center text-3xl font-mono font-bold shadow-2xl"
                animate={{ rotate: [0, -180, -360, -540, -720], scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 0.6 }}
              >
                {units}
              </motion.div>
            </div>
          )}

          {phase === "settled" && (
            <div className="z-10 flex flex-col items-center gap-4 animate-fade-in">
              <div className="flex gap-4">
                <div className="w-20 h-20 bg-gradient-to-br from-purple-900 to-[#160b1f] text-purple-200 border-2 border-purple-400 rounded-xl flex items-center justify-center text-4xl font-mono font-bold shadow-2xl shadow-purple-500/20">
                  {tens === 0 ? "00" : tens}
                </div>
                <div className="w-20 h-20 bg-gradient-to-br from-fuchsia-900 to-[#1c0a26] text-fuchsia-200 border-2 border-fuchsia-400 rounded-xl flex items-center justify-center text-4xl font-mono font-bold shadow-2xl shadow-fuchsia-500/20">
                  {units}
                </div>
              </div>
              <div className="text-3xl font-bold text-fuchsia-50 font-mono">
                {total} <span className="text-base text-fuchsia-400/70">/ {targetValue}</span>
              </div>
              <div
                className={`px-6 py-2 rounded-full border flex items-center gap-2 text-sm font-bold ${
                  passed
                    ? "bg-fuchsia-950/50 border-fuchsia-400 text-fuchsia-200"
                    : "bg-purple-950/40 border-purple-500 text-purple-200"
                }`}
              >
                {passed ? "✦ 理 解 了 ✦" : "○ 心 智 封 闭 ○"}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 bg-black/40 flex flex-col gap-2">
          {phase === "settled" ? (
            <button
              type="button"
              onClick={() => onResolve(passed, total)}
              className="w-full py-3 bg-gradient-to-r from-fuchsia-700 to-purple-600 hover:from-fuchsia-600 hover:to-purple-500 text-white font-semibold rounded tracking-wider shadow-lg shadow-fuchsia-500/30 transition active:scale-95"
            >
              {passed ? "承受领悟,坠入急性发作" : "心智在最后一刻封闭,保住清醒"}
            </button>
          ) : (
            <div className="text-center text-xs text-fuchsia-400/60 font-mono py-2">
              {phase === "idle" ? "等待玩家直面恐怖..." : "命运正在裁决..."}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
