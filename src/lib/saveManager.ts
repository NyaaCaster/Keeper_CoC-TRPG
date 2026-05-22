import { WebGameSave } from "../types";
import { getImagePublicPrefix } from "./publicConfig";

const SAVES_KEY = "keeper_game_saves";

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
  return { ...save, clues: cleanedClues };
}

export function getAllSaves(): WebGameSave[] {
  try {
    const data = localStorage.getItem(SAVES_KEY);
    if (!data) return [];
    const saves: WebGameSave[] = JSON.parse(data);
    return saves.sort((a, b) => b.lastUpdated - a.lastUpdated);
  } catch (e) {
    console.error("Failed to load saves", e);
    return [];
  }
}

export function saveGame(save: WebGameSave) {
  const cleaned = sanitizeForStorage(save);
  const saves = getAllSaves();
  const existingIdx = saves.findIndex((s) => s.id === cleaned.id);

  if (existingIdx >= 0) {
    saves[existingIdx] = cleaned;
  } else {
    saves.push(cleaned);
  }

  try {
    localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
  } catch (e) {
    console.error("Failed to write to local storage", e);
  }
}

export function deleteSave(saveId: string) {
  const saves = getAllSaves();
  const filtered = saves.filter(s => s.id !== saveId);
  localStorage.setItem(SAVES_KEY, JSON.stringify(filtered));
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
