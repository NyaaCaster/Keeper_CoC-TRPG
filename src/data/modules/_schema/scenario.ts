/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Scenario Schema v1.0 · 「基于剧本游戏模式」模组数据契约
 *
 * 本文件是 Phase 1.2 的 SSOT(Single Source of Truth)。运行时所有引用此 schema
 * 的代码——validator / scenarioRuntime / saveManager / KeeperResponse 消费逻辑——
 * 都必须基于本文件的类型推导,严禁在别处复制定义。
 *
 * 字段语义与设计原则见 `.docs/scenario-schema.md`。
 *
 * 命名约定:
 * - YAML 文件中的 key 用 `snake_case`(yaml 习惯)
 * - 本文件 TS 类型用 `camelCase`(项目惯例,与 KeeperResponse 等保持一致)
 * - validator.ts 在 parse yaml 后做一次键名转换,运行时只暴露本文件类型
 *
 * 三槽分离:每个剧本节点同时声明 frame(不可篡改)/ freedom(LLM 创作空间)/
 * forbidden(红线)。这是与 LLM 生成模式最本质的区别——自由度边界写在数据里。
 */

export const SCENARIO_SCHEMA_VERSION = 1 as const;

// ============================================================================
// 共享原子类型
// ============================================================================

/** 投骰难度,与 src/lib/cocRules.ts 同口径。 */
export type Difficulty = "regular" | "hard" | "extreme";

/** 骰子公式字符串(运行时由 src/lib/diceFormula.ts 解析,如 "1D6" / "2D4+1")。 */
export type DiceFormula = string;

/** 24h 制时间字符串 "HH:MM"。 */
export type GameTime = string;

/** Markdown 字符串。前端用 MarkdownText.tsx 渲染,禁用 HTML 标签。 */
export type Markdown = string;

/** 资产相对路径(相对模组目录),如 "assets/maps/kitchen.png"。 */
export type AssetPath = string;

// ============================================================================
// ID 类型(Phase 1.2 不强制 branded type,但保留命名以便 validator 与
//        KeeperResponse 消费者一眼分辨引用对象)
// ============================================================================

export type SceneId = string;
export type NpcId = string;
export type ClueId = string;
export type FlagId = string;
export type EndingId = string;
export type TimelineId = string;

// ============================================================================
// §2 · meta:模组身份
// ============================================================================

export type Era = "1920s" | "modern" | "other";

export type ScenarioDifficultyTier = "入门" | "标准" | "高强度" | "致命";

export interface ScenarioMeta {
  /** kebab-case,目录名一致,全局唯一 */
  id: string;
  /** 玩家可见标题 */
  title: string;
  era: Era;
  /** 当 era === "other" 时必填 */
  eraNote?: string;
  /** 主叙事语言,默认 zh-CN */
  language: string;
  recommendedInvestigators: { min: number; max: number };
  expectedHours: { min: number; max: number };
  difficulty: ScenarioDifficultyTier;
  /** UI 筛选用 */
  tags: string[];
  /** 模组卡封面,选填 */
  cover?: AssetPath;
  /** 模组开局的绝对时间锚点(timeline 与日历驱动用) */
  startTime: { gameDay: number; hour: GameTime };
  /** 显示在模组选择卡片上的简介,不剧透关键诡计 */
  synopsisMd: Markdown;
  authorCreditsMd?: Markdown;
}

// ============================================================================
// §3 · hook:楔子与起点
// ============================================================================

export interface ScenarioHook {
  startScene: SceneId;
  prologueMd: Markdown;
  callToActionMd: Markdown;
  /** 选填,开局即入册的线索 id 列表 */
  defaultInitialClues?: ClueId[];
}

// ============================================================================
// §4 · scenes:场景图(核心)
// ============================================================================

/**
 * 场景边的通行条件。
 *
 * - free:无条件
 * - requires-clue:需已发现指定 clue("解锁"语义,会进线索本)
 * - requires-flag:需 flag 状态匹配
 * - requires-skill:需当回合声明该技能并投骰成功("通过"语义,不进线索本)
 *
 * requires-skill 与 requires-clue 不能互相替代:技能成功的"行动结果"不应
 * 污染线索本(详见 .docs/scenario-schema.md §4)。
 */
export type ExitConditionKind =
  | "free"
  | "requires-clue"
  | "requires-flag"
  | "requires-skill";

export interface ExitFree {
  to: SceneId;
  condition: "free";
  label: string;
}

export interface ExitRequiresClue {
  to: SceneId;
  condition: "requires-clue";
  requiredClue: ClueId;
  label: string;
}

export interface ExitRequiresFlag {
  to: SceneId;
  condition: "requires-flag";
  requiredFlag: FlagId;
  requiredValue: boolean;
  label: string;
}

export interface ExitRequiresSkill {
  to: SceneId;
  condition: "requires-skill";
  /** 必须是 cocSkills.ts SKILL_REGISTRY_ALL 已注册的技能 id */
  requiredSkill: string;
  difficulty: Difficulty;
  label: string;
  /**
   * 失败后果声明(选填),如 "hp:1D6"(摔伤)。
   * 不写则由 LLM 按 7e 自由化处理。
   * 格式:`<channel>:<formula>`,channel ∈ {hp, san, mp},formula 走 diceFormula.ts。
   */
  onFailureConsequence?: string;
}

export type SceneExit =
  | ExitFree
  | ExitRequiresClue
  | ExitRequiresFlag
  | ExitRequiresSkill;

export interface SceneAssets {
  /** 场景地图(选填) */
  map?: AssetPath;
  /** 场景氛围图(选填) */
  ambientImage?: AssetPath;
}

export interface SceneFrame {
  /** 玩家初次进入时的叙事化描写素材;LLM 修辞可改、事实不可改 */
  summaryMd: Markdown;
  /** 离散事实,LLM 任何回合都不可违反 */
  facts: string[];
  /** 仅 KP 视角;只有解锁条件满足后才进 LLM 上下文 */
  kpSecretMd?: Markdown;
  /** 合法出口(有向边) */
  exits: SceneExit[];
  /** 默认在场 NPC,可被 timeline.npcRelocate 改写 */
  npcsPresent: NpcId[];
  /** 该场景可发现的 clue 候选(具体能否发现由 clue.discovery 决定) */
  availableClues: ClueId[];
  assets?: SceneAssets;
}

export interface SensoryPalette {
  sight?: string;
  sound?: string;
  smell?: string;
  touch?: string;
  taste?: string;
}

export interface SceneFreedom {
  /** 氛围标签,LLM 可挑用 */
  moodTags?: string[];
  /** 五感语料库,LLM 可挑用、不必全用 */
  sensoryPalette?: SensoryPalette;
  /** 可临时编入但不影响主线的次要物件 */
  improvisableProps?: string[];
  /** 各 NPC 在此场景的可发挥行为(非台词);键为 NpcId */
  npcActionHints?: Record<NpcId, string[]>;
}

export interface Scene {
  id: SceneId;
  title: string;
  frame: SceneFrame;
  freedom?: SceneFreedom;
  /** 本场景红线 */
  forbidden?: string[];
}

// ============================================================================
// §5 · npcs:NPC 表
// ============================================================================

export type NpcRole = "平民" | "盟友" | "对立" | "反派" | "中立";

export type NpcAttitude =
  | "hostile"
  | "wary"
  | "neutral"
  | "friendly"
  | "trusting";

/**
 * NPC 战斗数值。前端硬规则使用,与 CharacterSheet 同口径但精简。
 * 所有字段都是 0~100 整数,hp/mp/san 例外(按 7e 派生公式或剧本指定)。
 */
export interface NpcStats {
  str: number;
  con: number;
  siz: number;
  dex: number;
  app: number;
  int: number;
  pow: number;
  edu: number;
  hp: number;
  mp: number;
  /** 已发狂的 NPC 标 0 */
  san: number;
}

export interface NpcCombat {
  weapon: string;
  /** 走 src/lib/diceFormula.ts 同款语法 */
  damageFormula: DiceFormula;
  /** 武器技能值,0~100 */
  skillValue: number;
}

export interface NpcFrame {
  /** 玩家初见时只能感受到这层 */
  publicPersonaMd: Markdown;
  /** secretUnlockTrigger 触发后才进 LLM 上下文 */
  secretMd?: Markdown;
  /** 解锁 secret 的 clue id 或 flag id */
  secretUnlockTrigger?: ClueId | FlagId;
  stats: NpcStats;
  combat?: NpcCombat;
  /** 不可违反的人设核心(语气、忌讳话题等) */
  voiceGuidelines: string[];
}

export interface NpcFreedom {
  /** LLM 可挑用的次要习癖 */
  improvisableQuirks?: string[];
  catchphrases?: string[];
}

export interface Npc {
  id: NpcId;
  name: string;
  role: NpcRole;
  initialLocation: SceneId;
  initialAttitude: NpcAttitude;
  frame: NpcFrame;
  freedom?: NpcFreedom;
  forbidden?: string[];
}

// ============================================================================
// §6 · clues:线索表
// ============================================================================

export type DiscoveryMethodKind =
  | "skill"
  | "flag"
  | "npc-give"
  | "auto-on-enter";

export interface DiscoverySkill {
  method: "skill";
  /** 必须是 cocSkills.ts SKILL_REGISTRY_ALL 已注册的技能 id */
  skill: string;
  difficulty: Difficulty;
}

export interface DiscoveryFlag {
  method: "flag";
  conditionFlag: FlagId;
}

export interface DiscoveryNpcGive {
  method: "npc-give";
  giverNpc: NpcId;
  /** 选填:当此 flag 满足时 NPC 才会交付 */
  conditionFlag?: FlagId;
}

export interface DiscoveryAutoOnEnter {
  method: "auto-on-enter";
}

export type ClueDiscovery =
  | DiscoverySkill
  | DiscoveryFlag
  | DiscoveryNpcGive
  | DiscoveryAutoOnEnter;

export interface ClueUnlocks {
  /** 解锁这些 NPC 的 secret */
  secrets?: NpcId[];
  /** 新增可达场景 */
  scenes?: SceneId[];
  /** 设旗 */
  flags?: FlagId[];
}

export interface ClueFrame {
  /** 唯一发现地点 */
  locationScene: SceneId;
  discovery: ClueDiscovery;
  /** 玩家发现时呈现的全文,可重读、内容固定 */
  revealMd: Markdown;
  /** KP 备注(选填) */
  kpNoteMd?: Markdown;
  /** 发现后触发的连锁解锁 */
  unlocks?: ClueUnlocks;
  /** 玩家可见的道具图(选填) */
  asset?: AssetPath;
}

export interface ClueFreedom {
  /** "发现"时刻的氛围语料 */
  sensoryWhenFoundMd?: Markdown;
  /** 允许 LLM 描绘的烟雾弹细节 */
  redHerringsAllowed?: string[];
}

export interface Clue {
  id: ClueId;
  title: string;
  frame: ClueFrame;
  freedom?: ClueFreedom;
  forbidden?: string[];
}

// ============================================================================
// §7 · timeline:时间表(线性日历,7e 规则驱动)
// ============================================================================

/** 触发时间(基于 meta.startTime 的绝对日历)。 */
export interface FiresWhen {
  gameDay: number;
  hour: GameTime;
}

/** 触发的前置条件(与 forced=false 配合)。 */
export type TimelinePrerequisite =
  | { kind: "flag"; flag: FlagId; value: boolean }
  | { kind: "clue"; clue: ClueId };

export interface TimelineSanCheck {
  loss: { success: DiceFormula | number; fail: DiceFormula };
  reason: string;
}

export interface NpcRelocate {
  npc: NpcId;
  to: SceneId;
}

export interface TimelineEffects {
  /** 设置一组 flag */
  setFlags?: { flag: FlagId; value: boolean }[];
  /** 解锁一组场景 */
  unlockScenes?: SceneId[];
  /** 解锁一组线索 */
  unlockClues?: ClueId[];
  /** 强制把玩家拉到某场景 */
  forceSceneTransition?: SceneId;
  /** 改写 NPC 当前位置 */
  npcRelocate?: NpcRelocate[];
  /** 触发强制 SAN 检定 */
  sanCheck?: TimelineSanCheck;
}

export interface TimelineFrame {
  /** 给 LLM 的"事件刚发生"叙事种子 */
  narrativeSeedMd: Markdown;
  effects?: TimelineEffects;
}

export interface TimelineFreedom {
  atmosphereMd?: Markdown;
}

export interface TimelineEvent {
  id: TimelineId;
  title: string;
  firesWhen: FiresWhen;
  /** true = 到点必触发;false = 需 prerequisites 全部满足 */
  forced: boolean;
  prerequisites?: TimelinePrerequisite[];
  /** 默认 true,触发后归档 */
  once?: boolean;
  frame: TimelineFrame;
  freedom?: TimelineFreedom;
  forbidden?: string[];
}

// ============================================================================
// §8 · flags:进度旗帜
// ============================================================================

/**
 * Flag 的可写入来源声明。Phase 1 校验器靠它做"结局可达性"分析。
 * - `clue-unlocks`:由 `clue.unlocks.flags` 写入(只能写 true)
 * - `timeline-effects`:由 `timeline.effects.setFlags` 写入(true 或 false)
 * - `scenario-actions`:由运行时 LLM `KeeperResponse.scenarioActions.flagSet` 写入(Phase 2 通道)
 *
 * 默认 = `['clue-unlocks', 'timeline-effects']`,与 schema v1.0 行为一致。
 * 显式声明 `scenario-actions` 后,validator 视该 flag 的 true/false 两种值都可达。
 */
export type FlagWritableBy = "clue-unlocks" | "timeline-effects" | "scenario-actions";

export interface Flag {
  id: FlagId;
  title: string;
  initial: boolean;
  descriptionMd?: Markdown;
  /**
   * 选填。声明该 flag 可被哪些渠道写入。
   * - 不声明 ⇒ 默认 ['clue-unlocks', 'timeline-effects'](与 schema v1.0 行为一致)
   * - 包含 'scenario-actions' ⇒ 视为运行时 LLM 通道写入,validator 把 true 和 false 都算作可达
   */
  writableBy?: FlagWritableBy[];
}

// ============================================================================
// §9 · endings:结局表
// ============================================================================

/** 与 KeeperResponse.scenarioEnd 同口径。 */
export type ScenarioEndKind = "victory" | "ambiguous" | "dead" | "insane";

export interface EndingTrigger {
  flag: FlagId;
  value: boolean;
}

export interface EndingFrame {
  /** 固定结局文本,LLM 必须按精神写出 narrative,允许文风改写 */
  epilogueMd: Markdown;
  /** 选填,scenarioEnd 时前端结算 */
  sanReward?: DiceFormula | number;
  /** 是否进入经验阶段 */
  experiencePhase?: boolean;
  scenarioEndKind: ScenarioEndKind;
}

export interface EndingFreedom {
  atmosphereMd?: Markdown;
}

export interface Ending {
  id: EndingId;
  title: string;
  /** AND 逻辑;所有 trigger 满足才触发 */
  triggers: EndingTrigger[];
  /** 多 ending 同时满足时取 priority 高的 */
  priority: number;
  frame: EndingFrame;
  freedom?: EndingFreedom;
  forbidden?: string[];
}

// ============================================================================
// §10 · global_freedom / global_forbidden
// ============================================================================

export interface GlobalFreedom {
  eraAtmosphereMd?: Markdown;
  languageRegister?: string;
  npcDefaultDialect?: string;
}

// ============================================================================
// §11 · narrative_style:模组叙事文风指导(供 LLM 在剧本模式扮演 KP 时对齐口吻)
// ============================================================================

/**
 * 叙事文风的不可篡改硬约束。POV / 时态 / 元描述红线属于"语法层",
 * 一变就跳戏,所以进 frame 槽。
 */
export interface NarrativeStyleFrame {
  /** 叙事人称,如 "第二人称" / "第三人称克制" / "KP 直述" 等自由字符串 */
  pov?: string;
  /** 时态,如 "现在时" / "过去时" */
  tense?: string;
  /**
   * 元描述类红线(元游戏术语、第四面墙之外的全知评论等)。
   * 与 SceneForbidden 不同:这里关的是"怎么说",不是"说什么"。
   */
  forbiddenPhrasings?: string[];
}

/**
 * 文风的语料与示范。LLM 可挑用、不必逐条命中;情绪需要时可偏离。
 */
export interface NarrativeStyleFreedom {
  /** 句子节奏指导(长句/短句切换、标点习惯等) */
  sentencePacingMd?: Markdown;
  /** 词汇风格(口语/书面、年代/地域、忌讳词等) */
  vocabularyRegister?: string;
  /** 比喻意象池,可挑用 */
  metaphorPalette?: string[];
  /** 同温层参考作品(LLM 不引用、只对齐口吻) */
  referenceWorks?: string[];
  /**
   * 一段示范段落,直接展示该模组期望的文风。
   * 强约束:校验器会对长度做软警告(> 200 字),防止注水;
   * 设计哲学:一段好范本 > 十条抽象规则。
   */
  sampleParagraphMd?: Markdown;
}

export interface NarrativeStyle {
  frame?: NarrativeStyleFrame;
  freedom?: NarrativeStyleFreedom;
}

// ============================================================================
// 顶层 Scenario(单一事实源)
// ============================================================================

export interface Scenario {
  schemaVersion: typeof SCENARIO_SCHEMA_VERSION;
  meta: ScenarioMeta;
  hook: ScenarioHook;
  scenes: Scene[];
  npcs: Npc[];
  clues: Clue[];
  timeline: TimelineEvent[];
  flags: Flag[];
  endings: Ending[];
  globalFreedom?: GlobalFreedom;
  globalForbidden?: string[];
  /**
   * 模组叙事文风指导。Phase 2 拼 KP prompt 时按 frame=必须遵守 / freedom=可挑用 注入。
   * 校验器只对 sampleParagraphMd 长度做软警告,其余字段全是软约束。
   */
  narrativeStyle?: NarrativeStyle;
}

