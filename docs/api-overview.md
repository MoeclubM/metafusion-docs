---
title: "API 概览"
description: "开发者与 Agent 的接入顺序、能力索引、可见性、限流和错误处理。"
order: 10
group: "api"
---

# API 概览

MetaFusion 使用统一的 `/api` 入口。实体种类通过 `kind` 区分，所有实体共用查询、详情和写入端点。

## 接入顺序

1. 确认目标实例的根地址，读取 `GET /api/openapi.json`。
2. 读取 `GET /api/catalog/definitions`，获取字段、词项、结构和关系规则。
3. 查询实体并解析合并身份，按需要读取目录、收录或关系。
4. 需要写入时配置凭据、检查权限，提交说明、来源和当前版本。
5. 按分页标记继续查询；按 HTTP 状态和机器错误码处理失败。

公开数据可匿名查询。完整接口形状以目标实例为准，本文示例不代表某实例已有对应数据。

## 契约与凭据

| 入口 | 用途 |
| --- | --- |
| `GET /api/openapi.json` | 目录服务的 OpenAPI 3.0.3，公开读取 |
| `GET /api/catalog/definitions` | 当前定义、固定 kind 名与 `relationship_rules` |
| `GET /api/version` | 目录服务版本 |
| `GET /api/capabilities` | 已配置的外围能力声明，不能代替健康检查 |

本站目录规范：[OpenAPI JSON](https://findverse.cc/api/openapi.json)。账号、社区和存储协议分别见对应 API 页面，目录 OpenAPI 不覆盖其全部端点。

请求使用 JSON。目录服务拒绝未知字段，请求体上限 2 MiB。响应通常为 JSON，错误形状为 `{"error":"<code>"}`；网关拦下的响应可能使用其他格式。

认证支持 `Authorization: Bearer <token>` 和会话 Cookie `mf_session`。会话、OAuth 和 PAT 的选择及有效权限见[认证与凭证](/api-auth)。目录权限只按令牌中的 `permissions` 判定。

交互文档 `/api/docs` 与 `/api/swagger` 需要登录及 `catalog.lifecycle.manage`，第三方接入直接使用公开 OpenAPI。

## 能力索引

| 要完成的任务 | 端点 | 详细契约 |
| --- | --- | --- |
| 查找与筛选实体 | `GET /api/catalog/entities` | [实体查询与详情](/api-entities)、[检索](/api-search) |
| 获取实体详情与当前版本 | `GET /api/catalog/entities/:id` | [实体查询与详情](/api-entities) |
| 跟随合并与批量解析身份 | `GET .../:id/identity`、`POST /api/catalog/entities/identity` | [实体查询与详情](/api-entities) |
| 遍历可见的直接关系与属性引用 | `GET .../:id/links`、`POST /api/catalog/relationships/query` | [实体查询与详情](/api-entities) |
| 读取语义关系与实际收录 | `GET .../:id/relations`、`.../:id/occurrences` | [实体查询与详情](/api-entities) |
| 读取发行目录、表达组成与版本组 | `GET /api/catalog/releases/:id/toc`、`.../:id/editions`、`GET /api/catalog/expressions/:id/composition` | [实体查询与详情](/api-entities) |
| 批量表达与对比 | `POST /api/catalog/expressions/details`、`GET /api/catalog/compare` | [实体查询与详情](/api-entities) |
| 新建、编辑、关系与单条收录 | `/api/catalog/entities`、`/relations`、`/tracks/:id/contents` | [新建与编辑](/api-edit) |
| 合并、停用与下架 | `POST .../:id/lifecycle`、`.../:id/unpublish` | [新建与编辑](/api-edit) |
| 外部导入与实例交换 | `/api/importer/*`、`/api/exchange/*` | [新建与编辑](/api-edit) |
| 定义、货架与外部库配置 | `/api/admin/catalog-definitions`、`/shelves`、`/external-databases` | [动态定义与配置](/api-definitions) |
| 收藏、讨论、私信与举报 | `/api/community/*`、`/api/favorites/*`、`/api/messages/*` | [社区与互动 API](/api-community) |
| 上传、绑定和读取文件 | `/api/storage/*` | [存储上传与下载](/api-storage) |
| 第三方授权登录 | `/api/oauth/*`、`/api/oidc/*` | [第三方站点接入 OAuth 授权](/oauth-integration) |
| Agent 技能与工具接入 | 复用上述 API | [AI Agent API 与工具规范](/api-agent) |

用户主页资料、互动统计和目录贡献分别使用 `/api/users/:id`、`.../:id/stats`、`.../:id/contributions`。分别见认证、社区和实体查询页面。

## 状态与可见性

| 状态 | 详情可见性 |
| --- | --- |
| `published` | 所有人 |
| `draft` / `pending_review` | 创建者和具有生命周期管理权限的人 |
| `deleted` / `merged` | 创建者和具有生命周期管理权限的人可直读；合并身份使用 `identity` 或 `resolve` |

普通列表排除 deleted / merged。关系、收录和历史响应还会过滤不可见端点与引用；公开响应不能当作全库备份。

写入需要登录。没有 `catalog.entity.edit` 时，只能维护自己的未发布条目并保存为 draft / pending_review。关系、生命周期和定义管理各有权限码，见[新建与编辑](/api-edit)。

## 分页与查询完整性

实体列表 limit 默认 50、范围 1–100，offset 默认 0；非法值返回 400。page 为从 1 起的便捷写法，与 offset 互斥。无关键词浏览的 `total` 来自数据库计数；关键词查询的计数与深分页按[检索](/api-search)契约处理。

统一关系查询逐主体分页。只有完成所有页、没有不可用主体并处理定义变化后，才能声明对应可见范围的直接关系已读完。递归图谱需要调用方维护待查队列与已访问集合。

关系摘要只能用于展示和继续查询；编辑前重新获取实体详情及当前 version。详情也可能裁剪不可见引用，尤其是 Track 的 contents；回读成功不代表可以无损整实体写回，见[实体详情](/api-entities#实体详情)。

## 限流

目录重型读接口默认按「账号 + 路由」计数，匿名按「客户端 IP + 路由」计数。额度优先级为账号、用户组、全局配置、路由内置值；多组命中取最宽松规则。

| 路由 | 内置默认额度 / 分钟 |
| --- | --- |
| 实体列表、标签、实体统计、links、批量 identity、批量表达、toc、editions、composition、贡献流、请求日志 | 120 |
| `POST /api/catalog/relationships/query`、`GET /api/catalog/shelves/feed` | 60 |
| `GET /api/catalog/compare`、`POST /api/importer/preview` | 10 |
| `GET /api/notifications/unread-count` | 300 |

受限路由响应带 `X-RateLimit-Limit`、`X-RateLimit-Remaining`、`X-RateLimit-Reset`（距重置的秒数）；超限为 429，并带 `Retry-After`。实例策略可覆盖默认额度，配置为不限时不发这组窗口头。管理协议见[动态定义与配置](/api-definitions)。

网关另按 IP 限流；被网关拦下的 429 不带上述窗口头。计数当前在各目录进程内独立，客户端应以实际响应判断额度，并在缺少 Retry-After 时采用退避。

## 常见错误处理

| HTTP / error | 调用方处理 |
| --- | --- |
| 400 `invalid_payload` | 核对字段、参数与当前 schema，避免重放同一错误载荷 |
| 400 `invalid_limit` / `invalid_offset` / `invalid_page` / `pagination_conflict` | 修正分页值，避免组合互斥参数 |
| 400 `invalid_reference` | 核对 kind、归属、可见性与合并身份 |
| 400 `evidence_required` / `invalid_source` | 补充修改说明与可核验来源 |
| 401 `authentication_required` / `invalid_token` | 获取有效凭据；PAT 不会因失效退为匿名 |
| 403 `forbidden` | 核对账号权限、令牌 scopes 与条目可写范围 |
| 404 `not_found` | 不存在或不可见，不能进一步区分 |
| 409 `version_conflict` | 回读并合并修改，再用最新版本或 ETag 提交 |
| 409 `idempotency_conflict` | 同一幂等键对应了不同载荷；核对任务身份，勿盲目换键重复创建 |
| 429 `rate_limited` | 按 Retry-After 等待，减少并发与重复请求 |
| 5xx | 视为服务或依赖故障；不能当作实体缺失或零命中 |

写入与关系的具体语义错误见[新建与编辑](/api-edit)，Agent 的处理策略见[AI Agent API 与工具规范](/api-agent)。
