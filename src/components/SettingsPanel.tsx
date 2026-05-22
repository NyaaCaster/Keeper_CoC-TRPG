/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import {
  X,
  Settings,
  Plug,
  Download,
  LogOut,
  Terminal,
  Link2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenApiSettings: () => void;
  onDownloadSave: () => void;
  onExitInvestigation: () => void;
  onOpenConsoleLog: () => void;
  canDownload: boolean;
  canExit: boolean;
}

type McpStatus =
  | { state: "checking" }
  | { state: "ok" }
  | { state: "down"; reason?: string };

export default function SettingsPanel({
  isOpen,
  onClose,
  onOpenApiSettings,
  onDownloadSave,
  onExitInvestigation,
  onOpenConsoleLog,
  canDownload,
  canExit,
}: SettingsPanelProps) {
  const [mcp, setMcp] = useState<McpStatus>({ state: "checking" });

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setMcp({ state: "checking" });
    const ac = new AbortController();
    fetch("/api/mcp/status", { signal: ac.signal })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok) setMcp({ state: "ok" });
        else setMcp({ state: "down", reason: data?.reason });
      })
      .catch((e) => {
        if (cancelled) return;
        setMcp({ state: "down", reason: e?.message || "network error" });
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const dotClass =
    mcp.state === "ok"
      ? "bg-[#10b981] shadow-[0_0_8px_rgba(16,185,129,0.7)] animate-pulse"
      : mcp.state === "checking"
        ? "bg-gray-500 animate-pulse"
        : "bg-gray-600";
  const statusText =
    mcp.state === "ok"
      ? "正常连接"
      : mcp.state === "checking"
        ? "正在探测…"
        : `无法连接${mcp.reason ? ` · ${mcp.reason}` : ""}`;
  const statusTextColor =
    mcp.state === "ok"
      ? "text-[#10b981]"
      : mcp.state === "checking"
        ? "text-gray-400"
        : "text-gray-500";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="relative w-full max-w-xl max-h-[90vh] bg-[#111213]/95 border border-[#c1a067]/35 rounded-lg shadow-2xl shadow-emerald-500/10 flex flex-col overflow-hidden"
            initial={{ scale: 0.95, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 12 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#183022] bg-[#0c1410]">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-[#10b981]" />
                <h2 className="text-sm font-bold text-[#10b981] tracking-widest font-mono">
                  设置 · Settings
                </h2>
              </div>
              <button
                onClick={onClose}
                className="p-1 text-gray-500 hover:text-gray-200 transition-colors"
                aria-label="关闭"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-5">
              {/* Pinned: NyaaChat-MCP status */}
              <div className="flex items-center gap-3 px-4 py-3 rounded border border-[#183022] bg-[#0d1410]">
                <Link2 className="w-4 h-4 text-[#10b981] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-400 tracking-wider font-mono">
                    NyaaChat-MCP
                  </div>
                  <div
                    className={`text-sm font-medium font-sans truncate ${statusTextColor}`}
                  >
                    {statusText}
                  </div>
                </div>
                <span
                  className={`w-3 h-3 rounded-full shrink-0 ${dotClass}`}
                  aria-label={statusText}
                />
              </div>

              {/* Actions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ActionButton
                  icon={<Plug className="w-7 h-7" />}
                  label="API 设置"
                  hint="虚空连接的设置"
                  onClick={() => {
                    onClose();
                    onOpenApiSettings();
                  }}
                />
                <ActionButton
                  icon={<Download className="w-7 h-7" />}
                  label="下载调查日志"
                  hint="导出当前进度 JSON"
                  onClick={() => {
                    onClose();
                    onDownloadSave();
                  }}
                  disabled={!canDownload}
                />
                <ActionButton
                  icon={<LogOut className="w-7 h-7" />}
                  label="退出调查"
                  hint="返回主界面"
                  onClick={() => {
                    onClose();
                    onExitInvestigation();
                  }}
                  disabled={!canExit}
                  danger
                />
                <ActionButton
                  icon={<Terminal className="w-7 h-7" />}
                  label="控制台日志"
                  hint="查看最近的请求与响应"
                  onClick={() => {
                    onClose();
                    onOpenConsoleLog();
                  }}
                />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

function ActionButton({
  icon,
  label,
  hint,
  onClick,
  disabled,
  danger,
}: ActionButtonProps) {
  const base =
    "group flex items-center gap-3 px-4 py-4 rounded border transition-all text-left font-sans";
  const enabled = danger
    ? "bg-black/40 border-[#183022] text-gray-300 hover:border-red-700/60 hover:text-red-300 hover:bg-red-950/20"
    : "bg-black/40 border-[#183022] text-gray-300 hover:border-[#10b981]/60 hover:text-[#10b981] hover:bg-[#10b981]/5";
  const off = "bg-black/20 border-[#122218] text-gray-600 cursor-not-allowed";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${disabled ? off : enabled}`}
    >
      <span
        className={`shrink-0 ${disabled ? "text-gray-700" : danger ? "text-gray-400 group-hover:text-red-400" : "text-[#10b981]"}`}
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold tracking-wide">{label}</span>
        <span className="block text-[11px] text-gray-500 mt-0.5 truncate">
          {hint}
        </span>
      </span>
    </button>
  );
}
