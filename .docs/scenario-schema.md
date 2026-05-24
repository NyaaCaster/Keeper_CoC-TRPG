# Scenario Schema · 「基于剧本游戏模式」模组数据契约 (v1.0)

> 状态:**已定稿**(2026-05-24,2026-05-25 增补 §14 narrative_style)。Phase 1.1 产物。下一步:据此落 `src/data/modules/_schema/scenario.ts` 与 `validator.ts`。
>
> 决策落点(对照 [[project-scenario-based-mode]] memory):
> - **不做 NPC 立绘集**:游戏保持文字交互,必要图形信息走现有 `KeeperResponse.sceneImage` 通道
> - **timeline 做且线性**:按 7e 时间规则,前端日历驱动疯狂日切/HP 恢复等
> - **删多语言**:无 `_en` 后缀字段
> - **保留 `requires-skill` 边**:与 `requires-clue` 语义不同,不合并
> - **删 `meta.time_defaults`**:7e 已规定时间惯例,不该硬编码两个数字
> - **加 `narrative_style` 顶层节(§14)**:LLM 跨模组扮演 KP 时,从模组数据本身读出文风指导;frame=必须遵守 / freedom=可挑用,sample_paragraph_md 是核心抓手

## 0 · 设计原则

1. **三槽分离**:每个剧本节点同时声明 `frame`(LLM 不可篡改的事实)、`freedom`(允许 LLM 二度创作的语料库)、`forbidden`(红线)。这是与"LLM 生成模式"最本质的区别——自由度边界写在数据里。
2. **KP 视角与玩家视角分槽**:`*_player_md` 是玩家初见时可叙事化的描述;`*_kp_md` / `secret_*` 是 KP 机密,只有满足 unlock 条件后才会进 LLM 上下文。
3. **ID 全局唯一、强类型前缀**:`scene.kitchen` / `clue.diary` / `npc.elder` / `ending.good` / `flag.ritual-disrupted` / `tl.first-disappearance`。校验器靠这个识别引用。
4. **Markdown 写正文,YAML 写结构**:多行叙事文字用 `|` 块字符串。可用 `**强调**` 等 Markdown,**禁用** HTML 标签(防 XSS,前端用 `MarkdownText.tsx` 渲染)。
5. **MVP 范围**:线性主线 + 1~2 个 ending(至少一个 victory/ambiguous,加可选 dead/insane);timeline 线性、不分支;不做 NPC 立绘。

---

## 1 · 顶层结构

```yaml
schema_version: 1                # 整数,破坏性变更才 +1
meta: { ... }                    # 模组身份与展示信息
hook: { ... }                    # 楔子与起点
scenes: [ ... ]                  # 场景图(节点)
npcs: [ ... ]                    # NPC 表
clues: [ ... ]                   # 线索表
timeline: [ ... ]                # 时间表(线性,按 fires_when 升序)
flags: [ ... ]                   # 进度旗帜
endings: [ ... ]                 # 结局表
global_freedom: { ... }          # 整本模组通用的 freedom 语料
global_forbidden: [ ... ]        # 整本模组通用的红线
```

---

## 2 · `meta`:模组身份

```yaml
meta:
  id: one-nest-of-trouble          # kebab-case,目录名一致,全局唯一
  title: 一窝麻烦                   # 玩家可见标题
  era: 1920s                       # 1920s | modern | other (other 配 era_note)
  era_note: ~                      # 选填,描述非标准时代
  language: zh-CN                  # 主叙事语言
  recommended_investigators: { min: 1, max: 3 }
  expected_hours: { min: 3, max: 5 }
  difficulty: 标准                  # 入门 | 标准 | 高强度 | 致命
  tags: [都市, 调查, 邪教]          # UI 筛选用
  cover: assets/cover.jpg          # 选填,模组选择卡封面
  start_time:                      # 模组开局的绝对时间锚点(timeline 与日历驱动用)
    game_day: 1                    # 整数,从 1 起
    hour: "09:00"                  # 24h 制 "HH:MM"
  synopsis_md: |
    给玩家看的一句话简介,显示在模组选择卡片上。不剧透关键诡计。
  author_credits_md: |
    原作者 / 中文化译者 / 本项目转写者;尊重原作版权。
```

**校验**:
- `id` 必须等于其所在目录名
- `cover` 文件必须存在(若声明)
- `era` ∈ 枚举或 `other`+`era_note`
- `start_time.game_day >= 1`,`hour` 必须 `^\d{2}:\d{2}$` 格式且 24h 合法

---

## 3 · `hook`:楔子与起点

```yaml
hook:
  start_scene: scene.opening           # 必须是 scenes 里某个 id
  prologue_md: |
    给玩家朗读的楔子(KP 第一回合 narrative 的素材)。
    LLM 必须在第一回合用这段文字的精神开场,允许文风改写。
  call_to_action_md: |
    调查员被卷入此事的钩子。
  default_initial_clues: []            # 选填,开局即入册的线索 id 列表
```

**校验**:`start_scene` 必须存在于 `scenes` 中。

---

## 4 · `scenes`:场景图(核心)

每个场景是有向图节点。LLM 上下文窗口只看"当前 + 相邻 + 已访问"。

```yaml
scenes:
  - id: scene.kitchen
    title: 厨房

    # === FRAME:不可篡改的事实 ===
    frame:
      summary_md: |
        玩家初次进入时,LLM 应基于此段叙事化描写。事实不可改,修辞可改。
      facts:                           # 离散事实,LLM 任何回合都不可违反
        - 桌上有一封未拆的信
        - 后门反锁着,钥匙不在屋里
        - 灶台还有余温(暗示主人刚走)
      kp_secret_md: |                  # 仅 KP 视角
        信封背面有一道指纹,与 npc.elder 的指纹匹配。
        玩家通过 clue.fingerprint 解锁后,本段才进 LLM 上下文。
      exits:                           # 合法出口(有向边)
        - to: scene.living-room
          condition: free
          label: 推开虚掩的门
        - to: scene.basement
          condition: requires-clue
          required_clue: clue.basement-key
          label: 用钥匙开地下室门
        - to: scene.attic
          condition: requires-flag
          required_flag: flag.ladder-found
          required_value: true
          label: 通过梯子上阁楼
        - to: scene.cliff-top
          condition: requires-skill
          required_skill: Climb
          difficulty: regular           # regular | hard | extreme
          label: 攀爬上悬崖
          on_failure_consequence: ~     # 选填,如 "hp:1D6"(摔伤);默认 LLM 自由化处理
      npcs_present: [npc.kondo]        # 默认在场 NPC,可被运行时改写
      available_clues: [clue.letter, clue.fingerprint]
      assets:                          # 玩家可见资产(选填)
        map: assets/maps/kitchen.png
        ambient_image: assets/scenes/kitchen.jpg

    # === FREEDOM:允许 LLM 二度创作的语料库 ===
    freedom:
      mood_tags: [压抑, 潮湿, 微腥]
      sensory_palette:                 # LLM 可挑用,不必全用
        sight: 油渍斑驳的瓷砖、晃动的拉绳灯
        sound: 滴水声、远处的狗吠
        smell: 隔夜油烟混着铁锈味
        touch: 桌面有黏腻的油膜
      improvisable_props:              # 可临时编入但不影响主线的次要物件
        - 冰箱上的一张老照片
        - 抽屉里的一把生锈剪刀
      npc_action_hints:                # NPC 在此场景的可发挥行为(非台词)
        npc.kondo: [背对玩家洗碗, 不愿对视]

    # === FORBIDDEN:本场景红线 ===
    forbidden:
      - 不要让玩家在厨房直接看到真凶或听到自白
      - 不要描写 1920 时代不存在的物件(冰箱以煤油式描述)
      - 不要主动揭示 secret_*,除非玩家发现对应 clue
```

### `exits[].condition` 枚举

| 值 | 配套字段 | 语义 | 前端校验 |
|---|---|---|---|
| `free` | — | 无条件可走 | 直接放行 |
| `requires-clue` | `required_clue: <id>` | 需已发现指定 clue | `discoveredClueIds` 含此 id |
| `requires-flag` | `required_flag: <id>`, `required_value: true\|false` | 需 flag 状态匹配 | `endingFlags` 匹配 |
| `requires-skill` | `required_skill: <name>`, `difficulty`, 选填 `on_failure_consequence` | 需当回合声明该技能并投骰成功 | 本回合 rollResult 含成功的对应技能投骰 |

**关于 `requires-skill` 与 clue 路径的语义区分**:
- `requires-skill` 是"靠当回合行动成功**通过**的边"(例:攀爬、撞门、强行游泳)——玩家**不会**在线索本里看到"攀上悬崖"
- `requires-clue` 是"靠探索/进度**解锁**的边"(例:找到地下室钥匙)——玩家**会**在线索本里看到对应条目
- 二者语义不同,不能互相替代。技能成功的"行动结果"不应污染线索本。

### `available_clues` 字段语义

仅声明"该场景可发现哪些 clue 候选";具体能否发现由 `clue.discovery` 条件决定。

### 校验

- `id` 全局唯一
- 所有 `to` / `npcs_present` / `available_clues` / `required_*` 引用必须存在
- 从 `hook.start_scene` BFS,所有非孤立场景必须可达
- 至少有一条边能走到任意结局
- `requires-skill` 的 `required_skill` 必须是 `cocSkills.ts` 已注册的技能

---

## 5 · `npcs`:NPC 表

```yaml
npcs:
  - id: npc.elder
    name: 井川博巳
    role: 反派                        # 平民 | 盟友 | 对立 | 反派 | 中立
    initial_location: scene.living-room
    initial_attitude: friendly       # hostile | wary | neutral | friendly | trusting

    frame:
      public_persona_md: |
        50 岁村长,带县口音,村民信任他,擅长打太极。
        玩家初见时只能感受到这层。
      secret_md: |
        实际上是邪教骨干,负责献祭仪式。
        secret_unlock_trigger 触发后才进 LLM 上下文。
      secret_unlock_trigger: clue.elder-diary    # clue id 或 flag id
      stats:                          # 战斗相关数值,前端硬规则用
        str: 45
        con: 50
        siz: 55
        dex: 40
        app: 55
        int: 65
        pow: 70
        edu: 60
        hp: 11
        mp: 14
        san: 0                        # 已发狂的 NPC 标 0
      combat:
        weapon: 猎枪
        damage_formula: 4D6           # 走 src/lib/diceFormula.ts 同款语法
        skill_value: 50               # 武器技能值
      voice_guidelines:               # frame:不可违反的人设核心
        - 总是先用敬语再用方言
        - 拒绝直接谈"村东头"的事
        - 被识破时会改用威胁语气

    freedom:
      improvisable_quirks:            # LLM 可挑用的次要习癖
        - 抚摸念珠
        - 突然咳嗽打断话题
      catchphrases: [这都是命啊, 年轻人不懂的]

    forbidden:
      - 在 secret 解锁前不要主动暗示反派身份
      - 不要让 NPC 自爆动机
```

**注**:本项目不做 NPC 立绘集。NPC 视觉信息(若必要)由 LLM 通过 `KeeperResponse.sceneImage` 通道按需触发画图。

**校验**:
- `secret_unlock_trigger` 引用的 clue/flag 必须存在
- `initial_location` 必须是已声明场景
- `combat.damage_formula` 通过 `diceFormula.ts` 解析校验

---

## 6 · `clues`:线索表

```yaml
clues:
  - id: clue.elder-diary
    title: 井川博巳的日记

    frame:
      location_scene: scene.elder-house-2f      # 唯一发现地点
      discovery:
        method: skill                            # skill | flag | npc-give | auto-on-enter
        skill: SpotHidden
        difficulty: hard                         # regular | hard | extreme
        # 或者:
        # method: npc-give
        # giver_npc: npc.kondo
        # condition_flag: flag.kondo-trusts-pc
      reveal_md: |
        玩家发现时呈现的全文。可重读,内容固定。
      kp_note_md: |                              # KP 备注(选填)
        发现后立刻解锁 npc.elder.secret。
      unlocks:                                   # 发现后触发的连锁解锁
        secrets: [npc.elder]                     # 解锁该 NPC 的 secret
        scenes: [scene.hidden-shrine]            # 新增可达场景
        flags: [flag.elder-exposed]              # 设旗
      asset: assets/handouts/diary-page.png      # 选填,玩家可见的道具图

    freedom:
      sensory_when_found_md: |                   # "发现"时刻的氛围语料
        翻动纸页时一股霉味、最后一页有淡褐色血指印;可挑用。
      red_herrings_allowed:                      # 允许 LLM 描绘的烟雾弹细节
        - 提到一个无关人名以增厚真实感

    forbidden:
      - 即使 SpotHidden 失败,也不要直接把日记内容透露给玩家
      - 不要在被发现前提及"日记"二字
```

### `discovery.method` 枚举

| 方法 | 配套字段 | 语义 |
|---|---|---|
| `skill` | `skill`, `difficulty` | 当回合声明配套技能并投骰成功 |
| `flag` | `condition_flag` | 指定 flag 满足时即可获得(玩家无需主动操作) |
| `npc-give` | `giver_npc`, 选填 `condition_flag` | 特定 NPC 在条件下交付 |
| `auto-on-enter` | — | 进入 `location_scene` 即自动入册 |

### LLM 与 rollRequest 的衔接

`discovery.method: skill` 的发现链路(Phase 2 的 prompt 节会明确):
1. LLM 在场景描述里**暗示**有可疑之处(`forbidden` 限定不能直说)
2. 玩家声明动作(如"我搜索房间")
3. LLM 按 SYSTEM_INSTRUCTION 4.0 三要件 + clue 的 `discovery.skill/difficulty` 发 `rollRequest`
4. 投骰成功后,LLM **下一回合**才能发 `scenarioActions.clueDiscovered`,前端校验本回合确有该技能成功投骰才放行

### 校验

- `location_scene` 必须存在
- `unlocks.secrets[]` / `unlocks.scenes[]` / `unlocks.flags[]` 引用必须存在
- `discovery.skill` 必须是 `cocSkills.ts` 已注册的技能
- `discovery.condition_flag` / `discovery.giver_npc` 引用必须存在

---

## 7 · `timeline`:时间表(7e 规则线性日历)

```yaml
timeline:
  - id: tl.first-disappearance
    title: 村东头第一户失踪

    fires_when:                       # 绝对时间(基于 meta.start_time)
      game_day: 2
      hour: "23:00"                   # 24h 制
    forced: true                      # true=到点必触发 / false=需 prerequisites 满足
    prerequisites: []                 # 选填,与 forced=false 配合;flag/clue 条件
    once: true                        # 默认 true,触发后归档

    frame:
      narrative_seed_md: |
        给 LLM 的"事件刚发生"叙事种子。LLM 必须在该回合的 narrative 里
        引入此事件,具体笔法可发挥。
      effects:                        # 触发时立即生效的副作用(全部选填)
        set_flags: [{ flag: flag.first-victim, value: true }]
        unlock_scenes: [scene.east-house]
        unlock_clues: []
        force_scene_transition: ~     # 强制把玩家拉到某场景
        npc_relocate:
          - { npc: npc.kondo, to: scene.shrine }
        san_check:
          loss: { success: 0, fail: 1D4 }
          reason: 听见远处的惨叫

    freedom:
      atmosphere_md: 夜雨刚停、远处犬吠、空气里有铁腥味

    forbidden:
      - 不要解释凶手是谁,只描述结果与现场反应
```

### 7e 时间推进规则(前端日历驱动)

`meta.start_time` 是绝对锚点(如 `day:1, 09:00`)。**前端**维护游戏内日历,按以下规则推进:

| 来源 | 推进量 | 说明 |
|---|---|---|
| LLM 在 `KeeperResponse.scenarioActions.timeAdvance` 声明 | `{ minutes, reason }` | LLM 按 7e 惯例自己拨表(见下方"7e 时间惯例对照表",Phase 2 写进 prompt) |
| 场景边声明 `transition_minutes`(选填) | 该数值分钟 | 显著长的位移用,如步行去邻村 180 分钟 |
| 战斗回合 | 不拨日历表 | 每回合 ≈ 5 秒,战斗内只在 timeAdvance 累计粒度上反映 |

### 7e 时间惯例对照表(Phase 2 写进 KP prompt,模组无需重声明)

| 行动 | 7e 标准时长 |
|---|---|
| 快速感官检定(侦查、聆听、心理学单次) | 几分钟 |
| 话术单次(说服、恐吓、魅惑一段对话) | 5~15 分钟 |
| 图书馆调查(Library Use)单次 | **半天 / 4 小时**(7e 明文) |
| 急救 / 医疗(配合 First Aid / Medicine) | 急救 5 分钟、医疗按伤势小时级 |
| 追踪 / 导航 | 小时级 |
| 跨城市旅行 | 按地理判断;模组若需精确,在 exits 上声明 `transition_minutes` |

LLM 据此在 `timeAdvance.minutes` 里填具体值;前端只负责累加日历、到点比对 `timeline.fires_when`、跨日触发后续日历驱动效应。

### 跨 game_day 的日历驱动效应(前端在 `App.tsx` 接通)

| 7e 机制 | 日切时前端动作 |
|---|---|
| 不定期疯狂 INT 检定 | 注入 `[疯狂干涉·日切] day N→N+1, 不定期疯狂可尝试 INT 检定` |
| HP 自然恢复(配合 First Aid) | +1 HP / 日(细则按 7e) |
| MP 完全恢复 | 跨 24 小时休息 → MP 拉满 |
| 临时疯狂解除 | 触发时刻起 1d10 小时后(以游戏时间累计) |

### 校验

- `timeline[]` 必须按 `fires_when (game_day, hour)` 升序排列(校验器报错"timeline must be sorted")
- `fires_when.game_day >= meta.start_time.game_day`
- `effects.unlock_scenes/clues` 与 `npc_relocate.npc/to` 引用必须存在
- `force_scene_transition` 引用必须存在
- `prerequisites` 引用的 flag/clue 必须存在
- `effects.san_check.loss.fail` 通过 `diceFormula.ts` 解析校验

---

## 8 · `flags`:进度旗帜

```yaml
flags:
  - id: flag.ritual-disrupted
    title: 仪式已被打断
    initial: false
    description_md: 玩家阻止了仪式;由 ending.good 监听
  - id: flag.elder-escaped
    title: 反派逃脱
    initial: false
  - id: flag.boss-defeated
    title: Boss 已被击杀
    initial: false
    writable_by: [scenario-actions]            # 选填,见下表;声明后校验器视该 flag 由 LLM 运行时写入
```

flags 是布尔状态机,由 `clue.unlocks` / `timeline.effects.set_flags` / `scenarioActions.flagSet`(Phase 2 落) 改写;终局靠 flag 组合触发。

### `writable_by` 字段语义

校验器做"结局可达性"分析时,需要知道每个 flag 的写入来源是否能产生 ending.triggers 要求的值。可选枚举:

| 值 | 来源 | 可写入值 |
|---|---|---|
| `clue-unlocks` | `clue.unlocks.flags` | 仅 `true` |
| `timeline-effects` | `timeline.effects.set_flags` | `true` 或 `false` |
| `scenario-actions` | 运行时 LLM `KeeperResponse.scenarioActions.flagSet`(Phase 2) | 校验阶段视为 `true` 和 `false` 都可达 |

**默认行为**:不声明 `writable_by` ⇒ 默认 `[clue-unlocks, timeline-effects]`,与 schema v1.0 行为一致。

**何时声明 `scenario-actions`**:战斗结果(`flag.boss-defeated`)、叙事抉择(`flag.alex-rescued`)等"运行时才能确定"的 flag。如果 ending.triggers 引用了它而 yaml 里没有对应的 clue/timeline 来源,**必须**显式声明 `writable_by: [scenario-actions]`,否则校验器报"结局不可达"。

> 设计意图:Phase 1 静态校验看不到 Phase 2 的运行时通道。靠 `writable_by` 让作者**显式承诺**该 flag 由运行时 LLM 写入,前端在 Phase 2 校验 `scenarioActions.flagSet` 时再核对实际写入是否合法。

**校验**:`id` 全局唯一;`writable_by` 中每个值必须 ∈ 上表枚举。

---

## 9 · `endings`:结局表

```yaml
endings:
  - id: ending.good
    title: 真相大白
    triggers:                                  # AND 逻辑;所有满足才触发
      - { flag: flag.ritual-disrupted, value: true }
      - { flag: flag.elder-exposed, value: true }
    priority: 10                               # 多 ending 同时满足时取 priority 高的

    frame:
      epilogue_md: |
        固定结局文本,LLM 必须按精神写出 narrative,允许文风改写。
      san_reward: 1D6                          # 选填,scenarioEnd 时前端结算
      experience_phase: true                   # 是否进入经验阶段
      scenario_end_kind: victory               # victory | ambiguous | dead | insane

    freedom:
      atmosphere_md: 黎明、鸟鸣、村民隔窗张望

    forbidden:
      - 不要写"幸福地结束了"——克系不会真的幸福
```

**MVP 范围**:至少 1 个 `victory`/`ambiguous`,加可选 `dead`/`insane`(对应已有终局闸)。

**校验**:
- 至少存在一个 `victory`/`ambiguous`
- 每个 ending 的 triggers 至少有一条**理论可达路径**(校验器从可设置 flag 的来源做可达性分析)
- `san_reward` 通过 `diceFormula.ts` 解析校验

---

## 10 · `global_freedom` / `global_forbidden`

整本模组通用,不必每个 scene 重复:

```yaml
global_freedom:
  era_atmosphere_md: |
    1920 年代东北农村:煤油灯、马灯、杂货铺。可挑用具体物件。
  language_register: 朴素口语,偶尔夹方言,避免现代网络用语
  npc_default_dialect: 东北口音

global_forbidden:
  - 不要主动提"克苏鲁""旧日支配者"等专名,用感官描写代替(对齐 SYSTEM_INSTRUCTION 第 8 节)
  - 不要让玩家在第一幕之前看到任何超自然实体
  - 不要写出本模组未声明的额外结局
```

---

## 11 · 资产路径规约

```
src/data/modules/<id>/
  scenario.yaml
  module.ts                  # 加载入口(import yaml + 调 validator + export)
  assets/
    cover.jpg                # 模组卡封面
    scenes/<scene-id>.jpg    # 场景氛围图(选填)
    maps/<scene-id>.png      # 场景地图(选填)
    handouts/<clue-id>.png   # 线索道具图(选填)
```

- yaml 中的 asset 路径写**相对** module 目录的路径,如 `assets/maps/kitchen.png`
- 校验器检查文件存在性
- 这些资产**进镜像**(对照 CLAUDE.md:`.docs/keeper-*.json` 是私有不进镜像;模组资产是公共进镜像)
- 引用方式:运行时通过 `/modules/<id>/<path>` 静态路由访问(Phase 2 在 `server.ts` 加),前端 `<img>` 直接用——**不**走 `/cache/images/*`(那是 LLM 画图的内容寻址缓存)
- 没有 `portraits/` 目录(本项目不做 NPC 立绘集)

---

## 12 · 完整最小样例(用于自测校验器)

```yaml
schema_version: 1

meta:
  id: minimal-demo
  title: 最小演示
  era: modern
  language: zh-CN
  recommended_investigators: { min: 1, max: 1 }
  expected_hours: { min: 1, max: 1 }
  difficulty: 入门
  tags: [演示]
  start_time: { game_day: 1, hour: "12:00" }
  synopsis_md: 用于校验器测试的最小模组。

hook:
  start_scene: scene.room
  prologue_md: 你站在一间陌生的房间里。
  call_to_action_md: 房门紧闭,你必须找到出去的方法。

scenes:
  - id: scene.room
    title: 陌生的房间
    frame:
      summary_md: 一间四壁空白的房间,中央有张桌子。
      facts: [桌上有把钥匙, 房门反锁]
      exits: []
      npcs_present: []
      available_clues: [clue.key]
    freedom:
      mood_tags: [疑惑]
      sensory_palette: { sight: 灰白墙面, sound: 自己的呼吸 }
    forbidden: [不要凭空创造新出口]

npcs: []

clues:
  - id: clue.key
    title: 桌上的钥匙
    frame:
      location_scene: scene.room
      discovery: { method: auto-on-enter }
      reveal_md: 你拿起一把铜钥匙。
      unlocks: { flags: [flag.has-key] }

timeline: []

flags:
  - id: flag.has-key
    title: 持有钥匙
    initial: false

endings:
  - id: ending.escape
    title: 逃出生天
    triggers: [{ flag: flag.has-key, value: true }]
    priority: 1
    frame:
      epilogue_md: 你打开门,走入光明。
      scenario_end_kind: victory
```

---

## 13 · 落 TS 时的字段命名约定

YAML key 用 `snake_case`(yaml 习惯),TS 类型用 `camelCase`(项目惯例,`KeeperResponse` 等都是)。`validator.ts` 在 parse 完 yaml 后做一次键名转换,运行时只暴露 camelCase。例:

```yaml
# yaml
fires_when:
  game_day: 2
  hour: "23:00"
```

```ts
// TS
firesWhen: { gameDay: 2, hour: "23:00" }
```

---

## 14 · `narrative_style`:模组叙事文风指导

> 顶层可选字段,Phase 2 拼 KP prompt 时按 `frame=必须遵守` / `freedom=可挑用` 注入。
>
> 设计哲学:**一段示范段落 > 十条抽象规则**。把"读起来什么感觉"显式写在数据里,LLM 才不会在跨模组扮演 KP 时滑回千篇一律的"恐怖小说脸"。

### 14.1 字段结构

```yaml
narrative_style:
  frame:                              # 必须遵守的"语法层"
    pov: 第二人称                      # 自由字符串,常见值见 §14.3
    tense: 现在时                      # 自由字符串
    forbidden_phrasings:              # 元描述类红线(关"怎么说",不关"说什么")
      - 不要写"调查员投出了 Spot Hidden 检定"
      - 不要使用第四面墙之外的全知评论

  freedom:                            # 可挑用的"语料池"
    sentence_pacing_md: |
      探索段落用 30~60 字中长句铺氛围,
      袭击与受惊瞬间切到 8~15 字短句。
    vocabulary_register: 现代美式都市口语,允许少量俚语,避免网络梗
    metaphor_palette:                 # 比喻意象池
      - 旧电影胶片的颗粒感与磁带嘶声
      - 便利店冷柜的低嗡
    reference_works:                  # 同温层参考(LLM 不引用,只对齐)
      - 史蒂芬·金《克莉丝汀》
      - 卡彭特《突袭十三号警区》
    sample_paragraph_md: |            # ★ 最重要,直接展示文风
      门吱呀一声推开。走廊里,灰雪一样的尘在你鞋底起伏。
      某处有东西在喘气——不像人,也不完全像狗。
```

### 14.2 frame / freedom 的语义区分

| 槽 | 语义 | 偏离代价 |
|---|---|---|
| `frame.pov` / `frame.tense` | 叙事人称、时态——一变就跳戏 | 高:LLM 哪怕换一段视角玩家就出戏 |
| `frame.forbidden_phrasings` | 元描述/元游戏术语红线 | 高:出现一次就破沉浸 |
| `freedom.sentence_pacing_md` | 节奏指导——情绪需要时可偏离 | 中:常态遵守,高潮时允许变格 |
| `freedom.vocabulary_register` | 词汇风格 | 中:大方向稳住即可 |
| `freedom.metaphor_palette` | 比喻意象池——挑用,不必命中 | 低:鼓励发散 |
| `freedom.reference_works` | 同温层参考 | 低:用于对齐口吻,**禁止** LLM 直接引用作品名 |
| `freedom.sample_paragraph_md` | 直接的文风范本 | 低:作为写作锚点参考 |

### 14.3 常见值参考(非枚举,纯建议)

`frame.pov`:`第二人称` / `第三人称克制` / `KP 直述(第二人称 + KP 偶尔以"我"插入旁白)`

`frame.tense`:`现在时`(主流) / `过去时`(回忆类模组)

### 14.4 校验规则

- **顶层结构**:`narrative_style` 必须是对象;`frame` / `freedom` 必须是对象
- **字段类型**:全部字段都是软约束,只校验类型,值是自由字符串/字符串数组
- **唯一硬警告**:`freedom.sample_paragraph_md` 长度超过 **200 字** 触发 `warning`(不致命),原因:示范段落贵在精,太长反而稀释 LLM 注意力
- 缺省整个 `narrative_style` 完全合法,scenario 走 LLM 默认文风

### 14.5 与 SYSTEM_INSTRUCTION 的关系

KP prompt 现有的"克系笔法"通用约束(对齐 SYSTEM_INSTRUCTION 第 8 节)继续生效,`narrative_style` 是**模组级覆写**:

- 模组没声明 → LLM 走 SYSTEM_INSTRUCTION 的通用克系笔法
- 模组声明了 → Phase 2 把 `frame` 作为高优先级注入,`freedom` 作为可选语料注入,优先级在 SYSTEM_INSTRUCTION 之上、模组 `forbidden` 之下

### 14.6 反例(写得不好的 narrative_style)

```yaml
# ❌ 反例:全是抽象形容词,LLM 抓不到具体特征
narrative_style:
  freedom:
    vocabulary_register: 恐怖、神秘、压抑
    sample_paragraph_md: 一切都很恐怖。
```

```yaml
# ❌ 反例:把"说什么"塞进了"怎么说"槽
narrative_style:
  frame:
    forbidden_phrasings:
      - 不要让玩家直接看到反派              # 这是 forbidden,不是 forbidden_phrasings
```

`forbidden_phrasings` 关的是**叙述方式**(术语、人称、元评论);情节/事实红线请写在 `scene.forbidden` / `global_forbidden`。

---

## 15 · 后续工作锚点

定稿即结束 Phase 1.1。下一步 Phase 1.2:

1. 落 `src/data/modules/_schema/scenario.ts`(TS 类型,SSOT,从本文档 §1-§10 + §14 按 13 节命名约定生成)
2. 落 `src/data/modules/_schema/validator.ts`(运行时校验:类型 / 引用完整性 / 场景图连通性 / 结局可达性 / timeline 升序 / 资产存在性 / `narrative_style` 软警告)
3. 配 `vite-plugin-yaml`,加 `npm run validate:modules`,挂 `prebuild`
4. 用 §12 最小样例先跑通校验器自测
5. **然后**进入「一窝麻烦」转写工作(用户提供 PDF 文本/截图,Claude 按本 schema 草拟,用户审,落地)
