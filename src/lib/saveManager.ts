import { WebGameSave } from "../types";

const SAVES_KEY = "keeper_game_saves";

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
  const saves = getAllSaves();
  const existingIdx = saves.findIndex(s => s.id === save.id);
  
  if (existingIdx >= 0) {
    saves[existingIdx] = save;
  } else {
    saves.push(save);
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
