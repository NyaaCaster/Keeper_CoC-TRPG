/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 客户端 LLM 调度器 — 浏览器直连各家 LLM 端点。
 *
 * 历史上调度器在 server.ts 的 dispatchLlm 里，由后端代理；现在迁到浏览器后，
 * 凭据从未离开过用户机器（API Key 仍只存于 localStorage，不上服务端）。
 *
 * 与 NyaaChat 对齐的关键点：
 * - normalizeBaseUrl: 容忍用户粘贴 https://host、host/v1、host/v1/chat/completions 等多种写法
 * - assertSafeBaseUrl: 仅放行 https://（loopback 例外），防止 Authorization 头泄露给 http 钓鱼端点
 * - Anthropic 直连官方 host 时挂上 anthropic-dangerous-direct-browser-access: true，
 *   并同时下发 x-api-key 与 Authorization: Bearer，兼容第三方网关
 * - Gemini 走 REST 端点，避免在浏览器引入 @google/genai SDK
 *
 * 暂不引入流式输出 — Keeper 调用都是结构化 JSON，一次性返回更可靠。
 */

import type { ApiSettings, LlmProviderKind, QinyHostKind } from "../types";
import { resolveQinyBaseUrl } from "../types";

export class LlmHttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`LLM API ${status}: ${(body || "").slice(0, 300)}`);
    this.name = "LlmHttpError";
    this.status = status;
    this.body = body;
  }
}

function normalizeCustomBaseUrl(input: string): string {
  let v = (input || "").trim().replace(/\s+/g, "").replace(/\/+$/, "");
  if (!v) return v;
  const knownSuffixes = [
    "/chat/completions",
    "/v1/chat/completions",
    "/messages",
    "/v1/messages",
  ];
  for (const suffix of knownSuffixes) {
    if (v.toLowerCase().endsWith(suffix)) {
      v = v.slice(0, -suffix.length);
      break;
    }
  }
  v = v.replace(/\/+$/, "");
  if (!/\/v\d+(\/[A-Za-z0-9_-]+)*$/.test(v)) {
    try {
      const u = new URL(v);
      if (u.pathname === "" || u.pathname === "/") v = `${u.origin}/v1`;
    } catch {
      // leave unchanged; assertSafeBaseUrl will reject it.
    }
  }
  return v;
}

export function resolveOpenAiBaseUrl(
  provider: LlmProviderKind,
  customBaseUrl?: string,
  qinyHost?: QinyHostKind | string,
): string {
  switch (provider) {
    case "qiny": return resolveQinyBaseUrl((qinyHost ?? "com") as QinyHostKind);
    case "custom": return normalizeCustomBaseUrl(customBaseUrl || "");
    case "grok": return "https://api.x.ai/v1";
    case "deepseek": return "https://api.deepseek.com/v1";
    default: return "";
  }
}

function resolveAnthropicBaseUrl(customBaseUrl?: string): string {
  const v = (customBaseUrl || "").trim().replace(/\/+$/, "");
  if (!v) return "https://api.anthropic.com";
  // Strip well-known suffixes, then leave as-is (no /v1 inference for Anthropic).
  return v
    .replace(/\/v1\/messages$/i, "")
    .replace(/\/messages$/i, "")
    .replace(/\/+$/, "");
}

function resolveGeminiBaseUrl(customBaseUrl?: string): string {
  const v = (customBaseUrl || "").trim().replace(/\/+$/, "");
  return v || "https://generativelanguage.googleapis.com";
}

function assertSafeBaseUrl(baseUrl: string): URL {
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch {
    throw new Error(`无效的 API Base URL: ${baseUrl}`);
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (parsed.protocol === "https:") return parsed;
  if (parsed.protocol === "http:" && isLoopback) return parsed;
  throw new Error(
    `不允许的 API 协议: ${parsed.protocol}。仅支持 https://，本地调试可使用 http://localhost`,
  );
}

function isOfficialAnthropicHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "api.anthropic.com" || host.endsWith(".anthropic.com");
  } catch {
    return false;
  }
}

function stripCodeFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

/**
 * 容忍非 Gemini 供应商把 JSON 包裹在 Markdown / 解释文本里的情况:
 * 在去掉 ``` 之后,如果首字符不是 { 或 [,就抓首个平衡的 {...} 段返回。
 */
export function extractJsonObject(s: string): string {
  const stripped = stripCodeFence(s);
  if (stripped.startsWith("{") || stripped.startsWith("[")) return stripped;
  const start = stripped.indexOf("{");
  if (start < 0) {
    // 模型返回了纯文本，未包含任何 JSON 结构 — 抛特定错误供上层识别并重试
    if (stripped.trim()) {
      throw new Error(
        `模型返回了非 JSON 文本（以 "${stripped.trim().slice(0, 80)}" 开头）。` +
        `这通常表示模型忽略了 JSON 输出指令，直接输出了对话/叙事内容。`,
      );
    }
    return stripped; // 空串照旧返回
  }
  let depth = 0, inStr = false, escape = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === "\"") { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return stripped.slice(start, i + 1);
    }
  }
  return stripped;
}

function schemaToPromptDescription(schema: any): string {
  return `\n\n你必须严格按以下 JSON 结构输出，不输出任何额外文本（不要 markdown 代码块）：\n${JSON.stringify(schema, null, 2)}\n\nrequired 字段必须存在；无值的可选字段使用 null。`;
}

/**
 * 提取 + 预检 JSON：先调用 extractJsonObject 清洗，再 JSON.parse 验证。
 * 验证通过则返回清洗后的 JSON 字符串；失败则将错误抛给上层处理（如重试）。
 */
function extractAndValidate(raw: string): string {
  const extracted = extractJsonObject(raw);
  JSON.parse(extracted); // 预检，失败则抛出
  return extracted;
}

export function humanizeLlmError(e: any): string {
  if (e instanceof LlmHttpError) {
    if (/insufficient_user_quota|额度不足/i.test(e.body)) {
      return "上游 LLM 账户额度不足，请在「虚空连接的设置」里更换 API Key 或为账户充值后重试。";
    }
    if (e.status === 401 || /invalid[_ ]api[_ ]key|incorrect api key/i.test(e.body)) {
      return "API Key 无效或已过期，请在「虚空连接的设置」里检查后重试。";
    }
    if (e.status === 429) {
      return `供应商限流（HTTP 429）：${(e.body || "").slice(0, 200)}`;
    }
    if (e.status >= 500) {
      return `供应商服务异常（HTTP ${e.status}）：${(e.body || "").slice(0, 200)}`;
    }
    return `供应商返回 ${e.status}：${(e.body || "").slice(0, 300)}`;
  }
  const msg: string = e?.message || String(e);
  if (e instanceof SyntaxError && /JSON|Unexpected token/i.test(msg)) {
    return "模型未输出合法 JSON（可能违规吐出了 Markdown 或解释文字）。建议切换到结构化输出更稳定的模型（gemini / claude / gpt-4o 等）后重试。";
  }
  if (/Failed to fetch|NetworkError|TypeError: fetch/i.test(msg)) {
    return "网络请求失败：可能是浏览器无法直连上游 LLM 域名（被墙、被运营商拦截、CORS 被网关阻断等）。如果是 qiny，可在「虚空连接的设置」里把 host 切到 .icu 镜像。";
  }
  return msg;
}

export interface DispatchInput {
  apiSettings: ApiSettings;
  systemInstruction?: string;
  userText?: string;
  prompt?: SegmentedPrompt;
  schema: any;
  temperature: number;
  topP?: number;
  signal?: AbortSignal;
}

export interface LlmChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SegmentedPrompt {
  staticSystem: string;
  history: LlmChatMessage[];
  latestUser: string;
  dynamicRules?: string;
}

/**
 * 一次性调度 LLM 并返回纯 JSON 字符串。调用方 JSON.parse 后再 sanitize。
 *
 * 与服务端原 dispatchLlm 行为对齐：
 * - gemini  → REST: POST /v1beta/models/{model}:generateContent，response_mime_type=application/json + response_schema
 * - anthropic → POST {baseUrl}/v1/messages，Bearer + x-api-key + 官方域加 dangerous-direct-browser-access
 * - 其它（qiny / custom / grok / deepseek）→ POST {baseUrl}/chat/completions，response_format=json_object
 */
export async function dispatchLlm(input: DispatchInput): Promise<string> {
  const { apiSettings, schema, temperature, topP, signal } = input;
  const provider = apiSettings.llm.provider;
  const apiKey = apiSettings.llm.apiKey;
  const model = apiSettings.llm.model;

  if (!apiKey) throw new Error("API Key 未配置：请在「虚空连接的设置」中填入对话 API Key。");
  if (!model) throw new Error("模型未配置：请在「虚空连接的设置」中填入对话模型名。");

  if (provider === "gemini") {
    return dispatchGemini(apiKey, model, input, schema, temperature, topP, apiSettings.llm.customBaseUrl, signal);
  }
  if (provider === "anthropic") {
    return dispatchAnthropic(apiKey, model, input, schema, temperature, topP, apiSettings.llm.customBaseUrl, signal);
  }
  return dispatchOpenAiCompat(provider, apiKey, model, input, schema, temperature, topP, apiSettings.llm.customBaseUrl, apiSettings.llm.qinyHost, signal);
}

function requireLegacyPrompt(input: DispatchInput): { systemInstruction: string; userText: string } {
  if (typeof input.systemInstruction !== "string" || typeof input.userText !== "string") {
    throw new Error("LLM 调用缺少 prompt：需要提供 segmented prompt 或 systemInstruction/userText。");
  }
  return { systemInstruction: input.systemInstruction, userText: input.userText };
}

function formatSessionRules(dynamicRules: string | undefined): string {
  const body = (dynamicRules || "").trim();
  if (!body) return "";
  return [
    "<session_rules>",
    "以下为当前场景的第一方运行时规则与事实。叙事走向以用户最新发言为准；仅当用户请求与硬约束直接冲突时，硬约束优先。",
    body,
    "</session_rules>",
  ].join("\n");
}

function buildLegacyMessages(input: DispatchInput): LlmChatMessage[] {
  const { systemInstruction, userText } = requireLegacyPrompt(input);
  return [
    { role: "system", content: systemInstruction },
    { role: "user", content: userText },
  ];
}

function buildMessagesWithTailSystem(input: DispatchInput): LlmChatMessage[] {
  if (!input.prompt) return buildLegacyMessages(input);
  const messages: LlmChatMessage[] = [
    { role: "system", content: input.prompt.staticSystem },
    ...input.prompt.history,
    { role: "user", content: input.prompt.latestUser },
  ];
  const rules = formatSessionRules(input.prompt.dynamicRules);
  if (rules) {
    messages.push({
      role: "system",
      content:
        rules +
        "\n\n[系统指令] 你必须输出纯 JSON 对象。不要输出任何对话文本、解释或 Markdown。",
    });
  }
  return messages;
}

function buildMessagesWithUserRules(input: DispatchInput): LlmChatMessage[] {
  if (!input.prompt) return buildLegacyMessages(input);
  const rules = formatSessionRules(input.prompt.dynamicRules);
  const latestUser = rules
    ? `${input.prompt.latestUser}\n\n${rules}`
    : input.prompt.latestUser;
  return [
    { role: "system", content: input.prompt.staticSystem },
    ...input.prompt.history,
    { role: "user", content: latestUser },
  ];
}

function splitSystemAndMessages(messages: LlmChatMessage[]): {
  systemInstruction: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systemParts: string[] = [];
  const dialogue: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    const content = message.content.trim();
    if (!content) continue;
    if (message.role === "system") {
      systemParts.push(content);
    } else {
      dialogue.push({ role: message.role, content });
    }
  }
  return { systemInstruction: systemParts.join("\n\n"), messages: mergeAdjacentDialogue(dialogue) };
}

function mergeAdjacentDialogue(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Array<{ role: "user" | "assistant"; content: string }> {
  const merged: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    const prev = merged[merged.length - 1];
    if (prev?.role === message.role) {
      prev.content += `\n\n${message.content}`;
    } else {
      merged.push({ ...message });
    }
  }
  return merged;
}

async function dispatchGemini(
  apiKey: string,
  model: string,
  input: DispatchInput,
  schema: any,
  temperature: number,
  topP: number | undefined,
  customBaseUrl: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const baseUrl = resolveGeminiBaseUrl(customBaseUrl);
  assertSafeBaseUrl(baseUrl);
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const promptMessages = buildMessagesWithUserRules(input);
  const { systemInstruction, messages } = splitSystemAndMessages(promptMessages);
  const body: any = {
    contents: messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
    systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
    generationConfig: {
      temperature,
      responseMimeType: "application/json",
      responseSchema: schema,
      ...(topP !== undefined ? { topP } : {}),
    },
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new LlmHttpError(resp.status, errText);
  }
  const data: any = await resp.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  const raw: string | undefined = Array.isArray(parts)
    ? parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("")
    : undefined;
  if (!raw) throw new Error("Gemini 返回空内容。");
  return extractJsonObject(raw);
}

async function dispatchAnthropic(
  apiKey: string,
  model: string,
  input: DispatchInput,
  schema: any,
  temperature: number,
  topP: number | undefined,
  customBaseUrl: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const baseUrl = resolveAnthropicBaseUrl(customBaseUrl);
  assertSafeBaseUrl(baseUrl);
  const url = `${baseUrl}/v1/messages`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    "Authorization": `Bearer ${apiKey}`,
    "x-api-key": apiKey,
  };
  if (isOfficialAnthropicHost(baseUrl)) {
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  const schemaPrompt = schemaToPromptDescription(schema);
  const promptMessages = buildMessagesWithUserRules(input);
  const { systemInstruction, messages } = splitSystemAndMessages(promptMessages);
  const body: any = {
    model,
    max_tokens: 8192,
    temperature,
    system: systemInstruction + schemaPrompt,
    messages,
    ...(topP !== undefined ? { top_p: topP } : {}),
  };
  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new LlmHttpError(resp.status, errText);
  }
  const data: any = await resp.json();
  const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
  const block = blocks.find((b) => b?.type === "text");
  const raw: string | undefined = typeof block?.text === "string" ? block.text : undefined;
  if (!raw) throw new Error("Anthropic 返回空内容。");
  return extractJsonObject(raw);
}

async function dispatchOpenAiCompat(
  provider: LlmProviderKind,
  apiKey: string,
  model: string,
  input: DispatchInput,
  schema: any,
  temperature: number,
  topP: number | undefined,
  customBaseUrl: string | undefined,
  qinyHost: QinyHostKind | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const baseUrl = resolveOpenAiBaseUrl(provider, customBaseUrl, qinyHost);
  if (!baseUrl) throw new Error(`不支持的供应商：${provider}`);
  assertSafeBaseUrl(baseUrl);
  const url = `${baseUrl}/chat/completions`;
  const schemaPrompt = schemaToPromptDescription(schema);
  const promptMessages = buildMessagesWithTailSystem(input);
  const messages = promptMessages.map((message, idx) => ({
    role: message.role,
    content: idx === 0 && message.role === "system" ? message.content + schemaPrompt : message.content,
  }));
  const body: any = {
    model,
    messages,
    response_format: { type: "json_object" },
    temperature,
    ...(topP !== undefined ? { top_p: topP } : {}),
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new LlmHttpError(resp.status, errText);
  }
  const data: any = await resp.json();
  const raw: string | undefined = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error(`供应商 ${provider} 返回结构异常。`);

  // 预检 JSON 有效性；命中"非 JSON 文本"错误时自动重试一次
  try {
    return extractAndValidate(raw);
  } catch (firstError) {
    if (!(firstError instanceof Error && firstError.message.includes("非 JSON 文本"))) {
      throw firstError;
    }
    // 重试：强 JSON 约束 system 消息 + 低温
    const retryMessages = [
      ...messages.slice(0, -1),
      {
        role: "system" as const,
        content:
          "【重要指令 — 你必须严格遵守】你上一轮回复不是合法 JSON。现在你必须**仅输出一个 JSON 对象**。" +
          "不要输出任何对话文本、解释文字、角色扮演、或 Markdown 代码块。" +
          "你的整个回复必须是可以被 JSON.parse() 直接解析的有效 JSON。如果你再次输出非 JSON 文本，系统将拒绝并报错。",
      },
      messages[messages.length - 1],
    ];
    const retryBody = {
      ...body,
      messages: retryMessages,
      temperature: 0.3,
    };

    const retryResp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(retryBody),
      referrerPolicy: "no-referrer",
      signal,
    });
    if (!retryResp.ok) {
      const errText = await retryResp.text().catch(() => "");
      throw new LlmHttpError(retryResp.status, errText);
    }
    const retryData = await retryResp.json();
    const retryRaw: string | undefined = retryData?.choices?.[0]?.message?.content;
    if (!retryRaw) throw new Error(`供应商 ${provider} 重试返回结构异常。`);
    return extractAndValidate(retryRaw);
  }
}
