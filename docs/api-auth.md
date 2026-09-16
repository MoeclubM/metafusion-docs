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

**没有 `refresh_token` 字段**：续期走 `POST /api/auth/refresh`。吊销当前是账号服务进程内的会话状态，
多实例一致性与 Redis 黑名单尚未实现。

## 管理台端点

| 端点 | 权限码 |
|---|---|
| `GET|POST /api/admin/users`、`PUT /api/admin/users/:id/role`、`PUT /api/admin/users/:id/password` | `auth.users.manage` |
| `PUT /api/admin/users/:id/groups` | `auth.users.manage` |
| `GET|POST /api/admin/groups`、`PUT|DELETE /api/admin/groups/:code` | `auth.groups.manage` |
| `GET /api/admin/permissions`（权限码清单） | `auth.groups.manage` |
| `GET|PUT /api/admin/settings`（实例设置） | `auth.settings.manage` |
| `GET|POST /api/admin/invites`、`POST /api/admin/invites/:code/revoke` | `auth.invites.manage` |
| `/api/admin/oauth/*`（客户端治理、吊销令牌、审计） | `auth.oauth.manage` |

管理员创建账号用 `POST /api/admin/users`（`{ username, email, password }`，默认角色 `editor`）；
角色取值 `user` / `editor` / `admin`。**授权判定走权限码**（由权限组下发到令牌的 `permissions`），
角色只在令牌没有任何 `permissions` 声明时兜底。

## 开发者中心（自助登记 OAuth 应用）

任何登录用户都可以登记自己的应用，无需管理员：

```http
GET    /api/developer/overview              # issuer、端点、scope 说明与自有平台清单
GET    /api/developer/apps                  # 我的应用
POST   /api/developer/apps                  # 新建；明文 client_secret 只在这一次响应里出现
GET    /api/developer/apps/:id
PUT    /api/developer/apps/:id
POST   /api/developer/apps/:id/rotate-secret
DELETE /api/developer/apps/:id
```

同一个应用也可以由管理员在管理台 `/api/admin/oauth/clients` 下维护（按 `auth.oauth.manage` 授权，
而开发者中心按归属授权）。密钥在库里只存哈希，之后无处可取，只能轮换。

::: tip 自助登记入口
网关已把 `/api/developer/*` 分流到账号服务（主仓库 `deploy/nginx.conf`）。登录后在站内导航「开发者中心」（`/developer`）
即可自助登记应用、查看接入配置与自有平台清单；管理台的 `/api/admin/oauth/clients`（需 `auth.oauth.manage`）
用于平台侧治理所有客户端——两边写的是同一张表、走同一份校验，差别只在授权判定（归属 vs 权限码）。
:::

## 限流

- 网关对 `/api/auth/` 与 `/api/setup` 按 IP 限 `5 r/s`（burst 10）；其余 `/api/` 前缀 `30 r/s`（burst 50）
- 账号服务对登录、注册、`/oauth/token`、`/oauth/authorize`、`/setup`、开发者应用的写入另有防爆破限流
- 超限返回 `429` 与 `Retry-After`；**不存在全站 `X-RateLimit-*` 响应头，也不按 User-Agent 判定**

## 用令牌调用

```bash
# 读（开放端点无需令牌）
curl "/api/catalog/entities?kind=work&limit=10"

# 写（需登录会话）
curl -X POST /api/catalog/entities \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{"entity":{"kind":"work","title":"新作品","original_language":"ja","translations":{"zh-CN":{"title":"新作品"}},"attributes":{"cover_aspect":"2:3"}},"expected_version":0,"edit_note":"initial import per official source","sources":[{"kind":"url","citation":"官网","url":"https://example.com"}]}'
```

## 相关页面

- [第三方站点接入 OAuth 授权](/oauth-integration)：授权码 + PKCE 的完整流程与示例代码
- [API 概览](/api-overview)：目录服务的错误码与限流
- [新建与编辑](/api-edit)：写入所需的权限码与证据字段
