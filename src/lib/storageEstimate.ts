// 调查记录储存容量估算 —— P2 储存计量条 + 64MB 边界限制。
// 手工按 IDB key 计量（不用 navigator.storage.estimate），确保与 saveManager / apiSettings
// 的落盘 key 严格对应。参考 NyaaChat src/lib/storageEstimate.ts 的模式。

import { getItem } from "./idbStorage";

// ---------------------------------------------------------------------------
// 配额常量
// ---------------------------------------------------------------------------

/** 调查记录本地上限 64 MB */
export const CHAT_STORAGE_QUOTA = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 与 saveManager / apiSettings 保持一致的 IDB key
// ---------------------------------------------------------------------------

const SAVES_KEY = "keeper_game_saves";
const SETTINGS_KEY = "keeper_api_settings";

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 原始字符串的字节大小（UTF-8 编码近似，与 IDB 实际存储有差异但足够计量用） */
function rawStringBytes(s: string): number {
  return new Blob([s]).size;
}

/** 格式化字节为人类可读字符串（最多 1 位小数） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// 对外估算 API
// ---------------------------------------------------------------------------

/**
 * 异步估算当前 IndexedDB 中调查记录相关数据的总字节数。
 * 计量范围：keeper_game_saves + keeper_api_settings。
 * IDB 不可用或任一 key 读取失败时对应项计 0（不会抛异常）。
 */
export async function estimateSaveStorage(): Promise<number> {
  let total = 0;

  try {
    const savesRaw = await getItem(SAVES_KEY);
    if (savesRaw) total += rawStringBytes(savesRaw);
  } catch {
    // key 不存在或 IDB 不可用 → 计 0
  }

  try {
    const settingsRaw = await getItem(SETTINGS_KEY);
    if (settingsRaw) total += rawStringBytes(settingsRaw);
  } catch {
    // 同上
  }

  return total;
}
