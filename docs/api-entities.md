---
title: "实体查询与详情"
description: "统一实体端点：多维过滤、详情、关系、收录、修订与对比。"
order: 30
group: "api"
---

# 实体查询与详情

目录里所有实体走同一套端点：查询用 `GET /api/catalog/entities`，详情用 `GET /api/catalog/entities/:id`。

八类 kind 共用这两个端点：`agent` / `collection` / `work` / `content_unit` / `expression` / `release` / `medium` / `track`。
按关联 id 过滤（`work_id` / `release_id` / `medium_id` / `content_unit_id` / `parent_id`）
或按 `kind` / `tags` 过滤拿到子集；语义关系、结构与声明的实体引用可以经统一 links 或 relationships/query 读取，实际收录也可用 occurrences 反查。

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
| `status` | 状态过滤（`draft` / `pending_review` / `published` …）；可见性另见 [API 概览](/api-overview) |
| `original_language` / `has_pictures` | 原始语言精确筛选 / `has_pictures=1` 仅返回有图实体 |
| `q` | 关键词查询，匹配、索引计数与分页见[检索](/api-search) |
| `field` + `value` | 按 `document` 内属性字段精确过滤（支持点分路径，见下） |
| `work_id` | 该作品下的内容单元与表达，以及声明收录它的发行版 |
| `content_unit_id` | 该内容单元下的表达 |
| `release_id` | 该发行版下的载体 |
| `medium_id` | 该载体下的曲目 |
| `parent_id` | 同层子节点（内容单元 / 载体 / 曲目） |
| `tags` | 多值标签过滤：重复出现或逗号分隔，命中任一即返回；服务端走 JSONB 包含匹配 |
| `sort` / `order` / `locale` | sort 可取 updated_at / created_at / title，order 为 asc / desc；题名排序可指定 locale，未知排序/方向返回 invalid_sort / invalid_order |
| `limit` / `offset` | 默认 50 / 0；limit 为 1–100，offset 为非负整数，非法值返回 400 |
| `page` | 从 1 起，等价 offset=(page-1)×limit，不能与 offset 同时提交 |
| `cursor` | 仅用于关键词深分页，不能与 offset/page 同时提交；见[检索](/api-search) |

无关键词浏览响应为 `{ "items": [...], "total": <数据库计数> }`。关键词查询还返回索引计数口径与深分页标记，见[检索](/api-search)。

无关键词浏览默认按 `updated_at DESC, id`；带 `content_unit_id` / `release_id` / `medium_id` / `parent_id` 且未显式排序时改按 `position` 升序，
便于直接渲染分碟与曲目顺序（`work_id` 不触发该排序，仍是默认序）。

多值过滤在服务端完成，不会先取固定条数再由客户端过滤，避免合法候选被截断。
关系编辑器的对端选择器就是用它收敛候选：

```http
GET /api/catalog/entities?kinds=work,collection&tags=专辑,歌曲&limit=24
```

### 嵌套字段筛选

`field` 支持点分路径，沿 definitions 递归解析：`group` 逐层下钻；`list` 中途节点按「任一元素命中」比较；
叶子保持与单层一致的等值语义（`->>` 文本比较）。

要求叶子 `searchable` 为 true 且链路上所有字段 `enabled`，否则返回 `field_not_searchable`；未知路径返回 `unknown_field`。

```http
GET /api/catalog/entities?field=attachments.store&value=<agent_id>
GET /api/catalog/entities?field=store_bonuses.channel&value=animate&kind=release
```

结构属性伪字段命中收录 / 发行对象表而非实体属性，编译成 `EXISTS` 子查询：

| 伪字段 | 含义 | 列表语境 |
|---|---|---|
| `locator.<子字段>` | 收录位置（`catalog.track_contents.locator`） | `kind=track` |
| `inclusion_attributes.<子字段>` | 收录附加属性（`catalog.track_contents.attributes`） | `kind=track` |
| `subject_attributes.<子字段>` | 发行对象附加属性（`catalog.release_subjects.attributes`） | `kind=release` |

```http
GET /api/catalog/entities?kind=track&field=locator.path&value=/disc1/chapter01
GET /api/catalog/entities?kind=track&field=inclusion_attributes.translator&value=<agent_id>
GET /api/catalog/entities?kind=release&field=subject_attributes.seq&value=1
```

::: warning 注意
`kind` 与伪字段归属显式不匹配时（如 `kind=release` 配 `locator.path`）谓词恒假、返回空集，
而不是报错；不传 `kind` 时按 `EXISTS` 自然过滤。
:::

子字段是否可用以 `GET /api/catalog/definitions` 为准（含后台新增的子字段）。

## 实体详情

```http
GET /api/catalog/entities/:id            # 通用实体详情（含 version，写入时要用）
GET /api/catalog/entities/:id/resolve    # 合并后跟随 redirect_id 取到保留实体
GET /api/catalog/entities/:id/identity   # 存活实体与完整历史别名
GET /api/catalog/entities/:id/relations  # 关系边 + 两端实体表
GET /api/catalog/entities/:id/links      # 固定结构与语义关系的统一只读投影
GET /api/catalog/entities/:id/occurrences # 该实体被哪些发行版收录
GET /api/catalog/entities/:id/revisions  # 修订历史
```

```bash
curl "/api/catalog/entities/<id>" -H "User-Agent: MyApp/1.0 (you@example.com)" | jq .
curl "/api/catalog/entities/<id>/relations" -H "User-Agent: MyApp/1.0 (you@example.com)" | jq .
```

- `/relations` 的响应是 `{ items, entities, subject_id }`：`items` 是关系边，`entities` 是按 id 索引的两端实体（含被查询实体自身），`subject_id` 标出「哪个是自己」
- 客户端据此直接渲染「谁→谁」，不必再逐条取实体
- `/occurrences` 按 kind 收敛：`expression` 返回自身收录，`content_unit` / `work` 返回其表达被收录的情况
- `/revisions` 按目标实体逐行过滤可见性；Track 历史快照中的收录也按表达当前可见性裁剪，原始事实仍保留在库中。关系修订的 `target_id` 是关系 id 本身
- `/links` 是固定结构与语义关系的统一只读投影；语义关系仍经 `/relations` 写入，不复制结构边。

### 身份解析和统一关系读取

`GET /api/catalog/entities/:id/identity` 返回 `{canonical_id, aliases, entity, complete}`。aliases 包含反向合并分支和多跳链；只有 `complete=true` 才能当作全集用于评论、收藏或文件聚合。终点不存在/不可见返回 404，查询失败返回错误，不把部分结果伪装成完整身份。

`POST /api/catalog/entities/identity` 是只读批量解析，请求 `{ids:[...]}`，1–500 项，返回按请求 ID 索引的 `items` 与 `missing`。不可见/不存在进入 missing，数据库故障使整批失败。

`GET /api/catalog/entities/:id/links?limit=50&offset=0` 返回 `{subject_id, definition_etag, items, entities, limit, offset, has_more}`。每项有 key、rule_code、class、direction、两端 ID、排序及可选角色、定位和属性。

规则从 `definitions.relationship_rules` 发现，覆盖以下事实：

| 规则码 / class | 权威数据与编辑方式 |
| --- | --- |
| `structure:*` / ownership、placement、inclusion | 固定归属、父子、subjects 与 contents，由拥有者实体或单条收录入口编辑 |
| `relation:*` / semantic | 动态语义关系，通过 relations 端点编辑 |
| `attribute:<path>` / reference | definitions 声明的实体属性引用，含嵌套 group/list，通过实体属性编辑 |

例如规则码 `attribute:attachments[].content` 表示列表中的引用类型，具体 link.field 为 `attachments[0].content`。关系、发行对象和收录的附加引用在 `references:[{field,entity_id}]` 中保留原路径；当被查询主体是上下文引用而不是 source/target 时，`via:[field,...]` 标出匹配路径。引用只按定义解析，不从普通字符串猜测实体关系。

统一 links 不是第二份事实存储。需要更多页时按 has_more 继续取数；404 是不存在/不可见，401/403、429、5xx 要分别处理。

### Agent 批量关系查询

`POST /api/catalog/relationships/query` 是只读查询，批量读取主体的直接结构、收录、语义关系和声明的属性引用。规则来自当前 `definitions.relationship_rules`，包含 GUI 扩展的 relation 及嵌套属性引用。

```http
POST /api/catalog/relationships/query
Content-Type: application/json

{
  "ids": ["<release_uuid>", "<expression_uuid>"],
  "direction": "both",
  "limit": 25,
  "offset": 0
}
```

| 参数 | 含义 |
| --- | --- |
| `ids` | 1–20 个 UUID，去重并保留请求顺序 |
| `direction` | both（默认）、outgoing 或 incoming，相对于每个主体 |
| `rule_codes` | 可选数组，当前关系注册表中的完整码，例如 `structure:track_content`；多个码为命中任一 |
| `peer_kinds` | 可选数组，八类 kind 的对端筛选；多个 kind 为命中任一 |
| `limit` | 每个主体的页大小，默认 25，范围 1–100 |
| `offset` | 每个主体的偏移，默认 0，须为非负整数，无 10000 上限 |

筛选和端点可见性检查先于分页。响应含：

- `definition_etag`：本次读取的定义版本。
- `pages`：按可见主体的请求顺序返回 `{subject_id, items, limit, offset, has_more}`；每个主体独立分页。
- `entities`：去重的可见端点摘要，只有id、kind、version、title、original_language和translations；不能当作完整实体写回。
- `unavailable_ids`：不存在或当前不可见的请求ID，两者不区分。

items 沿用 links 的边形状，事实方向始终为 `source_id → target_id`；direction 标明相对主体的方向，反向名称不反转事实。references 包含非端点实体引用，via 标记当前主体匹配的上下文路径；它们不能只靠 source_id / target_id 推断。

单次请求的定义、主体与各页在一个一致性只读快照中读取；继续分页是新的快照。某页 `has_more=true` 时，可用该主体和相同筛选继续请求，offset增加本页limit。接口只读一跳，不自动展开全图；多页或多跳未完成时不能将结果称为全集。

需要递归时，将本页端点及 references 中的可见实体 ID 加入待查队列，去重后每批最多 20 个主体。分别完成每个主体的 has_more 分页，再扩展下一跳；记录 definition_etag、已读页和 unavailable_ids。每次分页是新快照，数据变更时需重新核对范围。这里只能查询已声明的目录事实，外围文件、收藏或普通文本不会被自动推断为目录关系。

例如，Expression向内筛选Track可查询实际收录位置，再沿Track的Medium和Release归属追踪发行；Work的release_subject只证明发行声明了该作品，不能证明某个录音被收录。Release向外筛选Medium可查询介质，完整曲序仍可用发行toc。参数错误返回400；数据库或网络失败使查询失败，不返回伪空结果。默认限流60次/分钟，按当前账户、组策略计算；429需遵循Retry-After。

Track 的公开读取会过滤不可见表达的收录；普通编辑者整实体 PUT 删除或改写被过滤的历史引用会返回 403 forbidden，需有权查看完整事实的创建者或审核者处理。不要把裁剪后的公开视图直接当作完整备份。

## 发行目录、组成与版本组

| 端点 | 返回内容 |
| --- | --- |
| `GET /api/catalog/releases/:id/toc` | Release、按位置排序的 Medium / Track、去重 Expression 与 definition_etag |
| `GET /api/catalog/expressions/:id/composition` | 直接 parts 与 wholes，关系及定义 ETag |
| `GET /api/catalog/releases/:id/editions` | 显式 group 与 editions，未分组时 group=null、editions 为空 |

发行 toc 在同一只读数据库快照内读取，各端点按调用者可见性过滤。composition 读取当前定义中用途为 expression_composition 的关系；editions 使用 release_group，不从共同 subjects 推断组。

这些聚合入口适合页面展示；需要批量直接关系或递归遍历时使用 relationships/query，并按每个主体的分页标记继续读取。

## 批量表达详情

发行版详情页一次取多条表达：表达实体 + 自身收录 + 同篇目兄弟收录 + 首个署名。
用 POST + JSON body 传 id 列表，避免把上百个 UUID 拼进 GET 查询串。

```http
POST /api/catalog/expressions/details
{ "ids": ["<expression_id>", "..."] }
```

请求体 `ids` 不能为空且不超过 500 条（`400 invalid_payload` / `400 too_many_ids`）。
响应含 `items`（按表达聚合，收录以引用 id 呈现）与共享的 `entities` 表。

## 词表、标签、货架与对比

| 端点 | 用途 |
|---|---|
| `GET /api/catalog/definitions` | 已发布的动态定义与固定骨架的多语言 kind 名 |
| `GET /api/catalog/tags` | 标签频次聚合（只统计已发布实体） |
| `GET /api/catalog/shelves` | 已启用的虚拟货架规则 |
| `GET /api/catalog/shelves/feed` | 每个货架加求值后的条目 |
| `GET /api/catalog/external-databases` | 可用的外部权威库定义（`external_ids` 的合法键） |
| `GET /api/catalog/compare?ids=a,b` | 2–6 个可见实体的字段对比；Release/Medium 附完整载体/轨目树，属性只对比 comparable 字段 |

- definitions 的字段与规则说明见[动态定义与配置](/api-definitions)。
- `tags` 支持 `q` 过滤，`limit` 默认 200 上限 500
- `shelves/feed` 的 `per_shelf` 默认 12、上限 100；登录用户按其首页偏好合并、重排与隐藏，每条 `shelf` 带 `source`（`system` / `custom`）
- compare 需要 2–6 个实体，越界返回 `compare_requires_two_to_six`。每项使用 `entity`；Release/Medium 的载体树在 `children` 中，每项为 `{medium, tracks}`。

## 用户贡献流

用户主页的贡献视图（前端 `all` / `revisions` / `works` / `releases` / `artists` 五个 tab）由目录服务提供：

```http
GET /api/users/:id/contributions?tab=all&page=1&page_size=20
```

| 参数 | 说明 |
|---|---|
| `tab` | `all` / `revisions` / `works` / `releases` / `artists`；其余取值 `400 invalid_tab` |
| `page` / `page_size` | `page` 从 1 起、`page_size` 默认 20 上限 100，越界静默收敛（不报错），与其它列表接口同一风格 |

各 tab 的口径：

- `all`（默认）：创建事件与后续改动按时间混排
- `revisions`：全部实体修订行，含首次创建
- `works` / `releases` / `artists`：只列该用户创建的对应实体
- topics / comments 一类属互动服务的口径，不在这里静默返回空列表

响应 `{items, total, page, page_size, stats}`：`total` 是同口径下的真实计数（不是本页条数），`page` / `page_size` 是收敛后的取值。

`stats` 恒为五个全量计数，不随 `tab` 变化：

| 字段 | 口径 |
|---|---|
| `works_created` / `releases_created` / `artists_created` | 该用户创建的对应实体（前端的 `artists` 对应骨架里的 `agent` kind） |
| `revisions_count` | 该用户在可见实体上的全部修订行数（含首次创建行） |
| `audit_actions` | 该用户执行过的生命周期管理动作次数（`entity.deleted` / `entity.merged`） |

三个 created 计数即 version=1 的首次修订条数，且该实体当前对请求方可见。

::: warning 注意
`audit_actions` 不随目标当前状态变化：删除与合并会把目标移出可见集，若也套可见性过滤这个数字恒为 0。
:::

`items` 有两种项，字段沿用既有端点：

- **创建项**（`works` / `releases` / `artists` tab，以及 `all` 里的创建事件）：`id` 是实体 id，带 `tab`（对应该实体所属 tab）、`status` 与实体自身的 `updated_at`，`edit_type` 为 `create`
- **修订项**（`revisions` tab，以及 `all` 里的后续改动）：`id` 是修订行 id，实体 id 落在 `target_id`，带 `version` / `edit_note` / `sources` / `created_at`
- 修订项 `version > 1` 时 `edit_type` 为 `update` 并带 `diff`：字段级的 `old` / `new`，`attributes` 与 `translations` 下钻一层（如 `attributes.tags`、`translations.zh-CN`）
- `id` / `version` / `created_by` / `created_at` / `updated_at` 这类每次都会变的键不进差异；单个值超过 512 字节时截断成字符串前缀

可见性与实体列表同一口径：未发布只对创建者与持 `catalog.lifecycle.manage` 者可见，`deleted` / `merged` 对所有人不可见。因此列表与统计都不会泄漏草稿。

贡献归属取自修订行的 actor 快照列，不 JOIN 账号表：目录服务不判断"用户是否存在"（没有任何修订就是零贡献），也不返回昵称与头像（那些字段见 [认证与凭证](/api-auth) 的公开账号资料）。

错误码：

- `:id` 不是 UUID 是 `404 not_found`
- `tab` 非法是 `400 invalid_tab`
- 本路由限流 120 / 分钟，超限 `429 rate_limited` 并带 `Retry-After`

::: warning 注意
「账号不存在」与「有这个人但一条贡献都没有」分不出来：账号表归账号服务、目录不查它，
两者都是 `200` 加空列表与 0 计数。`404` 只留给「这个 id 不是 UUID」。
:::

::: details 备注
`404` 口径与账号 `GET /api/users/:id`、互动 `GET /api/users/:id/stats` 一致：
用户主页把三路数据源按同一类降级处理，回 `400` 会把「这个来源取不到」讲成「参数错误」。
:::

## 分页

- 实体列表 limit 默认 50、范围 1–100，offset 非负；非法值返回 400，page 与 offset 互斥。
- 无关键词浏览使用数据库 `total` 和 `limit` / `offset`；关键词深分页见[检索](/api-search)。

## 相关页面

- [API 概览](/api-overview)：认证、限流与错误码
- [检索](/api-search)：关键词、索引计数与分页
- [新建与编辑](/api-edit)：写入、关系与生命周期
