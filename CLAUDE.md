# Keeper_CoC-TRPG

基于 LLM 的克苏鲁的呼唤 (CoC 7th) TRPG 跑团应用，由 AI 扮演守密人 (Keeper)，集成型月与 SCP 世界观，采用 Vite + React 19 前端 + Express 后端的全栈一体化部署。

> 架构总览：开会话先读 `.docs/.work/PROJECT-OVERVIEW.md`，里面有 LLM 介入方式、KeeperResponse 输出契约、前端硬规则与 LLM 的协同机制等架构级理解，节省重启工作的摸盘开销。

## 交流语言

默认始终以**简体中文**与用户交流，除非用户在某次对话中明确要求改用其他语言。

- 适用范围：所有面向用户的文字输出（解释、总结、提问、错误说明等）。
- 代码、标识符、命令行参数、文件路径、提交信息等仍按惯例使用英文。
- 即使用户的某条消息使用了英文，默认回复仍使用简体中文。

## 美术规范（UI 配色与控件）

本项目所有 UI 改动必须遵守以下铁律。详细配色表、属性色映射、检查清单见 `.docs/UI-STYLE-GUIDE.md`。

- **三色主导,极少量金**:整套界面只用 **黑、绿、白** 三色;金色仅出现在 LUC 幸运槽。其他颜色(红/蓝/紫)仅供属性槽和受击/异常反馈使用,详见 `.docs/UI-STYLE-GUIDE.md` 第 3 节。
- **绿色主点缀色固定为 `#10b981`**(对应 CSS 变量 `--color-coc-gold`、Tailwind class `text-coc-gold` / `border-coc-gold` — 名字带 "gold" 但实际值是绿色,**不要**因此改成黄色)。
- **属性色沿用现规范,跨界面保持统一**:HP=红、MP=蓝、SAN=翠绿、LUC=黄。具体色值与槽位样式见规范文件第 3 节,**禁止**自创搭配。
- **滚动条全局统一**:所有出现滚动的容器(`overflow-y-auto` / `overflow-x-auto` / `overflow-auto`)必须挂 `custom-scrollbar` class,使用对话界面已定义的绿色图形化滚动条。**禁止**为单个组件单写 `::-webkit-scrollbar` 覆写。
- 新增/修改 UI 后,逐条对照 `.docs/UI-STYLE-GUIDE.md` 第 5 节"工作清单"再交付。

## API / 模型供应商架构

- 所有 LLM 与画图调用都通过 **`虚空连接的设置`** 面板由用户填入，凭据存于浏览器 `localStorage`，每次请求随 body 一起发到后端。**服务端不持久化任何 API Key**，也不读 `process.env.GEMINI_API_KEY` 之类的旧式启动密钥。
- 后端 `server.ts` 的 `dispatchLlm` 根据 `apiSettings.llm.provider` 动态分发：
  - `qiny` / `custom` / `grok` / `deepseek` → OpenAI 兼容路径 `/v1/chat/completions`
  - `gemini` → `@google/genai` SDK
  - `anthropic` → `@anthropic-ai/sdk`
- 画图当前只支持 `qiny` 一家（OpenAI 兼容的 `/v1/images/generations`）。
- 新增供应商时务必同步更新：`src/types.ts` 的 `LlmProviderKind` / `ImageProviderKind`、`src/lib/apiSettings.ts` 的校验枚举、`src/components/icons/providerIcons.tsx` 的图标与中文标签、`server.ts` 的 `resolveOpenAiBaseUrl` 与 `dispatchLlm`，以及 `/api/models` 的兜底逻辑。

### 画图统一规范

所有画图路径必须遵守以下铁律，新增端点和供应商时禁止绕过。

- 所有画图调用必须走 `server.ts` 的 `generateImageAndPublish`（内部 = `dispatchImage` 供应商分发 + `persistAndPublish` 内容寻址落盘）。**禁止**在路由里直接 `fetch` 上游画图 API，也**禁止**把 b64 / 第三方域名 URL 透传给前端。
- 服务端缓存固定在 `cache/images/<sha256>.png`，30 天滚动 TTL（每次复用自动刷新 mtime），统一通过 `/cache/images/*` 同源回放；公网根由 `IMAGE_PUBLIC_BASE_URL` 环境变量决定，未设时回退到请求 origin。
- 客户端 localStorage **只允许**保存以 `/api/public-config` 返回的 `imagePublicBaseUrl` 为前缀的 URL；任何不符前缀的 `imageUrl` 必须丢弃并打 warn，不得直接写入存档。
- 新增画图供应商时：扩展 `src/types.ts` 的 `ImageProviderKind` → 在 `dispatchImage` 加分支返回 `{ b64?, url? }` → 同步更新 `src/lib/apiSettings.ts` 校验枚举与 `providerIcons.tsx` 标签；**不要**新增独立的画图路由。

## 模组静态资产规范(`src/data/modules/<id>/assets/`)

模组目录里的 `cover.jpg` / `scenes/*.jpg` / `maps/*.png` / `handouts/*.png` 等图像会随仓库与 Docker 镜像分发,必须按规格压缩后入仓,**禁止**把原始扫描件、1080p+ 截图或未压缩 PNG 直接提交。

- 完整尺寸 / 编码 / 体积上限见 `.docs/scenario-schema.md` 第 11.1 节;关键点:封面 ≤ 120 KB(800 px,JPEG q82),场景图 ≤ 200 KB(1024 px),单模组 `assets/` 累计建议 ≤ 3 MB。
- 透明通道才用 PNG,否则一律 JPEG;新增模组前先压缩再 `git add`,提交时核对体积。
- 这条规范与"画图统一规范"互不冲突:**模组静态资产**走仓库 + 镜像内静态路由 `/modules/<id>/<path>`;**LLM 运行时画图**走 `generateImageAndPublish` + `/cache/images/*`。

## 外部模组导入工作流(把外部 PDF / docx / 翻译稿落进 `src/data/modules/<id>/`)

**任何"导入外部模组文档建立本游戏模组数据"的工作必须按 `.docs/module-import-guide.md` 走,以 `src/data/modules/tsumasaki-kidan` 作为金标准范例**。完整字段定义见 `.docs/scenario-schema.md`(SSOT);本节只钉死铁律。

### 必填铁律(违反则 prebuild 拒绝构建 / 演出会崩)

1. **`meta.recommended_occupations` 必填(≥ 1 项)** —— 原作没明写则按 hook 推断 3~8 个合理职业,宁少勿杂
2. **`meta.recommended` 默认写 `false`** —— 新导入的模组一律 `false`(不上主推位);主推位的开关由项目维护者在合并前后人工切换,**不要**因为"我觉得这个模组很精彩"自行写 `true`
3. **原作有 pre-gens → `preset_investigators` 逐张落卡;原作没有 → 留空** —— 判定原则见 `.docs/scenario-schema.md` §15.3
4. **每张 `preset_investigators[i]` 必须有 `items`(4~7 件职业身份道具),严禁全员空背包** —— 武器槽允许空(文职 PC 不带枪合理),但**道具槽不允许全空**;单条 text 长度 ∈ [1, 40],`weapons.length + items.length ≤ 8`
5. **`name / age / gender / nationality / identity / occupation` 在剧本模式下完全锁定 LLM 不允许覆盖** —— 必须在转写期完整定稿,日本模组 `nationality` 写"日本",身份写完整职业名 + 单位
6. **序幕场景必须在 `scene.frame.forbidden` 里钉死"互动门槛 + timeline 前置条件 + 自报姓名禁令 + 超自然禁令"** —— 参照 `tsumasaki-kidan` 的 `scene.bus-onboard`(5 次互动到站门槛)
7. **单人补偿 NPC(若有)必须写齐"视野盲区 / 第一次现身触发 / 姓名披露 / 道德底线消失"四条铁规则** —— 参照 `tsumasaki-kidan` 的 `npc.kuze-mei`;若该 NPC 设计上有性别反差,把"披露门槛"按层钉死(声音 → 自报姓名 → 公开身份)

### 工作流

1. 通读外部原作,按 `.docs/module-import-guide.md` §2 事实采集清单逐项落到笔记
2. 写 `src/data/modules/<id>/scenario.yaml`(三槽分离 frame/freedom/forbidden;ID 强类型前缀;Markdown 用 `|` 块字符串,**禁用** HTML)
3. 写 `src/data/modules/<id>/module.ts`(用 `tsumasaki-kidan/module.ts` 的 7~10 行模板,**不要**加自定义初始化逻辑)
4. 压图入 `assets/`(封面 ≤ 120 KB,场景图 ≤ 200 KB)
5. `npm run validate:modules` 全绿(49 用例 + 模组扫描)
6. `rebuild` skill 起容器,进游戏走一遍 hook → 序幕 → 第一幕,确认铁律生效
7. 拿不准的写法 → **先看 `tsumasaki-kidan` 怎么写**;原作明确写了 → 按原作落;原作没写但 tsumasaki 有同位结构 → 照抄骨架只换文本

详细流程、判断标准、自检清单与常见坑见 `.docs/module-import-guide.md`。

## Docker 部署约定

- 镜像采用**多阶段构建**保证体积最小：`node:20-alpine` 作为 builder 跑 `npm ci` + `npm run build`，再 copy 到一个干净的 `node:20-alpine` runtime，运行时只装生产依赖。
- 前端走 `vite build`，后端走 `esbuild --bundle --platform=node --format=cjs --packages=external` 打成 `dist/server.cjs`，运行入口是 `node dist/server.cjs`。
- 容器内 Express 监听 `0.0.0.0:3000`，对外暴露端口由 `docker-compose.yml` 决定（详见 README）。
- compose 项目名固定为 `keeper-coc-trpg`，由 `rebuild` 脚本通过 `-p keeper-coc-trpg` 显式锁定，避免与同机器上其它容器互相影响。
- `.docs/keeper-*.json` 这类玩家私有模组配置会被 `Dockerfile` 与 `.dockerignore` 排除，不会进入镜像。

## 重新编译 Docker 镜像并重启容器

每当本项目需要重建镜像并重启容器（包括但不限于：用户明确要求 rebuild；改动了 `Dockerfile` / `docker-compose.yml` / `.dockerignore`；改动了 `server.ts` / `src/**` / `vite.config.ts` 等会进入镜像的代码或配置），必须通过 `rebuild` skill 来执行，不要手动拼 `docker compose` 命令。

- 统一执行 `python rebuild.py`（跨平台，无执行策略问题）。
- 如需全量重建（跳过层缓存）：`python rebuild.py --no-cache`。
- 详细规则见 `.claude/skills/rebuild/SKILL.md`。

## Git 提交与推送

每当用户明确要求"提交"、"commit"、"推送"、"push"、"上传到 GitHub"等，使用 `commit-push` skill 完成。要点：

- **未经用户明确请求，绝不自动 commit / push**。
- 提交信息使用 **Conventional Commits**（英文，小写起首）；**不**附加 `Co-Authored-By` 行。
- 始终用 `git add <file>` 明确指定文件，**禁止** `git add -A` / `git add .`。
- 严禁：force push、`--amend` 已推送的 commit、`--no-verify`、修改 `git config`、`reset --hard` 等高破坏性操作（除非用户显式同意）。
- 仓库当前可能尚未初始化 git；遇到 `not a git repository` 时先停下询问，不要擅自 `git init`。
- **每次提交/推送前必须同步项目快照**：检查本次改动是否影响架构、调用链路、`KeeperResponse` 输出契约、关键文件地图、必读规范文档清单或常见坑等内容；若有影响，必须同步更新 `.docs/.work/PROJECT-OVERVIEW.md` 后将其与代码改动一并 commit。纯文档微调、注释、UI 文案 / 配色之外的视觉微调可豁免，但需在提交对话中显式说明"无需同步快照"。
- 详细规则见 `.claude/skills/commit-push/SKILL.md`。

## Vibo Coding 工作规范

> 本项目为存量项目，适用"**部分适用**"级别——跳过初始设计和审核阶段，从当前 P 阶段续接。

### 版本与阶段（V + P）

- **V（闭环版本）**：一个对外可用、功能闭环的版本。
- **P（功能模块阶段）**：一个 V 内部按功能模块拆分的最小交付单元（如模组导入、新供应商支持、UI 组件等），每个 P 必须**可独立验证、可独立提交**。

### Plan 模式开发

所有 P 阶段的增量开发工作在 **plan 模式**下进行：
1. 针对当前 P 阶段用 `EnterPlanMode` 进入 plan 模式
2. 明确本 P 的实现方案、涉及文件、验证步骤
3. 用户批准 plan 后执行实现
4. 完成验证后用 `rebuild` skill 重建容器

### P 阶段收尾（每 P 必做）

每个 P 阶段完成后，**必须**执行：

1. **Git 提交与推送** — 通过 `commit-push` skill，提交前同步 `.docs/.work/PROJECT-OVERVIEW.md`（按现有规则），做 `git status` 和 secret 检查
2. **更新或创建交接文档** — 落于 `.docs/阶段交接-XXX.md`，包含以下章节：
   - 交接目的 + 必读文档列表（至少含 `PROJECT-OVERVIEW.md`、`scenario-schema.md`、`UI-STYLE-GUIDE.md`）
   - 当前进度（本 P 完成了什么）
   - 本轮已修复/已实现（按文件列出）
   - 仍需验证/已知问题
   - **续接提示词**（可直接粘贴给新对话的提示词，约 10-20 行，含必读文档、当前进度、下一步行动、关键约束和模组铁律）
3. **更新 Memory** — 关键节点（P 开始/完成、关键决策、模组导入进度等）写入 memory 跟踪

### 跨对话接续

新对话继续开发时：读取本 CLAUDE.md → 读取 `PROJECT-OVERVIEW.md` → 读取最新交接文档 → 根据"续接提示词"确定下一步 → plan 模式进入。
