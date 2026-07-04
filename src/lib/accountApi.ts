/**
 * 浏览器端账户 API 客户端 —— 封装对 /api/account/* 的 fetch 调用。
 *
 * 设计要点：
 *  - 三态结果 ApiResult<T>：ok/error，调用方无需 try-catch。
 *  - 需要认证的端点通过 Authorization: Bearer <token> 头传递 session token。
 *  - 12s AbortController 超时，避免网络故障时无限挂起。
 *  - 零依赖，只用浏览器原生 fetch。
 */

import type { AccountProfile } from "./idbAccount";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type ApiResult<T> =
  | { ok: true; data: T; error?: never }
  | { ok: false; error: string; data?: never };

interface LoginResponse {
  ok: boolean;
  token?: string;
  profile?: AccountProfile;
  error?: string;
}

interface LogoutResponse {
  ok: boolean;
  error?: string;
}

interface ProfileResponse {
  ok: boolean;
  profile?: AccountProfile;
  error?: string;
}

interface RenameResponse {
  ok: boolean;
  username?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 12_000;

function createAbortSignal(): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return { signal: ctrl.signal, clear: () => clearTimeout(timer) };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  const body = (await resp.json()) as T;
  return body;
}

// ---------------------------------------------------------------------------
// API 函数
// ---------------------------------------------------------------------------

/**
 * 登录 —— 向服务端提交账号密码，成功返回 token + profile。
 * 服务端 fail-closed：NyaaAcount 不可用时返回 503。
 */
export async function login(
  account: string,
  password: string,
): Promise<ApiResult<{ token: string; profile: AccountProfile }>> {
  const { signal, clear } = createAbortSignal();
  try {
    const body = await fetchJson<LoginResponse>("/api/account/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, password }),
      signal,
    });

    if (body.ok && body.token && body.profile) {
      return { ok: true, data: { token: body.token, profile: body.profile } };
    }

    const err = body.error || "unknown_error";
    // 映射常见错误为用户可读文本（调用方可自行覆写）
    return { ok: false, error: err };
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return { ok: false, error: "network_error" };
    }
    return { ok: false, error: "network_error" };
  } finally {
    clear();
  }
}

/** 登出 —— 销毁服务端 session。即使失败也不阻塞本地清除。 */
export async function logout(token: string): Promise<ApiResult<null>> {
  const { signal, clear } = createAbortSignal();
  try {
    const body = await fetchJson<LogoutResponse>("/api/account/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal,
    });

    if (body.ok) return { ok: true, data: null };
    return { ok: false, error: body.error || "unknown_error" };
  } catch {
    return { ok: false, error: "network_error" };
  } finally {
    clear();
  }
}

/** 获取当前账户 profile。需要有效 token。 */
export async function getProfile(
  token: string,
): Promise<ApiResult<AccountProfile>> {
  const { signal, clear } = createAbortSignal();
  try {
    const body = await fetchJson<ProfileResponse>("/api/account/profile", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });

    if (body.ok && body.profile) {
      return { ok: true, data: body.profile };
    }
    return { ok: false, error: body.error || "unknown_error" };
  } catch {
    return { ok: false, error: "network_error" };
  } finally {
    clear();
  }
}

/** 修改用户名。需要有效 token，新名称 1-20 字符。 */
export async function rename(
  token: string,
  username: string,
): Promise<ApiResult<{ username: string }>> {
  const { signal, clear } = createAbortSignal();
  try {
    const body = await fetchJson<RenameResponse>("/api/account/rename", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ username }),
      signal,
    });

    if (body.ok && body.username) {
      return { ok: true, data: { username: body.username } };
    }
    return { ok: false, error: body.error || "unknown_error" };
  } catch {
    return { ok: false, error: "network_error" };
  } finally {
    clear();
  }
}

// ---------------------------------------------------------------------------
// 云端设置同步（P6）
// ---------------------------------------------------------------------------

export const SETTINGS_EXPORT_KIND = "keeper_settings_export" as const;
export const SETTINGS_EXPORT_VERSION = 1;

export interface CloudSettingsResponse {
  ok: boolean;
  exists: boolean;
  updated_at?: number;
  payload?: { _kind: string; _version: number; settings: any };
  error?: string;
}

/** 上传设置到云端（覆盖式 upsert）。需要有效 token。 */
export async function uploadCloudSettings(
  token: string,
  payload: object,
): Promise<ApiResult<{ updated_at: number }>> {
  const { signal, clear } = createAbortSignal();
  try {
    const body = await fetchJson<{ ok: boolean; updated_at?: number; error?: string }>(
      "/api/account/settings",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ payload }),
        signal,
      },
    );

    if (body.ok && body.updated_at) {
      return { ok: true, data: { updated_at: body.updated_at } };
    }
    return { ok: false, error: body.error || "unknown_error" };
  } catch {
    return { ok: false, error: "network_error" };
  } finally {
    clear();
  }
}

/** 下载云端设置。无存档时返回 exists: false。需要有效 token。 */
export async function downloadCloudSettings(
  token: string,
): Promise<ApiResult<CloudSettingsResponse>> {
  const { signal, clear } = createAbortSignal();
  try {
    const body = await fetchJson<CloudSettingsResponse>(
      "/api/account/settings",
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal,
      },
    );

    if (body.ok !== false) {
      return { ok: true, data: body };
    }
    return { ok: false, error: body.error || "unknown_error" };
  } catch {
    return { ok: false, error: "network_error" };
  } finally {
    clear();
  }
}

/** 构建设置导出 payload（用于上传到云端）。 */
export function buildSettingsExportPayload(settings: any) {
  return {
    _kind: SETTINGS_EXPORT_KIND,
    _version: SETTINGS_EXPORT_VERSION,
    settings,
  };
}
