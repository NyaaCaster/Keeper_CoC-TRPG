# Keeper_CoC-TRPG · Claude Code 启动简报

> 给 Claude Code 看的"项目快照"。每次开新会话先读这里 + `CLAUDE.md`，避免重新摸盘。
> 本文件描述的是**架构与协作契约**（不易过期），具体代码请以仓库当下状态为准。
> 若发现本文与代码冲突，请相信代码并顺手更新本文。

## 一句话定位

**LLM 演 KP，MCP 真随机骰，前端硬规则判。** 三者通过结构化 JSON 单向触发，互相挡住对方作弊。

## 技术栈速查

| 层 | 选型 |
|---|---|
| 前端 | Vite 6 + React 19 + TS 5.8 + Tailwind 4 + motion |
| 后端 | Express 4 + tsx(dev) / esbuild → CJS(prod) |
| LLM | gemini / anthropic / qiny / custom / grok / deepseek（**全部浏览器直连**） |
| 画图 | 仅 qiny；内容寻址缓存 `cache/images/<sha256>.png`，30 天滚动 TTL |
| 骰子 | NyaaChat-MCP `roll_coc`，`crypto.randomInt` 真随机；不可达时本地兜底 |
| 部署 | Docker 三阶段 `node:20-alpine`，单容器一体化，对外 `3093:3000` |

## LLM 在游戏里到底干什么

LLM **只**承担守密人（Keeper / KP）一个智能体身份：叙事、设场景、扮 NPC、判断"该不该投骰"、按 7e 规则召唤判定。它**不掷骰、不算伤害、不判生死、不写存档**——这些全归前端。

**角色契约**：`src/lib/keeperPrompt.ts` 的 `SYSTEM_INSTRUCTION`（~287 行）。修改提示词必从这里改，不要散落到别处。关键铁律编号：

| 节 | 主题 | 一句话总结 |
|---|---|---|
| 4.0 | 投骰前置三要件 | 不确定 + 失败有意义 + 触发源属玩家声明/剧情施加，否则填 `null` |
| 4.1 | 奖励/惩罚骰 | KP 全权裁定，玩家不可点单，上限 `0/1/2`，bonus 与 penalty 互斥 |
| 4.2 | 明骰 vs 暗骰 | 暗骰 `reason` 必须叙事化，技能名/数值会被打码 |
| 4.4 | 命运博弈 | 孤注一掷/燃运由前端裁定，LLM 只叙事化呼应 |
| 4.5 | 二阶段效果骰 | 带随机性走 `*Formula`，确定性走整数，二者互斥；只支持单组 `NdM[+const][/divisor]` |
| 4.7 | 现金/弹药 | 必须走 `characterUpdates` 通道，禁止在 narrative 里口头报数 |
| 5.1 | SAN 检定不可回避 | 永远明骰，触发即强制弹窗 |
| 6 / 6.1 / 6.2 | clue / sceneImage / prompt | "档案" vs "勾子" vs "按需配图" 三层取舍 |
| 7 / 12.11 | 第一回合 | 直接拉开第一幕，禁止介绍规则/选时代/写"游戏准备室"；剧本模式下卷入动机必须采用 `hook.prologue_md` 给定的因果，禁止改写成"勘察已发生的凶案 / 警局派来 / 刚收到报警"等模组未声明的起因 |
| 8 | 谜语人原则 | 神话/型月/SCP 专有名词不直报，用感官化描写 |
| 9 | 终局闸 | dying / dead / insane 由前端硬规则注入，单回合裁决禁止拖场 |
| 10 | 疯狂干涉 | bout / temporary / indefinite 三态由前端注入，LLM 按表项叙事化曲解 |
| 11 | 好/灰结局 | victory / ambiguous **必须** LLM 主动判断模组进度后下发 |

## 调用链路（凭据从未出过浏览器）

```
浏览器 React App
  ├─ apiSettings (localStorage 里的 key/model/host/baseUrl)
  ├─ src/lib/keeperPrompt.ts → 拼 systemInstruction
  ├─ src/lib/llmSchemas.ts   → 拼 KeeperResponse 的 JSON Schema
  └─ src/lib/llmClient.ts    → 直连上游
       ├─ gemini      → /v1beta/models/{model}:generateContent  (原生 responseSchema)
       ├─ anthropic   → {base}/v1/messages                       (schema 注入 prompt)
       └─ openai-兼容 → {base}/chat/completions                  (response_format: json_object)
                        qiny / custom / grok / deepseek
```

**重要**：`server.ts` **不再代理 LLM**。自 commit `547270a refactor: move llm dispatch to browser, drop server-side keys` 起，所有 LLM 凭据只存在浏览器 localStorage，每次请求随 body 一起发。**不要往服务端加任何 API Key 持久化逻辑**。

服务端只剩三类活：

| 端点 | 用途 |
|---|---|
| `POST /api/keeper/roll` | 走 NyaaChat-MCP `roll_coc`；MCP 未配/不可达时回落到 `localCocRoll`（同 7e 规则） |
| `POST /api/image/generate-clue` | 走 qiny `/v1/images/generations` → `generateImageAndPublish` 内容寻址落盘 |
| `GET  /api/keeper/dynamic-instructions` | 暴露玩家私有 `.docs/keeper-*.json` 拼成的 system prompt 片段 |
| `GET  /api/public-config` | 暴露 `imagePublicBaseUrl`，前端用作 localStorage 入库白名单 |
| `GET  /api/mcp/status` | NyaaChat-MCP 健康探活 |
| `GET  /api/models` | 透传供应商模型列表（CORS 兜底） |
| `GET  /cache/images/*` | 30 天滚动缓存图片同源回放 |

## KeeperResponse 输出契约（每回合的"信号总线"）

LLM 每回合返回 `KeeperResponse`（`src/types.ts:288-391`），所有字段都是前端硬规则的"输入信号"：

| 字段 | 触发的前端行为 | 由谁主动发起 |
|---|---|---|
| `narrative` | 渲染 Markdown 叙事（`MarkdownText.tsx`） | LLM |
| `rollRequest` | 弹双十面骰动画 → 玩家手投 → `/api/keeper/roll` 真随机 | LLM |
| `keeperRoll` + `isSecret` | KP 替环境/NPC 投，明骰公开/暗骰打码"神秘轰鸣" | LLM |
| `sanityCheck` | **强制紫色 modal、禁取消、禁输入** | LLM |
| `characterUpdates.hp/mp/sanChange` | 整数同步结算（确定性变动） | LLM |
| `characterUpdates.*Formula` | 弹 `EffectRollModal` 演投二阶段效果骰 | LLM |
| `characterUpdates.cashChange / cashSetTo` | 写入 `sheet.cashBalance`（钳到 ≥0） | LLM |
| `characterUpdates.ammoUpdates[]` | 按 `slotIndex` 写入 `inventory[i].ammo` | LLM |
| `clue` | 入册线索本（永久档案） | LLM |
| `sceneImage` | "显示图像"占位卡，玩家点击才请求画图 | LLM |
| `npcDialogue` | NPC 台词气泡 | LLM |
| `gameState` | 模组名 + 当前地点 | LLM |
| `scenarioEnd` | 终局闸——封锁输入、标记存档"已封存" | LLM 或前端硬规则注入 |
| `madnessRecover` | 仅用于 indefinite 疯狂的剧情解除信号 | LLM |

**Schema 实现**：`src/lib/llmSchemas.ts` 对 Gemini 走原生 `responseSchema`；对 Anthropic / OpenAI 兼容把 schema 描述拼进 system prompt 末尾 + `response_format: json_object`。`extractJsonObject()` 容忍模型偶尔吐出的 ```` ```json ```` 包裹。

### LLM 失败兜底（系统错误卡 + 一键重发）

`ChatMessage`（`src/types.ts`）携带三字段实现"网络断线 → 一键重发"：

| 字段 | 用途 |
|---|---|
| `retryable: boolean` | `sender === "system"` 的错误卡才置 true，触发"重新生成"按钮 |
| `retryHistorySnapshot: ChatMessage[]` | 出错前的 `currentHistory` 快照，重发时整段塞回 LLM |
| `retryFeatures: { typemoon, scp }` | 出错时的世界观开关，避免重发后用户已切其它模组 |

`App.tsx::handleKeeperRetry` 收到 errMsgId + 快照 + features 后：先把错误卡从消息流移除 → 调 `triggerKeeperNarration(snapshot, character, features)` 重新走一遍。**不要**把 retry 字段写进 KeeperResponse —— 那是 LLM 的输出契约，retry 是前端 UI 状态。

## 前端 → LLM 的反向信号（系统标记注入）

LLM 不可信，所以"不可篡改的事实"由前端在下一轮 `userText` 里注入纯文本系统标记，强制 LLM 按规则叙事化呼应。常见标记：

| 注入方 | 标记格式 | LLM 应做 |
|---|---|---|
| 终局闸 | `[终局闸] 调查员进入 dying 状态(剩余 LUC = M)...` | 二选一：救起（HP≥1 + 场景跳转） / 死亡（写 epilogue） |
| 终局闸 | `[终局闸] 调查员一次性致命伤,直接死亡。` | 只输出 narrative + scenarioEnd: dead |
| 终局闸 | `[终局闸] 调查员 SAN 归零,精神被吞噬,永久疯狂。` | 只输出 narrative + scenarioEnd: insane |
| 命运博弈 | `[孤注一掷 (Push)] 玩家选择孤注一掷:首投 XX 失败 → 二投 YY → 强制大失败` | 按 fumble 加重叙事 |
| 命运博弈 | `[燃运 (Burn Luck)] 玩家燃烧 N 点幸运,将 XX 改写为普通成功` | 写"命运的眷顾"，不要写"扎实功底" |
| 放弃声明 | `[放弃声明] 玩家撤回了"<skillName>"判定声明` | 默认放过，不要重发同一个 rollRequest |
| 疯狂干涉 | `[疯狂干涉·急性发作 · 表项 #N · {表项名}]` | 按 1-10 表项接管玩家本回合声明 |
| 疯狂干涉 | `[疯狂干涉·临时疯狂 · 剩余 M 回合 · 起源表项 #N]` | rollRequest 升 difficulty 或挂 1 penalty |
| 疯狂干涉 | `[疯狂干涉·不定期疯狂 · 起源表项 #N]` | 每回合 narrative 渗透症状，rollRequest 默认 1 penalty |

注入点在 `src/App.tsx`（顶层 game state 总管，~3042 行）。终局闸/疯狂态的硬规则裁决器都在那里。

## 关键文件地图（按"我要改 X 时去哪"组织）

```
server.ts                      ← Express 入口 + 三类后端 API + 图像缓存
src/App.tsx                    ← 顶层 game state / 存档 / 消息流 / 投骰路径分发 / 终局闸 / 疯狂态裁决
src/types.ts                   ← CharacterSheet / KeeperResponse / RollResult / ApiSettings 等核心类型
src/lib/
  ├─ keeperPrompt.ts           ← SYSTEM_INSTRUCTION + 上下文/装备/派生战斗值块
  ├─ llmClient.ts              ← 浏览器侧 LLM 调度器(三类供应商分发)
  ├─ llmSchemas.ts             ← KeeperResponse 的 JSON Schema
  ├─ apiSettings.ts            ← localStorage 中的 API 配置读写 + 校验
  ├─ saveManager.ts            ← localStorage 多存档管理
  ├─ cocRules.ts               ← 派生战斗值 / 起始现金 / 突破点 / SAN 上限等规则函数
  ├─ cocSkillSlots.ts          ← Custom PC 槽位展开
  ├─ cocSkillRandomizer.ts     ← 自动流/一键随机点池分配
  ├─ characterValidation.ts    ← 字典严格校验(落地前最后一道闸)
  ├─ diceFormula.ts            ← NdM[+const][/divisor] 公式解析
  ├─ rollPolicy.ts             ← 投骰路径 → 命运博弈开关矩阵
  └─ rollCancellation.ts       ← 投骰取消机制
src/components/
  ├─ StartScreen.tsx           ← 起始页 + 存档列表
  ├─ CharacterCreator.tsx      ← 角色创建(预设 / 自动 / Custom PC 槽位制;剧本模式 preset_investigators >3 张时按 3 张/页 翻页)
  ├─ CharacterSheetPanel.tsx   ← 跑团时的角色卡侧栏
  ├─ CluesNotebook.tsx         ← 线索本
  ├─ RollDiceModal.tsx         ← 双十面骰动画(含命运博弈唤起)
  ├─ EffectRollModal.tsx       ← 二阶段效果投骰
  ├─ MadnessIntCheckModal.tsx  ← 疯狂状态机 INT 检定弹窗
  ├─ ApiSettingsPanel.tsx      ← 「虚空连接的设置」
  └─ ConsoleLogPanel.tsx       ← 调试控制台(合并服务端 _serverLogs)
src/data/
  ├─ cocSkills.ts              ← 7e 标准技能注册表(1920s / modern 双时代)
  ├─ cocOccupations.ts         ← 职业模板 + coreSkills 五种 kind 表达
  ├─ cocWeapons.ts             ← 武器结构化条目
  ├─ presets.ts                ← 18 张预设调查员
  └─ modules/                  ← 「基于剧本游戏模式」模组数据基座。已落:`one-nest-of-trouble`(首模组) / **`tsumasaki-kidan`**(褄列奇谈,封闭乡村·星之彩,**当前金标准范例**——6 张 preset_investigators 对应 A-F 路线,含 §14 narrative_style + 单人补偿 NPC `npc.kuze-mei` + 序幕 5 次互动门槛) / `manteia-daughters`(曼提亚的女儿们,1920s 希腊海岛·阿布霍斯之种,3 张 HO 卡 + 13 场景 + 47 线索)
      ├─ _schema/
      │   ├─ scenario.ts       ← Scenario TS SSOT(camelCase；含 §12 PresetInvestigator + §14 narrative_style；详见 .docs/scenario-schema.md）
      │   └─ validator.ts      ← yaml(snake_case)→TS(camelCase) + 引用完整性 + BFS + 结局可达性 + recommendedOccupations/presetInvestigators 跨表校验
      └─ <module-id>/          ← 各模组目录（meta.id 必须等于目录名;已落 `one-nest-of-trouble` / `tsumasaki-kidan` / `manteia-daughters`)
scripts/
  ├─ validate-modules.ts       ← 扫描模组、调 validator、检查资产存在性；prebuild 钩子
  └─ test-validator.ts         ← validator 49 用例自测（最小样例 + 故意失败 + narrative_style + recommended_occupations + recommended 布尔三连 + preset_investigators 必填字段三连 + preset_investigators.items 三连 + ending.rewards 三连）
.docs/                         ← 项目内规范与决策文档(下面单列重要的几篇)
.docs/.work/                   ← 给 Claude Code 看的工作简报(本文所在地)
```

## 必读规范文档（修改对应主题前先翻）

| 主题 | 文档 |
|---|---|
| UI 配色铁律 | `.docs/UI-STYLE-GUIDE.md` —— 黑绿白 + 极少量金，主点缀色 `#10b981`，`custom-scrollbar` 必挂 |
| MCP 接入 | `.docs/NyaaChat-MCP.md` —— 九个工具规格、`roll_coc` 入参出参、Streamable HTTP 协议细节 |
| CoC 投骰规则 | `.docs/roll_coc_rule.md` —— 7e 成功等级、奖励/惩罚骰、阈值速查 |
| 二阶段效果骰 | `.docs/two-stage-roll.md` —— `*Formula` 字段族的解析与回报口径 |
| 命运博弈 | `.docs/fate-gamble.md` —— 孤注一掷/燃运的路径开关矩阵 |
| 投骰取消 | `.docs/roll-cancellation.md` —— 玩家撤回声明的硬规则 |
| 经验阶段 | `.docs/experience-phase.md` —— 模组结束的技能成长流程 |
| 角色卡现状 | `.docs/character-card-current.md` —— 8 槽装备、SAN 状态机、字段语义 |
| 武器表 | `.docs/coc-weapons.md` —— `cocWeapons.ts` 的字段口径 |
| 技能表 | `.docs/skill-1920s.md` / `.docs/skill-modern.md` —— 两套时代的标准技能 |
| 职业表 | `.docs/occupation-list.md` —— 职业模板 + 核心技能 |
| 测试命令 | `.docs/testing-commands.md` —— `[sys_test]` sentinel 注入投骰/效果骰演练 |
| 模组 schema | `.docs/scenario-schema.md` —— 「基于剧本游戏模式」frame/freedom/forbidden 三槽 + 全字段语义；schema_version=1；§15 是预设调查员 |
| 模组图像资产 | `.docs/scenario-schema.md` 第 11.1 节 —— 封面 ≤ 120 KB / 800 px,场景 ≤ 200 KB / 1024 px,JPEG q82,单模组累计 ≤ 3 MB |
| 模组转写硬规则 | `.docs/scenario-schema.md` §15.3 —— 外部导入模组时,`meta.recommended_occupations` 必填、`meta.recommended` 必填布尔、`preset_investigators` 在原作有 pre-gens 时必须落卡 |
| 外部模组导入工作流 | `.docs/module-import-guide.md` —— 把外部 PDF/docx/翻译稿落进 `src/data/modules/<id>/` 的完整流程,**金标准范例 = `tsumasaki-kidan`**;后续模组转写必须按它的标准走(序幕互动门槛 / 单人补偿 NPC 视野盲区+姓名+性别+道德底线 / preset_investigators.items 必填 / hook.occupation_variants 多路线联锁) |

## 常见坑（容易踩、踩了贵）

1. **不要在服务端加 LLM 凭据持久化**。所有 `apiKey` 只在浏览器 localStorage，每次随 body 发；想回到旧式启动密钥模式 = 砸架构。
2. **不要绕过 `generateImageAndPublish`**。任何画图路径都必须走它（`dispatchImage` → `persistAndPublish`），否则破坏内容寻址缓存与 localStorage 入库白名单。`/cache/images/*` 是唯一允许的图片源。
3. **不要让 LLM 在 narrative 里报数值**。伤害走 `*Formula`，弹药/现金走 `characterUpdates`，让前端面板说话；narrative 只描感官冲击。
4. **不要往 SYSTEM_INSTRUCTION 里加"投骰节奏"诱导**。规则 4.0 三要件已经反复强调"不投是默认"，再加节奏诱导会破坏克系叙事张力。
5. **不要假设 `customBaseUrl` 已规整**。`llmClient.ts:normalizeCustomBaseUrl` 容忍 `https://host` / `host/v1` / `host/v1/chat/completions` 等多种粘贴方式，改 URL 处理逻辑前先看这个函数。
6. **不要把 `bonus` / `penalty` 写成 3+**。家规硬截断到 `0/1/2`，`clampBonusPenalty` 在 `keeperPrompt.ts` 兜底，但 prompt 里也明令禁止。
7. **不要新增独立画图路由**。新增供应商按 `dispatchImage` 加分支，**不要**在 router 里直接 `fetch` 上游。
8. **`#10b981` 是绿色不是金色**。CSS 变量 `--color-coc-gold` / Tailwind class `text-coc-gold` 名字带 "gold" 但值是绿色，不要被名字误导改成黄色——这是 UI 铁律。
9. **滚动条统一用 `custom-scrollbar` class**，禁止自写 `::-webkit-scrollbar` 覆写。
10. **`.docs/keeper-*.json` 是玩家私有模组配置**，被 `.dockerignore` 排除，**不会进镜像**。改完不要 commit 它。
11. **不要把未压缩的模组图像直接进仓库**。`src/data/modules/<id>/assets/` 里所有图必须按 `.docs/scenario-schema.md` 11.1 节压到上限以内(封面 1.25 MB → 71 KB 是已验证基线)，否则镜像与仓库会被一张图拖肥。
12. **从外部 PDF/docx 转写模组时,统一走 `.docs/module-import-guide.md`,以 `src/data/modules/tsumasaki-kidan` 为金标准范例**。`meta.recommended_occupations` 必填、原作有 pre-gens 时 `preset_investigators` 必须落卡、每张预设卡的 `items` 必须按职业身份补 4~7 件(严禁全员空背包)、序幕场景必须钉死"互动门槛 + timeline 前置条件 + 自报姓名禁令"、单人补偿 NPC 必须写齐"视野盲区 + 第一次现身触发 + 姓名披露 + 道德底线消失"四条铁规则。**不允许"先填一半,后面补"**——prebuild 时 schema 校验会拒绝构建。判定原则与字段语义详见 `.docs/scenario-schema.md` §15.3 + `.docs/module-import-guide.md` §3。
13. **剧本预设调查员的卡槽优先级 + 字段锁**:`preset_investigators[i]` 在 Phase 3 创角阶段按数组下标占据卡槽 0..N-1(从左到右越靠前越优先);若 N < 3,用同 era 系统模板兜底补到 3 张。`name / age / gender / nationality / identity / background_story_md / occupation` 在剧本模式下完全锁定,**LLM 不允许覆盖**——这些字段必须在模组转写期就完整定稿,否则 schema 校验会拒。
14. **`triggerKeeperNarration` 在剧本模式首轮必须带 `scenarioOverride`**。`setGameMode / setScenarioState` 是异步的,如果触发函数紧跟着读组件 state 拼 `scenarioBlock`,闭包里仍是旧值(`gameMode === "llm-generated"` / `scenarioState === null`),hook 块永远进不去 prompt——首轮 LLM 就会脱模组飞。`App.tsx` 的解法是给 `triggerKeeperNarration` 加 `scenarioOverride?: { gameMode, scenario, scenarioState }` 参数,创建期入口必须显式传新值;后续玩家回合 state 已落地,可省略。**任何会"setState 后立刻读 state"的路径都要走 override 而不是闭包**——同一个坑在投骰收尾路径再次出现:`handleRollComplete` 在 `setMessages` 里清掉 `rollRequest` 后立刻 `handleSendPlayerMessage(...)`,后者闭包读到的 `messages` 仍是旧值(rollRequest 还在队尾),`findPendingTailRollRequest` 误判为"放弃声明"并把旧 rollRequest 重新写回 → 下一回合 keeper 卡渲染成"已错过"。修复方式同样是给 `handleSendPlayerMessage` 加 `messagesOverride?: ChatMessage[]` 参数,投骰收尾路径显式传"清空后"的快照。
15. **控制台日志面板是可下载/可单条复制的诊断窗口**(`ConsoleLogPanel.tsx`)。请求 / 响应 / 错误 meta 已扩到包括完整 systemInstruction、userText、keeperData、errorBody/Stack、provider/model/gameMode/scenarioId 等。调试 LLM 注入失误时**先开这个面板**复制 request 看 systemInstruction 末尾是不是真带了 scenarioBlock,再决定改 prompt 还是改注入条件——不要凭直觉猜。
16. **内部 system 标记必须 UI 隐藏但仍喂 LLM**。`[放弃声明]` / 未来的 `[终局闸]` / `[疯狂干涉]` 等 system 消息只对 LLM 有用,玩家看到反而会泄露提示词机制。统一通过 `src/lib/rollCancellation.ts::isInternalSystemMarker(msg)` 判定:出口仅一处——聊天时间线 `messages.filter(...)`,**不要**在存档/LLM 上下文里过滤(否则下一轮 LLM 拿不到事实信号)。新增隐藏类标记时,只需在 `INTERNAL_SYSTEM_ID_PREFIXES` 里追加 id 前缀,不要在渲染处再写一份 `m.id.startsWith(...)`。
17. **聊天气泡 `#N` 对话计数只数 keeper/player**。疯狂态、孤注一掷等回合计数都按"互动总发言顺序",system 事件卡(投骰结果/SAN 检定/[放弃声明] 等)**不计入**——否则一次 SAN 检定就会让计数膨胀两到三个,玩家无法用它判断"我撑了几句"。计数逻辑写在 timeline 渲染入口的 IIFE 里(`turnIndexById: Map<string, number>`),拿来即用,不要在 `ChatMessage` 上加冗余字段。

## 工作流（与本项目协作的"启动键"）

部署相关：

| 操作 | 命令 / Skill |
|---|---|
| 重建 + 重启 Docker | `rebuild` skill —— Windows 走 `powershell -ExecutionPolicy Bypass -File .\rebuild.ps1`，Linux/macOS 走 `bash ./rebuild.sh`。`-p keeper-coc-trpg` 锁项目名 |
| 提交 + 推送 | `commit-push` skill —— Conventional Commits（英文小写起首），`git add <file>` 显式指定，**不**附 `Co-Authored-By` |
| 验证改动 | `verify` skill / `run` skill |
| 代码审查 | `code-review` skill |
| 模组校验 | `npm run validate:modules` —— 跑 49 用例自测 + 扫 `src/data/modules/*/scenario.yaml`。`prebuild` 钩子已挂,任一模组校验失败 → 拒绝构建 |

Windows 特有坑：

- 命令报 `A specified logon session does not exist` / `docker-credential-desktop` / `git-credential-manager` 错误时，用 **`windows-user-session-runner`** skill 切到 Session 1 跑——不要在 `credsStore` / config 上死磕。原因写在 `~/.claude/CLAUDE.md`。

环境约定：

- 默认沟通语言：**简体中文**（代码 / 标识符 / commit message 仍用英文）
- 容器内 Express 监听 `0.0.0.0:3000`，对外 `3093:3000`
- 镜像缓存 volume：`keeper_image_cache`
- 可选环境变量：`NYAACHAT_MCP_TOKEN`（MCP 真随机骰）、`IMAGE_PUBLIC_BASE_URL`（图像公网根）

## 自检：开新会话前 30 秒清单

读完 `CLAUDE.md` + 本文后，应能回答以下问题再开工：

- [ ] LLM 凭据存在哪？答：浏览器 localStorage，服务端不持久化。
- [ ] 投骰真随机来自哪？答：NyaaChat-MCP `roll_coc`，未配回落 `localCocRoll`。
- [ ] 改 KP 行为应该改哪里？答：`src/lib/keeperPrompt.ts` 的 `SYSTEM_INSTRUCTION`。
- [ ] 改 KP 输出契约应该改哪里？答：`src/types.ts` 的 `KeeperResponse` + `src/lib/llmSchemas.ts` 的 schema + `App.tsx` 的消费逻辑，三处必须同步。
- [ ] 新增 LLM 供应商需要改哪几处？答：`types.ts` 的 `LlmProviderKind` / `apiSettings.ts` 校验 / `providerIcons.tsx` 标签 / `llmClient.ts` 的 `dispatchLlm` 分支 / `server.ts` 的 `/api/models` 兜底。
- [ ] 新增画图供应商需要改哪几处？答：`types.ts` 的 `ImageProviderKind` / `dispatchImage` 加分支 / `apiSettings.ts` 校验 / `providerIcons.tsx` 标签——**不要**新增独立路由。
- [ ] 改完代码要重建镜像吗？答：改了 `Dockerfile` / `docker-compose.yml` / `server.ts` / `src/**` / `vite.config.ts` 都要 → 用 `rebuild` skill。
- [ ] 提交前要加 `Co-Authored-By` 吗？答：**不加**，家规。

---

# Claude Code 有没有更合适的工具/方法？

**结论：本文档继续保留是必要的，但应该和下面三个机制配合用，而不是单兵作战。**

## 1. `CLAUDE.md`（项目根 + 子目录）—— **最优先**

Claude Code 启动时会**自动加载**项目根 `CLAUDE.md`、用户 `~/.claude/CLAUDE.md`、以及子目录 `CLAUDE.md`（按需）到每次对话上下文。本项目已经有项目根 `CLAUDE.md`（300+ 字精简版规范），它的优势：

- **零成本注入**：不需要 Claude 主动读，开会话即生效。
- **永远不过期**：写在主流程里，改代码时大概率会顺手改它。

**建议做法**：
- `CLAUDE.md` 留**强约束**（铁律、命令、绝对禁止项）—— 它已经在做这件事。
- 本 `PROJECT-OVERVIEW.md` 留**架构级理解**（"为什么这么设计"、组件协作图）—— `CLAUDE.md` 不适合塞这种长篇。
- 二者形成"短规则 + 长地图"的搭配。

如果想让 Claude Code 默认看本文，可以在 `CLAUDE.md` 末尾加一行：
```
> 架构总览：开会话先读 .docs/.work/PROJECT-OVERVIEW.md
```

## 2. Memory 系统（`~/.claude/projects/<project>/memory/`）

Claude Code 内置文件式记忆系统，跨会话持久化。适合存：
- **user 类**：你的角色与偏好（已在用）
- **feedback 类**：你纠正过我的做法（不要 `git add -A`、不要 `Co-Authored-By`、绿色叫 `coc-gold` 别改、滚动条统一等）
- **project 类**：当前正在推进的功能、deadline、决策
- **reference 类**：外部系统指针（NyaaChat-MCP URL、registry 地址）

**与本文档的分工**：
- 本文档 = **架构事实**（不会因谁来开发而变）
- memory = **协作历史**（你和我的过往约定、当前工作焦点）

随着我们多轮协作，feedback 类 memory 会越积越多，回到项目时不需要重新被纠正——这是本文档替代不了的。

## 3. Skill 系统（`.claude/skills/`）

本项目已经有 `rebuild` / `commit-push` 两个 project-level skill。Skill 的优势是**封装可重复操作**，触发由关键词匹配（"提交"、"重建" 等）。

**可以加的 skill**（如果你后续频繁做某些事）：
- `lint-and-test`：跑 `npm run lint` + 类型检查 + 启 dev server 冒烟
- `validate-keeper-response`：把一段 JSON 喂给 schema 校验，便于调 prompt
- `bump-llm-provider`：新增供应商时按清单逐处改的脚本化 skill

skill 不是凭空写的——只有当某操作开始重复出现 3 次以上才值得封装。

## 我的最终推荐

按"零成本 → 高成本"排序：

1. **`CLAUDE.md`（已有）** —— 强约束铁律，每次会话自动加载。继续维护，不要塞架构图。
2. **本 `PROJECT-OVERVIEW.md`（新建）** —— 架构地图，开会话第一步读它（在 `CLAUDE.md` 末尾加一行引导）。
3. **memory 系统** —— 让我把"和你协作时学到的东西"自己存起来；你不需要主动管理，我会按需写入。
4. **skill 系统（已有 rebuild / commit-push）** —— 重复操作再加，不要预先发明。

这四件事互补不重叠：CLAUDE.md 管"你必须做什么"，PROJECT-OVERVIEW 管"为什么这么设计"，memory 管"我们之前怎么协作过"，skill 管"重复操作怎么一键跑"。

> 维护规则：本文档的"关键文件地图"和"常见坑"两节最容易过期——每次改了 `keeperPrompt.ts` / `llmClient.ts` / `types.ts` / `server.ts` 后顺手扫一眼。其他章节是架构事实，半年内基本稳定。

