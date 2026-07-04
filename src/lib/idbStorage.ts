/**
 * 原生 IndexedDB 键值封装 —— API 刻意对标 localStorage（key:string → value:string），
 * 以便把 saveManager / apiSettings 从 localStorage 平滑迁移到 IndexedDB，而不必改动
 * 上层同步读写的调用形态（上层各自维护内存缓存 + bootstrap hydrate + 异步落盘）。
 *
 * 设计要点：
 *  - 单库单 store：DB_NAME="keeper_storage"，objectStore "kv"（out-of-line key）。
 *  - 每次操作 open + close，不持有长连接，无状态泄漏。
 *  - indexedDB 不可用（隐私模式 / 老浏览器 / SSR）时优雅降级：读返回 null，写为 no-op，
 *    迁移直接跳过，保证游戏在无 IDB 环境下仍能运行（只是不落盘）。
 */

const DB_NAME = "keeper_storage";
const DB_VERSION = 1;
const STORE = "kv";
const MIGRATION_SENTINEL = "__idb_migrated__";

// 需要从 localStorage 迁移进 IDB 的键（与旧 localStorage 键一一对应）。
const LEGACY_KEYS = ["keeper_game_saves", "keeper_api_settings"] as const;

function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getItem(key: string): Promise<string | null> {
  if (!idbAvailable()) return null;
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db!.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result;
        resolve(typeof v === "string" ? v : v == null ? null : String(v));
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error(`[idb] getItem(${key}) failed`, e);
    return null;
  } finally {
    db?.close();
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  if (!idbAvailable()) return;
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (e) {
    console.error(`[idb] setItem(${key}) failed`, e);
    throw e;
  } finally {
    db?.close();
  }
}

export async function removeItem(key: string): Promise<void> {
  if (!idbAvailable()) return;
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (e) {
    console.error(`[idb] removeItem(${key}) failed`, e);
  } finally {
    db?.close();
  }
}

export async function getAllKeys(): Promise<string[]> {
  if (!idbAvailable()) return [];
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    return await new Promise<string[]>((resolve, reject) => {
      const tx = db!.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error("[idb] getAllKeys failed", e);
    return [];
  } finally {
    db?.close();
  }
}

export async function isMigrationDone(): Promise<boolean> {
  return (await getItem(MIGRATION_SENTINEL)) === "1";
}

/**
 * 一次性、幂等、哨兵驱动的 localStorage → IndexedDB 迁移。
 *  1. indexedDB / localStorage 不可用 → 跳过。
 *  2. 哨兵已存在 → 已迁移，跳过（幂等，防重跑）。
 *  3. 逐个把 LEGACY_KEYS 复制进 IDB。
 *  4. 只有全部成功才清空 localStorage 对应键 + 写哨兵；任一失败则保留 localStorage，
 *     下次启动重试（不写哨兵）。
 */
export async function migrateFromLocalStorage(): Promise<void> {
  if (!idbAvailable()) return;
  let ls: Storage;
  try {
    ls = window.localStorage;
    if (!ls) return;
  } catch {
    return;
  }

  try {
    if (await isMigrationDone()) return;

    const copied: string[] = [];
    let failed = false;
    for (const key of LEGACY_KEYS) {
      const value = ls.getItem(key);
      if (value == null) continue;
      try {
        await setItem(key, value);
        copied.push(key);
      } catch {
        failed = true;
        break;
      }
    }

    if (failed) {
      console.warn("[idb] migration incomplete, will retry next launch");
      return;
    }

    // 全部成功 —— 清 localStorage 并写哨兵。
    for (const key of copied) {
      try {
        ls.removeItem(key);
      } catch {
        /* ignore single-key cleanup errors */
      }
    }
    await setItem(MIGRATION_SENTINEL, "1");
    if (copied.length) {
      console.log(`[idb] migrated ${copied.length} key(s) from localStorage`);
    }
  } catch (e) {
    console.error("[idb] migrateFromLocalStorage failed", e);
  }
}
