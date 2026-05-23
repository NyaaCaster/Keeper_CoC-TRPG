# 自定义角色卡 · 内容模板

定义"建立档案 → 自主缔结专属卡片 (Custom PC)"分页中**自定义角色卡的字段模板、规则与派生口径**。本文是**规范文档**（spec），描述卡片应包含什么、字段语义、计算公式与辅助操作，**不**记录实现进度。

> 实现进度与阶段性改造记录见 `.docs/character-card-roadmap.md`。
> 对应代码：`src/components/CharacterCreator.tsx` Custom PC 子流程 + `src/types.ts` 的 `CharacterSheet` / `CharacterAttributes` / `MythicEncounters` / `InventoryEntry`。

---

## 一、基本信息

| 字段 | UI 控件 | 状态变量 | 备注 |
|---|---|---|---|
| 角色名称 | 文本框 | `customName` | 必填 |
| 角色职业 | 标准模板下拉（按 `selectedEra` 过滤）+ 自由文本兜底 | `customOccupationId` / `customOccupationFreeText` | 模板优先，匹配不到时落自由文本。模板表见 `src/data/cocOccupations.ts`（时代来源 `.docs/occupation-list.md`）。决定职业技能候选集与点池公式。 |
| 角色身份 | 文本框 | `customIdentity` | 自由填写，承担"角色扮演中的身份描述"。例：职业 = 会计师、身份 = 时钟塔学院政法科专员。仅供 LLM 叙事使用，不参与规则数值。 |
| 性别 | 下拉 | `customGender` | 男 / 女 / 未详 |
| 年龄 | 数字 10–100 | `customAge` | 默认 30，未触发年龄修正 |
| 国籍 | 文本框 | `customNationality` | 自由填写。本项目**忽略**出生地（Birthplace）字段。 |
| 居住地 | 文本框 | `customResidence` | 自由填写（城市 / 街区粒度） |
| 年代背景 | 上一步选择继承 | `selectedEra` → `background` | `"1920s"` / `"modern"`。决定职业模板、技能 era 过滤、武器表 era 过滤、起始现金公式 |
| 母语 | 文本框 | `customMotherTongue` | 自由填写名称。技能值 = EDU 由派生函数现算，**不在角色卡 UI 展示**。 |
| 信用评级 | 数字 0–99 | `customCreditRating` | CoC 7e Credit Rating。本项目移到基本信息层（不进技能表）。同时驱动起始现金 / 资产 / 生活水准派生。本项目**不**强校验职业 CR 上下限。 |
| 头像 / 肖像 | 文件上传（JPG/PNG） | `customAvatar` | Base64 内嵌，未上传时显示名字首字 |
| 角色概述 / 生平背景 | 多行文本框 | `customOverview` | 同时供"智能生成数值"使用 |

## 二、八维属性（Characteristics）

| 字段 | 范围 | 状态变量 | 说明 |
|---|---|---|---|
| 力量 STR | 15–99 | `customAttrs.str` | — |
| 体质 CON | 15–99 | `customAttrs.con` | — |
| 体型 SIZ | 15–99 | `customAttrs.siz` | — |
| 敏捷 DEX | 15–99 | `customAttrs.dex` | — |
| 外貌 APP | 15–99 | `customAttrs.app` | — |
| 智力 INT | 15–99 | `customAttrs.int` | — |
| 意志 POW | 15–99 | `customAttrs.pow` | — |
| 教育 EDU | 15–99 | `customAttrs.edu` | — |
| 幸运 LUCK | 15–99 | `customAttrs.luck` | 作为独立维度，符合 7e |

## 三、派生属性（按需现算，只读展示）

| 字段 | 公式 | 字段名 / Helper | 备注 |
|---|---|---|---|
| 生命值 HP | `(CON + SIZ) / 10` 向下取整 | `hp` / `maxHp` | — |
| 魔法值 MP | `POW / 5` 向下取整 | `mp` / `maxMp` | — |
| 理智值 SAN | `= POW` | `san` / `maxSan` | — |
| SAN 上限 | `99 − 克苏鲁神话` | `maxSanLimit` | — |
| 闪避 Dodge | `DEX / 2` 向下取整 | `dodgeOf(dex)` | 不进 `sheet.skills`，纯派生 |
| 母语技能值 | `= EDU` | `motherTongueValue(edu)` | 不进 `sheet.skills`，纯派生 |
| 克苏鲁神话 | 固定 0 | `mythos` | 创建期不可调；游戏中由 KP 通过 `sanitySkillGain` 等下发（遭遇神话生物 / 阅读神话典籍 / 学习仪式法术等触发） |
| 神秘接触 | 创建期空 | `mythicEncounters` | 4 类容器（神话著作 / 法术 / 神器 / 实体），KP 在游戏中按 7e 规则追加 |

## 四、技能

### 4.1 候选规则

按 CoC 7e 规则，调查员的可选技能由两条数据源筛选：

1. **年代筛选**：`selectedEra` → `getSkillRegistry(era)`，从 `src/data/cocSkills.ts` 的 `SKILL_REGISTRY_ALL` 过滤出当代可选的标准技能（含通用技能 + 多分支父类）
2. **职业筛选**：所选职业模板的 `coreSkills: OccupationSkillRef[]`，5 种 kind 表达（`skill` / `branch` / `anyBranchOf` / `oneOf` / `freeSlot`）

> **信用评级 / 母语 / 闪避**已移出职业模板与技能表（详见基本信息层 / 派生层）。
> **克苏鲁神话**默认 0、`cthulhuOnly: true`，创建期不可见、不可选。

### 4.2 槽位结构

- **职业槽 8 个**：从职业模板展开（`expandOccupationSlots(template)`），自拟职业 = 8 个 free 槽
- **兴趣槽 4 个**：永远 4 个 free 槽，从全标准技能集任意挑选
- 合计上限 **12 项**；未被选中的标准技能保留基础值，跑团时仍可走基础值检定

### 4.3 点数池

- **职业池** = 职业模板 `occupationPointFormula`，当前阶段统一兜底 `EDU × 4`
- **兴趣池** = `INT × 2`
- 单项最终值 ≤ **99**；下限 = 该技能基础值（不能往下扣）
- 两池**互不通用**：职业点不能投兴趣槽，反之亦然
- 提交时自动写入 `skills["克苏鲁神话"] = 0`，不占用任何点池

### 4.4 重复检测

同一技能 / 分支不能在多个槽位重复（UI 红字提示，不强阻拦提交，提交时按最大值合并）。

## 五、装备与资产

### 5.1 现金（派生，创建期不可调）

按 CoC 7e 玩家手册第 4 章 Step 7：

| 时代 | 起始现金公式 |
|---|---|
| 1920s | `CR × $1` |
| modern | `CR × $20` |

UI 在派生区展示形如 "起始现金: $30 (CR 30 × $1)" 的派生行，**不**进 `CharacterSheet`。同时按 CR 区间显示生活水准（贫困 / 中等 / 富有 / 富豪 / 超级富豪），由 `cocRules.ts` 现算。

> **资产 / 储蓄 / 不动产**走"游戏中由 KP 维护"，本阶段不在创建期 UI 暴露。
> 现金的"游戏中余额"作为 `CharacterSheet` 的运行时字段，初值 = 派生起始现金；由 KP 在跑团中扣加。

### 5.2 随身槽位（家规：8 槽硬上限）

> ⚠ **House Rule**：CoC 7e 原版**没有**重量 / 容量 / 槽位上限，玩家手册仅提供"投资人合理拥有的工具就视为已有"的叙事原则。本项目限定 **8 个槽位**，让"装备选择"产生有意义的取舍。

字段：`inventory: InventoryEntry[]`，长度恒为 8（空槽用默认值占位）。每槽是判别联合：

```ts
type InventoryEntry =
  | { kind: "item"; text: string }                          // 默认 = { kind: "item", text: "" }
  | { kind: "weapon"; weaponId: string; ammo: number };     // ammo 由数据表 maxAmmo 派生
```

- **默认 / 空槽**：`{ kind: "item", text: "" }` — 视为该槽未携带物品
- **武器 + 物品共享池**：合计 ≤ 8。极限情况：8 件武器、8 个物品、8 槽全空都合法
- **弹药**：跟随武器条目（`ammo` 字段），**不**单独占槽
- **重要物品 / 意义之锚**：当作一般 `item` 录入，无特殊标记位

### 5.3 武器数据（结构化）

武器列表见 `src/data/cocWeapons.ts`（按时代分两套 + 部分跨代通用项，独立整理）。每条武器结构如下：

```ts
interface WeaponDefinition {
  id: string;
  nameZh: string;
  nameEn: string;
  era: "1920s" | "modern" | "any";
  skillRef: OccupationSkillRef;     // 关联技能（仅用 "skill" / "branch" 两种 kind）
  damage: { dice: string; addDB?: boolean; halfDB?: boolean };
  range: string;                    // 近战 = "触及"，火器 = "15m" 等字符串
  attacks: string;                  // "1" / "2" / "1(3)" 等表达式
  maxAmmo: number;                  // 装弹数；近战 = 0
  malfunction?: number;             // 命中骰 ≥ 此值则故障；无此项则忽略
}
```

UI 在槽位下拉里**只展示 `nameZh`**，结构化数据通过 `weaponId` 引用查表。创建期 `ammo = maxAmmo` 自动写入，**玩家不可调**；跑团时由 KP 在 sheet 上扣加。

**伤害派生口径**（与 `cocRules.ts` 的 DB 系统配合）：

- 近战武器：`dice + DB`（`addDB: true`）
- 火器：`dice`，**不加 DB**
- 投掷武器：`dice + ½ DB`（`halfDB: true`）
- 裸拳"斗殴"：`1D3 + DB`

### 5.4 物品（自由文本）

`{ kind: "item", text }`：玩家自由填写文字描述（"出诊包" / "雷明顿打字机" / "父亲的怀表" 等）。无结构化字段、无颗粒度强制——"出诊包" 与 "出诊包(听诊器+吗啡+纱布)" 都合法。

### 5.5 槽位 UI 交互

每个槽位是一行：

1. 左侧 **类型下拉**：物品 / 武器（默认 = 物品）
2. 中间内容区：
   - 物品 → 自由文本 input
   - 武器 → 按 era 过滤的武器名下拉（仅显示 `nameZh`）
3. 右侧 / 副信息行：武器槽附带显示 `damage / range / ammo` 的小字提示

## 六、辅助操作

| 功能 | 说明 | 触发按钮 |
|---|---|---|
| 随机宿命投骰 | 八维各 `3D6 × 5`（SIZ / INT / EDU 走 `(2D6+6) × 5`），全量重置 | 「随机宿命投骰 (3D6 Roll)」 |
| 随机宿命技能分配 | 一键合法分配 8 + 4 槽 + 双池加权随机点数（`src/lib/cocSkillRandomizer.ts`），保证不超 99 / 不低于 base、双池独立 | 「随机宿命技能分配」 |
| 智能根据概述生成数值 | 调 LLM 按 `customOverview` 生成属性 + 职业 + 技能偏好；技能点数**交本地分配器**走双池合法切分（不让 LLM 自由发挥越过规则） | 「根据概述生成数值并分配」 |
| 导入 PNG 角色卡 | 从带 metadata 的 PNG 还原属性、技能、头像（保留导入语义，不强行合法化点数） | 「上传角色卡图片」 |
| 上传肖像 | 仅头像，会话内有效 | 「上传肖像图片 (JPG/PNG)」 |

## 七、疯狂状态机（运行时维护，非创建期）

`sanityState` 在 `CharacterSheet` 中已建模，**创建期不暴露**：

| 字段 | 说明 |
|---|---|
| `episodeSanLoss` | 本模组累计 SAN 损失（用于 1/5 阈值判断） |
| `madness` | `null` / `"bout"` / `"temporary"` / `"indefinite"` |
| `boutTurnsRemaining` | 急性发作剩余玩家输入次数 |
| `temporaryTurnsRemaining` | 临时疯狂剩余 keeper 回合数 |
| `boutRoll` | 1–10，对应规则 10 疯狂表项 |
| `indefiniteAnchor` | 不定期疯狂触发锚点 |
