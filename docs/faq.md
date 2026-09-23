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
A：邀请码由持 `auth.invites.manage` 权限的成员签发：登录后在个人邀请页（`/invites`）或账号管理台（`/admin/account/invites/`）签发（`GET|POST /api/auth/invite`），可设 `note`、使用次数（缺省 1、上限 1000）与有效期（不给即长期有效）。

邀请码是 16 位十六进制分组，形如 `A1B2-C3D4-E5F6-7890`，没有 `MF-` 前缀；页面同时列出由本人签发的码与其带来的成员。

## 浏览与媒体

**Q：游客能浏览哪些内容？**  
A：公开元数据与社区讨论可匿名只读。未发布条目仅创建者等有权限者可见；上传资源和发帖需登录。原档读取按绑定实体可见性判定，公开实体绑定的文件可匿名读取。

**Q：下载资源时提示无权限？**  
A：原始文件按绑定实体可见性控制：上传者与审核者可直读，公开实体绑定的文件可匿名读取，实体不可见时不能读取。上传与绑定需登录并具备相应权限。平台只分发原档，不提供在线播放或预览流。

**Q：封面为什么无法正常显示？**  
A：图片是**引用**而不是上传到目录服务：写入 `pictures` 时服务端会校验 URL 是否合法，但不会去抓取或转存内容。请填写可公开访问的官方图片直链；需要长期稳定的地址，就把文件交给存储服务上传，再用 `GET /api/storage/assets/:id/content` 引用（对象存储模式下的预签名地址会过期，不适合长期引用）。

## 编辑与审核

**Q：为什么提交的词条或修改被退回？**  
A：常见原因包括：缺少修改说明（`edit_note`）、缺少参考来源（`sources`）、标题命名或关系连接有误、或属于重复创建。按审核成员给出的提示修正后重新提交即可。

**Q：如何避免创建重复的词条？**  
A：在新建词条前，请先在顶部搜索栏用作品原名与常见译名做检索——检索只做标题与译文的子串匹配，不识别罗马音，也不匹配唱片编号等外部标识，检索不出来时优先完善与复用已有条目。

## 开发者与 API

**Q：未登录（匿名访问）支持通过程序调用哪些数据？**  
A：公开元数据与社区公开讨论支持匿名只读调用；公开实体绑定的文件也可匿名读取。内容写入、媒体上传与绑定需登录及对应权限码。

**Q：为什么通过 API 写入数据时提示错误？**  
A：确认凭据有效且账号具备对应权限码；例如缺少 `catalog.entity.edit` 时只能存草稿或提交审核。每次写入还需提供 `edit_note` 与 `sources`。详情见 [认证与凭证](/api-auth) 与 [新建与编辑](/api-edit)。

**Q：平台接口调用频率限制是多少？**  
A：限流按 IP 计数、不区分是否登录，实际共有三层：

- **账号服务**：认证写入类接口（`POST /api/setup`、`POST /api/auth/login`、`POST /api/auth/refresh`、`POST /api/auth/register`）按 IP 15 次/分钟（进程内存固定窗口）；
- **目录服务的路由级限流**（按 IP + 路由计数）：`GET /api/catalog/entities`、`GET /api/catalog/tags`、`POST /api/catalog/expressions/details`、`GET /api/catalog/entities/stats`（需 `catalog.lifecycle.manage`）各 120 次/分钟，`GET /api/catalog/shelves/feed` 60 次/分钟，`GET /api/users/:id/contributions` 120 次/分钟，`GET /api/catalog/compare`、`POST /api/importer/preview` 各 10 次/分钟；
- **网关限流**（按 IP）：`/api/` 与 `/api/catalog/` 30 r/s（burst 50），`/api/auth/` 与 `/api/setup` 5 r/s、burst 10，`/api/storage/` 30 r/s、burst 100（分片上传天然是多请求，故只放大突发额度）。

三层超限都返回 `429`。目录服务的路由级限流会带 `Retry-After`（秒），按该头退避即可；网关自身拦下的 `429` 不带该头，按秒级退避重试。命中目录侧路由限流的路由，**每个响应**都带 `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`（窗口上限、窗口内剩余次数、距重置秒数），其余路由与其它服务不带这组头。**没有**全站「匿名 60 次/分钟、登录 600 次/分钟」这类配额。

## 部署与运维

**Q：需要额外部署搜索引擎或缓存吗？**  
A：当前不需要——检索是 PostgreSQL 上的一次子串匹配（`title ILIKE` 加译文 JSON 文本匹配），限流计数在服务进程内存里。两者都为数据量上到亿级时预留：OpenSearch 用 `--profile search` 起（编排已就绪，尚未接线，开启它不会改变检索行为），Redis 也已编排备用。

**Q：文档站如何访问与本地预览？**  
A：线上环境可通过 `/docs/` 直接访问（由网关自动代理，容器从本仓库构建）；本地预览在本仓库根目录运行 `npm install && npm run dev`。
