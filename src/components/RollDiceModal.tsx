/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { RollRequest, RollResult } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { Dices, Sparkles, TrendingUp, AlertTriangle, CheckCircle, Skull, X, Repeat, Flame } from "lucide-react";
import { canPushRoll, evaluateBurnLuck } from "../lib/rollPolicy";

interface RollDiceModalProps {
  key?: string;
  request: RollRequest;
  isSanityCheck?: boolean;
  isKeeperRoll?: boolean;
  isSecret?: boolean;
  sanityMeta?: { lossOnSuccess: string; lossOnFailure: string };
  /** 当前调查员的剩余 LUC，用于燃运按钮的成本计算与禁用判断 */
  currentLuck?: number;
  /** 燃运成功后通知父组件永久扣减幸运点 */
  onLuckSpend?: (cost: number) => void;
  onComplete: (result: RollResult, outcomeMessage: string) => void;
  onCancel?: () => void;
}

export default function RollDiceModal({
  request,
  isSanityCheck = false,
  isKeeperRoll = false,
  isSecret = false,
  sanityMeta,
  currentLuck = 0,
  onLuckSpend,
  onComplete,
  onCancel,
}: RollDiceModalProps) {
  const [phase, setPhase] = useState<"idle" | "rolling" | "settled">("idle");
  const [tensValue, setTensValue] = useState<number>(0);
  const [unitsValue, setUnitsValue] = useState<number>(0);
  const [calculatedTotal, setCalculatedTotal] = useState<number>(0);
  const [successType, setSuccessType] = useState<RollResult["successType"]>("failure");

  // 命运博弈状态机：none → 用户在 settled 阶段二选一 → pushed | burned
  // 任何一项动作执行后，命运博弈按钮区不再渲染（互斥锁）。
  const [actionTaken, setActionTaken] = useState<"none" | "pushed" | "burned">("none");
  const [pushForcedFumble, setPushForcedFumble] = useState<boolean>(false);
  const [luckSpent, setLuckSpent] = useState<number>(0);

  // CoC 7e: bonus/penalty are Keeper-assigned via the request, never player-chosen.
  const bonusCount = request.bonus && !request.penalty ? request.bonus : 0;
  const penaltyCount = request.penalty && !request.bonus ? request.penalty : 0;
  const bonusOrPenalty: "none" | "bonus" | "penalty" =
    bonusCount > 0 ? "bonus" : penaltyCount > 0 ? "penalty" : "none";
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

  const runPureClientFallback = (isPush: boolean = false) => {
    // CoC 7e: bonus/penalty roll N+1 tens dice and pick most/least favorable.
    const extraTens = bonusOrPenalty === "bonus" ? bonusCount : bonusOrPenalty === "penalty" ? penaltyCount : 0;
    const totalTens = 1 + extraTens;
    const tensList: number[] = [];
    for (let i = 0; i < totalTens; i++) {
      tensList.push(Math.floor(Math.random() * 10) * 10);
    }
    let finalUnits = Math.floor(Math.random() * 10);

    let finalTensSelected = tensList[0];
    if (bonusOrPenalty === "bonus") {
      finalTensSelected = Math.min(...tensList);
    } else if (bonusOrPenalty === "penalty") {
      finalTensSelected = Math.max(...tensList);
    }

    let diceResult = 0;
    if (finalTensSelected === 0 && finalUnits === 0) {
      diceResult = 100;
    } else {
      diceResult = finalTensSelected + finalUnits;
    }

    // [sys_test] 测试模式：用 testForce.total 强制覆盖骰点（仅首投生效，孤注一掷二投走真实随机）
    const forced = !isPush ? request.testForce : undefined;
    if (forced?.total !== undefined) {
      diceResult = Math.max(1, Math.min(100, Math.floor(forced.total)));
      if (diceResult === 100) {
        finalTensSelected = 0;
        finalUnits = 0;
      } else {
        finalUnits = diceResult % 10;
        finalTensSelected = diceResult - finalUnits;
      }
      tensList.length = 0;
      tensList.push(finalTensSelected);
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

    // [sys_test] testForce.successType 直接强制等级（覆盖骰点推导）
    if (forced?.successType) {
      outcome = forced.successType;
    }

    // 项目家规：孤注一掷二投失败必定升格为大失败
    let forcedFumble = false;
    if (isPush && outcome === "failure") {
      outcome = "fumble";
      forcedFumble = true;
    }

    setTensValue(finalTensSelected);
    setUnitsValue(finalUnits);
    setCalculatedTotal(diceResult);
    setTensRolls(tensList);
    setSuccessType(outcome);
    if (isPush) setPushForcedFumble(forcedFumble);
    setPhase("settled");
  };

  const handleRoll = async (isPush: boolean = false) => {
    if (phase === "rolling") return;

    setPhase("rolling");

    // [sys_test] 测试模式：跳过 /api/keeper/roll，直接走前端兜底（含 forced 覆盖）
    if (request.testForce && !isPush) {
      let tick = 0;
      const shuffleInterval = setInterval(() => {
        setSimTens(Math.floor(Math.random() * 10) * 10);
        setSimUnits(Math.floor(Math.random() * 10));
        tick++;
      }, 80);
      setTimeout(() => {
        clearInterval(shuffleInterval);
        runPureClientFallback(false);
      }, 800);
      return;
    }

    // Start shuffling animation
    let tick = 0;
    const shuffleInterval = setInterval(() => {
      setSimTens(Math.floor(Math.random() * 10) * 10);
      setSimUnits(Math.floor(Math.random() * 10));
      tick++;
    }, 80);

    try {
      const response = await fetch("/api/keeper/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skill: request.targetValue,
          bonus: bonusCount,
          penalty: penaltyCount,
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

      // 项目家规：孤注一掷二投失败必定升格为大失败
      let forcedFumble = false;
      if (isPush && parsedOutcome === "failure") {
        parsedOutcome = "fumble";
        forcedFumble = true;
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
        if (isPush) setPushForcedFumble(forcedFumble);
        setPhase("settled");
      }, delayMs);

    } catch (e) {
      console.error("Fetch roll API failed, running pure frontend random generation backup:", e);
      clearInterval(shuffleInterval);
      runPureClientFallback(isPush);
    }
  };

  // 孤注一掷：锁定 actionTaken，重新进入 rolling 阶段，二投失败将强制 fumble
  const handlePush = () => {
    if (actionTaken !== "none") return;
    setActionTaken("pushed");
    setPushForcedFumble(false);
    handleRoll(true);
  };

  // 燃运：不重投，直接把 total 压到 targetValue，successType 改为普通成功，扣 LUC
  const handleBurn = () => {
    if (actionTaken !== "none") return;
    const cost = calculatedTotal - request.targetValue;
    if (cost < 1) return;
    if (currentLuck < cost) return;
    setActionTaken("burned");
    setLuckSpent(cost);
    setCalculatedTotal(request.targetValue);

    // 把 tensValue / unitsValue 重新拆分以保持 UI 一致（例如 50 → tens=50, units=0）
    const newTotal = request.targetValue;
    if (newTotal === 100) {
      setTensValue(0);
      setUnitsValue(0);
    } else {
      const newUnits = newTotal % 10;
      const newTens = newTotal - newUnits;
      setTensValue(newTens);
      setUnitsValue(newUnits);
    }

    setSuccessType("regular");
    onLuckSpend?.(cost);
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

    // 命运博弈段落 — 由前端硬规则生成，告诉 KP 玩家做了什么
    let fateGambleNote = "";
    if (actionTaken === "pushed") {
      if (pushForcedFumble) {
        fateGambleNote = `\n\n[孤注一掷 (Push)] 玩家选择孤注一掷重投，二投失败已升格为大失败 (Fumble)。请按 CoC 7e 大失败口径加重叙事后果（如：受伤、暴露、装备损坏、引来注意等）。`;
      } else if (successType === "fumble") {
        fateGambleNote = `\n\n[孤注一掷 (Push)] 玩家选择孤注一掷重投，二投真实大失败 (Fumble)。请按 CoC 7e 大失败口径处理叙事。`;
      } else if (successType === "failure") {
        fateGambleNote = `\n\n[孤注一掷 (Push)] 玩家选择孤注一掷重投，结果仍为失败。`;
      } else {
        fateGambleNote = `\n\n[孤注一掷 (Push)] 玩家选择孤注一掷重投，本次为 ${successZh}。可在叙事中体现"破釜沉舟"的紧迫感。`;
      }
    } else if (actionTaken === "burned") {
      const remaining = Math.max(0, currentLuck - luckSpent);
      fateGambleNote = `\n\n[燃运 (Burn Luck)] 玩家燃烧 ${luckSpent} 点幸运将判定改写为普通成功 (剩余 LUC ${remaining})。请在叙事中将其呈现为"危急关头一闪念的好运"，而非技能本身真的成功。`;
    }

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

阈值：≤${Math.floor(target / 5)} 极难 / ≤${Math.floor(target / 2)} 困难 / ≤${target} 普通。${fateGambleNote}`;
    }

    const resultObj: RollResult = {
      dice10: tensValue,
      dice1: unitsValue,
      total: roll,
      targetValue: target,
      isBonus: bonusOrPenalty === "bonus",
      isPenalty: bonusOrPenalty === "penalty",
      successType,
      pushed: actionTaken === "pushed" || undefined,
      pushForcedFumble: pushForcedFumble || undefined,
      luckSpent: luckSpent > 0 ? luckSpent : undefined,
    };

    onComplete(resultObj, message);
  };

  return (
    <div id="dice-roll-modal-overlay" className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50 select-none backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className={`w-full max-w-lg ${isSanityCheck ? "bg-[#160e1c] border-2 border-purple-500" : "bg-[#141617] border-2 border-[#c1a067]"} rounded-lg shadow-2xl overflow-hidden font-sans`}
      >

        {/* Modal Header */}
        <div className={`${isSanityCheck ? "bg-[#1b1424] border-b border-purple-500/30" : "bg-[#1b1e20] border-b border-[#c1a067]/20"} p-4 flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            {isSanityCheck ? (
              <Skull className="w-5 h-5 text-purple-300 animate-pulse" />
            ) : (
              <Dices className="w-5 h-5 text-[#c1a067] animate-pulse" />
            )}
            <span className={`text-sm font-semibold uppercase tracking-wider font-mono ${isSanityCheck ? "text-purple-200" : "text-[#c1a067]"}`}>
              {isSanityCheck ? "理智惊狂检定 (SAN Check)" : "命运的判定检定"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`text-xs bg-black/50 border px-2 py-0.5 rounded font-mono ${isSanityCheck ? "border-purple-500/40 text-purple-300/80" : "border-[#c1a067]/30 text-gray-400"}`}>
              CoC 7E STANDARD
            </div>
            {phase === "idle" && !isKeeperRoll && !isSanityCheck && onCancel && (
              <button
                id="m-roll-cancel-btn"
                type="button"
                onClick={onCancel}
                title="取消本次掷骰，不向守密人汇报"
                className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500 transition flex items-center gap-1 font-sans"
              >
                <X className="w-3 h-3" /> 我再想想
              </button>
            )}
          </div>
        </div>

        {/* Quest Info */}
        <div className={`p-5 ${isSanityCheck ? "bg-black/50 border-b border-purple-950/60" : "bg-black/40 border-b border-gray-900"} text-center leading-relaxed font-sans`}>
          <div className={`text-xs uppercase tracking-widest font-mono mb-1 ${isSanityCheck ? "text-purple-400/80" : "text-gray-400"}`}>
            {isSecret ? "SECRET CHECK · 暗中判定" : isSanityCheck ? "SANITY THREAT · 理智冲击" : "DECIDING SUBJECT"}
          </div>
          <h3 className="text-xl font-bold text-gray-100 flex items-center justify-center gap-1">
            {isSecret ? (
              <>
                <span className="tracking-widest text-indigo-300/80">？？？</span>
                <span className="text-[#c1a067] font-mono text-lg">(???%)</span>
              </>
            ) : (
              <>
                <span className={isSanityCheck ? "text-purple-100" : ""}>{isSanityCheck ? "理智值 (Sanity)" : request.skillName}</span>
                <span className={`font-mono text-lg ${isSanityCheck ? "text-purple-300" : "text-[#c1a067]"}`}>({request.targetValue}%)</span>
              </>
            )}
          </h3>
          <p className={`text-xs italic mt-2 max-w-sm mx-auto font-sans ${isSanityCheck ? "text-purple-200/90" : "text-[#c1a067]/90"}`}>
            " {request.reason} "
          </p>
          {!isSecret && !isSanityCheck && (
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
          )}

          {/* SAN-only loss preview & forced-check notice */}
          {isSanityCheck && sanityMeta && (
            <div className="mt-3 flex flex-col items-center gap-2 font-sans">
              <div className="flex items-center gap-3 text-[11px] font-mono px-3 py-1.5 rounded border border-purple-900/60 bg-purple-950/30">
                <span className="text-gray-400">SAN 损失:</span>
                <span className="text-purple-200">
                  成功 <span className="text-purple-300 font-semibold">{sanityMeta.lossOnSuccess}</span>
                </span>
                <span className="text-gray-600">/</span>
                <span className="text-purple-200">
                  失败 <span className="text-red-300 font-semibold">{sanityMeta.lossOnFailure}</span>
                </span>
              </div>
              <div className="text-[10px] uppercase tracking-widest text-red-400/90 flex items-center gap-1">
                <Skull className="w-3 h-3" />
                理智冲击不可回避 — 你的调查员已经感知到了
              </div>
            </div>
          )}

          {/* Keeper-assigned bonus / penalty (read-only, CoC 7e: not player-selectable) */}
          {!isSecret && bonusOrPenalty !== "none" && (
            <div className="mt-3 inline-flex items-center gap-2 text-[11px] font-mono px-3 py-1 rounded border bg-black/40">
              <span className="text-gray-500">守密人裁定:</span>
              {bonusOrPenalty === "bonus" ? (
                <span className="text-[#c1a067] font-semibold">奖励骰 ×{bonusCount}</span>
              ) : (
                <span className="text-red-400 font-semibold">惩罚骰 ×{penaltyCount}</span>
              )}
            </div>
          )}
        </div>

        {/* Velvet Tray Dice Roller */}
        <div className={`p-8 flex flex-col items-center justify-center ${isSanityCheck ? "bg-radial from-[#2a1638] to-[#120819]" : "bg-radial from-[#152e25] to-[#0d1613]"} border-b border-gray-900 relative min-h-[220px]`}>

          {/* Subtle occult background ring */}
          <div className={`absolute w-44 h-44 rounded-full border ${isSanityCheck ? "border-purple-700/30" : "border-emerald-950/20"} animate-spin-slow pointer-events-none`} />

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
                    onClick={() => handleRoll()}
                    className={
                      isSanityCheck
                        ? "w-24 h-24 bg-gradient-to-tr from-purple-700 to-fuchsia-500 text-white font-semibold rounded-full shadow-[0_0_30px_rgba(168,85,247,0.5)] hover:scale-105 active:scale-95 transition-all flex flex-col items-center justify-center border-2 border-purple-200/30"
                        : "w-24 h-24 bg-gradient-to-tr from-[#c1a067] to-[#e4cb9c] text-black font-semibold rounded-full shadow-[0_0_25px_rgba(193,160,103,0.3)] hover:scale-105 active:scale-95 transition-all flex flex-col items-center justify-center border-2 border-amber-100/20"
                    }
                  >
                    {isSanityCheck ? (
                      <Skull className="w-8 h-8 mb-1 animate-pulse" />
                    ) : (
                      <Dices className="w-8 h-8 mb-1 animate-bounce" />
                    )}
                    <span className="text-xs tracking-widest font-bold">
                      {isSanityCheck ? "面 对!" : "掷 骰!"}
                    </span>
                  </button>
                  <p className={`text-xs font-sans mt-3 ${isSanityCheck ? "text-purple-300/90" : "text-gray-400"}`}>
                    {isSanityCheck ? "理智冲击不可回避——你的调查员已经感知到了" : "点击开启命运的转盘并判定检定等级"}
                  </p>
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
                className={
                  isSanityCheck
                    ? "w-20 h-20 bg-gradient-to-tr from-purple-950 to-purple-700 text-purple-100 border-2 border-purple-400 rounded-xl flex items-center justify-center text-3xl font-mono font-bold shadow-2xl"
                    : "w-20 h-20 bg-gradient-to-tr from-amber-950 to-amber-700 text-amber-200 border-2 border-[#c1a067] rounded-xl flex items-center justify-center text-3xl font-mono font-bold shadow-2xl"
                }
                animate={{ rotate: [0, 180, 360, 540, 720], scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 0.6 }}
              >
                {isSecret ? "?" : (simTens === 0 ? "00" : simTens)}
              </motion.div>

              <motion.div
                className={
                  isSanityCheck
                    ? "w-20 h-20 bg-gradient-to-tr from-fuchsia-950 to-fuchsia-700 text-fuchsia-100 border-2 border-fuchsia-400 rounded-xl flex items-center justify-center text-3xl font-mono font-bold shadow-2xl"
                    : "w-20 h-20 bg-gradient-to-tr from-emerald-950 to-emerald-800 text-emerald-200 border-2 border-emerald-500 rounded-xl flex items-center justify-center text-3xl font-mono font-bold shadow-2xl"
                }
                animate={{ rotate: [0, -180, -360, -540, -720], scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 0.6 }}
              >
                {isSecret ? "?" : simUnits}
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

                    {/* Discarded extra tens dice (bonus/penalty), shown faded — picked one is the main TENS below */}
                    {bonusOrPenalty !== "none" && tensRolls.length > 1 && (
                      <div className="flex flex-col items-center opacity-60">
                        <div className="text-[10px] text-gray-500 mb-1">备用十位</div>
                        <div className="flex gap-1">
                          {tensRolls
                            .filter((v) => v !== tensValue)
                            .slice(0, tensRolls.length - 1)
                            .map((v, i) => (
                              <div
                                key={i}
                                className="w-12 h-12 bg-gray-900 border border-gray-700 rounded-lg flex items-center justify-center text-base font-mono font-semibold text-gray-400"
                              >
                                {v === 0 ? "00" : v}
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-col items-center">
                      <div className={`text-[10px] uppercase mb-1 ${isSanityCheck ? "text-purple-300" : "text-[#c1a067]"}`}>TENS 十位数</div>
                      <motion.div
                        initial={{ scale: 0.5, rotate: -45 }}
                        animate={{ scale: 1, rotate: 0 }}
                        className={
                          isSanityCheck
                            ? "w-24 h-24 bg-gradient-to-br from-purple-900 to-[#160b1f] text-purple-200 border-2 border-purple-400 rounded-xl flex items-center justify-center text-4xl font-mono font-bold shadow-2xl shadow-purple-500/20"
                            : "w-24 h-24 bg-gradient-to-br from-amber-900 to-[#100f0d] text-[#c1a067] border-2 border-[#c1a067] rounded-xl flex items-center justify-center text-4xl font-mono font-bold shadow-2xl shadow-yellow-500/10"
                        }
                      >
                        {tensValue === 0 ? "00" : tensValue}
                      </motion.div>
                    </div>

                    <div className="text-2xl text-gray-500 font-mono self-center mt-5">+</div>

                    <div className="flex flex-col items-center">
                      <div className={`text-[10px] uppercase mb-1 ${isSanityCheck ? "text-fuchsia-300" : "text-emerald-400"}`}>UNITS 个位数</div>
                      <motion.div
                        initial={{ scale: 0.5, rotate: 45 }}
                        animate={{ scale: 1, rotate: 0 }}
                        className={
                          isSanityCheck
                            ? "w-24 h-24 bg-gradient-to-br from-fuchsia-900 to-[#160b1f] text-fuchsia-200 border-2 border-fuchsia-400 rounded-xl flex items-center justify-center text-4xl font-mono font-bold shadow-2xl shadow-fuchsia-500/20"
                            : "w-24 h-24 bg-gradient-to-br from-emerald-900 to-[#0c100e] text-emerald-300 border-2 border-emerald-500 rounded-xl flex items-center justify-center text-4xl font-mono font-bold shadow-2xl shadow-emerald-500/10"
                        }
                      >
                        {unitsValue}
                      </motion.div>
                    </div>

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

            {/* 命运博弈按钮区 — 仅在玩家明骰、判定失败、路径合规、且本次未用过命运博弈时出现 */}
            {(() => {
              if (isSecret || isSanityCheck || isKeeperRoll) return null;
              if (actionTaken !== "none") return null;
              const settledResult: RollResult = {
                dice10: tensValue,
                dice1: unitsValue,
                total: calculatedTotal,
                targetValue: request.targetValue,
                isBonus: bonusOrPenalty === "bonus",
                isPenalty: bonusOrPenalty === "penalty",
                successType,
              };
              if (!canPushRoll(request, settledResult)) return null;
              const burn = evaluateBurnLuck(request, settledResult, currentLuck);
              return (
                <div id="m-fate-gamble-row" className="mb-3 grid grid-cols-2 gap-2">
                  <button
                    id="m-fate-push-btn"
                    type="button"
                    onClick={handlePush}
                    title="重新投掷此判定。失败将升格为大失败 (Fumble)。"
                    className="bg-black/40 border border-red-700/40 hover:border-red-500 hover:bg-red-950/20 transition rounded p-2.5 text-left flex flex-col gap-1 group active:scale-[0.98]"
                  >
                    <div className="flex items-center gap-1.5 text-red-300 font-semibold text-xs font-sans">
                      <Repeat className="w-3.5 h-3.5 group-hover:rotate-180 transition-transform duration-300" />
                      <span>孤注一掷</span>
                      <span className="text-[9px] text-red-500/60 font-mono uppercase tracking-widest ml-auto">PUSH</span>
                    </div>
                    <div className="text-[10px] text-gray-500 font-sans leading-snug">
                      重新投掷一次，失败将升格为大失败
                    </div>
                  </button>

                  <button
                    id="m-fate-burn-btn"
                    type="button"
                    disabled={!burn.affordable}
                    onClick={burn.affordable ? handleBurn : undefined}
                    title={
                      burn.affordable
                        ? `燃烧 ${burn.cost} 点幸运将本次判定改写为普通成功`
                        : `需要 ${burn.cost} 点幸运，当前剩余 ${currentLuck} 点不足`
                    }
                    className={
                      burn.affordable
                        ? "bg-black/40 border border-coc-gold/40 hover:border-coc-gold hover:bg-[#10b981]/10 transition rounded p-2.5 text-left flex flex-col gap-1 group active:scale-[0.98]"
                        : "bg-black/40 border border-gray-800 rounded p-2.5 text-left flex flex-col gap-1 opacity-40 cursor-not-allowed"
                    }
                  >
                    <div className={`flex items-center gap-1.5 font-semibold text-xs font-sans ${burn.affordable ? "text-coc-gold" : "text-gray-500"}`}>
                      <Flame className="w-3.5 h-3.5" />
                      <span>燃运 -{burn.cost} LUC{burn.affordable ? "" : "（不足）"}</span>
                      <span className={`text-[9px] font-mono uppercase tracking-widest ml-auto ${burn.affordable ? "text-coc-gold/60" : "text-gray-600"}`}>
                        BURN
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500 font-sans leading-snug">
                      压至普通成功 · 剩余 LUC: {currentLuck}
                    </div>
                  </button>
                </div>
              );
            })()}

            {/* 命运博弈已使用 — 提示玩家本次的 fate gamble 选择 */}
            {actionTaken !== "none" && (
              <div id="m-fate-gamble-used" className="mb-3 px-3 py-2 rounded border border-[#c1a067]/20 bg-black/30 text-[11px] text-gray-400 font-sans flex items-center gap-2">
                {actionTaken === "pushed" ? (
                  <>
                    <Repeat className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <span className="text-red-300/80">
                      孤注一掷已使用 ·
                    </span>
                    <span>
                      二投结果已落定{pushForcedFumble ? "（失败已升格为大失败）" : ""}。
                    </span>
                  </>
                ) : (
                  <>
                    <Flame className="w-3.5 h-3.5 text-coc-gold shrink-0" />
                    <span className="text-coc-gold/80">燃运已使用 ·</span>
                    <span>
                      消耗 {luckSpent} 点幸运，判定改写为普通成功（剩余 LUC {Math.max(0, currentLuck - luckSpent)}）。
                    </span>
                  </>
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
                className={
                  isSanityCheck
                    ? "w-full py-3 bg-purple-700 hover:bg-purple-600 text-white font-semibold rounded tracking-wider shadow-lg shadow-purple-500/30 transition active:scale-95"
                    : "w-full py-3 bg-[#c1a067] hover:bg-[#d5b57d] text-black font-semibold rounded tracking-wider shadow-lg shadow-[#c1a067]/10 transition active:scale-95"
                }
              >
                {isSanityCheck ? "承受冲击，记录理智损耗" : "契定结果，同步向守密人汇报"}
              </button>
            )}
          </div>
        )}

      </motion.div>
    </div>
  );
}
