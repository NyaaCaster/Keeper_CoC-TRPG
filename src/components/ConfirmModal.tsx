/**
 * 复用确认弹窗组件 —— 提取自 App.tsx 退出确认模式，支持 danger / default 两种变体。
 *
 * 使用 framer-motion AnimatePresence + scale 动画，保持与原有退出确认一致的交互体验。
 */

import React from "react";
import { motion, AnimatePresence } from "motion/react";

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = 红色标题+确认按钮；default = 绿色标题+确认按钮 */
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const isDanger = variant === "danger";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans"
        >
          <motion.div
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.95 }}
            className="bg-[#0c1410] border border-gray-800 rounded-lg p-6 max-w-sm w-full shadow-2xl relative"
          >
            <h3
              className={`text-xl font-bold mb-2 font-mono ${
                isDanger ? "text-red-500" : "text-coc-gold"
              }`}
            >
              {title}
            </h3>
            <p className="text-gray-300 text-sm mb-6">{message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={onCancel}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition-colors"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className={`px-4 py-2 font-bold text-sm rounded transition-colors ${
                  isDanger
                    ? "bg-red-900/80 hover:bg-red-700 border border-red-800 text-white"
                    : "bg-emerald-600/80 hover:bg-emerald-500 border border-emerald-600 text-white"
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
