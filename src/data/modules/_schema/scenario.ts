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
  /**
   * 推荐职业(模组转写期由作者填好,Phase 3 创角阶段在剧本模式下显示给玩家)。
   * 必填,≥1 项。每项必须能在 src/data/cocOccupations.ts 对应 era 表里命中
   * (中文名或 id 任一即可,validator 会验证)。
   */
  recommendedOccupations: string[];
  /**
   * 是否为推荐模组。必填(布尔)。
   *
   * 设计意图:卷宗目录(模组选择)界面会在 `recommended === true` 的卡片上
   * 渲染金色"推荐"徽标,作为转写者/项目方对该模组品质或代表性的背书。
   * 与 difficulty/tags 是不同维度——非推荐不代表质量差,只代表当前不在
   * 首选展示位上。每个模组转写时必须显式给出 true/false,不允许省略。
   */
  recommended: boolean;
}

// ============================================================================
// §3 · hook:楔子与起点
// ============================================================================

/**
 * per-occupation hook 变体。
 *
 * 设计意图:外部模组(如「褄列奇谈」)常常按职业切入路线提供独立的卷入动机
 * 与开局线索(警察 / 侦探 / 记者 / 摄影师 / 神秘学家 / 教授 各异)。
 * `prologueMd`(同场景情景描写)保持单一,所有 PC 共享;只有"动机"与"开局
 * 线索"按职业分叉。
 *
 * key 是 occupation id 或 occupation 中文名(与 cocOccupations.ts 对齐),
 * 与 PresetInvestigator.occupation / meta.recommendedOccupations 同口径。
 * 玩家选定职业后,运行时优先读 occupationVariants[选定职业],未命中回落到
 * 顶层 callToActionMd 与 defaultInitialClues。
 */
export interface ScenarioHookOccupationVariant {
  callToActionMd: Markdown;
  /** 该职业独享的开局线索;未填写则回落到 hook.defaultInitialClues */
  initialClues?: ClueId[];
}

export interface ScenarioHook {
  startScene: SceneId;
  prologueMd: Markdown;
  callToActionMd: Markdown;
  /** 选填,开局即入册的线索 id 列表 */
  defaultInitialClues?: ClueId[];
  /**
   * 选填。按职业分叉的卷入动机与开局线索。
   * 命中规则:玩家创角时选定的 occupation(id 或中文名)与 key 任一匹配即生效。
   */
  occupationVariants?: Record<string, ScenarioHookOccupationVariant>;
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

/**
 * 条件 SAN 奖励(模组通关后按 flag 命中情况发放的额外 SAN)。
 *
 * 例:
 *   { label: "击退神话生物", flag: "flag_starcolour_repelled", formula: "1d6" }
 * 当 ScenarioState.flags["flag_starcolour_repelled"] === true 时,
 * 在经验阶段额外结算 +1d6 SAN。
 */
export interface EndingSanRewardCondition {
  /** 显示给玩家的奖励名称,如 "击退神话生物" / "保护重要 NPC" */
  label: string;
  /**
   * 触发条件 flag(选填)。未填则视为无条件加成(慎用)。
   * 必须引用已声明的 flag id。
   */
  flag?: FlagId;
  /** 骰子公式,如 "1d6" / "1d10";支持纯整数 */
  formula: DiceFormula | number;
}

/**
 * 结局奖励的结构化声明,供运行时经验阶段(ExperiencePhaseModal)结算。
 *
 * 设计意图:
 * - skillGrowth=true 启用 7e 经验阶段(技能成长检定)
 * - sanRewardFormula 是"主线 SAN 奖励"(无条件,例:打通主线 +1d10)
 * - sanRewardConditions 是按 flag 命中情况发放的"附加 SAN"
 * - cashReward 直接加到 sheet.cashBalance
 *
 * 旧字段 EndingFrame.sanReward / experiencePhase 被本结构覆盖;若 rewards 存在,
 * 旧字段被忽略(validator 会对同时存在两套字段发软警告)。
 */
export interface EndingRewards {
  /** 是否进入 7e 经验阶段(技能成长 + 首次破 90 +2d6 SAN) */
  skillGrowth: boolean;
  /** 主线 SAN 奖励公式,如 "1d10" / 5。无条件发放,仅在 victory/ambiguous 时触发 */
  sanRewardFormula?: DiceFormula | number;
  /** 条件 SAN 奖励列表,按 flag 命中情况追加 */
  sanRewardConditions?: EndingSanRewardCondition[];
  /** 现金奖励,直接加到 sheet.cashBalance(0 起步) */
  cashReward?: number;
}

export interface EndingFrame {
  /** 固定结局文本,LLM 必须按精神写出 narrative,允许文风改写 */
  epilogueMd: Markdown;
  /**
   * 选填,scenarioEnd 时前端结算。
   * @deprecated 请改用 rewards.sanRewardFormula;两者并存时以 rewards 为准。
   */
  sanReward?: DiceFormula | number;
  /**
   * 是否进入经验阶段。
   * @deprecated 请改用 rewards.skillGrowth;两者并存时以 rewards 为准。
   */
  experiencePhase?: boolean;
  /** 结构化奖励声明,供 ExperiencePhaseModal 结算(选填) */
  rewards?: EndingRewards;
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
// §12 · preset_investigators:模组自带预设 PC(选填)
// ============================================================================

/**
 * CoC 7e 八大基础属性(数值 0~100,创角期通常 ∈ [15, 90],edu 上限 99)。
 * 与 src/types.ts 的 CharacterSheet.attributes 同口径,但只在剧本模式下作为
 * 模组作者锁定数值的渠道。
 */
export interface PresetInvestigatorAttributes {
  str: number;
  con: number;
  siz: number;
  dex: number;
  app: number;
  int: number;
  pow: number;
  edu: number;
}

/**
 * 模组自带的预设调查员卡。
 *
 * 设计意图:克系经典本(尤其官方 pre-gens)往往会附完整 PC,玩家在剧本模式下
 * 应直接选这些已锁定数值的角色,而非走"模板 + 兴趣点"的随机流程。
 *
 * 字段镜像 CharacterSheet 的核心数值(详见 .docs/scenario-schema.md §12 与
 * src/types.ts CharacterSheet),validator 会按 CoC 7e 创角硬规则校验:
 *   - attributes.* ∈ [15, 90](edu 允许到 99)
 *   - skills 每条值 ∈ [0, 90](RAW 创角期 90 上限)
 *   - occupation 必须能在 src/data/cocOccupations.ts 对应 meta.era 命中
 *
 * 模组若不附预设 PC,直接省略 Scenario.presetInvestigators 字段。
 */
export interface PresetInvestigator {
  /** 全模组唯一,kebab-case,如 "pc.julia-meridian" */
  id: string;
  name: string;
  age: number;
  /** 必填(剧本预设需完整身份信息,LLM 不允许覆盖) */
  gender: string;
  /**
   * 国籍,必填。CoC 7e 角色卡 Nationality 字段;在剧本模式下由作者锁定,
   * LLM 不允许覆盖。仅供叙事 / NPC 反应 / 语言选择参考,不参与规则数值。
   */
  nationality: string;
  /**
   * 角色身份,必填。承担"角色扮演中的身份描述",与 occupation 协同
   * (例:occupation="医师", identity="温莎学院附属医院驻院神经科医生")。
   * 仅供 LLM 叙事/世界观融合使用,不参与规则数值。剧本模式下作者锁定,LLM 不覆盖。
   */
  identity: string;
  /** 中文职业名或 id,必须能在 cocOccupations.ts 对应 era 命中 */
  occupation: string;
  attributes: PresetInvestigatorAttributes;
  /** 当前理智值(创角默认 = pow * 5) */
  sanity: number;
  /** 幸运值,0~99 */
  luck: number;
  /** 信用 0~99 */
  creditRating: number;
  /**
   * 作者刻意定值的技能;键为中文技能名,值为 0~90。
   * 留空 / 缺漏的技能在创角时按职业模板兜底,**不会**自动加兴趣点。
   */
  skills: Record<string, number>;
  /** 简介,显示在选择卡上 */
  overviewMd: Markdown;
  /** 完整背景故事,选填 */
  backgroundStoryMd?: Markdown;
  /** 头像/立绘,相对模组目录(如 "assets/preset/julia.jpg") */
  portrait?: AssetPath;
  /** 出生地 / 居住地,选填 */
  birthplace?: string;
  residence?: string;
  /**
   * 预置武器 id 列表(必须在 src/data/cocWeapons.ts WEAPON_REGISTRY_ALL 命中,
   * 且 era === "any" 或匹配 meta.era)。选填。
   */
  weapons?: string[];
  /**
   * 预置非武器道具列表(自由文本)。每条会在创角期落到 CharacterSheet.inventory
   * 的 `{ kind: "item", text }` 槽,排在 weapons 展开之后、空槽之前。
   * 用途:相机 / 录音笔 / 护身符 / 古书 / 警察证 / 急救包 等"职业身份道具"。
   *
   * 约束(由 validator 强制):
   *   - 单条 text 长度 ∈ [1, 40](40 是角色卡 inventory UI 的视觉容量);
   *   - weapons.length + items.length ≤ 8(inventory 总槽数);
   *   - 不允许空字符串/纯空白(空槽前端会自动补,作者无需手填);
   *   - 不强制去重(允许"急救包 ×2"两条等)。
   */
  items?: string[];
  /**
   * 起始现金,选填。不填则由 startingCashOf(creditRating, era) 在创角期派生。
   */
  cashBalance?: number;
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
  /**
   * 模组自带预设 PC(选填)。
   * 有则在 Phase 3 剧本模式 step 2 优先展示这一组,玩家可选其一直接进游戏;
   * 无则回退到"按 era + recommendedOccupations 随机生成预设"的兜底路径。
   */
  presetInvestigators?: PresetInvestigator[];
}

