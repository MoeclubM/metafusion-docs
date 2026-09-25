---
title: "新建与编辑"
description: "实体写入 DTO、乐观锁、关系、生命周期与外部导入。"
order: 50
group: "api"
---

# 新建与编辑

目录写入只有四个入口，按层级逐条写入，每次请求只落一条实体或一条关系。

| 用途 | 端点 |
|---|---|
| 实体 | `/api/catalog/entities` |
| 关系 | `/api/catalog/relations` |
| 合并 / 退役 | `/api/catalog/entities/:id/lifecycle` |
| 下架（`published → draft`） | `/api/catalog/entities/:id/unpublish` |

## 前提：认证与权限码

写入一律需要登录（`401 authentication_required`），并按权限码放行（`403 forbidden`）。

| 权限码 | 能做什么 |
|---|---|
| `catalog.entity.edit` | 创建与编辑实体（含维护公开条目） |
| `catalog.relation.edit` | 创建 / 替换 / 删除关系 |
| `catalog.lifecycle.manage` | 合并、退役、下架（`published → draft`），以及发布/处置他人的未发布条目 |
| `catalog.definitions.manage` | 起草、校验、发布动态定义 |
| `catalog.import.submit` | 调用外部导入的预览与落库 |
| `catalog.shelves.manage` | 维护货架规则 |
| `storage.asset.upload` | 上传与登记自己的资产 |

`storage.asset.upload` 覆盖 `/api/storage/upload/*` 与 `POST /api/storage/bind`，`member` 组默认持有该码。

权限码由账号服务装进权限组、随访问令牌的 `permissions` 声明下发（admin 组带 `*` 通配）。
只有完全没有 `permissions` 声明的老令牌才按历史角色兜底：admin 放行全部目录码，editor 放行 `catalog.entity.edit`。

::: warning 注意
没有 `catalog.entity.edit` 的登录用户仍可写，但只能把条目存成 `draft` / `pending_review`，
不能发布，也不能触碰已发布条目。
:::

## 写入前必带的证据

每次写入都必须带 `edit_note`（非空）与至少一条 `sources`，否则 `400 evidence_required`：

```json
"sources": [{ "kind": "url", "citation": "官方商品页", "url": "https://example.com/item" }]
```

- `kind` 只接受 `url` / `publication` / `self`
- `citation` 不能为空
- `url` 只要是链接就必须合法（`400 invalid_source`）

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
    "attributes": { "tags": ["动画", "电影"] },
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
- `translations` 是按 locale 分组的对象，不是数组；每个语种含 `title` / `summary` / `aliases`
- 原语言题名放在对应语种行里
- `attributes` 的键必须在已发布定义中声明，未声明的键返回 `400 unknown_field: <code>`
- 业务形态用标签（`attributes.tags`）与动态类型表达，没有 `media_type` 这种树状分类
- `cover_aspect` 不是可写字段：它未在已发布定义中声明，自造这个键会被 `unknown_field` 拒绝
- 比例只是展示建议（音乐 1:1、影视 2:3、书籍 3:4），展示层按封面图自然比例推断
- `external_ids` 的键必须是已登记的外部权威库（见 `GET /api/catalog/external-databases`）
- 请求体里出现未知字段一律 `400 invalid_payload`（服务端按严格模式解码）
- 幂等：带 `Idempotency-Key` 请求头时，同键重放直接返回首创结果
- 幂等缓存为进程内存 24 小时；键按「路由 + 用户 + 键」缓存，不做载荷哈希

### 层级与归属字段

| 字段 | 只用在 | 说明 |
|---|---|---|
| `work_id` | content_unit、expression（都必填） | 所属作品 |
| `content_unit_id` | expression（可选） | 所属内容单元 |
| `release_id` | medium（必填） | 所属发行版 |
| `medium_id` | track（必填） | 所属载体 |
| `parent_id` | content_unit / medium / track（可选） | 同域同层父节点 |
| `position` / `number` | medium / track 等 | 次序（非负整数）/ 官方原文编号 |
| `contents[]` | track | 曲目收录内容，字段为 `{ expression_id, position, locator, attributes }` |
| `subjects[]` | release | 发行版声明收录了哪些作品，字段为 `{ work_id, role, position, attributes }` |

`subjects[].role` 取 `primary` / `compilation` / `supplement`，同一作品同一角色只允许一条。

结构字段按层级收敛：发行版没有 `work_id`，收录关系只能经 `subjects`；`contents` 只对 `track` 有效，`subjects` 只对 `release` 有效。给某个 kind 传它用不到的结构字段会返回 `400 invalid_structural_field: <字段码>`，缺必填归属返回 `400 parent_required`。

正确的顺序是按层级自下而上补齐：先 `work` → `content_unit` → `expression`，再 `release` → `medium` → `track`，最后按需建关系。

::: warning 注意
`work_id` / `release_id` / `medium_id` / `kind` 在更新时不可改（`400 immutable_scope`），
写错了只能新建或走生命周期处置。
:::

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

::: warning 注意
PUT 是整实体替换，不是局部 PATCH：先 `GET /api/catalog/entities/:id` 取回完整实体与 `version`，
改完再整体写回。翻译、标签、`contents` 都可能整组替换。
:::

- `expected_version` 与当前版本不一致返回 `409 version_conflict`：重读后再写，不要盲目重试
- 发布就是 PUT 写 `status: "published"`，至少带一条 `translations`，否则 `400 translation_required`
- `deleted` / `merged` 走生命周期端点；PUT 提交这两个状态返回 `400 use_lifecycle_endpoint`
- 已发布条目改回 `draft` 走下架端点 `POST /api/catalog/entities/:id/unpublish`（见下「下架」）；PUT 提交降级仍然返回 `400 use_lifecycle_endpoint`——降级只有这一条通道

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
| `invalid_endpoint_types` | 两端动态业务类型不满足该关系的类型白名单（种子定义未配类型白名单，当前不适用） |
| `duplicate_relation` | 同类型、同端点、同属性的边已存在（去重键不含 `position`） |
| `cardinality_exceeded` | 超过该关系的 `max_outgoing` / `max_incoming`（种子定义未配基数上限，当前不适用） |
| `relation_cycle` | 声明了 `acyclic` 的关系形成环路（如同类续作互指） |

判重的去重键是「端点 + 类型 + 属性」，不含 `position`。同一对端点、同一关系码、属性也完全相同、只有 `position` 不同的两条边会被库内唯一索引拦下（`400 constraint_violation`）。

要表达「同一演员在同一作品的两个角色位」，请让 `attributes` 不同（如 `character` 指向不同角色实体）。

默认种子的关系码如下，以 `GET /api/catalog/definitions` 为准：

- **credits**（署名，一般指向 agent）：`created_by`、`performed_by`、`photographed_by`、`modeled_by`、`developed_by`、`voiced_by`、`composed_by`、`lyricist_of`、`arranged_by`、`directed_by`、`written_by`、`illustrated_by`、`narrated_by`、`translated_by`
- `character_in` 表示角色登场；`credit_for` 是通用署名兜底，职位原文写进 `attributes.credit_role`
- **creative**（内容关系）：work↔work 用 `adaptation_of`、`sequel_of`、`spin_off_of`、`soundtrack_of`；expression↔expression 用 `translation_of`、`revision_of`、`cover_of`、`alternate_take_of`；release↔release 用 `pressing_of`
- **membership**（组成与成员）：`includes`（collection / work → work / collection，声明 `aggregate`）、`member_of`（agent↔agent）、`bonus_included_in`、`store_bonus_for`

`includes` 等声明 `acyclic` 的码会做环路检测；同一角色跨作品用多条 `character_in`。

::: tip 提示
外部来源的职位若没有贴切的码，用 `credit_for` + `credit_role` 保真，不要虚构新码。
:::

## 生命周期：合并与退役

```http
POST /api/catalog/entities/:id/lifecycle
{ "target_id": "<保留的实体>", "expected_version": 3, "edit_note": "merge duplicate",
  "sources": [{ "kind": "url", "citation": "两个条目指向同一实体的官方出处", "url": "https://example.com" }] }
```

- 带 `target_id` 为合并：目标必须同 kind、同归属（`work_id` / `release_id` / `medium_id` / `parent_id` 一致）且已发布，否则 `400 invalid_merge_target`
- 合并后源实体状态置 `merged` 并写入 `redirect_id`，指向它的关系与结构引用会被改写
- 旧 id 用 `GET /api/catalog/entities/:id/resolve` 跟随到保留实体
- 不带 `target_id` 为退役：状态置 `deleted`
- 证据要求与实体写入一致：`edit_note` 非空 + 至少一条 `sources`，空数组会被 `400 evidence_required` 拒绝
- 已 `deleted` / `merged` 的实体再调会返回 `400 invalid_status`
- 两个动作都需要 `catalog.lifecycle.manage`

::: warning 注意
请求体是 `{target_id?, expected_version, edit_note, sources}`，没有 `action` 字段——
合并与退役由 `target_id` 有无决定，带 `{"action":"publish"}` 会 `400 invalid_payload`。
:::

状态集合是 `draft` / `pending_review` / `published` / `deleted` / `merged` 五档，中间态只有待审一档。

## 下架（`published → draft`）

```http
POST /api/catalog/entities/:id/unpublish
{ "expected_version": 3, "edit_note": "线上条目内容有误，退回草稿修订",
  "sources": [{ "kind": "url", "citation": "读者反馈的官方原文", "url": "https://example.com" }] }
```

- 下架是状态机里唯一的降级入口：只接受 `published → draft`
- `draft` / `pending_review` 没有可下架的内容，`deleted` / `merged` 是终态；四种情况都是 `400 invalid_status`
- 请求体是 `{expected_version, edit_note, sources}`，没有 `target_id`——下架只改自身状态，带上会被拒成 `400 invalid_payload`
- 证据要求与其它写入一致：`edit_note` 非空 + 至少一条 `sources`，否则 `400 evidence_required` / `invalid_source`
- `expected_version` 与当前版本不一致返回 `409 version_conflict`（版本条件先判，即使实体已不在 `published` 也是 409）
- 成功返回与实体写入同形状的完整实体：`status` 为 `draft`、`version` 已 +1
- 同一事务写一条修订行（`GET /api/catalog/entities/:id/revisions` 可查）与一条 `entity.unpublished` 事件
- 需要 `catalog.lifecycle.manage`（与合并 / 退役同一档：能清退的人才能下架）
- 未登录 `401 authentication_required`，缺码 `403 forbidden`；id 不存在是 `404 not_found`，状态不对是 `400 invalid_status`（两者不混同）

::: details 备注
下架不计入贡献统计的 `audit_actions`（那里只数 `entity.deleted` / `entity.merged`）：下架不是清退。
修订行仍落在操作者名下，贡献流与修订历史都能查到这次改动（可见性照旧）。
:::

## 修订历史

```http
GET /api/catalog/entities/:id/revisions
```

每次写入都会生成修订行（含操作者、`edit_note`、`sources` 与快照），写入与修订行在同一事务里落库。

实体修订按实体可见性过滤。该端点也接受关系 ID（关系修订行的 `target_id` 就是关系 ID），此时可见性由关系两端实体共同判定。

## 外部导入

导入当前只对接 Bangumi，三个端点都要 `catalog.import.submit`：

| 端点 | 作用 |
|---|---|
| `POST /api/importer/preview` | 按 URL / ID 出站抓取并返回结构化预览，限流 10/分钟 |
| `GET /api/importer/sources` | 列出真有适配器的来源，供导入弹窗取选项；只读注册表、不出站抓取，因此不限流 |
| `POST /api/importer/import` | 按预览载荷落库：作品 → 发行 → 载体 → 曲目 → 关系逐次保存 |

::: warning 注意
`import` 的每条实体各自一个事务：中途失败不会回滚已写入的前序实体，所以落库前的零写入预检才是整体防线。
:::

- 预览含分集分页，详情抓取 ≤8 并发
- `source` 只接受 `bangumi`（或缺省 / `auto`，同样归一为 `bangumi`）；其它来源 `400 not_supported`
- 归一化会去空白、忽略大小写，`preview` 与 `import` 共用同一套归一化
- `entity_type` 取 `work` / `artist` / `organization` / `character`，非法值 `400 invalid_entity_type`
- `link_mode` 取 `new_work`（默认）/ `append_release_to_work` / `create_relation`
- `merge_translations` 会被显式拒绝，补译名走常规编辑
- 落库前做零写入预检：属性值、未知字段码、`original_language`、翻译行与日期字段都按已发布定义校验，规则与实体写入一致
- 没有落库位置的载荷字段以 `unsupported_field_for_entity_type` 明确拒绝，不静默丢弃
- 导入会拉取条目的演职员与角色：语义明确的职位映射到精确关系码（如 `directed_by` / `photographed_by` / `voiced_by`）
- 没有精确映射的职位落 `credit_for` 并把职位原文写进 `credit_role`
- 角色番位落 `character_in` 的 `character_rank`，声优建 `voiced_by` 并以 `character` 引用角色实体
- 上游 infobox 会映射到已声明的字段码：映射表命中才写，未命中的键只留在 `attributes.infobox` 原文快照里，不另造字段
- 分集/篇目按上游分集端点落 `content_unit` 树
- 发行版的 `edition_type` / `edition_batch` / `packaging` / `distribution_channel` 只在命中词表时写入，未命中时该维度留空而不是硬凑映射

::: warning 注意
导入范围只含署名与角色关系。上游的 work↔work 关系网（`/v0/subjects/{id}/subjects` 一类关联）
与 `publisher` 实体引用都在导入范围之外（预览只给自由文本名称，不虚构 Agent 引用）。
:::

### 来源清单：`GET /api/importer/sources`

- `id` 是代码里的适配器集合，当前只有 `bangumi`
- `names` / `category` / `icon` / `description` / `url_pattern` 来自外部权威库注册表，含停用行
- `is_enabled` 只管外链字段是否出现，不决定有没有导入能力
- 后台改名 / 换图标后弹窗下次打开即生效
- 管理员新增一行注册表不会自动出现在这里：适配器是代码事实
- `auto` 也不在清单里——它是解析别名，不是来源

## 实例间交换

| 端点 | 作用 |
|---|---|
| `GET /api/exchange/entities/:id` | 导出单个实体快照（JSON），供另一实例导入 |
| `POST /api/exchange/proposals` | 提交外部编辑提案，请求体与实体写入相同 |

- 导出按调用者身份判可见性（匿名只看已发布），不存在或不可见都是 `404 not_found`
- 提案由服务端强制落 `pending_review`，不能绕过审核直接发布

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

::: warning 注意
定义、货架与外部权威库的名称是四语硬约束：每个名称都要带 `zh-CN`、`zh-TW`、`en-US`，
并且至少带 `ja` 或 `ja-JP` 之一。缺任一项，写入直接失败并返回
`400 four_locale_names_required: <缺失语种>`（多个缺失项以逗号分隔，如 `four_locale_names_required: zh-TW,ja-JP`）。
:::

四语约束作用于定义文档里启用中的条目：

- 类型（`types`）、字段（`fields`，含嵌套子字段；字段单位 `unit` 只在声明了单位时校验）
- 词表与词项（`vocabularies` / `terms`）、关系（`relations` 的 `names` / `reverse_names` / `group_names`）
- 模板与模板分区（`templates` / `sections`）、场景方案（`schemes`）
- 货架 `names`（`/api/admin/shelves`）与外部权威库 `names`（`/api/admin/external-databases`）

停用的类型 / 字段 / 词项 / 关系 / 场景不参与校验，存量两语条目可以原样保留；空 `group_names` 视为未声明。

判定只看「键在且非空」，不要求译文与英文不同：`CD`、`Spotify`、`ISBN` 这类专有名词四语同形是合法的。

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
