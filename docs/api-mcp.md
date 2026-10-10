---
title: 云端 MCP
group: api
order: 4
---

# 云端 MCP

MCP 将 MetaFusion API 和编目技能提供给 Agent。支持 Streamable HTTP 的客户端连接实例的 `/mcp`，在浏览器使用 MetaFusion 账号登录、选择权限后即可调用，无须安装脚本、Node.js 或 Python。

客户端配置示例：

```json
{"mcpServers":{"metafusion":{"url":"https://findverse.cc/mcp"}}}
```

实际配置字段以客户端为准。端点使用 OAuth 授权码、PKCE S256 与 refresh token；客户端根据发现文档注册。只把 MCP 签发的资源绑定令牌发往 MCP，不直接粘贴账号会话或 PAT。

## 授权与额度

打开 `/mcp/manage` 可查看客户端授权、缩减权限或撤销；扩大权限需要重新授权。工具沿用 API 的权限、数据可见性和审计，不能获得账号本身没有的权限。

普通账号读写默认各 **180 RPM**，按用户分别计数，admin 组免业务 RPM 限流。免限流不免权限与数据校验。计数当前按服务进程维护，多副本不提供全局共享额度；配置值不能证明可承载上万同时查询。

MCP 授权撤销后下一次请求被拒绝，正在执行的请求可能完成；在账号中心单独吊销底层 PAT 或改变权限，业务服务最多有 60 秒内省缓存。

## 平台工具

| 工具 | 用途 |
| --- | --- |
| metafusion_api_call | 调用现有公共 API：搜索、创建与编辑实体、关系、定义、导入、通知、互动、存储和已授权的管理操作；支持 JSON、查询参数、base64 与 multipart |
| metafusion_api_contract | 当前目录 OpenAPI 与具体操作模式 |
| metafusion_reference | 云端读取版本锁定的技能或其他子系统 API 手册 |
| metafusion_search / relationships / candidates / checkout | 常用查询、候选核查与版本快照 |
| metafusion_commit_prepare / commit | 云端生成提交 ID、封存载荷、预览、推送与回执恢复 |
| metafusion_commit_preview / commit_push | 直接传入完整原生提交载荷 |
| metafusion_file_inspect / upload | 根据 Agent 提供的 URL 或内容，在云端计算摘要、上传并绑定文件 |

动态字段仍以 definitions 为准，分页、冲突码和失败结果沿用原生 API。普通编目先查候选、checkout、构造提交、preview，再显式 push；封存载荷保留 30 天。未知推送结果用同 ID 查回执；真实冲突需重新取舍和 rebase，见[提交协议](./api-commits.md)。

文件 URL 必须是服务端可访问的公开 HTTPS 地址。URL 文件上限 1 GiB；base64 受 8 MiB 请求体上限约束。工具失败时保留 asset_id，检查原生存储状态后再处理。

## Agent 自主信息获取

信息获取流程由 Agent 自己决定，包括检索工具、来源选择、顺序与证据判断。MCP 只执行明确请求的平台操作，不主动检索或选源、不根据外部网页自动生成或发布编目结果。skill 提供平台契约、编目规范和操作方法。

账号登录、口令、OAuth 授权与机器令牌自助管理仍在浏览器完成。普通平台与管理 API 则直接通过 MCP 使用已批准权限。
