# 放弃声明（Roll Cancellation）规则备忘

本项目把"KP 召唤了 `rollRequest` 投骰、玩家在结算前撤回行为意图"这套机制内部统称为
**放弃声明**。它对应 CoC 7e 跑团里玩家有权在掷骰前说"算了，我不这么做了"——
KP 应当尊重该撤回，并按真实跑团反应处理后果。

本机制仅作用于 **A 路径（玩家明骰 `rollRequest`）**。`keeperRoll`（明骰/暗骰）与
`sanityCheck` 路径**永不可放弃**——这两条路径上的判定是 KP 主动施加的客观结算，
玩家无权干预（与 [[fate-gamble]] 第二节的"命运博弈唤起点矩阵"同源）。

判定权在前端硬规则，LLM 只在 `outcomeMessage` 里收到结果通报，用于叙事呈现。

---

## 一、术语映射

| 内部代号 | 玩家可见用词 | 7e 原术语 | 备注 |
|---|---|---|---|
| 放弃声明 | —（玩家不感知名称） | Withdrawing the action / Changing one's mind | 项目内部伞名 |
| 暂离投骰界面 | "我再想想" | —（无对应术语） | 仅是 UI 行为，不构成放弃 |
| 失效卡片 | "已错过" | —（无对应术语） | 视觉降级、按钮禁用 |

> 命运博弈（[[fate-gamble]]）作用于"判定**已经投出失败**之后的覆写"，
> 二阶段投骰（[[two-stage-roll]]）作用于"判定**已经成功/失败结算**之后的数值后果"，
> 而本规范作用于"判定**根本没有发生**的撤回"——三者维度不同，永不交叉。

---

## 二、放弃声明唤起点矩阵（按投骰路径）

沿用 [[fate-gamble]] 第二节的四条路径划分。

| # | KeeperResponse 字段 | 触发方式 | 是否可放弃 | 放弃语义 |
|---|---|---|:---:|---|
| **A** | `rollRequest` | 玩家明骰（含玩家主动声明 + 剧情施加两类触发源） | ✅ | 玩家撤回该次行为意图 |
| **B** | `keeperRoll` + `isSecret:false` | KP 明骰（NPC / 环境） | ❌ | KP 主动施加的客观判定，玩家无权拒绝结算 |
| **C** | `keeperRoll` + `isSecret:true` | KP 暗骰 | ❌ | 玩家在叙事上看不到掷骰发生，不存在放弃语义 |
| **D** | `sanityCheck` | 直面冲击源 | ❌ | 理智冲击是已发生的事实，前端已硬控不可回避（5.1 节） |

> 协议层**不区分** A 路径下"玩家主动声明"还是"剧情施加"——schema 上它们是同一个
> `rollRequest`。被动施加场景（踩陷阱、被偷袭、被追逐）下玩家的"放弃"由 KP 在
> 下一回合 narrative 中自行加重后果（陷阱触发、偷袭命中、距离被拉近），**不**通过协议字段
> 区分 cancellable/non-cancellable。这是项目家规——理由见第八节。

---

## 三、放弃判定规则（铁律）

### 何为"放弃"——以"卡片是否还是最后一条消息"为唯一判据

放弃声明的判定**不**由 modal 的关闭行为触发，而由**消息列表的最末位**决定：

> 当 `rollRequest` 所附属的 keeper 消息**不再是 messages 数组的最后一条消息**时，
> 该 `rollRequest` 即被视为已放弃，对应的卡片自动失效。

直白讲：玩家发了任何新消息（普通对话、新的技能声明、system 回报均算），
导致那条带 `rollRequest` 的 keeper 消息从"队尾"变成"非队尾"——本次声明就作废了。

### "我再想想"按钮 ≠ 放弃声明

`RollDiceModal` 顶栏的"我再想想"按钮（`src/components/RollDiceModal.tsx:417-427`）
只是**临时关闭 modal**，让玩家能查看被 modal 遮蔽的角色面板、线索册、KP 上一段
narrative 等信息。**它不构成放弃**：

- 关闭 modal 后，该 keeper 消息上的"投掷 D100"按钮**仍然可点**（前提是它仍是消息列表队尾）。
- 玩家可以反复打开-关闭 modal、查看面板、再打开 modal——只要没发新消息，本次声明就一直有效。
- 关闭 modal 时**不**触发任何 system 回报，**不**调 LLM。

### 已放弃的卡片（失效卡片）

一旦判定为已放弃：

- "投掷 D100" 按钮 `disabled`，且不再响应 `onClick`。
- 卡片视觉降级（透明度 / 灰度），徽标改为"已错过"或类似措辞。
- 同一回合内**不可恢复**——玩家若再想做该动作，需要重新声明，由 KP 决定是否再次召唤检定。

### system 回报（一次性）

放弃判定生效的**那一刻**——也就是消息列表新增了一条让 keeper 消息从队尾退下的消息时——
向 KP 注入一条 system 标记消息（详见第五节模板），**不阻塞**当前正在 trigger 的
`triggerKeeperNarration`。该回报与玩家的新消息**合并**进入同一次 LLM 调用上下文。

> 实现注意：放弃回报是**派生事件**，不应自己触发额外的 LLM 调用。它必须搭载在
> "玩家新消息触发的那次"LLM 调用里一起发出，否则会出现 KP 连发两轮 narrative 的混乱。

---

## 四、UI 阻塞规则（铁律）

### `rollRequest` 挂起期间，强制弹 modal + 阻塞输入

与 SAN 检定（`activeSanity`）的处理同口径，但语义略弱：

| 状态 | 输入框 | 发送按钮 | 角色面板 | "我再想想"按钮 |
|---|:---:|:---:|:---:|:---:|
| `activeSanity` 挂起 | ❌ 禁用 | ❌ 禁用 | ❌ 禁用 | 不显示 |
| `activeRoll`（玩家明骰）挂起 | ❌ 禁用 | ❌ 禁用 | ✅ 可用 | ✅ 显示 |
| `activeRoll`（keeperRoll 明/暗骰）挂起 | ✅ 可用 | ✅ 可用 | ✅ 可用 | 不显示 |

> 玩家明骰挂起期间禁用聊天输入是 CoC 因果链的体现——**结果未结算前剧情不推进**。
> "我再想想"按钮提供的"暂离 modal"出口让玩家仍能查看面板做决策，构成不冲突的双层 UX。

> keeperRoll 不阻塞输入：(1) 暗骰阻塞会破暗骰；(2) 明骰动画很快，玩家无干预权，
> 没必要为短暂动画阻塞输入。

### 自动弹起策略

收到 `rollRequest` 字段的 keeper 消息后，**不自动弹** modal——玩家需主动点
keeper 消息卡片中的"投掷 D100"按钮。这与 [[fate-gamble]] 路径 A 的现状一致
（`App.tsx:1700`），与路径 B / D 的"自动弹"明显区分。

理由：玩家明骰是玩家自己声明的行为，应保留"看完 narrative 再决定要不要投"的节奏；
强制自动弹会破坏阅读节奏。

---

## 五、回报 KP 的 message 模板

放弃判定生效时，前端通过 `handleSendPlayerMessage(textToSend, isSystemReport=true)`
注入 system 消息（与 [[fate-gamble]] / [[two-stage-roll]] 同机制）：

```
[放弃声明] 玩家撤回了"<skillName>"判定声明（reason: "<原 reason>"）。
请按真实 KP 反应处理：通常让该意图自然过去；当撤回的犹豫本身在场景里有意义时
（紧迫战斗的喘息、对方 NPC 看到伸手又收回、被追逐时停下脚步），可在 narrative 中
让"犹豫"产生后果。**不要**直接重发同一个 rollRequest——除非剧情条件再次主动施加。
```

KP 应在 narrative 中将其叙事化为"调查员收回手"、"她改变了主意"、"他停下了脚步"等
人物自然的犹豫，而**不是**写成"系统判定玩家放弃了"这种机制化描述。

> 该回报字符串**不入存档可见消息流**——它是 system 角色的隐式上下文，与命运博弈
> 的 system 标记同处理。

---

## 六、协议扩展（最小改动）

### 不引入 `cancellable` 字段

经讨论决定**不在 `rollRequest` schema 上加 `cancellable: boolean` 等字段**区分
"主动声明"与"剧情施加"。理由：

1. 协议越窄越不易破。LLM 多一个字段就多一种填错的可能。
2. 真实跑团里 KP 也允许玩家在踩陷阱前"我再想想退一步"——是否惩罚由 KP 当场判断，
   通过 narrative 加重后果实现，而不是机制层禁止撤回。
3. 如果未来确实需要严格区分，永远可以补做（向后兼容地加 `cancellable?: boolean`，
   未填默认 `true`）。

### `ChatMessage` 不需要扩展

放弃判定是**派生状态**——纯靠 messages 数组的位置关系即可判断："带 `rollRequest`
的 keeper 消息是否仍是队尾"。无需在 `ChatMessage` 上添加 `_consumed` / `_cancelled`
字段，无需改 saveManager 与存档 schema。

### 成功投骰即清空 `rollRequest` 字段（消费证据 · 铁律）

`handleRollComplete` 在玩家完成判定的瞬间，对**当前队尾**那条 keeper 消息做就地
重写：把 `parsedResponse.rollRequest` 置为 `null`，**保留** `parsedResponse` 上其它
字段（narrative / clue / characterUpdates 等）。

这条规则是与"队尾派生"完全互补的另一半——

| 队尾位置 | rollRequest 字段 | 派生结论 |
|---|:---:|---|
| 仍在队尾 | 仍在 | 活跃，玩家仍可点 D100 |
| 仍在队尾 | 已清空 | 不会渲染卡片（`m.parsedResponse?.rollRequest` 整段判空） |
| 不再队尾 | 仍在 | **已放弃**，渲染为"已错过"灰态卡片 |
| 不再队尾 | 已清空 | 不会渲染卡片（已投完的历史，仅留 `outcomeMessage` 系统消息为可见痕迹） |

> 这条规则配合"每次投骰必须可见"的口径：投骰结果由 `handleRollComplete` 一并
> `handleSendPlayerMessage(messageReport, true)` 注入聊天流——A/B 路径写完整骰点+
> 成功等级，C 路径（暗骰）以 `[？？？] (???%)` 打码骰点+成功等级但明示"暗骰发生"，
> D 路径（SAN）由 `applySanityLoss` 单独写入。任何投骰路径都**保证有一条 system
> 消息留在聊天流**作为玩家可见的回放凭据。

### `server.ts` `SYSTEM_INSTRUCTION` 新增 4.6 节

告知 KP "[放弃声明]" system 标记的语义与处理范例（见第五节模板）。**不赋予 KP
否决权**——所有规则化判定已在前端完成。

---

## 七、UI 接入点（仅说明，不实现）

### 7.1 派生函数：`isLatestKeeperRollRequest(message, messages)`

```ts
// 当且仅当该 keeper 消息持有 rollRequest 且仍是 messages 数组的最后一条时为真。
// 任何后续消息（player / system / keeper）都会让其变为 false → 卡片失效。
function isLatestKeeperRollRequest(
  message: ChatMessage,
  messages: ChatMessage[],
): boolean {
  if (!message.parsedResponse?.rollRequest) return false;
  return messages[messages.length - 1]?.id === message.id;
}
```

### 7.2 卡片渲染（`App.tsx:1675-1707` 区段）

- 在 "REQUIRES DESTINY ROLL" 卡片渲染处计算 `isLatest`。
- `isLatest === false` → 按钮 `disabled`，按钮文案"已错过"，卡片整体 `opacity-40 grayscale`。
- `isLatest === true` → 维持现状（金色按钮 + "投掷 D100 (XX%)"）。

### 7.3 输入框阻塞（`App.tsx:1757 / 1779`）

`disabled` 条件追加 `!!activeRoll && !activeRoll.isKeeperRoll && !activeRoll.skillName.includes("SAN")`。
SAN 已由 `activeSanity` 处理，keeperRoll 不阻塞。占位符文案保留现有"请在上面点击掷骰子投点"
但补充"或点 'X 我再想想' 暂时退出查看面板"。

### 7.4 放弃回报触发点

放弃事件**不**绑定在"玩家发新消息"的 onClick 上，而绑定在 `handleSendPlayerMessage`
**入口**——一旦 `messages` 末位即将不再是带 `rollRequest` 的那条 keeper 消息，
立即向后端拼接 `[放弃声明] ...` system 消息（注意：拼接进**当次** LLM 上下文，
不再单独触发一次 LLM 调用）。

> 实现要点：在 `triggerKeeperNarration` 之前，先扫描 `updated` 数组的倒数第二条是否
> 是带未消费 `rollRequest` 的 keeper 消息，若是则在 player/system 消息**之前**插入
> 一条 `[放弃声明] ...` 的 system 消息。一次 LLM 调用，两条 user 消息。

### 7.5 modal "我再想想" 按钮（已存在）

`src/components/RollDiceModal.tsx:417-427` 已实现，**保持现状**——它的语义按本规范
重新定义为"暂离 modal 查看信息"，不再是"放弃"。其 `onCancel` 回调（在 `App.tsx`
约 1934 行）仅做 `setActiveRoll(null)`，**不**触发回报、不调 LLM——这与本规范
"卡片是否在队尾才决定放弃与否"完全一致。

---

## 八、家规与 7e 原版对照表

| 项 | CoC 7e 原规则 | 本项目家规 |
|---|---|---|
| 玩家撤回行为意图 | KP 当场裁定，通常允许 | **协议层无条件允许**，由 KP 在 narrative 中加重后果实现"惩罚" |
| 撤回的判定时点 | 桌游靠 KP 当场记忆 | **消息队尾的派生状态**——卡片不再队尾即作废 |
| 暂时离开决策窗口看资料 | 桌游随便看 | "我再想想"按钮关闭 modal；不构成放弃 |
| 失效后能否补救 | KP 当场裁定 | **不可补救**；玩家需重新声明，KP 决定是否再次召唤 |
| 区分主动声明 / 剧情施加 | 二者后果不同（放弃陷阱判定通常会被打中） | **协议不区分**；后果由 KP 在 narrative 中表达 |
| `keeperRoll` / `sanityCheck` 是否可放弃 | 否 | 否（与原规则一致） |

---

## 九、与其它机制的互斥关系

| 机制 | 与"放弃声明"的关系 |
|---|---|
| [[fate-gamble]] 命运博弈 | 命运博弈作用于"已结算的失败判定"上的覆写；放弃声明作用于"未结算的判定"。**永不并发**——能放弃的时刻还没结算，能命运博弈的时刻已经结算。 |
| [[two-stage-roll]] 二阶段投骰 | 二阶段作用于"已结算的判定 → 数值后果"。放弃发生在第一阶段（判定）之前，`pendingEffectRoll` 也根本不会被推入。无交叉。 |
| 测试通道 `[sys_test]roll*` | 测试模式构造的 `RollRequest` 走同样的"队尾即活跃"逻辑——但测试 modal 一旦关掉就 `setActiveRoll(null)`，且没有真实 keeper 消息附着，**不会**触发放弃回报。测试通道与本规范不交叉。 |
| `keeperRoll` / `sanityCheck` 自动弹 modal | 自动弹的 modal 不附着在 keeper 消息卡片上，没有"卡片队尾"概念。本规范不作用于这两条路径。 |

---

## 十、实施顺序建议

1. **派生函数** `isLatestKeeperRollRequest`（纯函数，可单测）
2. **卡片失效渲染**（`App.tsx` 渲染区段，仅视觉与 disabled 切换）
3. **输入框阻塞**（`disabled` 条件追加 `activeRoll` 玩家明骰判断）
4. **放弃回报注入**（`handleSendPlayerMessage` 入口，扫倒数第二条）
5. **`SYSTEM_INSTRUCTION` 4.6 节**（提示 KP 处理 `[放弃声明]` 标记的范例）
6. **测试命令补充**（在 `.docs/testing-commands.md` 加 `[sys_test]cancel_*` 验证三条路径）

---

## 十一、不变量速查（接入新路径前自检）

接入任何与"放弃声明"相关的新流程前，逐条对照：

- [ ] **路径限定**：仅 A 路径（`rollRequest`）可放弃；B / C / D 永不可放弃。
- [ ] **判据唯一**：是否放弃由"keeper 消息是否仍在 messages 队尾"派生，**不**新增 `_cancelled` 字段。
- [ ] **暂离 ≠ 放弃**："我再想想"按钮只关 modal，不触发回报、不消费卡片。
- [ ] **回报合并**：放弃回报与玩家新消息**合并**进同一次 LLM 调用，**不**单独触发新调用。
- [ ] **失效不可恢复**：失效后玩家需重新声明，KP 自由决定是否再次召唤检定。
- [ ] **不区分主/被动施加**：不靠协议字段，靠 KP 在 narrative 加重后果。
- [ ] **存档无侵入**：放弃判定是派生状态，`ChatMessage` 与 `WebGameSave` schema 不变。
- [ ] **system 标记不可见**：`[放弃声明]` 走 `isSystemReport=true`，与命运博弈同处理。

---

> 最后更新：2026-05-23
> 本文件是项目放弃声明机制的强制性规范，所有掷骰相关 UI / 协议 / 文案改动须以此为准。
> 与 [[fate-gamble]]、[[two-stage-roll]] 配套使用：本规范管"判定根本没发生"，
> [[fate-gamble]] 管"判定本身的覆写"，[[two-stage-roll]] 管"判定后的数值后果"，
> 三者互不交叉。
