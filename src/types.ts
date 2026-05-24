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

/**
 * 派生战斗值快照（阶段 10.1）。
 *
 * 持久化在 sheet 上，跑团时给 LLM / 战斗结算直接读取，避免每次现算。
 * 由 server 在任何修改 `attributes.str / con / siz / dex` 或 `age` 的出口处统一刷新
 * （见 cocRules.ts 的 refreshCombatDerived helper），客户端只读。
 *
 * 字段含义：
 * - db    伤害加值（{flat, dice, display} 与 cocRules.DamageBonus 兼容）
 * - build 体格（格斗对抗 / 擒抱用）
 * - mov   移动率
 * - dodge 闪避基础值（DEX/2，独立于 sheet.skills，不进技能表）
 */
export interface CombatDerivedSnapshot {
  db: { flat: number; dice: string | null; display: string };
  build: number;
  mov: number;
  dodge: number;
}

/**
 * 神秘接触档案。CoC 7e 规则中"调查员持有/接触过的神话相关条目"。
 * 不可手动调，仅由 KP 在游戏过程中按规则下发。
 * 创建期为空对象（不是 undefined），方便 UI 直接 map。
 */
export interface MythicEncounters {
  tomes: MythicTomeEntry[];        // 神话著作（含完整阅读 / 部分阅读状态）
  spells: MythicSpellEntry[];      // 已学法术
  artifacts: MythicArtifactEntry[];// 神器（持有 / 接触过）
  entities: MythicEntityEntry[];   // 接触过的存在
}

export interface MythicTomeEntry {
  id: string;
  name: string;
  state: "skimmed" | "read" | "studied"; // 略读 / 通读 / 精研
  acquiredAt?: string;
  notes?: string;
}

export interface MythicSpellEntry {
  id: string;
  name: string;
  cost?: string;        // POW / MP / SAN 消耗的描述串
  acquiredAt?: string;
  notes?: string;
}

export interface MythicArtifactEntry {
  id: string;
  name: string;
  state: "held" | "encountered"; // 持有 / 仅接触过
  acquiredAt?: string;
  notes?: string;
}

export interface MythicEntityEntry {
  id: string;
  name: string;
  encounteredAt?: string;
  notes?: string;
}

/**
 * 装备槽条目（House Rule：8 槽随身上限，详见 .docs/character-card-current.md 第 5 节）。
 *
 * - `kind: "item"`：自由文本物品。`text === ""` 视为空槽。重要个人物件 / 工具 / 出诊包等都走这里。
 * - `kind: "weapon"`：通过 weaponId 引用 src/data/cocWeapons.ts 的结构化条目；ammo 由
 *   武器表 maxAmmo 派生，创建期固定，跑团时由 KP 扣加。近战 / 投掷武器 ammo 恒为 0。
 *
 * 默认值约定：`{ kind: "item", text: "" }`。
 */
export type InventoryEntry =
  | { kind: "item"; text: string }
  | { kind: "weapon"; weaponId: string; ammo: number };

export interface CharacterSheet {
  name: string;
  occupation: string;        // 职业（CoC 7e 标准模板 id 对应的中文名；阶段 6 起从下拉绑定）
  /**
   * 角色身份：自由文本，承担"角色扮演中的身份描述"。
   * 与 occupation 协同（例：occupation="会计师", identity="时钟塔学院政法科专员"）。
   * 仅供 LLM 叙事 / 世界观融合使用，不参与规则数值计算。
   */
  identity?: string;
  /**
   * 国籍：自由文本，CoC 7e 标准角色卡 Nationality。
   * 仅供叙事 / NPC 反应 / 语言选择参考，不参与规则数值计算。
   */
  nationality?: string;
  /**
   * 居住地：自由文本，CoC 7e 标准角色卡 Residence（城市 / 街区粒度）。
   * 供 LLM 在开场叙事 / 模组地点联动 / 旅途逻辑时使用，不参与规则数值计算。
   */
  residence?: string;
  /**
   * 母语：自由文本（如"汉语"、"英语"、"日语"）。
   * 7e 规则上是技能，但技能值 = EDU 由派生函数 motherTongueValue 现算，不写入 skills 表；
   * 此字段只承载"语言名称"作为叙事属性。
   */
  motherTongue?: string;
  /**
   * 信用评级 0–99：CoC 7e 标准角色卡 Credit Rating。
   * 7e 规则上是技能，但语义偏"资产 / 现金 / 消费等级"派生、不通过经验阶段成长，
   * 因此本项目移到基本信息层，不写入 skills 表。
   */
  creditRating?: number;
  gender: string;
  age: number;
  background: "1920s" | "modern";
  attributes: CharacterAttributes;
  skills: CharacterSkills;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  san: number;
  maxSan: number;
  /**
   * SAN 硬上限 = 99 − 克苏鲁神话。阶段 10 后由 clampSanityLayers helper 维护，
   * 实际"现算源"是 cocRules.maxSanLimitOf(mythos)；本字段保留为兼容冗余，
   * 旧代码 / 旧存档读取无须迁移。游戏 UI 不直接展示。
   */
  maxSanLimit: number;
  mythos: number; // 克苏鲁神话技能
  /**
   * 神秘接触档案。创建期为 undefined / 空对象都合法；
   * KP 通过 sanitySkillGain 等字段按 CoC 7e 规则在游戏过程中追加。
   */
  mythicEncounters?: MythicEncounters;
  /**
   * 装备与随身物品（House Rule：长度恒为 8，空槽用 { kind: "item", text: "" } 占位）。
   * 详见 .docs/character-card-current.md 第 5 节。旧存档可能没有此字段（undefined 合法）。
   */
  inventory?: InventoryEntry[];
  /**
   * 运行时现金余额（阶段 10）。
   * 创建期由 startingCashOf(creditRating, background) 派生写入；
   * 跑团时由 KP 工具 updateCashBalance 扣加，不由客户端直接编辑。
   * 旧存档 undefined 时，UI 显示回退到派生值。
   */
  cashBalance?: number;
  /**
   * 派生战斗值快照（阶段 10）。详见 CombatDerivedSnapshot 注释。
   * 旧存档 undefined 合法，server 第一次访问时由 refreshCombatDerived 自动补写。
   *
   * Invariant：任何修改 attributes.str/con/siz/dex 或 age 的出口都必须紧跟一次
   * cocRules.refreshCombatDerived(sheet) 重写本字段。当前已知出口：
   *   - CharacterCreator.handleCreateCustom（自定义创建）
   *   - CharacterCreator.handleSelectPreset（预设选取）
   *   - CharacterCreator.handleImportCharacterCard（PNG 卡片导入）
   * 跑团期 App.tsx 现存的 setCharacter 调用只改 luck（不影响 db/build/mov/dodge），
   * 故无需重算；若未来新增改 str/con/siz/dex/age 的运行时通道，必须同步加 helper。
   */
  combatDerived?: CombatDerivedSnapshot;
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
  /**
   * 创建期不可变快照。在 onComplete 进入游戏的入口处一次性深拷贝写入；
   * 运行期任何 setCharacter 都不应再触碰这个字段。
   *
   * 用途：跑团中途的"下载调查员角色卡"按钮渲染的应是创建期原貌（HP 满血、
   * SAN 未扣、技能未涨值、现金未消、装备未变），而非当前实时状态。
   *
   * 嵌套约束：snapshot.creationSnapshot 永远应为 undefined（不递归）。
   */
  creationSnapshot?: CharacterSheet;
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

    /**
     * 阶段 10：现金余额变动（写入 sheet.cashBalance）。
     * cashChange = 增减量（正进负出），cashSetTo = 重置到指定值；二者互斥，
     * 同时下发时前端按 cashSetTo 优先。前端钳制 cashBalance ≥ 0。
     */
    cashChange?: number;
    cashSetTo?: number;

    /**
     * 阶段 10：武器槽弹药变动（写入 inventory[slotIndex].ammo）。
     * 仅作用于 kind === "weapon" 且 maxAmmo > 0 的槽位；其它槽位静默跳过。
     * ammoDelta = 增减量（正补充负消耗），ammoSetTo = 重置到指定值；二者互斥，
     * 同时下发时前端按 ammoSetTo 优先。前端钳制 ammo ∈ [0, weapon.maxAmmo]。
     * slotIndex 越界（< 0 或 ≥ inventory.length）静默跳过。
     */
    ammoUpdates?: Array<{ slotIndex: number; ammoDelta?: number; ammoSetTo?: number }>;
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

  /**
   * 剧本模式专用通道。仅当 gameMode === "scenario-based" 且 KP prompt 节 12 注入时,
   * LLM 才允许下发本字段;llm-generated 模式下**禁止**填,必须为 null。
   *
   * 所有动作经前端 applyKeeperResponse 校验:不合法 → 拒绝 + 回注 [场景非法·拒绝] /
   * [线索条件未满足·拒绝] / [终幕条件未达成·拒绝];合法 → 落账 + 注入对应正向标记。
   */
  scenarioActions?: ScenarioActions | null;
}

export interface ScenarioActions {
  sceneTransition?: ScenarioSceneTransition | null;
  clueDiscovered?: ScenarioClueDiscovered | null;
  flagSet?: ScenarioFlagSet[] | null;
  endingProposed?: ScenarioEndingProposed | null;
  timeAdvance?: ScenarioTimeAdvance | null;
}

export interface ScenarioSceneTransition {
  /** 目标场景 id;必须是当前场景某条 exit 的 to */
  toSceneId: string;
  reason?: string;
}

export interface ScenarioClueDiscovered {
  /** clue id;必须是当前场景的 availableClues 里的一项 */
  clueId: string;
  /** 与该 clue 的 frame.discovery.method 一致 */
  method: "skill" | "flag" | "npc-give" | "auto-on-enter";
}

export interface ScenarioFlagSet {
  flagId: string;
  value: boolean;
  reason?: string;
}

export interface ScenarioEndingProposed {
  endingId: string;
}

export interface ScenarioTimeAdvance {
  /** 推进的游戏内分钟数,整数,≥ 0 */
  minutes: number;
  reason?: string;
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
  /**
   * 游戏模式。缺省视为 "llm-generated"(老存档兼容)。
   * - llm-generated:LLM 凭空生成剧本(原路径)
   * - scenario-based:基于预制模组,LLM 按 frame/freedom/forbidden 走
   */
  gameMode?: GameMode;
  /**
   * 仅在 gameMode === "scenario-based" 时存在;由 scenarioRuntime 维护。
   * 老存档无此字段;切到剧本模式时由前端按模组 hook 初始化。
   */
  scenarioState?: ScenarioState;
}

export type GameMode = "llm-generated" | "scenario-based";

/**
 * 剧本模式运行时状态。所有 id 引用对应模组的 scene/clue/npc/flag id。
 *
 * 设计原则:
 * - 只持久化"会变"的状态;模组数据本身不进存档(模组打进镜像)
 * - npcAttitude / endingFlags 用 Record<string, ...> 而非 Map,localStorage 友好
 */
export interface ScenarioState {
  /** 模组目录名,等于 scenario.meta.id */
  moduleId: string;
  /** 玩家当前所在场景 id */
  currentSceneId: string;
  /** 已访问过的场景 id 列表(去重,按访问顺序追加) */
  visitedSceneIds: string[];
  /** 已发现的线索 id 列表 */
  discoveredClueIds: string[];
  /** 已解锁 secret 的 NPC id 列表(secret_unlock_trigger 满足后入册) */
  unlockedSecretIds: string[];
  /** NPC 当前态度。键 = NpcId,值 = NpcAttitude;缺省走 npc.initialAttitude */
  npcAttitude: Record<string, ScenarioNpcAttitude>;
  /** flag 当前布尔状态。键 = FlagId;缺省走 flag.initial */
  endingFlags: Record<string, boolean>;
  /**
   * 游戏内已推进的累计分钟数(基于 meta.startTime 的偏移)。
   * Phase 2 仅前端累加,不接日历驱动效应(疯狂日切/HP 恢复留 V2)。
   */
  elapsedMinutes: number;
  /** 已触发的 timeline event id 列表(once: true 的归档用;Phase 2 timeline 驱动留 V2) */
  triggeredTimelineIds: string[];
}

/**
 * 与 scenario.ts 的 NpcAttitude 同口径,这里复制一遍避免存档类型反向依赖 schema。
 * 校验时通过运行时常量比对,不强引用 schema 类型。
 */
export type ScenarioNpcAttitude =
  | "hostile"
  | "wary"
  | "neutral"
  | "friendly"
  | "trusting";

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
  /**
   * LLM 调用失败的系统卡专用:为 true 时渲染"重新生成"按钮,
   * 点击后用 retryHistorySnapshot 中保存的 history 快照 + retryFeatures 重发请求。
   * 仅 sender === "system" 的错误卡会带这些字段。
   */
  retryable?: boolean;
  retryHistorySnapshot?: ChatMessage[];
  retryFeatures?: { typemoon: boolean; scp: boolean };
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

export const QINY_REGISTER_URLS: Record<QinyHostKind, string> = {
  com: "https://openai.chatnewai.com/register?aff=btB0",
  icu: "https://love.qinyan.icu/register?aff=btB0",
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

export const QINY_DEFAULT_LLM_MODEL = "gemini-3.5-flash-low";
export const QINY_DEFAULT_IMAGE_MODEL = "gpt-image-2";

export const DEFAULT_API_SETTINGS: ApiSettings = {
  llm: { provider: "qiny", apiKey: "", model: QINY_DEFAULT_LLM_MODEL, customBaseUrl: "", qinyHost: "com" },
  image: { provider: "qiny", apiKey: "", model: QINY_DEFAULT_IMAGE_MODEL, qinyHost: "com" },
};

// Kept for legacy imports. Defaults to the .com host.
export const QINY_BASE_URL = QINY_BASE_URLS.com;

export function resolveQinyBaseUrl(host: QinyHostKind | undefined): string {
  return QINY_BASE_URLS[host ?? "com"];
}

export function resolveQinyRegisterUrl(host: QinyHostKind | undefined): string {
  return QINY_REGISTER_URLS[host ?? "com"];
}

export interface LogEntry {
  id: string;
  timestamp: number;
  direction: "request" | "response" | "error" | "info";
  content: string;
  meta?: any;
}

export type ServerLogDraft = Omit<LogEntry, "id" | "timestamp">;
