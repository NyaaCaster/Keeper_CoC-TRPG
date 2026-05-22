# Keeper_CoC-TRPG

> 由 LLM 扮演守密人（Keeper / KP）的《克苏鲁的呼唤》第七版（CoC 7th）TRPG 跑团应用。
> 默认糅合**克苏鲁神话**、**型月世界观**与 **SCP 基金会** 三套设定，可按需独立开关。

界面以**克系黑绿白 + 微量金**为主色调，前后端一体化打成单个 Node.js 容器，部署起来只是 `docker compose up` 一行的事。

---

## 功能一览

- **AI 守密人**：基于 LLM 的 CoC 7e 跑团主持，严格按 JSON Schema 输出旁白、技能检定、理智检定、NPC 台词、线索图等结构化字段。
- **客观掷骰**：所有需要不确定结果的判定都由前端弹出双十面骰动画，玩家手动投点；KP 不允许自己代骰。可接入 NyaaChat-MCP 服务做服务端真随机，未配置时回落到本地实现。
- **明骰 / 暗骰**：守密人替环境与 NPC 投骰时走专门的 `keeperRoll` 通路，明骰公开、暗骰只显示神秘轰鸣。
- **三维世界开关**：开始新游戏时可独立开关「型月要素」「SCP 要素」，全关即纯净 CoC 模式（System Prompt 中会硬性禁止提及）。
- **角色生成**：内置预设调查员，或让 LLM 根据玩家自述的故事/概述自动生成 8 维属性 + 5–8 项核心技能。
- **线索本**：场景中发现的纸条、术式、照片等关键道具会自动入册，并配 LLM 生成的克系质感配图。
- **存档管理**：以 `localStorage` 为底的多存档系统，支持导出/下载 JSON 存档。
- **多 LLM 供应商**：qiny / 自定义 OpenAI 兼容 / Grok / DeepSeek / Gemini / Anthropic 全部走同一套分发逻辑。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vite 6 + React 19 + TypeScript 5.8 + Tailwind 4 + motion |
| 图标 | lucide-react + @lobehub/icons-static-svg |
| 后端 | Express 4 + tsx（开发） / esbuild 打成 CJS（生产） |
| LLM SDK | `@google/genai`、`@anthropic-ai/sdk`，以及 fetch 直连 OpenAI 兼容路径 |
| 容器 | `node:20-alpine` 多阶段 + `tini` 作 PID 1 |

开发模式下 Express 内嵌 Vite 中间件做 SPA dev server；生产模式直接静态服务 `dist` 目录。前后端共享同一个端口（容器内 `3000`）。

---

## API / 模型供应商架构

> **服务端不持久化任何 API Key**，也不读取 `GEMINI_API_KEY` 之类的旧式启动密钥。

所有 LLM 与画图调用都通过前端的 **「虚空连接的设置」** 面板由用户填入，凭据存于浏览器 `localStorage`，每次请求随 body 一起发送到后端。后端 `dispatchLlm` 根据 `apiSettings.llm.provider` 动态分发：

| provider | 路径 | 备注 |
|---|---|---|
| `qiny` | `https://openai.chatnewai.com/v1/chat/completions` | OpenAI 兼容 |
| `custom` | 用户填入的 base URL（自动补 `/v1`） | OpenAI 兼容 |
| `grok` | `https://api.x.ai/v1/chat/completions` | OpenAI 兼容 |
| `deepseek` | `https://api.deepseek.com/v1/chat/completions` | OpenAI 兼容 |
| `gemini` | `@google/genai` SDK，原生 `responseSchema` | |
| `anthropic` | `@anthropic-ai/sdk`，Schema 以 prompt 形式注入 | |

画图当前仅支持 `qiny`（OpenAI 兼容的 `/v1/images/generations`），未配置时线索照片会回落为占位图。

服务端 API 端点：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/keeper/chat` | 守密人主对话 |
| POST | `/api/keeper/generate-module-outline` | 生成模组大纲 + 3 个预设调查员 |
| POST | `/api/keeper/generate-stats` | 根据玩家自述生成属性 + 技能 |
| POST | `/api/keeper/roll` | 客观掷骰（MCP 真随机 / 本地回落） |
| POST | `/api/image/generate-clue` | 生成线索道具配图 |
| GET | `/api/models` | 透传供应商模型列表 |

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

镜像采用三阶段构建：`deps` 装全量依赖、`builder` 跑 `npm run build` 同时产出前端 bundle 和 `dist/server.cjs`、`runtime` 只装生产依赖再 copy 产物，最终镜像很薄。

```bash
docker compose up -d --build
```

`docker-compose.yml` 默认把容器内的 `3000` 映射到宿主机 `3093`。compose 项目名固定为 `keeper-coc-trpg`，避免与同机器上其它 compose 项目互相干扰。

可选环境变量：

| 变量 | 作用 |
|---|---|
| `NYAACHAT_MCP_TOKEN` | 配上后掷骰走 NyaaChat-MCP 真随机；留空则回落到本地骰子实现 |

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
├── server.ts                       # Express 入口 + LLM 分发 + 所有 API 路由
├── src/
│   ├── App.tsx                     # 顶层组件，托管 game state / 存档 / 消息流
│   ├── types.ts                    # CharacterSheet / KeeperResponse / RollResult 等核心类型
│   ├── components/
│   │   ├── StartScreen.tsx         # 起始页 + 存档列表
│   │   ├── CharacterCreator.tsx    # 角色创建（预设 / 自定义）
│   │   ├── CharacterSheetPanel.tsx # 角色卡侧栏
│   │   ├── CluesNotebook.tsx       # 线索本
│   │   ├── RollDiceModal.tsx       # 双十面骰动画
│   │   ├── ApiSettingsPanel.tsx    # 虚空连接的设置
│   │   └── icons/providerIcons.tsx # 供应商品牌图标 + 中文标签
│   ├── lib/
│   │   ├── apiSettings.ts          # localStorage 中的 API 配置读写 + 校验
│   │   └── saveManager.ts          # localStorage 多存档管理
│   ├── data/presets.ts             # 预设调查员
│   └── index.css                   # Tailwind + 全局滚动条等样式
├── Dockerfile                      # deps / builder / runtime 三阶段
├── docker-compose.yml              # 端口 3093:3000，含 healthcheck
├── rebuild.ps1 / rebuild.sh        # 一键重建 + 重启
└── CLAUDE.md                       # 给 Claude Code 看的项目协作约定
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
