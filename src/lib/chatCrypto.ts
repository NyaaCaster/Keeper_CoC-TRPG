/**
 * 调查记录云端同步的 E2E 加密模块（P7）。
 *
 * 使用 Nyaa-HMAC-XOR-V1 认证流密码（HKDF + HMAC-SHA256），纯 JS 实现
 * 基于 @noble/hashes，无需 SubtleCrypto / 安全上下文。
 *
 * 密钥管理 — 服务端持有，per-account：
 *   GET /api/account/chat-sessions/key → 返回 32 字节 base64 密钥。
 *   首次访问时服务端自动生成并持久化，跨设备共享同一密钥。
 *   客户端按需获取，缓存在内存中，不写入 IndexedDB。
 *
 * 参考实现：H:\GitHub\NyaaChat\src\lib\chatCrypto.ts
 */

import type { WebGameSave } from "../types";
import { fetchChatCryptoKey } from "./accountApi";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

const ALGORITHM = "Nyaa-HMAC-XOR-V1" as const;
const INFO = new TextEncoder().encode("keeper-chat-sessions-hmac-xor-v1");

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface EncryptedSavesPayload {
  alg: typeof ALGORITHM;
  salt: string; // base64, 32 random bytes
  iv: string;   // base64, 16 random bytes
  data: string; // base64 ciphertext
  tag: string;  // base64, 32-byte HMAC-SHA256
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function getRandomBytes(n: number): Uint8Array {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint8Array(n));
  }
  throw new Error("Crypto.getRandomValues is required for secure encryption");
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * HMAC-XOR 流密码：keystream[i] = HMAC-SHA256(key, counter_i)
 * counter 为 4 字节大端无符号整数。
 */
function hmacStreamXor(input: Uint8Array, key: Uint8Array): Uint8Array {
  const output = new Uint8Array(input.length);
  let offset = 0;
  let counter = 0;
  while (offset < input.length) {
    const blockCounter = new Uint8Array(4);
    new DataView(blockCounter.buffer).setUint32(0, counter, false);
    const block = hmac(sha256, key, blockCounter);
    const n = Math.min(block.length, input.length - offset);
    for (let i = 0; i < n; i++) output[offset + i] = input[offset + i] ^ block[i];
    offset += n;
    counter += 1;
  }
  return output;
}

// ---------------------------------------------------------------------------
// 密钥缓存（会话内有效，不写入持久存储）
// ---------------------------------------------------------------------------

let cachedKey: Uint8Array | null = null;

async function getEncryptionKey(token: string): Promise<Uint8Array> {
  if (cachedKey) return cachedKey;

  const res = await fetchChatCryptoKey(token);
  if (!res.ok) {
    throw new Error(res.error === "network_error"
      ? "无法连接服务器获取加密密钥，请检查网络后重试"
      : `获取加密密钥失败：${res.error}`);
  }
  if (!res.data?.key) {
    throw new Error("服务器未返回加密密钥");
  }

  cachedKey = base64ToBytes(res.data.key);
  return cachedKey;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/** 加密存档数组 → EncryptedSavesPayload */
export async function encryptSaves(
  saves: WebGameSave[],
  token: string,
): Promise<EncryptedSavesPayload> {
  const masterKey = await getEncryptionKey(token);
  const salt = getRandomBytes(32);
  const iv = getRandomBytes(16);

  // HKDF 派生 encKey (32) + macKey (32)
  const material = hkdf(sha256, masterKey, salt, new Uint8Array([...iv, ...INFO]), 64);
  const encKey = material.slice(0, 32);
  const macKey = material.slice(32, 64);

  const plaintext = new TextEncoder().encode(JSON.stringify(saves));
  const data = hmacStreamXor(plaintext, encKey);
  // MAC = HMAC-SHA256(macKey, salt || iv || data)
  const tagInput = new Uint8Array(salt.length + iv.length + data.length);
  tagInput.set(salt, 0);
  tagInput.set(iv, salt.length);
  tagInput.set(data, salt.length + iv.length);
  const tag = hmac(sha256, macKey, tagInput);

  return {
    alg: ALGORITHM,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(data),
    tag: bytesToBase64(tag),
  };
}

/**
 * 解密 EncryptedSavesPayload → WebGameSave[]。
 * 先验证 MAC 再解密（先认证后解密，防 padding oracle）。
 */
export async function decryptSaves(
  payload: EncryptedSavesPayload,
  token: string,
): Promise<WebGameSave[]> {
  const masterKey = await getEncryptionKey(token);
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const data = base64ToBytes(payload.data);
  const tag = base64ToBytes(payload.tag);

  const material = hkdf(sha256, masterKey, salt, new Uint8Array([...iv, ...INFO]), 64);
  const encKey = material.slice(0, 32);
  const macKey = material.slice(32, 64);

  // 先验证 MAC
  const tagInput = new Uint8Array(salt.length + iv.length + data.length);
  tagInput.set(salt, 0);
  tagInput.set(iv, salt.length);
  tagInput.set(data, salt.length + iv.length);
  const expectedTag = hmac(sha256, macKey, tagInput);
  if (!equalBytes(expectedTag, tag)) {
    throw new Error("云端数据校验失败（密钥不匹配或数据已损坏）");
  }

  const plaintext = hmacStreamXor(data, encKey);
  const parsed = JSON.parse(new TextDecoder().decode(plaintext));
  if (!Array.isArray(parsed)) throw new Error("解密后数据格式异常");
  return parsed as WebGameSave[];
}
