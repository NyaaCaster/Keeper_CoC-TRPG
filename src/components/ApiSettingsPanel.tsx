import React, { useState, useRef, useEffect } from "react";
import {
  X,
  Eye,
  EyeOff,
  Plug,
  Image as ImageIcon,
  Download,
  Upload,
  Save,
  ChevronDown,
  RefreshCw,
  AlertTriangle,
  CloudUpload,
  CloudDownload,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  ApiSettings,
  LlmProviderKind,
  ImageProviderKind,
  QinyHostKind,
  QINY_DEFAULT_LLM_MODEL,
  QINY_DEFAULT_IMAGE_MODEL,
  resolveQinyRegisterUrl,
} from "../types";
import {
  saveApiSettings,
  exportApiSettings,
  validateApiSettingsJson,
  normalizeCustomBaseUrl,
} from "../lib/apiSettings";
import {
  uploadCloudSettings,
  downloadCloudSettings,
  buildSettingsExportPayload,
} from "../lib/accountApi";
import { loadAccountState } from "../lib/idbAccount";
import ConfirmModal from "./ConfirmModal";
import {
  LlmProviderIcon,
  ImageProviderIcon,
  LLM_PROVIDER_LABELS,
  IMAGE_PROVIDER_LABELS,
} from "./icons/providerIcons";

interface ApiSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (settings: ApiSettings) => void;
  initial: ApiSettings;
}

const LLM_PROVIDERS: LlmProviderKind[] = [
  "qiny",
  "custom",
  "gemini",
  "anthropic",
  "grok",
  "deepseek",
];
const IMAGE_PROVIDERS: ImageProviderKind[] = ["qiny"];

export default function ApiSettingsPanel({
  isOpen,
  onClose,
  onSaved,
  initial,
}: ApiSettingsPanelProps) {
  const [settings, setSettings] = useState<ApiSettings>(initial);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Cloud sync state (P6)
  const [cloudBusy, setCloudBusy] = useState(false);
  const [pendingCloudOp, setPendingCloudOp] = useState<"upload" | "download" | null>(null);
  const [cloudMeta, setCloudMeta] = useState<{ updated_at: number } | null>(null);

  useEffect(() => {
    if (isOpen) setSettings(initial);
  }, [isOpen, initial]);

  const showToast = (kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 2800);
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
    const stored = await loadAccountState();
    if (!stored?.token) {
      showToast("err", "请先登录调查员账户");
      return;
    }
    setCloudBusy(true);
    try {
      const existing = await downloadCloudSettings(stored.token);
      if (existing.ok && existing.data.exists && existing.data.updated_at) {
        setCloudMeta({ updated_at: existing.data.updated_at });
      } else {
        setCloudMeta(null);
      }
      setPendingCloudOp("upload");
    } catch {
      showToast("err", "网络错误，请重试");
    } finally {
      setCloudBusy(false);
    }
  };

  const handleConfirmCloudUpload = async () => {
    const stored = await loadAccountState();
    if (!stored?.token) return;
    setCloudBusy(true);
    try {
      const payload = buildSettingsExportPayload(settings);
      const r = await uploadCloudSettings(stored.token, payload);
      if (r.ok) {
        showToast("ok", "设置已上传到云端");
      } else {
        showToast("err", r.error === "network_error" ? "网络错误，请重试" : "上传失败");
      }
    } catch {
      showToast("err", "网络错误，请重试");
    } finally {
      setCloudBusy(false);
      setPendingCloudOp(null);
    }
  };

  // --- Cloud download ---
  const handleCloudDownload = async () => {
    const stored = await loadAccountState();
    if (!stored?.token) {
      showToast("err", "请先登录调查员账户");
      return;
    }
    setCloudBusy(true);
    try {
      const r = await downloadCloudSettings(stored.token);
      if (!r.ok) {
        showToast("err", "网络错误，请重试");
        return;
      }
      if (!r.data.exists) {
        showToast("err", "云端暂无存档");
        return;
      }
      if (!r.data.payload?.settings) {
        showToast("err", "云端存档格式无效");
        return;
      }
      // Basic validation of downloaded settings
      const s = r.data.payload.settings;
      if (!s?.llm?.provider || !s?.image?.provider) {
        showToast("err", "云端存档格式无效");
        return;
      }
      setCloudMeta({ updated_at: r.data.updated_at ?? 0 });
      setPendingCloudOp("download");
    } catch {
      showToast("err", "网络错误，请重试");
    } finally {
      setCloudBusy(false);
    }
  };

  const handleConfirmCloudDownload = async () => {
    const stored = await loadAccountState();
    if (!stored?.token) return;
    setCloudBusy(true);
    try {
      const r = await downloadCloudSettings(stored.token);
      if (r.ok && r.data.payload?.settings) {
        const s = r.data.payload.settings as ApiSettings;
        setSettings(s);
        saveApiSettings(s);
        onSaved(s);
        showToast("ok", "云端设置已下载并保存");
      }
    } catch {
      showToast("err", "网络错误，请重试");
    } finally {
      setCloudBusy(false);
      setPendingCloudOp(null);
    }
  };

  const handleLlmProviderChange = (p: LlmProviderKind) => {
    setSettings((s) => {
      const next = { ...s, llm: { ...s.llm, provider: p } };
      if (p === "qiny" && !s.llm.model) {
        next.llm.model = QINY_DEFAULT_LLM_MODEL;
      }
      return next;
    });
  };

  const handleImageProviderChange = (p: ImageProviderKind) => {
    setSettings((s) => {
      const next = { ...s, image: { ...s.image, provider: p } };
      if (p === "qiny" && !s.image.model) {
        next.image.model = QINY_DEFAULT_IMAGE_MODEL;
      }
      return next;
    });
  };

  const handleExport = () => {
    exportApiSettings(settings);
    showToast("ok", "设置已导出。");
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const data = JSON.parse(text);
        if (validateApiSettingsJson(data)) {
          setSettings(data);
          showToast("ok", "配置已导入，未保存前可继续修改。");
        } else {
          showToast("err", "这并非有效的虚空连接配置。");
        }
      } catch {
        showToast("err", "文件无法解析为 JSON。");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSave = () => {
    const final: ApiSettings =
      settings.llm.provider === "custom"
        ? {
            ...settings,
            llm: {
              ...settings.llm,
              customBaseUrl: normalizeCustomBaseUrl(settings.llm.customBaseUrl ?? ""),
            },
          }
        : settings;
    saveApiSettings(final);
    onSaved(final);
    onClose();
  };

  return (
    <>
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
            className="relative w-full max-w-2xl max-h-[90vh] bg-[#111213]/95 border border-[#c1a067]/35 rounded-lg shadow-2xl shadow-emerald-500/10 flex flex-col overflow-hidden"
            initial={{ scale: 0.95, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 12 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#183022] bg-[#0c1410]">
              <div className="flex items-center gap-2">
                <Plug className="w-4 h-4 text-[#10b981]" />
                <h2 className="text-sm font-bold text-[#10b981] tracking-widest font-mono">
                  虚空连接的设置
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
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
              <SectionHeader icon={<Plug className="w-3.5 h-3.5" />} title="对话模型" />

              <ProviderDropdown<LlmProviderKind>
                label="对话模型供应商"
                value={settings.llm.provider}
                options={LLM_PROVIDERS}
                renderIcon={(k) => <LlmProviderIcon kind={k} size={18} />}
                renderLabel={(k) => LLM_PROVIDER_LABELS[k]}
                onChange={handleLlmProviderChange}
              />

              {settings.llm.provider === "qiny" && (
                <QinyHostRadio
                  value={settings.llm.qinyHost ?? "com"}
                  onChange={(host) =>
                    setSettings((s) => ({ ...s, llm: { ...s.llm, qinyHost: host } }))
                  }
                />
              )}

              {settings.llm.provider === "custom" && (
                <Field label="Base URL" hint="OpenAI 兼容路径，会自动归一为 .../v1 形式">
                  <input
                    type="text"
                    value={settings.llm.customBaseUrl ?? ""}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        llm: { ...s.llm, customBaseUrl: e.target.value },
                      }))
                    }
                    onBlur={(e) =>
                      setSettings((s) => ({
                        ...s,
                        llm: {
                          ...s.llm,
                          customBaseUrl: normalizeCustomBaseUrl(e.target.value),
                        },
                      }))
                    }
                    placeholder="https://your-endpoint.com"
                    className="w-full bg-black/40 border border-[#183022] focus:border-[#10b981] outline-none rounded px-3 py-2 text-xs text-gray-200 font-mono"
                  />
                </Field>
              )}

              <ApiKeyField
                label="对话 API Key"
                value={settings.llm.apiKey}
                onChange={(v) =>
                  setSettings((s) => ({ ...s, llm: { ...s.llm, apiKey: v } }))
                }
                helpUrl={
                  settings.llm.provider === "qiny"
                    ? resolveQinyRegisterUrl(settings.llm.qinyHost)
                    : undefined
                }
              />

              <ModelField
                label="对话模型"
                value={settings.llm.model}
                onChange={(v) =>
                  setSettings((s) => ({ ...s, llm: { ...s.llm, model: v } }))
                }
                provider={settings.llm.provider}
                apiKey={settings.llm.apiKey}
                customBaseUrl={settings.llm.customBaseUrl}
                qinyHost={settings.llm.qinyHost}
              />

              <div className="border-t border-[#183022] pt-5">
                <SectionHeader
                  icon={<ImageIcon className="w-3.5 h-3.5" />}
                  title="画图模型"
                />
              </div>

              <ProviderDropdown<ImageProviderKind>
                label="画图模型供应商"
                value={settings.image.provider}
                options={IMAGE_PROVIDERS}
                renderIcon={(k) => <ImageProviderIcon kind={k} size={18} />}
                renderLabel={(k) => IMAGE_PROVIDER_LABELS[k]}
                onChange={handleImageProviderChange}
              />

              {settings.image.provider === "qiny" && (
                <QinyHostRadio
                  value={settings.image.qinyHost ?? "com"}
                  onChange={(host) =>
                    setSettings((s) => ({ ...s, image: { ...s.image, qinyHost: host } }))
                  }
                />
              )}

              <ApiKeyField
                label="画图 API Key"
                value={settings.image.apiKey}
                onChange={(v) =>
                  setSettings((s) => ({ ...s, image: { ...s.image, apiKey: v } }))
                }
                helpUrl={
                  settings.image.provider === "qiny"
                    ? resolveQinyRegisterUrl(settings.image.qinyHost)
                    : undefined
                }
              />

              <ModelField
                label="画图模型"
                value={settings.image.model}
                onChange={(v) =>
                  setSettings((s) => ({ ...s, image: { ...s.image, model: v } }))
                }
                provider="qiny-image"
                apiKey={settings.image.apiKey}
                qinyHost={settings.image.qinyHost}
              />
            </div>

            {/* Footer: cloud sync (P6) — above local import/export */}
            <div className="px-5 pt-3 pb-1 bg-[#0c1410]">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleCloudUpload}
                  disabled={cloudBusy}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-black/40 border border-gray-800 hover:border-[#10b981]/40 hover:text-gray-200 text-gray-400 rounded transition-all font-sans disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <CloudUpload className="w-3.5 h-3.5" />
                  上传设置
                </button>
                <button
                  onClick={handleCloudDownload}
                  disabled={cloudBusy}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-black/40 border border-gray-800 hover:border-[#10b981]/40 hover:text-gray-200 text-gray-400 rounded transition-all font-sans disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <CloudDownload className="w-3.5 h-3.5" />
                  下载设置
                </button>
              </div>
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-[#183022] bg-[#0c1410]">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleFileChosen}
              />
              <button
                onClick={handleImportClick}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-black/40 border border-gray-800 hover:border-[#10b981]/40 hover:text-gray-200 text-gray-400 rounded transition-all font-sans"
              >
                <Upload className="w-3.5 h-3.5" />
                导入设置
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-black/40 border border-gray-800 hover:border-[#10b981]/40 hover:text-gray-200 text-gray-400 rounded transition-all font-sans"
              >
                <Download className="w-3.5 h-3.5" />
                导出设置
              </button>
              <div className="flex-1" />
              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-[#c1a067]/20 hover:bg-[#c1a067]/30 border border-[#c1a067] text-[#10b981] rounded transition-all font-bold tracking-widest font-sans"
              >
                <Save className="w-3.5 h-3.5" />
                保存设置
              </button>
            </div>

            {/* Toast */}
            <AnimatePresence>
              {toast && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className={`absolute top-3 left-1/2 -translate-x-1/2 px-4 py-2 rounded text-xs font-sans flex items-center gap-2 shadow-2xl z-50 ${
                    toast.kind === "ok"
                      ? "bg-black/90 border border-[#10b981]/60 text-[#10b981]"
                      : "bg-black/90 border border-red-500/60 text-red-400"
                  }`}
                >
                  {toast.kind === "ok" ? (
                    <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  )}
                  {toast.text}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

      {/* Cloud sync confirm modals */}
      <ConfirmModal
        isOpen={pendingCloudOp === "upload"}
        title="上传设置"
        message={
          cloudMeta
            ? `云端已有存档（最后更新 ${formatCloudTime(cloudMeta.updated_at)}）。上传将覆盖云端存档，是否继续？`
            : "将创建首个云端存档，上传当前设置？"
        }
        confirmLabel={cloudMeta ? "覆盖云端存档" : "创建云端存档"}
        variant="default"
        onConfirm={handleConfirmCloudUpload}
        onCancel={() => { setPendingCloudOp(null); setCloudMeta(null); }}
      />
      <ConfirmModal
        isOpen={pendingCloudOp === "download"}
        title="下载设置"
        message={
          cloudMeta
            ? `云端存档最后更新于 ${formatCloudTime(cloudMeta.updated_at)}。下载将覆盖当前所有本地设置，是否继续？`
            : "下载将覆盖当前所有本地设置，是否继续？"
        }
        confirmLabel="替换本地设置"
        variant="danger"
        onConfirm={handleConfirmCloudDownload}
        onCancel={() => { setPendingCloudOp(null); setCloudMeta(null); }}
      />
    </>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-[#10b981]">
      {icon}
      <span className="text-xs font-bold tracking-widest font-mono">{title}</span>
    </div>
  );
}

const QINY_HOST_OPTIONS: Array<{ value: QinyHostKind; label: string; url: string }> = [
  { value: "com", label: ".com", url: "https://openai.chatnewai.com/" },
  { value: "icu", label: ".icu", url: "https://love.qinyan.icu/" },
];

function QinyHostRadio({
  value,
  onChange,
}: {
  value: QinyHostKind;
  onChange: (host: QinyHostKind) => void;
}) {
  return (
    <Field label="QinyAPI 接入点" hint="切换不同的虚空中继域名">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="QinyAPI 接入点">
        {QINY_HOST_OPTIONS.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.value)}
              className={`flex items-center justify-between gap-2 px-3 py-2 text-xs border rounded transition-all font-mono ${
                active
                  ? "bg-[#c1a067]/15 border-[#10b981] text-[#10b981]"
                  : "bg-black/40 border-[#183022] text-gray-400 hover:border-[#10b981]/40 hover:text-gray-200"
              }`}
              title={opt.url}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    active ? "bg-[#10b981]" : "bg-gray-700"
                  }`}
                />
                <span className="font-bold tracking-wider">{opt.label}</span>
              </span>
              <span className="text-[10px] text-gray-500 truncate">{opt.url}</span>
            </button>
          );
        })}
      </div>
    </Field>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-semibold text-gray-300 tracking-wider font-sans">
          {label}
        </label>
        {hint && <span className="text-[10px] text-gray-500 font-sans">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

interface ProviderDropdownProps<K extends string> {
  label: string;
  value: K;
  options: K[];
  renderIcon: (k: K) => React.ReactNode;
  renderLabel: (k: K) => string;
  onChange: (k: K) => void;
}

function ProviderDropdown<K extends string>({
  label,
  value,
  options,
  renderIcon,
  renderLabel,
  onChange,
}: ProviderDropdownProps<K>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <Field label={label}>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`w-full flex items-center justify-between gap-2 bg-black/40 border rounded px-3 py-2 text-xs text-gray-200 transition-all ${
            open ? "border-[#10b981]" : "border-[#183022] hover:border-[#10b981]/40"
          }`}
        >
          <span className="flex items-center gap-2">
            {renderIcon(value)}
            <span className="font-sans">{renderLabel(value)}</span>
          </span>
          <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute z-30 left-0 right-0 mt-1 bg-[#0c1410] border border-[#183022] rounded shadow-2xl shadow-black/60 overflow-hidden"
            >
              <div className="max-h-60 overflow-y-auto custom-scrollbar">
                {options.map((opt) => {
                  const active = opt === value;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        onChange(opt);
                        setOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                        active
                          ? "bg-[#c1a067]/20 text-[#10b981]"
                          : "text-gray-300 hover:bg-[#121f18]"
                      }`}
                    >
                      {renderIcon(opt)}
                      <span className="font-sans">{renderLabel(opt)}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Field>
  );
}

function ApiKeyField({
  label,
  value,
  onChange,
  helpUrl,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  helpUrl?: string;
}) {
  const [reveal, setReveal] = useState(false);

  // mousedown reveals, mouseup/leave hides — matches SillyTavern's "press to peek" pattern
  return (
    <Field
      label={label}
      hint={
        helpUrl ? (
          <a
            href={helpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#10b981] hover:text-[#c1a067] transition-colors underline-offset-2 hover:underline"
          >
            获取 API Key
          </a>
        ) : undefined
      }
    >
      <div className="relative">
        <input
          type={reveal ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="sk-..."
          className="w-full bg-black/40 border border-[#183022] focus:border-[#10b981] outline-none rounded px-3 py-2 pr-10 text-xs text-gray-200 font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          onMouseDown={() => setReveal(true)}
          onMouseUp={() => setReveal(false)}
          onMouseLeave={() => setReveal(false)}
          onTouchStart={() => setReveal(true)}
          onTouchEnd={() => setReveal(false)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-[#10b981] transition-colors"
          aria-label={reveal ? "隐藏 Key" : "按住显示 Key"}
          title="按住显示"
        >
          {reveal ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>
      </div>
    </Field>
  );
}

interface ModelFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  provider: LlmProviderKind | "qiny-image";
  apiKey: string;
  customBaseUrl?: string;
  qinyHost?: QinyHostKind;
}

function ModelField({ label, value, onChange, provider, apiKey, customBaseUrl, qinyHost }: ModelFieldProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const fetchModels = async () => {
    setOpen(true);
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ provider, apiKey });
      if (provider === "custom" && customBaseUrl) {
        params.set("customBaseUrl", customBaseUrl);
      }
      if ((provider === "qiny" || provider === "qiny-image") && qinyHost) {
        params.set("qinyHost", qinyHost);
      }
      const resp = await fetch(`/api/models?${params.toString()}`);
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        throw new Error(data?.error || `获取模型列表失败 (${resp.status})`);
      }
      const list: string[] = Array.isArray(data.models) ? data.models : [];
      setModels(list);
      if (list.length === 0) setErr("空列表：检查 Key 是否正确。");
    } catch (e: any) {
      setErr(e.message || "未知错误");
      setModels([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Field label={label}>
      <div ref={wrapperRef} className="relative">
        <div className="relative">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setOpen(false)}
            placeholder="例如 gpt-4o-mini / gemini-2.5-flash / claude-sonnet-4-5"
            className="w-full bg-black/40 border border-[#183022] focus:border-[#10b981] outline-none rounded px-3 py-2 pr-10 text-xs text-gray-200 font-mono"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={fetchModels}
            disabled={!apiKey || loading}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-[#10b981] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="获取模型列表"
            aria-label="获取模型列表"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="absolute z-30 left-0 right-0 bottom-full mb-1 bg-[#0c1410] border border-[#183022] rounded shadow-2xl shadow-black/60 overflow-hidden"
            >
              <div className="max-h-64 overflow-y-auto custom-scrollbar">
                {loading ? (
                  <div className="px-3 py-3 text-xs text-gray-400 flex items-center gap-2 font-sans">
                    <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
                    正在向虚空查询模型清单…
                  </div>
                ) : err ? (
                  <div className="px-3 py-3 text-xs text-red-400 flex items-center gap-2 font-sans">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {err}
                  </div>
                ) : (
                  models.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        onChange(m);
                        setOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-xs text-left transition-colors font-mono truncate ${
                        m === value
                          ? "bg-[#c1a067]/20 text-[#10b981]"
                          : "text-gray-300 hover:bg-[#121f18]"
                      }`}
                    >
                      {m}
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Field>
  );
}
