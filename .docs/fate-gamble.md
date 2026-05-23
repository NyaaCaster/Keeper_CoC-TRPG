# 命运博弈（Fate Gamble）规则备忘

本项目对 CoC 7th 中两条玩家可主动调用的"补救机制"的内部统称为 **命运博弈**，包含：

- **孤注一掷（Push）** —— 对应 7e 规则的 *Push the Roll*。本项目家规版口径：**孤注一掷失败必定为大失败（Fumble）**。
- **燃运（Burn Luck）** —— 对应 7e 规则的 *Spending Luck Points*。本项目家规版口径：**只能压到普通成功线，不能升档**。

判定与执行**完全由前端硬规则完成**，不依赖 LLM 决策。LLM 只在最终的 `outcomeMessage` 里收到结果通报，用于叙事呈现。

---

## 一、术语映射

| 内部代号 | 玩家可见用词 | 7e 原术语 | 备注 |
|---|---|---|---|
| 命运博弈 | 命运博弈 | —（项目自创伞名） | 仅本项目内部使用 |
| 孤注一掷 | 孤注一掷 | Push the Roll / 推骰 | "推骰"在中文桌面少用 |
| 燃运 | 燃运 | Spending Luck Points | "消费幸运"也少用 |

---

## 二、命运博弈唤起点矩阵（按投骰路径）

项目内所有 `RollDiceModal` 的触发源被归为四条路径：

| # | KeeperResponse 字段 | 触发方式 | modal flag 组合 | 完成回调 |
|---|---|---|---|---|
| **A** | `rollRequest` | 聊天卡片"投掷 D100"按钮（`App.tsx:1024–1035`） | `isKeeperRoll=false` / `isSanityCheck=false` / `isSecret=false` | `handleRollComplete` |
| **B** | `keeperRoll` + `isSecret:false` | 收到响应自动弹（`App.tsx:320–331`） | `isKeeperRoll=true` / `isSanityCheck=false` / `isSecret=false` | `handleKeeperRollComplete` |
| **C** | `keeperRoll` + `isSecret:true` | 同上，骰点全打码 | `isKeeperRoll=true` / `isSanityCheck=false` / `isSecret=true` | `handleKeeperRollComplete` |
| **D** | `sanityCheck` | 收到响应强制弹，禁取消（`App.tsx:454–462`） | `isKeeperRoll=false` / `isSanityCheck=true`（按 `skillName.includes("SAN")` 判） / `isSecret=false` | `handleSanityCheckComplete` |

### 命运博弈开关矩阵

| 路径 | 孤注一掷 | 燃运 | 说明 |
|---|:---:|:---:|---|
| **A 玩家明骰**（普通技能） | ✅ | ✅ | 命运博弈唯一全开放路径 |
| **A · 战斗骰子集**（命中战斗白名单） | ❌ | ❌ | CoC 7e 硬禁 |
| **A · 幸运检定**（`luck` / `幸运` / `运气`） | ❌ | ❌ | "用 LUC 救 LUC 检定"逻辑悖论 |
| **B 守密人明骰**（NPC / 环境） | ❌ | ❌ | 玩家无权干预 KP 资源结算 |
| **C 守密人暗骰** | ❌ | ❌ | 玩家本就看不到结果 |
| **D 理智检定（SAN）** | ❌ | ❌ | CoC 7e 硬禁 |

### 成败维度（仅对路径 A 进一步收窄）

| `successType` | 孤注一掷 | 燃运 | 说明 |
|---|:---:|:---:|---|
| `critical` / `extreme` / `hard` / `regular` | — | — | 已成功，不显示命运博弈按钮 |
| **`failure`（普通失败）** | ✅ | ✅ | 唯一可救 |
| `fumble`（首投大失败） | ❌ | ❌ | 7e 硬禁，必须接受 |

> 燃运还有数值条件：`character.attributes.luck >= calculatedTotal - targetValue`，否则按钮即便允许也禁用。

### 同一次掷骰的互斥

| 已采取动作 | 孤注一掷 | 燃运 |
|---|:---:|:---:|
| 都未采取 | ✅ | ✅ |
| 已孤注一掷 | ❌ | ❌ |
| 已燃运 | ❌ | ❌ |

> 孤注一掷只能用 1 次；任一动作执行后另一动作均禁用，二者**永不可叠加**。

---

## 三、孤注一掷（Push）—— 项目家规

### 触发条件
1. 路径必须是 A，且不命中战斗白名单 / 幸运检定。
2. 首投结果为 `failure`（不是 fumble、不是已成功）。
3. 本次掷骰未曾使用过孤注一掷或燃运。

### 二投结算
- 用 **同一个** `targetValue` / `bonus` / `penalty` 再投一次，覆盖原 `dice10 / dice1 / total`。
- **真实成功等级保留**：二投投出 critical / extreme / hard / regular 按真实等级照常呈现。
- **失败强制升格为 fumble**：二投若结果为 `failure`，前端**强制改写为** `successType = "fumble"`，UI 用红色 Skull banner，回传 KP 的 `outcomeMessage` 也按 fumble 口径拼写。
  - 这是项目家规对 7e 规则的"机制层加重"，不再依赖 LLM 决定如何"加重"。
  - 二投真投出 fumble（96–100 / 100，视 target 而定）则照常 fumble。

### 回报 KP 的 message 模板
```
[孤注一掷 (Push)] 玩家选择孤注一掷：首投 XX 失败 → 二投 YY → 强制大失败（Fumble）。
请按 CoC 7e 大失败口径处理叙事后果。
```
（成功 / 真实大失败 / 升格大失败 三类各自一段文案）

---

## 四、燃运（Burn Luck）—— 项目家规

### 触发条件
1. 路径必须是 A，且不命中战斗白名单 / 幸运检定。
2. 首投结果为 `failure`。
3. 本次掷骰未使用过孤注一掷或燃运。
4. 玩家剩余 LUC ≥ 系统计算所需点数。

### 计算公式
```
cost = calculatedTotal - targetValue
```
- 例：技能 80，投 81 → `cost = 1`，烧 1 点压到 80（普通成功线）。
- 1 点幸运修正 1 骰点。
- **永久消耗**：扣减后的 LUC 不会自动回复，恢复需 KP 在叙事中显式给出（暂未实现自动回复机制）。

### 玩家不可自定义消耗量
- 玩家**不能自由选择**消耗多少幸运点。
- 系统只给出唯一选项：**是 / 否消耗 `cost` 点把判定刚好压到普通成功线**。
- **不允许升档**：即便玩家点数充足，也不能花更多点压到 hard / extreme，因此首投本身就是 hard / regular 等成功档时，UI 不显示燃运按钮。

### 回报 KP 的 message 模板
```
[燃运 (Burn Luck)] 玩家燃烧 N 点幸运，将 XX 改写为普通成功（剩余 LUC = M）。
```
KP 应在 narrative 中将其叙事化为"危急关头一闪念的好运"，不要把它当作技能本身真的成功。

---

## 五、识别规则（前端硬实现）

战斗骰 / 幸运检定均靠 `skillName` 关键词识别（LLM 不再下发额外标记）。建议集中在 `src/lib/rollPolicy.ts`：

### 战斗判定关键词
- 近战：`闪避` / `斗殴` / `招架` / `格斗` / `近战` / `武术`
- 射击：`射击` / `手枪` / `步枪` / `霰弹枪` / `机枪` / `冲锋枪` / `狙击` / `弓` / `弩` / `投掷`
- 兜底正则：形如 `XX/YY` 的武器组合，命中 `/枪|箭|刀|剑|斧|锤|镖/` 视为战斗骰。

> 与 `src/data/presets.ts` 预设技能列表口径对齐（line 45/89/111/135/179）。

### 幸运检定关键词
- `skillName.toLowerCase() === "luck"` 或 `skillName` 等于 `幸运` / `运气`。

### SAN 检定
- 沿用现有 `skillName.includes("SAN")` 口径（`App.tsx:1178/1189/1196`、`RollDiceModal` 内部）。

---

## 六、判定函数接口草案（位于 `src/lib/rollPolicy.ts`）

```ts
export function canPushRoll(req: RollRequest, result: RollResult): boolean {
  if (req.isKeeperRoll) return false;          // 排除 B / C
  if (isSanityCheck(req)) return false;        // 排除 D
  if (isCombatSkill(req.skillName)) return false;
  if (isLuckCheck(req.skillName)) return false;
  if (result.successType !== "failure") return false; // 不救 fumble、不救成功
  return true;
}

export function canBurnLuck(
  req: RollRequest,
  result: RollResult,
  remainingLuck: number,
): { allowed: boolean; cost: number } {
  if (req.isKeeperRoll) return { allowed: false, cost: 0 };
  if (isSanityCheck(req)) return { allowed: false, cost: 0 };
  if (isCombatSkill(req.skillName)) return { allowed: false, cost: 0 };
  if (isLuckCheck(req.skillName)) return { allowed: false, cost: 0 };
  if (result.successType !== "failure") return { allowed: false, cost: 0 };
  const cost = result.total - result.targetValue;
  return { allowed: remainingLuck >= cost, cost };
}
```

---

## 七、协议扩展（最小改动）

### `src/types.ts`
- `RollResult` 增加：
  - `pushed?: boolean` —— 是否经过孤注一掷
  - `pushForcedFumble?: boolean` —— 是否因孤注一掷失败被升格为 fumble
  - `luckSpent?: number` —— 燃运消耗点数（>0 即代表使用过燃运）

### `server.ts` `SYSTEM_INSTRUCTION`
- 加入 4.4 节"命运博弈"，告知 KP 玩家可能在系统报告中用上述两种标记之一，并给出叙事处理范例。
- **不赋予 KP 否决权**——所有规则化判定已在前端完成。

### `CharacterSheetPanel`
- LUC 槽需要支持 `luckDiff` 浮字动画，复用现有 HP/MP/SAN diff 动画机制。
- 燃运成功后由 `App.tsx` 触发 `setLuckDiff(-cost)`，3 秒后自动归零。

---

## 八、UI 接入点（不实现，仅说明）

`RollDiceModal.tsx` 的 `phase === "settled"` 区块（约 line 538）在原"契定结果"按钮**前**插入并列两枚按钮：

| 按钮 | 显示条件 | 禁用条件（按钮可见但不可点） |
|---|---|---|
| **孤注一掷** | `canPushRoll(...)` 为 true 且本次未用过命运博弈 | — |
| **燃运 N 点** | `canBurnLuck(...).allowed` 为 true 且本次未用过命运博弈 | LUC 不足时整体不显示，按钮文案动态显示 cost |

执行流程：
- 点孤注一掷 → 锁定 `actionTaken="pushed"` → 重新进入 `rolling` 阶段 → 二投覆盖结果 → 失败强制 fumble → 回到 settled 阶段，两按钮均禁用。
- 点燃运 → 锁定 `actionTaken="burned"` → 直接改写 `total = targetValue`、`successType = "regular"`、扣 LUC、`outcomeMessage` 加燃运标记 → 两按钮均禁用。

---

## 九、家规与 7e 原版对照表

| 项 | CoC 7e 原规则 | 本项目家规 |
|---|---|---|
| 推骰失败后果 | KP 自由裁定加重后果（伤害 / 暴露 / SAN 等） | **强制升格为大失败（Fumble）**，KP 按 fumble 口径叙事 |
| 推骰是否需 KP 同意 | 是，KP 可拒绝 | **不需要**，前端硬规则放行 |
| 推骰二投是否分等级 | 分（critical / extreme / hard / regular / failure / fumble） | 分（**真实成功等级保留**，失败统一升格 fumble） |
| 幸运消费量 | 玩家自由选择消耗几点 | **不可自由选择**，仅"是否消耗系统算好的 cost" |
| 幸运升档 | 可选变体（罕用） | **不允许**，仅可压到普通成功线 |
| 幸运恢复 | KP 在章节间裁量给 | 暂未实现自动回复，依赖 KP 叙事 |
| 战斗骰禁用 | 攻击 / 闪避 / 招架 | 同上，按战斗白名单识别 |
| SAN 检定禁用 | 是 | 是 |
| 幸运检定禁用 | 是 | 是 |

---

## 十、实施顺序建议

1. **燃运**（纯前端，无需 LLM 协议改动）
2. **孤注一掷**（需 `RollResult` 字段扩展 + 二投流程 + fumble 强制升格）
3. **互斥锁** + **LUC 槽 diff 动画**
4. **`SYSTEM_INSTRUCTION` 4.4 节** 补充"命运博弈"叙事提示
5. **战斗骰白名单**（等项目真的引入战斗骰路径时收紧）

---

> 最后更新：2026-05-23
> 本文件是项目命运博弈机制的强制性规范，所有掷骰相关 UI / 协议 / 文案改动须以此为准。如与 CoC 7e 原书冲突，以本文件为准（项目家规优先）。
