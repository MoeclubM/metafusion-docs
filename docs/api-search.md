---
title: "检索"
description: "关键词检索的统一入口、匹配口径与 OpenSearch 现状。"
order: 33
group: "api"
---

# 检索

检索与浏览是**同一个端点**：`GET /api/catalog/entities` 的 `q` 参数。
没有独立的 `/api/search`（也没有 `{ works, artists, releases, total }` 这种分组响应），
返回值始终是统一的 `{ items, total }`。

## 匹配口径

`q` 在服务端编译成一次子串匹配：

```sql
title ILIKE '%<q>%' OR (document->'translations')::text ILIKE '%<q>%'
```

- 大小写不敏感的子串匹配（不是分词检索）：`攻壳` 能命中 `攻壳机动队`
- `title` 侧由 `to_tsvector('simple', title)` 的 GIN 索引支撑；译文侧是整段 JSON 文本匹配，
  没有索引支撑，数据量大时是顺序扫描
- 因此「按语言精确分词、按相关度排序的全文检索」当前**尚未实现**，`q` 保留的是「能搜到」的降级语义

## 接口

```http
GET /api/catalog/entities?q=keyword&kind=work&limit=10&offset=0
GET /api/catalog/entities?q=久石让&kind=agent&limit=10
GET /api/catalog/entities?q=VIZL&kind=release&limit=10
```

`q` 可以与所有列表过滤参数组合（完整清单见 [实体查询与详情](/api-entities)）：

| 参数 | 说明 |
|---|---|
| `q` | 关键词（标题与译文的子串匹配） |
| `kind` / `kinds` | `agent` \| `collection` \| `work` \| `content_unit` \| `expression` \| `release` \| `medium` \| `track`（`kinds` 可多值） |
| `type` / `types` / `status` | 动态类型与状态过滤 |
| `tags` | 标签过滤（多值，命中任一） |
| `work_id` / `content_unit_id` / `release_id` / `medium_id` / `parent_id` | 关联过滤 |
| `field` + `value` | 按属性字段精确过滤（支持点分路径） |
| `limit` / `offset` | 分页（`limit` 默认 50、上限 100） |

## 示例

```bash
curl "/api/catalog/entities?q=blade+runner&kind=work&limit=5" -H "User-Agent: MyApp/1.0 (you@example.com)"

# 中文
curl "/api/catalog/entities?q=攻壳机动队&kind=work&limit=3" -H "User-Agent: MyApp/1.0 (you@example.com)"
```

响应：

```json
{
  "items": [
    {
      "id": "deadbeef-0000-4000-8000-000000000001",
      "kind": "work",
      "title": "攻壳机动队",
      "original_language": "ja",
      "translations": { "zh-CN": { "title": "攻壳机动队" }, "en-US": { "title": "Ghost in the Shell" } },
      "attributes": { "cover_aspect": "2:3" },
      "status": "published"
    }
  ],
  "total": 12
}
```

## 搜索引擎现状

检索当前**全部由 PostgreSQL 承担**，不需要额外部署搜索引擎：

- 标题走 `to_tsvector('simple', title)` 的 GIN 索引，属性走 `document` 的 JSONB 路径索引；
  标签、动态类型各有函数索引支撑
- OpenSearch 2.x **已在编排里**（`--profile search`），作为数据量上到亿级时的倒排与多语言分词层预留，
  **尚未接线**：开启它不会改变任何检索行为

## 与前端联动

- 首页检索框跳转到 `/explore?q=...`
- `/explore` 的搜索与 `GET /api/catalog/entities?q=...` 使用同一后端查询
- 详情页的关联推荐走关联 id 过滤与 `GET /api/catalog/entities/:id/relations`，不是独立检索端点

## SEO

- 元数据页 SSR 可被爬虫收录
- 媒体二进制 URL 带鉴权且 `robots.txt` 禁止直链索引
