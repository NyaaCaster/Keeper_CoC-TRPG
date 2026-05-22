---
name: rebuild
description: Rebuild the Keeper_CoC-TRPG Docker image and restart its container. Use this whenever the project needs a Docker rebuild + restart (e.g., after Dockerfile, docker-compose.yml, server.ts, or any source change that affects the bundled image). Picks rebuild.ps1 on Windows and rebuild.sh on Linux/macOS, and always invokes PowerShell with `-ExecutionPolicy Bypass`.
---

# rebuild

本项目需要重新编译 Docker 镜像并重启容器时调用此 skill。

## 触发场景

- 用户明确要求"重新编译"、"重建镜像"、"重启容器"、"rebuild"。
- 改动了 `Dockerfile`、`docker-compose.yml`、`.dockerignore` 等容器构建相关文件。
- 改动了 `server.ts` / `src/**` / `vite.config.ts` / `package.json` 等会影响镜像内构建产物或 Node 依赖的源码 / 配置。
- 通过 `/rebuild` 显式调用。

## 选择脚本

根据当前会话所在系统选择脚本，**不要混用**：

| 系统环境              | 使用的脚本    | 调用方式                                                 |
| --------------------- | ------------- | -------------------------------------------------------- |
| Windows (`win32`)     | `rebuild.ps1` | `powershell -ExecutionPolicy Bypass -File .\rebuild.ps1` |
| Linux / macOS / WSL   | `rebuild.sh`  | `bash ./rebuild.sh`                                      |

判断依据优先级：

1. 环境信息中的 `Platform`（如 `win32` → PowerShell）。
2. 当前可用的 shell（PowerShell 工具可用 → Windows；仅 Bash → Linux/macOS）。

## 关于 `-ExecutionPolicy Bypass`

该参数传给 **PowerShell 进程本身**（不是 `rebuild.ps1` 脚本的参数），作用是临时绕过本机的脚本执行策略（Execution Policy）。

- **作用范围**：只对当前这次 `powershell` / `pwsh` 进程生效，进程结束即失效；不修改注册表，也不影响系统其他脚本。
- **为什么必须带**：`rebuild.ps1` 是本仓库里**未签名**的本地脚本。在默认策略为 `Restricted`（Windows 客户端默认）或 `AllSigned` 的机器上直接 `.\rebuild.ps1` 会报 *"running scripts is disabled on this system"* 而无法启动。带上 `-ExecutionPolicy Bypass` 后，无论目标机器当前策略是什么，脚本都能正常运行。
- **不需要管理员权限**，普通用户即可使用。
- **优先级**：高于本机已配置的策略；唯一无法覆盖的是通过组策略（`MachinePolicy` / `UserPolicy`）强制下发的策略。
- **安全边界**：执行策略本身不是安全边界（微软官方说法），只能挡住误操作。对**本仓库自己维护**的脚本使用 `Bypass` 是合理且常见的；但**不要**把这个习惯应用到来源不明的第三方 `.ps1` 上——执行前应先审阅其内容。

## 执行规则

- **必须**带 `-ExecutionPolicy Bypass` 参数运行 `rebuild.ps1`，避免被本机执行策略拦截。
- 用 `PowerShell` 工具（Windows）或 `Bash` 工具（Linux/macOS）直接执行；不要把两者混在一条命令里。
- 完整命令示例：
  - Windows: `powershell -ExecutionPolicy Bypass -File .\rebuild.ps1`
  - Linux/macOS: `bash ./rebuild.sh`
- 脚本本身已包含：停止本项目容器 → 按层缓存增量构建 → 清理 dangling 镜像 → 启动容器 → 列出运行中容器。不要再额外手动执行这些步骤。
- 脚本通过 `-p keeper-coc-trpg` 显式锁定 compose 项目名，确保只影响本项目，不会动到同机器上的其它容器。
- 执行前请确认工作目录是项目根目录（含 `docker-compose.yml`）。
- 执行后向用户简要汇报：脚本是否成功结束、容器是否健康、对外端口与可访问 URL。

## 关于缓存策略

脚本默认走 Docker 的层缓存（不带 `--no-cache`），原因：

- 多阶段 Dockerfile 第一层是 `COPY package.json package-lock.json ./` + `RUN npm ci`。只要 lockfile 没变，这一层会命中缓存，秒级跳过；改 `server.ts` / `src/**` 时不需要重新拉 `node_modules`。
- 之前默认 `--no-cache` 是为了"绝对干净"，但代价是每次都要从 `registry.npmjs.org` 全量拉所有 tarball；遇到网络抖动（TLS 重置、连接超时）就会失败，整个流程白跑。
- Docker 的层指纹按指令文本 + 上游层 + 被 COPY 进来的文件内容来算，所以**改源码自然会让对应层失效，不会出现"该重建却没重建"的情况**。

什么时候确实需要全量重建：

- 怀疑 base image 自身有脏状态（很少见）。
- 改了 npm 镜像源 / 私有 registry 配置，担心旧缓存层里残留旧凭据。
- 排查"为什么改了 X 镜像里没生效"——先确认 Dockerfile 里这一层应该被 invalidate，再考虑 `--no-cache`。

需要时，临时手动加参数即可，**不要改脚本**：
```powershell
docker compose -p keeper-coc-trpg -f docker-compose.yml build --no-cache
docker compose -p keeper-coc-trpg -f docker-compose.yml up -d
```

## 不要做的事

- 不要绕过脚本直接调用 `docker compose build`/`up`/`down`——使用脚本能保证流程一致并锁定项目名。
- 不要在 Windows 上用 `bash` 跑 `rebuild.sh`（除非用户明确指定 WSL/Git Bash 环境），反之亦然。
- 不要省略 `-ExecutionPolicy Bypass`。
- 不要随手 `docker system prune -a` —— 脚本里只清理 dangling 镜像，足够且安全。
