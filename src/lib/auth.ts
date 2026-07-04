// 会话令牌管理 + Express 认证中间件
// 沿用 NyaaChat shared-server/src/auth.js 的模式
//
// - Token: 64 字符 hex（randomBytes(32)），Bearer 头传递
// - 会话持久化在 sessions 表中，logout 时销毁
// - last_active 5 分钟去抖更新

import { randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import {
  insertSession,
  deleteSession,
  findSession,
  getUser,
  updateLastActive,
} from "./db";

// ---------------------------------------------------------------------------
// 声明 req.user / req.token 的类型扩展
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      user?: any; // better-sqlite3 返回的行对象
      token?: string;
    }
  }
}

// ---------------------------------------------------------------------------
// 会话管理
// ---------------------------------------------------------------------------

/** 为新登录创建一个 session token，存储到数据库并返回 token 字符串 */
export function createSession(account: string): string {
  const token = randomBytes(32).toString("hex");
  insertSession.run(token, account, Date.now());
  return token;
}

/** 销毁一个 session token（logout）。幂等。 */
export function destroySession(token: string): void {
  if (!token) return;
  deleteSession.run(token);
}

/** 从请求头中提取 Bearer token，失败返回 null */
export function tokenFromHeader(req: Request): string | null {
  const raw = req.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// last_active 去抖
// ---------------------------------------------------------------------------

const LAST_ACTIVE_DEBOUNCE_MS = 5 * 60 * 1000; // 5 分钟
const lastActiveDebounce = new Map<string, number>();

function touchLastActive(account: string) {
  const now = Date.now();
  const prev = lastActiveDebounce.get(account);
  if (prev == null || now - prev >= LAST_ACTIVE_DEBOUNCE_MS) {
    lastActiveDebounce.set(account, now);
    updateLastActive.run(now, account);
  }
}

// ---------------------------------------------------------------------------
// 认证中间件
// ---------------------------------------------------------------------------

/**
 * Express 中间件：解析 Bearer token，验证会话有效，将 user 行挂载到 req.user。
 * 失败返回 401 { ok: false, error: "unauthorized" }。
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = tokenFromHeader(req);
  if (!token) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  const session = findSession.get(token) as { account: string } | undefined;
  if (!session) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  const user = getUser.get(session.account);
  if (!user) {
    // 孤儿 token（用户已被删除）— 清理 session
    destroySession(token);
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  req.user = user;
  req.token = token;
  touchLastActive(session.account);
  next();
}
