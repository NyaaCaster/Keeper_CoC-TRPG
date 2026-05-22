/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { RollRequest, RollResult } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { Dices, Sparkles, TrendingUp, AlertTriangle, CheckCircle, Skull } from "lucide-react";

interface RollDiceModalProps {
  key?: string;
  request: RollRequest;
  isSanityCheck?: boolean;
  isKeeperRoll?: boolean;
  isSecret?: boolean;
  onComplete: (result: RollResult, outcomeMessage: string) => void;
}

export default function RollDiceModal({ 
  request, 
  isSanityCheck = false, 
  isKeeperRoll = false, 
  isSecret = false, 
  onComplete 
}: RollDiceModalProps) {
  const [phase, setPhase] = useState<"idle" | "rolling" | "settled">("idle");
  const [tensValue, setTensValue] = useState<number>(0);
  const [unitsValue, setUnitsValue] = useState<number>(0);
  const [calculatedTotal, setCalculatedTotal] = useState<number>(0);
  const [successType, setSuccessType] = useState<RollResult["successType"]>("failure");

  // Multi-dice support for Bonus/Penalty dice
  const [bonusOrPenalty, setBonusOrPenalty] = useState<"none" | "bonus" | "penalty">("none");
  const [tensRolls, setTensRolls] = useState<number[]>([]); // holds the rolled tens values (can be multiple for bonus/penalty)

  // Simulation values during rolling
  const [simTens, setSimTens] = useState<number>(0);
  const [simUnits, setSimUnits] = useState<number>(0);

  useEffect(() => {
    if (isKeeperRoll && phase === "idle") {
      const timer = setTimeout(() => {
        handleRoll();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isKeeperRoll, phase]);

  useEffect(() => {
    if (isKeeperRoll && phase === "settled") {
      const timer = setTimeout(() => {
        handleApplyResult();
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [isKeeperRoll, phase, tensValue, unitsValue, calculatedTotal, successType]);

  const runPureClientFallback = () => {
    // Generate native client values as a pure local fallback
    const finalTens1 = Math.floor(Math.random() * 10) * 10;
    const finalTens2 = Math.floor(Math.random() * 10) * 10;
    const finalUnits = Math.floor(Math.random() * 10);

    let finalTensSelected = finalTens1;
    let fallbackTensRolls = [finalTens1];
    
    if (bonusOrPenalty === "bonus") {
      finalTensSelected = Math.min(finalTens1, finalTens2);
      fallbackTensRolls = [finalTens1, finalTens2];
    } else if (bonusOrPenalty === "penalty") {
      finalTensSelected = Math.max(finalTens1, finalTens2);
      fallbackTensRolls = [finalTens1, finalTens2];
    }

    let diceResult = 0;
    if (finalTensSelected === 0 && finalUnits === 0) {
      diceResult = 100;
    } else {
      diceResult = finalTensSelected + finalUnits;
    }

    const target = request.targetValue;
    let outcome: RollResult["successType"] = "failure";

    if (diceResult === 1) {
      outcome = "critical";
    } else if (target < 50 && diceResult === 100) {
      outcome = "fumble";
    } else if (target >= 50 && diceResult >= 96) {
      outcome = "fumble";
    } else if (diceResult <= Math.floor(target / 5)) {
      outcome = "extreme";
    } else if (diceResult <= Math.floor(target / 2)) {
      outcome = "hard";
    } else if (diceResult <= target) {
      outcome = "regular";
    } else {
      outcome = "failure";
    }

    setTensValue(finalTensSelected);
    setUnitsValue(finalUnits);
    setCalculatedTotal(diceResult);
    setTensRolls(fallbackTensRolls);
    setSuccessType(outcome);
    setPhase("settled");
  };

  const handleRoll = async () => {
    if (phase === "rolling") return;

    setPhase("rolling");

    // Start shuffling animation
    let tick = 0;
    const shuffleInterval = setInterval(() => {
      setSimTens(Math.floor(Math.random() * 10) * 10);
      setSimUnits(Math.floor(Math.random() * 10));
      tick++;
    }, 80);

    try {
      const bonusNum = bonusOrPenalty === "bonus" ? 1 : 0;
      const penaltyNum = bonusOrPenalty === "penalty" ? 1 : 0;

      const response = await fetch("/api/keeper/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skill: request.targetValue,
          bonus: bonusNum,
          penalty: penaltyNum,
        }),
      });

      if (!response.ok) {
        throw new Error("API call failed");
      }

      const resData = await response.json();
      if (!resData.success || !resData.text) {
        throw new Error("Invalid response format");
      }

      const text = resData.text;

      // Parse the text format out of the objective roll output
      const matchTotal = text.match(/最终：\s*(\d+)/);
      const matchUnits = text.match(/个位骰：\s*(\d+)/);
      const matchTensRolls = text.match(/十位骰：\s*([^\n→]+)/);
      const matchOutcome = text.match(/判定：\s*([^\n（(]+)/);

      if (!matchTotal || !matchUnits) {
        throw new Error("Unable to parse text format from API");
      }

      const parsedTotal = parseInt(matchTotal[1], 10);
      const parsedUnits = parseInt(matchUnits[1], 10);

      let parsedTens = parsedTotal - parsedUnits;
      if (parsedTotal === 100) {
        parsedTens = 0;
      }

      // Extract tens rolls (0 to 9), multiply by 10
      let parsedTensList: number[] = [parsedTens];
      if (matchTensRolls) {
        const rawTensDigits = matchTensRolls[1].match(/\d+/g);
        if (rawTensDigits) {
          parsedTensList = rawTensDigits.map(d => parseInt(d, 10) * 10);
        }
      }

      // Check success level
      let parsedOutcome: RollResult["successType"] = "failure";
      const outcomeStr = matchOutcome ? matchOutcome[1].trim() : "";
      if (outcomeStr.includes("大成功")) {
        parsedOutcome = "critical";
      } else if (outcomeStr.includes("大失败")) {
        parsedOutcome = "fumble";
      } else if (outcomeStr.includes("极难")) {
        parsedOutcome = "extreme";
      } else if (outcomeStr.includes("困难")) {
        parsedOutcome = "hard";
      } else if (outcomeStr.includes("普通") || outcomeStr.includes("成功") || outcomeStr.includes("常规")) {
        parsedOutcome = "regular";
      } else {
        parsedOutcome = "failure";
      }

      // Ensure shuffling visual feel
      const minTicks = 12;
      const delayMs = Math.max(0, (minTicks - tick) * 80);
      setTimeout(() => {
        clearInterval(shuffleInterval);

        setTensValue(parsedTens);
        setUnitsValue(parsedUnits);
        setCalculatedTotal(parsedTotal);
        setTensRolls(parsedTensList);
        setSuccessType(parsedOutcome);
        setPhase("settled");
      }, delayMs);

    } catch (e) {
      console.error("Fetch roll API failed, running pure frontend random generation backup:", e);
      clearInterval(shuffleInterval);
      runPureClientFallback();
    }
  };

  const handleApplyResult = () => {
    const skill = request.skillName;
    const target = request.targetValue;
    const roll = calculatedTotal;

    // Map successType directly to match .docs/roll_coc_rule.md specification output
    let successZh = "判定失败";
    switch (successType) {
      case "critical": successZh = "大成功"; break;
      case "extreme": successZh = "极难成功"; break;
      case "hard": successZh = "困难成功"; break;
      case "regular": successZh = "常规成功"; break;
      case "failure": successZh = "常规失败"; break;
      case "fumble": successZh = "大失败"; break;
    }

    const formattedDiceResult = roll < 10 ? `0${roll}` : `${roll}`;
    const tensListStr = tensRolls.map(t => t === 0 ? 0 : t / 10);
    const selectedTensDigit = tensValue === 0 ? 0 : tensValue / 10;

    let message = "";
    if (isKeeperRoll) {
      if (isSecret) {
        message = `[系统的守秘人判定(暗骰) - 针对 [${skill}] (${target}%) 进行了一次暗中判定。命运暗自契合契定因果，细节由旁白隐秘呈现。]`;
      } else {
        message = `[系统的守秘人判定(明骰) - ${skill}]
> **🎲 ${formattedDiceResult}** (上限目标值 ${target}%)
> 十位骰 [${tensListStr.join(", ")}] 取 ${selectedTensDigit}，个位骰 ${unitsValue}。
> **✨ 结果：${successZh}**`;
      }
    } else {
      // Structured exactly corresponding to .docs/roll_coc_rule.md for normal player roll
      message = `
[系统的客观投骰检定结果 - ${isSanityCheck ? "理智判定(SAN)" : skill}]
> **🎲 ${formattedDiceResult}**
> 十位骰 [${tensListStr.join(", ")}] 取 ${selectedTensDigit}，个位骰 ${unitsValue}。
> **✨ ${successZh}**

阈值：≤${Math.floor(target / 5)} 极难 / ≤${Math.floor(target / 2)} 困难 / ≤${target} 普通。`;
    }

    const resultObj: RollResult = {
      dice10: tensValue,
      dice1: unitsValue,
      total: roll,
      targetValue: target,
      isBonus: bonusOrPenalty === "bonus",
      isPenalty: bonusOrPenalty === "penalty",
      successType
    };

    onComplete(resultObj, message);
  };

  return (
    <div id="dice-roll-modal-overlay" className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50 select-none backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg bg-[#141617] border-2 border-[#c1a067] rounded-lg shadow-2xl overflow-hidden font-sans"
      >
        
        {/* Modal Header */}
        <div className="bg-[#1b1e20] border-b border-[#c1a067]/20 p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Dices className="w-5 h-5 text-[#c1a067] animate-pulse" />
            <span className="text-sm font-semibold text-[#c1a067] uppercase tracking-wider font-mono">
              {isSanityCheck ? "理智惊狂检定 (SAN Check)" : "命运的判定检定"}
            </span>
          </div>
          <div className="text-xs bg-black/50 border border-[#c1a067]/30 px-2 py-0.5 rounded font-mono text-gray-400">
            CoC 7E STANDARD
          </div>
        </div>

        {/* Quest Info */}
        <div className="p-5 bg-black/40 text-center border-b border-gray-900 leading-relaxed font-sans">
          <div className="text-gray-400 text-xs uppercase tracking-widest font-mono mb-1">DECIDING SUBJECT</div>
          <h3 className="text-xl font-bold text-gray-100 flex items-center justify-center gap-1">
            <span>{isSanityCheck ? "理智值 (Sanity)" : request.skillName}</span>
            <span className="text-[#c1a067] font-mono text-lg">({request.targetValue}%)</span>
          </h3>
          <p className="text-[#c1a067]/90 text-xs italic mt-2 max-w-sm mx-auto font-sans">
            " {request.reason} "
          </p>
          <div className="mt-3 flex items-center justify-center gap-1 text-[11px] font-mono">
            <span className="text-gray-500">检测难度: </span>
            <span className={`px-2 py-0.5 rounded ${
              request.difficulty === "regular" 
                ? "bg-green-950/40 text-green-400 border border-green-800/30" 
                : request.difficulty === "hard" 
                  ? "bg-amber-950/45 text-amber-400 border border-amber-800/20" 
                  : "bg-red-950/45 text-red-400 border border-red-800/20 animate-pulse"
            }`}>
              {request.difficulty === "regular" ? "常规难度 (<= 技能值)" : request.difficulty === "hard" ? "困难等级 (<= 一半值)" : "极难地狱 (<= 五分之一值)"}
            </span>
          </div>

          {/* Bonus / Penalty configuration */}
          {phase === "idle" && !isKeeperRoll && (
            <div className="mt-4 flex justify-center gap-2 text-xs">
              <button 
                id="dice-modify-none-btn"
                type="button" 
                onClick={() => setBonusOrPenalty("none")}
                className={`px-3 py-1 rounded transition border ${bonusOrPenalty === "none" ? "bg-white/10 border-gray-400 text-white" : "bg-black/40 border-gray-800 text-gray-500 hover:text-gray-300"}`}
              >
                标准投 (1D100)
              </button>
              <button 
                id="dice-modify-bonus-btn"
                type="button" 
                onClick={() => setBonusOrPenalty("bonus")}
                className={`px-3 py-1 rounded transition border ${bonusOrPenalty === "bonus" ? "bg-[#c1a067]/20 border-[#c1a067] text-[#c1a067]" : "bg-black/40 border-gray-800 text-gray-400 hover:text-gray-300"}`}
              >
                + 奖励骰 (Bonus)
              </button>
              <button 
                id="dice-modify-penalty-btn"
                type="button" 
                onClick={() => setBonusOrPenalty("penalty")}
                className={`px-3 py-1 rounded transition border ${bonusOrPenalty === "penalty" ? "bg-red-950/20 border-red-800 text-red-400" : "bg-black/40 border-gray-800 text-gray-400 hover:text-gray-300"}`}
              >
                - 惩罚骰 (Penalty)
              </button>
            </div>
          )}
        </div>

        {/* Velvet Tray Dice Roller */}
        <div className="p-8 flex flex-col items-center justify-center bg-radial from-[#152e25] to-[#0d1613] border-b border-gray-900 relative min-h-[220px]">
          
          {/* Subtle occult background ring */}
          <div className="absolute w-44 h-44 rounded-full border border-emerald-950/20 animate-spin-slow pointer-events-none" />

          {phase === "idle" && (
            <motion.div 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="text-center z-10"
            >
              {!isKeeperRoll ? (
                <>
                  <button 
                    id="modal-roll-trigger-btn"
                    type="button"
                    onClick={handleRoll}
                    className="w-24 h-24 bg-gradient-to-tr from-[#c1a067] to-[#e4cb9c] text-black font-semibold rounded-full shadow-[0_0_25px_rgba(193,160,103,0.3)] hover:scale-105 active:scale-95 transition-all flex flex-col items-center justify-center border-2 border-amber-100/20"
                  >
                    <Dices className="w-8 h-8 mb-1 animate-bounce" />
                    <span className="text-xs tracking-widest font-bold">掷 骰!</span>
                  </button>
                  <p className="text-gray-400 text-xs font-sans mt-3">点击开启命运的转盘并判定检定等级</p>
                </>
              ) : (
                <div className="w-24 h-24 flex flex-col items-center justify-center rounded-full border-2 border-dashed border-[#c1a067]/40">
                   <div className="w-8 h-8 rounded-full border-b-2 border-[#c1a067] animate-spin mb-2" />
                   <div className="text-[#c1a067] font-mono text-xs">自动揭示中</div>
                </div>
              )}
            </motion.div>
          )}

          {phase === "rolling" && (
            <div className="flex gap-6 z-10">
              <motion.div 
                className="w-20 h-20 bg-gradient-to-tr from-amber-950 to-amber-700 text-amber-200 border-2 border-[#c1a067] rounded-xl flex items-center justify-center text-3xl font-mono font-bold shadow-2xl"
                animate={{ rotate: [0, 180, 360, 540, 720], scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 0.6 }}
              >
                {simTens === 0 ? "00" : simTens}
              </motion.div>

              <motion.div 
                className="w-20 h-20 bg-gradient-to-tr from-emerald-950 to-emerald-800 text-emerald-200 border-2 border-emerald-500 rounded-xl flex items-center justify-center text-3xl font-mono font-bold shadow-2xl"
                animate={{ rotate: [0, -180, -360, -540, -720], scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 0.6 }}
              >
                {simUnits}
              </motion.div>
            </div>
          )}

          {phase === "settled" && (
            <div className="flex flex-col items-center gap-6 z-10 w-full animate-fade-in">
              {isSecret ? (
                <div className="text-center font-mono py-4">
                  <Dices className="w-12 h-12 text-indigo-500/50 mx-auto mb-3 animate-pulse" />
                  <div className="text-xl text-indigo-400/80 font-bold tracking-widest bg-stripes bg-indigo-900/40 px-6 py-2 rounded-lg border border-indigo-500/30">
                    ??? / 100
                  </div>
                  <div className="text-xs text-indigo-300 mt-3 font-sans opacity-70">
                    暗中判定结果已隐匿于迷雾之中...
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex justify-center items-center gap-4">
                    
                    {/* Secondary Tens dice for Bonus/Penalty visualization */}
                    {bonusOrPenalty !== "none" && tensRolls.length > 1 && (
                      <div className="flex flex-col items-center opacity-60">
                        <div className="text-[10px] text-gray-500 mb-1">备用十位</div>
                        <div className="w-14 h-14 bg-gray-900 border border-gray-700 rounded-lg flex items-center justify-center text-lg font-mono font-semibold text-gray-400">
                          {tensRolls[0] === 0 ? "00" : tensRolls[0]}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-col items-center">
                      <div className="text-[10px] text-[#c1a067] uppercase mb-1">TENS 十位数</div>
                      <motion.div 
                        initial={{ scale: 0.5, rotate: -45 }}
                        animate={{ scale: 1, rotate: 0 }}
                        className="w-24 h-24 bg-gradient-to-br from-amber-900 to-[#100f0d] text-[#c1a067] border-2 border-[#c1a067] rounded-xl flex items-center justify-center text-4xl font-mono font-bold shadow-2xl shadow-yellow-500/10"
                      >
                        {tensValue === 0 ? "00" : tensValue}
                      </motion.div>
                    </div>

                    <div className="text-2xl text-gray-500 font-mono self-center mt-5">+</div>

                    <div className="flex flex-col items-center">
                      <div className="text-[10px] text-emerald-400 uppercase mb-1">UNITS 个位数</div>
                      <motion.div 
                        initial={{ scale: 0.5, rotate: 45 }}
                        animate={{ scale: 1, rotate: 0 }}
                        className="w-24 h-24 bg-gradient-to-br from-emerald-900 to-[#0c100e] text-emerald-300 border-2 border-emerald-500 rounded-xl flex items-center justify-center text-4xl font-mono font-bold shadow-2xl shadow-emerald-500/10"
                      >
                        {unitsValue}
                      </motion.div>
                    </div>

                    {bonusOrPenalty !== "none" && tensRolls.length > 1 && (
                      <div className="flex flex-col items-center opacity-60">
                        <div className="text-[10px] text-gray-500 mb-1">备用十位2</div>
                        <div className="w-14 h-14 bg-gray-900 border border-gray-700 rounded-lg flex items-center justify-center text-lg font-mono font-semibold text-gray-400">
                          {tensRolls[1] === 0 ? "00" : tensRolls[1]}
                        </div>
                      </div>
                    )}

                  </div>

                  {/* Total display */}
                  <div className="text-center font-sans">
                    <div className="text-xs text-gray-500 font-mono">D100 TOTAL RESULT</div>
                    <div className="text-5xl font-mono text-gray-100 font-black mt-1 flex items-baseline justify-center gap-1.5">
                      <span>{calculatedTotal}</span>
                      <span className="text-xl text-gray-500">/ 100</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Settle Banner / Action Footer */}
        {phase === "settled" && (
          <div className="bg-[#191b1c] p-6 text-center animate-fade-in font-sans">
            
            {/* Banner style depending on success level */}
            {!isSecret && (
              <div className="mb-6 flex justify-center">
                {successType === "critical" && (
                  <div className="px-6 py-2 rounded-full bg-gradient-to-r from-amber-500/20 via-yellow-500/20 to-amber-500/20 border border-yellow-400 text-yellow-300 flex items-center gap-2 text-md font-bold shadow-[0_0_20px_rgba(234,179,8,0.2)]">
                    <Sparkles className="w-5 h-5 animate-spin" /> 大 成 功 (Critical Success) !!!
                  </div>
                )}
                {successType === "extreme" && (
                  <div className="px-6 py-2 rounded-full bg-cyan-950/40 border border-cyan-400 text-cyan-300 flex items-center gap-2 text-sm font-bold shadow-[0_0_15px_rgba(34,211,238,0.15)]">
                    <TrendingUp className="w-4 h-4" /> 极 难 成 功 (Extreme Success) !
                  </div>
                )}
                {successType === "hard" && (
                  <div className="px-6 py-2 rounded-full bg-emerald-950/40 border border-emerald-400 text-emerald-300 flex items-center gap-2 text-sm font-bold">
                    <CheckCircle className="w-4 h-4" /> 困 难 成 功 (Hard Success)
                  </div>
                )}
                {successType === "regular" && (
                  <div className="px-6 py-2 rounded-full bg-green-950/30 border border-green-500/40 text-green-400 flex items-center gap-2 text-sm">
                    <CheckCircle className="w-4 h-4" /> 常 规 成 功 (Success)
                  </div>
                )}
                {successType === "failure" && (
                  <div className="px-6 py-2 rounded-full bg-neutral-900 border border-neutral-700 text-neutral-400 flex items-center gap-2 text-sm">
                    <AlertTriangle className="w-4 h-4" /> 判 定 失 败 (Failure)
                  </div>
                )}
                {successType === "fumble" && (
                  <div className="px-6 py-2 rounded-full bg-red-950/50 border-2 border-red-650 text-red-400 flex items-center gap-2 text-md font-extrabold shadow-[0_0_25px_rgba(239,68,68,0.3)] animate-bounce font-mono">
                    <Skull className="w-5 h-5 text-red-500 animate-pulse" /> 大 失 败 (Fumble) !!!
                  </div>
                )}
              </div>
            )}

            {isKeeperRoll ? (
               <div className="flex items-center justify-center py-2 h-12">
                 <div className="w-6 h-6 border-2 border-[#c1a067]/40 border-b-[#c1a067] rounded-full animate-spin" />
                 <span className="ml-3 text-sm text-[#c1a067]/70">正在自动回传守密人进度...</span>
               </div>
            ) : (
              <button
                id="m-roll-apply-btn"
                type="button"
                onClick={handleApplyResult}
                className="w-full py-3 bg-[#c1a067] hover:bg-[#d5b57d] text-black font-semibold rounded tracking-wider shadow-lg shadow-[#c1a067]/10 transition active:scale-95"
              >
                契定结果，同步向守密人汇报
              </button>
            )}
          </div>
        )}

      </motion.div>
    </div>
  );
}
