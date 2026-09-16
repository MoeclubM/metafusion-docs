---
title: "IFLA LRM 增强版实体模型"
description: "LRM 分层思想在 MetaFusion 的落地：八类固定骨架、结构字段与关系。"
order: 10
group: "model"
---

# IFLA LRM 增强版实体模型

MetaFusion 借用 IFLA LRM 的分层思想组织元数据，但落地形态是一套**固定八类实体骨架 +
服务端动态定义**，没有硬编码的 `media_type` 分类树，也没有名为 `CanonicalEntry` / `Artist` /
`Franchise` 的实体。可以编辑的类型、字段、词表、关系与展示模板全部来自
`GET /api/catalog/definitions`。

## LRM 概念到实现的映射

| LRM 概念 | MetaFusion 实现 | 关键点 |
|---|---|---|
| 作品 Work | `work` | 纯净题名与抽象创作本体；不写季数、载体、规格 |
| 表现 Expression | `expression` | 属于一个 `work`，可再关联 `content_unit`；版本差异、语言、演职落在这一层 |
| 内容单元（篇目） | `content_unit` | 同作品内的稳定目录节点：第几章、第几话、某条路线 |
| 载体表现 Manifestation | `release` | 公开可考的发行形态；`subjects` 声明它收录了哪些 `work` |
| 单件 Item | 存储服务的资产 | 文件与绑定由 `metafusion-storage` 用 SHA-256 内容寻址管理；目录只留实体 UUID 与 `locator` |
| 责任主体 Agent | `agent` | 个人、团体与虚构角色共用一类；「谁做了什么」由关系表达 |
| 集合 Collection | `collection` | 企划、系列、合集；用 `includes` 聚合作品 |
| 承载容器（无 LRM 对应） | `medium` / `track` | 分盘分卷与收录位置；`track.contents[]` 指向被收录的 `expression` |

层级方向（箭头读作「属于 / 承载」）：

```
work ──1:N──▶ content_unit ──1:N──▶ expression
  │                                    ▲
  ├──1:N──▶ release ──1:N──▶ medium ──1:N──▶ track ──contents[].expression_id──┘
  │                 │
  │                 └──subjects[]──▶ work（发行版声明的收录作品）
  └──relations──▶ agent / collection
```

## 通用字段

所有实体共用一张表，字段与 `backend/internal/catalog/types.go` 的 `Entity` 一一对应：

| 字段 | 说明 |
|---|---|
| `id` / `version` / `status` / `created_by` / `updated_at` | 身份、乐观锁版本、状态、创建者与更新时间 |
| `title` | 默认题名（展示回退的兜底） |
| `original_language` | 原语言，用语言标签（如 `ja` / `zh-CN`） |
| `translations` | 按 locale 分组的**对象**：每个语种含 `title` / `summary` / `aliases` |
| `types` | 动态业务类型码，来自 definitions 的 `types` |
| `attributes` | 动态属性，键必须在 definitions 的 `fields` 里声明（含 `cover_aspect`、`tags`） |
| `external_ids` | 外部权威库标识；键必须已在 `external_databases` 预设 |
| `pictures` | 图片引用：`url` + `caption`（多语言）+ `taken_at` + `source` |
| `redirect_id` | 合并后的跟随目标（只用 `/resolve` 消费，不直接写） |

结构字段只在对应层级有意义，写入后 **不可改归属**（`400 immutable_scope`）：

| 字段 | 用在 | 说明 |
|---|---|---|
| `work_id` | content_unit / expression / release / medium / track | 所属作品 |
| `content_unit_id` | expression | 所属内容单元 |
| `release_id` / `medium_id` | medium / track | 所属发行版 / 载体 |
| `parent_id` | content_unit / medium / track | 同层父节点（层级可嵌套） |
| `position` / `number` | medium / track 等 | 排序整数 / 原始印刷编号 |
| `contents[]` | track | `{ expression_id, position, locator, attributes }`：本位置收录的表达与定位 |
| `subjects[]` | release | `{ work_id, role, position, attributes }`：本发行声明收录的作品 |

`locator` / `inclusion_attributes` / `subject_attributes` 的子字段由 definitions 的组字段与
`schemes` 场景声明，可后台增删；写入时按拥有者的 kind / types 匹配场景，无匹配则回退全局组。

## 状态与修订

| 状态 | 含义 |
|---|---|
| `draft` | 草稿（新建默认） |
| `pending_review` | 待审（外部提案落在这里） |
| `published` | 已发布；发布要求至少一条 `translations` |
| `deleted` | 已退役 |
| `merged` | 已合并，`redirect_id` 指向保留实体 |

每次写入都会落修订行（操作者、`edit_note`、`sources`、快照），用
`GET /api/catalog/entities/:id/revisions` 读取；合并与退役只能经
`POST /api/catalog/entities/:id/lifecycle`。详见 [新建与编辑](/api-edit)。

## 表达复用：为什么不需要「典范条目」实体

同一份录音 / 同一条正文被多个发行版收录时，全库只建 **1 个 `expression`**，
各发行版的 `track.contents[].expression_id` 指向它——这就是「Appears on Releases」反查的原理，
数据位置是 `catalog.track_contents`。约束有两条：

- 被收录表达的 `work` 必须出现在该发行版 `subjects` 里（否则 `undeclared_release_subject` 校验失败）
- 收录位置（页码、时间码、路径）写在 `locator`，不复用到别处

专辑曲序、篇目顺序等「概念编排」用有序的 `includes` 关系表达；**真正的版次顺序以 Medium 与
Track 收录为准**，两者不要混用。

## 关系模型

关系是实体之间的一等对象（`catalog.relations`），类型、端点层级、基数、对称与无环声明全部由
definitions 驱动。默认种子的分组：

| 分组 | 关系码 |
|---|---|
| credits（署名） | `created_by`、`performed_by`、`photographed_by`、`modeled_by`、`developed_by`、`voiced_by`、`composed_by`、`lyricist_of`、`arranged_by`、`directed_by`、`written_by`、`illustrated_by`、`narrated_by`、`translated_by`、`character_in`、`credit_for` |
| creative（内容关系） | `adaptation_of`、`sequel_of`、`spin_off_of`、`soundtrack_of`、`translation_of`、`revision_of`、`cover_of`、`alternate_take_of`、`pressing_of` |
| membership（组成与成员） | `includes`、`member_of`、`bonus_included_in`、`store_bonus_for` |

- 声明 `acyclic` 的关系（`adaptation_of` / `sequel_of` / `includes` / `member_of` 等）会做环路检测，
  形成闭环返回 `relation_cycle`
- 端点层级与业务类型受关系的 `source_kinds` / `target_kinds` / `source_types` / `target_types` 白名单约束
- 外部来源的职位没有贴切的码时用 `credit_for`，职位原文写进 `attributes.credit_role`，不要虚构新码
- 同一角色跨作品用多条 `character_in`；番位写 `character_rank` 词表项

## 明确不做的事

- **不用 `media_type` 树状分类**：作品形态用标签、业务类型、发行规格与关系图谱表达
- **不建 `Artist` / `Franchise` 实体**：分别用 `agent` 与 `collection` + 关系表达
- **不做转码**：存储只收原始文件、按权限分发，不生成预览流（见 [资源上传与下载](/upload-download)）
- **不把能力写死在代码里**：新增类型、字段、词表或关系都走 definitions 的草稿 → 影响面校验 → 发布

## 相关页面

- [元数据目录教程](/catalog)：八类骨架的实操建模与后端配置入口
- [编目体系：标签 / 货架 / 封面 / 多语言](/taxonomy)：标签、货架与翻译策略
- [实体查询与详情](/api-entities)：用 `/api/catalog/entities` 消费这套模型
