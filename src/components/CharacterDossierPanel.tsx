/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { X, FileText, Download } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { CharacterSheet } from "../types";
import { downloadCharacterCard } from "../lib/characterCardRender";
import { rebuildCreationSnapshot } from "../lib/rebuildCreationSnapshot";

interface CharacterDossierPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sheet: CharacterSheet;
}

export default function CharacterDossierPanel({
  isOpen,
  onClose,
  sheet,
}: CharacterDossierPanelProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // 跑团中点击导出 = 创建期原貌（HP 满 / SAN 未扣 / 技能未涨值 / 现金未消 / 装备未变）。
  // 老存档没有 creationSnapshot 字段,用 rebuildCreationSnapshot 从当前 sheet 现算一份合规快照,
  // 保证导出物始终通过 .docs/character-dictionary.yaml 校验。
  const handleDownload = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const exportSheet = sheet.creationSnapshot ?? rebuildCreationSnapshot(sheet);
      await downloadCharacterCard(exportSheet);
    } catch (e) {
      console.error("Failure compiling downloadable investigator card representation:", e);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 10 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative w-full max-w-3xl h-[80vh] bg-[#0c1410] border border-[#183022] rounded-xl shadow-2xl flex flex-col text-gray-300"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#183022] bg-[#0d1410] rounded-t-xl shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <FileText size={18} className="text-coc-gold shrink-0" />
                <h2 className="text-sm font-semibold tracking-wider text-gray-200 font-sans truncate">
                  调查员档案 · Investigator Dossier
                </h2>
                <span className="text-[10px] text-gray-500 font-mono shrink-0">
                  {sheet.name} · {sheet.occupation}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono text-coc-gold/90 hover:text-coc-gold border border-coc-gold/40 hover:border-coc-gold/70 hover:bg-coc-gold/10 rounded transition-colors disabled:opacity-50 disabled:cursor-wait"
                  title="导出创建期角色卡（PNG，含可回读 JSON payload）"
                >
                  <Download size={13} />
                  <span className="hidden sm:inline">{isDownloading ? "生成中…" : "下载调查员角色卡 (.PNG)"}</span>
                  <span className="sm:hidden">{isDownloading ? "…" : ".PNG"}</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 text-gray-500 hover:text-gray-200 hover:bg-gray-800/60 rounded transition-colors"
                  title="关闭 (ESC)"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
              <div className="mb-4 flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-widest font-mono text-coc-gold/70">
                  调查员背景
                </span>
                <span className="h-px flex-1 bg-[#183022]" />
              </div>
              {sheet.backgroundStory?.trim() ? (
                <div className="text-sm text-gray-300 leading-relaxed font-sans whitespace-pre-wrap">
                  {sheet.backgroundStory}
                </div>
              ) : (
                <div className="text-sm text-gray-600 italic font-sans">
                  尚未记录调查员背景概述。
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
