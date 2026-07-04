// NyaaAcount 统一账号平台客户端（P3 凭证转发）
//
// 封装对 NyaaAcount /api/project/* 项目间 API 的调用：
//   - 鉴权：Authorization: Bearer <NYAAACOUNT_API_TOKEN>
//   - 请求体：Nyaa-HMAC-XOR-V1 加密（HMAC-SHA256 流密码，密钥为 32 字节 hex）
//   - 响应：明文 JSON（与 NyaaAcount 项目间端点约定一致）
//
// 环境变量（经 docker-compose.yml 注入）：
//   NYAAACOUNT_BASE_URL       — 平台地址，如 http://h.nyaa.host:5110
//   NYAAACOUNT_API_TOKEN      — 本项目（Keeper）的 project token
//   NYAAACOUNT_ENCRYPTION_KEY — 本项目的 32 字节 hex 传输密钥
//
// 账号服务不可达时 fail-closed：调用方拿到 ok=false / status=0，必须拒绝请求，
// 绝不回退到本地密码校验（本地密码已弃存）。
//
// 参考实现：
//   - 客户端：H:\GitHub\NyaaChat\shared-server\src\nyaacount-client.js（Node crypto 版）
//   - 加密：H:\GitHub\NyaaAcount\api\src\crypto.js（@noble/hashes 版，wire-compatible）
//   本文件使用 Node crypto（与 NyaaChat shared-server 一致），避免 @noble/hashes
//   在 TypeScript bundler 模式下的子路径类型解析问题。

import { createHmac, randomBytes } from "node:crypto";

const BASE_URL = (process.env.NYAAACOUNT_BASE_URL || "").replace(/\/+$/, "");
const API_TOKEN = process.env.NYAAACOUNT_API_TOKEN || "";
const KEY_HEX = process.env.NYAAACOUNT_ENCRYPTION_KEY || "";

const NONCE_LEN = 16;
const MAC_LEN = 16;
const BLOCK_LEN = 32; // SHA-256 输出长度

// ---------------------------------------------------------------------------
// Nyaa-HMAC-XOR-V1 传输加密
//
//   keystream[i] = HMAC-SHA256(key, nonce || counter_i)，counter 为 4 字节大端
//   payload = base64url( nonce(16) || ciphertext || mac(16) )
// ---------------------------------------------------------------------------

/** keystream[i] = HMAC-SHA256(key, nonce || counter_i)，counter 为 4 字节大端无符号整数 */
function deriveKeystream(
  key: Buffer,
  nonce: Buffer,
  length: number,
): Buffer {
  const blocks = Math.ceil(length / BLOCK_LEN);
  const parts: Buffer[] = [];
  for (let i = 0; i < blocks; i++) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(i, 0);
    parts.push(
      createHmac("sha256", key).update(Buffer.concat([nonce, counter])).digest(),
    );
  }
  return Buffer.concat(parts).subarray(0, length);
}

/**
 * 加密明文，返回 base64url 密文。
 * 格式：base64url( nonce(16) || ciphertext || mac(16) )
 */
function encryptTransport(plaintext: string): string {
  const key = Buffer.from(KEY_HEX, "hex");
  if (key.length !== 32) {
    throw new Error("NYAAACOUNT_ENCRYPTION_KEY 必须为 32 字节 hex（64 字符）");
  }

  const nonce = randomBytes(NONCE_LEN);
  const plainBuf = Buffer.from(plaintext, "utf8");
  const keystream = deriveKeystream(key, nonce, plainBuf.length);

  // XOR 加密
  const ciphertext = Buffer.alloc(plainBuf.length);
  for (let i = 0; i < plainBuf.length; i++) {
    ciphertext[i] = plainBuf[i] ^ keystream[i];
  }

  // MAC = HMAC-SHA256(key, nonce || ciphertext)[0:16]
  const macInput = Buffer.concat([nonce, ciphertext]);
  const macFull = createHmac("sha256", key).update(macInput).digest();
  const mac = macFull.subarray(0, MAC_LEN);

  // payload = nonce || ciphertext || mac
  const payload = Buffer.concat([nonce, ciphertext, mac]);
  return payload.toString("base64url");
}

// ---------------------------------------------------------------------------
// NyaaAcount API 调用
// ---------------------------------------------------------------------------

interface NyaaAcountResult {
  ok: boolean;
  status: number;
  data: any;
  error?: string;
}

async function callNyaaAcount(
  method: string,
  path: string,
  body: object | null,
): Promise<NyaaAcountResult> {
  if (!BASE_URL || !API_TOKEN || !KEY_HEX) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: "NyaaAcount 环境变量未配置（NYAAACOUNT_BASE_URL / API_TOKEN / ENCRYPTION_KEY）",
    };
  }

  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_TOKEN}`,
  };

  let fetchBody: string | undefined;
  if (body) {
    headers["Content-Type"] = "application/json";
    const plainJson = JSON.stringify(body);
    const encrypted = encryptTransport(plainJson);
    fetchBody = JSON.stringify({ payload: encrypted });
  }

  try {
    const resp = await fetch(url, {
      method,
      headers,
      body: fetchBody,
    });
    const data = await resp.json().catch(() => null);
    return { ok: resp.ok, status: resp.status, data };
  } catch (err: any) {
    console.error(`[NyaaAcount] 请求失败 ${method} ${path}:`, err.message);
    return { ok: false, status: 0, data: null, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------

/** 校验登录凭证；成功 → data = { uid, username } */
export function verifyUser(username: string, password: string) {
  return callNyaaAcount("POST", "/api/project/verify", { username, password });
}
