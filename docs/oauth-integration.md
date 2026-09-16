---
title: "第三方站点接入 OAuth 授权"
description: "把 MetaFusion 作为 OAuth 2.0 / OIDC 授权方接入第三方站点：发现文档、授权码与 PKCE、令牌与 userinfo、客户端管理端与已知限制。"
order: 37
group: "api"
---

# 第三方站点接入 OAuth 授权

MetaFusion 账号服务对外提供 OAuth 2.0 授权码流程与 OIDC 子集（发现文档、`id_token`、JWKS），
第三方站点用它在自己的站点上实现「用 MetaFusion 账号登录」，不需要接触用户密码。
本页按**当前实例的实测契约**写：端点、参数、响应字段与错误码可以直接照抄，
把示例里的 `https://<your-host>` 换成你自己的实例地址即可。

::: tip 与本页的关系
[认证与凭证](/api-auth) 讲实例自身的登录、会话与令牌；本页只讲**第三方接入**这条链路。
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
| 客户端列表（登录可见） | `GET /api/oauth/clients` | 登录 |
| 客户端管理与审计 | `/api/admin/oauth/*`、`POST /api/admin/users/{id}/revoke-oauth-tokens` | 权限码 `auth.oauth.manage` |
| 用户自查与自助撤回 | `GET /api/auth/oauth-grants`、`DELETE /api/auth/oauth-grants/{client_id}` | 登录即可（只作用于本人） |

`/api/oauth/authorize` 与 `/api/oauth/token` 与登录类接口共用**账号服务**按来源 IP 的固定窗口限流
（15 次/分钟），超限返回 `429` + `Retry-After: 60` 与 `{"error":"rate_limited"}`；
**网关**对 `/api/oauth/` 另有 `5 r/s`（`burst 10`）的入口限流。两处都按 `429` + `Retry-After` 退避重试。

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
| `claims_supported` | `["sub", "preferred_username", "email", "role"]` |

根路径的 `/.well-known/openid-configuration`（OIDC 标准入口）与 `/api/.well-known/openid-configuration`
返回同一份文档；下面的端点地址一律**以 `issuer` 为基准拼接**，不要写死站点根路径。

## 2. 授权码流程

四个动作：终端用户在浏览器访问授权地址 → 同意 → 带 `code` 回跳 → 服务端换 `access_token` → 调 `userinfo`。

### 2.1 GET /api/oauth/authorize

| 参数 | 必填 | 说明 |
|---|---|---|
| `client_id` | 是 | 管理端登记的客户端 id |
| `redirect_uri` | 是 | 必须与登记的回调白名单**逐字相等** |
| `response_type` | 是 | 只能是 `code` |
| `scope` | 否 | 空格分隔，取值见下方表格；不传按 `profile` 处理 |
| `state` | 建议 | 原样带回，第三方用它对齐自己发起的请求 |
| `code_challenge` | 否 | PKCE 的 challenge（建议带） |
| `code_challenge_method` | 否 | `S256`（推荐）或 `plain` |

行为要点：

- **未登录**：`302` 到账号页并带 `return_to=<本次授权请求的原始地址>`，登录后回到同一次授权请求，
  `state`、PKCE 参数与 `scope` 都不会丢。第三方不需要自己处理这一步。
- **非 trusted 客户端会先渲染同意页**，展示客户端名称与 `client_id`、回跳地址，以及按收敛结果逐项列出的权限说明；
  用户点「同意并继续」才继续，点「拒绝」直接回跳。
- **trusted 客户端**（预置第一方）跳过同意页，直接发码。
- **同意**：`302` 到 `redirect_uri?code=<code>&state=<state>`（`redirect_uri` 自带 query 时用 `&` 续接，两个值都做 URL 转义）。
- **拒绝**：`302` 到 `redirect_uri?error=access_denied&state=<state>`，**不带 `code`**。
- 授权码 **10 分钟有效、单次使用**：成功兑换一次即失效；并发双兑只有一个成功，另一个拿到 `expired_or_used_code`。

::: warning 不要替用户拼接 `consent=allow`
同意页的两个按钮，就是在**同一次**授权请求上追加 `consent=allow` / `consent=deny`。
第三方在自己的站点里替用户拼一个带 `consent=allow` 的授权地址，等于绕过同意页，请不要这么做。
:::

### 2.2 scope 收敛：永远是「客户端白名单 ∩ 请求」

发放的 scope 只能是交集，第三方无法靠请求参数拿到客户端没被允许的权限：

- 客户端白名单在管理端登记，可选项只有 `openid` / `profile` / `email`；
- 实测：请求 `openid profile email`、客户端白名单只有 `openid profile` 时，同意页只列两项，
  换码响应里的 `scope` 也是 `"openid profile"`；
- 请求里含不受支持的 scope（例如 `phone`）→ `400`，且**不静默丢弃**，响应点明是哪一项：
  `{"error":"invalid_scope","unsupported_scopes":["phone"],"supported_scopes":["openid","profile","email"]}`；
- 收敛后一个 scope 都不剩 → `400 {"error":"invalid_scope", ...}`；
- 换码时会按客户端**当前**白名单再收敛一次：管理员事后收紧白名单，只会让令牌 scope 更少，不会变多。

| scope | 含义 | 同意页上的说明 | 相关声明 |
|---|---|---|---|
| `openid` | 确认身份 | 返回账号 ID（`sub`） | `sub` |
| `profile` | 读取基本资料 | 用户名与角色 | `username`、`role` |
| `email` | 读取邮箱 | 账号邮箱地址 | `email` |

::: warning userinfo 不按 scope 裁剪
这三个 scope 只影响授权时展示的权限项与令牌里的 `scope` 字段，`userinfo` 的返回字段**不随 scope 变化**；
「最小权限」只能靠第三方自己不多读、不多存（见「已知限制」）。
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
  "user": { "id": "<user-uuid>", "username": "<username>", "email": "<email>", "role": "user" },
  "id_token": "<rs256-jwt>",
  "id_token_expires_at": 1767225600
}
```

::: danger expires_in 是真实 TTL：900 秒（15 分钟），且没有 refresh_token
- `expires_in = 900` 就是访问令牌的真实有效期，到期后**必须重新走一次授权流程**；
- 响应里**没有 `refresh_token`**，也没有刷新端点，这是当前有意的设计——不要按「支持刷新」实现；
- `id_token` 是 RS256 JWT（`aud` 为该 `client_id`），可用 `jwks_uri` 的公钥本地验签；
  `id_token_expires_at` 是 Unix 秒，与访问令牌同一有效期。
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

换码**先校验后标记已用**：`code_verifier` 填错不会作废这个授权码，可以改了再来；
但成功兑换一次后该码立即失效。

## 4. 读取用户信息：GET /api/oauth/userinfo

```bash
curl -sS "https://<your-host>/api/oauth/userinfo" -H "Authorization: Bearer <access-token>"
```

```json
{ "sub": "<user-uuid>", "id": "<user-uuid>", "username": "<username>", "role": "user", "email": "<email>" }
```

| 响应 | `error` | 触发条件 |
|---|---|---|
| 401 | `missing_token` | 没带 `Authorization: Bearer` 请求头 |
| 401 | `invalid_token` | 令牌过期、已被吊销、其客户端已停用，或根本不是本服务签发的令牌 |

失效判定以**服务端的存活令牌记录**为准（不是只看 JWT 能否验签），所以「吊销 / 停用」在这里是即时生效的。
当前实现也允许实例自身的登录会话令牌调用 `userinfo`（便于排障）；第三方仍应始终使用授权码换来的 `access_token`。

## 5. 回调地址白名单规则

登记与授权两处用的是同一套规则：

- 每条都必须是 `http(s)` 绝对地址且带主机——`http://localhost:3000/callback` 这类本地地址可以，但必须整串登记；
- **不接受通配符**（`*`）、**不接受 URL 片段**（`#...`）、**不接受内嵌凭据**（`https://user:pass@host/...`）；
- 只做**整串精确匹配**：不做前缀匹配、不做子域匹配，也不做大小写或末尾斜杠的等价处理，端口与 query 同样算差异；
- 授权请求里的 `redirect_uri` 不在白名单 → `400 invalid_redirect_uri`，不会跳转到那个地址。

## 6. PKCE

用 S256。发现文档里的 `code_challenge_methods_supported` 同时列出 `S256` 与 `plain` 只是兼容：
`plain` 等于把 verifier 明文发出去，不建议使用。

- 生成 `code_verifier`：43–128 字符（RFC 7636 允许的字符集）；
- 计算 `code_challenge = BASE64URL(SHA256(code_verifier))`，去掉末尾的 `=` 填充；
- 授权请求带 `code_challenge` + `code_challenge_method=S256`，换码时必须带**同一个** `code_verifier`；
- 带 `code_challenge` 的码，缺 `code_verifier` 或值不匹配 → `invalid_code_verifier`。

## 7. 示例一：curl（授权码流程，不做 PKCE）

```bash
# 依赖：bash + curl + python3（只用标准库做 URL 编码与拼地址）
MF_HOST="https://<your-host>"
MF_CLIENT_ID="<client-id>"
MF_CLIENT_SECRET="<client-secret>"
MF_REDIRECT_URI="https://<your-site>/callback"   # 必须与登记的白名单逐字一致

# 0) 先读发现文档
curl -sS "$MF_HOST/api/.well-known/openid-configuration"

# 1) 打印授权地址：在浏览器里打开、登录并同意；同意后浏览器会 302 到回调地址
python3 - "$MF_HOST" "$MF_CLIENT_ID" "$MF_REDIRECT_URI" <<'PY'
import sys, urllib.parse
host, client_id, redirect_uri = sys.argv[1:4]
print(host + "/api/oauth/authorize?" + urllib.parse.urlencode({
    "client_id": client_id,
    "redirect_uri": redirect_uri,
    "response_type": "code",
    "scope": "openid profile email",
    "state": "demo-state-please-randomize",
}))
PY

# 2) 从回调地址的查询串里取出 code（同时确认 state 与第 1 步一致），然后换码
MF_CODE="<回调地址里的 code>"
curl -sS -X POST "$MF_HOST/api/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=$MF_CODE" \
  --data-urlencode "client_id=$MF_CLIENT_ID" \
  --data-urlencode "client_secret=$MF_CLIENT_SECRET" \
  --data-urlencode "redirect_uri=$MF_REDIRECT_URI"

# 3) 用上一步响应里的 access_token 读 userinfo
MF_ACCESS_TOKEN="<上一步响应里的 access_token>"
curl -sS "$MF_HOST/api/oauth/userinfo" -H "Authorization: Bearer $MF_ACCESS_TOKEN"
```

## 8. 示例二：Python（授权码 + PKCE S256，一次跑通）

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

## 9. 管理端接口

全部需要权限码 `auth.oauth.manage`（无权限返回 `403`）。

| 方法与路径 | 作用 | 备注 |
|---|---|---|
| `GET /api/admin/oauth/clients` | 列出全部客户端 | 响应 `{"items":[...]}`，不含密钥哈希 |
| `POST /api/admin/oauth/clients` | 创建客户端 | 响应 `{"client":{...},"client_secret":"<一次性明文>"}` |
| `PUT /api/admin/oauth/clients/{id}` | 部分更新 | 只改传入字段：`name` / `description` / `homepage_url` / `redirect_uris` / `scopes` / `trusted` / `disabled` / `verified` |
| `DELETE /api/admin/oauth/clients/{id}` | 删除客户端 | 其授权码与令牌随之级联删除并立即作废；预置第一方种子客户端拒绝删除（`seeded_client_immutable`），要停用请用 `disabled=true` |
| `POST /api/admin/oauth/clients/{id}/rotate-secret` | 轮换密钥 | 同样只返回一次明文；**旧密钥立即失效**，需同步更新对端配置 |
| `POST /api/admin/oauth/clients/{id}/revoke-tokens` | 吊销该客户端名下未过期的令牌 | 响应 `{"revoked": n}`，同时作废它尚未兑换的授权码 |
| `POST /api/admin/users/{id}/revoke-oauth-tokens` | 吊销某用户授出的全部第三方令牌 | 只动 OAuth 令牌，不影响该用户自己的登录会话 |
| `GET /api/admin/oauth/audits?client_id=&limit=` | 读授权审计 | 响应 `{"items":[...]}`；`limit` 默认 100（非正数或大于 500 一律回落成 100）；`client_id` 可选过滤 |

要点：

- 创建请求体：`client_id`（可选，不传由服务端生成 `mfc-` 前缀的 id，形状 `^[a-z][a-z0-9_-]{2,63}$`）、
  `name`（必填，上限 120 字符）、`redirect_uris`（必填，即回调白名单）、`scopes`（可选，默认全部受支持项）、`trusted`、`disabled`；
  管理面还可传 `description`、`homepage_url` 与 `verified`。
- **明文 `client_secret` 只在创建与轮换的响应里出现一次**：库里只存 bcrypt 哈希，之后无法再读，丢了只能重新轮换。
- 删除客户端**不会**删除审计记录（审计只按 `client_id` 文本关联，不建外键），历史同意与拒绝仍可查。
- 审计动作取值：`consent_allow`、`consent_deny`、`trusted_allow`、`client_create`、`client_update`、
  `client_secret_rotated`、`client_deleted`、`tokens_revoked`。
- 另有 `GET /api/oauth/clients`：登录后可见的客户端基本信息列表（不含密钥哈希），供普通用户与前端读取。

### 9.2 用户自助撤回授权（与上面两条吊销的区别）

```http
# 我给过哪些站点授权（登录令牌或 Cookie）
GET /api/auth/oauth-grants

# 撤回其中一个：删除本人该应用下的未过期的令牌与未兑换的授权码
DELETE /api/auth/oauth-grants/{client_id}
```

`GET` 返回 `items[]`：`client_id`、`name`、`scopes`、`active`、`last_authorized_at`、`expires_at`。
`active` 为 true 表示当前还有未过期的令牌；**授权过但令牌已过期的应用同样列出**（时间取自同意审计），
所以这是"我给过哪些授权"的全貌，而不是只有当前生效的那些。

`DELETE` 返回 `{"ok":true,"revoked":N}`：`N` 是被删掉的令牌条数。本来就没有有效令牌时 `N=0`，
请求仍然成功（幂等）；未知 `client_id` 返回 `404 client_not_found`；未登录返回 `401 authentication_required`。
撤回后该应用在列表里变成 `active:false`，同意记录保留（用户能看到"曾授权过"）。

| | 用户自助（本节） | 管理端按客户端 | 管理端按用户 |
|---|---|---|---|
| 端点 | `DELETE /api/auth/oauth-grants/{client_id}` | `POST /api/admin/oauth/clients/{id}/revoke-tokens` | `POST /api/admin/users/{id}/revoke-oauth-tokens` |
| 门槛 | 登录（只作用于本人） | `auth.oauth.manage` | `auth.oauth.manage` |
| 范围 | 我一个应用 | 该客户端名下所有用户 | 该用户所有应用 |
| 典型用途 | 用户收回授权 | 应急断开接入方 | 账号处置 |

### 9.1 用管理界面办这些事（不必写 curl）

> **自助登记入口**：网关已把 `/api/developer/*` 分流到账号服务。登录后在站内「开发者中心」（`/developer`，接口
> `GET /api/developer/overview`、`GET|POST /api/developer/apps`、`PUT|DELETE /api/developer/apps/{id}`、
> `POST /api/developer/apps/{id}/rotate-secret`）自助登记并管理自己的应用——按**应用归属**授权，任何登录账号可用，
> 每个账号最多 20 个应用（超限 `app_quota_exceeded`）。
> 下面的管理台页签是平台侧治理所有客户端的入口（需 `auth.oauth.manage`），两者写同一张表。

管理台（`/admin`）有「**OAuth 客户端**」页签，覆盖上面全部管理动作；**只有持 `auth.oauth.manage` 的账号能看到该页签**，无权限时入口不显示（接口侧仍是 403，两层一致）。

| 想做的事 | 界面位置 |
| --- | --- |
| 建一个新接入方 | 页签内「新建客户端」：填 `client_id`（可留空由服务端生成）、名称、**回调白名单（一行一个）**、scope（多选）、是否受信 |
| 拿到接入密钥 | 创建成功后**当场弹出的对话框**里显示一次性 `client_secret` + 复制按钮；轮换密钥同理 |
| 换密钥 | 列表行「轮换密钥」→ 确认后弹出**新的**一次性明文，**旧密钥立即失效** |
| 应急断开某个接入方 | 行内「吊销令牌」（作废该客户端名下未过期令牌与未兑换授权码）或「删除」 |
| 追查谁在什么时候授过权 | 页签内的审计面板，可按 `client_id` 过滤 |

操作上要记住三点：

1. **一次性明文关掉就取不回**：界面不提供"再次查看密钥"入口，列表接口也不返回密钥（库里只有哈希）。丢了只能轮换。
2. **删除是不可撤销的**：界面会二次确认；删除后该客户端的令牌与授权码级联作废，但**审计记录仍在**（审计按 `client_id` 文本关联）。
3. **回调白名单是安全边界**：界面里一行一个地址，必须与对端实际使用的回调完全一致（见第 5 节的匹配规则），改完记得让对方同步。

## 10. 已知限制

下面都是当前实现的现状，接入前请按它们设计：

- **没有 `refresh_token`**：访问令牌 15 分钟到期后只能重新走完整授权流程。想要更长的登录态，
  要么让本地会话短于 15 分钟并接受重新授权，要么由下游自己维护会话（授权只用于首次身份确认）。
- **`userinfo` 不按 scope 裁剪声明**：不论令牌 scope 是什么，返回的都是 `sub` / `id` / `username` / `role` / `email` 五项；
  第三方不能靠 scope 推断「拿到了哪些字段」，要做到最小权限只能自己少读、少存。
- **同意不记忆**：同一用户对同一非 trusted 客户端的每次授权都会重新渲染同意页，没有「已授权免再次确认」。
- **终端用户可自查与自助撤回**（`GET /api/auth/oauth-grants`、`DELETE /api/auth/oauth-grants/{client_id}`，见 §9.2）；
  仍**没有** introspection 式的"撤销所有下游令牌"能力，撤回只影响本服务持有的第三方令牌。
- **撤销口径**：第三方撤销走终端用户自助撤回（`DELETE /api/auth/oauth-grants/{client_id}`，见 §9.2），
  没有 RFC 7009 的 `POST /api/oauth/revoke`，也没有 introspection 接口。
  下游若用 JWKS 本地验签（无状态 JWT），撤销后只能等 TTL 自然过期（最长 15 分钟）；
  能即时生效的只有回本服务判定的路径——`userinfo` 以服务端存活令牌行为准，客户端被停用后连换码都会被拒。
- **jti 注销集合是单实例内存实现**：即时的批量吊销只在处理该请求的那个实例内生效；
  横向扩容后不要依赖内存状态，以令牌行判定（`userinfo`）为准。
- **账号服务没有机器可读的 OpenAPI**：目录服务的 `GET /api/openapi.json` 只覆盖 `/api/catalog/*` 与 `/api/admin/catalog-*`，
  **不含** `/api/oauth/*` 与 `/api/admin/oauth/*`（它们属于独立账号服务）。本文第 2–9 节就是这些端点的权威契约，
  字段与错误码以本文与目标实例响应为准；如需机器可读描述，需要账号服务另出一份 spec。

## 11. 最小可运行检查清单

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
