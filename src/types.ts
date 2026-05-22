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
}

export interface KeeperRollRequest {
  skillName: string;
  targetValue: number;
  difficulty: "regular" | "hard" | "extreme";
  isSecret: boolean;
  reason: string;
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
  } | null;
  npcDialogue?: {
    name: string;
    text: string;
  } | null;
  gameState?: {
    moduleName: string;
    currentLocation: string;
    dangerLevel: number; // 1-10
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
  dangerLevel: number;
}

export interface ChatMessage {
  id: string;
  sender: "keeper" | "player" | "system";
  timestamp: string;
  text: string; // Narration text
  parsedResponse?: KeeperResponse;
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
