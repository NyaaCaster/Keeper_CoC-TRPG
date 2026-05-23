# 二阶段投骰（Two-Stage Roll）规则备忘

本项目把"先掷一次决定**成败**、再掷一次决定**数值后果**"这套表现机制内部统称为
**二阶段投骰**，由两个组件协作完成：

- **判定投（Judgment Roll）** —— 走 `RollDiceModal`，1d100 比技能值，决定 successType。
- **效果投（Effect Roll）** —— 走 `EffectRollModal`，按 `NdM[+const][/divisor]` 公式滚动，
  决定一次具体的数值后果（SAN 损失、伤害、治疗量等）。

两段彼此解耦：判定 modal 关闭后，调用方按需 `setPendingEffectRoll(...)` 把效果骰描述
推入挂起态，由 `EffectRollModal` 演完动画再统一应用副作用。判定 modal 不感知效果骰存在，
效果骰也不知道前面有没有判定 modal——这是接入新路径时最重要的不变量。

唯一的判定与执行权在前端硬规则，LLM 只通过下发的公式字符串影响这条流水线。

---

## 一、术语映射

| 内部代号 | 玩家可见用词 | 7e 原术语 | 备注 |
|---|---|---|---|
| 判定投 | 判定 | Skill Roll / Resistance Roll | 只决定成败等级，不决定数值 |
| 效果投 | 效果骰 | Damage Roll / Sanity Loss / Healing Roll | 决定一次结算的具体数值 |
| 二阶段投骰 | —（玩家不感知名称） | —（项目自创伞名） | 仅本项目内部使用 |

> 命运博弈（[[fate-gamble]]）也涉及"二投"，但那是**判定投本身**的二投覆写，
> 与本规范的"判定 → 效果"完全不同维度，**不要混为一谈**。

---

## 二、机制核心规则

### 静态 / 动态公式分流（铁律）

效果投是否真的弹浮窗，由 `rollDiceFormula(formula)` 的 `isStatic` 字段决定：

| 公式形态 | `isStatic` | 是否弹 EffectRollModal | 处理方式 |
|---|:---:|:---:|---|
| 空串 / `"0"` | true | ❌ | 跳过浮窗，效果值 = 0 |
| 纯数字 `"3"` / `"5"` | true | ❌ | 跳过浮窗，效果值 = 该数字 |
| `1d6` / `2d10+2` / `1d10/2` | false | ✅ | 弹浮窗，演 800ms 滚 + 揭晓 + 1.5s 自动关 |
| 解析失败（`isValid=false`） | false | ❌（按 0 处理） | 兜底为 0，并把原始字符串原样回显给 KP |

> 理由：纯数字没有悬念也没有动画价值，弹浮窗反而打断节奏；只有**真有随机性**才值得让玩家"再握一次骰"。

### 效果投的不可干预性（铁律）

CoC 7e 规则下，**效果骰不允许 push、不允许燃运、不允许任何玩家干预**。这与判定投的命运博弈
是泾渭分明的两条路径，永不混用。

- `EffectRollModal` 设计上**没有任何按钮**，连"跳过/确定"都没有，靠 `autoCloseMs`（默认 1500ms）
  自动关闭并 resolve。
- 调用方**禁止**在 `onResolve` 回调里二次掷骰、改写结果、或弹出"是否接受"确认。
- 测试模式（[[testing-commands]] 的 `[sys_test]san_fail`）下也只演动画不真扣，
  绝不能借测试通道引入"重投"按钮。

### 求值时机（铁律）

`rollDiceFormula` 必须在调用方**预先求值**，把得到的 `DiceFormulaResult` 传进 `EffectRollModal`，
而不是把公式字符串扔进去让组件自己 roll。原因是子组件可能 unmount/remount（导航切换、Strict
Mode 双调用等），在子组件内部随机会导致同一次效果骰演出现两次不同的最终值。

> 这是 SAN 路径上踩过的坑，新接入路径直接照抄 `handleSanityCheckComplete` 的写法即可。

### 测试模式分支（铁律）

任何接入二阶段投骰的路径都必须考虑 `RollRequest.testForce` 测试 sentinel：

- 判定 modal 完成回调里，**先检查 `testForce`，命中则只演动画不应用副作用**；
- 但**仍然要演效果投浮窗**（动态公式时），让用户能反复测试动画；
- 测试模式下 SAN 不真扣 SAN，伤害不真扣 HP，治疗不真回血——只触发 diff 浮字。

完整范例见 `App.tsx:1349-1393` 的 `onComplete` 回调。

---

## 三、二阶段投骰唤起点矩阵

把项目里所有可能产生数值变动的事件按"判定 + 效果"两段框架重新审视一遍：

| # | 事件源 | 判定投 | 效果投公式来源 | 当前接入状态 | 优先级 |
|---|---|---|---|---|:---:|
| **A** | SAN 检定 | `RollDiceModal`（紫色） | `sanityCheck.lossOnSuccess` / `lossOnFailure` | ✅ 已接入 | — |
| **B** | 玩家受伤 | 战斗判定 / 环境判定 | KP 下发的伤害公式（待协议扩展） | ❌ 当前 KP 直接给整数 `hpChange` | ⭐⭐⭐ |
| **C** | 急救 / 医学治疗 | 急救或医学技能判定 | KP 下发的治疗公式 | ❌ 当前 KP 直接给整数 `hpChange` | ⭐⭐ |
| **D** | 武器伤害骰 | 战斗骰命中后 | 武器自带 damage 公式 | ❌ 项目尚无武器系统 | ⭐ |
| **E** | 魔法施放反噬 | POW 对抗 / 神话使用判定 | KP 下发的 MP/SAN 损失公式 | ❌ 当前 KP 直接给整数 | ⭐⭐ |
| **F** | 神话技能成长 | —（无判定） | `sanitySkillGain`（按 7e 是 1d10） | ❌ 当前是定值 | ⭐ |
| **G** | 大失败叙事附带强制扣属性 | 普通技能判定的 fumble | KP 下发的 hp/san 损失公式 | ❌ 当前 KP 直接给整数 | ⭐⭐ |

### 不应接入二阶段（保持单段）

| 路径 | 不接入原因 |
|---|---|
| 命运博弈的二投（[[fate-gamble]]） | 那是判定投本身的覆写，不是效果骰，**永不可用 EffectRollModal** |
| KP 暗骰（`keeperRoll + isSecret`）的效果 | 玩家本就不该看到判定结果，弹浮窗即破功 |
| 幸运检定 | 不涉及数值后果，没有效果维度 |
| 静态公式（`"0"` / 纯数字） | `isStatic=true` 已在判定回调里同步结算，跳过浮窗是已有特性 |
| 燃运扣 LUC | 是规则化扣减不是骰子结果，已有 luckDiff 浮字即可 |

---

## 四、协议扩展草案

要把 B / C / E / G 这四类纳入二阶段，最干净的做法是给 `KeeperResponse.characterUpdates`
增加**公式版本字段**，与现有的整数字段**互斥共存**（KP 二选一下发）。

### `src/types.ts` 改动

```ts
export interface KeeperResponse {
  // ...现有字段...
  characterUpdates?: {
    // 现有：直接整数（无悬念事件，KP 仍可下发）
    hpChange?: number;
    mpChange?: number;
    sanChange?: number;
    sanitySkillGain?: number;

    // 新增：公式版本（含 NdM 时弹效果骰浮窗）
    /** 例 "1d6+1" / "2d4" — 玩家受伤 */
    hpDamageFormula?: string;
    /** 例 "1d3" — 急救/医学治疗 */
    hpHealFormula?: string;
    /** 例 "1d4" — 魔法反噬 */
    mpCostFormula?: string;
    /** 例 "1d6" — 大失败附带的强制 SAN 损失（独立于 sanityCheck 路径） */
    sanLossFormula?: string;

    // 注：sanityCheck 路径自带 lossOnSuccess/lossOnFailure，不需要在 characterUpdates 重复。
  } | null;
}
```

互斥规则：**同一类属性**的整数字段与公式字段二选一，不能同时下发。前端按"公式优先"处理：
若 `hpDamageFormula` 存在则忽略 `hpChange`（伤害侧），治疗同理。

### `server.ts` `SYSTEM_INSTRUCTION` 改动

在 4.x 节追加"伤害与效果骰"指引：

> 当扣血/扣 MP/扣 SAN 的数值**带随机性**（如武器伤害、咒语反噬），用 `hpDamageFormula` /
> `mpCostFormula` / `sanLossFormula` 下发公式字符串（`NdM[+常数][/除数]`），前端会弹效果
> 骰浮窗演投。**确定性**的数值变动（如剧情设定的固定 5 点 HP 恢复、定额魔力消耗）继续用
> 整数字段 `hpChange` / `mpChange` / `sanChange`，前端不弹浮窗直接结算。
> 同一类属性不要同时下发整数和公式版本。

### `RollResult` 不需要扩展

效果骰**不写入 `RollResult`**——它属于"判定结果之后"的独立步骤，由各业务回调自行串联。
保持 `RollResult` 只描述判定本身，避免污染命运博弈、暗骰等已有判定相关字段。

---

## 五、识别规则与主题选择

EffectRollModal 当前只有两套主题（`sanity` / `default`），按事件源确定：

| 事件源 | theme | label 文案 | 备注 |
|---|---|---|---|
| SAN 损失（成功 / 失败） | `sanity`（紫色） | `理智损失` | 已实现 |
| 玩家受伤（HP 减） | `default`（暖金） | `伤害值` | 待实现，沿用判定 modal 的金色调 |
| 治疗（HP 加） | `default` | `治疗量` | 待实现；正向数值，diff 浮字走绿色 |
| 魔法反噬（MP 减） | `default` | `魔力消耗` | 待实现 |
| 大失败附带 SAN 损失 | `sanity` | `理智损失` | 复用 SAN 主题，与正常 SAN 检定视觉统一 |
| 神话技能成长 | `default` | `神话洞察` | 极低优先级，先保持定值 |

> **不要**为了区分新路径而新增 theme——主题是 UI 调性问题不是路径问题。当前两套已覆盖所有场景。

---

## 六、调用方接入模板（伪代码）

任何新路径接入二阶段投骰，都套用同一个三步模板，与 `handleSanityCheckComplete` 同构：

```ts
function handleXxxRollComplete(rollResult: RollResult, formula: string) {
  // 1. 求值（在调用方完成，不在子组件里 roll）
  const evaluated = rollDiceFormula(formula);

  // 2. 静态公式 → 同步结算，跳过浮窗
  if (evaluated.isStatic) {
    applyXxxEffect(rollResult, formula, evaluated);
    return;
  }

  // 3. 动态公式 → 推挂起态，演完动画再结算
  setPendingEffectRoll({
    label: "伤害值",          // 或 "治疗量" / "魔力消耗" / ...
    formula,                  // 原样回显给玩家与 KP 报告
    result: evaluated,        // 已求值，组件不再随机
    theme: "default",         // 或 "sanity"
    onResolve: (resolved) => {
      setPendingEffectRoll(null);
      applyXxxEffect(rollResult, formula, resolved);
    },
  });
}

function applyXxxEffect(rollResult, formula, evaluated) {
  // 扣属性 → 触发 diff 浮字 → 拼 outcomeMessage 回报 KP
  // 注意：测试模式下走另一条短路，不真扣属性。
}
```

> 实施时直接复制 `handleSanityCheckComplete` + `applySanityLoss` 这一对函数改写，
> 比从零写更安全。

---

## 七、UI 接入点

`App.tsx` 顶层已经渲染了一个**全局唯一**的 `EffectRollModal`（line 1404-1413），消费同一个
`pendingEffectRoll` state。所有新路径**复用这个 modal**，不要再渲染第二个实例。

挂起态契约：

```ts
const [pendingEffectRoll, setPendingEffectRoll] = useState<{
  label: string;
  formula: string;
  result: DiceFormulaResult;
  theme?: "sanity" | "default";
  onResolve: (result: DiceFormulaResult) => void;
} | null>(null);
```

互斥与排队：

- 同一时刻**只能有一个** `pendingEffectRoll`。判定 modal 完成 → 推挂起态 → 浮窗 resolve →
  `setPendingEffectRoll(null)` → 此时才允许下一次推入。
- 若一次判定既要扣 HP 又要扣 SAN（大失败 + SAN 冲击），**串行**：第一个 onResolve 里再
  `setPendingEffectRoll` 第二个，不要并发。

---

## 八、家规与 7e 原版对照表

| 项 | CoC 7e 原规则 | 本项目家规 |
|---|---|---|
| 效果骰是否可重投 | 否（除特殊魔法物品） | **绝对禁止**，浮窗无按钮 |
| 效果骰是否可燃运 | 否 | **绝对禁止**，与 [[fate-gamble]] 路径完全隔离 |
| 伤害骰由谁掷 | KP 在桌面上掷 | **玩家自己掷**（演出感强，符合"玩家握住骰子"原则） |
| 静态伤害（如固定 3 点） | 也可以掷 | **跳过浮窗**直接结算（节奏优先） |
| KP 是否可在叙事中"减伤/增伤" | 可，KP 自由裁定 | **可**，通过 `outcomeMessage` 回包后 KP 在下回合 narrative 中调整，不动效果骰本身 |
| 暗骰的伤害 | KP 自报数 | **不弹浮窗**，由 KP narrative 直述 |
| 神话技能成长 | 1d10 累积 | 暂保持定值（未来如果引入再走效果骰） |

---

## 九、测试矩阵扩展（接入后）

参考 [[testing-commands]]，新路径接入后需补充对应测试命令。命名约定：

| 命令 | 触发结果 | 路径侧重 |
|---|---|---|
| `[sys_test]damage` | 触发 1d6 伤害浮窗 · 真实随机 | 默认主题二阶段 |
| `[sys_test]heal` | 触发 1d3 治疗浮窗 · 真实随机 | 默认主题二阶段（正向 diff） |
| `[sys_test]mp_cost` | 触发 1d4 魔力消耗浮窗 | 默认主题二阶段 |
| `[sys_test]damage_static` | 静态 5 点伤害 · 不弹浮窗 | 验证 `isStatic` 分流 |

实现位置同样在 `runSysTestCommand`，但与 SAN 测试不同——**不需要先弹判定 modal**，
直接构造 `pendingEffectRoll` 即可。`EffectRollModal` 是无状态展示组件，复用零成本，
这是 [[testing-commands]] 第 58-59 行已经预告过的扩展点。

---

## 十、实施顺序建议

1. **协议扩展**：`types.ts` 加四个 `*Formula` 字段，`server.ts` `SYSTEM_INSTRUCTION` 加章节。
2. **伤害路径（B）**：`handleDamageRoll` + `applyDamage`，红色 hpDiff 浮字复用现有。
3. **治疗路径（C）**：`handleHealRoll` + `applyHeal`，绿色正向 diff 浮字。
4. **魔法反噬（E）**：`handleMpCostRoll` + `applyMpCost`，蓝色 mpDiff 浮字。
5. **大失败强制 SAN（G）**：在 `handleRollComplete` 的 fumble 分支里，识别 `sanLossFormula`
   字段后串入二阶段流程。
6. **测试命令**：补 `[sys_test]damage` 等，更新 [[testing-commands]] 表格。
7. **武器伤害骰（D）**：等项目真的引入武器系统再做，需要 `RollResult` 上挂 damage hint。
8. **神话技能成长（F）**：最低优先级，保持定值即可。

---

## 十一、不变量速查（接入新路径前自检）

接入任何新二阶段路径前，逐条对照：

- [ ] 判定 modal 与效果 modal **解耦**：判定回调里推挂起态，不直接调效果 modal。
- [ ] **公式在调用方求值**：`rollDiceFormula(formula)` 出来的 `DiceFormulaResult` 传给浮窗。
- [ ] **静态分流**：`isStatic === true` 跳过浮窗，直接走同步副作用路径。
- [ ] **测试模式短路**：`testForce` 存在时只演动画不真扣属性。
- [ ] **效果浮窗不可干预**：不加按钮、不接命运博弈、不重投。
- [ ] **diff 浮字**：扣 HP / MP / SAN 同步触发对应 `setXxxDiff(±n)` + 3 秒自动归零。
- [ ] **回报 KP**：`applyXxxEffect` 末尾用 `handleSendPlayerMessage(reportMsg, true)` 把
      公式 / 骰点 / 余值原样汇报给 KP，便于 KP 在下回合 narrative 中接住。
- [ ] **测试命令**：新路径在 [[testing-commands]] 加一行 `[sys_test]xxx`。
- [ ] **主题选择**：复用 `sanity` / `default`，不新增 theme。
- [ ] **互斥共存**：协议层 `xxxChange` 整数字段与 `xxxFormula` 公式字段二选一。

---

> 最后更新：2026-05-23
> 本文件是项目二阶段投骰机制的强制性规范，所有涉及"判定 → 效果"的 UI / 协议 / 文案改动须以此为准。
> 与 [[fate-gamble]] 配套使用：本规范管"判定后的数值后果"，命运博弈管"判定本身的覆写"，互不交叉。
