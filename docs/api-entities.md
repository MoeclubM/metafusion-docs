---
title: "实体查询与详情"
description: "统一实体端点：多维过滤、详情、关系、收录、修订与对比。"
order: 32
group: "api"
---

# 实体查询与详情

目录里所有实体（`agent` / `collection` / `work` / `content_unit` / `expression` / `release` / `medium` / `track`）
走同一套端点：**查询用 `GET /api/catalog/entities`，详情用 `GET /api/catalog/entities/:id`**。
不存在按 kind 展开的旧路径（`/api/catalog/works`、`/catalog/artists/:id`、`/catalog/taxonomy`、
`/catalog/relation-types` 等），也没有 `/api/browse/*` 与独立的图谱端点。

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

响应为 `{ "items": [...], "total": <真实 COUNT> }`；默认按 `updated_at DESC, id` 排序，
按关联 id 查询时按 `position` 升序，便于直接渲染分碟与曲目顺序。

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
| `GET /api/catalog/definitions` | 已发布的动态定义：`types` / `fields` / `vocabularies` / `relations` / `templates`，以及固定骨架的多语言 kind 名 |
| `GET /api/catalog/tags` | 标签频次聚合（只统计已发布实体；`q` 过滤、`limit` 默认 200 上限 500） |
| `GET /api/catalog/shelves` | 已启用的虚拟货架规则 |
| `GET /api/catalog/shelves/feed` | 每个货架加求值后的条目（`per_shelf` 默认 12、上限 100），登录用户按其首页偏好重排 |
| `GET /api/catalog/external-databases` | 可用的外部权威库定义（`external_ids` 的合法键） |
| `GET /api/catalog/compare?ids=a,b` | 2–6 个 **Release** 的字段与曲目对比（只对比 `comparable` 字段） |

`compare` 的 `ids` 少于 2 或多于 6 返回 `compare_requires_two_to_six`，非 Release 实体返回 `invalid_kind`。

## 分页

- `limit` / `offset`；`limit` 默认 50、上限 100（越界静默按 50）
- 列表响应带真实 `total`，可直接做页码；**不存在 `page` / `page_size` 参数**

## 相关页面

- [API 概览](/api-overview)：认证、限流与错误码
- [全文检索](/api-search)：`q` 的匹配口径与 OpenSearch 现状
- [新建与编辑](/api-edit)：写入、关系与生命周期
