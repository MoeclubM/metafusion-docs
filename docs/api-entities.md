---
title: "实体查询与详情"
description: "统一实体端点：多维过滤、详情、关系、收录、修订与对比。"
order: 32
group: "api"
---

# 实体查询与详情

目录里所有实体（`agent` / `collection` / `work` / `content_unit` / `expression` / `release` / `medium` / `track`）
走同一套端点：**查询用 `GET /api/catalog/entities`，详情用 `GET /api/catalog/entities/:id`**。
八类 kind 共用这两个端点：按关联 id 过滤（`work_id` / `release_id` / `medium_id` / `content_unit_id` / `parent_id`）
或按 `kind` / `types` 过滤拿到子集，关系数据经 `/relations`、`/occurrences` 端点取。

## 列表与过滤

```http
GET /api/catalog/entities?kind=work&limit=24&offset=0
GET /api/catalog/entities?q=攻壳机动队&kind=work
GET /api/catalog/entities?kind=release&work_id=<work_id>&limit=24
GET /api/catalog/entities?kind=medium&release_id=<release_id>
```

| 参数 | 说明 |
|---|---|
| `kind` | 单个 kind 过滤 |
| `kinds` | 多值 kind（重复出现或逗号分隔，命中任一即返回） |
| `type` / `types` | 动态业务类型（`document.types`）单值 / 多值过滤 |
| `status` | 状态过滤（`draft` / `pending_review` / `published` …；可见性另见 [API 概览](/api-overview)） |
| `q` | 标题与译文文本的子串匹配，见 [全文检索](/api-search) |
| `field` + `value` | 按 `document` 内属性字段精确过滤（支持点分路径，见下） |
| `work_id` | 该作品下的内容单元与表达，以及声明收录它的发行版 |
| `content_unit_id` | 该内容单元下的表达 |
| `release_id` | 该发行版下的载体 |
| `medium_id` | 该载体下的曲目 |
| `parent_id` | 同层子节点（内容单元 / 载体 / 曲目） |
| `tags` | 多值标签过滤（重复出现或逗号分隔，命中任一即返回，服务端走 JSONB 包含匹配） |
| `limit` / `offset` | 分页；`limit` 默认 50、上限 100，越界静默按 50 |

响应为 `{ "items": [...], "total": <真实 COUNT> }`；默认按 `updated_at DESC, id` 排序；
带 `content_unit_id` / `release_id` / `medium_id` / `parent_id` 时改按 `position` 升序，
便于直接渲染分碟与曲目顺序（`work_id` 不触发该排序，仍是默认序）。

多值过滤在服务端完成（不会先取固定条数再由客户端过滤，避免合法候选被截断），
关系编辑器的对端选择器就是用它收敛候选：

```http
GET /api/catalog/entities?kinds=work,collection&types=album,song&limit=24
```

### 嵌套字段筛选

`field` 支持点分路径，沿 definitions 递归解析：`group` 逐层下钻，`list` 中途节点按「任一元素命中」
比较，叶子保持与单层一致的等值语义（`->>` 文本比较）。要求叶子 `searchable` 为 true 且链路上所有字段
`enabled`，否则返回 `field_not_searchable`；未知路径返回 `unknown_field`。

```http
GET /api/catalog/entities?field=attachments.store&value=<agent_id>
GET /api/catalog/entities?field=store_bonuses.channel&value=animate&kind=release
```

结构属性伪字段命中收录 / 发行对象表而非实体属性，编译成 `EXISTS` 子查询：

- `locator.<子字段>`：收录位置（`catalog.track_contents.locator`），列表语境 `kind=track`
- `inclusion_attributes.<子字段>`：收录附加属性（`catalog.track_contents.attributes`），`kind=track`
- `subject_attributes.<子字段>`：发行对象附加属性（`catalog.release_subjects.attributes`），`kind=release`

```http
GET /api/catalog/entities?kind=track&field=locator.path&value=/disc1/chapter01
GET /api/catalog/entities?kind=track&field=inclusion_attributes.translator&value=<agent_id>
GET /api/catalog/entities?kind=release&field=subject_attributes.seq&value=1
```

`kind` 与伪字段归属显式不匹配时（如 `kind=release` 配 `locator.path`）谓词恒假、返回空集，
而不是报错；不传 `kind` 时按 `EXISTS` 自然过滤。子字段是否可用以
`GET /api/catalog/definitions` 为准（含后台新增的子字段）。

## 实体详情

```http
GET /api/catalog/entities/:id            # 通用实体详情（含 version，写入时要用）
GET /api/catalog/entities/:id/resolve    # 合并后跟随 redirect_id 取到保留实体
GET /api/catalog/entities/:id/relations  # 关系边 + 两端实体表
GET /api/catalog/entities/:id/occurrences # 该实体被哪些发行版收录
GET /api/catalog/entities/:id/revisions  # 修订历史
```

```bash
curl "/api/catalog/entities/<id>" -H "User-Agent: MyApp/1.0 (you@example.com)" | jq .
curl "/api/catalog/entities/<id>/relations" -H "User-Agent: MyApp/1.0 (you@example.com)" | jq .
```

- `/relations` 的响应是 `{ items, entities, subject_id }`：`items` 是关系边，`entities` 是按 id 索引的
  两端实体（含被查询实体自身），`subject_id` 标出「哪个是自己」。客户端据此直接渲染「谁→谁」，
  不必再逐条取实体
- `/occurrences` 按 kind 收敛：`expression` 返回自身收录，`content_unit` / `work` 返回其表达被收录的情况
- `/revisions` 按目标实体逐行过滤可见性；关系修订的 `target_id` 是关系 id 本身
- **没有独立图谱端点**：需要 `{ nodes, links }` 拓扑就用 `/relations` 的返回在客户端构图

## 批量表达详情

发行版详情页一次取多条表达（表达实体 + 自身收录 + 同篇目兄弟收录 + 首个署名）：
用 POST + JSON body 传 id 列表，避免把上百个 UUID 拼进 GET 查询串。

```http
POST /api/catalog/expressions/details
{ "ids": ["<expression_id>", "..."] }
```

请求体 `ids` 不能为空且不超过 500 条（`400 invalid_payload` / `400 too_many_ids`）；
响应含 `items`（按表达聚合，收录以引用 id 呈现）与共享的 `entities` 表。

## 词表、标签、货架与对比

| 端点 | 用途 |
|---|---|
| `GET /api/catalog/definitions` | 已发布的动态定义：`types` / `fields` / `vocabularies` / `relations` / `templates`，以及固定骨架的多语言 kind 名（名称均为四语 map：`zh-CN` / `zh-TW` / `en-US` 加 `ja` 或 `ja-JP`） |
| `GET /api/catalog/tags` | 标签频次聚合（只统计已发布实体；`q` 过滤、`limit` 默认 200 上限 500） |
| `GET /api/catalog/shelves` | 已启用的虚拟货架规则 |
| `GET /api/catalog/shelves/feed` | 每个货架加求值后的条目（`per_shelf` 默认 12、上限 100），登录用户按其首页偏好重排 |
| `GET /api/catalog/external-databases` | 可用的外部权威库定义（`external_ids` 的合法键） |
| `GET /api/catalog/compare?ids=a,b` | 2–6 个 **Release** 的字段与曲目对比（只对比 `comparable` 字段） |

`compare` 的 `ids` 少于 2 或多于 6 返回 `compare_requires_two_to_six`，非 Release 实体返回 `invalid_kind`。

## 用户贡献流

用户主页的贡献视图（前端 `all` / `revisions` / `works` / `releases` / `artists` 五个 tab）由目录服务提供：

```http
GET /api/users/:id/contributions?tab=all&page=1&page_size=20
```

| 参数 | 说明 |
|---|---|
| `tab` | `all`（默认：创建事件与后续改动按时间混排）、`revisions`（全部实体修订行，含首次创建）、`works` / `releases` / `artists`（只列该用户创建的对应实体）；其余取值 `400 invalid_tab`——topics / comments 一类属互动服务的口径，不在这里静默返回空列表 |
| `page` / `page_size` | `page` 从 1 起、`page_size` 默认 20 上限 100，越界静默收敛（不报错），与其它列表接口同一风格 |

响应 `{items, total, page, page_size, stats}`：`total` 是同口径下的真实计数（不是本页条数），`page` / `page_size` 是收敛后的取值；`stats` 恒为五个**全量**计数，不随 `tab` 变化：

| 字段 | 口径 |
|---|---|
| `works_created` / `releases_created` / `artists_created` | 该用户创建的对应实体（前端的 `artists` 对应骨架里的 `agent` kind）：即 version=1 的首次修订条数，且该实体当前对请求方可见 |
| `revisions_count` | 该用户在可见实体上的全部修订行数（含首次创建行） |
| `audit_actions` | 该用户执行过的生命周期管理动作次数（`entity.deleted` / `entity.merged`）；**不随目标当前状态变化**——删除与合并会把目标移出可见集，若也套可见性过滤这个数字恒为 0 |

`items` 有两种项，字段沿用既有端点：

- **创建项**（`works` / `releases` / `artists` tab，以及 `all` 里的创建事件）：`id` 是实体 id，带 `tab`（对应该实体所属 tab）、`status` 与实体自身的 `updated_at`，`edit_type` 为 `create`
- **修订项**（`revisions` tab，以及 `all` 里的后续改动）：`id` 是修订行 id，实体 id 落在 `target_id`，带 `version` / `edit_note` / `sources` / `created_at`；`version > 1` 时 `edit_type` 为 `update` 并带 `diff`（字段级的 `old` / `new`，`attributes` 与 `translations` 下钻一层，如 `attributes.tags`、`translations.zh-CN`；`id` / `version` / `created_by` / `created_at` / `updated_at` 这类每次都会变的键不进差异，单个值超过 512 字节时截断成字符串前缀）

可见性与实体列表同一口径（未发布只对创建者与持 `catalog.lifecycle.manage` 者可见，`deleted` / `merged` 对所有人不可见），因此列表与统计都不会泄漏草稿。贡献归属取自修订行的 actor 快照列，**不 JOIN 账号表**：目录服务不判断"用户是否存在"（没有任何修订就是零贡献），也不返回昵称与头像（那些字段见 [认证与凭证](/api-auth) 的公开账号资料）。

错误码：`:id` 不是 UUID 是 `400 invalid_id`（目录服务把路径参数交给 UUID 解析，与 `/api/users/:id` 的 `404` 口径不同）；`tab` 非法是 `400 invalid_tab`；本路由限流 120 / 分钟，超限 `429 rate_limited` 并带 `Retry-After`。

## 分页

- `limit` / `offset`；`limit` 默认 50、上限 100（越界静默按 50）
- 列表响应带真实 `total`，可直接做页码；分页只用 `limit` / `offset` 两个参数

## 相关页面

- [API 概览](/api-overview)：认证、限流与错误码
- [全文检索](/api-search)：`q` 的匹配口径与 OpenSearch 现状
- [新建与编辑](/api-edit)：写入、关系与生命周期
