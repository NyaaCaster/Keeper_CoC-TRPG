import {
  ApiSettings,
  DEFAULT_API_SETTINGS,
  LlmProviderKind,
  ImageProviderKind,
  QinyHostKind,
  resolveQinyBaseUrl,
} from "../types";
import { generateTimestamp } from "./saveManager";
import { getItem, setItem } from "./idbStorage";

const STORAGE_KEY = "keeper_api_settings";

/** 内存缓存 —— bootstrap 时 hydrateApiSettings() 从 IDB 填充，之后同步读、异步落盘。 */
let cache: ApiSettings | null = null;

/** bootstrap 时调用一次：从 IDB 读入缓存。IDB 无数据时回退读 localStorage。 */
export async function hydrateApiSettings(): Promise<void> {
  try {
    let raw = await getItem(STORAGE_KEY);
    if (raw == null) {
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch {
        raw = null;
      }
    }
    cache = parseOrDefault(raw);
  } catch (e) {
    console.error("Failed to hydrate API settings", e);
    cache = structuredClone(DEFAULT_API_SETTINGS);
  }
}

function parseOrDefault(raw: string | null): ApiSettings {
  if (!raw) return structuredClone(DEFAULT_API_SETTINGS);
  try {
    const parsed = JSON.parse(raw);
    if (!validateApiSettingsJson(parsed)) {
      return structuredClone(DEFAULT_API_SETTINGS);
    }
    return parsed;
  } catch {
    return structuredClone(DEFAULT_API_SETTINGS);
  }
}

function ensureCache(): ApiSettings {
  if (cache !== null) return cache;
  // 未 hydrate 的兜底：同步读 localStorage。
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  cache = parseOrDefault(raw);
  return cache;
}

function persist(s: ApiSettings): void {
  void setItem(STORAGE_KEY, JSON.stringify(s)).catch((e) =>
    console.error("Failed to persist API settings to IDB", e),
  );
}

const LLM_KINDS: LlmProviderKind[] = [
  "qiny",
  "custom",
  "gemini",
  "anthropic",
  "grok",
  "deepseek",
];
const IMAGE_KINDS: ImageProviderKind[] = ["qiny"];
const QINY_HOSTS: QinyHostKind[] = ["com", "icu"];

export function loadApiSettings(): ApiSettings {
  return ensureCache();
}

export function saveApiSettings(s: ApiSettings): void {
  cache = s;
  persist(s);
}

export function isApiConfigured(s: ApiSettings): boolean {
  if (!s.llm.apiKey || !s.llm.model) return false;
  if (s.llm.provider === "custom" && !s.llm.customBaseUrl) return false;
  if (!s.image.apiKey || !s.image.model) return false;
  return true;
}

export function exportApiSettings(s: ApiSettings): void {
  const payload = JSON.stringify(s, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `KeeperSetting-${generateTimestamp()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function validateApiSettingsJson(data: unknown): data is ApiSettings {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  const llm = d.llm as Record<string, unknown> | undefined;
  const image = d.image as Record<string, unknown> | undefined;
  if (!llm || !image) return false;
  if (typeof llm.provider !== "string" || !LLM_KINDS.includes(llm.provider as LlmProviderKind)) return false;
  if (typeof llm.apiKey !== "string" || typeof llm.model !== "string") return false;
  if (llm.customBaseUrl !== undefined && typeof llm.customBaseUrl !== "string") return false;
  if (llm.qinyHost !== undefined && (typeof llm.qinyHost !== "string" || !QINY_HOSTS.includes(llm.qinyHost as QinyHostKind))) return false;
  if (typeof image.provider !== "string" || !IMAGE_KINDS.includes(image.provider as ImageProviderKind)) return false;
  if (typeof image.apiKey !== "string" || typeof image.model !== "string") return false;
  if (image.qinyHost !== undefined && (typeof image.qinyHost !== "string" || !QINY_HOSTS.includes(image.qinyHost as QinyHostKind))) return false;
  return true;
}

/**
 * Accept any of these and return `https://host[/optional-path]/v1`:
 *   https://x.com / https://x.com/
 *   https://x.com/v1 / https://x.com/v1/
 *   https://x.com/v1/chat/completions
 *   https://x.com/openai/v1 (preserved)
 */
export function normalizeCustomBaseUrl(input: string): string {
  let v = input.trim();
  if (!v) return v;
  v = v.replace(/\s+/g, "");
  v = v.replace(/\/+$/, "");
  v = v.replace(/\/chat\/completions$/i, "");
  if (!/\/v\d+(\/[A-Za-z0-9_-]+)*$/.test(v)) {
    v = `${v}/v1`;
  }
  return v;
}

export function resolveLlmBaseUrl(s: ApiSettings): string {
  if (s.llm.provider === "qiny") return resolveQinyBaseUrl(s.llm.qinyHost);
  if (s.llm.provider === "custom") return normalizeCustomBaseUrl(s.llm.customBaseUrl ?? "");
  return "";
}
