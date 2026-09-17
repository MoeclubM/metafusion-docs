---
title: "AI Agent 自动化 API 与工具规范"
description: "面向 LLM / Agent 的工具声明、写入契约、权限码、幂等与错误自愈表。"
order: 36
group: "api"
---

# AI Agent 自动化 API 与工具规范

Agent 的全部编目能力都建立在同一条主干上：查重读 `GET /api/catalog/entities`，写入用 `POST / PUT /api/catalog/entities`，关系读 `GET /api/catalog/entities/{id}/relations`、写用 `POST / PUT /api/catalog/relations`。
主干没有一站式原子提交端点，也没有按 kind 拆分的 REST 端点——一条发行链要按层级逐次提交，后一次失败不会回滚前面已成功的实体。

接入前先读：[API 概览](/api-overview)、[认证与凭证](/api-auth)、[新建与编辑](/api-edit)、[元数据目录](/catalog)；逐步操作流程见 [AI Agent 接入与自动化编目协作指南](/agent-integration)。

## 1. 运行时事实来源

字段码、词表项、关系码与结构归属**只从服务端取**，不要固化在 Agent 里：

| 事实 | 来源 |
| --- | --- |
| 端点、请求体模式、响应模式 | `GET /api/openapi.json`（OpenAPI 3.0.3，只覆盖目录服务） |
| 发布态定义：types / fields / vocabularies / relations / templates / schemes / structure，以及八类 kind 的多语言名 `kinds`（每项名称是四语 map） | `GET /api/catalog/definitions` |
| 实际能力 | 目标实例的响应；文档与响应冲突时以响应为准，暂停写入并记录差异 |

八类 kind 是固定的骨架：`agent` / `collection` / `work` / `content_unit` / `expression` / `release` / `medium` / `track`。`kind` 参数取具体 kind，没有 `all`。

## 2. 工具声明

可直接拉取 `GET /api/openapi.json` 生成工具集，或注入以下声明（字段名与路径与实现一致）：

```json
{
  "tools": [
    {
      "name": "metafusion_search_entities",
      "description": "按题名或翻译文本的子串检索实体，用于查重与关系对端选择。返回 {items, total}；total 是真实计数。",
      "method": "GET",
      "path": "/api/catalog/entities",
      "parameters": {
        "type": "object",
        "properties": {
          "q": { "type": "string", "description": "题名或 translations 整段文本的子串匹配（ILIKE）" },
          "kind": { "type": "string", "enum": ["agent", "collection", "work", "content_unit", "expression", "release", "medium", "track"] },
          "kinds": { "type": "array", "items": { "type": "string" }, "description": "多 kind，命中任一即返回；逗号分隔或重复出现等价" },
          "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 50, "description": "默认 50、上限 100；越界静默按 50 处理，不报错" },
          "offset": { "type": "integer", "minimum": 0, "default": 0 }
        }
      }
    },
    {
      "name": "metafusion_get_entity",
      "description": "读取实体详情。PUT 之前必须先调用它拿全量字段与当前 version。不可见或不存在都返回 404。",
      "method": "GET",
      "path": "/api/catalog/entities/{id}",
      "parameters": {
        "type": "object",
        "properties": { "id": { "type": "string", "format": "uuid" } },
        "required": ["id"]
      }
    },
    {
      "name": "metafusion_save_entity",
      "description": "创建或整实体替换一个实体。创建用 POST（entity.id 留空、expected_version 为 0），更新用 PUT 并带上刚读到的 version。没有跨层级的原子提交端点，发行链按层级多次调用。",
      "method": "POST | PUT",
      "path": "/api/catalog/entities（创建）；更新用 /api/catalog/entities/{id}",
      "parameters": {
        "type": "object",
        "properties": {
          "entity": {
            "type": "object",
            "description": "实体本体；kind 与 title 必填，结构归属字段按 kind 填写（content_unit/expression 用 work_id，medium 用 release_id，track 用 medium_id，release 用 subjects）",
            "required": ["kind", "title"]
          },
          "expected_version": { "type": "integer", "description": "创建必须为 0；更新必须等于当前 version，不一致返回 409" },
          "edit_note": { "type": "string", "description": "本次修改的具体说明，非空" },
          "sources": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "properties": {
                "kind": { "type": "string", "enum": ["url", "publication", "self"] },
                "citation": { "type": "string" },
                "url": { "type": "string", "description": "kind=url 时必填，必须是合法 HTTP(S) 链接" }
              },
              "required": ["kind", "citation"]
            }
          }
        },
        "required": ["entity", "edit_note", "sources"]
      }
    },
    {
      "name": "metafusion_save_relation",
      "description": "创建或替换一条实体关系。关系码与两端 kind 必须来自 definitions 中 enabled 的定义。",
      "method": "POST | PUT",
      "path": "/api/catalog/relations（创建）；更新用 /api/catalog/relations/{id}",
      "parameters": {
        "type": "object",
        "properties": {
          "relation": {
            "type": "object",
            "properties": {
              "type": { "type": "string", "description": "关系码，如 includes / adaptation_of / directed_by / character_in" },
              "source_id": { "type": "string", "format": "uuid" },
              "target_id": { "type": "string", "format": "uuid" },
              "position": { "type": "integer", "minimum": 0, "default": 0 },
              "attributes": { "type": "object", "description": "可用键见该关系定义的 fields：role / credit_role / character_rank / context / character / language / begin_date / end_date / scope" }
            },
            "required": ["type", "source_id", "target_id"]
          },
          "expected_version": { "type": "integer" },
          "edit_note": { "type": "string" },
          "sources": { "type": "array", "minItems": 1 }
        },
        "required": ["relation", "edit_note", "sources"]
      }
    },
    {
      "name": "metafusion_get_definitions",
      "description": "读取发布态定义文档与八类 kind 的多语言名。字段码、词表项与关系码的唯一来源。",
      "method": "GET",
      "path": "/api/catalog/definitions",
      "parameters": { "type": "object", "properties": {} }
    }
  ]
}
```

## 3. 认证与权限码

身份只来自账号服务（`metafusion-auth`）签发的 RS256 令牌：请求头 `Authorization: Bearer <token>` 或 Cookie `mf_session`，目录侧只验签。**平台不签发个人访问令牌**，没有 `mfp_` 前缀、`X-API-Key` 或 `catalog:write` scope；程序化接入用会话令牌或 OAuth 访问令牌（见 [认证与凭证](/api-auth)）。

| 权限码 | 允许的操作 | 闸门位置 |
| --- | --- | --- |
| `catalog.entity.edit` | 维护公开条目，并维护自己创建的任意状态条目 | 不在路由上硬闸：`POST / PUT /api/catalog/entities` 只要求登录；无此码者只能写自己创建的 `draft` / `pending_review` |
| `catalog.relation.edit` | 关系创建、替换与删除 | 硬闸：`POST /api/catalog/relations`、`PUT / DELETE /api/catalog/relations/:id` |
| `catalog.lifecycle.manage` | 发布/处置他人的未发布条目；合并、退役与下架 | 合并/退役硬闸：`POST /api/catalog/entities/:id/lifecycle`；下架硬闸：`POST /api/catalog/entities/:id/unpublish`；发布他人草稿走实体写入 `PUT`（同一权限码判定） |
| `catalog.definitions.manage` | 定义版本与外部权威库管理 | 硬闸：`/api/admin/catalog-definitions`、`/api/admin/external-databases` |
| `catalog.import.submit` | 外部导入预览与落库 | 硬闸：`POST /api/importer/preview`、`POST /api/importer/import` |
| `catalog.shelves.manage` | 货架规则管理 | 硬闸：`/api/admin/shelves` |

权限码来自令牌的 `permissions`：带 `*` 即全部目录权限；令牌完全没有 `permissions` 字段时（老令牌或未按权限组配置的实例）才按角色兜底——`admin` 放行全部目录码，`editor` 只放行 `catalog.entity.edit`，其余不放行。

## 4. 写入契约

请求体统一是「实体/关系 + 版本 + 证据」三件套：`{entity | relation, expected_version, edit_note, sources}`。

### 4.1 实体写入

| 行为 | 具体事实 |
| --- | --- |
| 创建 | `POST /api/catalog/entities`；`entity.id` 必须留空（带了返回 `400 id_must_be_empty`），`expected_version` 必须为 0 |
| 更新 | `PUT /api/catalog/entities/:id`：**整实体替换**，先 `GET` 全量、只改需要改的字段、其余原样带回；翻译、标签、`contents` 都可能整组替换 |
| 乐观锁 | 版本条件进 SQL 的 `WHERE`，读版本与写入是一次原子操作；不一致返回 `409 version_conflict` |
| 不可变归属 | `kind` / `work_id` / `release_id` / `medium_id` 写入后不可改（`400 immutable_scope`）；换归属要重建实体 |
| 结构归属 | `content_unit` / `expression` 必须有 `work_id`，`medium` 必须有 `release_id`，`track` 必须有 `medium_id`，否则 `400 parent_required`；`parent_id` 只能指向同域父节点 |
| 收录声明 | 被 Track 收录的 Expression 所属 Work，必须在该 Release 的 `subjects` 里声明（`role` 取 `primary` / `compilation` / `supplement`），否则 `400 undeclared_release_subject` |
| 状态 | 缺省 `draft`，另有 `pending_review` / `published`；`deleted` / `merged` 只能经生命周期端点写入（`400 use_lifecycle_endpoint`）。生命周期端点只做合并与退役，请求体 `{target_id?, expected_version, edit_note, sources}` **没有 `action` 字段**；**已发布条目退回 `draft` 走下架端点** `POST /api/catalog/entities/:id/unpublish`（体为 `{expected_version, edit_note, sources}`，**不能带 `target_id`**；只接受 `published → draft`，其余状态 `400 invalid_status`），PUT 提交降级仍返回 `use_lifecycle_endpoint` |
| 发布 | `status=published` 要求至少一条 `translations`（`400 translation_required`），且所有结构引用的实体对匿名可见，即本身已发布 |
| 证据 | `edit_note` 非空 + `sources` 至少 1 项，否则 `400 evidence_required` |

`translations` 是按 locale 分组的对象（每个语种含 `title` / `summary` / `aliases`），不是数组；`pictures` 的每一项都要带 `source`，其证据规则与 `sources` 相同。

### 4.2 关系写入

```json
{
  "relation": {
    "type": "includes",
    "source_id": "<集合或作品 UUID>",
    "target_id": "<作品或集合 UUID>",
    "position": 0,
    "attributes": { "context": "<篇目 UUID>" }
  },
  "expected_version": 0,
  "edit_note": "依据官方发行页声明合集中的收录关系",
  "sources": [{ "kind": "url", "citation": "官方发行页", "url": "https://example.com/release" }]
}
```

服务端校验：关系码必须存在且 enabled、两端 kind 在 `source_kinds` / `target_kinds` 内、两端业务类型在 `source_types` / `target_types` 白名单内、属性键属于该关系声明的 `fields`、不重复（同端点同类型同属性同 position）、不超基数，声明 `acyclic` 的关系会做环路检测。同一条边用不同属性区分（如不同 `credit_role` / `language`）是合法的。

### 4.3 生命周期：合并、退役与下架

合并与退役走管理端点，带 `target_id` 是合并、不带是退役。生命周期写入同样要证据（`edit_note` 非空 + `sources` 至少一条，否则 `400 evidence_required`）：

```http
POST /api/catalog/entities/:id/lifecycle
{ "target_id": "<保留的实体 UUID>", "expected_version": 3, "edit_note": "合并重复建档",
  "sources": [{ "kind": "url", "citation": "官方条目页", "url": "https://example.com/entry" }] }
```

合并要求目标同 kind、同归属（`work_id` / `release_id` / `medium_id` / `content_unit_id` / `parent_id` 都相同）且已发布，否则 `400 invalid_merge_target`；源实体写入 `redirect_id`，之后用 `GET /api/catalog/entities/:id/resolve` 跟随到保留实体。改引用与修订记录在同一事务内完成。

下架（`published → draft`）是状态机里**唯一**的降级入口，权限、证据与乐观锁口径都与上面一致：

```http
POST /api/catalog/entities/:id/unpublish
{ "expected_version": 3, "edit_note": "退回草稿修订",
  "sources": [{ "kind": "self", "citation": "核对官方条目后确认内容有误" }] }
```

请求体没有 `target_id`（带上 → `400 invalid_payload`）；只接受 `published → draft`，`draft` / `pending_review` / `deleted` / `merged` 都是 `400 invalid_status`；成功返回与 Save 同形状的完整实体，同一事务写一条修订行与 `entity.unpublished` 事件（下架不计入贡献统计的 `audit_actions`，那里只数删除与合并）。

## 5. 幂等、并发与限流

- **Idempotency-Key**：只有 `POST /api/catalog/entities` 与 `POST /api/catalog/relations` 认这个请求头。缓存键是「路由 + 用户 + key」，命中直接返回首创结果、不建重复数据；存活 24 小时，存在**进程内存**里，重启即失效，也不做载荷哈希——同一个 key 换了载荷不会报冲突，会照首发结果返回。并发同 key 不保证单飞，重试前先回读确认。
- **更新与删除不用幂等键**，靠 `expected_version`：收到 `409 version_conflict` 就回读实体取最新 version 再重放，不要盲目重复创建。
- **限流**：`GET /api/catalog/entities` 120/分钟、`GET /api/catalog/tags` 120/分钟、`POST /api/catalog/expressions/details` 120/分钟、`GET /api/catalog/shelves/feed` 60/分钟、`GET /api/users/:id/contributions` 120/分钟、`GET /api/catalog/compare` 10/分钟、`POST /api/importer/preview` 10/分钟（按 IP + 路由、进程内存固定窗口）。写入接口没有路由级限流，但仍受网关按 IP 的约束。超限响应 `429 { "error": "rate_limited" }` 并带 `Retry-After`（秒）。

## 6. 错误码与自愈策略

错误响应统一为 `{ "error": "<机器码>" }`，个别码带补充信息（如 `unknown_field: <字段码>`）。

| 状态码 | `error` | 触发原因 | Agent 自愈动作 |
| --- | --- | --- | --- |
| 400 | `invalid_payload` | JSON 形状错误、含未知字段，或 body 后还有多余内容 | 按当前 DTO 重写载荷；字段名以当前契约为准 |
| 400 | `invalid_payload`（导入子类型：`has_release=true requires mediums` / `release requires mediums`） | 导入载荷声明了发行（`has_release=true`，或带了非空 `release`）却没有 `mediums` | 补 `mediums`；无载体发行改走 `link_mode=append_release_to_work` |
| 400 | `unsupported_field_for_entity_type` / `invalid_entity_type` / `invalid_link_mode` | 导入载荷里声明了该 `entity_type` 没有落点的字段（如 `mediums[].media_category`、`release.cover_aspect`），或 `entity_type` / `link_mode` 越出允许枚举 | 删掉没有落点的字段或补上对应结构；枚举取 `work` / `artist` / `organization` / `character` 与 `new_work` / `append_release_to_work` / `create_relation`；预览与落库同一预检、零写入 |
| 400 | `invalid_id` | 路径或结构字段里的 UUID 解析失败 | 用查重与详情响应里的真实 id |
| 400 | `id_must_be_empty` | 创建时带了 `entity.id` | 创建一律留空 id、`expected_version` 传 0 |
| 400 | `evidence_required` | 缺 `edit_note`，或 `sources` 为空 | 补一段具体修改说明 + 至少一条来源 |
| 400 | `invalid_source` | 来源项非法：`kind` 不是 url / publication / self，`citation` 为空，或 `url` 不是合法 HTTP(S) | 按规则重写 `sources` |
| 400 | `invalid_reference` | 被引用实体不存在、kind 不符、对调用者不可见或已合并 | 先读该实体确认可见性；合并过的先用 `/resolve` 取当前身份 |
| 400 | `constraint_violation` | 违反库内约束：跨 Work 的父子、跨 Release 的载体父子、唯一索引冲突 | 检查 `parent_id` 与 `position` 是否越过所属域 |
| 400 | `immutable_scope` | 想改 `kind` / `work_id` / `release_id` / `medium_id` | 换归属要重建实体；重复建档走生命周期合并 |
| 400 | `use_lifecycle_endpoint` | 用实体写入提交 `deleted` / `merged`，或把已发布条目降级 | 停用/合并改走 `POST /api/catalog/entities/:id/lifecycle`；退回 `draft` 改走 `POST /api/catalog/entities/:id/unpublish`（需 `catalog.lifecycle.manage`） |
| 400 | `translation_required` | 发布态一条 `translations` 都没有 | 至少补一个语种的翻译行再发布 |
| 400 | `four_locale_names_required` | 定义 / 货架 / 外部库的名称缺语种（冒号后列出缺失项，如 `four_locale_names_required: zh-TW,ja-JP`） | 找齐四语名称（`zh-CN` / `zh-TW` / `en-US` 加 `ja` 或 `ja-JP`）后重提定义草稿；不要靠停用条目绕开校验 |
| 400 | `parent_required` | 缺结构归属：`content_unit` / `expression` 缺 `work_id`、`medium` 缺 `release_id`、`track` 缺 `medium_id` | 补归属，或改到正确的层级提交 |
| 400 | `undeclared_release_subject` | Track 收录的表达所属 Work 没有在该发行的 `subjects` 中声明 | 在该发行上补 `subjects`，再重放 Track |
| 400 | `invalid_relation_type` / `invalid_endpoints` / `invalid_endpoint_types` / `duplicate_relation` / `cardinality_exceeded` / `relation_cycle` | 关系语义校验失败：码不存在或未启用、端点 kind 或类型不允许（自环也走这里）、重复边、超基数、成环 | 只用 definitions 中 enabled 的码与允许的端点；自环一律不支持；先删冲突旧边再建 |
| 400 | `invalid_term` / `invalid_type` / `invalid_position` | 词表值、业务类型或排序值不在允许集合内 | 用 definitions 里对应字段的 `vocabulary.terms` 与 `types` |
| 400 | `invalid_status` | 状态值不在 `draft` / `pending_review` / `published` / `deleted` / `merged` 之内；或状态机不允许该动作（下架只接受 `published`，生命周期端点拒绝已 `deleted` / `merged` 的实体） | 状态值按五档写；动作不合法先 `GET` 读回当前 `status`：已是 `draft` 不必下架，`deleted` / `merged` 要恢复只能新建 |
| 400 | `field_not_searchable` / `unknown_field` | `field` 过滤的字段未声明、链路含停用字段，或字段码不存在 | 从 definitions 取字段集与 `searchable`，不要按名称猜 |
| 401 | `authentication_required` | 需要登录的端点没有有效令牌 | 重新登录或换用 OAuth 访问令牌 |
| 403 | `forbidden` | 已登录但缺对应权限码，或不是该条目的可写者 | 核对令牌 `permissions`；发布、合并归生命周期权限 |
| 404 | `not_found` | 不存在，或对调用者不可见（不区分两者） | 用查重响应里的 id；未发布条目只对创建者与持权限者可见 |
| 409 | `version_conflict` | `expected_version` 与当前版本不一致 | 回读实体取最新 version 再重放，不盲目重试 |
| 429 | `rate_limited` | 命中路由级限流 | 按 `Retry-After` 退避后重试 |
| 500 | `database_error` | 服务端数据库故障（不透出 SQL 细节） | 停止写入，把错误码与请求摘要一起上报 |

遇到表里没有的码：先用最小载荷复现一次排除自身形状问题，再核对 `GET /api/openapi.json` 与 `GET /api/catalog/definitions`；仍无法解释就停止写入并按「实现缺口」上报，不要用近似数据填充，也不要绕过接口改库。

## 7. 提交顺序

按依赖顺序提交，每一步读取响应并保存 id，失败就停下，不要用默认值填补缺失来源：

```text
agent / work  →  content_unit / expression  →  release（声明 subjects）  →  medium  →  track  →  relations
```

完整可照抄的脚本（检索 → 建链 → 关系 → 回读）见 [AI Agent 接入与自动化编目协作指南](/agent-integration)。

## 8. 相关文档

- [AI Agent 接入与自动化编目协作指南](/agent-integration)：身份设定、7 步 SOP、盒装建模、示例脚本与排错
- [新建与编辑](/api-edit)：写入 DTO、乐观锁、关系与生命周期
- [API 概览](/api-overview)：能力分组、分页、限流与可见性
- [实体查询与详情](/api-entities)：过滤参数与详情、关系、收录反查
- [元数据目录](/catalog)：固定层级与编目边界
- [权威编目与审查准则](/curation-guide)：题名、证据与审查口径
