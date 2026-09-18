---
title: "API 概览"
description: "统一 /api 主干：实体查询、详情、写入、定义与导入接口。"
order: 30
group: "api"
---

# API 概览

MetaFusion 的对外接口是一条统一的 `/api` 主干：实体查询、检索、写入、定义管理与外部导入都在同一套端点里。
它**不是** MusicBrainz WS/2 风格的 Lookup / Browse / Search API——没有 `/api/ws/2/*` 兼容层，也没有独立的
`/api/search`、`/api/browse/*`；实体查询与检索统一走 `GET /api/catalog/entities`。

## 基础信息

- **Base URL**：`/api`（单一入口，网关按路径分流到目录、账号、互动、存储四个服务；未单列的前缀兜底给目录服务 `backend:8080`）
- **OpenAPI 规范**：[GET /api/openapi.json](/api/openapi.json)（OpenAPI 3.0.3）。它只覆盖**目录服务**的 paths 与 schemas；
  账号、互动、存储各自实现自己的前缀，目前没有机器可读的 OpenAPI。这是**接入方该看的那一份**：
  它**公开、无需登录**（与 `GET /api/version` 同列公开面）——把端点表藏起来只是隐蔽性、不是访问控制
- **交互式文档**：[Scalar (/api/docs)](/api/docs)、[Swagger UI (/api/swagger)](/api/swagger)。
  这两页是**管理面**：它们在本域里执行脚本，匿名可达等于把整份 API 面连同同源脚本执行面一起交出去，
  因此**需要先登录、且账号要持 `catalog.lifecycle.manage`**（未登录 `401 authentication_required`，
  登录但无码 `403 forbidden`）；页面与它自托管的脚本、样式（`/api/docs/assets/*`）走同一道闸门。
  接入方要读契约请用上面的 `/api/openapi.json`，不要假设这两页对外可达
- **认证**：会话 Cookie `mf_session`，或 `Authorization: Bearer <token>`。会话 / OAuth 令牌由账号服务签发（RS256），目录服务只验签、不查库、不签发；
  另有**个人访问令牌（PAT，`mfp_` 前缀）**供外部应用 / Agent / CI 长期接入——目录侧把它交给账号服务内省判定，见 [认证与凭证](/api-auth)
- **请求体**：JSON；未知字段一律拒绝（`400 invalid_payload`），体积上限 2 MiB
- **响应**：统一 JSON；错误统一为 `{ "error": "<机器码>" }`
- **限流**：目录服务只对少数重型读接口限流（见下，超限返回 `429 { "error": "rate_limited" }` 并带 `Retry-After` 秒数）；
  这些路由的**每个响应**都带 `X-RateLimit-Limit`（窗口上限）、`X-RateLimit-Remaining`（窗口内剩余次数，用尽为 0）、
  `X-RateLimit-Reset`（距窗口重置的秒数），超限的 `429` 同样带这三件套。
  网关对全部 `/api/` 前缀另有按 IP 的速率限制，那一层的 `429` 由 nginx 直接返回，**不带 `Retry-After`、也不带这组头**；
  账号 / 互动 / 存储三个服务自身的限流同样不发 `X-RateLimit-*`

### 网关分流

`/api` 是统一入口，但不同路径归不同服务。`/api/users/*` 是**同一前缀、多个归属**，按精确路径分流：

| 路径 | 归属服务 |
|---|---|
| `GET /api/users/:id` | 账号服务（公开资料） |
| `GET /api/users/:id/stats` | 互动服务（互动统计） |
| `GET /api/users/:id/favorites` | 互动服务（收藏列表） |
| `GET /api/users/:id/contributions` | 目录服务（贡献流） |
| `/api/messages/*` | 互动服务（私信，需登录） |
| `/api/community/*`、`/api/favorites/*`、`/api/records/*` | 互动服务 |
| `/api/storage/*` | 存储服务 |
| `/api/auth/*`、`/api/setup`、`/api/oauth/*`、`/api/oidc/*`、`/api/developer/*`、`/api/admin/{users,groups,permissions,settings,invites,oauth}`、`/.well-known/*` 与 `/api/.well-known/*` | 账号服务 |
| 其余 `/api/*`（含 `/api/catalog/*` 与目录侧 `/api/admin/{catalog-definitions,shelves,external-databases}`） | 目录服务（兜底） |

归属以主仓库 `deploy/nginx.conf` 的生效矩阵为准。

### 管理台（页面路径）

四个管理台是**四个独立应用**，由网关在同一域下按路径聚合；它们的数据请求仍旧走 `/api/*`，由上面的矩阵分流回对应服务：

| 控制台 | 页面路径 | 归属 |
|---|---|---|
| 目录（元数据：实体 / 定义 / 货架 / 外部库 / 导入审核） | `/admin` | 主前端 `frontend/`（主仓库，见 [元数据目录](/catalog)） |
| 账号（用户、权限组、邀请码、实例设置、OAuth 客户端） | `/admin/account/` | `metafusion-auth/admin/`（独立构建与发布） |
| 社区（板块、主题、帖子治理） | `/admin/community/` | `metafusion-community/admin/` |
| 存储（用量总览、资产查询、绑定解绑） | `/admin/storage/` | `metafusion-storage/admin/` |

- 三条两段前缀与主站的 `location /`（含目录控制台 `/admin`）互不重叠：nginx 前缀更长者胜，所以主站的 `/admin` 不受影响
- 不带尾斜杠的裸路径由 `location =` 精确匹配 301 补齐（`/admin/account` → `/admin/account/`），否则会被最宽的 `location /` 兜给主前端、表现为 404
- 它们是**页面路径、不是 `/api/` 路径**：网关只对 `/api/` 下的 location 挂 `limit_req`，因此这四个管理台（与 `/docs` 同类）**不套 `/api/` 的限流口径**——不是漏配，别按 `/api/` 的 30 r/s 去估算或补一条限流
- 管理台自身的访问控制由应用鉴权 + 数据接口上的权限码共同决定（例如账号管理台调 `/api/admin/users` 仍要 `auth.users.manage`）
- **实例设置在管理台里只能读**：账号管理台的「实例与设置」（`/admin/account/instance`，需 `auth.settings.manage`）
  只渲染 `GET /api/admin/settings` 返回的键值，没有写入控件；`PUT /api/admin/settings` 存在且生效，但**没有界面入口**，
  改注册开关 / 邀请策略 / 限流阈值这类设置需要直接调该端点（权限码相同）

## 能力分组

| 能力 | 真实端点 | 认证 |
|---|---|---|
| 动态定义 | `GET /api/catalog/definitions` | 开放 |
| 实体查询 | `GET /api/catalog/entities`（`q` / `kind` / `kinds` / `type` / `types` / `status` / 关联 id / `field` + `value` / `tags` / `limit` / `offset`） | 开放 |
| 实体详情 | `GET /api/catalog/entities/:id`、`/resolve`、`/relations`、`/occurrences`、`/revisions` | 开放 |
| 批量表达详情 | `POST /api/catalog/expressions/details`（发行页一次取多条表达与收录） | 开放 |
| 写入 | `POST /api/catalog/entities`、`PUT /api/catalog/entities/:id` | 需登录；`catalog.entity.edit` 决定能否协作维护他人/公开条目与直接发布，无此码者只能存 `draft` / `pending_review` |
| 关系写入 | `POST /api/catalog/relations`、`PUT\|DELETE /api/catalog/relations/:id` | `catalog.relation.edit` |
| 生命周期 | `POST /api/catalog/entities/:id/lifecycle`（合并 / 退役）、`POST /api/catalog/entities/:id/unpublish`（下架：`published → draft`） | `catalog.lifecycle.manage` |
| 发行对比 | `GET /api/catalog/compare?ids=a,b`（2–6 个 Release） | 开放 |
| 标签聚合 | `GET /api/catalog/tags`（按已发布实体的 `attributes.tags` 统计频次） | 开放 |
| 货架 | `GET /api/catalog/shelves`、`GET /api/catalog/shelves/feed` | 开放 |
| 外部权威库 | `GET /api/catalog/external-databases` | 开放 |
| 首页偏好 | `GET\|PUT /api/catalog/me/home-preferences` | 需登录 |
| 定义版本管理 | `GET\|POST /api/admin/catalog-definitions`、`/{id}`、`/{id}/diff\|impact\|publish\|rollback` | `catalog.definitions.manage` |
| 货架规则管理 | `/api/admin/shelves`（含 `/{id}` 读写删） | `catalog.shelves.manage` |
| 外部库管理 | `/api/admin/external-databases`（含 `/{code}` 读写删） | `catalog.definitions.manage` |
| 实例间交换 | `GET /api/exchange/entities/:id`、`POST /api/exchange/proposals` | 提案需登录 |
| 外部导入 | `GET /api/importer/sources`（只读来源清单）、`POST /api/importer/preview`、`POST /api/importer/import` | `catalog.import.submit` |
| 交互式文档 | `GET /api/docs`（Scalar）、`GET /api/swagger`（Swagger UI） | 需登录 + `catalog.lifecycle.manage`（管理面，不是公开入口） |
| 账号与 OAuth | `/api/setup`、`/api/auth/*`、`/api/oauth/*`、`/api/developer/*`（开发者中心） | 见 [认证与凭证](/api-auth) |
| 用户主页 | `/api/users/:id`、`/api/users/:id/stats`、`/api/users/:id/contributions` | 开放（`email` 字段仅本人可见；资料 / 统计 / 贡献分别见 [认证与凭证](/api-auth)、[社区使用指南](/community-guide)、[实体查询与详情](/api-entities)） |
| 收藏与社区 | `/api/favorites/*`、`/api/users/:id/favorites`、`/api/community/*`、`/api/records/*`（后者需登录） | 读开放；写除登录外还要权限码：发帖与回帖 `community.post.create`、置顶 `community.topic.pin`、板块配置 `community.board.manage`、帖子巡检 `community.post.moderate`（`member` 组默认持有发帖码） |
| 私信 | `/api/messages/with/:id`（GET 读会话、POST 发信） | 需登录 |
| 资源文件 | `/api/storage/*` | 见 [资源直传与预签名下载](/api-storage) |

## 访问模型

- **元数据开放**：`/api/catalog/*` 的读接口无需鉴权，可被搜索引擎收录
- **写入受控**：实体写入只需登录（无 `catalog.entity.edit` 时提交的状态被收敛为 `draft` / `pending_review`，见 [新建与编辑](/api-edit)）；合并 / 退役 / 下架另需 `catalog.lifecycle.manage`
- **未发布内容不公开**：`draft` / `pending_review` 只有创建者（与持生命周期权限者）能读；`deleted` / `merged` 只有创建者能直读

## 分页与排序

- 分页参数是 `limit` / `offset`：**`limit` 默认 50、上限 100，越界时静默按 50 处理**（不报错）
- 列表响应为 `{ "items": [...], "total": <真实 COUNT> }`
- 默认排序 `updated_at DESC, id`；按关联 id 查询结构子项（`release_id` / `medium_id` / `content_unit_id` / `parent_id`）时按 `position` 升序
- 关联数据用 `/relations`、`/occurrences` 或关联 id 过滤取得；分页参数只有 `limit` / `offset` 两个

## 限流

目录服务的路由级限流按 IP + 路由、进程内存固定窗口计数：

| 路由 | 上限 |
|---|---|
| `GET /api/catalog/entities` | 120 / 分钟 |
| `GET /api/catalog/entities/stats` | 120 / 分钟（另需 `catalog.lifecycle.manage`） |
| `GET /api/catalog/tags` | 120 / 分钟 |
| `POST /api/catalog/expressions/details` | 120 / 分钟 |
| `GET /api/catalog/shelves/feed` | 60 / 分钟 |
| `GET /api/users/:id/contributions` | 120 / 分钟 |
| `GET /api/catalog/compare` | 10 / 分钟 |
| `POST /api/importer/preview` | 10 / 分钟 |

写接口（实体、关系、生命周期）没有路由级限流，但仍受网关按 IP 的 `30 r/s`（burst 50）约束；
`GET /api/importer/sources` 只读注册表、不出站抓取，也不额外限流（与 `preview` 的 10 / 分钟无关）；
`/api/auth/` 与 `/api/setup` 另按 `5 r/s` 限流；`/api/storage/` 同样受 `30 r/s` 约束，只是因为分片上传天然是多请求而把 burst 放大到 100。
上表每一行的**所有响应**（含 200 与超限的 `429`）都带 `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`：
`Limit` 是该路由的分钟上限、`Remaining` 是当前窗口还剩几次、`Reset` 是距窗口重置的秒数（据此能算出下一次可用的时刻）；
表外路由不发这组头。目录服务的路由级限流超限返回 `429 { "error": "rate_limited" }` 并带 `Retry-After`（秒）；
网关自身的限流由 nginx 直接返回 `429`（`limit_req_status 429`），响应体不是目录服务的错误 JSON，也没有这组头。

## 错误码

写入与查询失败的机器码是稳定契约（HTTP 状态码 + `error` 字段）：

| 状态码 | `error` | 含义 |
|---|---|---|
| 400 | `invalid_payload` | JSON 形状错误，或含未知字段（服务端拒绝未知字段） |
| 400 | `invalid_id` | 目录侧路径上的 UUID 解析失败（如 `/api/catalog/entities/:id`、`/relations/:id`）；用户主页三条路径 `/api/users/:id`、`/api/users/:id/stats`、`/api/users/:id/contributions` 的非 UUID 一律 `404 not_found` |
| 400 | `evidence_required` | 写入没带 `edit_note` 或 `sources` |
| 400 | `invalid_source` | `sources` 项不合法：`kind` 只接受 `url` / `publication` / `self`，`citation` 不能为空，`url` 必须是合法链接 |
| 400 | `invalid_reference` | 引用的实体不存在、kind 不符或对调用者不可见 |
| 400 | `constraint_violation` | 违反库内约束（复合外键、唯一索引等） |
| 400 | `immutable_scope` | 改动了不可变归属：`kind` / `work_id` / `release_id` / `medium_id` |
| 400 | `use_lifecycle_endpoint` | 试图用实体写入把已发布条目降级，或直接设成 `deleted` / `merged`（停用与合并走生命周期端点；退回 `draft` 走下架端点 `POST /api/catalog/entities/:id/unpublish`，PUT 提交降级一律回这个码） |
| 400 | `translation_required` | 发布时一条 `translations` 都没有 |
| 400 | `four_locale_names_required` | 定义文档 / 货架 / 外部权威库里的名称缺语种：`error` 形如 `four_locale_names_required: zh-TW,ja-JP`，冒号后是缺失的语种 |
| 400 | `field_not_searchable` / `unknown_field` | `field` 过滤的字段未声明、链路含停用字段，或字段不存在 |
| 400 | `invalid_relation_type` / `invalid_endpoints` / `invalid_endpoint_types` / `duplicate_relation` / `cardinality_exceeded` / `relation_cycle` | 关系写入的语义校验失败（见 [新建与编辑](/api-edit)） |
| 400 | `invalid_merge_target` | 合并目标不是同 kind、同归属的已发布实体 |
| 400 | `invalid_status` | 状态机不允许这个动作：下架只接受 `published`（`draft` / `pending_review` 没有可下架的内容，`deleted` / `merged` 是终态），生命周期端点对已 `deleted` / `merged` 的实体也回这个码 |
| 400 | `compare_requires_two_to_six` | 对比的 `ids` 少于 2 个或多于 6 个（`/compare` 只接 Release，非 Release 报 `invalid_kind`） |
| 401 | `authentication_required` | 需要登录的端点未带有效令牌 |
| 401 | `invalid_token` | **带 `mfp_` 前缀的 PAT** 无效 / 已吊销 / 已过期 / 账号被封禁（不细分原因）；形态非法在本地直接拒绝。注意：PAT 坏令牌在**读端点**也返回 401，与会话 / OAuth 令牌的"验签失败按匿名继续"不同 |
| 403 | `forbidden` | 已登录但缺对应权限码（或不是这条数据的可写者）。PAT 的有效权限 = 账号现时权限 ∩ 令牌 scopes，scopes 为空或不够时就是这里 |
| 404 | `not_found` | 不存在，或对调用者不可见（不区分「不存在」与「无权限」）；用户主页三条路径上非 UUID 的 id 也归这里 |
| 409 | `version_conflict` | `expected_version` 与当前版本不一致：重读实体后再写 |
| 429 | `rate_limited` | 命中目录服务的路由级限流，读 `Retry-After` 退避；命中限流的路由每个响应都带 `X-RateLimit-Limit` / `Remaining` / `Reset`（网关自身的 429 无这些头，也不带此 JSON 体） |
| 500 | `database_error` | 服务端数据库故障（不透出 SQL 细节） |
| 503 | `auth_unavailable` | PAT 请求问不到账号服务：内省端点不可达 / 超时 / 服务没配 `AUTH_URL`。这是依赖故障，**重试**而不是换令牌 |

## 实体状态与可见性

| 状态 | 含义 | 可见性 |
|---|---|---|
| `draft` | 草稿（新建时的默认状态） | 创建者 + 持生命周期权限者 |
| `pending_review` | 待审（外部提案落在这里） | 同上 |
| `published` | 已发布，公开展示 | 所有人 |
| `deleted` | 已停用 | 创建者可直读 |
| `merged` | 已合并，`redirect_id` 指向保留实体 | 创建者可直读；用 `GET /api/catalog/entities/:id/resolve` 取到保留实体 |

列表接口的可见性口径：匿名只看 `published`；登录用户看 `published` 加自己创建的全部条目；持 `catalog.lifecycle.manage` 看全量（`deleted` / `merged` 除外）。

降级只有一条通道：`published → draft` 走 `POST /api/catalog/entities/:id/unpublish`（需 `catalog.lifecycle.manage`，同一套证据与乐观锁，同一事务写修订行与 `entity.unpublished` 事件）；`deleted` / `merged` 是终态，要恢复只能新建。

## 下一步

- [认证与凭证](/api-auth)：会话令牌、OAuth 2.0 / OIDC 与开发者中心
- [实体查询与详情](/api-entities)：`/api/catalog/entities` 的过滤、详情与关联
- [新建与编辑](/api-edit)：写入 DTO、乐观锁、关系与生命周期
