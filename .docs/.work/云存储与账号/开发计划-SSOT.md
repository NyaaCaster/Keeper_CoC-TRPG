# Keeper_CoC-TRPG 云存储 + 账号版本 开发计划（SSOT）

> 本文件是「云存储 + 账号版本（V1）」开发阶段的**唯一事实来源（Single Source of Truth）**。
> 所有关键决策、架构方案、阶段划分、约束以本文件为准。跨对话接续时先读本文件，再读最新阶段交接文档。
>
> - 初始设计：`.docs/.work/云存储与账号版本初始设计.md`
> - 阶段交接：`.docs/.work/阶段交接-XXX.md`（递增）
> - 调研依据：NyaaChat（idb 迁移 / 云同步 / NyaaAcount 接入）、NyaaAcount README 接入契约

---

## 1. 版本目标与范围

### 1.1 V1 目标
把 Keeper_CoC-TRPG 从「纯本地 localStorage」升级为：
- **本地存储 IndexedDB 化**：设置、调查记录（存档）本地存储从 localStorage 迁移到 IndexedDB。
- **调查员账户系统**：接入 NyaaAcount 统一账号，支持用户名/邮箱登录，本地持久化登录状态。
- **云端同步**：设置、调查记录可上传/下载到服务器，跨设备同步。
- **储存边界**：调查记录本地上限 64MB，带占用计量条与超限保护。

### 1.2 范围边界（不做）
- ❌ 不做 NyaaChat 的「角色共享库」功能（共享角色/评分/猫粮经济）。云后端只存用户设置和调查记录。
- ❌ 不新增独立后端服务、不引入 nginx 层（保持单进程单容器）。
- ❌ 不做应用内注册/改密 UI（注册与账号管理跳转 NyaaAcount）。

---

## 2. 已确认架构决策

| 维度 | 决策 | 理由 |
|---|---|---|
| 云存储/账号后端 | **内嵌进现有 `server.ts` 同进程** | Keeper 现为单进程 Express+Vite 单容器（3093:3000），无 nginx。内嵌改动最小、部署最简。 |
| 服务端数据库 | **better-sqlite3**（同步、WAL、`foreign_keys=ON`） | 沿用 NyaaChat 方案，单文件、可 Navicat 直连。 |
| 数据落盘位置 | **`E:\DockerRes\keeper-coc-trpg\`** bind mount | 遵循用户级 Docker 大文件规范；sqlite 库 + 用户存储文件都放此目录。 |
| 云端调查记录加密 | **沿用 NyaaChat E2E 加密（Nyaa-HMAC-XOR-V1）** | 客户端加密、服务端只存密文；密钥服务端持有、跨设备共享；免安全上下文（HTTP 可用）。 |
| 账号接入模式 | 后端凭证转发 `verify` + 本地 session token + `nyaa_uid` 关联 + JIT 首登 + 弃存密码；**fail-closed** | 沿用 NyaaChat 三段式接入，本地不存密码。 |
| NyaaAcount 凭证 | 后缀 **`KEEPER`**：`NYAAACOUNT_API_TOKEN_KEEPER` + `NYAAACOUNT_ENCRYPTION_KEY_KEEPER` | NyaaAcount 按环境变量名后缀识别项目，无需白名单表；后缀用纯字母避免连字符。纳入 P5。 |
| 本地存储上限 | 调查记录 **64MB**（手工分类计量，非 `navigator.storage.estimate`） | 沿用 NyaaChat 分类配额条方案。 |

### 2.1 新增依赖
- 后端：`better-sqlite3`、`@noble/hashes`（HMAC-XOR 传输加密与 E2E 加密）。
- 前端 IndexedDB 层：**零依赖**（原生 `indexedDB` API，沿用 NyaaChat 手写封装）。

### 2.2 服务地址与端点（NyaaAcount）
- 生产入口：`http://h.nyaa.host:5110`，接入端点 `/api/project/{verify,register,uid,password}`。
- 注册跳转：`http://h.nyaa.host:5110/?view=register`；账号管理：`http://h.nyaa.host:5110/`。
- 凭证仅存 Keeper 服务端 `.env`，**绝不下发浏览器**。传输加密 Nyaa-HMAC-XOR-V1，仅加密 POST/PUT 请求体。

---

## 3. 环境变量约定（Keeper 服务端 `.env`）

```env
# 已有
NYAACHAT_MCP_TOKEN=            # 客观骰（可空，回退本地骰）
IMAGE_PUBLIC_BASE_URL=        # 线索图公网前缀
TRUST_PROXY=loopback, linklocal, uniquelocal

# 新增（云存储 + 账号）
NYAAACOUNT_BASE_URL=http://h.nyaa.host:5110   # NyaaAcount 平台地址
NYAAACOUNT_API_TOKEN=                         # Keeper 专属 project token（KEEPER 后缀，base64url）
NYAAACOUNT_ENCRYPTION_KEY=                    # Keeper 专属传输密钥（hex 32 字节）
KEEPER_DB_PATH=/data/db/keeper.db             # 容器内 sqlite 路径（bind mount 到 E:\DockerRes）
KEEPER_USER_STORAGE_DIR=/data/user-storage    # 容器内用户存储目录
```
- `.env` 为 git-ignored，凭证不进版本库。fail-closed：变量缺失/网络失败 → 登录返回 503，绝不回退本地密码校验。

---

## 4. 阶段划分（V + P）

**V1 = 云存储 + 账号闭环版本。** 状态：⬜ 未开始 / 🟡 进行中 / ✅ 已完成

| P | 主题 | 交付与验证 | 状态 |
|---|---|---|---|
| **P1** | 本地存储 localStorage → IndexedDB | 存档/设置读写走 IDB；老数据静默迁移（哨兵幂等）；lint+build 通过 | ✅ |
| **P2** | 储存计量条 + 64MB 边界 | 调查记录档案界面显示占用计量条；导入/保存超限拦截；采用 Keeper 配色控件 | ✅ |
| **P3** | 账号系统后端（内嵌 server.ts + sqlite） | users/sessions/user_settings 表；login/logout/profile/rename 路由；本地 session token；可本地冒烟 | ✅ |
| **P4** | 账号系统前端 UI | 首页「调查员登录」选单（登录后才出现游戏选单）；顶栏「调查员账户」按钮（id-card）；账户二级界面；退出登录二次确认 | ✅ |
| **P5** | NyaaAcount 凭证接入 + 真实登录联调 | NyaaAcount 侧配 KEEPER 凭证并重建；verify 转发 + JIT 首登 + 弃存密码；真账号 E2E 登录通过 | ✅ |
| **P6** | 云端设置同步 | 设置界面底部「下载设置/上传设置」按钮（在导入/导出之前）；覆盖式同步 + 时间戳 + 二次确认 | ✅ |
| **P7** | 云端调查记录同步（E2E 加密）+ 部署收尾 | 档案界面「下载记录/上传记录」按钮；Nyaa-HMAC-XOR-V1 加密；docker-compose bind mount E:\DockerRes；部署验证 | ✅ |

依赖顺序：P1→P2 可独立；P3→P4→P5 账号链；P5→P6→P7 云同步链（P6/P7 依赖 P3 后端与 P5 登录态）。

---

## 5. 关键技术方案要点

### 5.1 本地存储 IDB 化（P1）
- 新增 `src/lib/idbStorage.ts`：原生 IDB KV 封装，`DB_NAME="keeper_storage"`，store `kv`（out-of-line key，`key(string)→value(string)`）。API：`getItem/setItem/removeItem/getAllKeys/isMigrationDone/migrateFromLocalStorage`。每次操作 open+close；`indexedDB` 不可用时优雅降级。
- **cache + async-persist 模式**：`saveManager` / `apiSettings` 各维护内存缓存，bootstrap 时 `hydrate*()` 填充，之后同步读缓存、异步落盘。解决「IDB 异步 vs React 同步读」矛盾。
- `main.tsx` bootstrap 顺序：`loadPublicConfig` → `migrateFromLocalStorage()` → `hydrateSaves()` → `hydrateApiSettings()` → `render()`。
- 迁移：哨兵 `__idb_migrated__` 幂等，逐 key 复制 `keeper_game_saves`/`keeper_api_settings`，全部成功才清 localStorage。静默迁移，无过渡弹窗。
- 保留 `sanitizeForStorage` 图片 URL 白名单机制。

### 5.2 储存计量（P2）
- 新增 `storageEstimate.ts`：`CHAT_STORAGE_QUOTA = 64*1024*1024`；`estimateSaveStorage()` 用 `new Blob([str]).size` 分类求和。
- 新增 `StorageBar` 组件（Keeper 配色：`#10b981` 绿 / `custom-scrollbar`），≥80% 转琥珀色告警。
- 导入/保存守卫：预估 `used + size*2 > quota*0.95` 拒绝。

### 5.3 账号后端（P3/P5）
- sqlite 表：`users(account PK, username, created_at, last_active, nyaa_uid)`（不建 password 列，新项目直接弃存）、`sessions(token PK, account FK)`、`user_settings(account PK, payload, updated_at)`。
- `nyaacount-client`：Nyaa-HMAC-XOR-V1 传输加密 + `verifyUser/registerUser/changePassword/getUidByUsername`；fail-closed。
- 登录：`verify` 转发 → 按 `nyaa_uid` 定位本地行 → 无则 JIT 建号 → 发本地 session token。
- 路由挂 `/api/account/*`（同进程，无需 nginx 反代）。

### 5.4 账号前端（P4）
- 首页：登录前只显示「调查员登录」选单（账号/邮箱 + 密码 + 登录 + 「没有账号？去注册」跳转）；登录后才显示原「踏入全新的漩涡/继续未完的调查/虚空连接的设置」。
- 本地持久登录：token+profile 存 IDB（`keeper_account`），退出登录前保持。
- 顶栏「调查员面板」按钮左侧加「调查员账户」按钮（`IdCard` 图标，lucide-react 已提供）。
- 账户二级界面：账号 / 用户名（可改，仅显示）/ 注册时间 / 账号管理（跳转）/ 退出登录（复用「退出调查」二次确认弹窗样式）。
- 建议顺手抽 `ConfirmModal` 复用组件（收编现 `App.tsx` 退出确认内联弹窗）。

### 5.5 云同步（P6/P7）
- 前端 `sharedAccountApi`：三态 `ApiResult`（ok/error/network），token 存 IDB，12s 超时。
- 设置同步：`PUT/GET /api/account/settings`（sqlite user_settings，一用户一存档，upsert）。
- 记录同步：`PUT/GET /api/account/chat-sessions`（文件原子写 temp+rename）+ `GET /api/account/chat-sessions/key`（服务端持有密钥，跨设备共享）。客户端 `chatCrypto` 加密。
- 交互：覆盖式，无自动合并；显示 `updated_at` + 二次确认（下载为破坏性红色确认）。

---

## 6. 执行守则（每 P 必守）

1. **Plan 模式**：每个 P 进入前用 plan 明确方案、涉及文件、验证步骤，用户批准后实现。
2. **验证**：`npm run lint`（tsc --noEmit）+ `npm run build` 必须通过；按 P 定义做功能验证；清理测试产物（测试用户、临时脚本、dump）。
3. **diff/status 检查**：提交前 `git status` + secret 检查，确认无 `.env`、私密资料、临时文件、排除目录混入。
4. **提交推送**：Conventional Commits；`git add <file>` 精确添加；禁止 force push；禁止提交 `.docs/keeper-*.json` 玩家私有配置。
5. **阶段交接**：`.docs/.work/阶段交接-XXX.md`（递增），含当前进度 / 本轮改动 / 待验证 / 续接提示词。
6. **Memory**：每 P 起止、关键决策、用户反馈写入 memory。

---

## 7. 进度日志

| 日期 | 事件 |
|---|---|
| 2026-07-04 | 完成三项调研（NyaaChat idb 迁移、云同步、NyaaAcount 接入）；审计设计；确认 4 项关键决策；落盘本 SSOT；启动 P1。 |
| 2026-07-05 | P1 完成：localStorage→IDB 迁移（缓存+hydrate+异步落盘+幂等哨兵）。lint+build 通过。 |
| 2026-07-05 | P2 完成：储存计量条 + 64MB 边界。storageEstimate.ts + StorageBar.tsx + 导入/自动保存守卫。lint+build 通过。 |
| 2026-07-05 | P3 完成：账号系统后端。db.ts + nyaacount-client.ts (HMAC-XOR-V1) + auth.ts + /api/account/* 路由。lint+build+冒烟测试通过。 |
| 2026-07-05 | P4 完成：账号系统前端 UI。idbAccount.ts + accountApi.ts + ConfirmModal.tsx + AccountPanel.tsx + StartScreen 登录选单 + App.tsx IdCard 顶栏。lint+build 通过。 |
| 2026-07-05 | P5 完成：NyaaAcount KEEPER 凭证接入。NyaaAcount .env 配 KEEPER token+key 并 rebuild；Keeper .env 配 BASE_URL+token+key 并 rebuild；curl 全链路 E2E（login/profile/rename/logout/token 失效）通过；lint+build+49tests 全绿；测试数据已清理。 |
| 2026-07-05 | P6 完成：云端设置同步。db.ts prepared statements + server.ts PUT/GET /api/account/settings + accountApi.ts 云同步函数 + ApiSettingsPanel 上传/下载按钮 + ConfirmModal 二次确认。curl E2E 5/5 通过，lint+build+49tests 全绿，测试数据已清理。 |
| 2026-07-05 | P7 完成：云端调查记录同步（E2E 加密）+ 部署收尾。chatCrypto.ts（Nyaa-HMAC-XOR-V1）+ server.ts 3 个路由（key/upload/download）+ accountApi.ts 3 个函数 + StartScreen 云同步按钮 + docker-compose user-storage bind mount。curl E2E 6/6 通过，文件持久化验证通过，lint+build+49tests 全绿，V1 全部完成。 |
