---
title: "社区使用"
description: "板块、发帖、回帖、收藏与社区规范指南。"
order: 40
group: "community"
---

# 社区使用指南

MetaFusion 社区遵循「浏览开放、互动需登录」的原则：板块、主题、回复与条目短评的读接口匿名可用；发帖、回复、短评与收藏需要登录，其中**发帖类写操作还要求 `community.post.create` 权限码**，置顶、板块配置与帖子巡检则需要各自的运营权限码。

## 社区板块

板块由互动服务在首次运行时播种，当前包括：

- **站点公告（announcement）**：站点公告与运营通知。
- **闲聊杂谈（casual）**：轻松闲聊与日常交流。
- **求助答疑（qa）**：使用问题、编目与功能答疑。
- **考据评注（reviews）**：版本考证、原盘评析与文献释读。
- **反馈与建议（bug_report）**：缺陷反馈、功能建议与复现信息。
- **评论专用（comment）**：条目与讨论的评论承载区，不进入信息流。

板块清单以服务端为准（`GET /api/community/boards`），前端只在请求失败时用内置兜底列表；讨论读接口匿名可用。

## 浏览与发帖

- **浏览**：社区大厅按板块列出主题，可按板块、话题标签与关键词筛选；主题字段不含语言。
- **发起话题**：选择所属板块并填写标题与正文（正文按 Markdown 渲染），可关联一个目录条目、添加话题标签。**需要 `community.post.create`**：`member` 组默认持有该码；自定义权限组未获该码时不能发帖（权限组的设计意图）。
- **参与回复**：进入主题详情页阅读完整楼层，在页面底部撰写回复，可引用指定楼层（`reply_to_post_number`）；与发主题同一权限码。
- **条目短评**：条目页的短评写入评论专用板块——它锚定条目、没有独立标题，也不进入信息流；同样需要 `community.post.create`。
- **收藏**：登录后可以收藏条目；读收藏走 `GET /api/users/:id/favorites`（按请求方的实体可见性过滤）。`/api/favorites/*` 与 `/api/records/*` 按实例响应为准（当前部署返回 404 属正常，读收藏以 `/api/users/:id/favorites` 为准）。设置页里的「收藏公开」开关当前为只读展示。
- **删除**：作者可以删除自己的主题与回复；持 `community.post.moderate` 的成员可以处置他人的主题、回复与短评。

## 用户主页数据

用户主页的数据由三个服务分别承载，一条主页会打到三条路径：

| 端点 | 归属服务 | 认证 | 返回 |
| --- | --- | --- | --- |
| `GET /api/users/:id` | 账号服务 | 匿名 | `{user, stats}`：`user` 是 `id` / `username` / `role`（`banned` 仅封禁时下发、`email` 仅本人可见），`stats.invited_count` 是邀请成功的人数（详见 [认证与凭证](/api-auth)） |
| `GET /api/users/:id/stats` | 互动服务 | 匿名 | `{"stats":{"topics_created","comments_created","favorites_count"}}` |
| `GET /api/users/:id/contributions` | 目录服务 | 匿名 | 目录侧贡献流（`all` / `revisions` / `works` / `releases` / `artists` 五个 tab），详见 [实体查询与详情](/api-entities) |

互动统计的三个数字**与对应的列表接口同源**，不是第二套口径：

- `topics_created`：本人发起的论坛主题，**评论板块的实体短评不计入**（短评锚定条目、不是主题，主题列表同样把它排除在外）
- `comments_created`：本人在 `community.posts` 里的楼中回复（前端标签「互动回复」）；主题正文不算回复（它不在 `posts` 里，已计入主题数），实体短评两边都不计——宁可少算，也不让同一行出现在两个数字里
- `favorites_count`：本人收藏的行数，与 `GET /api/users/:id/favorites` 的 `total` **完全同口径**（互动服务没有「收藏公开」标记，设置页里的开关目前是前端只读占位；目标实体自身的可见性由读取方逐条过滤，不影响计数）

边界：`:id` 不是 UUID 时返回 `404 not_found`；账号数据不归互动服务、它也不查账号库，因此**「不存在的用户」与「没有互动记录的用户」都返回 0**（收藏列表则是空页）。

## 私信

```http
GET  /api/messages/with/{id}?page=1&page_size=20   # 会话，需登录
POST /api/messages/with/{id}                        # 发信 {"body":"..."}，需登录
```

- **只能读写自己参与的会话**：会话由（当前用户, 对方）一对参与者决定，请求里没有「会话 id」这种能指向别人会话的输入，第三者的私信查出来就是空页
- 读按 `created_at DESC, id DESC` 倒序：第一页是**最近**的 20 条，往后翻是更早的；`page` 缺省 1、`page_size` 缺省 20 上限 100，越界静默取默认（不报错）；`total` 是整段会话的条数，不随窗口变化
- 读返回 `{"items":[{id,sender_id,recipient_id,body,created_at}],"total":N}`；发信返回 `{"message":{...}}`（`sender_id` 恒为当前用户，`created_at` 由数据库写入）。会话以「与某个用户」为入口，**没有**「我的会话列表」端点
- **不能给自己发**：写接口 `400 invalid_recipient`（先判收件人、再判正文）
- 正文裁剪两侧空白后必须非空且不超过 **4000 字符**（按字符数即 rune 计，不是字节——按字节算会把中文上限压到约 1/3），否则 `400 invalid_body`；入库的是裁剪后的文本
- 非 UUID 的 `:id` 一律 `404 not_found`；未登录 `401 authentication_required`。读自己的会话不报错，恒为空会话
- 对方 id 只当**外部引用**：互动服务不查账号库、也不校验对方是否存在（收件人注销后已发出的私信仍在）
- `read_at` 列已预留、当前接口不读不写：响应里**没有**「已读」字段

## 运营操作（置顶、板块配置与帖子巡检）

这些接口面向运营，都需要账号服务下发的权限码（由权限组决定，普通成员与编辑都不持有）：

| 操作 | 接口 | 所需权限码 | 可改内容 |
| --- | --- | --- | --- |
| 置顶 / 取消置顶 | `PUT /api/community/topics/{id}/pin` | `community.topic.pin` | 请求体 `{"pinned": true\|false}`；写主题的 `is_pinned` 列，主题列表里置顶项排在前面 |
| 板块配置 | `PUT /api/community/boards/{code}` | `community.board.manage` | `name`、`description`（都是**单一字符串**）、`color`、`icon`、`sort_order`、`is_enabled`、`show_in_feed` |
| 帖子巡检（只读） | `GET /api/community/posts` | `community.post.moderate` | 跨主题列**楼中回复**，`q` / `page` / `page_size`，不修改任何数据（详见下节） |

- 置顶与板块配置这两个**写**接口都是**只改传入字段**：单独切 `show_in_feed` 或 `is_enabled` 时不必回传整份配置，也就不会因为漏带字段而把配置清空。
- 板块 `code` 不可改（它是主题的板块归属键，改码要么让存量主题悬空、要么得级联改主题归属）；服务也不提供新增与删除板块：板块由种子播种、运营配置，删掉会让存量主题失去归属。
- 板块名称按单语种字符串校验：`name` 须为非空字符串（空值或空白返回 `400 invalid_payload`），`description` 可为空串；目录服务的定义 / 货架 / 外部库（`/api/admin/catalog-definitions`、`/api/admin/shelves`、`/api/admin/external-databases`）仍要求四语种（`four_locale_names_required`）。区块颜色与图标不接受空值。
- 权限与状态码：缺权限码 `403 forbidden`，未登录 `401 authentication_required`，主题或板块不存在 `404 not_found`，请求体不合法（如置顶缺 `pinned`、板块空载荷）`400 invalid_payload`。

### 帖子治理列表（只读）

`GET /api/community/posts` 是跨主题的回复巡检入口（社区管理台的「帖子治理」就用它）。此前要处置一条回复得先进主题详情，
而主题详情会顺手把 `view_count` +1——拿它当巡检入口，等于每次排查都在篡改统计；本端点只读，**不触碰 `view_count`**。

- 闸门 `community.post.moderate`（与删除他人主题 / 回复 / 短评同一码）：未登录 `401 authentication_required`，缺码 `403 forbidden`
- 查询参数：`q` 去空白后按 `ILIKE` 子串匹配**主题标题或回复正文**（与主题列表的搜索同口径；`%` / `_` 按通配符处理，中文可直接搜）；`page` 从 1 起、`page_size` 缺省 20 上限 100，越界静默取默认，不报 400
- 响应 `{"items":[…],"total":N}`（与 `/api/messages/*`、`/api/users/:id/favorites` 同一形状），按 `created_at DESC, id DESC` 排（最新在前）；`total` 是同谓词下的真实条数，不随窗口变化
- 每一项含：`id`、`topic_id` / `topic_title` / `board_code`（治理上下文，不必再回查主题）、`author_id` / `author_name`（写入时的快照，空快照回落 `Anonymous`）、`post_number`、`reply_to_post_number`（未引用任何楼层时为 `null`）、`excerpt` 与 `truncated`（摘要折叠换行后按 **rune** 截到 200 字并标出是否截断，全文仍在主题页）、`created_at` / `updated_at`
- **与信息流的分工**：`GET /api/community/feed` 读的是**评论板块的短评**（存在 `community.topics` 里的行，带条目标题），本端点读的是**楼中回复**（`community.posts`）——两张表，不能互相替代
- 只读：不写数据、不改统计；处置仍走删除端点（作者本人，或持 `community.post.moderate` 的成员）；服务本身不额外限流，与其它社区接口一样只受网关按 IP 的 `/api/` 限流约束

## 社区规范与审核

- **内容合规**：严禁发布侵权盗版链接、商业广告、恶意灌水与人身攻击内容，违规内容会被清理。当前处置手段为删除主题/回复/短评与锁定主题（`is_locked` 后不能回帖）；举报与判断由站务跟进。
- **处置边界**：删除他人内容需要 `community.post.moderate` 权限码；账号层面的禁言与封禁不在当前实现内，问题账号由站务按站点规则处理。
- **频率**：社区服务本身不限制发帖频率，写接口与其他 `/api/` 请求一样受网关按 IP 的速率限制约束，超限由网关返回 `429`（这一层不带 `Retry-After` 头）。

## 快速入口

- **导航入口**：点击顶部导航栏的 **“社区”** 即可进入板块广场与最新动态流。
- **关联引用**：在讨论作品时关联对应条目，主题列表与详情页会显示可跳转的条目链接，方便其他同好快速查阅。
