import React from "react";
import { HardDrive } from "lucide-react";
import { formatBytes } from "../lib/storageEstimate";

// ---------------------------------------------------------------------------
// StorageBar —— 调查记录储存计量条
// 用于「调查记录档案」面板，显示当前 IDB 用量 vs 64MB 上限。
// ---------------------------------------------------------------------------

export interface StorageBarProps {
  /** 当前用量（bytes） */
  usage: number;
  /** 配额上限（bytes） */
  quota: number;
}

export function StorageBar({ usage, quota }: StorageBarProps) {
  const pct = quota > 0 ? Math.min(100, (usage / quota) * 100) : 0;
  const warn = pct >= 80;

  return (
    <div className="w-full px-1 mb-3">
      {/* 第一行：图标 + 标签 + 字节计数 */}
      <div className="flex items-center justify-between text-[11px] text-gray-400 mb-1 font-sans">
        <span className="flex items-center gap-1">
          <HardDrive size={12} />
          调查记录储存
        </span>
        <span>
          {formatBytes(usage)}
          {quota > 0 ? ` / ${formatBytes(quota)}` : " / 未知"}
        </span>
      </div>

      {/* 进度条 */}
      <div className="h-1.5 rounded-full bg-black/50 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            warn ? "bg-amber-500" : "bg-coc-gold"
          }`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>

      {/* 警告文字（≥80% 时显示） */}
      {warn && (
        <p className="mt-1 text-[11px] text-amber-500 font-sans">
          存储空间紧张，请清理旧存档或导出备份
        </p>
      )}
    </div>
  );
}
