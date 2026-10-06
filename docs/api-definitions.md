---
title: "动态定义与配置"
description: "字段、词表、关系、模板、场景、货架及限流策略的读取与维护。"
order: 55
group: "api"
---

# 动态定义与配置

客户端先读 definitions，再构造字段、词项和关系。实例可以调整这些定义；源码种子和本文示例不能代替运行时清单。

## 公开定义

`GET /api/catalog/definitions` 返回当前 `etag`、`kinds`、`fields`、`vocabularies`、`relations`、`templates`、`schemes`、`structure` 和只读 `relationship_rules`。

| 区域 | 作用 |
| --- | --- |
| fields | 值结构、可搜索性、适用 kind、词表或引用规则 |
| vocabularies | 词表与词项 |
| relations | 语义关系、端点、基数、方向及上下文 |
| templates | 字段布局、匹配条件与展示区块 |
| schemes | 内嵌结构的场景字段范围 |
| structure | 固定归属、subjects 与 contents 的展示声明 |
| relationship_rules | 固定结构、语义关系及声明的属性实体引用注册表 |

只使用当前允许的字段与词项。停用值可以保留历史显示，不能直接作为新增值。

## 字段与场景

实体属性的可写范围来自 `fields.<code>.applicable_kinds`；空集合表示该字段只供关系或内嵌结构使用。标签不决定可写范围。

组字段与列表支持嵌套结构。列表筛选需叶子字段 `searchable=true` 且沿途字段启用，查询例子见[实体查询与详情](/api-entities)。

`locator`、`subject_attributes` 和 `inclusion_attributes` 使用组字段与 schemes：

- 按拥有者 kind 匹配同槽位方案；Track 可进一步按 Medium.format 匹配 `medium_formats`。
- 命中方案的 fields 取并集，并收敛可用子字段与必填项；没有匹配方案时使用全局组。
- locator 的 `relative_to` 说明定位参照；任一匹配方案要求 `require_range` 时，至少填写一个内容定位子字段。
- 修改载体格式会重新校验现有 Track，冲突不能保存。

## 关系与模板

关系声明可包括 `source_kinds`、`target_kinds`、基数、对称性、`acyclic`、`scope`、`cycle_group`、`unique_position` 和 `reference_scopes`。署名与派生关系按实际定义选码，端点不可凭名称猜测。

`usage=expression_composition` 表示同 Work 的整体与部分表达；`usage=release_group` 表示 Release 归入一个 Work 或 Collection 版本组。对应查询端点见[实体查询与详情](/api-entities)。

模板 `match` 的 exists / equals / contains 条件取 AND，`priority` 决定优先级；最高优先级并列时使用通用布局。省略 match 的模板不自动匹配，显式 `[]` 是该 kind 的兜底条件。

`blocks` 排列受支持的目录、组成、版本、收录、署名、关系和资源区块；省略时继承布局，`[]` 隐藏可选区块。新增字段与关系可以配置，新增固定外键或全新组件行为需要开发与迁移。

`role` 词项的 `is_bonus` 控制附赠分组展示，不由前端按词项名称猜测。

## 保存定义

以下端点需要 `catalog.definitions.manage`：

| 端点 | 用途 |
| --- | --- |
| `GET /api/admin/catalog-definitions` | 读取 `{document, etag, updated_at}` |
| `POST /api/admin/catalog-definitions/impact` | 以 `{document}` 检查已有数据影响 |
| `PUT /api/admin/catalog-definitions` | 保存完整文档，事务内再次检查 |

```json
{
  "document": {"fields": {}, "vocabularies": {}, "relations": {}, "templates": {}, "schemes": {}, "structure": {}},
  "expected_etag": "<current_etag>",
  "edit_note": "说明定义修改及其依据",
  "sources": [{"kind": "publication", "citation": "定义依据"}]
}
```

示例只说明信封结构。实际提交从 GET 返回的完整 document 修改，不能用示例的空对象替换现有配置。

定义只保留一份生效文档。ETag 防止覆盖并发修改，不用于读取历史；过期返回 `409 version_conflict`。固定 structure 必须与实际骨架、必填性、subjects 和 contents 一致，否则 `fixed_structure_mismatch`。

启用的字段、单位、词表、词项、关系正反向名称、声明的分组名、模板与分区、场景，以及货架和外部库名称需包含 `zh-CN`、`zh-TW`、`en-US` 与 `ja` 或 `ja-JP`。缺失返回 `four_locale_names_required: <缺失语种>`。

## 货架与外部权威库

| 端点 | 用途 / 权限 |
| --- | --- |
| `GET /api/catalog/shelves`、`/shelves/feed` | 公开规则与求值后的作品 |
| `/api/admin/shelves`、`/:id` | 管理货架，需要 `catalog.shelves.manage` |
| `GET /api/catalog/external-databases` | 可用于 external_ids 的权威库 |
| `/api/admin/external-databases`、`/:code` | 管理外部库，需要 `catalog.definitions.manage` |

货架 query 支持 tags / fields / vocab_terms / relations：条件间 AND，同数组内 OR。空 query 收录全部已发布 Work。sort 为 `updated`、`created` 或 `title`；名称需四语。

权威库登记决定编号与外链是否可用，不自动产生导入适配器。实际导入来源由 `GET /api/importer/sources` 提供，见[新建与编辑](/api-edit)。

## 个人首页偏好

登录用户使用 `GET|PUT /api/catalog/me/home-preferences`。PUT 请求 `{order, hidden, sections}`：

- order / hidden 保存本人分区顺序与显隐；未知 slug 保留，合并展示时忽略。
- sections 最多 20 条；slug 命中系统货架时覆盖本人看到的名称、query、sort 和 icon，否则新增本人分区。
- slug 匹配 `^[a-z0-9][a-z0-9_-]{1,63}$`，名称至少有非空 zh-CN，同 slug 只采用首次声明。
- sort 使用货架相同闭集，空值为 updated；违反返回 invalid_slug / invalid_name / invalid_sort，超量为 too_many_sections。

`GET /api/catalog/shelves/feed` 的 `per_shelf` 默认 12、上限 100。登录请求按偏好求值，每条 shelf 的 source 为 system 或 custom。个人覆盖系统货架仍标记 system。

## 目录限流策略

`GET|PUT /api/admin/rate-limits` 需要 `catalog.definitions.manage`，读取 `{policy, etag, updated_at}`。

PUT 使用 `{policy, expected_etag, edit_note, sources}`。policy 可配置全局 `default_per_minute` / `default_unlimited`，以及 groups / accounts 的 `per_minute` / `unlimited`。保留组 `anonymous` 对应匿名请求。

账号规则优先于组，多组取最宽松，再回落全局与路由默认。该配置拥有独立 ETag，不改变目录定义。计数与客户端退避见[API 概览](/api-overview)。
