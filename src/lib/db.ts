// 账号系统数据库层 — better-sqlite3
// 沿用 NyaaChat shared-server/src/db.js 的模式：WAL + foreign_keys=ON + prepared statements
// 本模块仅在服务端使用，不进前端 bundle（esbuild --packages=external 排除 native 模块）

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH =
  process.env.KEEPER_DB_PATH || path.join(process.cwd(), "data", "db", "keeper.db");

// 确保 db 目录存在（容器内 /data/db/ 由 bind mount 提供）
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------------------------------------------------------------------------
// 建表（幂等 — CREATE TABLE IF NOT EXISTS）
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    account     TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    last_active INTEGER NOT NULL DEFAULT 0,
    nyaa_uid    INTEGER
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nyaa_uid ON users(nyaa_uid);

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    account    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (account) REFERENCES users(account) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    account    TEXT PRIMARY KEY,
    payload    TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (account) REFERENCES users(account) ON DELETE CASCADE
  );
`);

// ---------------------------------------------------------------------------
// Prepared statements — users
// ---------------------------------------------------------------------------

export const getUser = db.prepare("SELECT * FROM users WHERE account = ?");

export const getUserByNyaaUid = db.prepare("SELECT * FROM users WHERE nyaa_uid = ?");

export const insertUser = db.prepare(`
  INSERT INTO users (account, username, created_at, last_active, nyaa_uid)
  VALUES (@account, @username, @created_at, @last_active, @nyaa_uid)
`);

export const updateLastActive = db.prepare(
  "UPDATE users SET last_active = ? WHERE account = ?",
);

export const updateUsername = db.prepare(
  "UPDATE users SET username = ? WHERE account = ?",
);

// ---------------------------------------------------------------------------
// Prepared statements — sessions
// ---------------------------------------------------------------------------

export const insertSession = db.prepare(
  "INSERT INTO sessions (token, account, created_at) VALUES (?, ?, ?)",
);

export const deleteSession = db.prepare("DELETE FROM sessions WHERE token = ?");

export const findSession = db.prepare("SELECT account FROM sessions WHERE token = ?");
