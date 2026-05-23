# `[sys_test]` 测试命令清单

在玩家聊天输入框直接发送 `[sys_test]<命令>` 可以脱离 LLM 触发对应 modal，
**不进入消息流、不写入控制台日志、不调用 `/api/keeper/*`**，且测试模式下：

- 完成判定后**不回报守密人**（即不会把 outcomeMessage 推进对话）。
- **不扣减角色 HP / SAN / MP / LUC**（燃运演示动画但不真扣）。
- 任何 `cancel` / `apply` 都只关闭 modal，立刻可触发下一条命令。

测试模式由 `RollRequest.testForce` 字段标记，前端在 modal 完成回调里依此短路所有副作用。

---

## 命令清单

| 命令 | 触发结果 | 路径侧重 | 命运博弈按钮 |
|---|---|---|---|
| `[sys_test]roll` | 侦查 (60%) · 真实随机骰 | 普通技能·路径合规 | 视骰点 |
| `[sys_test]roll_win` | 侦查 (60%) · 强制 50（普通成功） | 验证成功 banner | 不出现（`failure` 才出现） |
| `[sys_test]roll_crit` | 侦查 (60%) · 强制 1（大成功） | 验证大成功 banner | 不出现 |
| `[sys_test]roll_fumble` | 侦查 (60%) · 强制 100（大失败） | 验证大失败 banner | **不出现**（首投 fumble 禁博弈） |
| `[sys_test]roll_fail` | 闪避 (60%) · 强制 75（普通失败） | 战斗骰路径，**白名单挡住命运博弈** | **不出现** |
| `[sys_test]roll_fail_gamble` | 侦查 (60%) · 强制 75（普通失败） | 普通技能失败，命运博弈完整路径 | **出现**（孤注一掷 + 燃运 -15 LUC） |
| `[sys_test]san` | SAN 检定 · 真实随机 (公式 0/1d6) | 二阶段骰路径 | **不出现**（SAN 禁博弈） |
| `[sys_test]san_success` | SAN 检定 · 强制成功 (公式 0/1d6) | 静态公式路径，**不弹效果骰浮窗** | 不出现 |
| `[sys_test]san_fail` | SAN 检定 · 强制失败 (公式 0/1d6) | 动态公式路径，**应弹 1d6 紫色效果骰浮窗** | 不出现 |
| `[sys_test]damage` | 伤害浮窗 · 1d6 真实随机 | 二阶段·**default 主题**，**不弹判定 modal**，红色 hpDiff 浮字 | — |
| `[sys_test]heal` | 治疗浮窗 · 1d3 真实随机 | 二阶段·default 主题，**正向**绿色 hpDiff 浮字 | — |
| `[sys_test]mp_cost` | 魔力消耗浮窗 · 1d4 真实随机 | 二阶段·default 主题，蓝色 mpDiff 浮字 | — |
| `[sys_test]damage_static` | 伤害静态 5 点 · **不弹浮窗** | 验证 `isStatic` 分流：纯数字直接走 hpDiff，跳过 EffectRollModal | — |
| `[sys_test]damage_full` | **全链路** · 闪避失败判定 modal → 自动接 1d6+1 伤害效果骰浮窗 | 验证"判定 → 效果"两段动画端到端串联，红色 hpDiff 浮字 | **不出现**（战斗骰白名单挡住） |
| `[sys_test]clue_image` | 直接插入一条**带 prompt 的**线索（拓印 / `marking`），无 imageUrl | 验证按需画图链路 — 笔记本详情应**展示图框 + 占位 + 放大镜**，点放大镜触发 `/api/image/generate-clue` 显示转圈，成功后写入 `imageUrl` | — |
| `[sys_test]clue_text` | 直接插入一条**不带 prompt 的**线索（账册摘录 / `note`） | 验证规范裁剪 — 笔记本详情应**完全不渲染图框**，只显示标题 + 描述 | — |
| `[sys_test]scene_image` | 在聊天追加一条仅含 `sceneImage` 的 keeper 消息（祭坛螺旋符号 / `marking`） | 验证**对话内视觉勾子**链路 — 应在 keeper 气泡里渲染绿色虚线占位卡，点「显示图像」生成图，缩略图点击展开全屏预览，预览顶栏多出「收录线索」按钮，点击后写入笔记本并按钮变「已收录」 | — |

---

## 设计要点（给后续维护者）

- **入口拦截**：`App.tsx · handleSendPlayerMessage` 在最前面 trim 后判 `startsWith("[sys_test]")`，
  匹配则交给 `runSysTestCommand(cmd)`，不走消息流，不调 LLM。
- **测试 sentinel**：`RollRequest.testForce` 是唯一判定测试模式的开关。
  - `testForce: {}` → 测试模式，骰点完全随机。
  - `testForce: { total }` → 强制总点（fallback 会同步拆 tens/units）。
  - `testForce: { successType }` → 强制等级（绕过骰点推导）。
  - 二者可叠加使用。
- **SAN 测试**：同时 `setActiveSanity(...)` 与 `setActiveRoll(...)`，这样 modal 走 SAN 紫色样式分支；
  `onComplete` / `onCancel` 在测试模式下会一起清掉两个 state，避免"SAN 挂起 → 后续命令被阻塞"。
- **二阶段效果骰**：判定 modal 关闭后，若 `lossFormula` 是动态公式（含 `NdM`），会推 `pendingEffectRoll`
  state 给 `EffectRollModal` 渲染——800ms 滚动 + 揭晓 + 1.5s 自动关，无任何按钮（CoC 7e 规则禁止
  对效果骰用 push/燃运）。静态公式（`"0"`、纯数字）跳过浮窗直接结算。
- **测试模式 SAN**：会演示效果骰浮窗但**不真扣 SAN**，可反复测试动画。
- **不能模拟的事**：测试通道只构造 `activeRoll`/`activeSanity`/`pendingEffectRoll` 三个 React state，
  **不会**触发聊天里的"找到线索"卡片、HP/MP 变化、地点切换、剧情同步——这些都属于 KP 回包的处理逻辑，与本测试通道无关。
  - 例外：`[sys_test]clue_image` / `[sys_test]clue_text` 直接 `setClues`，会把测试线索写入存档（受 useEffect 自动落 localStorage），如不需要可在笔记本中手动清空或换存档。`[sys_test]scene_image` 直接 `setMessages` 追加一条带 sceneImage 的 keeper 消息，同样会进入存档；其完整链路涉及真实的 `/api/image/generate-clue` 调用，需要在「虚空连接的设置」里配好画图模型。「收录线索」按钮触发后会把 sceneImage 升格为正式 ClueItem。

---

## 怎么扩

新增命令：在 `src/App.tsx · runSysTestCommand` 加 `case "<name>"` 分支，构造对应 `RollRequest`
并 `setActiveRoll`。如果是 SAN 类，再 `setActiveSanity`。然后把命令补进上方表格。

如果将来需要测试 KP 骰 / 暗骰，可在 `RollRequest` 里把 `isKeeperRoll` / `isSecret` 一同打开，
并配 `testForce`，逻辑与玩家骰共享同一份兜底路径。

**纯效果浮窗**（不经判定的伤害骰 / 治疗骰 / 魔力消耗等）已通过 `runEffectRollTest(kind, formula)`
统一接入：直接构造 `pendingEffectRoll` 并调对应 `setXxxDiff` 演浮字，**不弹判定 modal**、**不真扣属性**。
新增同类命令时复用即可，对应 `kind` 选项见 `EffectKind` 枚举（`damage` / `heal` / `mpCost` / `sanLoss`）。
`EffectRollModal` 是无状态展示组件，复用零成本。
