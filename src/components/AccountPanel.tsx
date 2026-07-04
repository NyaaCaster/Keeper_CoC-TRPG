/**
 * 调查员账户二级界面 —— 全屏遮罩 + 居中面板。
 *
 * 内容：
 *  - 账号（只读）、用户名（可点击编辑）、注册时间
 *  - 账号管理跳转链接（NyaaAcount）
 *  - 退出登录按钮（二次确认）
 *
 * 配色遵循 Keeper 三色铁律（黑绿白），滚动容器挂 custom-scrollbar。
 */

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { IdCard, X, Check, Pencil, ExternalLink } from "lucide-react";
import type { AccountState } from "../lib/idbAccount";
import { saveAccountState } from "../lib/idbAccount";
import { rename as renameApi } from "../lib/accountApi";
import ConfirmModal from "./ConfirmModal";

interface AccountPanelProps {
  isOpen: boolean;
  onClose: () => void;
  accountState: AccountState | null;
  onLogout: () => void;
  onProfileUpdate: (state: AccountState) => void;
}

/** 将 unix ms 格式化为本地日期字符串，如 "2026-07-05 14:30" */
function formatCreatedAt(ms: number): string {
  try {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "未知";
  }
}

export default function AccountPanel({
  isOpen,
  onClose,
  accountState,
  onLogout,
  onProfileUpdate,
}: AccountPanelProps) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  if (!accountState) return null;

  const { token, profile } = accountState;

  const startEditName = () => {
    setEditingName(true);
    setNameDraft(profile.username);
    setRenameError(null);
  };

  const cancelEditName = () => {
    setEditingName(false);
    setNameDraft("");
    setRenameError(null);
  };

  const confirmRename = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed.length > 20) {
      setRenameError("用户名需为 1-20 个字符");
      return;
    }
    if (trimmed === profile.username) {
      cancelEditName();
      return;
    }

    setRenameLoading(true);
    setRenameError(null);
    const result = await renameApi(token, trimmed);
    setRenameLoading(false);

    if (result.ok) {
      const next: AccountState = {
        token,
        profile: { ...profile, username: result.data.username },
      };
      await saveAccountState(next);
      onProfileUpdate(next);
      setEditingName(false);
      setNameDraft("");
    } else {
      setRenameError(
        result.error === "invalid_username"
          ? "用户名需为 1-20 个字符"
          : result.error === "network_error"
            ? "网络连接失败"
            : "修改失败，请重试",
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") confirmRename();
    if (e.key === "Escape") cancelEditName();
  };

  return (
    <>
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
              className="bg-[#0c1410] border border-emerald-500/30 rounded-lg p-6 max-w-sm w-full shadow-2xl relative"
            >
              {/* 标题栏 */}
              <div className="flex items-center justify-between mb-6 border-b border-emerald-500/20 pb-3">
                <h2 className="text-xl font-bold text-coc-gold tracking-widest font-mono flex items-center gap-2">
                  <IdCard className="w-5 h-5" />
                  调查员账户
                </h2>
                <button
                  onClick={onClose}
                  className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded hover:bg-gray-800/50"
                  title="关闭"
                  aria-label="关闭账户面板"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 账户信息区 */}
              <div className="space-y-4 mb-6">
                {/* 账号（只读） */}
                <div>
                  <span className="text-xs text-gray-500 tracking-wide">
                    账号
                  </span>
                  <p className="text-gray-300 text-sm font-mono mt-0.5 select-all">
                    {profile.account}
                  </p>
                </div>

                {/* 用户名（可编辑） */}
                <div>
                  <span className="text-xs text-gray-500 tracking-wide">
                    用户名
                  </span>
                  {editingName ? (
                    <div className="mt-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={nameDraft}
                          onChange={(e) => {
                            setNameDraft(e.target.value);
                            setRenameError(null);
                          }}
                          onKeyDown={handleKeyDown}
                          maxLength={20}
                          autoFocus
                          className="flex-1 bg-[#121f18] border border-emerald-500/30 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-emerald-500 placeholder-gray-600"
                          placeholder="输入新用户名"
                        />
                        <button
                          onClick={confirmRename}
                          disabled={renameLoading}
                          className="p-1 rounded text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                          title="确认"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={cancelEditName}
                          disabled={renameLoading}
                          className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800/50 transition-colors"
                          title="取消"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {renameError && (
                        <p className="text-red-400 text-xs">{renameError}</p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-gray-200 text-sm font-bold">
                        {profile.username}
                      </p>
                      <button
                        onClick={startEditName}
                        className="p-0.5 rounded text-gray-600 hover:text-gray-300 hover:bg-gray-800/50 transition-colors"
                        title="修改用户名"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* 注册时间（只读） */}
                <div>
                  <span className="text-xs text-gray-500 tracking-wide">
                    注册时间
                  </span>
                  <p className="text-gray-400 text-sm mt-0.5">
                    {formatCreatedAt(profile.created_at)}
                  </p>
                </div>
              </div>

              {/* 操作按钮区 */}
              <div className="space-y-3 pt-4 border-t border-emerald-500/20">
                <a
                  href="http://h.nyaa.host:5110/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-100 rounded text-sm transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  账号管理
                </a>

                <button
                  onClick={() => setShowLogoutConfirm(true)}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-red-900/20 hover:bg-red-900/40 border border-red-800/40 text-red-400 hover:text-red-300 rounded text-sm transition-colors"
                >
                  退出登录
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 退出登录二次确认 */}
      <ConfirmModal
        isOpen={showLogoutConfirm}
        title="退出登录"
        message="确定要退出登录吗？退出登录会中断当前的调查并返回首页，调查进度已自动保留在你的记录中。"
        confirmLabel="确认退出"
        cancelLabel="取消"
        variant="danger"
        onConfirm={() => {
          setShowLogoutConfirm(false);
          onLogout();
        }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </>
  );
}
