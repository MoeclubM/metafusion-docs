---
title: "认证与凭证"
description: "会话、个人访问令牌、注册邀请、账号资料、授权撤回与账号管理。"
order: 20
group: "api"
---

# 认证与凭证

认证由账号服务（`metafusion-auth`）负责。它签发两种令牌：RS256 访问令牌，以及个人访问令牌（PAT，明文前缀 `mfp_`）。

目录、互动、存储验证访问令牌或向账号服务内省 PAT。认证使用 Bearer 或会话 Cookie，没有 `X-API-Key`；PAT scopes 使用权限码。

## 三种凭证

| 凭证 | 获取方式 | 有效期 | 用途 |
|---|---|---|---|
| 会话令牌 / Cookie | `POST /api/auth/login`（或 `/api/auth/register`） | 访问令牌 15 分钟，服务端会话兜底 24 小时 | 网页端与直接调用 API |
| OAuth 2.0 访问令牌 | 授权码经 `POST /api/oauth/token` 兑换 | 以换码响应的 `expires_in` 为准；无 `refresh_token`，到期重新授权 | 第三方站点与 OIDC 接入 |
| 个人访问令牌（PAT） | 登录后在设置页自助创建（`POST /api/auth/tokens`） | 创建时可选到期时间，最长 10 年；不填即永不过期 | 外部应用、Agent、CI 的长期机器接入 |

API 使用 Bearer 访问令牌；网页会话也可通过 `mf_session` Cookie 携带。PAT 只走请求头：

```http
Authorization: Bearer <token>      # 会话令牌 / OAuth 访问令牌 / PAT（mfp_ 前缀）
Cookie: mf_session=<token>         # 会话令牌
```

第三方站点把 MetaFusion 作为授权方接入的完整契约——发现文档、同意页、scope、PKCE、换码与 userinfo、管理端接口、已知限制——见 [第三方站点接入 OAuth 授权](/oauth-integration)。

## 个人访问令牌（PAT）

登录后管理本人的机器接入凭证：

```http
GET    /api/auth/tokens                  # 需登录：列出本人的令牌（含已吊销的，带 active=false）
POST   /api/auth/tokens                  # 需登录：创建；201 响应体是明文唯一出现的地方
DELETE /api/auth/tokens/{id}             # 需登录：吊销本人一张令牌（幂等）
POST   /api/auth/tokens/introspect       # 下游服务内部调用，不是给用户调的
```

### 明文与存储

明文是 `mfp_` 前缀 + 43 个 base62 字符，只在创建响应的 `token` 字段出现一次；元数据在 `item` 中。列表用 `token_prefix`（前 12 字符）指认令牌，不返回明文或哈希。丢失后只能吊销重建。

### 创建与 scopes

创建请求体：`{ "name": "…", "scopes": ["…"], "expires_in_days": 0 }`。

- `name` 必填（≤64 字，不必唯一）。
- `expires_in_days` 省略或为 0 表示永不过期；负数或超过 3650（10 年）返回 `400 invalid_expiry`。
- `scopes` 是权限码（`catalog.entity.edit` 这类），不是 `read` / `write` 词表。
- 每个码须格式合法且创建者当前持有；超出本人权限返回 `scope_not_granted: <code>`，不会静默取交集。
- 非法码返回 `invalid_scope: <code>`；重复项去重并保持请求顺序。
- scopes 必须非空；省略、空数组或去除空白后为空，返回 `invalid_scope: empty`。

### 有效权限与限额

- 实际权限 = 账号现时权限 ∩ 令牌 scopes，由内省重新计算。交集可以为空：此时令牌仍标识账号，但不能通过任何权限码闸门；没有角色兜底。
- 每个账号未吊销的令牌最多 10 张，超出返回 `token_limit_reached`（已吊销的不占额度）。

### 到期与吊销

- `DELETE /api/auth/tokens/{id}` 幂等吊销，列表仍保留该令牌并标为 `active=false`。
- 别人的或不存在的一律 `token_not_found`——两种情况不区分，避免探测。

::: warning 吊销不是立即生效
下游服务缓存内省结果至多 60 秒，吊销、权限收回与封禁可能延迟至下一次内省才生效。缓存不会超过令牌自身的 `expires_at`，到期不会因缓存而延长。
:::

### 使用方式与错误码

```http
Authorization: Bearer mfp_…
```

- 只支持 `Authorization: Bearer`，没有 `X-API-Key` 认证方式。
- 带 `mfp_` 前缀的 Bearer 以它为准，不会回落到 Cookie：浏览器里同时存在别人的 `mf_session` 也不会被当成身份，PAT 请求不写任何 Cookie。
- 无效、已吊销、已过期或账号被封禁返回 `401 {"error":"invalid_token"}`，不区分原因；形态非法时在下游直接拒绝。
- 账号服务不可达或未配置返回 `503 {"error":"auth_unavailable"}`。这是依赖故障，结论不缓存；等待恢复，不要当成凭据无效而换令牌。
- PAT 不能用于 `/api/auth/*` 的自助会话端点，返回 `401 authentication_required`；创建、列出和吊销 PAT 使用会话令牌。

### 覆盖面

PAT 可用于下游服务，仍受账号现时权限与 scopes 限制：

- 目录：`/api/` 的兜底前缀，含 `/api/catalog/*`、`/api/importer/*`、`/api/exchange/*`
- 互动：`/api/community/*` 等
- 存储：`/api/storage/*`

### 安全建议

- 明文只显示一次：立刻存进环境变量或密钥管理器，不要粘贴进聊天、Issue、配置文件或提交历史。泄漏时第一步是吊销（在设置页，或 `DELETE /api/auth/tokens/{id}`）。
- scopes 取最小必要：一张令牌只给一个用途需要的权限码。给 CI 与本地脚本各建一张，便于单独吊销。
- 长期令牌不会自动过期：给外部集成设一个到期时间并定期轮换。
- 排障时用 `token_prefix` 指认令牌，不记录明文或哈希。

## 注册与实例准入

```http
GET  /api/auth/settings   # 未登录可读：实例准入能力（registration_enabled / invite_required 等）
POST /api/auth/register   # { username, email?, password, invite_code? }，成功即签发令牌
```

- 是否开放注册是持久化的实例设置，不是代码常量。`registration_enabled` 默认关闭，关闭时注册返回 `registration_closed`；由管理员用 `PUT /api/admin/settings`（需 `auth.settings.manage`）打开。
- 实例设置的读取在账号管理台「实例与设置」（`/admin/account/instance`，同样需 `auth.settings.manage`）。该页只读：只渲染接口返回的键值（后端新增设置项不用改页面）。
- 管理台没有写入控件：改注册开关 / 邀请策略 / 限流阈值这类设置，只能直接调 `PUT /api/admin/settings`。
- 打开后若 `invite_required` 为真，请求必须带有效 `invite_code`：

| 情况 | 错误码 |
|---|---|
| 缺失 | `invite_required` |
| 无效 / 已撤销 / 过期 | `invalid_invite_code` |
| 次数用尽 | `invite_exhausted` |

- 用户名 2–80 字符且不含空白，密码 12–72 字符；用户名或邮箱被占用返回 `username_or_email_taken`。
- 邮箱可省略，服务端按 `<用户名>@<默认域>` 补占位地址；新账号进 `registration_default_groups`（默认 `member` 组）。
- `require_email_verification` 目前恒为 `false`（邮件通道未接入）。
- 成功响应 `{ access_token, token_type, expires_in, user }`：`expires_in` 默认 900，并写入 HttpOnly Cookie `mf_session`。

### 首次部署初始化

```http
GET  /api/setup   # { needed, is_initialized, has_admin }：是否还需要初始化首个管理员
POST /api/setup   # { username, email, password }：创建首个管理员
```

### 邀请码

```http
GET  /api/auth/invite                  # 需登录：{ items, members, can_create }
POST /api/auth/invite                  # 需登录 + auth.invites.manage：签发邀请码
GET|POST /api/admin/invites            # 同权限：管理台台账 / 签发
POST /api/admin/invites/:code/revoke   # 同权限：撤销
```

- 签发请求体 `{ note, max_uses, expires_in_days }`：`max_uses` 缺省 1、上限 1000；不给 `expires_in_days` 即长期有效
- 邀请码在注册事务内原子消耗（条件 `used_count < max_uses`），并发注册不会超额

## 会话维护

```http
POST /api/auth/login             # { username, password } → 令牌 + 用户
POST /api/auth/refresh           # 用当前 Bearer / Cookie 令牌换发新令牌（服务端轮转会话行）
GET  /api/auth/me                # 需认证：当前账号
POST /api/auth/logout            # 注销当前会话
POST /api/auth/logout-all        # 吊销该用户的全部会话
PUT  /api/auth/password          # 改密码：{ old_password, new_password }
```

没有 `refresh_token` 字段：续期走 `POST /api/auth/refresh`。

服务端会话有效期为 24 小时。登出、全部登出与改密会移除相应会话；下游已签发 JWT 的撤销窗口见[账号封禁](#账号封禁)。

::: warning 令牌注销集合是单实例实现
账号服务对尚未过期 JWT 的注销记录在进程内，不是跨实例共享；集成不能假定所有服务上的既有 JWT 都会立即失效。
:::

## 第三方授权管理（自助撤回）

```http
GET    /api/auth/oauth-grants                  # 需登录：我给过哪些站点授权
DELETE /api/auth/oauth-grants/{client_id}      # 需登录：撤回我对该应用的授权
```

`GET` 返回 `items[]`，每项含 `client_id`、`name`、`scopes`、`active`、`last_authorized_at`、`expires_at`。

`active` 表示当前还有未过期的令牌；历史授权也会列出。

`DELETE` 撤回本人在该应用下的未过期令牌与未兑换授权码，返回 `{"ok":true,"revoked":N}`。幂等；没有有效令牌时 N 为 0，历史授权记录仍保留。

自助接口只处理本人授权。管理者按客户端或用户吊销的接口见[OAuth 客户端治理](/oauth-integration)。

## 公开账号资料

```http
GET /api/users/{id}   # 匿名可读：某账号的公开资料
```

响应 `{ "user": {...}, "stats": {...} }`。以下示例为本人已登录时的投影；查看他人或匿名读取不含 email：

```json
{
  "user": { "id": "<uuid>", "username": "moe", "display_name": "Moe", "email": "moe@example.com" },
  "stats": { "invited_count": 3 }
}
```

- 字段来自 `auth.users`：`id` / `username` / `display_name` / `bio` / `banned` / `email`。不返回账号角色。
- `avatar_url` / `created_at` 不在这份公开资料投影里。
- `email` 只在请求者就是本人时下发（带本人令牌或 Cookie）；匿名与看别人都缺省。
- `banned` 与管理台 `GET /api/admin/users` 同一口径：只在为真时出现。
- `stats.invited_count` 是该用户通过自己签发的邀请码成功邀请的人数。
- 同一个人被同一邀请人的多个码拉进来只算一次；码之后被吊销或过期不回溯扣减，已被封禁的受邀者也计入。
- 非 UUID 与查不到的 id 都返回 `404` + `{"error":"not_found"}`，两种情况不区分。
- 网关把恰好一段路径的 `/api/users/{id}` 分流到账号服务；`/api/users/{id}/stats`、`/api/users/{id}/favorites` 归互动服务，`/api/users/{id}/contributions` 归目录服务（矩阵见 [API 概览](/api-overview)）。

被封禁账号仍返回公开资料并带 `banned=true`，其历史贡献与引用保留。

用户主页的另外两组数据各由对应服务提供：三个互动数字（主题 / 回复 / 收藏）见 [社区与互动 API](/api-community#用户主页统计)，目录侧贡献流见 [实体查询与详情](/api-entities)。

## 管理台端点

| 端点 | 权限码 |
|---|---|
| `GET\|POST /api/admin/users`、`PUT /api/admin/users/:id/password` | `auth.users.manage` |
| `PUT /api/admin/users/:id/groups` | `auth.users.manage` |
| `PUT /api/admin/users/:id/ban`（封禁 / 解封，body `{ "banned": true \| false }`） | `auth.users.manage` |
| `GET\|POST /api/admin/groups`、`PUT\|DELETE /api/admin/groups/:code` | `auth.groups.manage` |
| `GET /api/admin/permissions`（权限码清单） | `auth.groups.manage` |
| `GET\|PUT /api/admin/settings`（实例设置） | `auth.settings.manage` |
| `GET\|POST /api/admin/invites`、`POST /api/admin/invites/:code/revoke` | `auth.invites.manage` |
| `/api/admin/oauth/*`（客户端治理、吊销令牌、审计） | `auth.oauth.manage` |

管理员创建账号用 `POST /api/admin/users`（`{ username, email, password }`）。新账号的能力由权限组决定。

授权判定只看权限组下发到令牌的 `permissions`；空权限不授予任何管理能力。`GET /api/admin/users` 的每一项带 `banned`（仅当为真时下发）。

### 账号封禁

```http
PUT /api/admin/users/{id}/ban     # { "banned": true }  封禁
PUT /api/admin/users/{id}/ban     # { "banned": false } 解封 → { "ok": true, "user": {...} }
```

封禁影响登录、会话与第三方授权：

- 登录：口令正确但账号被封禁 → `403` + `{"error":"account_banned"}`。这与口令错误的 `401 invalid_credentials` 区分，前端据此提示「账号已停用、请联系站务」，而不是引导用户反复重试密码。
- 续期：`POST /api/auth/refresh` 同码 `account_banned`（403）。
- 既有会话与令牌：封禁移除服务端会话、第三方令牌与未兑换授权码。账号服务还复核封禁状态；执行封禁的实例立即更新缓存，其他账号实例缓存最多延迟 5 秒。
- 两条护栏：不能封自己（`cannot_ban_self`），也不能封掉最后一个还能登录的管理员（`cannot_ban_sole_admin`，已封禁的管理员不计入剩余数量）。两者都返回 `400`。

::: warning 下游服务里的旧令牌最长还能用到自然过期
目录、互动、存储对 JWT 本地验签，被封账号的旧 JWT 最长仍可用到自然过期（默认 15 分钟）。PAT 的撤销窗口见[到期与吊销](#到期与吊销)。
:::

## OAuth 应用接入

自助登记、归属授权、密钥轮换与客户端核验统一见[第三方站点接入 OAuth 授权](/oauth-integration#客户端登记与归属)。账号会话与 PAT 的维护使用本页接口。

## 限流

账号业务 API 默认读写各 180 次/分钟，已验证账号按用户计数，匿名按 IP；admin 组免业务限流。实例设置 `auth_rate_limit_enabled` / `auth_rate_limit_per_minute` 可覆盖普通账号额度，修改后立即生效。网关不再对业务 API 叠加共享出口 IP 限流。

PAT 内省为服务间热路径，普通令牌 180 次/分钟、来源 IP 18000 次/分钟；内省确认属于当前 admin 组时免这两项限流。未验证令牌不能声称 admin 身份。登录失败保护独立生效，不能通过伪造用户组绕过。

业务响应提供 `X-RateLimit-Limit` / `Remaining` / `Reset`，超限提供 `Retry-After`；当前计数为进程内固定窗口。

受限 PAT 可调用公共账号资料与已授权的 `/api/admin/*` 管理 API，权限仍为账号现时权限与 scopes 交集，审计凭据类型为 pat。`mcp.connect` 仅用于 MCP 身份验证，不授予业务编辑或管理能力；普通非封禁站内账号可授权该身份能力。登录、口令、自助令牌和第三方 OAuth 授权仍使用浏览器会话。

## 用令牌调用

下例使用 Bash，先将 `METAFUSION_BASE_URL` 设为目标实例根地址（例如 `https://example.com`，不带 `/api`），将 `MF_PAT` 设为已有 PAT：

```bash
curl --fail-with-body "$METAFUSION_BASE_URL/api/catalog/entities?kind=work&limit=10" \
  -H "Authorization: Bearer $MF_PAT"
```

写入载荷与版本规则统一见[新建与编辑](/api-edit)。有效令牌权限不足返回 `403 forbidden`；PAT 无效返回 `401 invalid_token`，两者分别处理。第三方 OAuth scopes 与 PAT 权限码不同，不应互换，见[OAuth 接入](/oauth-integration)。

## 相关页面

- [第三方站点接入 OAuth 授权](/oauth-integration)：授权码 + PKCE 的完整流程与示例代码
- [API 概览](/api-overview)：目录服务的错误码与限流
- [新建与编辑](/api-edit)：写入所需的权限码与证据字段
