/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ExperiencePhaseModal — 剧本模式经验阶段结算弹窗。
 *
 * 触发时机:scenario-based 模式下 ending.frame.scenarioEndKind ∈ {victory, ambiguous}
 * 且 ending.frame.rewards.skillGrowth === true 时,App.tsx 在写入 scenarioEnd 后
 * 调用本组件,完成"技能成长检定 + 首次破 90 +2d6 SAN + 主线/条件 SAN 奖励 + 现金奖励"
 * 一次性结算,玩家点确认后写回 sheet 并清空 ScenarioState.skillTicks。
 *
 * 设计要点:
 *   - 跑团数据(skillRolls / sanBreakdown / cashGain)由父组件用 runExperiencePhase
 *     预先算好,本组件只负责"逐项揭晓动画 + 接受确认"。
 *   - 不接受 cancel,玩家只有"确认领取"一个出口(经验阶段无悔棋设计)。
 *   - 配色严格三色主导:黑底 + 绿点缀 + 白文,SAN/HP 走属性色规范。
 *   - 滚动条挂 custom-scrollbar(项目铁律)。
 */

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Award, Dices, Download, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { findSkill } from "../data/cocSkills";
import { downloadCharacterCard } from "../lib/characterCardRender";
import type { CharacterSheet } from "../types";
import type {
  ExperiencePhaseOutcome,
  SkillGrowthRollResult,
} from "../lib/scenarioRuntime";

interface ExperiencePhaseModalProps {
  /** runExperiencePhase 算好的整套结果 */
  outcome: ExperiencePhaseOutcome;
  /** ending 标题 + scenarioEndKind,顶栏展示用 */
  endingTitle: string;
  endingKind: "victory" | "ambiguous";
  /**
   * App.tsx 预先计算好的「奖励落账后的最终 sheet」。
   * 用于:① 玩家点击「下载更新后的角色卡 PNG」时直接走 downloadCharacterCard;
   *       ② 保证下载到的卡片与 onConfirm 写回的 sheet 完全一致。
   * 已在 App.tsx 入口处对 skills 应用 ≤90 钳制,跨实例 PNG 导入安全。
   */
  pendingSheet: CharacterSheet;
  /** 玩家点「确认领取奖励」时回调,父组件写回 sheet/scenarioState 并清 skillTicks */
  onConfirm: () => void;
  /** 玩家在结算页点「完成」关闭弹窗时回调(下载是否完成不影响) */
  onDismiss: () => void;
}

export default function ExperiencePhaseModal({
  outcome,
  endingTitle,
  endingKind,
  pendingSheet,
  onConfirm,
  onDismiss,
}: ExperiencePhaseModalProps) {
  // 揭晓阶段:逐项展开,所有项展开后才显示「确认」按钮
  const [revealedSkills, setRevealedSkills] = useState(0);
  const [revealedSan, setRevealedSan] = useState(false);
  const [revealedCash, setRevealedCash] = useState(false);
  // 玩家点完「确认领取奖励」后切到结算页:展示下载 + 完成
  const [applied, setApplied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const totalSkills = outcome.skillRolls.length;
  const allRevealed =
    revealedSkills >= totalSkills && revealedSan && revealedCash;

  useEffect(() => {
    if (applied) return;
    // 技能逐项揭晓:每 350ms 揭一项
    if (revealedSkills < totalSkills) {
      const t = setTimeout(() => setRevealedSkills((v) => v + 1), 350);
      return () => clearTimeout(t);
    }
    // 技能揭完 → 揭 SAN
    if (!revealedSan) {
      const t = setTimeout(() => setRevealedSan(true), 500);
      return () => clearTimeout(t);
    }
    // SAN 揭完 → 揭现金
    if (!revealedCash) {
      const t = setTimeout(() => setRevealedCash(true), 500);
      return () => clearTimeout(t);
    }
  }, [revealedSkills, revealedSan, revealedCash, totalSkills, applied]);

  const handleConfirm = () => {
    onConfirm();
    setApplied(true);
  };

  const handleDownload = async () => {
    setDownloadError(null);
    setDownloading(true);
    try {
      await downloadCharacterCard(pendingSheet);
    } catch (e) {
      setDownloadError((e as Error).message || "下载失败");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar bg-black border-2 border-coc-gold/60 rounded-lg p-6 shadow-2xl shadow-coc-gold/20"
          initial={{ scale: 0.92, y: 24 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          {/* 顶部标题 */}
          <div className="flex items-center gap-3 border-b border-coc-gold/30 pb-3 mb-4">
            <Award className="w-7 h-7 text-coc-gold" />
            <div className="flex-1">
              <h2 className="text-xl font-bold text-coc-gold tracking-wide">
                经验阶段
              </h2>
              <div className="text-sm text-white/70">
                {endingKind === "victory" ? "胜利结局" : "暧昧结局"} ·{" "}
                <span className="text-white">{endingTitle}</span>
              </div>
            </div>
          </div>

          {/* 技能成长检定 */}
          <SkillRollsSection
            rolls={outcome.skillRolls}
            revealed={applied ? totalSkills : revealedSkills}
          />

          {/* SAN 奖励明细 */}
          <SanBreakdownSection
            breakdown={outcome.sanBreakdown}
            total={outcome.sanGain}
            revealed={applied || revealedSan}
          />

          {/* 现金奖励 */}
          <CashSection
            cashGain={outcome.cashGain}
            revealed={applied || revealedCash}
          />

          {/* 底部按钮区 */}
          <div className="mt-6 pt-4 border-t border-coc-gold/30 flex flex-col gap-3">
            {!applied ? (
              <div className="flex justify-end">
                <motion.button
                  onClick={handleConfirm}
                  disabled={!allRevealed}
                  className="px-6 py-2 bg-coc-gold/20 hover:bg-coc-gold/30 border border-coc-gold text-coc-gold font-bold rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  whileHover={allRevealed ? { scale: 1.02 } : {}}
                  whileTap={allRevealed ? { scale: 0.98 } : {}}
                >
                  {allRevealed ? "确认领取奖励" : "结算中..."}
                </motion.button>
              </div>
            ) : (
              <>
                <div className="text-xs text-white/60 leading-relaxed">
                  奖励已写入调查员档案。建议立即下载更新后的角色卡 PNG 备份;
                  本卡可在其它游戏实例中通过「导入 PNG 角色卡」继续冒险。
                </div>
                {downloadError && (
                  <div className="text-xs text-rose-400">下载失败:{downloadError}</div>
                )}
                <div className="flex justify-end gap-2">
                  <motion.button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/60 text-emerald-300 font-bold rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    whileHover={!downloading ? { scale: 1.02 } : {}}
                    whileTap={!downloading ? { scale: 0.98 } : {}}
                  >
                    <Download className="w-4 h-4" />
                    {downloading ? "生成中..." : "下载更新后的角色卡 PNG"}
                  </motion.button>
                  <motion.button
                    onClick={onDismiss}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/30 text-white/80 font-bold rounded transition-colors"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    完成
                  </motion.button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// __CONTINUE_HERE__

// ----------------------------------------------------------------------------
// 子区:技能成长检定
// ----------------------------------------------------------------------------

interface SkillRollsSectionProps {
  rolls: SkillGrowthRollResult[];
  revealed: number;
}

function SkillRollsSection({ rolls, revealed }: SkillRollsSectionProps) {
  if (rolls.length === 0) {
    return (
      <div className="mb-4">
        <SectionHeader icon={<Dices className="w-5 h-5" />} title="技能成长检定" />
        <div className="text-sm text-white/50 italic px-3 py-2">
          本场冒险没有任何技能被打勾,跳过技能成长检定。
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <SectionHeader
        icon={<Dices className="w-5 h-5" />}
        title="技能成长检定"
        suffix={`(${rolls.length} 项)`}
      />
      <div className="space-y-1.5">
        {rolls.map((r, i) => (
          <SkillRollRow
            key={r.skillId}
            roll={r}
            visible={i < revealed}
          />
        ))}
      </div>
    </div>
  );
}

function SkillRollRow({
  roll,
  visible,
}: {
  roll: SkillGrowthRollResult;
  visible: boolean;
}) {
  const def = findSkill(roll.skillId);
  const skillName = def?.nameZh ?? roll.skillId;
  const delta = roll.after - roll.before;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={
            "flex items-center justify-between px-3 py-1.5 rounded text-sm " +
            (roll.passed
              ? "bg-coc-gold/10 border border-coc-gold/40"
              : "bg-white/5 border border-white/10")
          }
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25 }}
        >
          <div className="flex items-center gap-2">
            <span className="text-white font-medium min-w-[5em]">{skillName}</span>
            <span className="text-white/50">1d100 = {roll.roll}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-white/70 font-mono">
              {roll.before}
              {roll.passed && delta > 0 && (
                <>
                  <span className="text-coc-gold mx-1">→</span>
                  <span className="text-coc-gold font-bold">{roll.after}</span>
                </>
              )}
            </span>
            {roll.passed && delta > 0 ? (
              <span className="text-coc-gold text-xs">+{delta}</span>
            ) : (
              <span className="text-white/40 text-xs">未涨</span>
            )}
            {roll.crossedNinety && (
              <span className="text-yellow-400 text-xs flex items-center gap-0.5">
                <Sparkles className="w-3 h-3" />
                破90
              </span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ----------------------------------------------------------------------------
// 子区:SAN 奖励明细
// ----------------------------------------------------------------------------

interface SanBreakdownSectionProps {
  breakdown: { source: string; amount: number; detail?: string }[];
  total: number;
  revealed: boolean;
}

function SanBreakdownSection({
  breakdown,
  total,
  revealed,
}: SanBreakdownSectionProps) {
  if (breakdown.length === 0) {
    return (
      <div className="mb-4">
        <SectionHeader
          icon={<TrendingUp className="w-5 h-5" />}
          title="SAN 奖励"
        />
        <div className="text-sm text-white/50 italic px-3 py-2">
          本结局无 SAN 奖励。
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <SectionHeader
        icon={<TrendingUp className="w-5 h-5" />}
        title="SAN 奖励"
        suffix={revealed ? `(总计 +${total})` : ""}
      />
      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={{ duration: 0.3 }}
            className="space-y-1.5 overflow-hidden"
          >
            {breakdown.map((row, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-1.5 rounded text-sm bg-emerald-500/10 border border-emerald-500/30"
              >
                <div className="flex flex-col">
                  <span className="text-white">{row.source}</span>
                  {row.detail && (
                    <span className="text-white/50 text-xs">{row.detail}</span>
                  )}
                </div>
                <span className="text-emerald-400 font-bold font-mono">
                  +{row.amount}
                </span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ----------------------------------------------------------------------------
// 子区:现金奖励
// ----------------------------------------------------------------------------

function CashSection({
  cashGain,
  revealed,
}: {
  cashGain: number;
  revealed: boolean;
}) {
  if (cashGain <= 0) return null;

  return (
    <div className="mb-2">
      <SectionHeader icon={<Wallet className="w-5 h-5" />} title="现金奖励" />
      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="flex items-center justify-between px-3 py-2 rounded bg-coc-gold/10 border border-coc-gold/40"
          >
            <span className="text-white">直接加到现金余额</span>
            <span className="text-coc-gold font-bold text-lg">
              +${cashGain.toLocaleString()}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ----------------------------------------------------------------------------
// 通用 section header
// ----------------------------------------------------------------------------

function SectionHeader({
  icon,
  title,
  suffix,
}: {
  icon: React.ReactNode;
  title: string;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2 text-coc-gold">
      {icon}
      <h3 className="font-bold">{title}</h3>
      {suffix && <span className="text-xs text-white/60">{suffix}</span>}
    </div>
  );
}
