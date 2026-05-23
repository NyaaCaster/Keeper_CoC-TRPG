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
| 6 | UI 改造：基本信息 + 派生层 | ⏳ 待开始 | `CharacterCreator.tsx` Custom PC 非技能部分 |
| 7 | UI 改造：技能区重做 | ⏳ 待开始 | 三栏（候选 / 8 职业 / 4 兴趣）、双点池校验 |
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

## 待办阶段（推进时优先级与依赖）

### 阶段 6：UI 改造 · 基本信息 + 派生层

依赖：阶段 1/4/5（已就绪）

**改造点**
1. `CharacterCreator.tsx` Custom PC 分页里的"角色职业"自由文本框 → 下拉。下拉项数据源：`getOccupations(selectedEra)`。
2. 新增 5 个字段的 UI：角色身份、国籍、居住地、母语、信用评级（前 4 项 free text，信用评级 0–99 数字输入）。
3. 派生区追加"神秘接触"折叠区。创建期内容为空（4 类条目均为空数组），UI 仅展示结构占位、给 KP 在游戏中下发的预览口径。
4. 同步：
   - PNG 角色卡导入 / 导出的 metadata schema（embed / 还原都要扩字段）
   - `CLASSIC_PRESETS` 三张预设卡补字段
   - 智能根据概述生成数值的 LLM prompt 和返回解析
5. `CharacterSheetPanel.tsx` / `CharacterDossierPanel.tsx` 等已有展示面板要不要展示新字段，视 UI 设计取舍

**注意事项**
- 字段全部 optional，旧存档要保证不报错（用 `?? ""` 兜底渲染）
- 信用评级范围 0–99，UI 不强制按职业表卡上下限（按 `.docs/character-card-current.md` 一节备注，"由玩家自行根据角色职业合理填写"）
- 美术规范铁律：黑/绿/白 + 少量金（LUC 槽），新字段不要自创配色，按 `.docs/UI-STYLE-GUIDE.md` 第 3 节

### 阶段 7：UI 改造 · 技能区重做

依赖：阶段 2 / 4 / 5（全就绪）

**核心**：删除当前固定 9 项技能 UI，重做为：
- 三栏视图：**职业技能候选集**（高亮在职业模板内的）/ **8 职业槽** / **4 兴趣槽**
- 多分支技能展开：点"艺术/手艺" → 弹分支选择子菜单（`branches: SkillBranchDefinition[]`）
- 双点池实时显示与校验：
  - 职业点池 = `EDU × 4`（默认；阶段 4 注释里有差异化预留位置）
  - 兴趣点池 = `INT × 2`
  - 互不通用、不可越下限（基础值即下限）、不可越 99 上限
- 提交时自动写入 `skills["克苏鲁神话"] = 0`
- 对外暴露：`derivePresentedSkills(sheet)` 返回"已掌握 12 项 + 隐式基础值"两层视图，供面板与 prompt 注入复用

**UI 状态机**：
- 选择"自定 N"槽位 → 玩家从全标准技能集（去掉已选 8 项后）挑一项填入
- 选择"X 或 Y" oneOf → 二选一收敛
- 选择"父类(任一)" anyBranchOf → 弹分支选择菜单
- 玩家可声明 `userDefined: true` 的自由分支（Art/Craft / Science / Survival / Language(Other) 允许）

**最大坑点**：状态结构要早设计好，避免改 8 次。建议用 `{ occupationSlots: SlotState[8], interestSlots: SlotState[4] }`，每槽 `{ ref: OccupationSkillRef, picked?: { skillId, branchId? }, points: number }`。

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
