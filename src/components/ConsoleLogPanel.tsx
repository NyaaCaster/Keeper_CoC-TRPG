/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect } from "react";
import { X, Terminal, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { LogEntry } from "../types";

interface ConsoleLogPanelProps {
  isOpen: boolean;
  onClose: () => void;
  logs: LogEntry[];
  onClearLogs: () => void;
}

export function ConsoleLogPanel({ isOpen, onClose, logs, onClearLogs }: ConsoleLogPanelProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, isOpen]);

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
            className="relative w-full max-w-5xl h-[85vh] bg-[#0A0A0A] border border-[#183022] rounded-xl shadow-2xl flex flex-col font-mono text-gray-300"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#183022] bg-[#0d1410] rounded-t-xl shrink-0">
              <div className="flex items-center gap-3">
                <Terminal size={18} className="text-coc-gold" />
                <h2 className="text-sm font-semibold tracking-wider text-gray-200">控制台日志 · Terminal Output</h2>
                <span className="text-[10px] text-gray-500 ml-1">{logs.length} 条</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClearLogs}
                  className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-800/60 rounded transition-colors"
                  title="清空日志"
                >
                  <Trash2 size={16} />
                </button>
                <div className="w-px h-4 bg-gray-700 mx-1"></div>
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

            {/* Log Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4 text-xs sm:text-sm">
              {logs.length === 0 ? (
                <div className="text-gray-600 flex items-center justify-center h-full select-none">
                  暂无日志 · No logs generated yet.
                </div>
              ) : (
                logs.map((log) => {
                  const date = new Date(log.timestamp);
                  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
                  const timeStr = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;

                  let badge = "bg-gray-800/50 text-gray-300 border border-gray-700";
                  if (log.direction === "request") {
                    badge = "bg-[#10b981]/15 text-coc-gold border border-coc-gold/40";
                  } else if (log.direction === "response") {
                    badge = "bg-gray-800/60 text-gray-200 border border-gray-700";
                  } else if (log.direction === "error") {
                    badge = "bg-red-900/30 text-red-400 border border-red-800/50";
                  } else if (log.direction === "info") {
                    badge = "bg-[#0d1410] text-gray-400 border border-[#183022]";
                  }

                  return (
                    <div
                      key={log.id}
                      className="group border-l-2 border-transparent hover:border-coc-gold/50 pl-3 py-1 transition-colors"
                    >
                      <div className="flex items-center gap-3 mb-1.5 opacity-90 flex-wrap">
                        <span className="text-gray-600 shrink-0">[{timeStr}]</span>
                        <span
                          className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase ${badge}`}
                        >
                          {log.direction}
                        </span>
                        <span className="text-gray-200 font-medium break-all">{log.content}</span>
                        {log.meta?.durationMs !== undefined && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-700 text-gray-400">
                            {log.meta.durationMs}ms
                          </span>
                        )}
                        {log.meta?.status !== undefined && (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border ${
                              Number(log.meta.status) >= 400
                                ? "border-red-800/50 text-red-400 bg-red-900/20"
                                : "border-gray-700 text-gray-400"
                            }`}
                          >
                            HTTP {log.meta.status}
                          </span>
                        )}
                      </div>

                      {log.meta && (
                        <div className="mt-2 pl-4 border-l border-[#183022]">
                          <pre className="text-[11px] text-gray-400 overflow-x-auto custom-scrollbar whitespace-pre-wrap break-words bg-[#0d1410] p-3 rounded-md border border-[#183022] leading-relaxed">
                            {JSON.stringify(log.meta, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={endRef} />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
