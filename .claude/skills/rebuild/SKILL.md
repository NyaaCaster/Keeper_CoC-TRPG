---
name: rebuild
description: Rebuild the Keeper_CoC-TRPG Docker image and restart its container. Use this whenever the project needs a Docker rebuild + restart (e.g., after Dockerfile, docker-compose.yml, server.ts, or any source change that affects the bundled image). Runs rebuild.py which works on all platforms (Windows/Linux/macOS) without execution-policy issues.
---

# rebuild

本项目需要重新编译 Docker 镜像并重启容器时调用此 skill。

## 触发场景

- 用户明确要求"重新编译"、"重建镜像"、"重启容器"、"rebuild"。
- 改动了 `Dockerfile`、`docker-compose.yml`、`.dockerignore` 等容器构建相关文件。
- 改动了 `server.ts` / `src/**` / `vite.config.ts` / `package.json` 等会影响镜像内构建产物或 Node 依赖的源码 / 配置。
- 通过 `/rebuild` 显式调用。

## 执行

**统一使用 Python 脚本**（跨平台，无执行策略问题）：

```bash
python rebuild.py
```

如需全量重建（跳过层缓存）：
```bash
python rebuild.py --no-cache
```

脚本功能：停止容器 → 增量构建镜像 → 清理 dangling 镜像 → 启动容器 → 显示运行状态。
通过 `-p keeper-coc-trpg` 显式锁定 compose 项目名，确保只影响本项目。

执行后向用户简要汇报：脚本是否成功结束、容器是否健康、对外端口与可访问 URL。

## 关于缓存策略

脚本默认走 Docker 的层缓存（不带 `--no-cache`），原因：

- 多阶段 Dockerfile 第一层是 `COPY package.json package-lock.json ./` + `RUN npm ci`。只要 lockfile 没变，这一层会命中缓存，秒级跳过；改 `server.ts` / `src/**` 时不需要重新拉 `node_modules`。
- 之前默认 `--no-cache` 是为了"绝对干净"，但代价是每次都要从 `registry.npmjs.org` 全量拉所有 tarball；遇到网络抖动（TLS 重置、连接超时）就会失败，整个流程白跑。
- Docker 的层指纹按指令文本 + 上游层 + 被 COPY 进来的文件内容来算，所以**改源码自然会让对应层失效，不会出现"该重建却没重建"的情况**。

什么时候确实需要全量重建：

- 怀疑 base image 自身有脏状态（很少见）。
- 改了 npm 镜像源 / 私有 registry 配置，担心旧缓存层里残留旧凭据。
- 排查"为什么改了 X 镜像里没生效"——先确认 Dockerfile 里这一层应该被 invalidate，再考虑 `--no-cache`。

需要时用 `python rebuild.py --no-cache`。

## 不要做的事

- 不要绕过脚本直接调用 `docker compose build`/`up`/`down`——使用脚本能保证流程一致并锁定项目名。
- 不要随手 `docker system prune -a` —— 脚本里只清理 dangling 镜像，足够且安全。
- 不要使用已删除的 `rebuild.ps1` / `rebuild.sh`（已迁移到 `rebuild.py`）。
