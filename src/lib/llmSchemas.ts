/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 共享 JSON Schema 定义。
 *
 * 浏览器端 dispatcher（src/lib/llmClient.ts）会把这些 schema：
 * - Gemini：作为 responseSchema 传入 generationConfig，REST API 接受小写 type
 *   字符串（"object" / "string" / "integer" / "boolean" / "array"）。
 * - Anthropic / OpenAI 兼容：通过 schemaToPromptDescription 序列化进 system
 *   prompt，让模型按 json_object 输出。
 *
 * 历史上这些 schema 写在 server.ts 里，type 字段是 `Type.OBJECT` 这种
 * `@google/genai` 的枚举。迁到浏览器后 SDK 已下线，统一用纯字符串字面量。
 */

export const KEEPER_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    narrative: {
      type: "string",
      description: "KP的场景旁白、周围氛围描写、不可名状感受。支持Markdown排版（加粗、列表、斜体）来使得叙事更加惊艳、排版舒适。必须包含完整的旁白与局势描写。不能留空。",
    },
    rollRequest: {
      type: "object",
      properties: {
        skillName: { type: "string", description: "需要检定的属性或技能名称（例如：侦查, 聆听, 神秘学, 心理学, 意志, 力量, 说服, 敏捷等）" },
        targetValue: { type: "integer", description: "根据玩家卡片或规则，角色应该满足的该技能/属性的最大成功目标值（一般在 1-99 之间，包含该数值）" },
        difficulty: { type: "string", description: "检定难度等级，必须是 'regular' (常规成功即可), 'hard' (必须要困难成功, 即 <= 技能的一半), 'extreme' (必须要极难成功, 即 <= 技能的五分之一) 之一" },
        reason: { type: "string", description: "进行此检定的原因描述。例如：在书房的杂乱字迹中翻找关于型月魔术回路的隐秘记录" },
        bonus: { type: "integer", description: "守密人裁定的奖励骰数量，取值**必须**是 0、1 或 2 之一。处境对调查员明显有利（充裕时间、合适工具、同伴有效协助、有利地形等）时给出。与 penalty 互斥；不给则填 0。**禁止下发 3 或更大**——前端会硬裁剪到 2。" },
        penalty: { type: "integer", description: "守密人裁定的惩罚骰数量，取值**必须**是 0、1 或 2 之一。处境对调查员明显不利（负伤、被催促、能见度差、装备不顺、半心半意行动等）时给出。与 bonus 互斥；不给则填 0。**禁止下发 3 或更大**——前端会硬裁剪到 2。" },
      },
      required: ["skillName", "targetValue", "difficulty", "reason"],
      description: "玩家明骰检定。**仅在系统提示规则 4.0 节的三要件全部满足且触发源为 A 或 B 时填写**——结果不确定 + 失败有意义后果 + 玩家显式声明了具体技能行为或剧情客观施加了规则要求的判定（如踩陷阱、被追逐、被偷袭）。任一要件不满足、或玩家只是做了无悬念的纯叙事动作（走路、开门、打招呼、随口闲聊）→ **必须填 null**，由 narrative 直接推进。投骰是例外，不是默认；绝大多数回合本字段都应为 null。",
    },
    sanityCheck: {
      type: "object",
      properties: {
        lossOnSuccess: { type: "string", description: "掷骰成功时损失的San度（例如：'0', '1', '1d2', '1d3'）" },
        lossOnFailure: { type: "string", description: "掷骰失败时损失的San度（例如：'1d4', '1d6', '1d10', '1d20', '3d6'）" },
        reason: { type: "string", description: "引发理智惊悚和狂乱冲击的原因。" },
      },
      required: ["lossOnSuccess", "lossOnFailure", "reason"],
      description: "如果场景事件激发了玩家的San值惊心时刻，将其填充。无则设为 null。",
    },
    clue: {
      type: "object",
      properties: {
        title: { type: "string", description: "线索的简要标题" },
        type: { type: "string", description: "物品类别，必须是 'note', 'photo', 'marking', 'book', 'artifact' 之一" },
        description: { type: "string", description: "对该线索记录的内容描述。" },
        prompt: { type: "string", description: "可选。仅当线索含有 description 无法替代的视觉细节（符号、照片、异常器物、文书上的图示/印章等）时，提供供 AI 画图模型使用的极详细英文提示词；纯文字 note/book 请省略本字段。" },
      },
      required: ["title", "type", "description"],
      description: "线索档案条目，仅在玩家调查行动成功且产出有价值信息、或玩家明确获得重要道具/文档时填写。详见系统提示规则 6。普通场景描写或玩家尚未调查的视觉勾子请用 sceneImage 而非本字段。无则设为 null。",
    },
    sceneImage: {
      type: "object",
      properties: {
        caption: { type: "string", description: "一句话描述该图像内容（如\"祭坛石板上深刻的螺旋符号\"、\"墙角散落的褪色照片\"）。玩家会在聊天卡片里直接看到这句话。" },
        type: { type: "string", description: "图像所表现物体的物理形态，与 clue.type 同枚举，必须是 'note', 'photo', 'marking', 'book', 'artifact' 之一。玩家点击\"收录线索\"时会沿用该 type。" },
        prompt: { type: "string", description: "供 AI 画图模型使用的极详细英文提示词，富含暗黑写实、克苏鲁色调质感。沒有可画内容则不要发本字段。" },
      },
      required: ["caption", "type", "prompt"],
      description: "对话中即兴的视觉占位卡：场景里出现值得让玩家\"看到\"但尚未构成档案线索的视觉元素时使用（远处的符号、桌上的照片、奇怪的刻痕等）。前端将以单独起行的\"显示图像\"按钮卡呈现，玩家点击后才请求画图；展开后可一键\"收录线索\"。**不要**同回合既发 clue 又发 sceneImage 描述同一对象。无则设为 null。",
    },
    characterUpdates: {
      type: "object",
      properties: {
        hpChange: { type: "integer", description: "确定性的生命变动(整数)。仅用于剧情设定的固定值,如固定 5 点恢复。带随机性时改用 hpDamageFormula / hpHealFormula。" },
        mpChange: { type: "integer", description: "确定性的魔法值变动(整数)。带随机性时改用 mpCostFormula。" },
        sanChange: { type: "integer", description: "确定性的 San 值强制变动(整数)。带随机性时改用 sanLossFormula(且独立于 sanityCheck 路径)。" },
        sanitySkillGain: { type: "integer", description: "永久提升的克苏鲁神话技能点。" },
        hpDamageFormula: { type: "string", description: "玩家受伤的伤害公式,形如 'NdM[+常数][/除数]'(例:'1d6'、'2d4+1'、'1d10/2')。前端会弹效果骰浮窗演投。与 hpChange 互斥;同时下发时前端按公式优先。" },
        hpHealFormula: { type: "string", description: "急救/医学等治疗公式,正向回血,例 '1d3'。前端弹效果骰浮窗。与 hpChange(正向部分)互斥。" },
        mpCostFormula: { type: "string", description: "魔法反噬等魔力消耗公式,例 '1d4'。前端弹效果骰浮窗。与 mpChange(消耗部分)互斥。" },
        sanLossFormula: { type: "string", description: "大失败叙事附带的强制 SAN 损失公式,例 '1d6'。独立于 sanityCheck 路径(后者已自带 lossOnSuccess/lossOnFailure)。前端弹效果骰浮窗。与 sanChange(负向部分)互斥。" },
        cashChange: { type: "integer", description: "现金余额增减量(正进负出),例 +50 / -120。例:玩家在场景里捡到钱、被勒索、买东西付款。与 cashSetTo 互斥;同时下发时按 cashSetTo 优先。前端会钳制 cashBalance ≥ 0(透支自动归零)。" },
        cashSetTo: { type: "integer", description: "把现金余额重置到指定值(整数,≥ 0)。仅在剧情上需要『全部清空 / 重置到某个具体数额』时使用,如被洗劫一空 cashSetTo: 0。优先于 cashChange。" },
        ammoUpdates: {
          type: "array",
          description: "武器槽弹药变动数组。仅作用于 kind=\"weapon\" 且 maxAmmo>0 的槽位(近战 / 投掷武器 maxAmmo=0 不接受弹药变动);非武器槽 / 越界 slotIndex 前端静默跳过。每项二选一下发 ammoDelta(增减量)或 ammoSetTo(重置值);同项同时下发时按 ammoSetTo 优先。前端钳制 ammo ∈ [0, weapon.maxAmmo]。例:射击两发后下 [{slotIndex: 3, ammoDelta: -2}];换弹满到 [{slotIndex: 3, ammoSetTo: 6}]。",
          items: {
            type: "object",
            properties: {
              slotIndex: { type: "integer", description: "目标槽位下标,0-based,对应玩家 inventory 数组(共 8 槽)。" },
              ammoDelta: { type: "integer", description: "弹药增减量(正补充负消耗)。与 ammoSetTo 互斥。" },
              ammoSetTo: { type: "integer", description: "把弹药重置到指定值(整数,≥ 0)。优先于 ammoDelta。" },
            },
            required: ["slotIndex"],
          },
        },
      },
      description: "由当前非掷骰的突发剧情直接引发的属性指标变化。同类属性的整数字段与 *Formula 字段二选一下发(详见各字段说明)。**现金 / 弹药**变动也走本通道(cashChange / cashSetTo / ammoUpdates),不要凭空在 narrative 里口头报数;前端会自动结算并把变动写入 LogEntry 通知玩家。无变动则设为 null。",
    },
    npcDialogue: {
      type: "object",
      properties: {
        name: { type: "string", description: "NPC名字" },
        text: { type: "string", description: "NPC台词" },
      },
      required: ["name", "text"],
      description: "NPC说话台词。无则设为 null。",
    },
    keeperRoll: {
      type: "object",
      properties: {
        skillName: { type: "string", description: "守秘人方需要检定的技能或属性名称" },
        targetValue: { type: "integer", description: "目标胜出条件所需的上限属性成功限度值（1-99之间）" },
        difficulty: { type: "string", description: "判定难度级别，'regular', 'hard', 'extreme' 之一" },
        isSecret: { type: "boolean", description: "是否暗骰。判定原则：玩家若提前知道掷骰发生过会破坏沉浸（隐藏的侦查/聆听、潜行被发现判定、被欺瞒方的心理学、揭露恐怖前的SAN等）→ 暗骰；公开后果且玩家应直接看到的 → 明骰" },
        reason: { type: "string", description: "原因。暗骰时务必写得叙事化、避免暴露机制（不要提技能名/数值/难度），可以表达氛围（如：'某个细节让她后背一阵发凉'）" },
        bonus: { type: "integer", description: "守密人裁定的奖励骰数量，取值**必须**是 0、1 或 2 之一。与 penalty 互斥；不给则填 0。**禁止下发 3 或更大**——前端会硬裁剪到 2。" },
        penalty: { type: "integer", description: "守密人裁定的惩罚骰数量，取值**必须**是 0、1 或 2 之一。与 bonus 互斥；不给则填 0。**禁止下发 3 或更大**——前端会硬裁剪到 2。" },
      },
      required: ["skillName", "targetValue", "difficulty", "isSecret", "reason"],
      description: "守秘人替 NPC / 环境进行的明骰或暗骰。**仅在系统提示规则 4.0 节的三要件全部满足时填写**——结果不确定、失败有有意义后果、且场景客观需要 NPC 或环境进行一次判定（NPC 心理学对抗、隐藏怪物潜行接近、暗中聆听、命运豁免等）。无悬念的 NPC 行为（普通对话、明显的环境结果）→ **必须填 null**，由 narrative 直接推进。",
    },
    gameState: {
      type: "object",
      properties: {
        moduleName: { type: "string", description: "当前模组名称" },
        currentLocation: { type: "string", description: "当前场景" },
      },
      required: ["moduleName", "currentLocation"],
      description: "状态同步数据，必须返回最新状态。",
    },
    scenarioEnd: {
      type: "object",
      properties: {
        kind: { type: "string", description: "终局类型,必须是 'dying' / 'dead' / 'insane' / 'victory' / 'ambiguous' 之一。坏结局:dying = 单回合垂死窗口(玩家可输入纯叙事遗言);dead = 死亡终局(封盘);insane = 永久疯狂终局(SAN=0,精神被吞噬,封盘)。模组好/灰结局:victory = 调查员阻止核心威胁、活着、模组通关;ambiguous = 灰色结局(线索断、阻止部分失败、被卷入更大阴谋等),角色活着但答案没给完。" },
        epilogue: { type: "string", description: "尾声 Markdown 文本(150-300 字)。仅在 kind ∈ {dead, insane, victory, ambiguous} 时填写;dying 时省略或留空。各 kind 尾声口径:dead = 肉体毁灭的克制感官记忆;insane = 精神崩溃的非语言性场景('她最后写下的字迹已经不属于她的语言');victory = 调查员从恐怖中全身而退,但克系基调保留(没人真正全身而退,只是侥幸);ambiguous = 悬而未决('她合上笔记本,知道自己永远不会再回到那里')。" },
      },
      required: ["kind"],
      description: "终局闸字段。**绝大多数回合应填 null**——只在以下情况由 KP 主动下发:① 救起分支收到 [终局闸 dying 标记] 选择放弃救起直接写死亡尾声(dead);② 收到 [终局闸 dead/insane 标记] 一次性致命伤或 SAN=0 时填对应 kind + epilogue;③ 你判断模组主线已经走完、玩家完成所有核心目标,主动下发 victory + epilogue;④ 你判断模组主线已走到尽头但留下未解之谜或道德困境,主动下发 ambiguous + epilogue。**救起分支** scenarioEnd 必须为 null。dying/dead/insane 前端也会在 HP / SAN 检测后强制注入,你不需要主动判断阈值;但 victory/ambiguous 只能由你判断,前端不会自动触发。无终局态时设为 null。",
    },
    madnessRecover: {
      type: "boolean",
      description: "不定期疯狂解除信号(规则 10 indefinite C 路径)。**绝大多数回合必须填 null**。仅当上下文里出现 [疯狂干涉·不定期疯狂] 标记、且本回合剧情中**明确发生**了心理治疗事件(NPC 心理医生介入、调查员通过 Psychotherapy 技能成功自疗、剧情明确给出长期休养时段)且你判断治疗合理生效时,才填 true。bout / temporary 由前端自动倒计时解除,**禁止**因 bout/temporary 下发本字段。",
    },
  },
  required: ["narrative", "gameState"],
} as const;

export const GENERATE_MODULE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "模组标题" },
    intro: { type: "string", description: "150-250字氛围引子" },
    recommendedOccupations: {
      type: "array",
      items: { type: "string" },
      description: "推荐3-4个PC职业",
    },
    presets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "调查员姓名，仅中文汉字，禁止任何英文译名、括号注音或拼音" },
          occupation: { type: "string", description: "职业" },
          gender: { type: "string", description: "男 或 女" },
          age: { type: "integer", description: "年龄 23-55" },
          overview: { type: "string", description: "100-150字概述" },
          attributes: {
            type: "object",
            properties: {
              str: { type: "integer" }, con: { type: "integer" }, siz: { type: "integer" },
              dex: { type: "integer" }, app: { type: "integer" }, int: { type: "integer" },
              pow: { type: "integer" }, edu: { type: "integer" }, luck: { type: "integer" },
            },
            required: ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"],
          },
          skills: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                value: { type: "integer" },
              },
              required: ["name", "value"],
            },
            description: "正好8~9门核心技能",
          },
        },
        required: ["name", "occupation", "gender", "age", "overview", "attributes", "skills"],
      },
      description: "正好3个预设调查员",
    },
  },
  required: ["title", "intro", "recommendedOccupations", "presets"],
} as const;

export const GENERATE_STATS_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "调查员中文姓名，仅汉字，禁止任何英文译名、括号注音或拼音" },
    occupation: { type: "string", description: "职业（CoC 7e 标准模板中文名优先，例如「医师」「私家侦探」；非标准时输出自由文本）" },
    identity: { type: "string", description: "角色身份（自由文本，非空）" },
    nationality: { type: "string", description: "国籍（如「英国」「中国」「美国」等中文短语）" },
    residence: { type: "string", description: "居住地（具体城市/地区）" },
    motherTongue: { type: "string", description: "母语（中文短语，例如「汉语」「英语」）" },
    creditRating: { type: "integer", description: "信用评级（0-99，按职业合理估算）" },
    attributes: {
      type: "object",
      properties: {
        str: { type: "integer" }, con: { type: "integer" }, siz: { type: "integer" },
        dex: { type: "integer" }, app: { type: "integer" }, int: { type: "integer" },
        pow: { type: "integer" }, edu: { type: "integer" }, luck: { type: "integer" },
      },
      required: ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"],
    },
    skills: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, value: { type: "integer" } },
        required: ["name", "value"],
      },
      description: "5-8个核心技能",
    },
  },
  required: ["name", "occupation", "attributes", "skills"],
} as const;
