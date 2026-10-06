---
title: "第三方站点接入 OAuth 授权"
description: "把 MetaFusion 作为 OAuth 2.0 / OIDC 授权方接入第三方站点：发现文档、授权码与 PKCE、令牌与 userinfo、客户端管理端与已知限制。"
order: 70
group: "api"
---

# 第三方站点接入 OAuth 授权

MetaFusion 账号服务对外提供 OAuth 2.0 授权码流程与 OIDC 子集（发现文档、`id_token`、JWKS）。
第三方站点用它在自己的站点上实现「用 MetaFusion 账号登录」，不需要接触用户密码。

本页描述 OAuth 授权码、PKCE、用户信息与客户端管理协议。接入时先读取目标实例的发现文档，核对端点与支持能力。
把示例里的 `https://<your-host>` 换成你自己的实例地址即可。

::: tip 与本页的关系
[认证与凭证](/api-auth) 讲实例自身的登录、会话与令牌；本页只讲第三方接入这条链路。
管理端接口需要权限码 `auth.oauth.manage`（权限中心里的名称是「管理 OAuth 客户端」）。
:::

## 端点总览

| 用途 | 方法与路径 | 认证 |
|---|---|---|
| 发现文档 | `GET /api/.well-known/openid-configuration` | 公开 |
| 公钥集（JWKS） | `GET /api/oidc/jwks`、`GET /.well-known/jwks.json` | 公开 |
| 发起授权 | `GET /api/oauth/authorize` | 终端用户的浏览器会话 |
| 授权码换令牌 | `POST /api/oauth/token` | 客户端密钥；带 PKCE 时校验 `code_verifier` |
| 读取用户信息 | `GET /api/oauth/userinfo` | `Authorization: Bearer <access_token>` |
| 客户端管理与审计 | `/api/admin/oauth/*`、`POST /api/admin/users/{id}/revoke-oauth-tokens` | 权限码 `auth.oauth.manage` |
| 用户自查与自助撤回 | `GET /api/auth/oauth-grants`、`DELETE /api/auth/oauth-grants/{client_id}` | 登录即可（只作用于本人） |

授权与换码受账号服务及网关限流，额度与开关见[认证与凭证](/api-auth#限流)。按实际响应的 `429` 与 `Retry-After` 退避。

## 1. 发现文档

```bash
curl -sS "https://<your-host>/api/.well-known/openid-configuration"
```

响应字段与实测值（除 `issuer` 外，端点地址都由 `issuer` 拼接）：

| 字段 | 实测值 |
|---|---|
| `issuer` | `https://<your-host>/api` |
| `authorization_endpoint` | `https://<your-host>/api/oauth/authorize` |
| `token_endpoint` | `https://<your-host>/api/oauth/token` |
| `userinfo_endpoint` | `https://<your-host>/api/oauth/userinfo` |
| `jwks_uri` | `https://<your-host>/api/oidc/jwks` |
| `response_types_supported` | `["code"]` |
| `grant_types_supported` | `["authorization_code"]` |
| `code_challenge_methods_supported` | `["S256", "plain"]` |
| `scopes_supported` | `["openid", "profile", "email"]` |
| `subject_types_supported` | `["public"]` |
| `id_token_signing_alg_values_supported` | `["RS256"]` |
| `claims_supported` | `["sub", "preferred_username", "email"]` |

根路径的 `/.well-known/openid-configuration`（OIDC 标准入口）与 `/api/.well-known/openid-configuration` 返回同一份文档。

::: warning 端点地址以 `issuer` 为基准拼接
下面的端点地址一律以 `issuer` 为基准拼接，不要写死站点根路径。
:::

## 2. 授权码流程

四个动作：终端用户在浏览器访问授权地址 → 同意 → 带 `code` 回跳 → 服务端换 `access_token` → 调 `userinfo`。

### 2.1 GET /api/oauth/authorize

| 参数 | 必填 | 说明 |
|---|---|---|
| `client_id` | 是 | 管理端登记的客户端 id |
| `redirect_uri` | 是 | 必须与登记的回调白名单逐字相等 |
| `response_type` | 是 | 只能是 `code` |
| `scope` | 否 | 空格分隔，取值见下方表格；不传按 `profile` 处理 |
| `state` | 建议 | 原样带回，第三方用它对齐自己发起的请求 |
| `code_challenge` | 否 | PKCE 的 challenge（建议带） |
| `code_challenge_method` | 否 | `S256`（推荐）或 `plain` |

行为要点：

- 未登录：`302` 到账号页并带 `return_to=<本次授权请求的原始地址>`。
- 登录后回到同一次授权请求：`state`、PKCE 参数与 `scope` 都不会丢，第三方不需要自己处理这一步。
- 非 trusted 客户端会先渲染同意页：展示客户端名称与 `client_id`、回跳地址，以及按收敛结果逐项列出的权限说明。
- 用户点「同意并继续」才继续，点「拒绝」直接回跳。
- 未核验（`verified=false`）的第三方应用还会多一行「该应用未通过核验」的提示。核验由管理员在管理面做。
- trusted 客户端（预置第一方）跳过同意页，直接发码。
- 同意：`302` 到 `redirect_uri?code=<code>&state=<state>`。
- `redirect_uri` 自带 query 时用 `&` 续接，`code` 与 `state` 两个值都做 URL 转义。
- 拒绝：`302` 到 `redirect_uri?error=access_denied&state=<state>`，不带 `code`。
- 授权码 10 分钟有效、单次使用：成功兑换一次即失效。
- 并发双兑只有一个成功，另一个拿到 `expired_or_used_code`。

::: warning 不要替用户拼接 `consent=allow`
同意页的两个按钮，就是在同一次授权请求上追加 `consent=allow` / `consent=deny`。
第三方在自己的站点里替用户拼一个带 `consent=allow` 的授权地址，等于绕过同意页，请不要这么做。
:::

### 2.2 scope 收敛：永远是「客户端白名单 ∩ 请求」

发放的 scope 只能是交集，第三方无法靠请求参数拿到客户端没被允许的权限：

- 客户端白名单在管理端登记，可选项只有 `openid` / `profile` / `email`。
- 实测：请求 `openid profile email`、客户端白名单只有 `openid profile` 时，同意页只列两项，换码响应里的 `scope` 也是 `"openid profile"`。
- 请求里含不受支持的 scope（例如 `phone`）→ `400`，且不静默丢弃，响应点明是哪一项：

  ```json
  {"error":"invalid_scope","unsupported_scopes":["phone"],"supported_scopes":["openid","profile","email"]}
  ```

- 收敛后一个 scope 都不剩 → `400 {"error":"invalid_scope", ...}`。
- 换码时会按客户端当前白名单再收敛一次：管理员事后收紧白名单，只会让令牌 scope 更少，不会变多。

| scope | 含义 | 同意页上的说明 | 相关声明 |
|---|---|---|---|
| `openid` | 确认身份 | 返回账号 ID（`sub`） | `sub` |
| `profile` | 读取基本资料 | 用户名 | `username` |
| `email` | 读取邮箱 | 账号邮箱地址 | `email` |

::: tip userinfo 按 scope 裁剪
`userinfo` 只回令牌被授予 scope 覆盖的字段：`openid` 给 `sub` / `id`，`profile` 追加 `username`，`email` 追加 `email`。
只申请 `openid` 就拿不到邮箱——同意页上说给什么，实际就只给什么（2026-09-19 审计 S-10 的修复）。
:::

### 2.3 授权请求的错误（直接回 JSON，不跳回回调地址）

| 响应 | `error` | 触发条件 |
|---|---|---|
| 400 | `unsupported_response_type` | `response_type` 不是 `code` |
| 400 | `invalid_client` | `client_id` 不存在，或客户端已停用 |
| 400 | `invalid_redirect_uri` | `redirect_uri` 不在该客户端的白名单里（精确匹配） |
| 400 | `invalid_scope` | 请求了不受支持的 scope，或收敛后没有任何可授 scope |
| 400 | `invalid_code_challenge_method` | 带了 `code_challenge`，但 `code_challenge_method` 不是 `S256` / `plain` |
| 500 | `audit_failed` | 授权审计写入失败；宁可失败也不发出一张查不到记录的授权码 |

## 3. 换码：POST /api/oauth/token

请求体以 `application/x-www-form-urlencoded` 为主，也兼容 `application/json`（字段同名）。

| 参数 | 必填 | 说明 |
|---|---|---|
| `grant_type` | 是 | 只能是 `authorization_code` |
| `code` | 是 | 回调地址里拿到的授权码 |
| `client_id` | 是 | 与授权请求一致 |
| `client_secret` | 机密客户端必填 | 管理端创建 / 轮换时下发的那一次明文 |
| `redirect_uri` | 建议 | 与授权请求一致；不一致直接 `redirect_uri_mismatch` |
| `code_verifier` | 用了 PKCE 就必填 | 与发码时的 `code_challenge` 配对 |

成功响应（实测结构，值已脱敏）：

```json
{
  "access_token": "<access-token>",
  "token_type": "Bearer",
  "expires_in": 900,
  "scope": "openid profile",
  "user": { "id": "<user-uuid>", "username": "<username>", "email": "<email>" },
  "id_token": "<rs256-jwt>",
  "id_token_expires_at": 1767225600
}
```

::: danger expires_in 是真实 TTL：900 秒（15 分钟），且没有 refresh_token
- `expires_in = 900` 就是访问令牌的真实有效期，到期后必须重新走一次授权流程。
- 响应里没有 `refresh_token`，也没有刷新端点。这是当前有意的设计——不要按「支持刷新」实现。
- `id_token` 是 RS256 JWT（`aud` 为该 `client_id`），可用 `jwks_uri` 的公钥本地验签。
- `id_token_expires_at` 是 Unix 秒，与访问令牌同一有效期。
:::

换码失败（`400` + `{"error": ...}`）：

| `error` | 触发条件 |
|---|---|
| `invalid_client` | `client_id` 不存在，或客户端已停用 |
| `invalid_client_secret` | 密钥不匹配；客户端没有可用密钥且不是预置受信第一方 |
| `expired_or_used_code` | 授权码不存在、已被使用，或超过 10 分钟 |
| `redirect_uri_mismatch` | 传入的 `redirect_uri` 与发码时记录的不一致 |
| `invalid_code_verifier` | PKCE 校验失败（缺 `code_verifier`，或值不匹配） |
| `invalid_scope` | 按当前白名单收敛后没有任何可授 scope |
| `unsupported_grant_type` | `grant_type` 不是 `authorization_code` |

换码先校验、后标记已用：`code_verifier` 填错不会作废这个授权码，可以改了再来。
但成功兑换一次后该码立即失效。

## 4. 读取用户信息：GET /api/oauth/userinfo

```bash
curl -sS "https://<your-host>/api/oauth/userinfo" -H "Authorization: Bearer <access-token>"
```

返回字段由令牌被授予的 scope 决定（`sub` / `id` 恒回）：

| 令牌 scope | 追加字段 |
|---|---|
| `openid` | ——（只有 `sub` / `id`） |
| `profile` | `username` |
| `email` | `email` |

```json
// scope=openid profile email 时的响应
{ "sub": "<user-uuid>", "id": "<user-uuid>", "username": "<username>", "email": "<email>" }
```

| 响应 | `error` | 触发条件 |
|---|---|---|
| 401 | `missing_token` | 没带 `Authorization: Bearer` 请求头 |
| 401 | `invalid_token` | 令牌过期、已被吊销、其客户端已停用，或根本不是本服务签发的令牌 |

失效判定以服务端的存活令牌记录为准（不是只看 JWT 能否验签），所以「吊销 / 停用」在这里是即时生效的。

当前实现也允许实例自身的登录会话令牌调用 `userinfo`（便于排障）：那种令牌不属于任何第三方授权，没有 scope 可依，按全字段返回。
第三方仍应始终使用授权码换来的 `access_token`。

## 5. 回调地址白名单规则

登记与授权两处用的是同一套规则：

- 每条都必须是 `http(s)` 绝对地址且带主机。`http://localhost:3000/callback` 这类本地地址可以，但必须整串登记。
- 不接受通配符（`*`）、不接受 URL 片段（`#...`）、不接受内嵌凭据（`https://user:pass@host/...`）。
- 只做整串精确匹配：不做前缀匹配、不做子域匹配，也不做大小写或末尾斜杠的等价处理，端口与 query 同样算差异。
- 授权请求里的 `redirect_uri` 不在白名单 → `400 invalid_redirect_uri`，不会跳转到那个地址。

## 6. PKCE

使用 S256。发现文档列出当前实例支持的 challenge 方法。

`plain` 等于把 verifier 明文发出去，不建议使用。

- 生成 `code_verifier`：43–128 字符（RFC 7636 允许的字符集）。
- 计算 `code_challenge = BASE64URL(SHA256(code_verifier))`，去掉末尾的 `=` 填充。
- 授权请求带 `code_challenge` + `code_challenge_method=S256`，换码时必须带同一个 `code_verifier`。
- 带 `code_challenge` 的码，缺 `code_verifier` 或值不匹配 → `invalid_code_verifier`。

## 7. Python 示例：授权码与 PKCE S256

```python
#!/usr/bin/env python3
"""第三方站点接入 MetaFusion OAuth 的最小示例：授权码 + PKCE(S256)，只用标准库。

先把下面的回调地址（http://127.0.0.1:8765/callback）整串登记到客户端的回调白名单里，
再运行本脚本，并按提示在浏览器里打开打印出来的授权地址、完成同意。
"""
import base64
import hashlib
import http.server
import json
import secrets
import socketserver
import sys
import urllib.parse
import urllib.request

HOST = "https://<your-host>"                 # 换成你的实例地址
CLIENT_ID = "<client-id>"
CLIENT_SECRET = "<client-secret>"            # 公开客户端可留空；无密钥只有预置受信第一方允许
REDIRECT_URI = "http://127.0.0.1:8765/callback"
SCOPE = "openid profile email"

code_verifier = secrets.token_urlsafe(64)    # 43-128 字符
code_challenge = base64.urlsafe_b64encode(
    hashlib.sha256(code_verifier.encode("ascii")).digest()
).rstrip(b"=").decode("ascii")
state = secrets.token_urlsafe(24)

auth_url = f"{HOST}/api/oauth/authorize?" + urllib.parse.urlencode({
    "client_id": CLIENT_ID,
    "redirect_uri": REDIRECT_URI,
    "response_type": "code",
    "scope": SCOPE,
    "state": state,
    "code_challenge": code_challenge,
    "code_challenge_method": "S256",
})

callback: dict[str, str] = {}


class CallbackHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        callback.update({k: v[0] for k, v in query.items()})
        body = "已收到回调，可以关闭本页回到终端。".encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):            # 静音访问日志
        pass


print("在浏览器里打开并完成同意：\n" + auth_url + "\n")
with socketserver.TCPServer(("127.0.0.1", 8765), CallbackHandler) as server:
    server.handle_request()

if callback.get("state") != state:
    sys.exit(f"state 不匹配（{callback.get('state')!r}），这次回调已丢弃")
if "error" in callback:
    sys.exit(f"授权被拒绝或失败：{callback['error']}")

payload = urllib.parse.urlencode({
    "grant_type": "authorization_code",
    "code": callback["code"],
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
    "redirect_uri": REDIRECT_URI,
    "code_verifier": code_verifier,
}).encode("ascii")

request = urllib.request.Request(
    f"{HOST}/api/oauth/token",
    data=payload,
    headers={"Content-Type": "application/x-www-form-urlencoded"},
)
with urllib.request.urlopen(request) as response:
    token = json.load(response)

print("换码结果（隐去 access_token / id_token 正文）：")
print(json.dumps(
    {k: v for k, v in token.items() if k not in ("access_token", "id_token")},
    ensure_ascii=False, indent=2,
))
print(f"expires_in={token['expires_in']} 秒（到期后必须重新授权，没有 refresh_token）")

userinfo_request = urllib.request.Request(
    f"{HOST}/api/oauth/userinfo",
    headers={"Authorization": f"Bearer {token['access_token']}"},
)
with urllib.request.urlopen(userinfo_request) as response:
    print("userinfo:", json.dumps(json.load(response), ensure_ascii=False))
```

## 客户端登记与归属

任何登录用户都可以登记自己的应用，无需管理员：

```http
GET    /api/developer/overview              # 接入配置：issuer、端点与 scope 说明（不含任何客户端清单）
GET    /api/developer/apps                  # 我的应用
POST   /api/developer/apps                  # 新建；明文 client_secret 只在这一次响应里出现
GET    /api/developer/apps/:id
PUT    /api/developer/apps/:id
POST   /api/developer/apps/:id/rotate-secret
DELETE /api/developer/apps/:id
```

同一个应用也可以由管理员在管理台 `/api/admin/oauth/clients` 下维护（按 `auth.oauth.manage` 授权，而开发者中心按归属授权）。密钥在库里只存哈希，之后无处可取，只能轮换。

自助登记有配额：每个账号最多 20 个应用，超限返回 `app_quota_exceeded`。

### 归属判定

- 列表与读 / 改 / 轮换 / 删一律按归属判定（归属 = 当前账号），**管理员也没有例外**。
- 不属于自己的 `client_id` 返回 `404` + `{"error":"client_not_found"}`，而不是 `403`——`403` 会泄漏「这个 id 已被占用」。
- 配额同样一视同仁；要批量登记或治理别人的客户端走管理面。

### 系统应用只在管理台维护

系统应用（平台自有、归属为空）开发者面看不到、自助接口也不返回。`GET /api/developer/apps` 的「我的应用」只列归属当前账号的应用（归属为空的行永不匹配）。

### 开发者面不回客户端清单

`GET /api/developer/overview` 只回接入配置（`issuer` / `account_url` / `endpoints` / `grant_types` / `response_types` / `code_challenge_methods` / `scopes`）。不返回系统应用的 `client_id`、回调地址或归属。

全量客户端视图只有管理面 `/api/admin/oauth/clients*`。

### 核验状态

核验（`verified`）是管理面的动作：第三方应用自助登记后默认未核验，由管理员在 `PUT /api/admin/oauth/clients/{id}` 里置 `verified`。未核验的应用在同意页上会多一条「未核验」提示。

开发者面只读这个状态，不能自证。

::: tip 自助登记入口
网关已把 `/api/developer/*` 分流到账号服务（主仓库 `deploy/nginx.conf`）。登录后在站内导航「开发者中心」（`/developer`）即可自助登记应用、查看接入配置（issuer、端点与 scope 说明）；管理面的 `/api/admin/oauth/clients`（需 `auth.oauth.manage`）用于平台侧治理所有客户端——两边写的是同一张表、走同一份校验，差别只在授权判定（归属 vs 权限码）。
:::

## 8. 管理端接口

全部需要权限码 `auth.oauth.manage`（无权限返回 `403`）。

| 方法与路径 | 作用 |
|---|---|
| `GET /api/admin/oauth/clients` | 列出全部客户端 |
| `POST /api/admin/oauth/clients` | 创建客户端 |
| `PUT /api/admin/oauth/clients/{id}` | 部分更新 |
| `DELETE /api/admin/oauth/clients/{id}` | 删除客户端 |
| `POST /api/admin/oauth/clients/{id}/rotate-secret` | 轮换密钥 |
| `POST /api/admin/oauth/clients/{id}/revoke-tokens` | 吊销该客户端名下未过期的令牌 |
| `POST /api/admin/users/{id}/revoke-oauth-tokens` | 吊销某用户授出的全部第三方令牌 |
| `GET /api/admin/oauth/audits?client_id=&limit=` | 读授权审计 |

各接口的响应与副作用：

- `GET /api/admin/oauth/clients`：响应 `{"items":[...]}`，不含密钥哈希。
- `POST /api/admin/oauth/clients`：响应 `{"client":{...},"client_secret":"<一次性明文>"}`。
- `PUT /api/admin/oauth/clients/{id}`：只改传入字段：`name` / `description` / `homepage_url` / `redirect_uris` / `scopes` / `trusted` / `disabled` / `verified`。
- `DELETE /api/admin/oauth/clients/{id}`：其授权码与令牌随之级联删除并立即作废。
- 预置第一方种子客户端拒绝删除（`seeded_client_immutable`），要停用请用 `disabled=true`。
- `POST /api/admin/oauth/clients/{id}/rotate-secret`：同样只返回一次明文，旧密钥立即失效，需同步更新对端配置。
- `POST /api/admin/oauth/clients/{id}/revoke-tokens`：响应 `{"revoked": n}`，同时作废它尚未兑换的授权码。
- `POST /api/admin/users/{id}/revoke-oauth-tokens`：只动 OAuth 令牌，不影响该用户自己的登录会话。
- `GET /api/admin/oauth/audits?client_id=&limit=`：响应 `{"items":[...]}`。`limit` 默认 100，非正数或大于 500 一律回落成 100；`client_id` 可选过滤。

创建请求体字段：

- `client_id`：可选，不传由服务端生成 `mfc-` 前缀的 id，形状 `^[a-z][a-z0-9_-]{2,63}$`。
- `name`：必填，上限 120 字符。
- `redirect_uris`：必填，即回调白名单。
- `scopes`：可选，默认全部受支持项。
- `trusted`、`disabled`。
- 管理面还可传 `description`、`homepage_url` 与 `verified`。

其他要点：

- 明文 `client_secret` 只在创建与轮换的响应里出现一次。库里只存 bcrypt 哈希，之后无法再读，丢了只能重新轮换。
- 删除客户端不会删除审计记录：审计只按 `client_id` 文本关联，不建外键，历史同意与拒绝仍可查。
- 审计动作取值：`consent_allow`、`consent_deny`、`trusted_allow`、`client_create`、`client_update`、`client_secret_rotated`、`client_deleted`、`tokens_revoked`。

客户端登记与归属规则见[客户端登记与归属](#客户端登记与归属)。管理者在账号管理台 `/admin/account/` 的 OAuth 页签治理所有客户端；与开发者中心按本人归属管理应用的权限不同。

### 撤回范围

用户自助撤回的请求、响应及历史保留规则统一见[认证与凭证](/api-auth#第三方授权管理-自助撤回)。三种操作的作用范围如下：

| 操作 | 门槛 | 范围 |
| --- | --- | --- |
| `DELETE /api/auth/oauth-grants/{client_id}` | 本人登录会话 | 本人在一个应用下的授权 |
| `POST /api/admin/oauth/clients/{id}/revoke-tokens` | `auth.oauth.manage` | 该客户端名下所有用户 |
| `POST /api/admin/users/{id}/revoke-oauth-tokens` | `auth.oauth.manage` | 该用户授出的全部第三方令牌 |

## 9. 已知限制

下面都是当前实现的现状，接入前请按它们设计：

- **没有 `refresh_token`**：访问令牌 15 分钟到期后只能重新走完整授权流程。
  想要更长的登录态，要么让本地会话短于 15 分钟并接受重新授权，要么由下游自己维护会话（授权只用于首次身份确认）。
- **同意不记忆**：同一用户对同一非 trusted 客户端的每次授权都会重新渲染同意页，没有「已授权免再次确认」。
- **撤销边界**：用户自助撤回与管理端批量吊销的范围见[撤回范围](#撤回范围)；没有 RFC 7009 的 `POST /api/oauth/revoke` 或标准 OAuth introspection 接口。
- 下游若用 JWKS 本地验签（无状态 JWT），撤销后只能等 TTL 自然过期（最长 15 分钟）。
- 能即时生效的只有回本服务判定的路径——`userinfo` 以服务端存活令牌行为准，客户端被停用后连换码都会被拒。
- **jti 注销集合是单实例内存实现**：即时的批量吊销只在处理该请求的那个实例内生效。
  横向扩容后不要依赖内存状态，以令牌行判定（`userinfo`）为准。
- **账号服务没有机器可读的 OpenAPI**：目录服务的 `GET /api/openapi.json` 只覆盖 `/api/catalog/*` 与 `/api/admin/catalog-*`，
  不含 `/api/oauth/*` 与 `/api/admin/oauth/*`（它们属于独立账号服务）。
- 本页的授权流程和客户端治理说明就是这些端点的权威契约，字段与错误码以本文与目标实例响应为准。
  如需机器可读描述，需要账号服务另出一份 spec。

## 10. 最小可运行检查清单

联调前的准备：

- [ ] 客户端已登记：`client_id`、回调白名单（整串精确）、`scopes`、是否为 `trusted`；创建时把明文 `client_secret` 存进密钥管理。
- [ ] 端点是按 `issuer` 拼出来的（`issuer` + `/oauth/authorize` 等），没有写死站点根路径。
- [ ] 授权地址里的 `redirect_uri` 与登记值逐字一致（协议、主机、端口、路径、末尾斜杠、query 全都要对）。

流程自检：

- [ ] `state` 每次随机生成，回调时校验，不一致就丢弃这次回调。
- [ ] PKCE 用 S256：verifier 43–128 字符，`code_challenge = BASE64URL(SHA256(verifier))` 去掉 `=`，换码时带同一个 verifier。
- [ ] 四条路径都点过：未登录跳账号页、同意页、同意回跳（`code` + `state`）、拒绝回跳（`error=access_denied` 且无 `code`）。
- [ ] 令牌响应里的 `scope` 与同意页展示的权限项一致（等于「客户端白名单 ∩ 请求」）。
- [ ] 核对响应字段：`token_type=Bearer`、`expires_in=900`、没有 `refresh_token`、`id_token` 能用 JWKS 验签通过。
- [ ] `userinfo` 只在服务端调用（Bearer 令牌不下发到浏览器）；收到 401 `invalid_token` 时清理本地会话并要求重新授权。
- [ ] 授权码只兑换一次，重复兑换按 `expired_or_used_code` 处理（不要当 5xx 重试）。
- [ ] 联调脚本尊重 429 + `Retry-After` 退避。

上线前：

- [ ] 过期与撤销都演练过：等 15 分钟自然过期，以及管理端 `revoke-tokens` 后 `userinfo` 立即 401。
- [ ] 明文 `client_secret`、`access_token`、`id_token` 不进日志、不进前端、不进版本库。
