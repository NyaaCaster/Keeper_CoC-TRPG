# 自定义角色卡改造路线图

记录 "建立档案 → 自主缔结专属卡片 (Custom PC)" 分页与 `.docs/character-card-current.md`
模板对齐的工作进度与后续计划。**面向未来对话的快照型备忘**，过期的阶段记录可保留作为
回看用，不必删。

> 参考文档：
> - 模板基线：`.docs/character-card-current.md`
> - 1920s 技能（合并入数据层）：`.docs/skill-1920s.md`
> - modern 技能（合并入数据层）：`.docs/skill-modern.md`
> - 职业表：`.docs/occupation-list.md`
> - 经验阶段：`.docs/experience-phase.md`
> - 派生战斗值：`src/lib/cocRules.ts` 头注释

> 时间起点：2026-05-23

---

## 总览

8 个阶段（原 8 阶段，技能数据合并后实际为 7 个有效阶段；阶段 3 已并入阶段 2）。

| # | 阶段 | 状态 | 关键产物 |
|---|---|---|---|
| 1 | 类型与数据层基线 | ✅ 已完成 | `CharacterSheet` 扩字段、`MythicEncounters` 接口、`dodgeOf` / `motherTongueValue` |
| 2 | 标准技能合并表 | ✅ 已完成 | `src/data/cocSkills.ts` 单一 `SKILL_REGISTRY_ALL` |
| 3 | (已合并入 2) | — | — |
| 4 | 1920s 职业模板 | ✅ 已完成 | `OCCUPATIONS_1920S` 43 条 |
| 5 | 现代职业模板 | ✅ 已完成 | `OCCUPATIONS_MODERN` 39 条 |
| 6 | UI 改造：基本信息 + 派生层 | ✅ 已完成 | `CharacterCreator.tsx` Custom PC 非技能部分 + `server.ts` generate-stats schema |
| 7 | UI 改造：技能区重做 | ✅ 已完成 | 三栏（候选 / 8 职业 / 4 兴趣）、双点池校验 |
| 8 | 随机宿命技能分配 | ⏳ 待开始 | 一键合法分配器，复用同一份分配规则给 LLM 智能生成路径 |

---

## 已完成阶段

### 阶段 1：类型与数据层基线（commit `aad186e` + `2b2954d`）

**文件改动**
- `src/types.ts`：`CharacterSheet` 扩展 6 个可选字段（`identity` / `nationality` / `residence` / `motherTongue` / `creditRating` / `mythicEncounters`），向后兼容旧存档
- `src/types.ts`：新增 `MythicEncounters` + 4 类条目接口（`tomes` / `spells` / `artifacts` / `entities`）
- `src/lib/cocRules.ts`：追加 `dodgeOf(dex) = floor(dex/2)` 和 `motherTongueValue(edu) = edu`，与已有 `breakpointOf` / `computeMov` 一致风格
- `src/data/cocSkills.ts` / `src/data/cocOccupations.ts`：接口骨架（在阶段 2/4/5 填数据）

**关键设计取舍**
- 闪避 / 母语 / 信用评级三项 7e 名义上的"技能"全部不进 skills 表；前两项作为基本信息字段、第三项作为基本信息字段，闪避作为派生战斗值（`dodgeOf`）
- 神秘接触作为独立 `mythicEncounters` 字段，4 类容器（神话著作 / 法术 / 神器 / 接触过的存在）
- 派生 helper 沿用单值 → 聚合 → prompt 化的三层模板（详见 `cocRules.ts` 的 README 风格头注释）

### 阶段 2：标准技能合并表（commit `2b2954d`）

**重叠分析驱动的合并决定**
- 1920s 与 modern 技能 91% 重叠（76 / 86 项中 74 共享）
- 单一 `SKILL_REGISTRY_ALL`，时代差异通过 `eraOnly` 字段精确表达
- 维护成本：共享技能改一处即两代生效；时代差异点（计算机使用 / 电子学 / 农艺 / 平面设计 / 视频剪辑 / 计算机科学 / 法医学 / 遗传学 / 链锯 / 马车 / 卡车 / 船 / 飞机 / 直升机）一目了然

**最终数据**
- 顶级技能 43 条：35 通用 + 7 多分支父类 + 1 克苏鲁神话
- 多分支：Art/Craft 13 / Science 15 / Firearms 6 / Fighting 10 / Drive 6 / Survival 6 / Language(Other) 8 = 64 条分支定义
- 按 era 过滤后：1920s 41 顶级 / 54 分支，modern 43 顶级 / 62 分支

**对外 API**
- `getSkillRegistry(era)`：按年代过滤，返回该年代下可用的技能与分支视图
- `findSkill(id)` / `findBranch(parentId, branchId)`：按 id 查询
- `isSkillSelectable(skill, era)`：判断该技能在创建期是否对玩家可见可勾选（克苏鲁神话与时代不符的项不可见）

**铁律**
- 克苏鲁神话进表但 `cthulhuOnly: true`，前端创建期不给玩家勾选
- 多分支父类 base 是"玩家自由声明分支"时的默认基础值；Firearms / Fighting / Drive 不允许自由分支，父类 base = 0 仅占位

### 阶段 4：1920s 职业模板（commit `2b2954d`）

**关键编码：`OccupationSkillRef` 5 种 kind 表达 7e 文档里的所有写法**
- `{ kind: "skill", id }` — 单一具体技能（"图书馆使用"）
- `{ kind: "anyBranchOf", parentId }` — 父类 + 任一分支（"艺术/手艺(任一)"）
- `{ kind: "branch", parentId, branchId }` — 父类 + 指定分支（"火器(手枪)"）
- `{ kind: "oneOf", options }` — 多选其一（"骑术 或 游泳"）
- `{ kind: "freeSlot", count }` — 自定 N 槽位（"自定 1"）

**简写 helper**：`s` / `any` / `br` / `oneOf` / `free`（在 `cocOccupations.ts` 文件内私有），让数据条目尽量短。

**自检**
- 1920s 全 43 条录入完毕，id 形如 `<slug>-1920s`
- id 唯一、最大槽位 8（警探 / 部族成员 / 狂信者 / 探险家 / 间谍）
- 所有技能 / 分支引用都能在合并表里查到

**待办（不阻塞 6/7/8）**
- 职业点池公式当前统一用 `EDU × 4` 兜底；CoC 7e 原版给不同职业差异化公式（律师 EDU×2+APP×2、运动员 EDU×2+(STR/DEX)×2 等），未来可以补到 `OccupationPointFormula.terms`
- 现版本 `description` 字段都没填，UI 折叠介绍如有需要再补

### 阶段 5：现代职业模板（commit `2b2954d`）

**1920s ↔ modern 不去重**：尊重 `.docs/occupation-list.md` 的明确警告。共有职业各取独立 id（`-1920s` / `-modern`），即便当前 coreSkills 完全相同，也保留扩展余地（未来可能给共有职业加时代风味变体）。

**modern 独占职业 10 条**：计算机程序员、计算机技师、Driver（与 1920s 司机 chauffeur 区分）、联邦特工、黑客、实验室技师、媒体名人、护士、特技人、卡车司机。

**自检**
- modern 全 39 条录入完毕，id 形如 `<slug>-modern`
- modern 独占技能（`computer-use` / `electronics` / `science-computer`）没有泄漏到 1920s 表
- 所有引用命中合并表

---

### 阶段 6：✅ 已完成（commit `021dd74`）

**文件改动**
- `src/components/CharacterCreator.tsx`
  - 职业字段：自由文本框 → "标准模板下拉（按 `selectedEra` 过滤）+ 自由文本兜底"二段式。state 拆为 `customOccupationId`（空串 = 自拟）+ `customOccupationFreeText`。
  - 表单新增 5 个 input：身份 / 国籍 / 居住地 / 母语 / 信用评级（0–99 数字）
  - 派生区追加第二行：闪避（DEX/2）/ 母语（EDU）/ 信用评级，全部经 `dodgeOf` / `motherTongueValue` 现算
  - 派生区追加"神秘接触档案"折叠占位：4 类条目静态显示"未接触"，标注"创建期为空 · KP 下发"
  - PNG 导入回填 + LLM generate-stats 回填都扩到 5 个新字段；职业字符串先尝试匹配模板 id / 中文名，匹配不到才落自由文本
  - Step 3 dossier 头部预览栏在性别/年龄后追加 5 个新字段的 chip（仅非空时显示）
  - `handleCreateCustom` 写入 `identity` / `nationality` / `residence` / `motherTongue` / `creditRating` / `mythicEncounters: { tomes: [], spells: [], artifacts: [], entities: [] }`
- `server.ts`
  - `GENERATE_STATS_SCHEMA` 扩 5 个字段（identity / nationality / residence / motherTongue / creditRating，creditRating 为 INTEGER 0–99）
  - generate-stats userText 改写：明确要求职业字段优先输出 7e 标准模板中文名（医师/警探/教授等），非标准设定（时钟塔代行者 / SCP特工等）才走自由文本

**未动**
- `CLASSIC_PRESETS`：3 张预设卡的职业名是自由风格，新字段全 optional 不补不出错；与"创建期空、KP 下发"的设计一致，也避免给预设卡硬塞与现有美学不一致的字段值
- `CharacterSheetPanel.tsx` / `CharacterDossierPanel.tsx`：游戏中已展示面板，留到后续 UI 美化时统一收口

**验证**
- `npx tsc --noEmit` ✅
- `npm run build` ✅
- 浏览器实测：**未做**（dev server 需要交互登录 + 我无法点击 UI）。后续如需验收：标准职业下拉是否好用、5 个新字段是否进 sheet、PNG 卡导入回填是否正确

---

### 阶段 7：✅ 已完成（commit `9cc2d7d`）

**新建 `src/lib/cocSkillSlots.ts`（490 行）**
纯函数槽位中间层，把数据层与 UI 解耦。核心 API：
- `expandOccupationSlots(template)`：模板 `coreSkills: OccupationSkillRef[]` 展开成 `SlotConstraint[]`（freeSlot×N 拆成 N 个 free 槽，oneOf 递归）
- `getSlotCandidates(c, era)`：返回某槽位约束在指定 era 下的候选项；free 槽走 `getAllStandardCandidates`（排除克苏鲁神话）
- `computePointPools(attrs)` → `{ occupation: edu*4, interest: int*2 }`；`spentInSlots`、`finalValueOfSlot`、`findDuplicateSelections`
- `draftToSkills(draft)`：12 槽折叠成 `CharacterSheet.skills`；同名取最大值；自动写入 `克苏鲁神话: 0`
- `distributeSkillsToDraft(skills, constraints, era)`：反向 distributor，给 PNG 导入与 LLM 回填用。三轮匹配（精确约束 → 模糊 → free → 兴趣槽），多余条目丢弃
- `parseSkillName`：解析 sheet 里的中文名，支持单技能、`父(分支)` 形式
- 默认导出常量：`OCCUPATION_SLOT_COUNT = 8`、`INTEREST_SLOT_COUNT = 4`、`customOccupationConstraints()` = 8 个 free 槽
- 槽位约束的中文渲染：`describeConstraint(c)` → "急救" / "艺术/手艺(摄影)" / "艺术/手艺(任一)" / "锁匠 或 妙手" / "自定"

**`src/components/CharacterCreator.tsx`**
- 废弃 9 项硬编码 `customSkills`，换成 `skillDraft: SkillSheetDraft`（8 职业槽 + 4 兴趣槽）
- `useMemo` 派生当前职业的 `occupationConstraints`；`useEffect` 在约束签名变化时重置职业槽（保留兴趣槽），固定槽（fixedSkill / fixedBranch）自动锁定 picked
- 技能 UI 整段替换：双池显示（职业 EDU×4 / 兴趣 INT×2，超额红字）+ 公式说明 + 槽位列表
- 新增内部子组件 `SlotRow`：约束提示 + `<select>` picker（候选项标"中文（base）"）+ 数字 input（额外加点 0–99）+ 实时 `base+加点=最终值` 显示；重复选择红框警告
- `handleCreateCustom` 用 `draftToSkills(skillDraft)` 折叠
- PNG 导入与 LLM 回填都改为 `distributeSkillsToDraft(...)`，按导入卡 / charData 的 occupation 字段尝试匹配模板，匹配不到走 8 free 槽

**未触碰的部分**
- `CharacterSheetPanel` / `CharacterDossierPanel`：仍走旧的 sheet.skills 字典展示，不受影响（折叠后字段格式完全兼容）
- `CLASSIC_PRESETS`：3 张预设卡走 `handleSelectPreset` 路径，不经技能槽，仍直接用预设卡的 skills 字典

**验证**
- `npx tsc --noEmit` ✅
- `npm run build` ✅
- 浏览器实测：**未做**（dev server 需交互登录 + 我无法点击 UI）。需手测：
  1. 切换职业 → 8 槽约束是否正确切换；固定槽是否锁定
  2. anyBranchOf / oneOf 槽的 dropdown 选项是否正确
  3. 双池显示与超额红字
  4. PNG 卡导入回填是否落到对的槽
  5. LLM 智能生成回填

---

## 待办阶段（推进时优先级与依赖）

### 阶段 8：随机宿命技能分配

依赖：阶段 7 完成（共享同一份"已选 / 点池"状态结构）

按 `.docs/character-card-current.md` 五节流程：
1. 读取当前 `年代背景` + `角色职业`，按 4.1 筛选"职业技能候选集"与"全标准技能集"
2. 候选集随机抽 8 项作为职业技能；自定 N 槽位从全标准技能集随机抽 N 项填入
3. 全标准技能集（去掉已选 8 项后）随机抽 4 项作为兴趣技能
4. 按 4.3 点数池规则在 8 + 4 项上**加权随机分配**（建议正态偏置，避免"全堆 1 项 / 全平均"）
5. 输出后玩家仍可在 UI 微调

**复用**：阶段 6 的"智能根据概述生成数值"按钮也要接入这套合法分配器（让 LLM 输出"职业 + 偏好倾向"，再由本地分配器走合法流程），避免 LLM 自由发挥越过规则。

---

## 跨阶段铁律（写入代码前过一遍）

- 字段全部 optional 添加，不破坏旧存档；序列化时 mythicEncounters 空对象与 undefined 都合法
- 所有派生值（DB / Build / MOV / Dodge / 母语技能值 / 信用评级实际算口径）按需现算，不进 `CharacterSheet`
- 克苏鲁神话固定 0、`cthulhuOnly: true`；只能通过 KP 在游戏中下发（`sanitySkillGain`）
- 1920s 与 modern 职业表不去重，时代风味用独立 id 隔离
- 美术规范：黑/绿/白 + LUC 金，跨界面统一；滚动条挂 `custom-scrollbar`
- 提交信息按 Conventional Commits 英文，**不**附加 `Co-Authored-By` 行
