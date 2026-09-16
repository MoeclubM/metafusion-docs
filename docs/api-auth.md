---
title: "认证与 API 密钥"
description: "会话令牌与 OAuth 2.0 凭证、注册开关、邀请码与限流规范。"
order: 31
group: "api"
---

::: warning 文档与实现存在差异（一手提示）
本页描述的部分认证端点与账号服务当前实现不一致，以下按 `metafusion-auth` 的处理器与存储层校对
（注册开关等与实例相关的取值以目标实例 `/api/auth/*` 响应为准）：

- `POST /api/auth/register`、`GET|POST /api/auth/invite`：**已实现**。自助注册受实例设置约束（`registration_enabled` 默认关闭，打开后可要求邀请码 `invite_required`）；签发邀请码需 `auth.invites.manage` 权限
- `GET|POST|DELETE /api/auth/tokens` 与 `mfp_` 前缀 PAT、`X-API-Key` 请求头：**不存在**（没有个人访问令牌体系）
- `GET /api/system/setup-status`、`POST /api/system/setup`：**不存在**，真实端点是不带 `system/` 前缀的 `GET|POST /api/setup`
- Access/Refresh 双 Token 轮转与 Redis 黑名单：**未实现**；当前为 RS256 短期访问令牌（15 分钟）+ 服务端会话兜底（24 小时），吊销为单实例内存

**真实端点**：`GET /api/setup`、`POST /api/setup`（首管初始化）、`POST /api/auth/login`、`POST /api/auth/refresh`（用当前令牌换发新令牌）、`POST /api/auth/register`（自助注册，受实例设置约束）、`GET|POST /api/auth/invite`（我的邀请码台账 / 签发邀请码）、`GET /api/auth/me`、`GET /api/auth/settings`（实例准入能力）、`POST /api/auth/logout`、`PUT /api/auth/password`、`POST /api/auth/change-password`、`POST /api/auth/logout-all`、`GET|POST /api/admin/users`、`PUT /api/admin/users/:id/role|password`、`GET|POST /api/admin/invites`、`POST /api/admin/invites/:code/revoke`、`GET|PUT /api/admin/settings`（实例设置），以及 OAuth 2.0 / OIDC 的 `/api/oauth/clients|authorize|token|userinfo` 与 `/.well-known/openid-configuration|/oidc/jwks`。以 [OpenAPI](/api/openapi.json) 为准。
:::

# 认证与 API 密钥

## 两种凭证

| 凭证 | 获取方式 | 有效期 | 用途 |
|---|---|---|---|
| 会话令牌 / Cookie | `POST /api/auth/login` | 服务端会话决定 | 网页端与 API 调用 |
| OAuth 2.0 授权码 | `/api/oauth/authorize` + `POST /api/oauth/token` | 由客户端配置决定 | 第三方应用与 OIDC 接入 |

第三方站点把 MetaFusion 作为授权方接入的完整契约（发现文档、同意页、scope 收敛、PKCE、换码与 userinfo、管理端接口、已知限制）见
[第三方站点接入 OAuth 授权](/oauth-integration)。

二者均可通过请求头或 Cookie 携带：

```http
Authorization: Bearer <session-token>
# 或
Cookie: mf_session=<session-token>
```

## 注册、登录与会话维护

### 自助注册与实例准入

```http
POST /api/auth/register          # { username, email?, password, invite_code? }，成功即签发令牌
GET  /api/auth/settings          # 未登录可读：实例准入能力
```

注册是否开放是**账号服务的实例设置**（持久化在库中），不是代码里的常量：

- `registration_enabled` 默认关闭；关闭时注册返回 `registration_closed`，由管理员在 `PUT /api/admin/settings`（需 `auth.settings.manage`）打开
- 打开后若 `invite_required` 为真，请求必须带有效 `invite_code`：缺失返回 `invite_required`，无效/已撤销/过期返回 `invalid_invite_code`，次数用尽返回 `invite_exhausted`
- 用户名 2–80 字符且不含空白，密码 12–72 字符；用户名或邮箱被占用返回 `username_or_email_taken`
- 邮箱可省略，服务端按 `<用户名>@<默认域>` 补一个占位地址；新账号默认进 `registration_default_groups`（默认 `member` 组，无任何特权）
- 成功响应 `{ token, access_token, token_type, expires_in, user }`，同时写入 HttpOnly Cookie `mf_session`

### 邀请码

```http
GET  /api/auth/invite                    # 需登录：{ items, members, can_create }
POST /api/auth/invite                    # 需登录 + auth.invites.manage：签发邀请码
GET|POST /api/admin/invites              # 同签发权限：管理台台账 / 签发
POST /api/admin/invites/:code/revoke     # 同签发权限：撤销邀请码
```

- `GET /api/auth/invite` 返回我签发的邀请码台账与经我邀请注册的成员；持 `auth.invites.manage` 的成员看得到全部邀请码，`can_create` 指示当前账号能否签发
- 签发请求体 `{ note, max_uses, expires_in_days }`：`max_uses` 缺省 1、上限 1000；不给 `expires_in_days` 即长期有效
- 邀请码在注册事务内原子消耗（条件 `used_count < max_uses`），并发注册不会超额

真实端点：

```http
GET  /api/setup                  # 检查是否仍需初始化首管
POST /api/setup                  # { username, email, password } 创建首个管理员
POST /api/auth/login             # { username, password } → 用户信息 + 会话
POST /api/auth/refresh           # 用当前 Bearer/Cookie 令牌换发新令牌
GET  /api/auth/me                # 需认证：当前账号
GET  /api/auth/settings          # 未登录可读：实例准入能力
POST /api/auth/logout            # 注销当前会话
PUT  /api/auth/password          # 修改密码
POST /api/auth/change-password   # 修改密码（需旧密码）
POST /api/auth/logout-all        # 吊销该用户全部会话
```

登录、注册与续期共用一套响应字段：`{ token, access_token, token_type, expires_in, user }`（`access_token` 与 `token` 同值；`expires_in` 为访问令牌剩余秒数，默认 900）。**没有 `refresh_token`**，续期走 `POST /api/auth/refresh`。

- 账号也可由管理员通过 `POST /api/admin/users` 创建（请求体 `{username, email, password}`，默认角色 `editor`；改角色 `PUT /api/admin/users/:id/role` 请求体 `{role}`，取值 `user / editor / admin`）；自助注册的开关是**持久化实例设置**——`registration_enabled`（默认关闭）与 `invite_required`（默认不强制），管理台 `GET|PUT /api/admin/settings` 需 `auth.settings.manage`，未登录可读的子集见 `GET /api/auth/settings`
- 首次部署未初始化时用 `GET /api/setup` 检查状态，`POST /api/setup` 创建超级管理员

## API 密钥管理

::: danger 未实现
个人访问令牌（PAT）与 `/api/auth/tokens` 端点在当前实现中**不存在**；请使用会话令牌或 OAuth 2.0 客户端凭证。
:::

## 使用令牌调用

```bash
# 读（开放）
curl "/api/catalog/entities?kind=work&limit=10"

# 写（需登录会话）
curl -X POST /api/catalog/entities \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{"entity":{"kind":"work","title":"新作品","original_language":"ja","translations":{"zh-CN":{"title":"新作品"}},"attributes":{"cover_aspect":"2:3"}},"expected_version":0,"edit_note":"initial import per official source","sources":[{"kind":"url","citation":"官网","url":"https://example.com"}]}'
```

## 限流

- 仅部分路由限流：`/api/catalog/entities` 120/min、`/api/catalog/compare` 10/min、`/api/setup` 与 `/api/auth/login` 有防爆破限制
- 超限返回 429 与 `Retry-After`；**不存在全站 `X-RateLimit-*` 响应头，也不校验 User-Agent**
