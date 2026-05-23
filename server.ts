/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" }));

const DEV_MODE = process.env.NODE_ENV !== "production";
const PORT = 3000;

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
//   1. If IMAGE_PUBLIC_BASE_URL is set in the environment, use it as-is. This
//      is the recommended setup for any deployment that wants generated
//      clue images to remain reachable from other devices/networks.
//   2. Otherwise, derive it from the incoming request's origin so a
//      community user can still run the project on localhost without any
//      configuration. The trade-off is that those URLs only work from the
//      same machine they were generated on.
function resolveImagePublicBaseUrl(req: express.Request): string {
  const fromEnv = (process.env.IMAGE_PUBLIC_BASE_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || `127.0.0.1:${PORT}`;
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
// No id/timestamp here — the client injects those when ingesting.
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
// `dispatchImage` is the provider-routing layer (analogous to `dispatchLlm`):
// it calls the upstream image API and returns the raw payload as `{ b64?, url? }`.
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

// Dynamically load external TRPG rules and settings from user-provided file
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

const SYSTEM_INSTRUCTION = `你是一位专业且极具沉浸感的《克苏鲁的呼唤》第七版（CoC 7th）TRPG 游戏守密人（Keeper / 简称 KP）。你正在主持一场将“克苏鲁神话”、“型月世界观（型月要素：魔术、死徒、教会代行者、根源、守护者等）”和“SCP基金会（收容失效、特工特遣队、异常档案、等级特权等）”完美糅合的硬核、克系、悬疑互动小说跑团。

基本守则：
1. 【游戏角色扮演(KP/NPC)】：在剧情设计和NPC交互中，展示你极高的文学素养和氛围渲染能力。文风应类似爱伦坡、洛夫克拉夫特或奈须蘑菇，阴郁、专业、克制而又充满知性恐怖。
2. 【克苏鲁生态圈多样性】：场景中不要只有无脑的鱼人（深潜者）和丧尸。合理融入星之彩、空鬼、米·戈、古老者、伊斯伟大种族、虚数之物、英灵残存魔术刻印、SCP-173等奇异生命。
3. 【型月与SCP要素融入】：让魔术协会（时钟塔）、圣堂教会与SCP基金会在暗中角力或隐秘协作。克苏鲁古老支配者即为宇宙根源的阴暗侧，魔术秘仪与基金会控制、收容异常的能力相结合。
4. 【客观真实投骰与明暗骰】：KP决不能代玩家或自己随意胡编掷骰判定结果。当玩家行动存在不确定性时，你必须在对应的响应JSON中设置 'rollRequest'（或者是理智方面的 'sanityCheck'），让前端呈现要求玩家手动点击投点按钮并播放动画。而如果是守秘人（Keeper）单独发起的主动性行为检定，或代表敌对NPC、场景环境暗中进行的技能/属性判定（如：怪物潜行、暗中聆听、NPC对玩家隐瞒事实进行心理学对抗等），你必须在对应的响应JSON中设置 'keeperRoll' 对象。你必须指定 'isSecret'（true/false分别代表暗骰和明骰）以及大体判定技能/属性和成功目标。前端拦截后，会专门针对守秘人投点播放自动化精美投骰动画（若是暗骰则不向玩家透露具体骰点与难度结果只表达神秘轰鸣，若是明骰则公开数值），并把客观真实的投点结果追加至上下文供你理直气壮地继续推演叙事，绝不胡扯！

   4.1 【奖励骰 / 惩罚骰由 KP 裁定，玩家不可点单】：CoC 7e 规则下，奖励骰（bonus）和惩罚骰（penalty）的发放权完全归 KP（也就是你）。玩家**不能**主动选择给自己加奖励骰，前端 UI 也不会向玩家提供这个开关。你必须根据当时的处境优势/劣势，在 'rollRequest' 或 'keeperRoll' 中通过 bonus / penalty 字段（取值 0 / 1 / 2）显式下达。
       - 给奖励骰的合理时机：调查员有充裕时间、合适工具、有效的同伴协助（assisted roll）、有利地形、对方处于明显弱势或被束缚等。
       - 给惩罚骰的合理时机：调查员负伤、被催促、能见度差、装备不顺手、半心半意行动、地形/光线等不利条件。
       - **bonus 与 penalty 互斥**：同一次检定不能同时 > 0；若处境同时存在利弊，按规则相互抵消，最终都填 0。
       - **取值上限固定为 0 / 1 / 2**：本项目家规将奖励骰/惩罚骰的净剩余数硬性截断在 2 以内，**不允许下发 3 或更多**。即便处境极端，也只能填 2，超出的优势/劣势请在 narrative 里以氛围/旁白渲染，而不是堆 bonus/penalty 数值。
       - 不要滥发：大多数检定都应当是标准 1d100，bonus/penalty 只在处境明显时使用。不给则填 0（或省略）。

   4.2 【明骰 vs 暗骰判断口径】：判断标准只有一个——"玩家提前知道这次掷骰发生过会不会破坏沉浸/破坏后续叙事张力"。
       - 走暗骰（keeperRoll + isSecret: true）：隐藏的侦查/聆听（让玩家掷会暴露"这里有藏起来的东西没找到"）、潜行被发现判定、被欺瞒方的心理学/识谎、命运豁免、随机遭遇等。**注意 SAN 检定永远走明骰，不要用暗骰**——见 5.1。
       - 走明骰：公开行动的后果检定，玩家本就清楚风险的场景。
       - **暗骰的 reason 字段必须叙事化**：不要写"判断 NPC 是否撒谎"这种机制化描述，改写为氛围/感官描述，如"那双眼睛的某个细节让她隐约感到不对"、"屋内某种细微的气息让他一阵警觉"。前端会把 skillName / targetValue / difficulty / 骰点结果全部打码遮蔽，**只有 reason 会原样展示给玩家**——所以暗骰 reason 一旦泄露技能名或数值就破功了。
       - 暗骰的结果会以"成功 / 失败 / 大成功 / 大失败 / 困难成功 / 极难成功"这样的纯文本形式回传给你；你需要在下一轮 narrative 中**把结果叙事化**地融入剧情（"她什么也没察觉到" / "他后背的寒意更甚了"），而不是直接告诉玩家"暗骰失败"。

   4.3 【玩家技能/属性声明 → KP 裁定】：玩家可能从角色面板预填出"我想用【某技能】(X%) 来…"这样的意图声明。这**只是申报**，不是骰子触发器——前端不会绕过你直接掷骰。你必须按当时情境裁定：
       - 情境合理且结果不确定 → 设置 'rollRequest'，正常召唤掷骰；可在 reason 里采纳玩家描述、也可改写。
       - 玩家选错技能但意图合理 → 不要照单全收技能名，挑更合适的那个发起 'rollRequest'，并在 narrative 中简短解释（如"这种情况下用【聆听】更合适"）。
       - 情境完全不合理（如玩家正在水下却声明用【计算机使用】打开舱门）→ **明确拒绝**，narrative 中以 KP 口吻反驳，不发 rollRequest。允许进入"PL 口胡 vs KP 反驳"的口水战——这是 TRPG 的乐趣，不要怕和玩家辩。
       - 玩家若提出有创意的解释（"我有防水手机+预先配对的舱门蓝牙"）并能自洽，可以让步并发起检定，必要时挂上 penalty 反映难度。
       - 情境可推进但无需骰（小事/必然成功失败）→ 直接叙事推进，narrative 里说明结果，不发 rollRequest。

   4.4 【命运博弈（孤注一掷 / 燃运）：由前端硬规则裁定，KP 只负责叙事化】：玩家在普通技能检定**失败**后，可能主动采取以下两种"补救"动作之一。**判定权与执行权全部归前端**，你不需要决定是否允许、不需要否决——只在收到下列系统标记时，把结果合理地融进叙事：
       - 收到 '[孤注一掷 (Push)] 玩家选择孤注一掷：首投 XX 失败 → 二投 YY → 强制大失败（Fumble）。' 时：**本项目家规——孤注一掷失败统一升格为大失败**。请按 fumble 口径处理，叙事**加重**后果（伤害、暴露、装备损毁、引发更多关注、引来不该来的东西等），不要写成"只是又失败一次"。
       - 收到 '[孤注一掷 (Push)] ... 二投 YY → 真实成功（普通/困难/极难/大成功）。' 时：**保留真实成功等级**，正常按该等级叙事化推进，可以渲染"咬牙再来一次反而抓住了机会"的张力，但不要因为是 push 后的成功就反过来加重负面后果。
       - 收到 '[燃运 (Burn Luck)] 玩家燃烧 N 点幸运，将 XX 改写为普通成功（剩余 LUC = M）。' 时：**本项目家规——燃运只能把失败压到普通成功线，不能升档**。叙事上请描写为"危急关头一闪念的好运 / 命运的眷顾 / 千钧一发的偶然 / 某个不起眼的细节恰好帮了忙"，**不要**写成"凭借扎实的技能功底"——这是命运在还人情，不是调查员能力真的发挥出来了。LUC 已被前端永久扣减，你不需要在 characterUpdates 里再扣 LUC。
       - 命运博弈在**战斗骰、SAN 检定、幸运检定、KP 的 keeperRoll（明骰/暗骰均不允许）** 上前端已硬禁，所以你不会在这些场景下收到上述标记。若玩家在不允许的场景里口头要求"再投一次以救回"，可以在 narrative 里以 KP 口吻说明该场景不可补救（如战斗中已被命中、SAN 冲击已发生），不要给等价的叙事补偿。

   4.5 【伤害与效果骰：带随机性走公式，确定性走整数】：当扣血/扣 MP/扣 SAN 的数值**带随机性**（武器伤害、咒语反噬、急救回血量、大失败附带 SAN 冲击等），用 'characterUpdates.hpDamageFormula' / 'hpHealFormula' / 'mpCostFormula' / 'sanLossFormula' 下发公式字符串（形如 'NdM'、'NdM+常数'、'NdM/除数'，例如 '1d6'、'2d4+1'、'1d10/2'），前端会弹"效果骰"浮窗演投。**确定性**的数值变动（剧情设定的固定 5 点 HP 恢复、定额魔力消耗等）继续用整数字段 'hpChange' / 'mpChange' / 'sanChange'，前端不弹浮窗直接结算。
       - 同一类属性**不要同时**下发整数字段与公式字段（例如不要既给 hpChange 又给 hpDamageFormula）。同时存在时前端按"公式优先"处理。
       - 公式只支持单组骰：'NdM'、'NdM+常数'、'NdM-常数'、'NdM/除数'。**不支持** '1d6+1d4' 这类多组相加，也不支持 keep highest/drop lowest。解析失败前端按 0 处理并把原字符串展示给玩家。
       - sanityCheck 路径已自带 lossOnSuccess / lossOnFailure，**不要**在 sanityCheck 触发的同一回合再下发 sanLossFormula——后者只在大失败/特殊叙事强制扣 SAN 时使用。
       - 伤害骰由玩家自己掷（项目家规：演出感优先），KP 不要在 narrative 里直接报数（如"扣 4 点 HP"），让 narrative 描写感官冲击，把数值交给公式字段。
5. 【理智检定(Sanity Check)】：当玩家直面不可名状神秘、骇人血腥、死徒行径或SCP模因时，必须且仅能通过设置 'sanityCheck' 对象来发起理智检定，并规定成功/失败分别减去多少理智（如成功减0，失败减1d6）。
   5.1 【SAN 检定不可回避】：CoC 7e 规则下，理智冲击是因果上"已发生"的事——只要你触发了 sanityCheck，前端会**强制弹出 modal、禁用聊天输入、禁用角色面板的意图声明**，玩家**不能取消、不能跳过**，必须立即掷骰。所以：
       - 不要轻易触发 SAN 检定。只在调查员**确实已经看到/听到/接触到**冲击源时触发。"可能会瞥到"这种暧昧场景请在 narrative 里描写，不要直接发 sanityCheck。
       - 触发时 'reason' 字段要写**已感知**事实，如"她看清了祭坛后那张面孔"、"他听见地板下传来的咀嚼声"，不要写"如果她抬头会看到..."这种条件式。
       - 如果你希望给玩家"捂眼/转身"的窗口，就在前一回合 narrative 里铺垫感官前兆（异味、温度、声响），由玩家声明回避动作；只有当玩家**没有声明回避**或回避失败时，下一回合才发 sanityCheck。
       - SAN 检定**永远是明骰**：玩家自己投，自己看到结果。要触发暗骰用 'keeperRoll'，不要用 'sanityCheck'。
6. 【线索登记的严格条件 — clue 字段】：'clue' 是写入**调查笔记本**的永久档案条目，是玩家"破案凭据"的一部分。**不是**每轮叙事都该出现，**也不是**任何"场景里看到的东西"都能塞进去。**只能**在以下两种情境下设置 'clue'：
       - **A. 调查行动成功的产物**：玩家**主动声明**了调查/搜寻/翻找/解读/聆听等行为，并且**对应的 rollRequest / keeperRoll 已经返回成功结果**（regular / hard / extreme / critical），且这次成功**确实找到了对剧情有意义的信息**。失败 / fumble / 没有信息价值的成功 → 不发 clue。
       - **B. 玩家获得了重要道具/文档**：玩家从 NPC 处接收、在场景中拾取、或从容器中取出**对推进剧情有意义的实物**（密信、密钥、徽章、日记本、奇怪的小物件等），实物在叙事上已经**进入玩家的持有状态**。仅仅"看到桌上有一封信"不算获得，必须有"她把信收进了口袋"这类显式的获取动作。
       - **不要发 clue 的情况**（重要）：场景里随口提到的视觉元素（墙上的画、远处的灯塔、墙缝里渗出的某种印迹）、NPC 的外貌特征、玩家路过看到的环境氛围、玩家**还没触发判定**的"可能可调查"对象，都**不应**直接登记成线索——这些应该通过 'sceneImage'（见 6.1）或纯 narrative 描写来表现，由玩家决定是否主动调查。
       - 'type' 用 'note' / 'photo' / 'marking' / 'book' / 'artifact' 之一标记其物理形态。
   6.1 【对话内即兴视觉占位 — sceneImage 字段】：当场景里出现**值得让玩家"看到"但又不构成已登记线索**的视觉元素（远处墙上的诡异符号、桌面摊开的旧照片、地板裂缝里的奇怪刻痕、橱窗里的异常展品等）时，使用 'sceneImage' 字段在聊天里**单独起行**生成一张**图像占位卡**。玩家点击"显示图像"按钮才会真正调用画图模型，**展开图像后**可点击"收录线索"将该图正式登入调查笔记本。
       - 触发口径：场景里出现的**直观可见**的视觉元素，且**该元素具有调查价值但玩家尚未主动调查它**。它是"勾子"，不是"档案"。
       - 'caption' 写**简短的一句话**，描述图像中看到的东西（如"祭坛石板上深刻的螺旋符号"、"墙角散落的褪色照片"），玩家会在聊天里直接看到。
       - 'type' 与 clue 的 type 同枚举（'note' / 'photo' / 'marking' / 'book' / 'artifact'），表示这张图所表现的物理形态——玩家"收录线索"时会沿用。
       - 'prompt' 必填，富含暗黑写实、克苏鲁色调质感的极详细英文描述（与 clue.prompt 同标准）。**没有可省略画的内容 → 不要发 sceneImage**。
       - **不要同回合既发 clue 又发 sceneImage** 描述同一对象；二者择一：已通过调查/获取成为档案 → clue；尚未调查、只是场景中可见 → sceneImage。
   6.2 【clue.prompt 字段——按需配图，不要滥配】：'clue.prompt' 是**可选**字段，控制该线索能否生成插图。请按以下规范取舍：
       - **必须配 prompt**（描述无法替代视觉细节的条目）：神秘符号 / 法阵 / 印记（'marking'）、照片或影像（'photo'）、非常规物品 / 异常器物 / 徽章（'artifact'），以及虽然分类为 'note' / 'book' 但**正文里出现了图示、印章、血迹涂鸦、机关刻纹、人脸素描等需要"看到"才能理解的视觉细节**的特殊条目。
       - **省略 prompt**（description 已经把内容完整讲清楚）：普通手写笔记、信件、电报、剪报、日记摘录、机密档案条文等**纯文字内容**的 'note' / 'book'。这类条目玩家读 description 即可,**不要硬塞 prompt**——多余的插图会让调查节奏变拖沓。
       - 判断口径：合上眼睛只听 description 念出来，玩家能否完整理解这条线索？能 → 省略 prompt；不能（必须看见才知道写了什么 / 画了什么 / 长什么样）→ 配 prompt。
       - 配 prompt 时仍按原规范：富含暗黑写实、克苏鲁色调质感的极详细英文描述。
7. 【初始模组与角色创建】：如果接到新游戏启动指令或这是最初的信息，你必须在 narrative 中向玩家介绍CoC规则、型月+基金会混搭的世界设定，并引导他们：
    - 选择模组背景时代：现代 或 1920年代，并对这两者的氛围在剧中做出简单气氛介绍。
    - 选择提供的 3 个预设调查员（预设卡：包含名字、年龄、职业和关键技能分配、属性分配等。比如：时钟塔魔术研究员、SCP基金会第4层级外勤特工、大学考古教授），或者自定义一位调查员。并将 gameState 设定为 Location "游戏准备室"。

记住：你的所有输出必须遵循 Response Schema 定义的严格 JSON 结构，绝不能夹杂任何多余的 JSON 外文本（如 Markdown 的 \`\`\`json 标记以外的额外唠叨）。`;

const KEEPER_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    narrative: { type: Type.STRING, description: "KP的场景旁白、周围氛围描写、不可名状感受。支持Markdown排版（加粗、列表、斜体）来使得叙事更加惊艳、排版舒适。必须包含完整的旁白与局势描写。不能留空。" },
    rollRequest: {
      type: Type.OBJECT,
      properties: {
        skillName: { type: Type.STRING, description: "需要检定的属性或技能名称（例如：侦查, 聆听, 神秘学, 心理学, 意志, 力量, 说服, 敏捷等）" },
        targetValue: { type: Type.INTEGER, description: "根据玩家卡片或规则，角色应该满足的该技能/属性的最大成功目标值（一般在 1-99 之间，包含该数值）" },
        difficulty: { type: Type.STRING, description: "检定难度等级，必须是 'regular' (常规成功即可), 'hard' (必须要困难成功, 即 <= 技能的一半), 'extreme' (必须要极难成功, 即 <= 技能的五分之一) 之一" },
        reason: { type: Type.STRING, description: "进行此检定的原因描述。例如：在书房的杂乱字迹中翻找关于型月魔术回路的隐秘记录" },
        bonus: { type: Type.INTEGER, description: "守密人裁定的奖励骰数量，取值**必须**是 0、1 或 2 之一。处境对调查员明显有利（充裕时间、合适工具、同伴有效协助、有利地形等）时给出。与 penalty 互斥；不给则填 0。**禁止下发 3 或更大**——前端会硬裁剪到 2。" },
        penalty: { type: Type.INTEGER, description: "守密人裁定的惩罚骰数量，取值**必须**是 0、1 或 2 之一。处境对调查员明显不利（负伤、被催促、能见度差、装备不顺、半心半意行动等）时给出。与 bonus 互斥；不给则填 0。**禁止下发 3 或更大**——前端会硬裁剪到 2。" }
      },
      required: ["skillName", "targetValue", "difficulty", "reason"],
      description: "如果当前的玩家意图或遭遇触发了技能/属性检定需求，将其填充，这将在前端拦截并让玩家进行双十面骰动画掷骰。无则设为 null。"
    },
    sanityCheck: {
      type: Type.OBJECT,
      properties: {
        lossOnSuccess: { type: Type.STRING, description: "掷骰成功时损失的San度（例如：'0', '1', '1d2', '1d3'）" },
        lossOnFailure: { type: Type.STRING, description: "掷骰失败时损失的San度（例如：'1d4', '1d6', '1d10', '1d20', '3d6'）" },
        reason: { type: Type.STRING, description: "引发理智惊悚和狂乱冲击的原因。" }
      },
      required: ["lossOnSuccess", "lossOnFailure", "reason"],
      description: "如果场景事件激发了玩家的San值惊心时刻，将其填充。无则设为 null。"
    },
    clue: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "线索的简要标题" },
        type: { type: Type.STRING, description: "物品类别，必须是 'note', 'photo', 'marking', 'book', 'artifact' 之一" },
        description: { type: Type.STRING, description: "对该线索记录的内容描述。" },
        prompt: { type: Type.STRING, description: "可选。仅当线索含有 description 无法替代的视觉细节（符号、照片、异常器物、文书上的图示/印章等）时，提供供 AI 画图模型使用的极详细英文提示词；纯文字 note/book 请省略本字段。" }
      },
      required: ["title", "type", "description"],
      description: "线索档案条目，仅在玩家调查行动成功且产出有价值信息、或玩家明确获得重要道具/文档时填写。详见系统提示规则 6。普通场景描写或玩家尚未调查的视觉勾子请用 sceneImage 而非本字段。无则设为 null。"
    },
    sceneImage: {
      type: Type.OBJECT,
      properties: {
        caption: { type: Type.STRING, description: "一句话描述该图像内容（如\"祭坛石板上深刻的螺旋符号\"、\"墙角散落的褪色照片\"）。玩家会在聊天卡片里直接看到这句话。" },
        type: { type: Type.STRING, description: "图像所表现物体的物理形态，与 clue.type 同枚举，必须是 'note', 'photo', 'marking', 'book', 'artifact' 之一。玩家点击\"收录线索\"时会沿用该 type。" },
        prompt: { type: Type.STRING, description: "供 AI 画图模型使用的极详细英文提示词，富含暗黑写实、克苏鲁色调质感。沒有可画内容则不要发本字段。" }
      },
      required: ["caption", "type", "prompt"],
      description: "对话中即兴的视觉占位卡：场景里出现值得让玩家\"看到\"但尚未构成档案线索的视觉元素时使用（远处的符号、桌上的照片、奇怪的刻痕等）。前端将以单独起行的\"显示图像\"按钮卡呈现，玩家点击后才请求画图；展开后可一键\"收录线索\"。**不要**同回合既发 clue 又发 sceneImage 描述同一对象。无则设为 null。"
    },
    characterUpdates: {
      type: Type.OBJECT,
      properties: {
        hpChange: { type: Type.INTEGER, description: "确定性的生命变动(整数)。仅用于剧情设定的固定值,如固定 5 点恢复。带随机性时改用 hpDamageFormula / hpHealFormula。" },
        mpChange: { type: Type.INTEGER, description: "确定性的魔法值变动(整数)。带随机性时改用 mpCostFormula。" },
        sanChange: { type: Type.INTEGER, description: "确定性的 San 值强制变动(整数)。带随机性时改用 sanLossFormula(且独立于 sanityCheck 路径)。" },
        sanitySkillGain: { type: Type.INTEGER, description: "永久提升的克苏鲁神话技能点。" },
        hpDamageFormula: { type: Type.STRING, description: "玩家受伤的伤害公式,形如 'NdM[+常数][/除数]'(例:'1d6'、'2d4+1'、'1d10/2')。前端会弹效果骰浮窗演投。与 hpChange 互斥;同时下发时前端按公式优先。" },
        hpHealFormula: { type: Type.STRING, description: "急救/医学等治疗公式,正向回血,例 '1d3'。前端弹效果骰浮窗。与 hpChange(正向部分)互斥。" },
        mpCostFormula: { type: Type.STRING, description: "魔法反噬等魔力消耗公式,例 '1d4'。前端弹效果骰浮窗。与 mpChange(消耗部分)互斥。" },
        sanLossFormula: { type: Type.STRING, description: "大失败叙事附带的强制 SAN 损失公式,例 '1d6'。独立于 sanityCheck 路径(后者已自带 lossOnSuccess/lossOnFailure)。前端弹效果骰浮窗。与 sanChange(负向部分)互斥。" }
      },
      description: "由当前非掷骰的突发剧情直接引发的属性指标变化。同类属性的整数字段与 *Formula 字段二选一下发(详见各字段说明)。无则设为 null。"
    },
    npcDialogue: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "NPC名字" },
        text: { type: Type.STRING, description: "NPC台词" }
      },
      required: ["name", "text"],
      description: "NPC说话台词。无则设为 null。"
    },
    keeperRoll: {
      type: Type.OBJECT,
      properties: {
        skillName: { type: Type.STRING, description: "守秘人方需要检定的技能或属性名称" },
        targetValue: { type: Type.INTEGER, description: "目标胜出条件所需的上限属性成功限度值（1-99之间）" },
        difficulty: { type: Type.STRING, description: "判定难度级别，'regular', 'hard', 'extreme' 之一" },
        isSecret: { type: Type.BOOLEAN, description: "是否暗骰。判定原则：玩家若提前知道掷骰发生过会破坏沉浸（隐藏的侦查/聆听、潜行被发现判定、被欺瞒方的心理学、揭露恐怖前的SAN等）→ 暗骰；公开后果且玩家应直接看到的 → 明骰" },
        reason: { type: Type.STRING, description: "原因。暗骰时务必写得叙事化、避免暴露机制（不要提技能名/数值/难度），可以表达氛围（如：'某个细节让她后背一阵发凉'）" },
        bonus: { type: Type.INTEGER, description: "守密人裁定的奖励骰数量，取值**必须**是 0、1 或 2 之一。与 penalty 互斥；不给则填 0。**禁止下发 3 或更大**——前端会硬裁剪到 2。" },
        penalty: { type: Type.INTEGER, description: "守密人裁定的惩罚骰数量，取值**必须**是 0、1 或 2 之一。与 bonus 互斥；不给则填 0。**禁止下发 3 或更大**——前端会硬裁剪到 2。" }
      },
      required: ["skillName", "targetValue", "difficulty", "isSecret", "reason"],
      description: "守秘人需要替非玩家动作进行客观判定时填写。无则设为 null。"
    },
    gameState: {
      type: Type.OBJECT,
      properties: {
        moduleName: { type: Type.STRING, description: "当前模组名称" },
        currentLocation: { type: Type.STRING, description: "当前场景" }
      },
      required: ["moduleName", "currentLocation"],
      description: "状态同步数据，必须返回最新状态。"
    }
  },
  required: ["narrative", "gameState"]
};

const GENERATE_MODULE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "模组标题" },
    intro: { type: Type.STRING, description: "150-250字氛围引子" },
    recommendedOccupations: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "推荐3-4个PC职业"
    },
    presets: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "调查员姓名，仅中文汉字，禁止任何英文译名、括号注音或拼音" },
          occupation: { type: Type.STRING, description: "职业" },
          gender: { type: Type.STRING, description: "男 或 女" },
          age: { type: Type.INTEGER, description: "年龄 23-55" },
          overview: { type: Type.STRING, description: "100-150字概述" },
          attributes: {
            type: Type.OBJECT,
            properties: {
              str: { type: Type.INTEGER }, con: { type: Type.INTEGER }, siz: { type: Type.INTEGER },
              dex: { type: Type.INTEGER }, app: { type: Type.INTEGER }, int: { type: Type.INTEGER },
              pow: { type: Type.INTEGER }, edu: { type: Type.INTEGER }, luck: { type: Type.INTEGER }
            },
            required: ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"]
          },
          skills: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                value: { type: Type.INTEGER }
              },
              required: ["name", "value"]
            },
            description: "正好8~9门核心技能"
          }
        },
        required: ["name", "occupation", "gender", "age", "overview", "attributes", "skills"]
      },
      description: "正好3个预设调查员"
    }
  },
  required: ["title", "intro", "recommendedOccupations", "presets"]
};

const GENERATE_STATS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING, description: "调查员中文姓名，仅汉字，禁止任何英文译名、括号注音或拼音" },
    occupation: { type: Type.STRING, description: "职业" },
    attributes: {
      type: Type.OBJECT,
      properties: {
        str: { type: Type.INTEGER }, con: { type: Type.INTEGER }, siz: { type: Type.INTEGER },
        dex: { type: Type.INTEGER }, app: { type: Type.INTEGER }, int: { type: Type.INTEGER },
        pow: { type: Type.INTEGER }, edu: { type: Type.INTEGER }, luck: { type: Type.INTEGER }
      },
      required: ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"]
    },
    skills: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING }, value: { type: Type.INTEGER } },
        required: ["name", "value"]
      },
      description: "5-8个核心技能"
    }
  },
  required: ["name", "occupation", "attributes", "skills"]
};

/**
 * Render a Gemini-style schema as a Markdown JSON description that
 * non-Gemini providers can follow via `response_format: json_object`.
 */
function schemaToPromptDescription(schema: any): string {
  return `\n\n你必须严格按以下 JSON 结构输出，不输出任何额外文本（不要 markdown 代码块）：\n${JSON.stringify(schema, null, 2)}\n\nrequired 字段必须存在；无值的可选字段使用 null。`;
}

interface DispatchInput {
  apiSettings: ApiSettings;
  systemInstruction: string;
  userText: string;
  schema: any;
  temperature: number;
  topP?: number;
  onLog?: LogPush;
}

async function dispatchLlm({ apiSettings, systemInstruction, userText, schema, temperature, topP, onLog }: DispatchInput): Promise<string> {
  const log = onLog ?? NOOP_LOG;
  const provider = apiSettings.llm.provider;
  const apiKey = apiSettings.llm.apiKey;
  const model = apiSettings.llm.model;

  if (!apiKey) throw new Error("API Key 未配置：请在`虚空连接的设置`中填入对话 API Key。");
  if (!model) throw new Error("模型未配置：请在`虚空连接的设置`中填入对话模型名。");

  log({
    direction: "request",
    content: `LLM ${provider} ${model}`,
    meta: {
      provider, model, temperature, topP,
      systemInstructionLen: systemInstruction.length,
      userTextLen: userText.length,
      userTextPreview: previewText(userText),
      systemInstructionPreview: previewText(systemInstruction)
    }
  });
  const t0 = Date.now();

  try {
    let text: string;

    if (provider === "gemini") {
      const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { "User-Agent": "aistudio-build" } } });
      const response = await ai.models.generateContent({
        model,
        contents: userText,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature,
          ...(topP !== undefined ? { topP } : {})
        }
      });
      const raw = response.text;
      if (!raw) throw new Error("Gemini 返回空内容。");
      text = raw;
    } else if (provider === "anthropic") {
      const client = new Anthropic({ apiKey });
      const schemaPrompt = schemaToPromptDescription(schema);
      const msg = await client.messages.create({
        model,
        max_tokens: 8192,
        temperature,
        system: systemInstruction + schemaPrompt,
        messages: [{ role: "user", content: userText }]
      });
      const block = msg.content.find((b: any) => b.type === "text") as any;
      if (!block?.text) throw new Error("Anthropic 返回空内容。");
      text = stripCodeFence(block.text);
    } else {
      // OpenAI 兼容: qiny, custom, grok, deepseek
      const baseUrl = resolveOpenAiBaseUrl(provider, apiSettings.llm.customBaseUrl, apiSettings.llm.qinyHost);
      if (!baseUrl) throw new Error(`不支持的供应商：${provider}`);
      const schemaPrompt = schemaToPromptDescription(schema);
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemInstruction + schemaPrompt },
            { role: "user", content: userText }
          ],
          response_format: { type: "json_object" },
          temperature,
          ...(topP !== undefined ? { top_p: topP } : {})
        })
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`供应商 ${provider} 返回 ${resp.status}：${errText.slice(0, 500)}`);
      }
      const data: any = await resp.json();
      const raw: string | undefined = data?.choices?.[0]?.message?.content;
      if (!raw) throw new Error(`供应商 ${provider} 返回结构异常。`);
      text = stripCodeFence(raw);
    }

    log({
      direction: "response",
      content: `LLM ${provider} ${model} → ${text.length} chars`,
      meta: { durationMs: Date.now() - t0, charsOut: text.length, outputPreview: previewText(text) }
    });
    return text;
  } catch (e: any) {
    const isFetchFailed = e?.message === "fetch failed" || e?.name === "TypeError";
    const friendly = isFetchFailed
      ? humanizeFetchError(e, { what: `LLM 供应商 ${provider}` })
      : (e?.message || String(e));
    log({
      direction: "error",
      content: `LLM ${provider} ${model} 失败`,
      meta: {
        durationMs: Date.now() - t0,
        error: friendly,
        rawError: e?.message || String(e),
        causeCode: e?.cause?.code,
        causeHost: e?.cause?.hostname,
      }
    });
    if (isFetchFailed) {
      const wrapped = new Error(friendly);
      (wrapped as any).cause = e;
      throw wrapped;
    }
    throw e;
  }
}

function stripCodeFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
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

function buildKeeperContext(messages: Array<{ sender: string; text: string }>): string {
  return messages.map((m) => {
    const role = m.sender === "keeper" ? "[守秘人]" : m.sender === "system" ? "[系统]" : "[玩家]";
    return `${role} ${m.text}`;
  }).join("\n\n");
}

// Guardrail: LLM 偶尔会无视提示词下发 bonus/penalty = 3+ (来自注入文档里"净剩余 3 个惩罚骰"
// 等模糊措辞的诱导)。前端 RollDiceModal 直接信任该值,会摇额外十位骰,破坏奖励/惩罚骰规则。
// 这里做最后一道兜底:把 rollRequest 和 keeperRoll 上的 bonus/penalty 硬截断到 [0, 2]。
function clampBonusPenalty(req: any) {
  if (!req || typeof req !== "object") return;
  for (const k of ["bonus", "penalty"] as const) {
    const v = req[k];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    req[k] = Math.max(0, Math.min(2, Math.floor(v)));
  }
}

function sanitizeKeeperResponse(data: any) {
  if (!data || typeof data !== "object") return;
  clampBonusPenalty(data.rollRequest);
  clampBonusPenalty(data.keeperRoll);
}

// 1. API - Keeper Chat Completion
app.post("/api/keeper/chat", async (req, res) => {
  const { messages, features, apiSettings } = req.body;
  const logs: ServerLogDraft[] = [];
  const push: LogPush = (e) => logs.push(e);

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Messages array is required.", _serverLogs: logs });
  }
  if (!apiSettings) {
    return res.status(400).json({ error: "缺少 apiSettings：请先完成`虚空连接的设置`。", _serverLogs: logs });
  }

  const tmEnabled = features?.typemoon !== false;
  const scpEnabled = features?.scp !== false;

  try {
    const dynamicInstructions = getDynamicInstructions();
    let elementSandboxLimiter = "\n\n=== [内容模块载入与核心要素限制规范] ===\n";
    if (!tmEnabled && !scpEnabled) {
      elementSandboxLimiter += "🚩玩家已开启【经典CoC纯净跑团模式】。绝不可提及型月或SCP相关任何概念。\n";
    } else {
      elementSandboxLimiter += `1. 【型月要素：${tmEnabled ? "已载入" : "未载入"}】\n`;
      elementSandboxLimiter += `2. 【SCP要素：${scpEnabled ? "已载入" : "未载入"}】\n`;
    }

    const systemInstruction = SYSTEM_INSTRUCTION + dynamicInstructions + elementSandboxLimiter;
    const userText = buildKeeperContext(messages);

    push({ direction: "info", content: `/api/keeper/chat ← ${messages.length} messages`, meta: { msgCount: messages.length, tmEnabled, scpEnabled } });

    const textOutput = await dispatchLlm({
      apiSettings,
      systemInstruction,
      userText,
      schema: KEEPER_RESPONSE_SCHEMA,
      temperature: 0.85,
      topP: 0.95,
      onLog: push
    });

    const parsed = JSON.parse(textOutput);
    sanitizeKeeperResponse(parsed);
    return res.json({ success: true, data: parsed, _serverLogs: logs });
  } catch (error: any) {
    console.error("API Error in /api/keeper/chat:", error);
    push({ direction: "error", content: `/api/keeper/chat 失败`, meta: { error: error.message || "Unknown error" } });
    return res.status(500).json({ error: error.message || "Unknown error", details: error.stack, _serverLogs: logs });
  }
});

// 2. API - Generate Clue Photo (thin wrapper over generateImageAndPublish)
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

// 3. API - Generate CoC Module Outline
app.post("/api/keeper/generate-module-outline", async (req, res) => {
  const { era, typemoon, scp, apiSettings } = req.body;
  const logs: ServerLogDraft[] = [];
  const push: LogPush = (e) => logs.push(e);

  if (!apiSettings) return res.status(400).json({ error: "缺少 apiSettings。", _serverLogs: logs });
  const tmEnabled = typemoon !== false;
  const scpEnabled = scp !== false;
  const is1920s = era === "1920s";
  const eraStr = is1920s ? "1920年代爵士旧日" : "21世纪现代霓虹与高墙";

  try {
    let elementsRule = "";
    if (!tmEnabled && !scpEnabled) {
      elementsRule = "⚠️【极严格约束：经典CoC纯净跑团模式】绝不允许提及型月或SCP要素。";
    } else {
      elementsRule += tmEnabled ? "1. 【型月要素已开启】可融合时钟塔魔术等。\n" : "1. 【型月要素已禁用】绝不可提及。\n";
      elementsRule += scpEnabled ? "2. 【SCP要素已开启】可融合MTF、收容站等。\n" : "2. 【SCP要素已禁用】绝不可提及。\n";
    }

    const userText = `玩家选择的历史帷幕/背景纪元为："${eraStr}"。\n\n系统内容配置协议：\n${elementsRule}\n\n请构思一个独特的CoC TRPG 模组：标题、150-250字引子、3-4个推荐PC职业、正好3个预设调查员（每人正好8~9门核心技能）。所有调查员姓名只能使用纯中文汉字，禁止出现任何英文译名、括号注音、拼音或外文别称。`;
    const systemInstruction = "你是一个殿堂级的克苏鲁TRPG（CoC 7e）跑团守密人与顶尖文学构架师。";

    push({ direction: "info", content: `/api/keeper/generate-module-outline ← ${eraStr}`, meta: { era, tmEnabled, scpEnabled } });

    const textOutput = await dispatchLlm({
      apiSettings, systemInstruction, userText,
      schema: GENERATE_MODULE_SCHEMA, temperature: 0.85,
      onLog: push
    });
    const parsed = JSON.parse(textOutput);
    return res.json({ success: true, data: parsed, _serverLogs: logs });
  } catch (error: any) {
    console.error("API Error in /api/keeper/generate-module-outline:", error);
    push({ direction: "error", content: `/api/keeper/generate-module-outline 失败`, meta: { error: error.message || "Unknown error" } });
    return res.status(500).json({ error: error.message || "Unknown error", details: error.stack, _serverLogs: logs });
  }
});

// 3.5. API - Objective Dice roll via NyaaChat-MCP (unchanged, no LLM)
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
  const mcpUrl = "http://h.hony-wen.com:3094/mcp";

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
  if (diceResult === 1) outcome = "大成功";
  else if (skillVal < 50 && diceResult === 100) outcome = "大失败";
  else if (skillVal >= 50 && diceResult >= 96) outcome = "大失败";
  else if (diceResult <= Math.floor(skillVal / 5)) outcome = "极难成功";
  else if (diceResult <= Math.floor(skillVal / 2)) outcome = "困难成功";
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

// 3.6. API - NyaaChat-MCP liveness probe
//   GET /api/mcp/status → { ok: boolean, reason?: string }
//   The frontend Settings panel uses this to render a green/grey status dot.
app.get("/api/mcp/status", async (_req, res) => {
  const mcpUrl = "http://h.hony-wen.com:3094/mcp";
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

// 4. API - Generate CoC Stats from description
app.post("/api/keeper/generate-stats", async (req, res) => {
  const { description, era, name, apiSettings } = req.body;
  if (!description) return res.status(400).json({ error: "角色概述 (description) 为必填项。" });
  if (!apiSettings) return res.status(400).json({ error: "缺少 apiSettings。" });

  const logs: ServerLogDraft[] = [];
  const push: LogPush = (e) => logs.push(e);
  push({ direction: "info", content: `POST /api/keeper/generate-stats`, meta: { era, name: name || undefined, descPreview: previewText(description, 160) } });

  try {
    const userText = `根据玩家提供的角色故事或概述："${description}"\n姓名（若有）："${name || ''}"\n时代背景为："${era === '1920s' ? '1920年代' : '21世纪现代'}"\n\n请依据《克苏鲁的呼唤》第七版设定，为该角色生成属性（八维 15-99）和 5-8 个核心技能（值 20-95）。若玩家未提供姓名，请仅使用纯中文汉字为其命名（不要附加任何英文译名、括号注音、拼音或外文别称）。`;
    const systemInstruction = "你是一个专业的《克苏鲁的呼唤》第七版TRPG跑团角色卡智脑。";

    const textOutput = await dispatchLlm({
      apiSettings, systemInstruction, userText,
      schema: GENERATE_STATS_SCHEMA, temperature: 0.7,
      onLog: push,
    });
    const parsed = JSON.parse(textOutput);
    return res.json({ success: true, data: parsed, _serverLogs: logs });
  } catch (error: any) {
    console.error("API Error in /api/keeper/generate-stats:", error);
    push({ direction: "error", content: `generate-stats failed: ${error?.message ?? "unknown"}`, meta: { message: error?.message } });
    return res.status(500).json({ error: error.message || "Unknown error", details: error.stack, _serverLogs: logs });
  }
});

// 5. API - List models for a provider+key (proxy)
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
