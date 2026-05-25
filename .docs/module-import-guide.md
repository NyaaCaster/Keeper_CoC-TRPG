# 模组导入工作指南 · 外部 PDF / docx / 翻译稿 → 本游戏模组数据

> 状态:**已定稿**(2026-05-26,以 `src/data/modules/tsumasaki-kidan` 立为金标准)。
>
> 本文档描述"把外部 CoC 7e 模组(原版日 / 英 / 中 PDF、scan、docx、网络翻译稿)落进本项目模组目录"的完整工作流。**字段定义、校验规则、TS 命名约定**仍以 `.docs/scenario-schema.md` 为唯一事实源(SSOT);本文档只补**流程、判断标准与必跑清单**,不重述字段语义。
>
> 读完本文应能独立完成:从一份外部模组文档出发,产出 `src/data/modules/<id>/{module.ts, scenario.yaml, assets/}`,跑通 `npm run validate:modules`,并满足"可上线、可演出"的金标准。

## 0 · 金标准范例:`src/data/modules/tsumasaki-kidan`

**`tsumasaki-kidan`(褄列奇谈)是本项目当前的模组金标准范例**。后续任何外部模组转写工作必须以它为参照——包括但不限于:

- 顶层结构编排(注释分隔线、节序、字段顺序)
- 序幕"互动门槛"的写法(到站铁律 / NPC 视野盲区 / 姓名披露 / 性别披露 / 道德底线)
- `preset_investigators` 的"6 张卡 ↔ A–F 路线 ↔ `hook.occupation_variants`"三层联锁结构
- 单人补偿 NPC `npc.kuze-mei` 的视野盲区 + 触发条件 + 介入边界写法
- `narrative_style` §14 的 frame / freedom / sample_paragraph_md 三层用法

**判断"该不该照抄 tsumasaki 的写法"的简明原则**:外部原作明确写了 → 按原作落;外部原作没写但 tsumasaki 有同位结构 → 照抄 tsumasaki 的骨架,只换文本;外部原作写得比 tsumasaki 少 → 至少补到 tsumasaki 的最小要求(见下文 §3 必填铁律)。

---

## 1 · 工作流总览

```
外部 PDF / docx / 翻译稿
  ↓ 通读 + 拆解
原作骨架笔记(场景图 / NPC / 线索 / 时间线 / 结局 / pre-gens)
  ↓ 按 .docs/scenario-schema.md 字段映射
.docs/.work/module-source/<id>/        ← 中间档,留给人工核对(选)
  ↓ 编写
src/data/modules/<id>/scenario.yaml
src/data/modules/<id>/module.ts
src/data/modules/<id>/assets/cover.jpg + scenes/*.jpg + ...
  ↓
npm run validate:modules
  ↓ 全绿
docker rebuild + 进游戏走一遍 hook → 序幕 → 第一幕
```

每一步要做什么、必填什么、判断标准是什么,见下文。

---

## 2 · Step 0:开工前的事实采集

通读外部原作(全册,不要跳),按以下清单逐项落到笔记里。任何一项缺失或拿不准 → 在 `scenario.yaml` 同位字段写一句**`# TODO:`** 注释,**不要**用编造的内容糊上去。

| 必采项 | 在 schema 里的归宿 | 判断标准 |
|---|---|---|
| 模组标题 / 时代 / 难度 / 标签 / 封面图 / synopsis | `meta.*` | 时代必须在 `1920s / modern / other` 三选一 |
| 作者 / 译者 / 校对 / 转写者 | `meta.author_credits_md` | 至少把原作者署名落进去,中文化译者有则附 |
| 推荐职业 ≥ 1 项 | `meta.recommended_occupations` | **schema 强制必填**;原作没明写则按 hook 推断 3~8 个合理职业 |
| 起始场景 | `hook.start_scene` | 必须能在 `scenes[*].id` 里命中 |
| 楔子 / 卷入动机 | `hook.prologue_md` + `call_to_action_md` | prologue = "事实背景",CTA = "为什么 PC 现在出门"——两段必须自洽 |
| 多职业卷入分叉 | `hook.occupation_variants` | 若原作分职业给不同导入文案,**必须**逐个落卡;键与 `recommended_occupations` 完全对齐 |
| 场景图 + 出口 + condition | `scenes[*]` | BFS 必须能从 `start_scene` 到达每个 ending(validator 会查) |
| NPC 表 + public/secret 双层 | `npcs[*]` | 玩家初见可见信息走 `public_persona_md`;触发后才解锁的走 `secret_md` + `secret_unlock_trigger` |
| 线索表 + 发现方式 + 解锁后果 | `clues[*]` | discovery 用 `skill / flag / npc-give / auto-on-enter` 之一;unlocks 指向具体 scene/clue/flag |
| 时间表 (7e 日历线性) | `timeline[*]` | `fires_when` 必须升序;按"游戏天 + 时段"组织 |
| 旗帜 / 进度位 | `flags[*]` | 凡是被 timeline / clue / scene exit 引用的旗帜都必须在 flags 表里登记 |
| 结局至少 1 个 victory/ambiguous | `endings[*]` | 不允许只有 dead/insane;不可达的结局会被 validator 报错 |
| 全局风格红线 | `global_freedom` + `global_forbidden` | 风格 = 怎么演;红线 = 绝对不能演 |
| 模组叙事文风(§14) | `narrative_style` | frame=必须遵守 / freedom=可挑用,sample_paragraph_md 是抓手 |
| 预生成调查员(pre-gens) | `preset_investigators` | 见下文 §3 必填铁律 |

> 中间档 `.docs/.work/module-source/<id>/` 是可选的——如果原作很复杂(比如带 30+ 场景 / 20+ NPC),建议先把骨架笔记落到这里,再分批往 `scenario.yaml` 搬运。`tsumasaki-kidan` 当时也走过这条路径(见 `.docs/.work/module-source/tsumasaki-kidan-extract/`)。

---

## 3 · Step 1:必填铁律(违反则 prebuild 拒绝构建 / 演出会崩)

以下 6 条是**金标准范例 `tsumasaki-kidan` 都已落实**的最小要求。任何后续模组转写都必须满足——若原作没明写,转写者**自行补**;不允许"先填一半,等以后补"。

### 3.1 `meta.recommended_occupations` 必填(≥ 1 项)

schema 强制校验。原作有"建议职业列表" → 原样落;只有几段口头描述 → 按"委托型 / 学术型 / 媒体型 / 执法型"分类推断 3~8 个合理职业。**宁少勿杂**——委托型开局优先调查/执法/媒体线;校园背景允许辅以教授/医师/神秘学家。

### 3.2 `preset_investigators` 在原作有 pre-gens 时必须落卡

判定原则(见 `.docs/scenario-schema.md` §15.3):

- 原作 PDF 末尾有"调查员卡"、"Pre-generated Characters"或同等附录 → **逐张落 `preset_investigators`**,数值原样不打折
- 原作只有"建议职业列表"或一两段"推荐扮演什么样的人"提示 → 只落 `recommended_occupations`,`preset_investigators` 留空
- 原作什么都没说 → 转写者按 hook 推断 3~8 个职业写进 `recommended_occupations`,`preset_investigators` 留空

**`tsumasaki-kidan` 的做法**:6 张日本身份预设调查员,与 `hook.occupation_variants` 的 A–F 路线一一对应(警探/警员同卡 → 私家侦探 → 记者 → 摄影师 → 神秘学家 → 教授兜底)。**这种"卡 ↔ 路线 ↔ 卷入动机"三层联锁是金标准**——后续模组若有 pre-gens,优先按这种结构落;若卡数 ≠ 职业数,允许 1 张卡覆盖 2 个相邻职业(如警探/警员)。

### 3.3 `preset_investigators[i].items` 必填(剧本预设调查员严禁全员空背包)

每张预设调查员卡按职业身份至少补 **4~7 件非武器道具**(警徽 / 录音笔 / 相机 / 笔记本 / 委托资料 / 护身符 / 急救包 / 备用弹匣 等)。这些道具是 LLM 在叙事中调用的"身份切入点"与"剧情勾连物"——空背包会让前几回合的调查动作失去根。

校验:

- 单条 `text` 长度 ∈ [1, 40](40 是角色卡 inventory UI 的视觉容量),不允许空字符串
- `weapons.length + items.length ≤ 8`(CharacterSheet.inventory 总槽数)
- 武器槽允许为空(文职 PC 不带枪是合理的),但**道具槽不允许全空**

参照 `tsumasaki-kidan/scenario.yaml` 6 张卡(警探带警徽 + 录音笔 + 弹匣;摄影师带胶片相机 + 备用胶卷 + 三脚架;教授带田野笔记 + 录音笔 + 教员证;等等)。

### 3.4 `name / age / gender / nationality / identity / background_story_md / occupation` 字段锁

剧本模式下这 7 项**完全锁定,LLM 不允许覆盖**。必须在模组转写期就**完整定稿**,否则 schema 校验会拒。

**特别提示**:

- `gender` / `nationality` / `identity` 都是必填非空——日本模组的 PC 国籍写"日本",身份写完整职业名 + 单位
- `background_story_md` 选填但**强烈建议**写完整——这是 LLM 拼 PC 内心独白的语料源,缺它叙事会扁平

### 3.5 单人补偿 NPC 的"视野盲区 / 介入边界 / 道德底线"三层规则

若模组属于"原设计为多人团但允许单人开跑"的类型(`tsumasaki-kidan` 即如此),需在某位关键 NPC 上落"单人补偿"机制——参照 `npc.kuze-mei`:

- **视野盲区铁规则**:在 PC 主动留意 / 主动询问之前,叙事完全不提其存在(不写"身后有视线"之类暗示)
- **第一次现身的明确触发**:必须由具体 PC 行为或剧情节点触发(如 `tsumasaki-kidan` 的"棒棒糖 1"=PC 与前排两位旅伴产生过至少一次互动后)
- **姓名披露铁规则**:在 PC 直接询问前,叙事 / 旁白 / 对白中**严禁**出现该 NPC 姓名;只能用外貌行为代称
- **性别披露铁规则(选)**:若该 NPC 设计上有性别反差(如"看上去像男青年实则是女生"),要把"披露门槛"按层钉死(声音 → 自报姓名 → 公开身份)
- **介入触发条件清单**:列出该 NPC 必须出场补偿的瓶颈类型(物理 / 战斗 / 心理 / 协作)
- **道德底线铁规则**:PC 触犯道德底线时该 NPC **直接消失,不告别、不解释、不留姓名**,后续场景的"协作 / 援护"也不再介入,直到 PC 用持续剧情行为证明已恢复底线(由 KP 裁定)

这五条 / 六条**作为 `npc.frame.public_persona_md` + `npc.frame.voice_guidelines` 的明文铁规则**写进数据,LLM 必读。

### 3.6 序幕场景的"互动门槛 + 时间锁"

若模组开局是"班车 / 火车 / 邮船 / 旅店大堂"这类**封闭强叙事场景**(`tsumasaki-kidan` 的 `scene.bus-onboard` 即如此),要在 `scene.frame.forbidden` 里钉死:

- **N 次互动门槛**:PC 与场内 NPC 累计完成 N 次"有意义"互动之前,严禁让序幕进入下一场景;严禁触发到站 / 离场 / 引擎熄火等推进语义
- **timeline 触发前置条件**:即使 `elapsed_minutes` 已累积到目标值,只要门槛未达成,继续按 5 分钟一档往后顺延 timeline tick——让"时间还在走但场景未推进"的感觉自然成立
- **NPC 自报姓名 / 透露关键信息的禁令**:序幕未结束前禁止任何 NPC 自报姓名 / 透露目的地 / 提及核心关键词
- **超自然元素禁令**:序幕只允许"日常通勤式的疲倦感",不允许任何怪声 / 视线吸引 / 窗外异象

"有意义"的定义要明文写出来——`tsumasaki-kidan` 的口径是"PC 与某位 NPC 产生了一来一回的对白、或 PC 主动观察 / 试探 / 表态被某位 NPC 用动作或表情回应",PC 自己一句独白 / 翻手机 / 看风景**不计**。

---

## 4 · Step 2:写 `scenario.yaml`

字段定义、命名约定、校验规则全部以 `.docs/scenario-schema.md` 为准。本节只补**写作姿态**。

### 4.1 三槽分离(frame / freedom / forbidden)

每个剧本节点(scene / npc / clue / ending)必须同时声明:

- `frame`:LLM 不可篡改的事实(场景陈设、NPC 公共人设、线索内容)
- `freedom`:允许 LLM 二度创作的语料库(气氛标签、感官调色板、即兴道具、口头禅)
- `forbidden`:红线(绝对不能演的方向)

**这是与"LLM 生成模式"最本质的区别——自由度边界写在数据里,而不是写在 prompt 里**。

### 4.2 ID 命名

强类型前缀,全局唯一,kebab-case:

```
scene.bus-onboard       npc.kuze-mei       clue.three-pillar-torii
ending.good-truth       flag.bridge-destroyed   tl.d1-noon-arrival
pc.hayashida-shunsuke
```

**违反前缀约定的 id 会被 validator 报错**。

### 4.3 Markdown 写正文,YAML 写结构

多行叙事文字一律用 `|` 块字符串。可用 `**强调**` 等 Markdown,**禁用** HTML 标签(防 XSS,前端用 `MarkdownText.tsx` 渲染)。

### 4.4 注释分隔线

参照 `tsumasaki-kidan`:每节顶端用一行 ASCII 横线注释分隔,便于阅读 + 折叠:

```yaml
# ============================================================================
# scenes
# ============================================================================
```

### 4.5 静态资产

`assets/cover.jpg` 必须按 `.docs/scenario-schema.md` §11.1 规格压缩(封面 ≤ 120 KB,800 px,JPEG q82;场景图 ≤ 200 KB,1024 px;单模组 `assets/` 累计建议 ≤ 3 MB)。**禁止**直接提交原始扫描件或未压缩 PNG。

---

## 5 · Step 3:写 `module.ts`(标准模板)

参照 `src/data/modules/tsumasaki-kidan/module.ts`——所有模组的 `module.ts` 都是同一个 7~10 行模板,只改文件名引用与错误标签:

```ts
import rawScenario from "./scenario.yaml";
import { validateScenario } from "../_schema/validator";
import type { Scenario } from "../_schema/scenario";

const result = validateScenario(rawScenario);
if (result.ok === false) {
  const lines = result.issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");
  throw new Error(`[scenario:<module-id>] 校验失败,这不应发生(prebuild 已校验过):\n${lines}`);
}
if (result.warnings.length > 0) {
  console.warn(`[scenario:<module-id>] 校验通过但有 ${result.warnings.length} 条 warning:`, result.warnings);
}

export const scenario: Scenario = result.scenario;
export default scenario;
```

**不要**在 `module.ts` 里写自定义初始化逻辑——所有数据加工都在 `validator.ts` 里完成。

---

## 6 · Step 4:校验闭环

每改完一段就跑:

```bash
npm run validate:modules
```

它做两件事:

1. 跑 49 项 validator 自测(SSOT 一致性、字段语义、跨表引用、BFS 可达性、结局可达性、preset_investigators 必填字段、items 长度与槽位、ending.rewards 等)
2. 扫 `src/data/modules/*/scenario.yaml`,逐模组 validate + 资产存在性检查

任一模组失败 → `prebuild` 钩子拒绝构建 → docker 镜像也起不来。**不允许**绕过校验提交模组数据。

完成后再走:

```bash
# Windows
powershell -ExecutionPolicy Bypass -File .\rebuild.ps1
# Linux/macOS
bash ./rebuild.sh
```

进游戏走一遍 hook → 序幕 → 第一幕,确认:

- 6(或自家张数)预设调查员卡片在创角期 step 2 正确展示,inventory 里能看到武器与道具
- 序幕互动门槛逻辑生效(LLM 在门槛达成前不会强行推进到下一场景)
- 单人补偿 NPC 的视野盲区 / 姓名披露 / 道德底线规则被 LLM 遵守
- `narrative_style` 的文风指导渗透进叙事(短句节奏、metaphor_palette 借用情况)

---

## 7 · 常见坑(已踩过的)

1. **`gender` / `nationality` / `identity` 在 `preset_investigators` 是必填非空**——日本模组容易漏写"日本",触发 schema 校验失败
2. **`preset_investigators[i].items` 不允许空字符串/纯空白**——空槽前端会自动补,作者无需手填
3. **`weapons.length + items.length ≤ 8`**——超出会被 validator 拒绝,作者要权衡哪些武器/道具最切角色身份
4. **`occupation_variants` 的 key 必须与 `recommended_occupations` 完全对齐**(中文名)——拼写不一致会落到"不在 recommended_occupations 仅警告"路径,但仍是技术债
5. **`forbidden` 段不要写"不要超自然"这种空话**——要具体到可判定:`不要描写明显的鬼魂、怨灵、显形怪物——本模组的恐怖来自"暗示"`
6. **`narrative_style.frame` 是硬约束 / `freedom` 是可挑用**——别把红线写进 freedom,LLM 会当成"可以违反的建议"
7. **`elapsed_minutes` 累积到 timeline 触发点不等于必然推进**——序幕互动门槛优先于时间钩,要在 `scene.forbidden` 里把"timeline 触发前置条件"明文写出来
8. **棒棒糖 / 援护类 NPC 的"道德底线消失"是单向闸**——PC 触发后该 NPC 在剩余流程不再出现,**包括**协作援护;不允许 LLM 自行"原谅"PC 让其复出,必须由 KP 显式裁定恢复

---

## 8 · 自检清单(转写完成前打勾)

读完本文 + 把模组落进 `src/data/modules/<id>/` 后,逐项核对:

- [ ] `npm run validate:modules` 全绿(49 用例 + 模组扫描)
- [ ] `meta.recommended_occupations` ≥ 1 项,且与 `hook.occupation_variants` keys 对齐
- [ ] 原作有 pre-gens → `preset_investigators` 逐张落卡;原作没有 → `preset_investigators` 省略
- [ ] 每张 `preset_investigators[i]` 都有 `items`(4~7 件,职业身份道具)
- [ ] 每张 `preset_investigators[i]` 的 `name / age / gender / nationality / identity / occupation` 全部非空
- [ ] 序幕场景在 `forbidden` 里钉死了"互动门槛 + timeline 前置条件 + NPC 自报姓名禁令 + 超自然禁令"
- [ ] 单人补偿 NPC(若有)写齐了"视野盲区 / 第一次现身触发 / 姓名披露 / 道德底线消失"四条铁规则
- [ ] `narrative_style.sample_paragraph_md` 不是空的(LLM 文风的核心抓手)
- [ ] `assets/cover.jpg` 已压到 ≤ 120 KB,场景图 ≤ 200 KB,目录累计建议 ≤ 3 MB
- [ ] `module.ts` 用的是标准 7~10 行模板,没有自定义初始化逻辑
- [ ] docker rebuild 后进游戏走过 hook → 序幕 → 第一幕,关键铁律均生效

---

## 9 · 引用文档

- `.docs/scenario-schema.md` —— 字段定义、校验规则、TS 命名约定的**唯一事实源**
- `.docs/.work/PROJECT-OVERVIEW.md` —— 项目架构总览(LLM 介入方式、KeeperResponse 输出契约、模组目录结构)
- `src/data/modules/tsumasaki-kidan/scenario.yaml` —— **金标准范例**;遇到拿不准的写法,先看它怎么写
- `src/data/modules/_schema/scenario.ts` —— Scenario TS SSOT(camelCase),validator 把 yaml 解析后导出的就是这个类型
- `src/data/modules/_schema/validator.ts` —— yaml(snake_case) → TS(camelCase) + 引用完整性 + BFS + 结局可达性 + 跨表校验
