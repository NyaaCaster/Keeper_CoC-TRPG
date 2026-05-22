# Keeper_CoC-TRPG

基于 LLM 的克苏鲁的呼唤 (CoC 7th) TRPG 跑团应用，由 AI 扮演守密人 (Keeper)，集成型月与 SCP 世界观，采用 Vite + React 19 前端 + Express 后端的全栈一体化部署。

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

## Docker 部署约定

- 镜像采用**多阶段构建**保证体积最小：`node:20-alpine` 作为 builder 跑 `npm ci` + `npm run build`，再 copy 到一个干净的 `node:20-alpine` runtime，运行时只装生产依赖。
- 前端走 `vite build`，后端走 `esbuild --bundle --platform=node --format=cjs --packages=external` 打成 `dist/server.cjs`，运行入口是 `node dist/server.cjs`。
- 容器内 Express 监听 `0.0.0.0:3000`，对外暴露端口由 `docker-compose.yml` 决定（详见 README）。
- compose 项目名固定为 `keeper-coc-trpg`，由 `rebuild` 脚本通过 `-p keeper-coc-trpg` 显式锁定，避免与同机器上其它容器互相影响。
- `.docs/keeper-*.json` 这类玩家私有模组配置会被 `Dockerfile` 与 `.dockerignore` 排除，不会进入镜像。

## 重新编译 Docker 镜像并重启容器

每当本项目需要重建镜像并重启容器（包括但不限于：用户明确要求 rebuild；改动了 `Dockerfile` / `docker-compose.yml` / `.dockerignore`；改动了 `server.ts` / `src/**` / `vite.config.ts` 等会进入镜像的代码或配置），必须通过 `rebuild` skill 来执行，不要手动拼 `docker compose` 命令。

- Windows 环境：执行 `powershell -ExecutionPolicy Bypass -File .\rebuild.ps1`。
- Linux / macOS 环境：执行 `bash ./rebuild.sh`。
- `-ExecutionPolicy Bypass` 参数在 Windows 下**必须**带上，避免本机执行策略拦截。
- 详细规则见 `.claude/skills/rebuild/SKILL.md`。

## Git 提交与推送

每当用户明确要求"提交"、"commit"、"推送"、"push"、"上传到 GitHub"等，使用 `commit-push` skill 完成。要点：

- **未经用户明确请求，绝不自动 commit / push**。
- 提交信息使用 **Conventional Commits**（英文，小写起首）；**不**附加 `Co-Authored-By` 行。
- 始终用 `git add <file>` 明确指定文件，**禁止** `git add -A` / `git add .`。
- 严禁：force push、`--amend` 已推送的 commit、`--no-verify`、修改 `git config`、`reset --hard` 等高破坏性操作（除非用户显式同意）。
- 仓库当前可能尚未初始化 git；遇到 `not a git repository` 时先停下询问，不要擅自 `git init`。
- 详细规则见 `.claude/skills/commit-push/SKILL.md`。
