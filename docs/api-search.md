---
title: "检索"
description: "OpenSearch 关键词查询、结构筛选、索引快照计数、cursor 深分页与错误处理。"
order: 40
group: "api"
---

# 检索

关键词搜索与无关键词浏览共用 `GET /api/catalog/entities`。有非空 q 时使用 OpenSearch，无 q 时查询数据库。

## 匹配与筛选

搜索覆盖基础题名、译名、别名、摘要、标签和外部编号，支持词项前缀与大小写不敏感的子串匹配。默认按相关度排序，题名匹配权重较高；可以显式指定 updated_at、created_at 或 title 排序。

q 可以和当前列表过滤组合：kind / kinds、status、tags、original_language、has_pictures、固定归属 ID，以及 field + value 的精确属性筛选。嵌套组、列表和收录伪字段按 definitions 的搜索声明校验。完整参数见[实体查询与详情](/api-entities)。

q 等文本参数最多 256 字节，须为合法 UTF-8；除制表符外的控制字符会被拒绝。客户端应使用 URL 编码，不手工拼接关键词。

```http
GET /api/catalog/entities?q=久石让&kind=agent&limit=10
GET /api/catalog/entities?q=VIZL&kind=release&limit=10
GET /api/catalog/entities?q=城市光影&kind=work&sort=title&locale=zh-CN&limit=20
```

## 响应与计数

下面省略实体中与示例无关的字段：

```json
{
  "items": [
    {
      "id": "01900000-0000-7000-8000-000000000001",
      "kind": "work",
      "version": 1,
      "title": "城市光影",
      "status": "published"
    }
  ],
  "total": 12,
  "total_relation": "index_snapshot",
  "has_more": true,
  "next_cursor": "<opaque_cursor>"
}
```

| 字段 | 关键词查询的含义 |
| --- | --- |
| items | 当前页经过数据库权限与精确筛选复核的完整实体 |
| total | 当前搜索索引快照中的命中数 |
| total_relation | `index_snapshot`，明确不是当前数据库精确计数 |
| has_more | 索引分页是否还有候选 |
| next_cursor | 继续查询的短期不透明 cursor，有下一页时返回 |

索引更新有延迟，数据库在回读时再次检查当前可见性与筛选条件。因此 items 可能不足 limit，甚至为空，但 has_more 仍为 true。判断结束使用 has_more，不用「本页为空」或「本页少于 limit」。

无关键词浏览的响应使用 `total_relation="eq"`，total 是数据库计数，并带 has_more。修改后要确认当前实体内容，直接回读详情；搜索无命中不能证明实体不存在。

## 首页与深分页

limit 默认 50，允许 1–100；offset 默认 0，允许非负整数。page 从 1 起，是 offset 的便捷写法，不能与 offset 同时提交。

关键词查询的 offset + limit 不能超过 10000。更多结果使用 next_cursor，继续请求时：

1. 保持 q、全部筛选、sort、order、locale、limit 与原请求一致。
2. 使用原响应的 next_cursor，移除 offset 和 page。
3. 保持同一调用身份，按新响应的 has_more 继续。
4. cursor 对应 OpenSearch PIT 快照，每次搜索保活一分钟；过期后重新从首请求开始。

cursor 不能用于无关键词浏览，不可解析后自行修改，也不能跨查询或身份复用。继续分页使用同一索引快照；实体内容和可见性仍按数据库当前事实复核。

## 最小分页示例

```python
import os
import requests

url = os.environ["METAFUSION_BASE_URL"].rstrip("/") + "/api/catalog/entities"
params = {"q": "城市光影", "kind": "work", "limit": 50}
while True:
    response = requests.get(url, params=params, timeout=15)
    response.raise_for_status()
    page = response.json()
    for entity in page["items"]:
        print(entity["id"], entity["title"])
    if not page["has_more"]:
        break
    params["cursor"] = page["next_cursor"]
```

这段示例读取匿名可见的数据。需要查看账号可见范围时配置[认证与凭证](/api-auth)；遇到 429 时按 Retry-After 等待。分页过期或失败时停止并记录已读取范围，不把部分结果报告为全集。

## 失败与重试

| HTTP / error | 含义与处理 |
| --- | --- |
| 400 invalid_limit / invalid_offset / invalid_page | 分页值不合法，修正参数 |
| 400 pagination_conflict | offset 与 page 冲突，或 cursor 与 offset/page 同时使用 |
| 400 search_window_exceeded | offset 窗口超过 10000，改用 next_cursor |
| 400 invalid_search_cursor | cursor 形状、查询绑定或身份不匹配；核对原请求，必要时重启搜索 |
| 400 search_cursor_expired | 索引快照已过期，重启搜索 |
| 400 invalid_query_param / query_too_long | 编码、字符或文本长度不合法 |
| 503 search_unavailable | 搜索未配置、未就绪或故障，等待服务恢复 |
| 429 rate_limited | 按 Retry-After 退避 |

索引不可用时不回退数据库文本搜索。合法零命中返回 200 和空 items，has_more=false；503 与零命中须分别呈现和处理。

## 实现与运行边界

数据库保存目录事实，OpenSearch 承担关键词匹配、相关度和索引快照分页，目录服务回读当前实体。应用接入不需要直接连接搜索集群。

部署、索引重建与迁移属于[主仓库开发文档](https://github.com/MoeclubM/MetaFusion/tree/main/docs/architecture)，这里仅维护对外查询契约。实体归属与关系的遍历使用[实体查询与详情](/api-entities)中的结构和关系接口。
