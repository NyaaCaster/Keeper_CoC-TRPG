/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface CharacterAttributes {
  str: number; // 力量
  con: number; // 体质
  siz: number; // 体型
  dex: number; // 敏捷
  app: number; // 外貌
  int: number; // 智力
  pow: number; // 意志
  edu: number; // 教育
  luck: number; // 幸运
}

export interface CharacterSkills {
  [key: string]: number; // Skill Name -> Percentage Value
}

export interface CharacterSheet {
  name: string;
  occupation: string; // 职业 (魔术研究员, 基金会特工, 考古学者等)
  gender: string;     // 性别
  age: number;        // 年龄
  background: "1920s" | "modern";
  attributes: CharacterAttributes;
  skills: CharacterSkills;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  san: number;
  maxSan: number;
  maxSanLimit: number; // 99 - 克苏鲁神话
  mythos: number; // 克苏鲁神话技能
  avatar?: string; // 角色头像 (Base64 data URI)
  backgroundStory?: string; // 调查员背景介绍/生平概述
}

export interface ClueItem {
  id: string;
  title: string;
  type: "note" | "photo" | "marking" | "book" | "artifact";
  description: string;
  imageUrl?: string;
  prompt: string;
  discoveredAt: string; // timestamp or scene name
  read?: boolean;
}

export interface RollRequest {
  skillName: string;
  targetValue: number;
  difficulty: "regular" | "hard" | "extreme";
  reason: string;
  isKeeperRoll?: boolean;
  isSecret?: boolean;
  bonus?: 0 | 1 | 2;
  penalty?: 0 | 1 | 2;
  /**
   * 测试模式 sentinel — 仅由 [sys_test] 测试命令注入。
   * 存在即代表本次掷骰：
   *   - 跳过 /api/keeper/roll 调用，强制走前端兜底；
   *   - 完成后不回报 KP，不改变角色任何属性，不写入消息流；
   *   - 若 `total` / `successType` 给出，覆盖兜底骰的随机结果。
   */
  testForce?: {
    total?: number;
    successType?: RollResult["successType"];
    /**
     * 全链路测试 sentinel — 仅由 [sys_test] 测试命令注入。
     * 判定 modal 演完后,前端 onComplete 短路分支会按此描述自动推一个 pendingEffectRoll,
     * 用于"判定→效果"二阶段动画的端到端演练。测试模式下不真扣属性,只演动画+浮字。
     */
    chainEffect?: {
      kind: "damage" | "heal" | "mpCost" | "sanLoss";
      formula: string;
    };
  };
}

export interface KeeperRollRequest {
  skillName: string;
  targetValue: number;
  difficulty: "regular" | "hard" | "extreme";
  isSecret: boolean;
  reason: string;
  bonus?: 0 | 1 | 2;
  penalty?: 0 | 1 | 2;
}

export interface SanityCheckRequest {
  lossOnSuccess: string; // e.g., "0" or "1" or "1d3"
  lossOnFailure: string; // e.g., "1d6" or "1d10"
  reason: string;
}

export interface RollResult {
  dice10: number; // e.g. 40 (00-90)
  dice1: number;  // e.g. 2 (0-9)
  total: number;  // 1 - 100
  targetValue: number;
  isBonus?: boolean;
  isPenalty?: boolean;
  successType: "critical" | "extreme" | "hard" | "regular" | "failure" | "fumble";
  /** 命运博弈：是否经过孤注一掷二投 */
  pushed?: boolean;
  /** 命运博弈：孤注一掷二投失败后被强制升格为大失败 */
  pushForcedFumble?: boolean;
  /** 命运博弈：本次判定燃烧的幸运点数（>0 即代表使用了燃运） */
  luckSpent?: number;
}

export interface KeeperResponse {
  narrative: string; // The Keeper's narration text using Markdown
  rollRequest?: RollRequest | null;
  keeperRoll?: KeeperRollRequest | null;
  sanityCheck?: SanityCheckRequest | null;
  clue?: {
    title: string;
    type: "note" | "photo" | "marking" | "book" | "artifact";
    description: string;
    prompt: string;
  } | null;
  characterUpdates?: {
    hpChange?: number;
    mpChange?: number;
    sanChange?: number;
    sanitySkillGain?: number;

    /**
     * 二阶段投骰的"效果公式"字段族 — 详见 .docs/two-stage-roll.md。
     * 与上方的整数字段**互斥共存**:同类属性二选一下发,前端按"公式优先"处理。
     * 公式形如 NdM[+const][/divisor],含随机性时弹 EffectRollModal,纯数字/0 同步结算。
     */
    /** 玩家受伤,例 "1d6+1" / "2d4" */
    hpDamageFormula?: string;
    /** 急救/医学治疗,例 "1d3" */
    hpHealFormula?: string;
    /** 魔法反噬等魔力消耗,例 "1d4" */
    mpCostFormula?: string;
    /** 大失败叙事附带的强制 SAN 损失,例 "1d6"。独立于 sanityCheck 路径。 */
    sanLossFormula?: string;
  } | null;
  npcDialogue?: {
    name: string;
    text: string;
  } | null;
  gameState?: {
    moduleName: string;
    currentLocation: string;
  } | null;
}

export interface WebGameSave {
  id: string; // The saveId, e.g. "save_16881881"
  moduleName: string; // From gameState
  timestamp: string; // YYYYMMDDhhmmss formatted date
  lastUpdated: number; // For sorting
  messages: ChatMessage[];
  character: CharacterSheet;
  clues: ClueItem[];
  enabledFeatures: { typemoon: boolean; scp: boolean };
  currentLocation: string;
}

export interface ChatMessage {
  id: string;
  sender: "keeper" | "player" | "system";
  timestamp: string;
  text: string; // Narration text
  parsedResponse?: KeeperResponse;
  model?: string;
  moduleName?: string;
  location?: string;
  rollResult?: {
    skillName: string;
    result: RollResult;
    outcomeMessage: string;
  };
  sanityResult?: {
    rollResult: RollResult;
    loss: number;
    outcomeMessage: string;
  };
}

export type LlmProviderKind =
  | "qiny"
  | "custom"
  | "gemini"
  | "anthropic"
  | "grok"
  | "deepseek";

export type ImageProviderKind = "qiny";

export type QinyHostKind = "com" | "icu";

export const QINY_BASE_URLS: Record<QinyHostKind, string> = {
  com: "https://openai.chatnewai.com/v1",
  icu: "https://love.qinyan.icu/v1",
};

export type ModelCapability =
  | "vision"
  | "web"
  | "reasoning"
  | "tools"
  | "rerank"
  | "embed";

export interface ApiSettings {
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

export const DEFAULT_API_SETTINGS: ApiSettings = {
  llm: { provider: "qiny", apiKey: "", model: "", customBaseUrl: "", qinyHost: "com" },
  image: { provider: "qiny", apiKey: "", model: "", qinyHost: "com" },
};

// Kept for legacy imports. Defaults to the .com host.
export const QINY_BASE_URL = QINY_BASE_URLS.com;

export function resolveQinyBaseUrl(host: QinyHostKind | undefined): string {
  return QINY_BASE_URLS[host ?? "com"];
}

export interface LogEntry {
  id: string;
  timestamp: number;
  direction: "request" | "response" | "error" | "info";
  content: string;
  meta?: any;
}

export type ServerLogDraft = Omit<LogEntry, "id" | "timestamp">;
