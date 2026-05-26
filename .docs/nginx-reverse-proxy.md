# nginx 反向代理部署指南

把 Keeper_CoC-TRPG 挂到自有域名（HTTPS、子域、子路径都行）的最小完整方案。本项目原生支持反代，**无需改任何代码**，只要按下面的清单做完三件事就能跑通。

> 适用范围：把同机器上的 docker 容器（默认 `127.0.0.1:3093`）暴露成 `https://keeper.example.com` 之类的对外站点。其他场景（Cloudflare Tunnel、Caddy、Traefik）的精神也一样，把"X-Forwarded-* 头透传 + IMAGE_PUBLIC_BASE_URL 设成对外公网根"两件事做对即可。

---

## 1. 项目侧前置

### 1.1 必填：把对外域名写进 `.env`

仓库根目录的 `.env`（compose 会自动加载）至少要有：

```dotenv
IMAGE_PUBLIC_BASE_URL=https://keeper.example.com
```

为什么必须写：

- LLM 生成的线索图统一落在 `cache/images/<sha256>.png`，由服务端铸造一个公网 URL 回写到客户端。
- 浏览器 localStorage **只接受**以这个前缀打头的 `imageUrl`（白名单，详见 [`src/lib/publicConfig.ts`](../src/lib/publicConfig.ts) 与项目 `CLAUDE.md` 的「画图统一规范」）。
- 不写就回退到请求 origin。反代场景下回退结果的 host/scheme 取决于 `X-Forwarded-*` 头是否被信任，链路稍有抖动就会让旧画图存档跨设备失效。**直接显式写**最稳。

> 如果你的对外端口不是 443/80，要带端口：`https://keeper.example.com:8443`。末尾不要加 `/`，服务端会自动 trim。

### 1.2 可选：调整 `TRUST_PROXY`（仅特殊拓扑需要）

容器内 Express 默认信任：`loopback, linklocal, uniquelocal`。这覆盖三种最常见情况：

- nginx 和 docker 跑在同一台机器（`127.0.0.1` / `::1`）
- nginx 容器 ↔ keeper 容器，走默认 docker bridge（`172.16/12`、`10/8`）
- 同 LAN 内透代

只有当你的反代位于这些范围之外时（比如 nginx 在另一台公网机，通过公网 IP 直连容器宿主机的 3093）才需要在 `.env` 里覆盖：

```dotenv
# 选一个最贴近你拓扑的：
TRUST_PROXY=1                    # 信任最近一跳（最常见的"单层反代"写法）
TRUST_PROXY=10.0.0.0/8,1.2.3.4   # 显式 CIDR + IP 白名单
TRUST_PROXY=true                 # 全部信任（仅在你确认整条链路都可信时使用）
```

⚠️ **不要无脑写 `true`**：那样客户端可以伪造 `X-Forwarded-For` / `X-Forwarded-Proto`，污染 `req.ip` 与生成的图片 URL scheme。

### 1.3 重启容器让环境变量生效

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\rebuild.ps1
```

```bash
# Linux / macOS
bash ./rebuild.sh
```

或者只重起不重建：`docker compose -p keeper-coc-trpg up -d`。

---

## 2. nginx site 配置样例

### 2.1 标准 HTTPS 子域（最常见）

把它放进 `/etc/nginx/sites-available/keeper.example.com.conf`，然后 `ln -s` 进 `sites-enabled/`，`nginx -t && systemctl reload nginx`。

```nginx
# HTTP -> HTTPS 强跳
server {
    listen 80;
    listen [::]:80;
    server_name keeper.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name keeper.example.com;

    ssl_certificate     /etc/letsencrypt/live/keeper.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/keeper.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # 服务端用 express.json({ limit: "10mb" })。nginx 默认 client_max_body_size
    # 是 1m，画图返回大 b64 / 完整存档导出会被截断。给到 12m 留余量。
    client_max_body_size 12m;

    # LLM 长响应、画图、首屏 JS bundle 都比较大，把代理 buffer 调宽。
    proxy_buffering            off;
    proxy_request_buffering    off;
    proxy_http_version         1.1;

    # 画图 / LLM 单次请求可能要 60s+，nginx 默认 60s 不够。
    proxy_connect_timeout      30s;
    proxy_send_timeout         600s;
    proxy_read_timeout         600s;

    # 把"客户端真实身份 + 反代信息"补齐 — 服务端 trust proxy 默认已经覆盖
    # loopback / linklocal / uniquelocal，所以同机部署这一组头会被自动采纳。
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;

    # 容器对外端口（docker-compose.yml 里默认 3093:3000）。
    location / {
        proxy_pass http://127.0.0.1:3093;
    }
}
```

### 2.2 子路径挂载（如 `/keeper/`）

⚠️ **不推荐**。本项目前端用相对路径请求 API（`/api/...`、`/cache/images/...`），但 Vite 构建产物里也是相对根的。子路径挂载需要改 `vite.config.ts` 的 `base` 选项 + 把所有 `fetch("/api/...")` 改成 `fetch(import.meta.env.BASE_URL + "api/...")`，工程量比起一个独立子域大得多。

如果你确实只能挂子路径，最务实的办法是：**用一个独立子域**（比如 `keeper.<your-main-domain>`），由 nginx 在外层做托管，不要走 `/keeper/`。

### 2.3 Cloudflare 在最前面

如果对外是 Cloudflare → nginx → 容器的双层反代：

- nginx 站点配置不用变，仍然按 2.1 写。
- Cloudflare 默认会注入一组 `CF-Connecting-IP` / `X-Forwarded-For`。Express 默认 trust proxy 会把"最近一跳 = nginx"当成可信源，因此最终 `req.ip` 看到的会是 nginx 注入的 `X-Forwarded-For` 头里的客户端 IP。
- 如果你想让 `req.ip` 直接看 Cloudflare 注入的真实 IP，把 `TRUST_PROXY=2`（信任最近两跳）写进 `.env`。

---

## 3. 验证清单（跑通后逐条勾）

```powershell
# 1. 容器健康
docker compose -p keeper-coc-trpg ps              # 状态应该是 healthy
curl https://keeper.example.com/                  # 返回 SPA 的 index.html

# 2. /api/public-config 返回的就是你写进 .env 的那个 URL
curl https://keeper.example.com/api/public-config
# -> {"imagePublicBaseUrl":"https://keeper.example.com"}

# 3. 静态线索图通道工作
curl -I https://keeper.example.com/cache/images/<some-sha>.png
# -> 200 OK + Cache-Control: public, max-age=...

# 4. 浏览器开 devtools，打开你的站点，进入「虚空连接的设置」
#    - 模型列表能拉到（说明 /api/models 通）
#    - 进游戏，触发一次画图：图能加载、刷新页面后还能加载
```

如果第 4 步刷新后图裂了 → 99% 是 `IMAGE_PUBLIC_BASE_URL` 与对外 URL 不一致。打开 devtools console 应该能看到 `[publicConfig]` 相关 warn。

---

## 4. 常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| 画图首次出现正常，刷新后裂图 | 客户端 localStorage 存的是 `http://localhost:3093/cache/...`，跟对外域名不匹配，被白名单丢弃 | `.env` 写 `IMAGE_PUBLIC_BASE_URL=https://...`，`rebuild` 重起，**清掉浏览器 localStorage**（白名单变化前的旧 URL 不会自动迁移） |
| LLM 请求 504 / 502 | nginx 默认 `proxy_read_timeout` 是 60s，长 LLM 思考会被掐 | 按 §2.1 把 `proxy_read_timeout / proxy_send_timeout` 调到 600s |
| 画图 b64 上传 / 大存档导出 413 Payload Too Large | nginx `client_max_body_size` 默认 1m，本项目服务端是 10m | `client_max_body_size 12m;` |
| 子路径反代后白屏 / 资源 404 | Vite 构建出来的 asset 引用是 `/assets/xxx.js`，被打到子路径外 | 改用独立子域（见 §2.2） |
| 进游戏一切正常但 `/api/mcp/status` 卡 5s 超时 | NyaaChat-MCP 服务（`h.hony-wen.com:3094`）从你的服务器出不去 | 这条不影响游戏，本地兜底骰会接管；想用真随机骰要确保容器有出网到 MCP 的能力 |
| `req.ip` 全是 `127.0.0.1` / `::ffff:127.0.0.1` | nginx 在同机但你设了 `TRUST_PROXY=false`，X-Forwarded-* 不被信任 | 留空走默认值，或者明确写 `TRUST_PROXY=1` |

---

## 5. 安全提示

- **永远不要 `TRUST_PROXY=true`** 除非你的反代在受控边界内（VPC / 同机 / Cloudflare + 强制对接 IP 白名单）。否则任意客户端都能伪造 `X-Forwarded-*` 投毒 `req.ip` 与图片 URL scheme。
- 反代层做不做 basic auth / IP 白名单完全是部署者的事，本项目本身**没有**用户系统、没有鉴权——任何能访问到对外 URL 的人都可以开始游戏并消耗其本地配置的 LLM key。如果你不想让陌生人访问，自行在 nginx 加 `auth_basic` 或 `allow / deny`。
- LLM API Key 存在浏览器 localStorage（不是服务端），所以反代层不会泄露任何后端密钥；但客户端用户自己填进去的 Key 会随每次请求经反代发到上游 LLM 服务，**反代日志不要记录 request body**。

---

## 6. 相关文件 / 进一步阅读

- [`server.ts`](../server.ts) `app.set('trust proxy', ...)` 与 `resolveImagePublicBaseUrl` 是反代支持的全部代码面
- [`docker-compose.yml`](../docker-compose.yml) `IMAGE_PUBLIC_BASE_URL` / `TRUST_PROXY` 环境变量透传位置
- [`.env.example`](../.env.example) 两个变量的完整含义和取值说明
- [`src/lib/publicConfig.ts`](../src/lib/publicConfig.ts) 客户端 imagePublicPrefix 白名单逻辑
- 项目根 [`CLAUDE.md`](../CLAUDE.md) 的「画图统一规范」第 3 条 — 解释为什么 IMAGE_PUBLIC_BASE_URL 是硬约束
