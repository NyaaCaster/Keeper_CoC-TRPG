/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useEffect, useRef } from "react";
import { CharacterSheet } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { Shield, Sparkles, AlertTriangle, Eye, Heart, BookOpen, ChevronRight, Zap, RefreshCw, FileText } from "lucide-react";
import CharacterDossierPanel from "./CharacterDossierPanel";
import { startingCashOf } from "../lib/cocRules";
import { findWeapon } from "../data/cocWeapons";

interface CharacterSheetPanelProps {
  sheet: CharacterSheet;
  hpDiff: number; // passed down to trigger animation
  sanDiff: number; // passed down to trigger animation
  mpDiff: number; // passed down to trigger animation
  luckDiff: number; // passed down to trigger animation
  onSkillIntentDraft?: (skillName: string, value: number) => void;
  onClose?: () => void;
}

export default function CharacterSheetPanel({
  sheet,
  hpDiff,
  sanDiff,
  mpDiff,
  luckDiff,
  onSkillIntentDraft,
  onClose
}: CharacterSheetPanelProps) {
  const [activeTab, setActiveTab] = useState<"attributes" | "skills">("attributes");
  const [showDossier, setShowDossier] = useState(false);

  // Animation Triggers
  const [hpAnim, setHpAnim] = useState<number | null>(null);
  const [sanAnim, setSanAnim] = useState<number | null>(null);
  const [mpAnim, setMpAnim] = useState<number | null>(null);
  const [luckAnim, setLuckAnim] = useState<number | null>(null);

  const prevHp = useRef(sheet.hp);
  const prevSan = useRef(sheet.san);
  const prevMp = useRef(sheet.mp);

  useEffect(() => {
    if (hpDiff !== 0) {
      setHpAnim(hpDiff);
      const timer = setTimeout(() => setHpAnim(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [hpDiff]);

  useEffect(() => {
    if (sanDiff !== 0) {
      setSanAnim(sanDiff);
      const timer = setTimeout(() => setSanAnim(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [sanDiff]);

  useEffect(() => {
    if (mpDiff !== 0) {
      setMpAnim(mpDiff);
      const timer = setTimeout(() => setMpAnim(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [mpDiff]);

  useEffect(() => {
    if (luckDiff !== 0) {
      setLuckAnim(luckDiff);
      const timer = setTimeout(() => setLuckAnim(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [luckDiff]);

  // Handle local comparisons if props are not directly pushed as diffs
  useEffect(() => {
    const hpChange = sheet.hp - prevHp.current;
    if (hpChange !== 0) {
      setHpAnim(hpChange);
      prevHp.current = sheet.hp;
      const timer = setTimeout(() => setHpAnim(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [sheet.hp]);

  useEffect(() => {
    const sanChange = sheet.san - prevSan.current;
    if (sanChange !== 0) {
      setSanAnim(sanChange);
      prevSan.current = sheet.san;
      const timer = setTimeout(() => setSanAnim(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [sheet.san]);

  useEffect(() => {
    const mpChange = sheet.mp - prevMp.current;
    if (mpChange !== 0) {
      setMpAnim(mpChange);
      prevMp.current = sheet.mp;
      const timer = setTimeout(() => setMpAnim(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [sheet.mp]);

  return (
    <div id="character-sheet-container" className="relative w-full h-full bg-[#111213]/95 border border-[#c1a067]/35 rounded-lg overflow-hidden flex flex-col font-sans text-gray-200">
      
      {/* Glitch Overlay for SAN loss */}
      {sanAnim !== null && sanAnim < 0 && (
        <div id="san-glitch-overlay" className="absolute inset-0 bg-purple-950/20 mix-blend-color-dodge animate-glitch pointer-events-none z-40 border-2 border-purple-500/40">
          <div className="absolute inset-0 bg-radial from-transparent to-purple-950/40" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-purple-400 font-mono text-xs tracking-widest bg-black/80 px-4 py-1.5 border border-purple-500/30 rounded uppercase select-none">
            【 理智丧失 / Sanity Loss 】
          </div>
          {/* twisting scanline */}
          <div className="absolute w-full h-0.5 bg-purple-500/25 top-0 animate-scanline" />
        </div>
      )}

      {/* Screen flash for HP loss */}
      {hpAnim !== null && hpAnim < 0 && (
        <div id="hp-damage-overlay" className="absolute inset-0 bg-red-950/30 animate-blood-flash pointer-events-none z-40 border-4 border-red-650 rounded-lg">
          <div className="absolute inset-0 bg-radial from-transparent to-red-950/50" />
        </div>
      )}

      {/* Header Panel */}
      <div className="p-4 bg-gradient-to-b from-[#181a1c] to-[#111213] border-b border-[#c1a067]/15 flex items-center">
        <div className="flex items-center gap-3">
          {sheet.avatar ? (
            <img src={sheet.avatar} className="w-10 h-10 rounded-full border border-[#c1a067]/40 object-cover shadow-[0_0_8px_rgba(193,160,103,0.15)] bg-black/40" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-[#c1a067]/15 border border-[#c1a067]/30 flex items-center justify-center font-bold text-[#c1a067] text-md font-sans">
              {sheet.name.trim().charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <span className="text-[10px] text-[#c1a067] font-mono tracking-wider uppercase">Active Investigator</span>
            <h2 id="cs-name-display" className="text-md font-bold text-gray-100 flex items-center gap-1.5 font-sans">
              <span>{sheet.name}</span>
              <span className="text-xs text-gray-405 font-normal">({sheet.gender || "男"} • {sheet.age || 30}岁)</span>
              <button
                id="cs-open-dossier-btn"
                type="button"
                onClick={() => setShowDossier(true)}
                title="调查员档案"
                aria-label="打开调查员档案"
                className="ml-1 p-1 rounded text-[#c1a067]/70 hover:text-[#c1a067] hover:bg-[#c1a067]/10 border border-transparent hover:border-[#c1a067]/30 transition"
              >
                <FileText className="w-3.5 h-3.5" />
              </button>
            </h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {sheet.identity && sheet.identity.trim() !== "" && (
                <p id="cs-identity-display" className="text-xs text-gray-400 font-sans">{sheet.identity}</p>
              )}
              <span
                id="cs-occupation-tag"
                className="text-[10px] bg-[#c1a067]/10 text-[#c1a067] border border-[#c1a067]/25 px-1.5 py-0.5 rounded font-sans"
              >
                {sheet.occupation}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 规则 10:疯狂态横幅 — 仅当 sanityState.madness 非 null 时显示。
          bout = 急性发作(红紫闪烁) / temporary = 临时疯狂(紫) / indefinite = 不定期疯狂(深紫,持续)
          阶段 10.6：高度按数据自适应，bout 多一行剩余玩家回合，indefinite 多一行 anchor。 */}
      {sheet.sanityState?.madness && (() => {
        const ss = sheet.sanityState!;
        const m = ss.madness;
        const boutId = ss.boutRoll ?? 1;
        const tableNames = [
          "失忆", "心理性残障", "狂暴攻击", "偏执", "关键人物错认",
          "昏厥", "恐慌逃离", "歇斯底里", "获得恐惧症", "获得狂躁症",
        ];
        const symptomName = tableNames[Math.max(0, Math.min(9, boutId - 1))];
        const tone =
          m === "bout"
            ? "border-red-500/60 bg-red-950/40 text-red-200 animate-pulse"
            : m === "temporary"
              ? "border-fuchsia-600/60 bg-fuchsia-950/30 text-fuchsia-200"
              : "border-purple-700/70 bg-purple-950/40 text-purple-200";
        const label =
          m === "bout"
            ? "急性发作 · BOUT OF MADNESS"
            : m === "temporary"
              ? `临时疯狂 · TEMPORARY (剩余 ${ss.temporaryTurnsRemaining ?? 0} 守密人回合)`
              : "不定期疯狂 · INDEFINITE (持续整个模组)";
        return (
          <div className={`mx-3.5 mt-3 px-3 py-2 border-2 rounded-md font-mono ${tone}`}>
            <div className="text-[10px] uppercase tracking-widest font-semibold mb-0.5">
              ⚠ {label}
            </div>
            <div className="text-[11px] font-sans">
              起源症状 #{boutId} <span className="font-semibold">{symptomName}</span>
            </div>
            {m === "bout" && typeof ss.boutTurnsRemaining === "number" && (
              <div className="text-[11px] font-sans mt-0.5">
                剩余玩家回合: <span className="font-semibold">{ss.boutTurnsRemaining}</span>
              </div>
            )}
            {m === "indefinite" && ss.indefiniteAnchor && (
              <div className="text-[11px] font-sans mt-0.5">
                触发于 <span className="font-semibold">{ss.indefiniteAnchor.moduleName}</span>
                <span className="text-purple-300/70"> · 回合 {ss.indefiniteAnchor.turnId}</span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Stats Quick Meters */}
      <div className="grid grid-cols-4 gap-2 p-3.5 bg-black/30 border-b border-gray-900 leading-none relative">
        
        {/* HP Meter with animated damage */}
        <div className="bg-[#191111]/70 border border-red-950/40 p-2 rounded text-center relative overflow-hidden flex flex-col justify-between">
          <div>
            <Heart className="w-3.5 h-3.5 text-red-500 mx-auto mb-1 animate-pulse" />
            <div className="text-[9px] text-gray-400 font-sans">HP (生命)</div>
            <div className="text-sm font-mono font-bold text-red-400 mt-1">{sheet.hp} <span className="text-[10px] text-red-600 font-normal">/{sheet.maxHp}</span></div>
          </div>
          <div className="h-1 bg-black/50 rounded-full overflow-hidden mt-2 w-full">
            <div 
              className="h-full bg-red-500 rounded-full shadow-[0_0_6px_#ef4444] transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, (sheet.hp / sheet.maxHp) * 100))}%` }}
            />
          </div>
          {/* floating diff */}
          <AnimatePresence>
            {hpAnim !== null && (
              <motion.div 
                id="floating-hp-indicator"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: -25 }}
                exit={{ opacity: 0 }}
                className={`absolute top-1/2 left-0 right-0 text-center font-mono font-black text-xs ${hpAnim < 0 ? "text-red-500" : "text-green-400"}`}
              >
                {hpAnim < 0 ? hpAnim : `+${hpAnim}`} HP
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* MP Meter with animated magic points */}
        <div className="bg-[#11161d]/70 border border-blue-950/40 p-2 rounded text-center relative overflow-hidden flex flex-col justify-between">
          <div>
            <Zap className="w-3.5 h-3.5 text-blue-500 mx-auto mb-1" />
            <div className="text-[9px] text-gray-400 font-sans">MP (魔法)</div>
            <div className="text-sm font-mono font-bold text-blue-400 mt-1">{sheet.mp} <span className="text-[10px] text-blue-500 font-normal">/{sheet.maxMp}</span></div>
          </div>
          <div className="h-1 bg-black/50 rounded-full overflow-hidden mt-2 w-full">
            <div 
              className="h-full bg-blue-500 rounded-full shadow-[0_0_6px_#3b82f6] transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, (sheet.mp / (sheet.maxMp || 1)) * 100))}%` }}
            />
          </div>
          {/* floating diff */}
          <AnimatePresence>
            {mpAnim !== null && (
              <motion.div 
                id="floating-mp-indicator"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: -25 }}
                exit={{ opacity: 0 }}
                className={`absolute top-1/2 left-0 right-0 text-center font-mono font-black text-xs ${mpAnim < 0 ? "text-blue-500" : "text-emerald-400"}`}
              >
                {mpAnim < 0 ? mpAnim : `+${mpAnim}`} MP
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* SAN Meter with animated mental distortion — 紫色主题与 SAN 检定 modal 一致 */}
        <div className="bg-[#160e1c]/70 border border-purple-500/25 p-2 rounded text-center relative overflow-hidden flex flex-col justify-between">
          <div>
            <Eye className="w-3.5 h-3.5 text-purple-300 mx-auto mb-1 animate-pulse" />
            <div className="text-[9px] text-gray-400 font-sans">SAN (理智)</div>
            <div className="text-sm font-mono font-bold text-purple-200 mt-1">{sheet.san} <span className="text-[10px] text-purple-400/70 font-normal">/{sheet.maxSan}</span></div>
          </div>
          <div className="h-1 bg-black/50 rounded-full overflow-hidden mt-2 w-full">
            <div
              className="h-full bg-purple-500 rounded-full shadow-[0_0_6px_#a855f7] transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, (sheet.san / (sheet.maxSan || 1)) * 100))}%` }}
            />
          </div>
          {/* floating diff */}
          <AnimatePresence>
            {sanAnim !== null && (
              <motion.div
                id="floating-san-indicator"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: -25 }}
                exit={{ opacity: 0 }}
                className={`absolute top-1/2 left-0 right-0 text-center font-mono font-black text-xs ${sanAnim < 0 ? "text-purple-400" : "text-purple-200"}`}
              >
                {sanAnim < 0 ? sanAnim : `+${sanAnim}`} SAN
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Luck meter */}
        <div className="bg-[#1a1911]/70 border border-yellow-950/30 p-2 rounded text-center flex flex-col justify-between relative overflow-hidden">
          <div>
            <Sparkles className="w-3.5 h-3.5 text-yellow-500 mx-auto mb-1" />
            <div className="text-[9px] text-gray-400 font-sans">LUC (幸运)</div>
            <div className="text-sm font-mono font-bold text-yellow-500 mt-1">{sheet.attributes.luck} <span className="text-[10px] text-yellow-750 font-normal">/99</span></div>
          </div>
          <div className="h-1 bg-black/50 rounded-full overflow-hidden mt-2 w-full">
            <div
              className="h-full bg-yellow-500 rounded-full shadow-[0_0_6px_#eab308] transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, (sheet.attributes.luck / 99) * 100))}%` }}
            />
          </div>
          <AnimatePresence>
            {luckAnim !== null && (
              <motion.div
                id="floating-luck-indicator"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: -25 }}
                exit={{ opacity: 0 }}
                className={`absolute top-1/2 left-0 right-0 text-center font-mono font-black text-xs ${luckAnim < 0 ? "text-orange-500" : "text-green-400"}`}
              >
                {luckAnim < 0 ? luckAnim : `+${luckAnim}`} LUC
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Tabs list */}
      <div className="flex bg-[#161718] border-b border-gray-900 text-xs">
        <button
          id="cs-tab-attrs-btn"
          type="button"
          onClick={() => setActiveTab("attributes")}
          className={`flex-1 py-2 text-center transition font-medium border-b ${activeTab === "attributes" ? "border-[#c1a067] text-[#c1a067] bg-black/20" : "border-transparent text-gray-400"}`}
        >
          能力属性
        </button>
        <button
          id="cs-tab-skills-btn"
          type="button"
          onClick={() => setActiveTab("skills")}
          className={`flex-1 py-2 text-center transition font-medium border-b ${activeTab === "skills" ? "border-[#c1a067] text-[#c1a067] bg-black/20" : "border-transparent text-gray-400"}`}
        >
          探索技能
        </button>
      </div>

      {/* Tab Panels */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 custom-scrollbar">
        {activeTab === "attributes" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: "力量 STR", val: sheet.attributes.str },
                { name: "体质 CON", val: sheet.attributes.con },
                { name: "体型 SIZ", val: sheet.attributes.siz },
                { name: "敏捷 DEX", val: sheet.attributes.dex },
                { name: "外貌 APP", val: sheet.attributes.app },
                { name: "智力 INT", val: sheet.attributes.int },
                { name: "意志 POW", val: sheet.attributes.pow },
                { name: "教育 EDU", val: sheet.attributes.edu }
              ].map((attr) => (
                <div
                  id={`cs-attr-row-${attr.name.split(' ')[1]}`}
                  key={attr.name}
                  onClick={() => onSkillIntentDraft?.(attr.name.split(" ")[0], attr.val)}
                  title="向守密人提议用此项检定（最终是否掷骰由守密人裁定）"
                  className="bg-black/20 border border-gray-800/60 p-2.5 rounded hover:border-[#c1a067]/45 cursor-pointer transition group"
                >
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] font-semibold text-gray-400 group-hover:text-[#c1a067] transition font-sans">{attr.name}</span>
                    <span className="font-mono text-base font-bold text-gray-100">{attr.val}%</span>
                  </div>
                </div>
              ))}
            </div>

            {/* 道具栏（8 槽随身，House Rule） + 现金（运行时余额，旧档回退派生值） */}
            <div id="cs-inventory-section" className="bg-black/30 border border-gray-800/70 rounded p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 border-b border-gray-800/60 pb-1.5">
                <span className="text-[11px] font-semibold text-[#c1a067] tracking-wider font-sans">道具栏</span>
                <span className="text-[11px] font-mono text-amber-200">
                  现金: <span className="text-[#c1a067] font-semibold">${
                    typeof sheet.cashBalance === "number"
                      ? sheet.cashBalance
                      : startingCashOf(sheet.creditRating || 0, sheet.background)
                  }</span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {Array.from({ length: 8 }, (_, i) => {
                  const entry = sheet.inventory?.[i];
                  let label = "—";
                  let isEmpty = true;
                  if (entry) {
                    if (entry.kind === "weapon") {
                      const w = findWeapon(entry.weaponId);
                      if (w) {
                        // 阶段 10：武器名后括号显示 当前/上限 弹药；近战 maxAmmo===0 不显示括号
                        label = w.maxAmmo > 0
                          ? `${w.nameZh}(${entry.ammo}/${w.maxAmmo})`
                          : w.nameZh;
                        isEmpty = false;
                      }
                    } else if (entry.kind === "item" && entry.text.trim() !== "") {
                      label = entry.text.trim();
                      isEmpty = false;
                    }
                  }
                  return (
                    <div
                      id={`cs-inv-slot-${i}`}
                      key={i}
                      className={`flex items-center gap-1.5 bg-black/40 border rounded px-2 py-1.5 text-[11px] font-sans ${
                        isEmpty ? "border-gray-900/60 text-gray-700" : "border-gray-800/60 text-gray-200"
                      }`}
                      title={isEmpty ? `空槽 #${i + 1}` : `槽 #${i + 1}: ${label}`}
                    >
                      <span className="text-[9px] font-mono text-gray-600 shrink-0">#{i + 1}</span>
                      <span className="truncate">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <SkillsTabContent sheet={sheet} onSkillIntentDraft={onSkillIntentDraft} />
        )}
      </div>

      {/* Occult Warning sign at footer */}
      <div className="p-3 bg-[#111213] border-t border-[#c1a067]/15 text-center text-[10px] font-sans text-gray-500 flex items-center justify-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-[#c1a067]/40" />
        <span>注意：克苏鲁神话(Mythos)技能增涨会导致SAN度永久扣竭</span>
      </div>

      <CharacterDossierPanel
        isOpen={showDossier}
        onClose={() => setShowDossier(false)}
        sheet={sheet}
      />

    </div>
  );
}

// ============================================================================
// 探索技能 tab 主体 + 隐秘记录容器（阶段 10.5）
// 隐秘记录三项任一非空才渲染：episodeSanLoss > 0 / mythos > 0 / mythicEncounters 任一类有条目
// ============================================================================

function SkillsTabContent({
  sheet,
  onSkillIntentDraft,
}: {
  sheet: CharacterSheet;
  onSkillIntentDraft?: (skillName: string, value: number) => void;
}) {
  const episodeSanLoss = sheet.sanityState?.episodeSanLoss ?? 0;
  const mythos = sheet.mythos ?? 0;
  const me = sheet.mythicEncounters;
  const hasAnyEncounter =
    !!me &&
    (
      (me.tomes?.length ?? 0) > 0 ||
      (me.spells?.length ?? 0) > 0 ||
      (me.artifacts?.length ?? 0) > 0 ||
      (me.entities?.length ?? 0) > 0
    );
  const showHidden = episodeSanLoss > 0 || mythos > 0 || hasAnyEncounter;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {Object.entries(sheet.skills).map(([skill, val]) => (
          <div
            id={`cs-skill-row-${skill}`}
            key={skill}
            onClick={() => onSkillIntentDraft?.(skill, val)}
            title="向守密人提议用此项检定（最终是否掷骰由守密人裁定）"
            className="flex items-center justify-between bg-black/20 border border-gray-900/40 rounded px-2.5 py-1.5 hover:border-[#c1a067]/35 cursor-pointer group transition text-xs"
          >
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#c1a067]/50" />
              <span className="text-gray-300 font-semibold group-hover:text-[#c1a067] font-sans">{skill}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[9px] text-[#c1a067]/40 font-mono">
                ({Math.floor(val / 2)} / {Math.floor(val / 5)})
              </span>
              <span className="font-mono font-bold text-[#c1a067] bg-black/40 px-1.5 py-0.5 rounded text-xs">{val}%</span>
            </div>
          </div>
        ))}
      </div>

      {showHidden && (
        <HiddenRecordsSection
          episodeSanLoss={episodeSanLoss}
          mythos={mythos}
          mythicEncounters={me}
        />
      )}
    </div>
  );
}

const TOME_STATE_LABEL: Record<"skimmed" | "read" | "studied", string> = {
  skimmed: "略读",
  read: "通读",
  studied: "精研",
};
const ARTIFACT_STATE_LABEL: Record<"held" | "encountered", string> = {
  held: "持有",
  encountered: "接触",
};

function HiddenRecordsSection({
  episodeSanLoss,
  mythos,
  mythicEncounters,
}: {
  episodeSanLoss: number;
  mythos: number;
  mythicEncounters?: CharacterSheet["mythicEncounters"];
}) {
  const tomes = mythicEncounters?.tomes ?? [];
  const spells = mythicEncounters?.spells ?? [];
  const artifacts = mythicEncounters?.artifacts ?? [];
  const entities = mythicEncounters?.entities ?? [];

  return (
    <div
      id="cs-hidden-records"
      className="border border-purple-900/40 bg-purple-950/15 rounded p-3 space-y-2"
    >
      <div className="flex items-center justify-between gap-2 border-b border-purple-900/40 pb-1.5">
        <span className="text-[11px] font-semibold text-purple-300 tracking-wider font-sans">隐秘记录</span>
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="text-purple-200">
            累计SAN损失: <span className="text-purple-100 font-semibold">{episodeSanLoss}</span>
          </span>
          <span className="text-purple-200">
            克苏鲁神话: <span className="text-purple-100 font-semibold">{mythos}</span>
          </span>
        </div>
      </div>

      {tomes.length > 0 && (
        <EncounterCategory title="神话著作">
          {tomes.map((t) => (
            <EncounterRow
              key={t.id}
              name={t.name}
              state={TOME_STATE_LABEL[t.state]}
              notes={t.notes}
              acquiredAt={t.acquiredAt}
            />
          ))}
        </EncounterCategory>
      )}
      {spells.length > 0 && (
        <EncounterCategory title="法术">
          {spells.map((s) => (
            <EncounterRow
              key={s.id}
              name={s.name}
              state={s.cost}
              notes={s.notes}
              acquiredAt={s.acquiredAt}
            />
          ))}
        </EncounterCategory>
      )}
      {artifacts.length > 0 && (
        <EncounterCategory title="神器">
          {artifacts.map((a) => (
            <EncounterRow
              key={a.id}
              name={a.name}
              state={ARTIFACT_STATE_LABEL[a.state]}
              notes={a.notes}
              acquiredAt={a.acquiredAt}
            />
          ))}
        </EncounterCategory>
      )}
      {entities.length > 0 && (
        <EncounterCategory title="接触实体">
          {entities.map((e) => (
            <EncounterRow
              key={e.id}
              name={e.name}
              notes={e.notes}
              acquiredAt={e.encounteredAt}
            />
          ))}
        </EncounterCategory>
      )}
    </div>
  );
}

function EncounterCategory({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest font-mono text-purple-400/70 mb-1">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function EncounterRow({
  name,
  state,
  notes,
  acquiredAt,
}: {
  name: string;
  state?: string;
  notes?: string;
  acquiredAt?: string;
}) {
  // 鼠标悬浮 + 点击切换 title 显示 notes / acquiredAt（受控 title 通过 toggle 一个 state）
  const [showDetail, setShowDetail] = useState(false);
  const detailParts = [acquiredAt && `获取: ${acquiredAt}`, notes].filter(Boolean) as string[];
  const detailText = detailParts.length > 0 ? detailParts.join(" · ") : undefined;
  const titleAttr = detailText ?? `${name}${state ? ` · ${state}` : ""}`;

  return (
    <div
      className="bg-black/30 border border-purple-900/30 rounded px-2 py-1 text-[11px] font-sans text-purple-100 cursor-pointer select-none"
      title={titleAttr}
      onClick={() => detailText && setShowDetail((v) => !v)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold truncate">{name}</span>
        {state && <span className="text-[9px] text-purple-300/70 font-mono shrink-0">{state}</span>}
      </div>
      {showDetail && detailText && (
        <div className="text-[10px] text-purple-200/70 mt-0.5 break-words">{detailText}</div>
      )}
    </div>
  );
}
