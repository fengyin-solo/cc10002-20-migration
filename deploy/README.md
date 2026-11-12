# 部署说明：反向代理子路径

前端从“仅根路径运行”迁移为“可配置的反向代理子路径部署”，本地开发体验不变。

## 基准约定

| 关注点 | 基准 | 说明 |
| --- | --- | --- |
| 部署入口 | `/metric-insight/` | 由构建期 `VITE_BASE_PATH` 决定，见 `frontend/.env.production` |
| 静态资源 | `/metric-insight/assets/<hash>` | 内容哈希命名，`immutable` 长缓存 |
| 浏览器路由 | `/metric-insight/<route>` | `BrowserRouter basename` 与 base 一致，深链接/刷新由 SPA fallback 兜底 |
| API 地址 | `/api/...`（根路径） | 与前端前缀相互独立，由反代转发后端，不写死机器 |

本地开发（`npm run dev`）不设置 `VITE_BASE_PATH`，仍是 `http://127.0.0.1:5173/` 根路径访问。

## 历史 URL 映射（旧根入口 → 新前缀入口）

| 旧 URL | 新 URL | 方式 |
| --- | --- | --- |
| `/` | `/metric-insight/` | 301 |
| `/lineage`、`/segment` 等前端路由 | `/metric-insight/lineage`、`/metric-insight/segment` | 301，保留查询串 |
| `/assets/<旧hash>` | 原地继续发（`legacy/` 目录） | 过渡期保留旧构建资源 |
| `/api/...` | 不变 | 始终根路径，新旧入口共用 |

## 缓存隔离

- `index.html`：`Cache-Control: no-cache`，每次回源校验，旧入口缓存不会配上新资源；
- `assets/<hash>`：`Cache-Control: public, max-age=31536000, immutable`，内容寻址，新旧版本文件名不冲突；
- 历次发布的哈希资源汇入共享池 `assets-pool/` 统一发放：`current` 切换到新版本后，
  缓存中的旧入口页面仍能拉到配套旧资源，新旧版本资源交错共存，不会半新半旧；
  池内只保留仍被保留版本引用的文件，随旧版本清理自动对齐；
- 旧构建资源放在部署根 `legacy/assets/` 下过渡，浏览器里缓存的旧页面仍能完整打开；
  过渡期结束后清空 `legacy/` 并删除 nginx 中 `/assets/` 一段即可。

## 发布（幂等 + 原子切换）

```bash
cd frontend && npm run build          # 产出 dist/（按 .env.production 的前缀）
../deploy/deploy.sh dist /srv/metric-insight-web
```

- 版本号缺省取 dist 内容哈希：**同一内容重复部署是 no-op**；
- 切换前校验 `index.html` 引用的全部资源已就位，**资源不齐则保持旧版本完整在线**；
- 入口用 `current` 软链原子替换，任何时刻线上都是完整一致的某一个版本；
- 旧版本保留 `KEEP_RELEASES` 个（默认 5），回滚 = 把 `current` 指回旧版本目录。

## 首次迁移步骤

1. 把旧根构建的 `assets/` 拷到 `/srv/metric-insight-web/legacy/assets/`（过渡期保留）；
2. 按 `nginx.conf` 配置站点（裸机把 `${API_UPSTREAM}` 换成实际后端 host:port）；
3. `deploy.sh` 发布新版本，验证下表后通知各端更新书签。

## 验收清单

以数据血缘、人群圈选两页贯穿（本地可用 `local-verify-server.mjs` 复刻 nginx 语义）：

```bash
node deploy/local-verify-server.mjs --webroot /srv/metric-insight-web --port 8080
```

| 场景 | 预期 |
| --- | --- |
| `GET /metric-insight/lineage`（深链接直接进入） | 200，入口 HTML，`no-cache` |
| `GET /metric-insight/segment`（圈选页刷新） | 200，入口 HTML |
| 两页之间导航 | 客户端路由，资源同源同前缀 |
| `GET /metric-insight/assets/<hash>.js` | 200，`immutable` |
| `GET /api/lineage` | 200 JSON，反代到后端（不是 `/metric-insight/api/...`） |
| `GET /lineage`（旧链接） | 301 → `/metric-insight/lineage` |
| `GET /segment?x=1`（旧链接带查询） | 301 → `/metric-insight/segment?x=1` |
| `GET /assets/<旧hash>` | 200（legacy 过渡期） |
| 重复执行 `deploy.sh` 同一版本 | no-op，`current` 不变 |
| 资源缺失的 dist 执行 `deploy.sh` | 报错中止，`current` 不变 |

## 容器化

```bash
docker compose --profile prod up frontend-prod   # http://127.0.0.1:8080/metric-insight/
```

`frontend/Dockerfile.prod` 多阶段构建：node 阶段按 `.env.production` 出包，
nginx 阶段用环境变量 `API_UPSTREAM` 渲染 `deploy/nginx.conf` 模板，后端地址不进镜像。
