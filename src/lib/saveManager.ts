import { WebGameSave } from "../types";
import { getImagePublicPrefix } from "./publicConfig";
import { getItem, setItem } from "./idbStorage";

const SAVES_KEY = "keeper_game_saves";

/**
 * 内存缓存 —— IndexedDB 是异步的，而 App 初始化 / StartScreen 渲染是同步读，
 * 所以在 bootstrap 时 hydrateSaves() 从 IDB 填充此缓存，之后 getAllSaves() 同步
 * 读缓存、saveGame()/deleteSave() 先改缓存再异步落盘（fire-and-forget）。
 * 未 hydrate 时（cache === null）退化为一次同步 localStorage 读，保证极端时序下不空。
 */
let cache: WebGameSave[] | null = null;

function parseSaves(raw: string | null): WebGameSave[] {
  if (!raw) return [];
  try {
    const saves: WebGameSave[] = JSON.parse(raw);
    if (!Array.isArray(saves)) return [];
    return saves.map(migrateLegacySave);
  } catch (e) {
    console.error("Failed to parse saves", e);
    return [];
  }
}

/** bootstrap 时调用一次：从 IDB 读入缓存。IDB 无数据时回退读 localStorage（迁移前的兜底）。 */
export async function hydrateSaves(): Promise<void> {
  try {
    let raw = await getItem(SAVES_KEY);
    if (raw == null) {
      try {
        raw = localStorage.getItem(SAVES_KEY);
      } catch {
        raw = null;
      }
    }
    cache = parseSaves(raw);
  } catch (e) {
    console.error("Failed to hydrate saves", e);
    cache = [];
  }
}

function ensureCache(): WebGameSave[] {
  if (cache !== null) return cache;
  // 未 hydrate 的兜底：同步读 localStorage（仅在极端时序或 IDB 不可用时命中）。
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SAVES_KEY);
  } catch {
    raw = null;
  }
  cache = parseSaves(raw);
  return cache;
}

function persist(saves: WebGameSave[]): void {
  // fire-and-forget 异步落盘；失败仅记录，不阻塞 UI。
  void setItem(SAVES_KEY, JSON.stringify(saves)).catch((e) =>
    console.error("Failed to persist saves to IDB", e),
  );
}

/**
 * 读时迁移:老存档没有 gameMode,统一视为 llm-generated。
 * scenario-based 模式的存档会带 gameMode + scenarioState,这里不做形状校验,
 * 让消费侧(applyKeeperResponse / scenarioRuntime)在读时按 schema 处理缺漏。
 */
function migrateLegacySave(save: WebGameSave): WebGameSave {
  if (save.gameMode) return save;
  return { ...save, gameMode: "llm-generated" };
}

// localStorage 只允许存储白名单前缀的图片 URL（来自 /api/public-config）。
// 任何 data:URI 或第三方地址（含已废弃的 base64 老存档）写入前都会被剔除，
// 避免存档体积膨胀以及因 base64 撑爆 localStorage 配额。
// 前缀为空（公网配置尚未拉到）时 fail-closed —— 同样剔除，保证不污染存档。
function sanitizeForStorage(save: WebGameSave): WebGameSave {
  const prefix = getImagePublicPrefix();
  const cleanedClues = save.clues.map((c) => {
    if (c.imageUrl && (!prefix || !c.imageUrl.startsWith(prefix))) {
      const { imageUrl, ...rest } = c;
      return rest;
    }
    return c;
  });
  const cleanedMessages = save.messages.map((m) => {
    if (
      m.sceneImage?.imageUrl &&
      (!prefix || !m.sceneImage.imageUrl.startsWith(prefix))
    ) {
      const { imageUrl, ...restScene } = m.sceneImage;
      return { ...m, sceneImage: restScene };
    }
    return m;
  });
  return { ...save, clues: cleanedClues, messages: cleanedMessages };
}

export function getAllSaves(): WebGameSave[] {
  const saves = ensureCache();
  return [...saves].sort((a, b) => b.lastUpdated - a.lastUpdated);
}

export function saveGame(save: WebGameSave) {
  const cleaned = sanitizeForStorage(save);
  const saves = ensureCache();
  const existingIdx = saves.findIndex((s) => s.id === cleaned.id);

  if (existingIdx >= 0) {
    saves[existingIdx] = cleaned;
  } else {
    saves.push(cleaned);
  }

  persist(saves);
}

export function deleteSave(saveId: string) {
  const filtered = ensureCache().filter((s) => s.id !== saveId);
  cache = filtered;
  persist(filtered);
}

export function generateTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function downloadSaveAsJson(save: WebGameSave) {
  const jsonData = JSON.stringify(save, null, 2);
  const blob = new Blob([jsonData], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.download = `守密人记录_${save.moduleName}_${save.timestamp}.json`;
  a.click();
  
  URL.revokeObjectURL(url);
}

export function validateSaveFormat(data: any): boolean {
  if (!data || typeof data !== "object") return false;
  if (!data.id || !data.timestamp || !data.moduleName) return false;
  if (!Array.isArray(data.messages)) return false;
  if (!data.character) return false;
  return true;
}
