---
title: "新建与编辑"
description: "实体写入 DTO、乐观锁、关系、生命周期与外部导入。"
order: 34
group: "api"
---

# 新建与编辑

目录写入只有一组端点：**实体用 `/api/catalog/entities`，关系用 `/api/catalog/relations`，
合并 / 退役用 `/api/catalog/entities/:id/lifecycle`**。
不存在按实体拆分的旧路径（`POST /api/catalog/works`、`PUT /api/catalog/artists/:id`、
`PUT /api/catalog/entity-relations`、`POST /api/catalog/submit`、`POST /api/catalog/merge`），
也没有「一次请求原子建完整条目链」的端点。

## 前提：认证与权限码

写入一律需要登录（`401 authentication_required`），并按权限码放行（`403 forbidden`）：

| 权限码 | 能做什么 |
|---|---|
| `catalog.entity.edit` | 创建与编辑实体（含维护公开条目） |
| `catalog.relation.edit` | 创建 / 替换 / 删除关系 |
| `catalog.lifecycle.manage` | 合并、退役，以及处置他人的未发布条目 |
| `catalog.definitions.manage` | 起草、校验、发布动态定义 |
| `catalog.import.submit` | 调用外部导入的预览与落库 |
| `catalog.shelves.manage` | 维护货架规则 |

权限码由账号服务装进权限组、随访问令牌的 `permissions` 声明下发（admin 组带 `*` 通配）。
只有完全没有 `permissions` 声明的老令牌才按历史角色兜底（admin 放行全部目录码，editor 放行 `catalog.entity.edit`）。
**没有 `catalog.entity.edit` 的登录用户**仍可写，但只能把条目存成 `draft` / `pending_review`，
不能发布，也不能触碰已发布条目。

## 写入前必带的证据

每次写入都必须带 `edit_note`（非空）与至少一条 `sources`，否则 `400 evidence_required`：

```json
"sources": [{ "kind": "url", "citation": "官方商品页", "url": "https://example.com/item" }]
```

- `kind` 只接受 `url` / `publication` / `self`
- `citation` 不能为空；`url` 只要是链接就必须合法（`400 invalid_source`）

## 创建实体

```http
POST /api/catalog/entities
{
  "entity": {
    "kind": "work",
    "title": "攻壳机动队",
    "original_language": "ja",
    "translations": { "zh-CN": { "title": "攻壳机动队", "summary": "..." } },
    "types": ["animation"],
    "attributes": { "cover_aspect": "2:3", "tags": ["动画", "电影"] },
    "external_ids": { "bangumi": "265" },
    "pictures": [{ "url": "https://example.com/cover.jpg", "source": { "kind": "url", "citation": "官方海报", "url": "https://example.com" } }],
    "status": "published"
  },
  "expected_version": 0,
  "edit_note": "initial import per official catalog",
  "sources": [{ "kind": "url", "citation": "官方站点", "url": "https://example.com" }]
}
```

- `kind`：`agent` / `collection` / `work` / `content_unit` / `expression` / `release` / `medium` / `track`
- `translations` 是按 locale 分组的**对象**（每个语种含 `title` / `summary` / `aliases`），不是数组；
  原语言题名放在对应语种行里
- `attributes` 的键必须在已发布定义中声明（未声明的键 `400 unknown_field: <code>`），
  业务形态用标签与 `cover_aspect`（`"1:1"` / `"2:3"` / `"3:4"`）表达，没有 `media_type` 这种树状分类
- `external_ids` 的键必须是已登记的外部权威库（见 `GET /api/catalog/external-databases`）
- 请求体里出现未知字段一律 `400 invalid_payload`（服务端按严格模式解码）
- 幂等：带 `Idempotency-Key` 请求头时，同键重放直接返回首创结果（进程内存 24 小时；键按「路由 + 用户 + 键」缓存，
  不做载荷哈希）

### 层级与归属字段

| 字段 | 只用在 | 说明 |
|---|---|---|
| `work_id` | content_unit、expression（都必填） | 所属作品 |
| `content_unit_id` | expression（可选） | 所属内容单元 |
| `release_id` | medium（必填） | 所属发行版 |
| `medium_id` | track（必填） | 所属载体 |
| `parent_id` | content_unit / medium / track（可选） | 同域同层父节点 |
| `position` / `number` | medium / track 等 | 次序（非负整数）/ 官方原文编号 |
| `contents[]` | track | `{ expression_id, position, locator, attributes }`：这条曲目收录的是哪个表达 |
| `subjects[]` | release | `{ work_id, role, position, attributes }`：发行版声明收录了哪些作品；`role` 取 `primary` / `compilation` / `supplement`，同一作品同一角色只允许一条 |

结构字段按层级收敛：**发行版没有 `work_id`**（收录关系只能经 `subjects`），`contents` 只对 `track` 有效、
`subjects` 只对 `release` 有效；给某个 kind 传它用不到的结构字段会返回 `400 invalid_structural_field: <字段码>`，
缺必填归属返回 `400 parent_required`。

正确的顺序是按层级自下而上补齐：先 `work` → `content_unit` → `expression`，再 `release` → `medium` → `track`，
最后按需建关系。`work_id` / `release_id` / `medium_id` / `kind` 在更新时**不可改**（`400 immutable_scope`），
写错了只能新建或走生命周期处置。

## 编辑实体

```http
PUT /api/catalog/entities/:id
{
  "entity": { "...": "完整实体，保留所有无关字段" },
  "expected_version": 3,
  "edit_note": "fix typo per official site",
  "sources": [{ "kind": "url", "citation": "官网标题", "url": "https://example.com" }]
}
```

- PUT 是**整实体替换**，不是局部 PATCH：先 `GET /api/catalog/entities/:id` 取回完整实体与 `version`，
  改完再整体写回（翻译、标签、`contents` 都可能整组替换）
- `expected_version` 与当前版本不一致返回 `409 version_conflict`：重读后再写，不要盲目重试
- 想把已发布条目降级，或直接写成 `deleted` / `merged`，会被 `400 use_lifecycle_endpoint` 拒绝
- 发布（`status: "published"`）时至少要有一条 `translations`，否则 `400 translation_required`

## 关系

```http
POST   /api/catalog/relations          # 建边（支持 Idempotency-Key）
PUT    /api/catalog/relations/:id      # 替换边的属性（端点与类型不可改）
DELETE /api/catalog/relations/:id      # 删边（body 带 expected_version 与证据）
```

```json
{
  "relation": { "type": "directed_by", "source_id": "<work_id>", "target_id": "<agent_id>", "position": 0, "attributes": {} },
  "expected_version": 0,
  "edit_note": "自官方制作名单",
  "sources": [{ "kind": "url", "citation": "官方制作名单", "url": "https://example.com" }]
}
```

服务端逐项校验，失败码可直接定位问题：

| 失败码 | 触发条件 |
|---|---|
| `invalid_relation_type` | 关系码不在已发布定义里，或该码已被停用 |
| `invalid_endpoints` | 自己连自己，或两端 kind 不在该关系的 `source_kinds` / `target_kinds` 白名单 |
| `invalid_endpoint_types` | 两端动态业务类型不满足该关系的类型白名单 |
| `duplicate_relation` | 同类型、同端点、同 position、同属性的边已存在 |
| `cardinality_exceeded` | 超过该关系的 `max_outgoing` / `max_incoming` |
| `relation_cycle` | 声明了 `acyclic` 的关系形成环路（如同类续作互指） |

判重的去重键是「端点 + 类型 + 属性」（**不含 `position`**）：同一对端点、同一关系码、属性也完全相同、
只有 `position` 不同的两条边会被库内唯一索引拦下（`400 constraint_violation`）。
要表达「同一演员在同一作品的两个角色位」，请让 `attributes` 不同（如 `character` 指向不同角色实体）。

默认种子的关系码（以 `GET /api/catalog/definitions` 为准）：

- **credits**（署名，一般指向 agent）：`created_by`、`performed_by`、`photographed_by`、`modeled_by`、
  `developed_by`、`voiced_by`、`composed_by`、`lyricist_of`、`arranged_by`、`directed_by`、
  `written_by`、`illustrated_by`、`narrated_by`、`translated_by`、`character_in`（角色登场）、
  `credit_for`（通用署名兜底，职位原文写进 `attributes.credit_role`）
- **creative**（内容关系）：`adaptation_of`、`sequel_of`、`spin_off_of`、`soundtrack_of`（work↔work）；
  `translation_of`、`revision_of`、`cover_of`、`alternate_take_of`（expression↔expression）；
  `pressing_of`（release↔release）
- **membership**（组成与成员）：`includes`（collection / work → work / collection，声明 `aggregate`）、
  `member_of`（agent↔agent）、`bonus_included_in`、`store_bonus_for`

`includes` 等声明 `acyclic` 的码会做环路检测；同一角色跨作品用多条 `character_in`。
外部来源的职位若没有贴切的码，用 `credit_for` + `credit_role` 保真，不要虚构新码。

## 生命周期：合并与退役

```http
POST /api/catalog/entities/:id/lifecycle
{ "target_id": "<保留的实体>", "expected_version": 3, "edit_note": "merge duplicate", "sources": [] }
```

- 带 `target_id` 为**合并**：目标必须同 kind、同归属（`work_id` / `release_id` / `medium_id` / `parent_id` 一致）
  且已发布，否则 `400 invalid_merge_target`；源实体状态置 `merged` 并写入 `redirect_id`，
  指向它的关系与结构引用会被改写
- 不带 `target_id` 为**退役**：状态置 `deleted`（`sources` 可以为空数组，但 `edit_note` 仍必填）
- 合并后的旧 id 用 `GET /api/catalog/entities/:id/resolve` 跟随到保留实体
- 两个动作都需要 `catalog.lifecycle.manage`；当前没有 `archived` 一类的中间状态

## 修订历史

```http
GET /api/catalog/entities/:id/revisions
```

每次写入都会生成修订行（含操作者、`edit_note`、`sources` 与快照），路径上与实体同一可见性口径。

## 外部导入

导入当前只对接 **Bangumi**，两个端点都要 `catalog.import.submit`：

| 端点 | 作用 |
|---|---|
| `POST /api/importer/preview` | 按 URL / ID 出站抓取并返回结构化预览（分集分页、≤8 并发详情抓取），限流 10/分钟 |
| `POST /api/importer/import` | 按预览载荷落库，服务端在同一事务里建出条目链 |

- `source` 只接受 `bangumi`（或缺省 / `auto`，同样归一为 bangumi），其它来源 `400 not_supported`
- `entity_type` 取 `work` / `artist` / `organization` / `character`，非法值 `400 invalid_entity_type`
- `link_mode` 取 `new_work`（默认）/ `append_release_to_work` / `create_relation`；
  `merge_translations` 已被显式拒绝（需要补译名请走常规编辑）
- 落库前做零写入预检：属性值、未知字段码、`original_language`、翻译行与日期字段都按已发布定义校验，
  规则与实体写入一致；没有落库位置的载荷字段以 `unsupported_field_for_entity_type` 明确拒绝，不静默丢弃
- 导入会拉取条目的演职员与角色：语义明确的职位映射到精确关系码（如 `directed_by` / `photographed_by` /
  `voiced_by`），否则落 `credit_for` 并把职位原文写进 `credit_role`；角色番位落 `character_in` 的
  `character_rank`，声优建 `voiced_by` 并以 `character` 引用角色实体
- **仍不导入**：infobox 派生字段、`/ep` 剧集树（ContentUnit 分集目录）、work↔work 关系网、
  发行版 `edition_type`，以及 `publisher` 实体引用（预览只有自由文本名称，不虚构）

## 实例间交换

| 端点 | 作用 |
|---|---|
| `GET /api/exchange/entities/:id` | 导出单个实体快照（JSON），供另一实例导入 |
| `POST /api/exchange/proposals` | 提交外部编辑提案，请求体与实体写入相同；服务端强制落 `pending_review`，不能绕过审核直接发布 |

## 定义版本管理

动态定义（类型、字段、词表、关系、模板）由管理员维护，全部需要 `catalog.definitions.manage`：

| 端点 | 作用 |
|---|---|
| `GET /api/admin/catalog-definitions` | 版本列表（`include_document=false` 时不带文档，响应顶层回显该选择） |
| `POST /api/admin/catalog-definitions` | 存一版不可变草稿（文档 + `base_version` + 证据） |
| `GET /api/admin/catalog-definitions/:id` | 读任意历史版本的完整文档 |
| `GET /api/admin/catalog-definitions/:id/diff` | 与基线版本的字段级差异（`against` 缺省取该版本的 `base_version`） |
| `GET /api/admin/catalog-definitions/:id/impact` | 用当前全量数据校验草稿的影响面 |
| `POST /api/admin/catalog-definitions/:id/publish` | 发布兼容草稿 |
| `POST /api/admin/catalog-definitions/:id/rollback` | 把历史版本重新起草并发布（文档已一致时 `no_op=true`，不写库） |

## 示例

```bash
# 先读取完整实体，取回 version 后再整实体替换
curl "/api/catalog/entities/<id>" -b "mf_session=<cookie>"

curl -X PUT "/api/catalog/entities/<id>" \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": { "id": "<id>", "kind": "work", "title": "修正标题", "translations": {}, "attributes": {} },
    "expected_version": 2,
    "edit_note": "fix typo per official site",
    "sources": [{ "kind": "url", "citation": "官网标题", "url": "https://example.com" }]
  }'
```

## 相关页面

- [API 概览](/api-overview)：错误码与限流
- [实体查询与详情](/api-entities)：写之前先把实体读全
- [AI Agent 工具规范](/api-agent)：把写入契约包成工具定义
