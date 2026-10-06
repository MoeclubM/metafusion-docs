---
title: "实体模型与字段"
description: "八类实体的公共字段、固定归属、收录与动态关系。"
order: 20
group: "model"
---

# 实体模型与字段

MetaFusion 借用 IFLA LRM 的分层思想，并以八类固定实体、收录结构和动态定义实现目录。建模示例见[元数据目录教程](/catalog)，本页用于查字段和约束。

## 概念与实现

| 概念 | kind | 保存的事实 |
| --- | --- | --- |
| 责任主体 | `agent` | 个人、组织、团体或虚构角色身份 |
| 集合与企划 | `collection` | 聚合作品与集合 |
| 作品 | `work` | 独立创作身份 |
| 内容单元 | `content_unit` | 同作品内的稳定篇目与目录 |
| 具体表达 | `expression` | 录音、正文、译本或剪辑 |
| 发行 | `release` | 公开出版或发布记录 |
| 载体 | `medium` | 同发行内的承载单元 |
| 收录位置 | `track` | 同载体内的位置与实际收录 |

文件资产由存储服务管理。目录引用表达与定位，文件绑定引用条目身份。

## 公共字段

| 字段 | 说明 |
| --- | --- |
| `id` / `kind` | UUID 与固定种类 |
| `version` / `status` | 乐观锁版本与生命周期状态 |
| `title` / `original_language` | 基础题名与原始语言 |
| `translations` | 按语言标签分组的对象，各项含 `title`、`summary`、`aliases` |
| `attributes` | 动态属性，允许键及适用种类由 definitions 决定 |
| `external_ids` | 已登记外部权威库的编号 |
| `pictures` | 有序图片引用及来源；首项为封面，时间信息不改变顺序 |
| `created_by` / `created_at` / `updated_at` | 创建者与时间 |
| `redirect_id` | 合并后的目标，由生命周期操作维护 |

图片可以记录多语言说明、用途、版本名称、使用期与存储资产 ID。完整形状以目标实例的 OpenAPI 为准。

动态属性的可写范围由 `fields.<code>.applicable_kinds` 声明；空集合表示只用于关系或内嵌结构。标签不会扩大字段权限。动态定义规则见[动态定义与配置](/api-definitions)。

## 固定归属

| 字段 | 使用位置 | 约束 |
| --- | --- | --- |
| `work_id` | content_unit、expression | 必填 |
| `content_unit_id` | expression | 可选，须与表达同属一个 Work |
| `release_id` | medium | 必填 |
| `medium_id` | track | 必填 |
| `parent_id` | content_unit、medium、track | 可选，同层且同归属、无环 |
| `position` / `number` | 目录或位置项 | 非负排序整数 / 来源中的原始编号 |

`kind`、`work_id`、`release_id` 和 `medium_id` 写入后不能改归属；违反时返回 `immutable_scope`。同层父子受对应 Work、Release 或 Medium 的范围约束。

## 发行对象与实际收录

Release 没有 `work_id`，通过 `subjects[]` 声明收录了哪些作品：

```json
{"work_id": "<work_uuid>", "role": "primary", "position": 0, "attributes": {}}
```

`role` 使用当前允许值，固定入口接受 `primary`、`compilation`、`supplement`。同一作品同一角色只保留一项。

Track 的 `contents[]` 是实际收录的权威来源：

```json
{
  "expression_id": "<expression_uuid>",
  "position": 0,
  "locator": {},
  "attributes": {},
  "sources": [{"kind": "publication", "citation": "内页曲目表"}]
}
```

可以跨 Work 收录，但对应 Work 必须列入所属 Release 的 `subjects`。Track 的位置表示载体曲序，contents 的位置表示同一 Track 内多段内容的次序。

`locator` 与附加属性按 definitions 的组字段及场景方案校验。定位仅属于这次收录，不随 Expression 在不同发行之间复制。

## 关系

语义关系记录来源端、目标端、关系码、位置及上下文属性。码和允许的端点来自 definitions；关系可声明基数、对称性、无环组、同域范围和引用归属约束。

表达组成与发行版本组也是语义关系。固定外键、subjects、contents 则由其拥有者维护；统一查询把这些事实投影为可遍历的链接，不重复存一份边。

definitions 声明的实体属性引用也投影为 reference 链接，支持嵌套 group/list 和双向读取；普通字符串不自动解释为引用。全部可读规则在 `definitions.relationship_rules` 中。使用方法见[实体查询与详情](/api-entities)的关系查询部分。

## 状态与修订

状态包括 `draft`、`pending_review`、`published`、`deleted`、`merged`。发布要求至少一条语言资料，可见性见[API 概览](/api-overview)。

每次写入带修改说明与来源，保留修订快照。合并、停用和下架通过专用生命周期入口执行；载荷与错误处理见[新建与编辑](/api-edit)。
