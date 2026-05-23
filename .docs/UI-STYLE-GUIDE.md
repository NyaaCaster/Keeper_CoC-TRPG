# Keeper_CoC-TRPG 美术规范

本文件是项目 UI 的强制性配色与控件规范,所有面向用户的界面修改、新增组件、Tailwind class 选择都必须遵守。
当 CLAUDE.md 里的"美术规范"一节与本文件冲突时,以本文件为准(本文件更详细)。

---

## 1. 主色板:黑、绿、白(+极少量金)

整套界面只允许使用以下四类颜色,其余颜色(蓝、红、紫、黄等)**仅供属性槽和受击/异常反馈使用**(见第 3 节)。

### 1.1 黑(背景层级)

| 角色 | 十六进制 | CSS 变量 / Tailwind | 用途 |
|---|---|---|---|
| 最底层背景 | `#070a08` | `--color-coc-dark` / `--color-sleek-bg` / `bg-coc-dark` | 页面/最外层容器底色 |
| 次底层(深绿黑) | `#0a1c12` | `--color-coc-green` | 主氛围底色,带绿色调 |
| 面板背景 | `#0c1410` | `--color-sleek-panel` | 卡片、模态框、对话框面板 |
| 列表/Item 背景 | `#121f18` | `--color-sleek-item` | 列表项、二级容器 |

> 半透明遮罩用 `bg-black/20`、`bg-black/30`、`bg-black/50` 即可,避免引入新十六进制色值。

### 1.2 绿(主品牌色,所有点缀/强调/交互)

| 角色 | 十六进制 | 用途 |
|---|---|---|
| 主绿(主点缀) | `#10b981` | 文字高亮、图标、边框激活态、滚动条拇指、阴影发光 — `--color-coc-gold` / `text-coc-gold` |
| 深绿(按钮底/hover 前) | `#059669` | 实色按钮背景、渐变终点 |
| 更深绿(hover) | `#047857` | 按钮 hover |
| 极深绿(边框默认) | `#183022` | 默认边框 — `--color-sleek-border` / `border-coc-gold` |
| 边框中段 | `#122218`、`#1d3f2b` | 弱化边框、分隔线 |

> 命名历史遗留:CSS 变量叫 `--color-coc-gold`、Tailwind class 叫 `text-coc-gold`,但**实际值都是绿色**。继续用旧名字以避免大面积改名,**不要**因为名字带 "gold" 就改成黄色。

### 1.3 白(文字)

| 角色 | 十六进制 / Tailwind | 用途 |
|---|---|---|
| 正文/旁白 | `#e2f0e7`(`.typewriter-text`) | 对话主文字,带极淡绿调 |
| 标题强调 | `text-gray-100` / `text-gray-200` | 角色名、主标题 |
| 次要文字 | `text-gray-300` / `text-gray-400` | 描述、标签、副信息 |
| 弱化文字 | `text-gray-500` / `text-gray-600` | 占位、禁用 |
| 极浅绿白(线索高亮) | `#dcfce7` | `--color-sleek-clue-gold`,用于线索本里的关键词 |

### 1.4 金(极少量,仅幸运/线索关键节点)

- 仅 **LUC 幸运槽** 使用 `text-yellow-500` / `#eab308` 系列(参见第 3 节)。
- 除属性槽外,正常 UI **不要**新增金色/黄色元素。如需"特殊感",优先用 `#dcfce7` 这种偏浅绿白替代。

---

## 2. 滚动条:全局统一绿色图形化

所有出现滚动条的容器必须挂上 `custom-scrollbar` class,样式定义在 `src/index.css` 的 `.custom-scrollbar` 规则中:

- 宽/高 `5px`
- 轨道 `rgba(0,0,0,0.3)`
- 拇指 `#10b981`,圆角 `2px`
- hover 拇指 `#059669`

### 强制要求

- **禁止**裸用 `overflow-y-auto` / `overflow-x-auto` / `overflow-auto` 而不加 `custom-scrollbar`(除非该容器尺寸固定且永不出现滚动条)。
- 修改 UI 时若发现某个容器漏挂 `custom-scrollbar`,顺手补上。
- 不要为单个组件单独写 `::-webkit-scrollbar` 样式覆写,统一走 `custom-scrollbar`。

### 检查命令

写完后用以下命令排查遗漏:

```bash
# 应该返回 0 — 任何 overflow-*-auto 都应跟着 custom-scrollbar
grep -rE 'overflow-(y|x)?-?auto' src/ | grep -v custom-scrollbar
```

---

## 3. 属性专用色(只在角色面板/属性槽内使用)

属性槽的颜色已固化,改动属性 UI 时必须沿用,**不要**自创色彩搭配。

| 属性 | 主色(文字/进度条) | 弱化(/max 显示) | 槽位背景 | 槽位边框 |
|---|---|---|---|---|
| **HP 生命** | `text-red-400` / `bg-red-500`(进度条 `#ef4444`) | `text-red-600` | `rgba(239,68,68,0.08)` | `rgba(239,68,68,0.2)` |
| **MP 魔法** | `text-blue-400` / `#3b82f6` | `text-blue-500` | `rgba(59,130,246,0.08)` | `rgba(59,130,246,0.2)` |
| **SAN 理智** | `text-emerald-300` / `#10b981` | `text-emerald-600` | `rgba(16,185,129,0.08)` | `rgba(16,185,129,0.2)` |
| **LUC 幸运** | `text-yellow-500` / `#eab308` | `text-yellow-750`(占位) | `rgba(234,179,8,0.08)` | `rgba(234,179,8,0.2)` |

### 数值变化反馈色

- 减少(扣血、扣魔、扣理智):用属性自身的更深一档(`text-red-500`、`text-blue-500`、`text-emerald-500`)。
- 增加(回血、回魔、恢复理智):统一用 `text-green-400` / `text-emerald-400`。
- HP 受击全屏闪烁:`bg-red-950/30` + `animate-blood-flash`。
- SAN 丧失全屏故障:`bg-purple-950/20` + `animate-glitch`(**这是仅有的允许使用紫色的场景**,不要扩散)。

---

## 4. 字体

`src/index.css` 中已绑定四套 Tailwind 字体变量,沿用即可:

- `font-sans`:Plus Jakarta Sans — UI 主字体
- `font-serif`:Special Elite — 打字机感,旁白/线索
- `font-display`:Cinzel — 大标题、Logo
- `font-mono`:JetBrains Mono — 数值、骰点、代码

不要再引入第五种字体。

---

## 5. 工作清单(改动 UI 时检查)

写或改 UI 前/后,逐条对照:

- [ ] 背景颜色只取自第 1.1 节四档(或 `bg-black/n`)?
- [ ] 强调色全部走 `#10b981` / `text-coc-gold` / `border-coc-gold` 命名,没有新引入黄色或金色?
- [ ] 文字色在 `#e2f0e7` 与 `text-gray-100~600` 之间选,没有出现纯白 `#fff` 大面积块?
- [ ] 出现滚动的容器都挂了 `custom-scrollbar`?
- [ ] 属性相关 UI(HP/MP/SAN/LUC)严格沿用第 3 节的颜色映射?
- [ ] 没有为单一组件硬编码新的十六进制色?如需新增,先想能不能复用现有四档黑+主绿。

不满足以上任意一条 ⇒ 调整后再交付。
