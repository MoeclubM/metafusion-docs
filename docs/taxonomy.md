---
title: "编目体系：标签 / 货架 / 封面 / 多语言"
description: "MetaFusion 的标签体系、虚拟货架规则、封面比例与多语言本地化。"
order: 11
group: "model"
---

# 编目体系：标签 / 货架 / 封面 / 多语言

MetaFusion 的固定实体骨架是八类（`agent` / `collection` / `work` / `content_unit` / `expression` / `release` / `medium` / `track`）。作品形态由服务端动态定义（types + 字段）表达，规格由发行版与载体表达，检索特征靠「自由标签 + 虚拟货架 + 实体关系边」呈现。

平台没有硬编码的 `media_type` 与单继承分类树。

## 1. 自由标签体系

标签是实体属性 `attributes.tags` 里的平铺字符串列表，用来放流派、题材、风格与大众检索词（`J-Pop`、`科幻`、`机甲`、`治愈`、`摇滚`）。

::: warning 注意
`tags` 字段只声明在 work 的业务类型上。写标签前先给作品声明业务类型（`album` / `animation` / `novel` 等），没声明类型时 `attributes` 只能为空。

其余 kind（agent / collection / content_unit / expression / release / medium / track）的字段集里没有 `tags`。
:::

- **平铺无分类**：标签没有层级与分类树，也没有独立的字典表。后台可声明「标签」字段的呈现方式，但标签本身仍是自由字符串。
- **与业务类型分工**：宏观业务类型（`album`、`animation`、`novel` …）走实体的 `types`，对应后台的类型定义与展示模板；物理与分发规格（CD / BD / Vinyl / 纸张 / Web）落在发行版与载体。
- **频次聚合**：`GET /api/catalog/tags` 就地展开已发布实体的标签并统计频次（`q` 过滤、`limit` 默认 200 上限 500），供标签云与筛选建议。
- **筛选**：`GET /api/catalog/entities?tags=科幻,机甲` 是任一命中即返回（OR，服务端走 JSONB 包含匹配）；要「同时满足」需要调用方自行求交。

## 2. 虚拟货架

货架（shelf）是首页与探索页共用的聚合规则，由服务端定义并求值，前端不硬编码分类：

```json
{
  "id": 3,
  "slug": "theatrical-anime",
  "names": { "zh-CN": "剧场动画", "zh-TW": "劇場動畫", "ja": "劇場アニメ", "en-US": "Theatrical anime" },
  "query": {
    "types": ["animation"],
    "fields": { "country": ["JP"] },
    "vocab_terms": { "format": ["bd"] },
    "relations": ["adaptation_of"]
  },
  "sort": "updated",
  "icon": "Film",
  "enabled": true,
  "sort_order": 10
}
```

- `sort` 取 `updated`（默认，按最后更新时间倒序）、`created`（按创建时间倒序；实体 id 是 UUIDv7，时间有序，毫秒精度）、`title`（按题名升序）；其它取值返回 `400 invalid_sort`。
- `query` 的四个子条件是 AND，同一个数组内是 OR；空 `query` 表示收录全部已发布作品。
- 公开读端点：`GET /api/catalog/shelves`（只返回已启用的规则）与 `GET /api/catalog/shelves/feed`（带求值后的条目，`per_shelf` 默认 12、上限 100）。
- **新建与修改货架需要 `catalog.shelves.manage`**（管理台 `/api/admin/shelves`），普通用户不能自建货架。
- `names` 与其它定义名称同一条硬约束：`zh-CN` / `zh-TW` / `en-US` 加 `ja` 或 `ja-JP`，缺一项返回 `400 four_locale_names_required`。

### 自定义首页分区

登录用户可用 `GET|PUT /api/catalog/me/home-preferences` 自定义首页分区：

- `order` / `hidden` 决定顺序与显隐；`sections` 是「覆盖系统货架 + 自建分区」的混合列表。
- `sections` 里的 `slug` 与已启用的系统货架同名即覆盖该货架给本人看的 `names` / `query` / `sort` / `icon`，不同名即新增分区。
- 最多 20 条，名称至少要有 `zh-CN`，`sort` 取值与系统货架同一闭集。
- `order` / `hidden` 里的未知 slug 不再报错（旧行为是 `unknown_shelf`），原样保留并在合并时忽略。管理员删掉货架后用户仍能保存偏好，货架以同名重建时排序也立刻恢复。
- `/shelves/feed` 按该偏好合并、重排与隐藏；每条 `shelf` 带 `source`（`system` / `custom`）。系统货架即使被用户覆盖也仍是 `system`（前端据此不给「删除分区」入口）。

## 3. 封面比例

封面比例是展示建议，不是强制约束：

- **推断来源**：前端按封面图的自然比例，或按标签关键词推断惯例比例（专辑 / 单曲 / OST → 1:1，电影 / 剧集 / 动画 → 2:3，小说 / 漫画 → 3:4）。
- **没有可写的手动比例字段**：`cover_aspect` 不在 definitions 里声明，实体属性只接受已声明字段，写 `attributes.cover_aspect` 会被 `unknown_field` 拒绝；目录服务的实体响应里也没有 `cover_aspect`。

::: tip
封面组件保留了接收手动比例的能力，但当前没有写入路径给它值。
:::

- **图片引用**：`pictures` 只保存引用（`url` + `caption` + `taken_at` + `source`），目录侧不抓取、不转存；需要长期稳定的图片地址就用存储服务的 `GET /api/storage/assets/:id/content`。
- 常见比例：音乐 1:1、影视 2:3、书籍 3:4（见 [权威编目与元数据审查准则](/curation-guide)）。

## 4. 多语言本地化

- 每个实体有 `original_language` 与 `translations`：后者是按 locale 分组的对象，每个语种含 `title` / `summary` / `aliases`；原语言题名归它自己的语种行。
- 站内固定使用四种界面语言：`zh-CN`、`zh-TW`、`en-US`、`ja-JP`。
- 展示回退链：请求语言 → `en-US` → `original_language` → 实体基础字段（只影响展示，不回写数据）。
- 动态术语（实体类型、关系码、词表项、字段名）的多语言名称来自 definitions，前端用现成 helper 解析，不硬编码。
- **定义侧的名称是四语硬约束**：类型、字段（含子字段与 `unit`）、词表与词项、关系正反向名与 `group_names`、模板与分区、场景方案，以及货架与外部权威库的 `names`，都必须同时带 `zh-CN` / `zh-TW` / `en-US` 与 `ja` 或 `ja-JP`。

缺语种返回 `400 four_locale_names_required`；实体自身的 `translations` 只要求发布时至少一条。

## 5. 探索页与筛选

`/explore` 与列表页共用 `GET /api/catalog/entities` 的一套参数：

- **货架**：顶部可切换已启用的货架。
- **关键词**：`q` 按标题与译文做子串匹配（见 [检索](/api-search)）。
- **多维过滤**：`kind` / `kinds` / `type` / `types` / `status` / `tags` / `work_id` / `content_unit_id` / `release_id` / `medium_id` / `parent_id` / `field` + `value`（探索页的筛选面板以标签为主，动态类型也能经 API 过滤）。
- **排序**：列表默认按 `updated_at DESC, id`；按关联 id 查结构子项时按 `position` 升序（当前没有「按热度」这类排序）。
- **分页**：`limit`（默认 50、上限 100）/ `offset`，响应带真实 `total`。

## 相关页面

- [实体查询与详情](/api-entities)：完整的过滤参数与详情端点
- [IFLA LRM 增强版实体模型](/frbr-model)：八类骨架与字段
- [检索](/api-search)：关键词检索的匹配口径
