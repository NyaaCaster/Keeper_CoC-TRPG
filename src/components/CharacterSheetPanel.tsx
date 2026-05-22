/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useEffect, useRef } from "react";
import { CharacterSheet } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { Shield, Sparkles, AlertTriangle, Eye, Heart, BookOpen, ChevronRight, Zap, RefreshCw } from "lucide-react";

interface CharacterSheetPanelProps {
  sheet: CharacterSheet;
  hpDiff: number; // passed down to trigger animation
  sanDiff: number; // passed down to trigger animation
  mpDiff: number; // passed down to trigger animation
  onSkillCheckTrigger?: (skillName: string, value: number) => void;
  onClose?: () => void;
}

export default function CharacterSheetPanel({ 
  sheet, 
  hpDiff, 
  sanDiff, 
  mpDiff,
  onSkillCheckTrigger,
  onClose 
}: CharacterSheetPanelProps) {
  const [activeTab, setActiveTab] = useState<"attributes" | "skills">("attributes");
  
  // Animation Triggers
  const [hpAnim, setHpAnim] = useState<number | null>(null);
  const [sanAnim, setSanAnim] = useState<number | null>(null);
  const [mpAnim, setMpAnim] = useState<number | null>(null);

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
      <div className="p-4 bg-gradient-to-b from-[#181a1c] to-[#111213] border-b border-[#c1a067]/15 flex items-center justify-between">
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
            </h2>
            <p id="cs-job-display" className="text-xs text-gray-400 font-sans mt-0.5">{sheet.occupation}</p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[9px] bg-[#c1a067]/10 text-[#c1a067] border border-[#c1a067]/25 px-1.5 py-0.5 rounded font-mono uppercase tracking-widest">
            {sheet.background === "1920s" ? "1920s Jazz Era" : "Modern Science/Magic"}
          </span>
        </div>
      </div>

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

        {/* SAN Meter with animated mental distortion */}
        <div className="bg-[#17111b]/70 border border-[#10b981]/20 p-2 rounded text-center relative overflow-hidden flex flex-col justify-between">
          <div>
            <Eye className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1 animate-pulse" />
            <div className="text-[9px] text-gray-400 font-sans">SAN (理智)</div>
            <div className="text-sm font-mono font-bold text-emerald-300 mt-1">{sheet.san} <span className="text-[10px] text-emerald-600 font-normal">/{sheet.maxSanLimit}</span></div>
          </div>
          <div className="h-1 bg-black/50 rounded-full overflow-hidden mt-2 w-full">
            <div 
              className="h-full bg-[#10b981] rounded-full shadow-[0_0_6px_#10b981] transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, (sheet.san / (sheet.maxSanLimit || 1)) * 100))}%` }}
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
                className={`absolute top-1/2 left-0 right-0 text-center font-mono font-black text-xs ${sanAnim < 0 ? "text-emerald-500" : "text-green-400"}`}
              >
                {sanAnim < 0 ? sanAnim : `+${sanAnim}`} SAN
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Luck meter */}
        <div className="bg-[#1a1911]/70 border border-yellow-950/30 p-2 rounded text-center flex flex-col justify-between">
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
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {activeTab === "attributes" ? (
          <div className="grid grid-cols-2 gap-3">
            {[
              { name: "力量 STR", val: sheet.attributes.str, desc: "肌肉、物理爆发力和推重物。影响对抗属性判定" },
              { name: "体质 CON", val: sheet.attributes.con, desc: "新陈代谢率、抵抗痛苦和毒素。承伤恢复的硬指标" },
              { name: "体型 SIZ", val: sheet.attributes.siz, desc: "调查员的骨架与身高。直接决定初始HP上限" },
              { name: "敏捷 DEX", val: sheet.attributes.dex, desc: "速度与神经反射。决定敏捷规避时的成功标准" },
              { name: "外貌 APP", val: sheet.attributes.app, desc: "相貌、社交风仪。在欺骗或说服时带来暗增值" },
              { name: "智力 INT", val: sheet.attributes.int, desc: "理解力、脑力记忆与灵感。在调查中获取魔术回路" },
              { name: "意志 POW", val: sheet.attributes.pow, desc: "心智防护阀门。POW直接等于玩家初始的SAN理智" },
              { name: "教育 EDU", val: sheet.attributes.edu, desc: "科学及神代学识积累。影响探索和破译古老教典" }
            ].map((attr) => (
              <div 
                id={`cs-attr-row-${attr.name.split(' ')[1]}`}
                key={attr.name}
                onClick={() => onSkillCheckTrigger?.(attr.name.split(" ")[0], attr.val)}
                className="bg-black/20 border border-gray-800/60 p-2.5 rounded hover:border-[#c1a067]/45 cursor-pointer transition group"
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[11px] font-semibold text-gray-400 group-hover:text-[#c1a067] transition font-sans">{attr.name}</span>
                  <span className="font-mono text-base font-bold text-gray-100">{attr.val}%</span>
                </div>
                <div className="text-[10px] text-gray-500 font-sans leading-tight hidden group-hover:block">{attr.desc}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1.5">
            {Object.entries(sheet.skills).map(([skill, val]) => (
              <div 
                id={`cs-skill-row-${skill}`}
                key={skill}
                onClick={() => onSkillCheckTrigger?.(skill, val)}
                className="flex items-center justify-between bg-black/20 border border-gray-900/40 rounded px-2.5 py-1.5 hover:border-[#c1a067]/35 cursor-pointer group transition text-xs"
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#c1a067]/50" />
                  <span className="text-gray-300 font-semibold group-hover:text-[#c1a067] font-sans">{skill}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  {/* Half / Fifth references for pro details */}
                  <span className="text-[9px] text-[#c1a067]/40 font-mono">
                    ({Math.floor(val/2)} / {Math.floor(val/5)})
                  </span>
                  <span className="font-mono font-bold text-[#c1a067] bg-black/40 px-1.5 py-0.5 rounded text-xs">{val}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Occult Warning sign at footer */}
      <div className="p-3 bg-[#111213] border-t border-[#c1a067]/15 text-center text-[10px] font-sans text-gray-500 flex items-center justify-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-[#c1a067]/40" />
        <span>注意：克苏鲁神话(Mythos)技能增涨会导致SAN度永久扣竭</span>
      </div>

    </div>
  );
}
