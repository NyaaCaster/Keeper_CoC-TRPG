/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from "react";
import { X, FileText } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { CharacterSheet } from "../types";

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
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-gray-500 hover:text-gray-200 hover:bg-gray-800/60 rounded transition-colors"
                title="关闭 (ESC)"
              >
                <X size={16} />
              </button>
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
