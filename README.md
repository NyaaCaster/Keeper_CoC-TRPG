# Keeper_CoC-TRPG

> 由 LLM 扮演守密人（Keeper / KP）的《克苏鲁的呼唤》第七版（CoC 7e）TRPG 跑团应用。
> 默认糅合**克苏鲁神话**、**型月世界观**与 **SCP 基金会** 三套设定，可按需独立开关。

界面以**克系黑绿白 + 微量金**为主色调，前后端一体化打成单个 Node.js 容器，部署起来只是 `docker compose up` 一行的事。

---

## 功能一览

### 跑团内核

- **AI 守密人**：基于 LLM 的 CoC 7e 跑团主持，严格按 JSON Schema 输出旁白、技能检定、理智检定、NPC 台词、线索图、终局闸等结构化字段。
- **三维世界开关**：开始新游戏时可独立开关「型月要素」「SCP 要素」，全关即纯净 CoC 模式（System Prompt 中会硬性禁止提及）。
- **角色生成**：18 张内置预设调查员（1920s × 9 + modern × 9），或让 LLM 根据玩家自述自动生成数值，或走完整 Custom PC 子流程纯手搓。
- **线索本**：场景中发现的纸条、术式、照片等关键道具会自动入册，并按需生成克系质感配图（点击才请求画图模型）。
- **存档管理**：以 `localStorage` 为底的多存档系统，支持导出 JSON 存档；游戏中可单独下载角色卡 PNG。

### 投骰系统

- **客观掷骰**：所有不确定性判定都由前端弹出双十面骰动画，玩家手动投点；KP 不允许自己代骰。可接入 NyaaChat-MCP 服务做服务端真随机，未配置时回落到本地实现。
- **明骰 / 暗骰**：守密人替环境与 NPC 投骰时走专门的 `keeperRoll` 通路，明骰公开、暗骰只显示神秘轰鸣并把骰点全打码。
- **强制 SAN 检定**：理智检定独立路径（紫色主题强制弹窗，禁取消），损失公式（如 `1d6/1d10`）按检定结果分支结算。
- **二阶段投骰**：伤害 / 治疗 / 魔力消耗等带随机性的效果（`hpDamageFormula` / `hpHealFormula` / `mpCostFormula` / `sanLossFormula`）由 EffectRollModal 二次落点；纯整数同步结算。
- **命运博弈**：CoC 7e 的两条玩家补救机制 ——「**孤注一掷**」（Push）与「**燃运**」（Burn Luck）——在前端硬规则唤起，按路径开关（玩家明骰可用、战斗骰 / 幸运检定 / KP 暗骰禁用）；项目家规版孤注一掷失败必为大失败。详见 `.docs/fate-gamble.md`。
- **掷骰取消**：每条 rollRequest 在玩家投点前可主动取消，避免 LLM 误判类型时被钳住。

### 角色卡（CoC 7e 字典严格对齐）

- **基本信息**：姓名 / 职业（标准模板下拉 + 自由文本兜底）/ 身份 / 性别 / 年龄 / 国籍 / 居住地 / 母语 / 信用评级 / 头像 / 概述。
- **八维属性**：STR / CON / SIZ / DEX / APP / INT / POW / EDU / LUCK，幸运作为独立维度（符合 7e）。
- **派生战斗值快照**（`combatDerived`）：伤害加值 DB、体格 Build、移动率 MOV、闪避 Dodge ——属性 / 年龄变动时由 `cocRules.refreshCombatDerived` 自动刷新。
- **疯狂状态机**：`sanityState`（episodeSanLoss / madness），按规则 10 由 SAN 损失阈值自动驱动短期 / 长期 / 不定性疯狂。
- **8 槽装备栏**（House Rule）：`item` 自由文本 + `weapon` 引用结构化武器表（`src/data/cocWeapons.ts`），弹药 / 现金跑团时由 KP 通过 `ammoUpdates` / `cashChange` 实时下发。
- **神秘接触档案**：神话著作 / 法术 / 神器 / 实体四类容器，创建期为空，KP 在游戏中按 7e 规则追加，永久记入档案。
- **终局闸**：`dying` / `dead` / `insane` / `victory` / `ambiguous` 五种结局，触发后封锁输入并标记存档"已封存"。

### 角色创建

- **预设流**：从 18 张预设里选一张直接开打；模组提纲（LLM 生成）会就地覆盖姓名 / 身份 / 概述等叙事字段。
- **自动流**：玩家给一段自述 / 概述，LLM 反推 8 维属性 + 5–8 项核心技能。
- **Custom PC 流**：完整槽位制技能创建器 —— 8 职业槽（按职业模板 `coreSkills` 展开） + 4 兴趣槽（任意标准技能），职业池 = `EDU × 4`，兴趣池 = `INT × 2`，单项 ≤ 99，两池互不通用。详见 `.docs/character-card-current.md`。

### LLM / 画图

- **多 LLM 供应商**：qiny / 自定义 OpenAI 兼容 / Grok / DeepSeek / Gemini / Anthropic 全部走同一套分发逻辑。
- **服务端不持久化任何 API Key** —— 凭据存于浏览器 `localStorage`，每次请求随 body 发到后端。
- **图像缓存**：所有画图调用经服务端的 `generateImageAndPublish` 内容寻址落盘到 `cache/images/<sha256>.png`，30 天滚动 TTL，统一通过 `/cache/images/*` 同源回放。客户端 localStorage 只保留以 `IMAGE_PUBLIC_BASE_URL` 为前缀的 URL，杜绝 base64 / 第三方域名污染。

### 工具与 UX

- **控制台日志面板**：内嵌一个调试用控制台，记录每条请求 / 响应 / 错误，便于排查 LLM Schema 异常。
- **Markdown 渲染**：守密人旁白走 `react-markdown + remark-gfm` 完整 Markdown 渲染。
- **统一绿色滚动条**：所有滚动容器挂 `custom-scrollbar` class，跨界面观感一致。
- **友好的网络错误**：`fetch` 异常分类提示，避免吐"undefined"原文。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vite 6 + React 19 + TypeScript 5.8 + Tailwind 4 + motion |
| 图标 | lucide-react + @lobehub/icons-static-svg |
| Markdown | react-markdown + remark-gfm |
| 后端 | Express 4 + tsx（开发） / esbuild 打成 CJS（生产） |
| LLM SDK | `@google/genai`、`@anthropic-ai/sdk`，以及 fetch 直连 OpenAI 兼容路径 |
| 容器 | `node:20-alpine` 三阶段（deps / builder / runtime） + Docker 内置 init 作 PID 1 |

开发模式下 Express 内嵌 Vite 中间件做 SPA dev server；生产模式直接静态服务 `dist` 目录。前后端共享同一个端口（容器内 `3000`）。

---

## API / 模型供应商架构

> **服务端不持久化任何 API Key**，也不读取 `GEMINI_API_KEY` 之类的旧式启动密钥。

所有 LLM 与画图调用都通过前端的 **「虚空连接的设置」** 面板由用户填入，凭据存于浏览器 `localStorage`，每次请求随 body 一起发送到后端。后端 `dispatchLlm` 根据 `apiSettings.llm.provider` 动态分发：

| provider | 路径 | 备注 |
|---|---|---|
| `qiny` | `https://openai.chatnewai.com/v1` 或 `https://love.qinyan.icu/v1` | OpenAI 兼容；前端可切 host |
| `custom` | 用户填入的 base URL（自动补 `/v1`） | OpenAI 兼容 |
| `grok` | `https://api.x.ai/v1/chat/completions` | OpenAI 兼容 |
| `deepseek` | `https://api.deepseek.com/v1/chat/completions` | OpenAI 兼容 |
| `gemini` | `@google/genai` SDK，原生 `responseSchema` | |
| `anthropic` | `@anthropic-ai/sdk`，Schema 以 prompt 形式注入 | |

画图当前仅支持 `qiny`（OpenAI 兼容的 `/v1/images/generations`），未配置时线索照片会回落为占位图。

服务端 API 端点：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET  | `/api/public-config` | 暴露 `imagePublicBaseUrl`，前端用作 localStorage 入库白名单 |
| POST | `/api/keeper/chat` | 守密人主对话 |
| POST | `/api/keeper/generate-module-outline` | 生成模组大纲 + 3 个预设调查员 |
| POST | `/api/keeper/generate-stats` | 根据玩家自述生成属性 + 技能 |
| POST | `/api/keeper/roll` | 客观掷骰（MCP 真随机 / 本地回落） |
| POST | `/api/image/generate-clue` | 生成线索 / 场景配图（走内容寻址缓存） |
| GET  | `/api/mcp/status` | NyaaChat-MCP 健康探活 |
| GET  | `/api/models` | 透传供应商模型列表 |
| GET  | `/cache/images/*` | 30 天滚动缓存图片同源回放 |

---

## 本地开发

前置依赖：Node.js ≥ 20。

```bash
npm install
npm run dev      # tsx server.ts，启动一体化开发服务，访问 http://localhost:3000
npm run build    # vite build + esbuild 打包出 dist/
npm start        # node dist/server.cjs，跑生产构建
npm run lint     # tsc --noEmit
```

启动后浏览器打开 `http://localhost:3000`，先进入「虚空连接的设置」填入 LLM API Key 和模型名，再开新游戏。

---

## Docker 部署

镜像采用三阶段构建：`deps` 装全量依赖、`builder` 跑 `npm run build` 同时产出前端 bundle 和 `dist/server.cjs`、`runtime` 只装生产依赖再 copy 产物，最终镜像很薄。容器内使用 Docker 内置 init 作 PID 1，`docker stop` 能正确把 SIGTERM 投到 node。

```bash
docker compose up -d --build
```

`docker-compose.yml` 默认把容器内的 `3000` 映射到宿主机 `3093`，并挂一个命名卷 `keeper_image_cache` 保住图像缓存跨重建存活。compose 项目名固定为 `keeper-coc-trpg`，避免与同机器上其它 compose 项目互相干扰。

可选环境变量（写在项目根 `.env`，compose 会自动加载）：

| 变量 | 作用 |
|---|---|
| `NYAACHAT_MCP_TOKEN` | 配上后掷骰走 NyaaChat-MCP 真随机；留空则回落到本地骰子实现 |
| `IMAGE_PUBLIC_BASE_URL` | 公网根，决定 `cache/images/*` URL 的前缀；不配会回落到请求 origin（仅适合 localhost） |
| `TRUST_PROXY` | Express `trust proxy` 设置；默认 `loopback, linklocal, uniquelocal`，覆盖同机 nginx 与 docker bridge。**仅在反代位于其它网段时才需要覆盖**，详见 [`.docs/nginx-reverse-proxy.md`](.docs/nginx-reverse-proxy.md) |

### nginx 反向代理

想把本项目挂到自有域名（如 `https://keeper.example.com`），完整步骤、site 配置样例、验证清单与常见坑见 [`.docs/nginx-reverse-proxy.md`](.docs/nginx-reverse-proxy.md)。最简版本：在 `.env` 写 `IMAGE_PUBLIC_BASE_URL=https://keeper.example.com` → `rebuild` → 在 nginx 里 `proxy_pass http://127.0.0.1:3093` 并透传 `X-Forwarded-*` 头。

### 快速重建脚本

代码或 `Dockerfile` / `docker-compose.yml` 改动后，用项目自带脚本重建：

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\rebuild.ps1
```

```bash
# Linux / macOS
bash ./rebuild.sh
```

脚本会显式带 `-p keeper-coc-trpg` 锁定 compose 项目名，无需手动拼 `docker compose` 命令。

---

## 项目结构

```
.
├── server.ts                          # Express 入口 + LLM 分发 + 图像缓存 + 全部 API 路由
├── src/
│   ├── App.tsx                        # 顶层组件，托管 game state / 存档 / 消息流 / 投骰路径分发
│   ├── types.ts                       # CharacterSheet / KeeperResponse / RollResult / ApiSettings 等核心类型
│   ├── components/
│   │   ├── StartScreen.tsx            # 起始页 + 存档列表
│   │   ├── CharacterCreator.tsx       # 角色创建（预设 / 自动 / Custom PC 槽位制）
│   │   ├── CharacterSheetPanel.tsx    # 跑团时的角色卡侧栏
│   │   ├── CharacterDossierPanel.tsx  # 角色档案 / 神秘接触面板
│   │   ├── CluesNotebook.tsx          # 线索本
│   │   ├── RollDiceModal.tsx          # 双十面骰动画（含命运博弈唤起）
│   │   ├── EffectRollModal.tsx        # 二阶段效果投骰
│   │   ├── MadnessIntCheckModal.tsx   # 疯狂状态机 INT 检定弹窗
│   │   ├── ApiSettingsPanel.tsx       # 「虚空连接的设置」
│   │   ├── SettingsPanel.tsx          # 内置侧栏（存档导出 / 控制台 / 退出 等）
│   │   ├── ConsoleLogPanel.tsx        # 调试控制台
│   │   ├── MarkdownText.tsx           # 守密人旁白渲染
│   │   └── icons/providerIcons.tsx    # 供应商品牌图标 + 中文标签
│   ├── data/
│   │   ├── cocSkills.ts               # CoC 7e 标准技能注册表（1920s / modern 双时代）
│   │   ├── cocOccupations.ts          # CoC 7e 职业模板 + coreSkills 五种 kind 表达
│   │   ├── cocWeapons.ts              # 武器结构化条目
│   │   └── presets.ts                 # 18 张预设调查员
│   ├── lib/
│   │   ├── apiSettings.ts             # localStorage 中的 API 配置读写 + 校验
│   │   ├── publicConfig.ts            # /api/public-config 缓存 + 图像 URL 白名单
│   │   ├── saveManager.ts             # localStorage 多存档管理
│   │   ├── cocRules.ts                # 派生战斗值 / 起始现金 / 突破点等规则函数
│   │   ├── cocSkillSlots.ts           # 槽位展开（expandOccupationSlots 等）
│   │   ├── cocSkillRandomizer.ts      # 随机分配点池（自动流 / 一键随机）
│   │   ├── characterValidation.ts     # 字典严格校验（落地前最后一道闸）
│   │   ├── characterCardRender.ts     # 角色卡 PNG 下载渲染
│   │   ├── diceFormula.ts             # NdM[+const][/divisor] 公式解析
│   │   ├── rollPolicy.ts              # 投骰路径 → 命运博弈开关矩阵
│   │   └── rollCancellation.ts        # 投骰取消机制
│   └── index.css                      # Tailwind + 全局滚动条等样式
├── .docs/                             # 项目内规范与决策文档
├── Dockerfile                         # deps / builder / runtime 三阶段
├── docker-compose.yml                 # 端口 3093:3000，含 healthcheck + 图像缓存 volume
├── rebuild.ps1 / rebuild.sh           # 一键重建 + 重启
└── CLAUDE.md                          # 给 Claude Code 看的项目协作约定
```

---

## UI 配色铁律

界面只用 **黑、绿、白** 三色，金色仅出现在 LUC 幸运槽。其它颜色（红 / 蓝 / 紫）只供属性槽和受击 / 异常反馈。

- 主点缀色固定为 `#10b981`（CSS 变量 `--color-coc-gold`、Tailwind class `text-coc-gold`、`border-coc-gold` —— 名字里带 "gold" 但实际值是绿色，**不要**改成黄色）
- 属性色：`HP=红 / MP=蓝 / SAN=翠绿 / LUC=黄`，跨界面保持一致
- 所有出现滚动的容器须挂 `custom-scrollbar` class，使用统一的绿色滚动条样式

完整规范见 `.docs/UI-STYLE-GUIDE.md`。

---

## 鸣谢

- 《Call of Cthulhu》7th edition © Chaosium Inc.
- 型月世界观（Type-Moon）相关概念归 TYPE-MOON / Notes 株式会社
- SCP Foundation 内容遵循 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)

本项目代码以 Apache-2.0 协议开源，仅供学习与同好自娱使用，不作任何商业用途。
