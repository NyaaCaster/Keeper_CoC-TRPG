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
  /**
   * 疯狂状态机(规则 10) — 每次 SAN 扣减后由前端硬规则维护:
   * - episodeSanLoss:本模组累计 SAN 损失,用于 1/5 阈值判断;通关或新模组时清零
   * - madness:null=正常 / "bout"=急性发作(单玩家回合) / "temporary"=临时疯狂(N 个 keeper 回合)
   *   / "indefinite"=不定期疯狂(持续整个模组,需 LLM 或剧情解除)
   * - boutTurnsRemaining:急性发作剩余玩家输入次数(本游戏简化为 1)
   * - temporaryTurnsRemaining:临时疯狂剩余 keeper 回合数(1d6,折算 7e 的 1d10 小时)
   * - boutRoll:1-10,对应规则 10 中的疯狂表项;indefinite 持续渗透该症状
   * - indefiniteAnchor:不定期疯狂触发时的锚点,用于剧情恢复路径判断
   */
  sanityState?: {
    episodeSanLoss: number;
    madness: null | "bout" | "temporary" | "indefinite";
    boutTurnsRemaining?: number;
    temporaryTurnsRemaining?: number;
    boutRoll?: number;
    indefiniteAnchor?: { moduleName: string; turnId: string };
  };
}

export interface ClueItem {
  id: string;
  title: string;
  type: "note" | "photo" | "marking" | "book" | "artifact";
  description: string;
  imageUrl?: string;
  /**
   * 画图提示词。仅在线索含有 description 无法替代的视觉细节(符号/照片/异常器物/
   * 文书上的图示等)时由守密人下发;纯文字 note/book 不带此字段,前端会完全隐藏
   * 插图入口。
   */
  prompt?: string;
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
    /** 可选 — 仅当线索值得配图时由守密人提供,否则前端不展示插图入口。 */
    prompt?: string;
  } | null;
  /**
   * 对话中即兴的视觉占位卡 — 场景里出现值得让玩家"看到"但尚未构成线索的
   * 视觉元素时由守密人下发。前端在 keeper 气泡里单独起行渲染一张"显示图像"
   * 卡;玩家点击后才请求画图模型,展开预览后可一键"收录线索"。
   */
  sceneImage?: {
    caption: string;
    type: "note" | "photo" | "marking" | "book" | "artifact";
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
  /**
   * 终局闸 — 模组结束时使用。一旦本字段非 null,前端会在该回合结束后封锁所有玩家输入与技能声明,
   * 把存档标记为"已封存",并屏蔽 LLM 后续输出。共五种 kind:
   *
   *   坏结局(由前端硬规则护栏自动注入,LLM 也可主动下发):
   *   - dying: 单回合垂死窗口。HP 从正值掉到 ≤ 0 且单次伤害 < maxHp 时由前端自动注入。
   *     玩家本回合可输入纯叙事(遗言/挣扎),不能声明技能。
   *     下一回合 KP 必须二选一:① 把 HP 拉回 ≥ 1 + 强制场景跳转(救起,scenarioEnd 改为 null);
   *     ② 写死亡尾声并下发 scenarioEnd: dead。详见规则 9。
   *   - dead: 调查员死亡。HP 归零(一次性致命伤 / dying 救起时 LUC 不足 / dying 选择死亡)。封盘。
   *   - insane: 调查员永久疯狂。SAN 归零(规则 10 C 路径)。叙事上精神被吞噬,与 dead 同等终局。
   *
   *   好/灰结局(只能由 LLM 主动判定模组完成度后下发,前端不会硬注入):
   *   - victory: 模组好结局。调查员阻止了核心威胁、活着、SAN/HP 仍可继续探索。
   *     LLM 应在 epilogue 里写"调查员从这场不可名状的恐怖中全身而退"的克制叙事
   *     (但克系基调依然保留——没有人真正"全身而退",只是侥幸)。
   *   - ambiguous: 灰色结局。线索断了 / 阻止部分失败 / 调查员活着但被卷入更大阴谋 /
   *     真相只揭开了一角等。模组主线已经走完,但答案没给完。LLM 应在 epilogue 里写
   *     "她活着,故事却才刚刚开始"或"她合上笔记本,知道自己永远不会再回到那里"等悬而未决的尾声。
   *
   * 注:dying/dead/insane 也可由前端硬规则强制注入(LLM 忘记下发时)——详见 App.tsx
   * 中的"终局闸"代码,以及 server.ts SYSTEM_INSTRUCTION 规则 9 / 规则 10。
   * victory/ambiguous 必须由 LLM 主动下发,前端不会自动触发,因为"模组通关"的判定
   * 只有 LLM 知道剧情进度。
   */
  scenarioEnd?: {
    kind: "dying" | "dead" | "insane" | "victory" | "ambiguous";
    epilogue?: string;
  } | null;
  /**
   * 疯狂态解除信号(规则 10 indefinite 解除路径之一)。
   * LLM 在不定期疯狂状态下,只有当**剧情明确出现**心理治疗(NPC 医生 / Psychotherapy 技能 / 长期休养)
   * 且玩家显式接受时,才允许下发 madnessRecover: true。前端收到后清零 sanityState.madness。
   * 普通的疯狂状态(bout/temporary)由前端自动倒计时解除,**不**需要 LLM 下发本字段。
   */
  madnessRecover?: boolean | null;
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
  /**
   * KP 在该回合下发的对话内即兴图像占位 — 用户首次点击"显示图像"前 imageUrl 为空;
   * 生成后写入 imageUrl 并落入存档。savedAsClueId 在用户从预览页点击"收录线索"后写入,
   * 用于在按钮上显示"已收录"且禁用重复登记。
   */
  sceneImage?: {
    caption: string;
    type: "note" | "photo" | "marking" | "book" | "artifact";
    prompt: string;
    imageUrl?: string;
    savedAsClueId?: string;
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
