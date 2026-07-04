/**
 * IDB 账户状态持久化 —— 基于 idbStorage.ts 的 getItem/setItem/removeItem，
 * 将登录 token 与 profile 以 JSON 形式存入 IndexedDB（key: keeper_account）。
 *
 * 设计要点：
 *  - 零依赖，仅依赖同模块的 idbStorage 原生 IDB 封装。
 *  - 不存密码；token 是服务端签发的 64 字符 hex session token。
 *  - 读取失败（IDB 不可用 / JSON 解析异常）统一返回 null，调用方自行降级。
 */

import { getItem, setItem, removeItem } from "./idbStorage";

const ACCOUNT_KEY = "keeper_account";

/** 服务端 /api/account/login 返回的 profile 字段 */
export interface AccountProfile {
  account: string;
  username: string;
  created_at: number; // unix ms
}

/** 持久化到 IDB 的账户状态 */
export interface AccountState {
  token: string;
  profile: AccountProfile;
}

/** 将账户状态序列化为 JSON 写入 IDB。失败抛异常（调用方应 catch）。 */
export async function saveAccountState(state: AccountState): Promise<void> {
  await setItem(ACCOUNT_KEY, JSON.stringify(state));
}

/** 从 IDB 读取并反序列化账户状态。失败返回 null。 */
export async function loadAccountState(): Promise<AccountState | null> {
  try {
    const raw = await getItem(ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // 基本结构校验
    if (
      typeof parsed?.token === "string" &&
      parsed.token.length > 0 &&
      parsed.profile &&
      typeof parsed.profile.account === "string" &&
      typeof parsed.profile.username === "string" &&
      typeof parsed.profile.created_at === "number"
    ) {
      return parsed as AccountState;
    }
    return null;
  } catch {
    return null;
  }
}

/** 删除 IDB 中的账户数据（退出登录时调用）。失败静默忽略。 */
export async function clearAccountState(): Promise<void> {
  try {
    await removeItem(ACCOUNT_KEY);
  } catch {
    /* 清理失败不阻塞用户退出 */
  }
}
