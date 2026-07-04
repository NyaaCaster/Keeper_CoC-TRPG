import React, { useState, useEffect } from "react";
import {
  RotateCcw,
  Upload,
  Trash2,
  X,
  PlusCircle,
  Plug,
  CloudUpload,
  CloudDownload,
} from "lucide-react";
import { WebGameSave } from "../types";
import {
  getAllSaves,
  deleteSave,
  saveGame,
  validateSaveFormat,
} from "../lib/saveManager";
import {
  estimateSaveStorage,
  CHAT_STORAGE_QUOTA,
  formatBytes,
} from "../lib/storageEstimate";
import { StorageBar } from "./StorageBar";
import keeperImg from "../keeper.png";
import type { AccountState } from "../lib/idbAccount";
import {
  uploadChatSessions,
  downloadChatSessions,
} from "../lib/accountApi";
import { encryptSaves, decryptSaves } from "../lib/chatCrypto";
import ConfirmModal from "./ConfirmModal";
import LoginForm from "./LoginForm";

interface StartScreenProps {
  onNewGame: () => void;
  onLoadGame: (save: WebGameSave) => void;
  onOpenApiSettings: () => void;
  apiConfigured: boolean;
  accountState: AccountState | null;
  onLoginSuccess: (state: AccountState) => void;
}

export default function StartScreen({
  onNewGame,
  onLoadGame,
  onOpenApiSettings,
  apiConfigured,
  accountState,
  onLoginSuccess,
}: StartScreenProps) {
  const [view, setView] = useState<"main" | "load">("main");
  const [saves, setSaves] = useState<WebGameSave[]>([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [storageUsage, setStorageUsage] = useState(0);

  // Cloud sync state (P7)
  const [cloudBusy, setCloudBusy] = useState(false);
  const [pendingCloudOp, setPendingCloudOp] = useState<"upload" | "download" | null>(null);
  const [cloudMeta, setCloudMeta] = useState<{ updated_at: number; count?: number } | null>(null);

  const isLoggedIn = accountState !== null;

  const refreshSaves = () => setSaves(getAllSaves());

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const formatCloudTime = (ts: number) => {
    const d = new Date(ts);
    const YY = String(d.getFullYear()).slice(2);
    const MM = String(d.getMonth() + 1).padStart(2, "0");
    const DD = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${YY}-${MM}-${DD} ${hh}:${mm}`;
  };

  // --- Cloud upload ---
  const handleCloudUpload = async () => {
    if (!accountState?.token) {
      showToast("请先登录调查员账户");
      return;
    }
    setCloudBusy(true);
    try {
      const existing = await downloadChatSessions(accountState.token);
      if (existing.ok && existing.data.exists && existing.data.updated_at) {
        setCloudMeta({ updated_at: existing.data.updated_at });
      } else {
        setCloudMeta(null);
      }
      setPendingCloudOp("upload");
    } catch {
      showToast("网络错误，请重试");
    } finally {
      setCloudBusy(false);
    }
  };

  const handleConfirmCloudUpload = async () => {
    if (!accountState?.token) return;
    setCloudBusy(true);
    try {
      const allSaves = getAllSaves();
      const encrypted = await encryptSaves(allSaves, accountState.token);
      const r = await uploadChatSessions(accountState.token, encrypted);
      if (r.ok) {
        showToast("调查记录已上传到云端");
        refreshSaves();
      } else {
        showToast(r.error === "network_error" ? "网络错误，请重试" : "上传失败");
      }
    } catch (e: any) {
      showToast(e?.message || "加密失败，请重试");
    } finally {
      setCloudBusy(false);
      setPendingCloudOp(null);
    }
  };

  // --- Cloud download ---
  const handleCloudDownload = async () => {
    if (!accountState?.token) {
      showToast("请先登录调查员账户");
      return;
    }
    setCloudBusy(true);
    try {
      const r = await downloadChatSessions(accountState.token);
      if (!r.ok) {
        showToast("网络错误，请重试");
        return;
      }
      if (!r.data.exists) {
        showToast("云端暂无存档");
        return;
      }
      setCloudMeta({ updated_at: r.data.updated_at ?? 0 });
      setPendingCloudOp("download");
    } catch {
      showToast("网络错误，请重试");
    } finally {
      setCloudBusy(false);
    }
  };

  const handleConfirmCloudDownload = async () => {
    if (!accountState?.token) return;
    setCloudBusy(true);
    try {
      const r = await downloadChatSessions(accountState.token);
      if (!r.ok || !r.data.exists) {
        showToast("下载失败");
        return;
      }
      const decrypted = await decryptSaves(
        { alg: "Nyaa-HMAC-XOR-V1", salt: r.data.salt!, iv: r.data.iv!, data: r.data.data!, tag: r.data.tag! },
        accountState.token,
      );
      // Replace local saves
      const current = getAllSaves();
      for (const s of current) deleteSave(s.id);
      for (const s of decrypted) saveGame(s);
      refreshSaves();
      showToast("云端记录已下载并替换本地存档");
    } catch (e: any) {
      showToast(e?.message || "解密失败，云端数据可能已损坏");
    } finally {
      setCloudBusy(false);
      setPendingCloudOp(null);
    }
  };

  useEffect(() => {
    if (view === "load") {
      setSaves(getAllSaves());
      estimateSaveStorage().then(setStorageUsage).catch(() => {});
    }
  }, [view]);

  const handleDeleteClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirmId(id);
  };

  const confirmDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteSave(id);
    setSaves(getAllSaves());
    setDeleteConfirmId(null);
    estimateSaveStorage().then(setStorageUsage).catch(() => {});
  };

  const cancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirmId(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Guard 1：单文件超过配额直接拒绝
    if (file.size > CHAT_STORAGE_QUOTA) {
      showToast(
        `文件过大（${formatBytes(file.size)}，上限 ${formatBytes(CHAT_STORAGE_QUOTA)}），无法导入。`
      );
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const data = JSON.parse(text);
        if (validateSaveFormat(data)) {
          // Guard 2：预估导入后是否超过 95% 配额
          const doImport = (used: number) => {
            if (used + file.size * 2 > CHAT_STORAGE_QUOTA * 0.95) {
              showToast(
                `存储空间不足（已用 ${formatBytes(used)} / ${formatBytes(CHAT_STORAGE_QUOTA)}），无法导入。请清理旧存档后重试。`
              );
              return;
            }
            // 容量足够，执行保存
            data.lastUpdated = Date.now();
            saveGame(data);
            setSaves(getAllSaves());
            estimateSaveStorage().then(setStorageUsage).catch(() => {});
            showToast("记录上传成功。");
          };

          estimateSaveStorage().then(doImport).catch(() => {
            // 估算失败不阻塞导入（降级放行）
            data.lastUpdated = Date.now();
            saveGame(data);
            setSaves(getAllSaves());
            estimateSaveStorage().then(setStorageUsage).catch(() => {});
            showToast("记录上传成功。");
          });
        } else {
          showToast("神秘的残页无法被解析，这并非有效的守密人记录。");
        }
      } catch (err) {
        showToast("文件损毁严重，无法识别其中的文字。");
      }
    };
    reader.readAsText(file);
    // Reset value so we can upload same file again if needed
    e.target.value = "";
  };

  return (
    <>
      <div className="w-full h-full flex flex-col items-center justify-center p-4 z-20 relative">
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage:
            "radial-gradient(circle at center, #10b981 0%, transparent 60%)",
        }}
      ></div>

      {view === "main" ? (
        <div className="max-w-xl w-full flex flex-col items-center animate-fade-in z-10">
          <div className="mb-6 relative w-48 h-48 sm:w-64 sm:h-64 rounded-full overflow-hidden border-2 border-emerald-500/40 shadow-[0_0_40px_rgba(16,185,129,0.15)] flex items-center justify-center bg-black/50">
            {/* User requested atmosphere image src/keeper.png */}
            <img
              src={keeperImg}
              alt="Keeper Atmosphere"
              className="w-full h-full object-cover opacity-80 mix-blend-screen"
              onError={(e) => {
                (e.target as HTMLImageElement).src =
                  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="%2310b981" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>';
              }}
            />
          </div>

          <h1 className="text-5xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white via-emerald-500 to-emerald-900 tracking-widest mb-4 font-mono">
            守密人
          </h1>
          <p className="text-gray-400 text-center text-sm md:text-base leading-relaxed mb-10 max-w-md font-sans">
            游走于理智与混沌的边缘
            <br />
            只有最坚韧的灵魂，才能窥见帷幕后的真实。
          </p>

          {/* 登录表单 —— 未登录时显示 */}
          {!isLoggedIn && (
            <div className="w-full sm:w-3/4 mb-4">
              <div className="bg-black/60 border border-emerald-500/30 rounded-lg p-5">
                <LoginForm onLoginSuccess={onLoginSuccess} />
              </div>
            </div>
          )}

          {/* 游戏按钮 —— 仅登录后显示 */}
          {isLoggedIn && (
          <div className="flex flex-col gap-4 w-full sm:w-3/4">
            <button
              onClick={onNewGame}
              disabled={!isLoggedIn || !apiConfigured}
              title={
                !isLoggedIn
                  ? "请先登录"
                  : !apiConfigured
                    ? "先完成虚空连接"
                    : undefined
              }
              className={`group relative overflow-hidden w-full py-4 transition-all flex items-center justify-center gap-3 active:scale-95 ${
                isLoggedIn && apiConfigured
                  ? "bg-gradient-to-r from-emerald-500/10 via-emerald-500/20 to-emerald-500/10 border border-emerald-500/50 hover:border-emerald-400 text-emerald-100 shadow-[0_0_15px_rgba(16,185,129,0.1)] hover:shadow-[0_0_25px_rgba(16,185,129,0.3)]"
                  : "bg-gray-900/40 border border-gray-700 text-gray-600 cursor-not-allowed"
              }`}
            >
              <PlusCircle className={`w-5 h-5 ${isLoggedIn && apiConfigured ? "group-hover:animate-pulse" : ""}`} />
              <span className="font-bold tracking-widest">踏入全新的漩涡</span>
            </button>
            <button
              onClick={() => setView("load")}
              disabled={!isLoggedIn || !apiConfigured}
              title={
                !isLoggedIn
                  ? "请先登录"
                  : !apiConfigured
                    ? "先完成虚空连接"
                    : undefined
              }
              className={`group w-full py-4 transition-all flex items-center justify-center gap-3 active:scale-95 ${
                isLoggedIn && apiConfigured
                  ? "bg-black/60 border border-gray-800 hover:border-gray-500 text-gray-300 hover:text-gray-100"
                  : "bg-gray-900/40 border border-gray-700 text-gray-600 cursor-not-allowed"
              }`}
            >
              <RotateCcw className={`w-5 h-5 ${isLoggedIn && apiConfigured ? "group-hover:-rotate-90 transition-transform duration-500" : ""}`} />
              <span className="tracking-widest">继续未完的调查</span>
            </button>
            <button
              onClick={onOpenApiSettings}
              disabled={!isLoggedIn}
              title={!isLoggedIn ? "请先登录" : undefined}
              className={`group w-full py-4 transition-all flex items-center justify-center gap-3 active:scale-95 bg-gradient-to-r from-emerald-500/5 via-emerald-500/15 to-emerald-500/5 border text-emerald-100 hover:shadow-[0_0_25px_rgba(16,185,129,0.3)] ${
                isLoggedIn
                  ? apiConfigured
                    ? "border-emerald-500/40 hover:border-emerald-400"
                    : "border-emerald-400 animate-pulse"
                  : "border-gray-700 text-gray-600 cursor-not-allowed"
              }`}
            >
              <Plug className={`w-5 h-5 ${isLoggedIn ? "group-hover:rotate-12 transition-transform" : ""}`} />
              <span className="tracking-widest">虚空连接的设置</span>
            </button>
          </div>
          )}
        </div>
      ) : (
        <div className="max-w-2xl w-full h-[80vh] flex flex-col items-center animate-fade-in z-10 bg-black/80 border border-emerald-500/30 rounded-lg p-6 shadow-2xl overflow-hidden">
          <div className="w-full flex items-center justify-between mb-6 border-b border-emerald-500/20 pb-4">
            <h2 className="text-2xl font-bold text-emerald-500 tracking-widest font-mono">
              调查记录档案
            </h2>
            <button
              onClick={() => setView("main")}
              className="p-2 text-gray-500 hover:text-gray-300 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <StorageBar usage={storageUsage} quota={CHAT_STORAGE_QUOTA} />

          <div className="flex-1 w-full overflow-y-auto custom-scrollbar flex flex-col gap-3 pr-2">
            {saves.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 font-sans text-sm">
                <RotateCcw className="w-12 h-12 mb-4 opacity-50" />
                <p>未发现任何留存的调查笔记</p>
                <p className="mt-2 text-xs">
                  前人的足迹已被深渊吞噬，或是你尚未启程。
                </p>
              </div>
            ) : (
              saves.map((save) => (
                <div
                  key={save.id}
                  onClick={() => onLoadGame(save)}
                  className="w-full bg-[#131516] hover:bg-[#1a1c1d] border border-gray-800 hover:border-emerald-500/50 rounded-lg p-4 cursor-pointer transition-all flex items-center justify-between group"
                >
                  <div className="flex flex-col">
                    <span className="text-emerald-500 font-bold tracking-wider mb-1 font-mono text-sm sm:text-base">
                      {save.moduleName}
                    </span>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 font-sans">
                      <span>
                        保存时间:{" "}
                        {save.timestamp.replace(
                          /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/,
                          "$1-$2-$3 $4:$5",
                        )}
                      </span>
                      <span>调查员: {save.character?.name || "未知"}</span>
                      <span>场景: {save.currentLocation || "未知"}</span>
                    </div>
                  </div>
                  {deleteConfirmId === save.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-500 font-bold mx-2">
                        销毁?
                      </span>
                      <button
                        onClick={(e) => confirmDelete(save.id, e)}
                        className="px-2 py-1 bg-red-900/50 hover:bg-red-600 border border-red-800 text-white text-xs rounded transition-colors"
                      >
                        确认
                      </button>
                      <button
                        onClick={cancelDelete}
                        className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => handleDeleteClick(save.id, e)}
                      className="p-2 text-red-900 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                      title="销毁记录"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {toastMessage && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/90 border border-emerald-500 text-emerald-300 px-6 py-3 rounded-lg shadow-2xl shadow-emerald-500/20 text-sm z-50 animate-fade-in font-sans flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              {toastMessage}
            </div>
          )}

          <div className="w-full pt-4 mt-2 border-t border-emerald-500/20 space-y-3">
            {/* Cloud sync buttons (P7) */}
            <div className="flex justify-center gap-3">
              <button
                onClick={handleCloudUpload}
                disabled={cloudBusy}
                className="flex items-center gap-2 px-4 py-2 bg-black/40 border border-gray-800 hover:border-[#10b981]/40 text-gray-400 hover:text-gray-200 rounded transition-all text-sm font-sans disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CloudUpload className="w-4 h-4" /> 上传记录
              </button>
              <button
                onClick={handleCloudDownload}
                disabled={cloudBusy}
                className="flex items-center gap-2 px-4 py-2 bg-black/40 border border-gray-800 hover:border-[#10b981]/40 text-gray-400 hover:text-gray-200 rounded transition-all text-sm font-sans disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CloudDownload className="w-4 h-4" /> 下载记录
              </button>
            </div>

            <div className="flex justify-center relative">
              <input
                type="file"
                accept=".json"
                id="upload-save"
                className="hidden"
                onChange={handleFileUpload}
                key={Date.now()}
              />
              <label
                htmlFor="upload-save"
                className="flex items-center gap-2 px-6 py-3 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-100 rounded cursor-pointer transition-colors text-sm font-sans"
              >
                <Upload className="w-4 h-4" /> 上传记录文件
              </label>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* Cloud sync confirm modals */}
    <ConfirmModal
      isOpen={pendingCloudOp === "upload"}
      title="上传记录"
      message={
        cloudMeta
          ? `云端已有存档（最后更新 ${formatCloudTime(cloudMeta.updated_at)}）。上传将覆盖云端存档，是否继续？`
          : "将创建首个云端存档，上传当前所有调查记录？"
      }
      confirmLabel={cloudMeta ? "覆盖云端存档" : "创建云端存档"}
      variant="default"
      onConfirm={handleConfirmCloudUpload}
      onCancel={() => { setPendingCloudOp(null); setCloudMeta(null); }}
    />
    <ConfirmModal
      isOpen={pendingCloudOp === "download"}
      title="下载记录"
      message={
        cloudMeta
          ? `云端存档最后更新于 ${formatCloudTime(cloudMeta.updated_at)}。下载将覆盖当前所有本地记录，是否继续？`
          : "下载将覆盖当前所有本地记录，是否继续？"
      }
      confirmLabel="替换本地记录"
      variant="danger"
      onConfirm={handleConfirmCloudDownload}
      onCancel={() => { setPendingCloudOp(null); setCloudMeta(null); }}
    />
  </>
);
}
