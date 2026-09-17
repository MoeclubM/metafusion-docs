---
title: "常见问题"
description: "FAQ：邀请、审核、播放、API、限流等常见问题解答。"
order: 61
group: "meta"
---

# 常见问题（FAQ）

## 邀请与注册

**Q：现在注册需要邀请码吗？**  
A：取决于实例设置。注册默认关闭（`registration_enabled`），由持 `auth.settings.manage` 权限的成员打开；打开后若 `invite_required` 为真，注册必须带有效邀请码（缺少为 `invite_required`，无效为 `invalid_invite_code`）。登录页会按当前设置提示并显示邀请码输入框。

**Q：在哪里获取我的邀请码？**  
A：邀请码由持 `auth.invites.manage` 权限的成员签发：登录后在个人邀请页（`/invites`）或管理台签发（`GET|POST /api/auth/invite`），可设 `note`、使用次数（缺省 1、上限 1000）与有效期（不给即长期有效）。

邀请码是 16 位十六进制分组，形如 `A1B2-C3D4-E5F6-7890`，没有 `MF-` 前缀；页面同时列出由本人签发的码与其带来的成员。

## 浏览与媒体

**Q：游客能浏览哪些内容？**  
A：公开的元数据（作品、发行版、创作者、标签与货架、关系图谱、关键词检索结果）与社区公开讨论都可匿名只读访问；未发布的条目只有创建者等有权限者可见。下载原档、上传资源或在社区发帖时，系统会引导登录。

**Q：下载资源时提示无权限？**  
A：原始文件受访问控制保护：需要登录，且至少一个绑定该文件的实体对你可见（上传者本人与管理员直通）。请确认当前处于登录状态；在外部脚本或第三方客户端中调用时，请携带有效的会话令牌（`Authorization: Bearer <token>` 或 Cookie `mf_session`）。平台不提供在线播放与预览流，只提供原档下载。

**Q：封面为什么无法正常显示？**  
A：图片是**引用**而不是上传到目录服务：写入 `pictures` 时服务端会校验 URL 是否合法，但不会去抓取或转存内容。请填写可公开访问的官方图片直链；需要长期稳定的地址，就把文件交给存储服务上传，再用 `GET /api/storage/assets/:id/content` 引用（对象存储模式下的预签名地址会过期，不适合长期引用）。

## 编辑与审核

**Q：为什么提交的词条或修改被退回？**  
A：常见原因包括：缺少修改说明（`edit_note`）、缺少参考来源（`sources`）、标题命名或关系连接有误、或属于重复创建。按审核成员给出的提示修正后重新提交即可。

**Q：如何避免创建重复的词条？**  
A：在新建词条前，请先在顶部搜索栏用作品原名与常见译名做检索——检索只做标题与译文的子串匹配，不识别罗马音，也不匹配唱片编号等外部标识，检索不出来时优先完善与复用已有条目。

## 开发者与 API

**Q：未登录（匿名访问）支持通过程序调用哪些数据？**  
A：公开元数据（作品目录、实体详情、关键词检索、标签与货架、关系图谱及社区公开讨论等）都支持匿名只读调用；内容写入、媒体上传、原档下载等操作必须登录并携带会话令牌（或经 OAuth 2.0 授权的访问令牌），且账号需具备对应权限码。

**Q：为什么通过 API 写入数据时提示错误？**  
A：先确认已携带有效会话（`Authorization: Bearer <token>` 或 Cookie `mf_session`），且账号具备对应权限码（例如维护公开条目需要 `catalog.entity.edit`，未持有时只能存草稿或提交审核）。写入请带上 `edit_note`（修改说明）与 `sources`（参考来源），它们会记入修订历史。详情见 [认证与凭证](/api-auth) 与 [新建与编辑](/api-edit)。

**Q：平台接口调用频率限制是多少？**  
A：限流按 IP 计数、不区分是否登录，实际共有三层：

- **账号服务**：认证写入类接口（`POST /api/setup`、`POST /api/auth/login`、`POST /api/auth/refresh`、`POST /api/auth/register`）按 IP 15 次/分钟（进程内存固定窗口）；
- **目录服务的路由级限流**（按 IP + 路由计数）：`GET /api/catalog/entities`、`GET /api/catalog/tags`、`POST /api/catalog/expressions/details` 各 120 次/分钟，`GET /api/catalog/shelves/feed` 60 次/分钟，`GET /api/users/:id/contributions` 120 次/分钟，`GET /api/catalog/compare`、`POST /api/importer/preview` 各 10 次/分钟；
- **网关限流**（按 IP）：`/api/` 与 `/api/catalog/` 30 r/s（burst 50），`/api/auth/` 与 `/api/setup` 5 r/s、burst 10，`/api/storage/` 30 r/s、burst 100（分片上传天然是多请求，故只放大突发额度）。

三层超限都返回 `429`。目录服务的路由级限流会带 `Retry-After`（秒），按该头退避即可；网关自身拦下的 `429` 不带该头，按秒级退避重试。**没有**全站「匿名 60 次/分钟、登录 600 次/分钟」这类配额，响应里也**没有** `X-RateLimit-*` 头。

## 部署与运维

**Q：需要额外部署搜索引擎或缓存吗？**  
A：当前不需要——检索是 PostgreSQL 上的一次子串匹配（`title ILIKE` 加译文 JSON 文本匹配），限流计数在服务进程内存里。两者都为数据量上到亿级时预留：OpenSearch 用 `--profile search` 起（编排已就绪，尚未接线，开启它不会改变检索行为），Redis 也已编排备用。

**Q：文档站如何访问与本地预览？**  
A：线上环境可通过 `/docs/` 直接访问（由网关自动代理，容器从本仓库构建）；本地预览在本仓库根目录运行 `npm install && npm run dev`。
