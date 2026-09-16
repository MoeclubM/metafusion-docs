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

- **Base URL**：`/api`（网关统一透传至目录服务 `backend:8080`；账号、互动、存储是各自独立的服务）
- **OpenAPI 规范**：[GET /api/openapi.json](/api/openapi.json)（OpenAPI 3.0.3）。它只覆盖**目录服务**的 paths 与 schemas；
  账号、互动、存储各自实现自己的前缀，目前没有机器可读的 OpenAPI
- **交互式文档**：[Scalar (/api/docs)](/api/docs)、[Swagger UI (/api/swagger)](/api/swagger)
- **认证**：会话 Cookie `mf_session`，或 `Authorization: Bearer <token>`。令牌由账号服务签发（RS256），目录服务只验签、不查库、不签发
- **请求体**：JSON；未知字段一律拒绝（`400 invalid_payload`），体积上限 2 MiB
- **响应**：统一 JSON；错误统一为 `{ "error": "<机器码>" }`
- **限流**：目录服务只对少数重型读接口限流（见下，超限返回 `429 { "error": "rate_limited" }` 并带 `Retry-After` 秒数）；
  网关对全部 `/api/` 前缀另有按 IP 的速率限制，那一层的 `429` 由 nginx 直接返回，**不带 `Retry-After`**。全站都**不存在 `X-RateLimit-*` 响应头**

## 能力分组

| 能力 | 真实端点 | 认证 |
|---|---|---|
| 动态定义 | `GET /api/catalog/definitions` | 开放 |
| 实体查询 | `GET /api/catalog/entities`（`q` / `kind` / `kinds` / `type` / `types` / `status` / 关联 id / `field` + `value` / `tags` / `limit` / `offset`） | 开放 |
| 实体详情 | `GET /api/catalog/entities/:id`、`/resolve`、`/relations`、`/occurrences`、`/revisions` | 开放 |
| 批量表达详情 | `POST /api/catalog/expressions/details`（发行页一次取多条表达与收录） | 开放 |
| 写入 | `POST /api/catalog/entities`、`PUT /api/catalog/entities/:id` | 需登录；`catalog.entity.edit` 决定能否协作维护他人/公开条目与直接发布，无此码者只能存 `draft` / `pending_review` |
| 关系写入 | `POST /api/catalog/relations`、`PUT|DELETE /api/catalog/relations/:id` | `catalog.relation.edit` |
| 生命周期 | `POST /api/catalog/entities/:id/lifecycle`（合并 / 退役） | `catalog.lifecycle.manage` |
| 发行对比 | `GET /api/catalog/compare?ids=a,b`（2–6 个 Release） | 开放 |
| 标签聚合 | `GET /api/catalog/tags`（按已发布实体的 `attributes.tags` 统计频次） | 开放 |
| 货架 | `GET /api/catalog/shelves`、`GET /api/catalog/shelves/feed` | 开放 |
| 外部权威库 | `GET /api/catalog/external-databases` | 开放 |
| 首页偏好 | `GET|PUT /api/catalog/me/home-preferences` | 需登录 |
| 定义版本管理 | `GET|POST /api/admin/catalog-definitions`、`/{id}`、`/{id}/diff|impact|publish|rollback` | `catalog.definitions.manage` |
| 货架规则管理 | `/api/admin/shelves`（含 `/{id}` 读写删） | `catalog.shelves.manage` |
| 外部库管理 | `/api/admin/external-databases`（含 `/{code}` 读写删） | `catalog.definitions.manage` |
| 实例间交换 | `GET /api/exchange/entities/:id`、`POST /api/exchange/proposals` | 提案需登录 |
| 外部导入 | `POST /api/importer/preview`、`POST /api/importer/import` | `catalog.import.submit` |
| 账号与 OAuth | `/api/setup`、`/api/auth/*`、`/api/oauth/*`、`/api/developer/*`（开发者中心） | 见 [认证与凭证](/api-auth) |
| 收藏与社区 | `/api/favorites/*`、`/api/community/*`、`/api/records/*`（后者需登录） | 读开放、写需登录 |
| 资源文件 | `/api/storage/*` | 见 [资源直传与预签名下载](/api-storage) |

## 访问模型

- **元数据开放**：`/api/catalog/*` 的读接口无需鉴权，可被搜索引擎收录
- **写入受控**：实体写入只需登录（无 `catalog.entity.edit` 时提交的状态被收敛为 `draft` / `pending_review`，见 [新建与编辑](/api-edit)）；合并 / 退役另需 `catalog.lifecycle.manage`
- **未发布内容不公开**：`draft` / `pending_review` 只有创建者（与持生命周期权限者）能读；`deleted` / `merged` 只有创建者能直读

## 分页与排序

- 分页参数是 `limit` / `offset`：**`limit` 默认 50、上限 100，越界时静默按 50 处理**（不报错）
- 列表响应为 `{ "items": [...], "total": <真实 COUNT> }`
- 默认排序 `updated_at DESC, id`；按关联 id 查询结构子项（`release_id` / `medium_id` / `content_unit_id` / `parent_id`）时按 `position` 升序
- 展开参数（MusicBrainz 的 `inc=`）与 `page` / `page_size` 分页都不存在：需要关联数据就分别调 `/relations`、`/occurrences` 或用关联 id 过滤

## 限流

目录服务的路由级限流按 IP + 路由、进程内存固定窗口计数：

| 路由 | 上限 |
|---|---|
| `GET /api/catalog/entities` | 120 / 分钟 |
| `GET /api/catalog/tags` | 120 / 分钟 |
| `POST /api/catalog/expressions/details` | 120 / 分钟 |
| `GET /api/catalog/shelves/feed` | 60 / 分钟 |
| `GET /api/catalog/compare` | 10 / 分钟 |
| `POST /api/importer/preview` | 10 / 分钟 |

写接口（实体、关系、生命周期）没有路由级限流，但仍受网关按 IP 的 `30 r/s`（burst 50）约束；
`/api/auth/` 与 `/api/setup` 另按 `5 r/s` 限流；`/api/storage/` 同样受 `30 r/s` 约束，只是因为分片上传天然是多请求而把 burst 放大到 100。
目录服务的路由级限流超限返回 `429 { "error": "rate_limited" }` 并带 `Retry-After`（秒）；
网关自身的限流由 nginx 直接返回 `429`（`limit_req_status 429`），响应体不是目录服务的错误 JSON。

## 错误码

写入与查询失败的机器码是稳定契约（HTTP 状态码 + `error` 字段）：

| 状态码 | `error` | 含义 |
|---|---|---|
| 400 | `invalid_payload` | JSON 形状错误，或含未知字段（服务端拒绝未知字段） |
| 400 | `invalid_id` | 路径上的 UUID 解析失败 |
| 400 | `evidence_required` | 写入没带 `edit_note` 或 `sources` |
| 400 | `invalid_source` | `sources` 项不合法：`kind` 只接受 `url` / `publication` / `self`，`citation` 不能为空，`url` 必须是合法链接 |
| 400 | `invalid_reference` | 引用的实体不存在、kind 不符或对调用者不可见 |
| 400 | `constraint_violation` | 违反库内约束（复合外键、唯一索引等） |
| 400 | `immutable_scope` | 改动了不可变归属：`kind` / `work_id` / `release_id` / `medium_id` |
| 400 | `use_lifecycle_endpoint` | 试图用实体写入把已发布条目降级，或直接设成 `deleted` / `merged` |
| 400 | `translation_required` | 发布时一条 `translations` 都没有 |
| 400 | `four_locale_names_required` | 定义文档 / 货架 / 外部权威库里的名称缺语种：`error` 形如 `four_locale_names_required: zh-TW,ja-JP`，冒号后是缺失的语种 |
| 400 | `field_not_searchable` / `unknown_field` | `field` 过滤的字段未声明、链路含停用字段，或字段不存在 |
| 400 | `invalid_relation_type` / `invalid_endpoints` / `invalid_endpoint_types` / `duplicate_relation` / `cardinality_exceeded` / `relation_cycle` | 关系写入的语义校验失败（见 [新建与编辑](/api-edit)） |
| 400 | `invalid_merge_target` | 合并目标不是同 kind、同归属的已发布实体 |
| 400 | `compare_requires_two_to_six` | 对比的 `ids` 少于 2 个或多于 6 个（`/compare` 只接 Release，非 Release 报 `invalid_kind`） |
| 401 | `authentication_required` | 需要登录的端点未带有效令牌 |
| 403 | `forbidden` | 已登录但缺对应权限码（或不是这条数据的可写者） |
| 404 | `not_found` | 不存在，或对调用者不可见（不区分「不存在」与「无权限」） |
| 409 | `version_conflict` | `expected_version` 与当前版本不一致：重读实体后再写 |
| 429 | `rate_limited` | 命中目录服务的路由级限流，读 `Retry-After` 退避（网关自身的 429 无该头，也不带此 JSON 体） |
| 500 | `database_error` | 服务端数据库故障（不透出 SQL 细节） |

## 实体状态与可见性

| 状态 | 含义 | 可见性 |
|---|---|---|
| `draft` | 草稿（新建时的默认状态） | 创建者 + 持生命周期权限者 |
| `pending_review` | 待审（外部提案落在这里） | 同上 |
| `published` | 已发布，公开展示 | 所有人 |
| `deleted` | 已退役 | 创建者可直读 |
| `merged` | 已合并，`redirect_id` 指向保留实体 | 创建者可直读；用 `GET /api/catalog/entities/:id/resolve` 取到保留实体 |

列表接口的可见性口径：匿名只看 `published`；登录用户看 `published` 加自己创建的全部条目；持 `catalog.lifecycle.manage` 看全量（`deleted` / `merged` 除外）。

## 下一步

- [认证与凭证](/api-auth)：会话令牌、OAuth 2.0 / OIDC 与开发者中心
- [实体查询与详情](/api-entities)：`/api/catalog/entities` 的过滤、详情与关联
- [新建与编辑](/api-edit)：写入 DTO、乐观锁、关系与生命周期
