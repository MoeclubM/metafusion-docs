---
title: "认证与凭证"
description: "会话令牌、OAuth 2.0 / OIDC、注册与邀请、开发者中心。"
order: 31
group: "api"
---

# 认证与凭证

认证由**账号服务**（`metafusion-auth`）负责：它签发 RS256 访问令牌，目录、互动、存储三个服务只验签、
不查库、不签发。**平台不签发个人访问令牌（PAT）**——没有 `/api/auth/tokens` 端点，也没有 `mfp_` 前缀令牌、
`X-API-Key` 或 `catalog:write` 这类 scope；程序化接入请用下面的会话令牌或 OAuth 2.0 客户端。

## 两种凭证

| 凭证 | 获取方式 | 有效期 | 用途 |
|---|---|---|---|
| 会话令牌 / Cookie | `POST /api/auth/login`（或 `/api/auth/register`） | 访问令牌 15 分钟，服务端会话兜底 24 小时 | 网页端与直接调用 API |
| OAuth 2.0 授权码 | `/api/oauth/authorize` + `POST /api/oauth/token` | 由客户端配置决定（无 `refresh_token`，到期重新授权） | 第三方站点与 OIDC 接入 |

两种凭证都可用请求头或 Cookie 携带，服务端两者各试一次：

```http
Authorization: Bearer <token>
Cookie: mf_session=<token>
```

第三方站点把 MetaFusion 作为授权方接入的完整契约（发现文档、同意页、scope、PKCE、换码与 userinfo、
管理端接口、已知限制）见 [第三方站点接入 OAuth 授权](/oauth-integration)。

## 注册与实例准入

```http
GET  /api/auth/settings   # 未登录可读：实例准入能力（registration_enabled / invite_required 等）
POST /api/auth/register   # { username, email?, password, invite_code? }，成功即签发令牌
```

- 是否开放注册是**持久化的实例设置**，不是代码常量：`registration_enabled` 默认关闭，
  关闭时注册返回 `registration_closed`，由管理员用 `PUT /api/admin/settings`（需 `auth.settings.manage`）打开
- 打开后若 `invite_required` 为真，请求必须带有效 `invite_code`：缺失 `invite_required`，
  无效 / 已撤销 / 过期 `invalid_invite_code`，次数用尽 `invite_exhausted`
- 用户名 2–80 字符且不含空白，密码 12–72 字符；用户名或邮箱被占用返回 `username_or_email_taken`
- 邮箱可省略，服务端按 `<用户名>@<默认域>` 补占位地址；新账号进 `registration_default_groups`（默认 `member` 组）
- `require_email_verification` 目前恒为 `false`（邮件通道未接入）
- 成功响应 `{ token, access_token, token_type, expires_in, user }`（`access_token` 与 `token` 同值，
  `expires_in` 默认 900），并写入 HttpOnly Cookie `mf_session`

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
POST /api/auth/change-password   # 同上（同一实现）
```

**没有 `refresh_token` 字段**：续期走 `POST /api/auth/refresh`。服务端会话是 `auth.sessions` 里的行（24 小时），
登出、全部登出、改密都会直接删行——访问令牌过期后回退查库，看的就是这一行，所以这一层在多实例下天然一致。
另有一份**进程内**的令牌注销集合（jti），用于让尚未过期的无状态 JWT 立即失效；它是单实例实现，
横向扩容时这一份需要换成 Redis 之类的共享状态。

## 第三方授权管理（自助撤回）

```http
GET    /api/auth/oauth-grants                  # 需登录：我给过哪些站点授权
DELETE /api/auth/oauth-grants/{client_id}      # 需登录：撤回我对该应用的授权
```

`GET` 返回 `items[]`，每项含 `client_id`、`name`、`scopes`、`active`、`last_authorized_at`、`expires_at`：
`active` 表示当前还有未过期的令牌；授权过但令牌已过期的应用也会列出（时间来自同意审计），所以列表是"我给过
哪些授权"的全貌，不只是"当前生效的"。`DELETE` 删除**本人**在该应用下的未过期令牌与未兑换授权码，
返回 `{"ok":true,"revoked":N}`；本来就没有有效令牌时 `revoked` 为 0，但请求仍然是成功的（幂等）。
撤回后该应用在列表里转为 `active:false`（同意记录仍在）。

只认当前登录身份、路径里没有别人的 user id，因此任何登录用户都能收回自己的授权；
管理面的按客户端 / 按用户吊销（`/api/admin/oauth/clients/{id}/revoke-tokens`、
`/api/admin/users/{id}/revoke-oauth-tokens`，需 `auth.oauth.manage`）保留给治理场景。

## 公开账号资料

```http
GET /api/users/{id}   # 匿名可读：某账号的公开资料
```

响应 `{ "user": {...}, "stats": {...} }`：

```json
{
  "user": { "id": "<uuid>", "username": "moe", "role": "editor", "email": "moe@example.com" },
  "stats": { "invited_count": 3 }
}
```

- 字段只来自 `auth.users` 里**真实存在的列**：`id` / `username` / `role` / `banned` / `email`。**没有** `display_name` / `avatar_url` / `bio` / `created_at`——账号库里没有这些列，接口也不填占位值（空字符串会被读成"这个人就是没头像"，而事实是"没有这个来源"）
- `email` 只在请求者就是本人时下发（带本人令牌或 Cookie）；匿名与看别人都缺省。`banned` 与管理台 `GET /api/admin/users` 同一口径：只在为真时出现
- **被封禁的账号照样返回资料**（带 `"banned": true`）：封禁是访问控制（不能登录 / 续期 / 验签），不是"这个人不存在"——他的历史贡献与别人会话里的引用都还指向这个 id，回 404 会让其它服务里的链接整片失效
- `stats.invited_count` 是"该用户邀请成功的人数"：只算真被用掉、并因此注册成功的邀请（`auth.invite_uses` 记录谁用了哪个码，码归 `auth.invites.created_by` 所有）；同一个人被同一邀请人的多个码拉进来只算一次；码之后被吊销或过期不回溯扣减，已被封禁的受邀者也计入
- 非 UUID 与查不到的 id 都返回 `404` + `{"error":"not_found"}`，两种情况不区分
- 网关把恰好一段路径的 `/api/users/{id}` 分流到账号服务；`/api/users/{id}/stats`、`/api/users/{id}/favorites` 归互动服务，`/api/users/{id}/contributions` 归目录服务（矩阵见 [API 概览](/api-overview)）

用户主页的另外两组数据各由对应服务提供：三个互动数字（主题 / 回复 / 收藏）见 [社区使用指南](/community-guide)，目录侧贡献流见 [实体查询与详情](/api-entities)。

## 管理台端点

| 端点 | 权限码 |
|---|---|
| `GET\|POST /api/admin/users`、`PUT /api/admin/users/:id/role`、`PUT /api/admin/users/:id/password` | `auth.users.manage` |
| `PUT /api/admin/users/:id/groups` | `auth.users.manage` |
| `PUT /api/admin/users/:id/ban`（封禁 / 解封，body `{ "banned": true \| false }`） | `auth.users.manage` |
| `GET\|POST /api/admin/groups`、`PUT\|DELETE /api/admin/groups/:code` | `auth.groups.manage` |
| `GET /api/admin/permissions`（权限码清单） | `auth.groups.manage` |
| `GET\|PUT /api/admin/settings`（实例设置） | `auth.settings.manage` |
| `GET\|POST /api/admin/invites`、`POST /api/admin/invites/:code/revoke` | `auth.invites.manage` |
| `/api/admin/oauth/*`（客户端治理、吊销令牌、审计） | `auth.oauth.manage` |

管理员创建账号用 `POST /api/admin/users`（`{ username, email, password }`，默认角色 `editor`）；
角色取值 `user` / `editor` / `admin`。**授权判定走权限码**（由权限组下发到令牌的 `permissions`），
角色只在令牌没有任何 `permissions` 声明时兜底。`GET /api/admin/users` 的每一项带 `banned`（仅当为真时下发）。

### 账号封禁

```http
PUT /api/admin/users/{id}/ban     # { "banned": true }  封禁
PUT /api/admin/users/{id}/ban     # { "banned": false } 解封 → { "ok": true, "user": {...} }
```

封禁立即生效，不是"打个标记"：

- 登录：口令正确但账号被封禁 → `403` + `{"error":"account_banned"}`（**与口令错误的 `401 invalid_credentials` 区分**，
  前端据此提示"账号已停用、请联系站务"，而不是引导用户反复重试密码）；
- 续期：`POST /api/auth/refresh` 同码 `account_banned`（403）；
- 既有会话与令牌：封禁会删除该用户的服务端会话、第三方令牌与未兑换的授权码，**并且**验签路径（本地校验 JWT 通过之后）
  再查一次封禁状态——因此在**账号服务自己的端点**（`/api/auth/*`、`/api/oauth/userinfo` 等）上，手里那张未过期的访问令牌立刻失效；
  目录 / 互动 / 存储三个服务是**本地 JWKS 验签**、不回调账号服务，被封账号的旧令牌在它们那里最长还能用到自然过期（≤15 分钟）——
  这是无状态验签的既有取舍（要即时跨服务撤销需引入 introspection 或共享注销集合，当前未实现）；
- 两条护栏：不能封自己（`cannot_ban_self`），也不能封掉最后一个还能登录的管理员（`cannot_ban_sole_admin`，
  已封禁的管理员不计入剩余数量）。两者都返回 `400`。

## 开发者中心（自助登记 OAuth 应用）

任何登录用户都可以登记自己的应用，无需管理员：

```http
GET    /api/developer/overview              # 接入配置：issuer、端点与 scope 说明
GET    /api/developer/apps                  # 我的应用
POST   /api/developer/apps                  # 新建；明文 client_secret 只在这一次响应里出现
GET    /api/developer/apps/:id
PUT    /api/developer/apps/:id
POST   /api/developer/apps/:id/rotate-secret
DELETE /api/developer/apps/:id
```

同一个应用也可以由管理员在管理台 `/api/admin/oauth/clients` 下维护（按 `auth.oauth.manage` 授权，
而开发者中心按归属授权）。密钥在库里只存哈希，之后无处可取，只能轮换。
自助登记有配额：每个账号最多 20 个应用，超限返回 `app_quota_exceeded`。

- **开发者中心只服务归属自己的应用**：列表与读 / 改 / 轮换 / 删一律按归属判定（归属 = 当前账号），
  **管理员也没有例外**——不属于自己的 `client_id` 返回 `404` + `{"error":"client_not_found"}`，而不是
  `403`（`403` 会泄漏「这个 id 已被占用」）。配额同样一视同仁；要批量登记或治理别人的客户端走管理面。
- **系统应用（平台自有、归属为空）只在管理台维护**：开发者面看不到、自助接口也不返回——
  `GET /api/developer/apps` 的「我的应用」只列归属当前账号的应用（归属为空的行永不匹配）。
- **核验（`verified`）是管理面的动作**：第三方应用自助登记后默认未核验，由管理员在
  `PUT /api/admin/oauth/clients/{id}` 里置 `verified`；未核验的应用在同意页上会多一条「未核验」提示。
  开发者面只读这个状态，不能自证。

::: tip 自助登记入口
网关已把 `/api/developer/*` 分流到账号服务（主仓库 `deploy/nginx.conf`）。登录后在站内导航「开发者中心」（`/developer`）
即可自助登记应用、查看接入配置（issuer、端点与 scope 说明）；管理面的 `/api/admin/oauth/clients`（需 `auth.oauth.manage`）
用于平台侧治理所有客户端——两边写的是同一张表、走同一份校验，差别只在授权判定（归属 vs 权限码）。
:::

## 限流

- 网关按来源 IP 固定窗口限流：账号服务相关前缀走 `auth_limit`（`5 r/s`）——`/api/auth/`、`/api/setup`、
  `/api/oauth/`、`/api/oidc/`、`/api/.well-known/`、`/.well-known/` 为 `burst 10`，`/api/developer/` 为 `burst 20`
- 其余 `/api/` 前缀走 `api_limit`（`30 r/s`，`burst` 视 location 为 20 / 50 / 100；账号管理面
  `/api/admin/users`、`/api/admin/groups`、`/api/admin/oauth/`、`/api/admin/settings`、`/api/admin/invites` 都是 `burst 50`）
- 账号服务另按 IP 对认证写入类接口做固定窗口限流（**默认 15 次/分钟**；速率与开关是实例设置
  `auth_rate_limit_enabled` / `auth_rate_limit_per_minute`，`false` 时不限流，改完立即生效）：`/api/auth/login`、`/api/auth/refresh`、
  `/api/auth/register`、`/api/setup`、`/api/oauth/authorize`、`/api/oauth/token`，以及开发者中心的
  `POST /api/developer/apps` 与 `POST /api/developer/apps/:id/rotate-secret`
- 超限返回 `429` 与 `Retry-After`；限流按 IP 与路由判定，响应头不带 `X-RateLimit-*` 系列

## 用令牌调用

```bash
# 读（开放端点无需令牌）
curl "/api/catalog/entities?kind=work&limit=10"

# 写（需登录会话）
curl -X POST /api/catalog/entities \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{"entity":{"kind":"work","title":"新作品","original_language":"ja","translations":{"zh-CN":{"title":"新作品"}}},"expected_version":0,"edit_note":"initial import per official source","sources":[{"kind":"url","citation":"官网","url":"https://example.com"}]}'
```

## 相关页面

- [第三方站点接入 OAuth 授权](/oauth-integration)：授权码 + PKCE 的完整流程与示例代码
- [API 概览](/api-overview)：目录服务的错误码与限流
- [新建与编辑](/api-edit)：写入所需的权限码与证据字段
