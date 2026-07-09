/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import { Router } from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import crypto from "crypto";
import { breakpointOf } from "./src/lib/cocRules";

dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" }));

const DEV_MODE = process.env.NODE_ENV !== "production";
const PORT = 3000;

// Trust X-Forwarded-* headers when the request comes through a reverse proxy
// (nginx / Cloudflare / Docker host network). Without this, req.protocol,
// req.hostname and req.ip see the proxy hop instead of the original client.
//
// Defaults to "loopback, linklocal, uniquelocal" — covers nginx on the same
// host (127.0.0.1, ::1), Docker bridge networks (172.16/12, 10/8) and IPv6
// link-local. Override via TRUST_PROXY when the proxy is somewhere else:
//   TRUST_PROXY=1                -> trust the first hop (single-proxy setup)
//   TRUST_PROXY=true             -> trust every hop (only behind a fully trusted edge)
//   TRUST_PROXY=10.0.0.0/8,1.2.3.4 -> explicit CIDR / IP list
// See https://expressjs.com/en/guide/behind-proxies.html for the full spec.
const trustProxyRaw = (process.env.TRUST_PROXY ?? "loopback, linklocal, uniquelocal").trim();
if (trustProxyRaw === "true") app.set("trust proxy", true);
else if (trustProxyRaw === "false" || trustProxyRaw === "") app.set("trust proxy", false);
else if (/^\d+$/.test(trustProxyRaw)) app.set("trust proxy", Number(trustProxyRaw));
else app.set("trust proxy", trustProxyRaw);

const QINY_BASE_URLS = {
  com: "https://openai.chatnewai.com/v1",
  icu: "https://love.qinyan.icu/v1",
} as const;
type QinyHostKind = keyof typeof QINY_BASE_URLS;
function resolveQinyBaseUrl(host: QinyHostKind | string | undefined): string {
  return QINY_BASE_URLS[(host as QinyHostKind) in QINY_BASE_URLS ? (host as QinyHostKind) : "com"];
}

// ----- Image Cache (content-addressed, 30-day rolling) -----
// Generated images are persisted to disk under cache/images/<sha256>.png and
// served from /cache/images/<filename>. Same content -> same hash -> dedup.
// localStorage on the client only ever stores public URLs, never base64.
const IMAGE_CACHE_DIR = path.join(process.cwd(), "cache", "images");
const IMAGE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Resolve the public base URL used to mint cache image URLs.
//   1. If IMAGE_PUBLIC_BASE_URL is set, use it as-is. Recommended for any
//      deployment that wants generated clue images to remain reachable from
//      other devices/networks (and required for any reverse-proxy setup so
//      the localStorage allowlist matches the public origin exactly).
//   2. Otherwise, derive it from the incoming request's origin so a community
//      user can still run the project on localhost without any configuration.
//      Trade-off: those URLs only work from the same machine.
//
//   When fronted by a reverse proxy, req.protocol / req.hostname / req.get('host')
//   already follow X-Forwarded-* once `app.set('trust proxy', ...)` is on
//   (configured at the top of this file via TRUST_PROXY).
function resolveImagePublicBaseUrl(req: express.Request): string {
  const fromEnv = (process.env.IMAGE_PUBLIC_BASE_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const proto = req.protocol || "http";
  const host = req.get("host") || `127.0.0.1:${PORT}`;
  return `${proto}://${host}`;
}

fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });

function pruneExpiredImages() {
  try {
    const now = Date.now();
    const files = fs.readdirSync(IMAGE_CACHE_DIR);
    let removed = 0;
    for (const f of files) {
      try {
        const fp = path.join(IMAGE_CACHE_DIR, f);
        const st = fs.statSync(fp);
        if (now - st.mtimeMs > IMAGE_CACHE_TTL_MS) {
          fs.unlinkSync(fp);
          removed++;
        }
      } catch {
        /* ignore single-file errors */
      }
    }
    if (removed) console.log(`[image-cache] pruned ${removed} expired files`);
  } catch (e) {
    console.error("[image-cache] prune failed:", e);
  }
}
pruneExpiredImages();
setInterval(pruneExpiredImages, 24 * 60 * 60 * 1000).unref();

async function persistAndPublish(
  req: express.Request,
  input: { b64?: string; url?: string }
): Promise<string> {
  let bytes: Buffer;
  if (input.b64) {
    bytes = Buffer.from(input.b64, "base64");
  } else if (input.url) {
    const r = await fetch(input.url);
    if (!r.ok) throw new Error(`下载远端图片失败 (${r.status})`);
    bytes = Buffer.from(await r.arrayBuffer());
  } else {
    throw new Error("画图返回中既无 b64_json 也无 url");
  }
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  const filename = `${sha}.png`;
  const fullPath = path.join(IMAGE_CACHE_DIR, filename);
  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, bytes);
  } else {
    // Refresh mtime so the 30-day window restarts on every reuse
    const now = new Date();
    try {
      fs.utimesSync(fullPath, now, now);
    } catch {
      /* ignore */
    }
  }
  return `${resolveImagePublicBaseUrl(req)}/cache/images/${filename}`;
}

app.use(
  "/cache/images",
  express.static(IMAGE_CACHE_DIR, {
    maxAge: IMAGE_CACHE_TTL_MS,
    immutable: true,
    fallthrough: false,
    index: false,
  })
);

// Public runtime config — exposes the image-cache base URL so the SPA can
// build a same-origin allowlist for what's allowed into localStorage.
app.get("/api/public-config", (req, res) => {
  res.json({ imagePublicBaseUrl: resolveImagePublicBaseUrl(req) });
});

// Dynamic instructions — playable's private .docs/keeper-*.json content baked
// into a system-prompt fragment. The LLM dispatcher moved into the browser,
// but these files are intentionally excluded from the Docker image (玩家私有)
// so we still serve them from the server filesystem. Returns { text } where
// text is "" if no config exists or parsing fails (game continues uninterrupted).
app.get("/api/keeper/dynamic-instructions", (_req, res) => {
  res.json({ text: getDynamicInstructions() });
});

type LlmProviderKind = "qiny" | "custom" | "gemini" | "anthropic" | "grok" | "deepseek";
type ImageProviderKind = "qiny";

interface ApiSettings {
  llm: {
    provider: LlmProviderKind;
    apiKey: string;
    model: string;
    customBaseUrl?: string;
    qinyHost?: QinyHostKind;
  };
  image: {
    provider: ImageProviderKind;
    apiKey: string;
    model: string;
    qinyHost?: QinyHostKind;
  };
}

// ----- Server-side log capture -----
// Each handler creates a local logs[] and attaches it to the response as
// `_serverLogs`. The frontend ConsoleLogPanel merges these into its own buffer.
type ServerLogDraft = {
  direction: "request" | "response" | "error" | "info";
  content: string;
  meta?: any;
};
type LogPush = (entry: ServerLogDraft) => void;
const NOOP_LOG: LogPush = () => {};

function previewText(s: string | undefined | null, n = 240): string | undefined {
  if (!s) return undefined;
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ----- Image generation dispatcher -----
// `dispatchImage` is the provider-routing layer: it calls the upstream image
// API and returns the raw payload as `{ b64?, url? }`.
// `generateImageAndPublish` is the full pipeline: dispatch → persistAndPublish
// → public URL on the cache origin. Any new image endpoint MUST go through it
// so caching, deduplication, TTL refresh and the localStorage-whitelist origin
// stay consistent.
interface ImagePayload { b64?: string; url?: string }

interface DispatchImageInput {
  apiSettings: ApiSettings;
  prompt: string;
  size?: string;
  onLog?: LogPush;
}

async function dispatchImage({ apiSettings, prompt, size = "1024x1024", onLog }: DispatchImageInput): Promise<ImagePayload> {
  const log = onLog ?? NOOP_LOG;
  const provider = apiSettings.image.provider;
  const apiKey = apiSettings.image.apiKey;
  const model = apiSettings.image.model;

  if (!apiKey) throw new Error("画图 API Key 未配置：请在`虚空连接的设置`中填入画图 API Key。");
  if (!model) throw new Error("画图模型未配置：请在`虚空连接的设置`中填入画图模型名。");

  if (provider === "qiny") {
    const qinyBaseUrl = resolveQinyBaseUrl(apiSettings.image.qinyHost);
    const upstreamUrl = `${qinyBaseUrl}/images/generations`;
    log({
      direction: "request",
      content: `IMG qiny ${model} size=${size}`,
      meta: { upstreamUrl, model, size, n: 1, qinyHost: apiSettings.image.qinyHost ?? "com", promptPreview: previewText(prompt) }
    });
    const t0 = Date.now();
    let resp: Response;
    try {
      resp = await fetch(upstreamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, prompt, n: 1, size, response_format: "b64_json" })
      });
    } catch (e: any) {
      const friendly = humanizeFetchError(e, { url: upstreamUrl, what: "画图供应商 qiny" });
      log({
        direction: "error",
        content: `IMG qiny ${model} 网络层失败`,
        meta: { durationMs: Date.now() - t0, error: friendly, causeCode: e?.cause?.code, causeHost: e?.cause?.hostname }
      });
      throw new Error(friendly);
    }
    const durationMs = Date.now() - t0;
    if (!resp.ok) {
      const errText = await resp.text();
      log({
        direction: "error",
        content: `IMG qiny ${model} 返回 ${resp.status}`,
        meta: { durationMs, status: resp.status, upstreamError: previewText(errText, 600) }
      });
      throw new Error(`Qiny 返回 ${resp.status}：${errText.slice(0, 300)}`);
    }
    const data: any = await resp.json();
    const item = data?.data?.[0];
    if (!item?.b64_json && !item?.url) {
      log({
        direction: "error",
        content: `IMG qiny ${model} 返回结构异常`,
        meta: { durationMs, dataPreview: previewText(JSON.stringify(data), 400) }
      });
      throw new Error("画图返回结构异常，未找到 b64_json/url。");
    }
    log({
      direction: "response",
      content: `IMG qiny ${model} → ${item?.b64_json ? "b64" : "url"}`,
      meta: { durationMs, hasB64: !!item?.b64_json, hasUrl: !!item?.url }
    });
    return { b64: item?.b64_json, url: item?.url };
  }

  throw new Error(`画图供应商 ${provider} 暂不支持。`);
}

async function generateImageAndPublish(
  req: express.Request,
  apiSettings: ApiSettings,
  prompt: string,
  size?: string,
  onLog?: LogPush
): Promise<string> {
  const payload = await dispatchImage({ apiSettings, prompt, size, onLog });
  return persistAndPublish(req, payload);
}

function normalizeCustomBaseUrl(input: string): string {
  let v = (input || "").trim().replace(/\s+/g, "").replace(/\/+$/, "");
  if (!v) return v;
  v = v.replace(/\/chat\/completions$/i, "");
  if (!/\/v\d+(\/[A-Za-z0-9_-]+)*$/.test(v)) v = `${v}/v1`;
  return v;
}

function resolveOpenAiBaseUrl(
  provider: LlmProviderKind,
  customBaseUrl?: string,
  qinyHost?: QinyHostKind | string,
): string {
  switch (provider) {
    case "qiny": return resolveQinyBaseUrl(qinyHost);
    case "custom": return normalizeCustomBaseUrl(customBaseUrl || "");
    case "grok": return "https://api.x.ai/v1";
    case "deepseek": return "https://api.deepseek.com/v1";
    default: return "";
  }
}

// Dynamically load external TRPG rules and settings from user-provided file.
// Served via /api/keeper/dynamic-instructions so the browser-side LLM dispatch
// can fold this content into systemInstruction at request time.
function getDynamicInstructions(): string {
  try {
    const configPath = path.join(process.cwd(), ".docs", "keeper-260522031319.json");
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      const data = JSON.parse(content);
      let dynamicStr = "\n\n=== 补充设定与规则设定 (来自玩家配置) ===\n";
      if (data.description) {
        dynamicStr += `【游戏设计大纲】\n${data.description}\n\n`;
      }
      if (Array.isArray(data.worldInfo)) {
        data.worldInfo.forEach((info: any) => {
          if (info.enabled) {
            dynamicStr += `【${info.name}】(${info.triggerType || "permanent"})\n${info.content}\n\n`;
          }
        });
      }
      return dynamicStr;
    }
  } catch (e) {
    console.error("Failed to load dynamic instructions:", e);
  }
  return "";
}

// undici 的 fetch 在网络层失败时会抛 TypeError("fetch failed") 并把真实原因
// 挂在 e.cause 上。这层翻译让前端拿到可定位的中文消息，而不是裸 "fetch failed"。
function humanizeFetchError(e: any, ctx: { url?: string; what?: string } = {}): string {
  const cause: any = e?.cause ?? e;
  const code: string | undefined = cause?.code;
  const host: string | undefined = cause?.hostname || (() => {
    try { return ctx.url ? new URL(ctx.url).host : undefined; } catch { return undefined; }
  })();
  const what = ctx.what ?? "上游服务";
  const tail = host ? `（${host}）` : "";

  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `DNS 解析失败${tail}：无法找到域名${host ? `「${host}」` : ""}。可能是该域名被运营商/网络拦截或上游 DNS 临时不可达。如果使用 qiny，可在「虚空连接的设置」里把 host 切到 .icu 镜像。`;
    case "ECONNREFUSED":
      return `${what}拒绝连接${tail}：目标端口未开放或服务未启动。`;
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      return `连接${what}超时${tail}：网络抖动或目标不可达。请稍后重试。`;
    case "ECONNRESET":
    case "UND_ERR_SOCKET":
      return `与${what}的连接被中断${tail}：链路在请求中途断开，请重试。`;
    case "CERT_HAS_EXPIRED":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
      return `${what} TLS 证书校验失败${tail}：${code}。`;
  }
  if (e?.name === "AbortError") return `请求${what}已超时被中止${tail}。`;
  const msg = cause?.message || e?.message || String(e);
  return `${what}请求失败${tail}：${msg}`;
}

// NyaaChat-MCP returns Streamable-HTTP responses that may be either plain
// JSON or SSE-framed (`event: message\ndata: {...}`). Tolerate both.
function parseSseOrJson(raw: string): any {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("MCP 服务返回空响应");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed);
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      if (payload && payload !== "[DONE]") return JSON.parse(payload);
    }
  }
  throw new Error("MCP 服务响应格式无法解析");
}

// API - Generate Clue Photo (thin wrapper over generateImageAndPublish)
app.post("/api/image/generate-clue", async (req, res) => {
  const { prompt, apiSettings } = req.body;
  const logs: ServerLogDraft[] = [];
  const push: LogPush = (e) => logs.push(e);

  if (!prompt) return res.status(400).json({ error: "Prompt is required.", _serverLogs: logs });
  if (!apiSettings?.image?.apiKey || !apiSettings?.image?.model) {
    push({ direction: "info", content: `/api/image/generate-clue 画图未配置 → 占位图`, meta: {} });
    return res.json({ success: false, fallback: true, error: "画图 API 未配置，使用占位图。", _serverLogs: logs });
  }

  try {
    const imageUrl = await generateImageAndPublish(req, apiSettings, prompt, undefined, push);
    return res.json({ success: true, imageUrl, _serverLogs: logs });
  } catch (error: any) {
    console.warn("Image API call failed, fallback:", error.message || error);
    push({ direction: "error", content: `/api/image/generate-clue 失败 → 占位图`, meta: { error: error.message || "画图失败" } });
    return res.json({ success: false, fallback: true, error: error.message || "画图失败", _serverLogs: logs });
  }
});

// API - Objective Dice roll via NyaaChat-MCP. Falls back to a local CoC roller
// when the MCP token is not configured or the MCP server is unreachable, so
// the game continues even on a clean install.
app.post("/api/keeper/roll", async (req, res) => {
  const { skill, bonus, penalty } = req.body;
  const logs: ServerLogDraft[] = [];
  const push: LogPush = (e) => logs.push(e);

  if (skill === undefined) return res.status(400).json({ error: "skill value is required", _serverLogs: logs });

  const bearerToken = process.env.NYAACHAT_MCP_TOKEN;
  if (!bearerToken) {
    push({ direction: "info", content: `/api/keeper/roll → 本地兜底骰(MCP 未配置)`, meta: { skill, bonus, penalty } });
    return res.json({ success: true, text: localCocRoll(skill, bonus, penalty), fallback: true, _serverLogs: logs });
  }
  const mcpUrl = "http://h.nyaa.host:3094/mcp";

  try {
    const rpcPayload = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: "roll_coc",
        arguments: { skill: Number(skill), bonus: bonus ? Number(bonus) : undefined, penalty: penalty ? Number(penalty) : undefined }
      }
    };
    push({
      direction: "request",
      content: `MCP roll_coc skill=${skill}${bonus ? ` bonus=${bonus}` : ""}${penalty ? ` penalty=${penalty}` : ""}`,
      meta: { upstreamUrl: mcpUrl, payload: rpcPayload }
    });
    const t0 = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${bearerToken}`
      },
      body: JSON.stringify(rpcPayload), signal: controller.signal
    });
    clearTimeout(timeoutId);
    const durationMs = Date.now() - t0;
    if (!response.ok) throw new Error(`MCP Server responded with status ${response.status}`);
    const data: any = parseSseOrJson(await response.text());
    if (data.error) throw new Error(`MCP Error: ${data.error.message || JSON.stringify(data.error)}`);
    const result = data.result;
    if (result?.isError) {
      const msg = result.content?.[0]?.text || "tool returned isError";
      throw new Error(`roll_coc isError: ${msg}`);
    }
    const textContent = result?.content?.[0]?.text;
    if (!textContent) throw new Error("Invalid MCP response structure");
    push({
      direction: "response",
      content: `MCP roll_coc → ${previewText(textContent, 80)}`,
      meta: { durationMs, textPreview: previewText(textContent, 400) }
    });
    return res.json({ success: true, text: textContent, _serverLogs: logs });
  } catch (error: any) {
    console.warn("MCP Roll API call failed, fallback:", error.message || error);
    push({
      direction: "error",
      content: `MCP roll_coc 失败 → 本地兜底`,
      meta: { error: error.message || String(error) }
    });
    return res.json({ success: true, text: localCocRoll(skill, bonus, penalty), fallback: true, _serverLogs: logs });
  }
});

function localCocRoll(skill: any, bonus: any, penalty: any): string {
  const skillVal = Number(skill);
  const bonusCount = bonus ? Number(bonus) : 0;
  const penaltyCount = penalty ? Number(penalty) : 0;
  const finalUnits = Math.floor(Math.random() * 10);
  const finalTens1 = Math.floor(Math.random() * 10) * 10;
  const finalTens2 = Math.floor(Math.random() * 10) * 10;
  const finalTens3 = Math.floor(Math.random() * 10) * 10;

  let tensRolls: number[] = [finalTens1];
  if (bonusCount > 0) { tensRolls.push(finalTens2); if (bonusCount > 1) tensRolls.push(finalTens3); }
  else if (penaltyCount > 0) { tensRolls.push(finalTens2); if (penaltyCount > 1) tensRolls.push(finalTens3); }

  let finalTensSelected = finalTens1;
  if (bonusCount > 0) finalTensSelected = Math.min(...tensRolls);
  else if (penaltyCount > 0) finalTensSelected = Math.max(...tensRolls);

  const diceResult = (finalTensSelected === 0 && finalUnits === 0) ? 100 : finalTensSelected + finalUnits;

  let outcome = "失败";
  const bp = breakpointOf(skillVal);
  if (diceResult === 1) outcome = "大成功";
  else if (skillVal < 50 && diceResult === 100) outcome = "大失败";
  else if (skillVal >= 50 && diceResult >= 96) outcome = "大失败";
  else if (diceResult <= bp.fifth) outcome = "极难成功";
  else if (diceResult <= bp.half) outcome = "困难成功";
  else if (diceResult <= skillVal) outcome = "普通成功";

  const tensRepresentation = tensRolls.map(t => {
    const display = t === 0 ? "0" : (t / 10).toString();
    return (t === finalTensSelected) ? `${display}*` : display;
  }).join(", ");

  return `CoC 技能检定（技能值 ${skillVal}${bonusCount ? `，奖励骰 ×${bonusCount}` : ""}${penaltyCount ? `，惩罚骰 ×${penaltyCount}` : ""}）
  十位骰：${tensRepresentation}  → 取 ${finalTensSelected === 0 ? 0 : finalTensSelected / 10}
  个位骰：${finalUnits}
  最终：${diceResult < 10 ? "0" + diceResult : diceResult}
  判定：${outcome}（≤${skillVal}）`;
}

// API - NyaaChat-MCP liveness probe
//   GET /api/mcp/status → { ok: boolean, reason?: string }
//   The frontend Settings panel uses this to render a green/grey status dot.
app.get("/api/mcp/status", async (_req, res) => {
  const mcpUrl = "http://h.nyaa.host:3094/mcp";
  const bearerToken = process.env.NYAACHAT_MCP_TOKEN || "";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
    const r = await fetch(mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/list", params: {} }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!r.ok) return res.json({ ok: false, reason: `HTTP ${r.status}` });
    const data: any = parseSseOrJson(await r.text());
    if (data?.error) return res.json({ ok: false, reason: data.error.message || "rpc error" });
    return res.json({ ok: true });
  } catch (e: any) {
    clearTimeout(timeoutId);
    const reason = e?.name === "AbortError" ? "timeout" : e?.message || String(e);
    return res.json({ ok: false, reason });
  }
});

// API - List models for a provider+key (proxy).
// Anthropic doesn't expose a list-models endpoint reachable from the browser
// without a paid API path, so we hard-code a curated list here. All other
// providers proxy through to the upstream /models or /v1beta/models endpoint
// — server-side because some providers (e.g. qiny) don't allow CORS preflights
// from the browser even though the actual chat endpoint is permissive.
app.get("/api/models", async (req, res) => {
  const provider = String(req.query.provider || "") as LlmProviderKind | "qiny-image";
  const apiKey = String(req.query.apiKey || "");
  const customBaseUrl = String(req.query.customBaseUrl || "");
  const qinyHost = String(req.query.qinyHost || "");

  if (!apiKey) return res.status(400).json({ error: "apiKey is required" });

  try {
    if (provider === "anthropic") {
      return res.json({
        success: true,
        models: [
          "claude-opus-4-1",
          "claude-sonnet-4-5",
          "claude-haiku-4-5",
          "claude-opus-4-7",
          "claude-sonnet-4-6"
        ]
      });
    }
    if (provider === "gemini") {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
      if (!resp.ok) throw new Error(`Gemini 返回 ${resp.status}`);
      const data: any = await resp.json();
      const models = (data.models || [])
        .filter((m: any) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
        .map((m: any) => String(m.name).replace(/^models\//, ""));
      return res.json({ success: true, models });
    }
    // OpenAI 兼容
    const baseUrl = provider === "qiny-image"
      ? resolveQinyBaseUrl(qinyHost)
      : resolveOpenAiBaseUrl(provider as LlmProviderKind, customBaseUrl, qinyHost);
    if (!baseUrl) throw new Error(`不支持的供应商：${provider}`);
    const resp = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`供应商 ${provider} 返回 ${resp.status}：${errText.slice(0, 300)}`);
    }
    const data: any = await resp.json();
    const models = (data.data || []).map((m: any) => m.id).filter(Boolean);
    return res.json({ success: true, models });
  } catch (error: any) {
    console.error("API Error in /api/models:", error);
    return res.status(500).json({ error: error.message || "Unknown error" });
  }
});

// ---------------------------------------------------------------------------
// Account System (P3) — /api/account/*
// ---------------------------------------------------------------------------
import {
  db,
  getUser,
  getUserByNyaaUid,
  insertUser,
  updateLastActive,
  updateUsername,
  getUserSettings,
  upsertUserSettings,
} from "./src/lib/db";
import { verifyUser } from "./src/lib/nyaacount-client";
import { requireAuth, createSession, destroySession } from "./src/lib/auth";

const accountRouter = Router();

// POST /api/account/login
// 校验凭证（转发 NyaaAcount），JIT 建本地行，返回 session token
accountRouter.post("/login", async (req, res) => {
  const account = String(req.body?.account ?? "").trim();
  const password = String(req.body?.password ?? "");

  if (!account) {
    return res.status(400).json({ ok: false, error: "invalid_account" });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ ok: false, error: "invalid_password" });
  }

  const r = await verifyUser(account, password);

  // 401 = 凭据错误（与 NyaaChat 一致，统一响应避免用户枚举）
  if (r.status === 401) {
    return res.status(401).json({ ok: false, error: "bad_credentials" });
  }

  // 0 = 网络失败或环境变量未配置 → fail-closed
  if (!r.ok || !r.data?.uid) {
    return res.status(503).json({ ok: false, error: "account_service_unavailable" });
  }

  const nyaaUid = r.data.uid as number;

  // 按 nyaa_uid 定位本地用户行
  let user = getUserByNyaaUid.get(nyaaUid) as any;

  if (!user) {
    // JIT 首登建号
    let localAccount = r.data.username as string;
    if (getUser.get(localAccount)) {
      localAccount = `${r.data.username}_nyaa${nyaaUid}`;
    }
    const now = Date.now();
    insertUser.run({
      account: localAccount,
      username: r.data.username,
      created_at: now,
      last_active: now,
      nyaa_uid: nyaaUid,
    });
    user = getUser.get(localAccount) as any;
  }

  updateLastActive.run(Date.now(), user.account);
  const token = createSession(user.account);

  return res.json({
    ok: true,
    token,
    profile: {
      account: user.account,
      username: user.username,
      created_at: user.created_at,
    },
  });
});

// POST /api/account/logout
accountRouter.post("/logout", requireAuth, (req, res) => {
  destroySession(req.token!);
  return res.json({ ok: true });
});

// GET /api/account/profile
accountRouter.get("/profile", requireAuth, (req, res) => {
  return res.json({
    ok: true,
    profile: {
      account: req.user!.account,
      username: req.user!.username,
      created_at: req.user!.created_at,
    },
  });
});

// POST /api/account/rename
accountRouter.post("/rename", requireAuth, (req, res) => {
  const newName = String(req.body?.username ?? "").trim();
  if (!newName || newName.length > 20) {
    return res.status(400).json({ ok: false, error: "invalid_username" });
  }
  updateUsername.run(newName, req.user!.account);
  return res.json({ ok: true, username: newName });
});

// PUT /api/account/settings — 上传云端设置（upsert）
accountRouter.put("/settings", requireAuth, (req, res) => {
  const { payload } = req.body ?? {};
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ ok: false, error: "bad_payload" });
  }
  if (payload._kind !== "keeper_settings_export" || !payload.settings) {
    return res.status(400).json({ ok: false, error: "bad_payload" });
  }
  const now = Date.now();
  try {
    upsertUserSettings.run(req.user!.account, JSON.stringify(payload), now);
  } catch {
    return res.status(500).json({ ok: false, error: "db_write_failed" });
  }
  return res.json({ ok: true, updated_at: now });
});

// GET /api/account/settings — 下载云端设置
accountRouter.get("/settings", requireAuth, (req, res) => {
  const row = getUserSettings.get(req.user!.account) as any;
  if (!row) {
    return res.json({ ok: true, exists: false });
  }
  let payload: any;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    return res.json({ ok: true, exists: false });
  }
  return res.json({
    ok: true,
    exists: true,
    updated_at: row.updated_at,
    payload,
  });
});

// ---------------------------------------------------------------------------
// Chat Sessions Cloud Sync (P7) — /api/account/chat-sessions/*
// ---------------------------------------------------------------------------

const USER_STORAGE_DIR =
  process.env.KEEPER_USER_STORAGE_DIR || path.join(process.cwd(), "data", "user-storage");

// GET /api/account/chat-sessions/key — 获取/生成 per-account 加密密钥
accountRouter.get("/chat-sessions/key", requireAuth, (req, res) => {
  const account = req.user!.account;
  const dir = path.join(USER_STORAGE_DIR, account);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* dir exists */ }
  const keyPath = path.join(dir, "chat-crypto-key.json");

  let keyB64: string;
  if (fs.existsSync(keyPath)) {
    try {
      const raw = fs.readFileSync(keyPath, "utf-8");
      const obj = JSON.parse(raw);
      keyB64 = obj.key;
    } catch {
      return res.status(500).json({ ok: false, error: "key_read_failed" });
    }
  } else {
    const bytes = crypto.randomBytes(32);
    keyB64 = Buffer.from(bytes).toString("base64");
    try {
      fs.writeFileSync(keyPath, JSON.stringify({ key: keyB64 }), "utf-8");
    } catch (err) {
      console.error("[chat-sessions] failed to persist crypto key for", account, err);
      return res.status(500).json({ ok: false, error: "key_write_failed" });
    }
  }

  return res.json({ ok: true, key: keyB64 });
});

// PUT /api/account/chat-sessions — 上传加密的调查记录（原子写入）
accountRouter.put("/chat-sessions", requireAuth, (req, res) => {
  const body = req.body ?? {};
  const isEncrypted =
    body.alg === "Nyaa-HMAC-XOR-V1" &&
    typeof body.salt === "string" &&
    typeof body.iv === "string" &&
    typeof body.data === "string" &&
    typeof body.tag === "string";

  if (!isEncrypted) {
    return res.status(400).json({ ok: false, error: "bad_payload" });
  }

  const account = req.user!.account;
  const dir = path.join(USER_STORAGE_DIR, account);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* dir exists */ }
  const filePath = path.join(dir, "chat-sessions.json");
  const tmpPath = filePath + ".tmp." + Date.now();
  const now = Date.now();

  try {
    fs.writeFileSync(tmpPath, JSON.stringify({ ...body, updated_at: now }), "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* best-effort */ }
    console.error("[chat-sessions] write failed for", account, err);
    return res.status(500).json({ ok: false, error: "write_failed" });
  }

  return res.json({ ok: true, updated_at: now, count: -1 });
});

// GET /api/account/chat-sessions — 下载加密的调查记录
accountRouter.get("/chat-sessions", requireAuth, (req, res) => {
  const account = req.user!.account;
  const filePath = path.join(USER_STORAGE_DIR, account, "chat-sessions.json");
  if (!fs.existsSync(filePath)) {
    return res.json({ ok: true, exists: false });
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    console.error("[chat-sessions] read failed for", account, err);
    return res.status(500).json({ ok: false, error: "read_failed" });
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return res.status(500).json({ ok: false, error: "parse_failed" });
  }

  return res.json({ ok: true, exists: true, ...data });
});

// GET /api/account/health — 数据库健康探针
accountRouter.get("/health", (_req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ ok: true, db: "ok" });
  } catch (e: any) {
    res.status(500).json({ ok: false, db: "error", error: String(e) });
  }
});

app.use("/api/account", accountRouter);

// Configure Vite or Serve SPA in production
async function startServer() {
  if (DEV_MODE) {
    console.log("Serving full-stack app in DEVELOPMENT mode...");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    console.log("Serving full-stack app in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => { res.sendFile(path.join(distPath, "index.html")); });
  }
  app.listen(PORT, "0.0.0.0", () => { console.log(`CoC TRPG Server running on port ${PORT}`); });
}

startServer();
