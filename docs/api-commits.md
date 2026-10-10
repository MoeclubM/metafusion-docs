---
title: "工作副本与提交"
description: "Agent 批量编辑、原子推送、三方合并与失败恢复。"
order: 45
group: "api"
---

# 工作副本与提交

多个 Agent 可以从各自的版本副本编辑，在本地形成提交，再一次推送一批实体与关系。每个实体保留自己的版本历史；提交将相关修订串在一起，没有全站共同移动的 head，也不为每个条目创建物理 Git 仓库。当前实现提供 Git 式编辑流程，原生 Git 协议尚未接入。

## 从副本到推送

1. `POST /api/catalog/checkout`：传 `entity_ids`、`relation_ids`，合计最多 100 个。返回同一只读快照中的完整可见文档、version、当前 `definitions_etag` 和 `actor_id`。空数组用于初始化工作区。Track 的隐藏收录不会出现在副本中。
2. 本地编辑 JSON，保留基线。新实体先按下文查重；创建依赖用 `{"$ref":"名称"}` 对象，不能伪造 UUID。
3. 本地 commit：保存不可变请求、证据与固定 UUID。一个工作区保留一个待推送提交，各 Agent 使用独立目录。
4. `POST /api/catalog/commits/preview`：真实校验后整笔回滚；返回 `applied:false`，不保留实体、修订、通知或搜索事件。预览 ID 不可用于后续引用。
5. `POST /api/catalog/commits`：原子推送；全部操作成功才保存事实、修订、通知、搜索 outbox 与回执。每批 1–100 个操作，请求体最多 2 MiB，按声明顺序满足引用依赖。
6. `GET /api/catalog/commits/{id}`：原操作者查询持久回执。成功后重新 checkout，获得可能已被其他编辑者推进的当前版本。

提交范围是目录实体与语义关系的创建、更新。删除、合并身份、下架、定义配置、上传、账号和互动各有自己的权限与事务入口；提交不提供跨服务事务或服务端长期分支。修订的 `commit_id` 在数据库中关联整笔推送，原有按实体读取历史仍有效。

## 提交格式

```json
{
  "id": "019a0e47-6190-7000-8000-000000000001",
  "definitions_etag": "<checkout 返回值>",
  "edit_note": "根据官方目录补充题名与表达",
  "sources": [{"kind":"url","citation":"官方目录支持题名和层级","url":"https://example.org/catalog"}],
  "operations": [
    {"target":"entity","action":"update","id":"<实体 UUID>","base_version":3,
     "patch":[{"path":"/translations/zh-CN/title","value":"中文题名"}]},
    {"target":"entity","action":"create","ref":"recording","reviewed_candidate_ids":[],
     "document":{"kind":"expression","title":"录音","work_id":"<Work UUID>"}}
  ]
}
```

`target` 是 `entity` 或 `relation`。创建需要唯一 `ref` 和 `document`，不能声明服务端 ID、version、created_by、redirect_id。更新需要 ID、权威 `base_version` 和 patch；基线由服务端修订取得，不能提交伪造的旧快照。每个目标每批只能编辑一次。

Patch 路径使用 JSON Pointer：`~` 编码为 `~0`，`/` 编码为 `~1`。`value:null` 是显式空值，`remove:true` 是移除键，两者不可同时提供。对象字段可逐键编辑，数组整组处理；不支持数组下标，不允许同一批 patch 中出现祖先与子路径。实体可编辑字段以实例 OpenAPI 与动态 definitions 为准，ID、kind、版本及 Work/Release/Medium 归属不能通过 patch 改写。关系只可编辑 position、attributes，不能改端点和关系码。

## 创建前的身份复核

实体 create 必须提供 `reviewed_candidate_ids`，空数组表示已审查且无候选。服务端用题名、各语言题名和外部 ID 构造 candidates 查询，按 Work（Expression/ContentUnit）、Release（Medium）或 Medium（Track）限定作用域；不加入 duration 等容易产生大量命中的弱条件。先用相同条件的 [candidates 查询](/api-entities#并发编目的查重候选)读取 canonical ID 并核来源。有候选时优先复用，确认为不同对象才能列入已审查数组并说明理由。

新作用域用本批分配的 ID；需要明确区分本批先创建的同名对象时，审查数组可用 `@local:ref名称`。同一身份条件的 commit 创建会争用相应事务锁，后到者看到候选集合改变时整批返回 `409 identity_candidates_changed`，不会静默再建一条。候选截断或 canonical 未解析同样阻断创建。

这是当前可见候选集合的复核，不是“同名即同实体”的唯一约束。普通交互式单实体创建、导入和身份更新使用各自接口；此锁不使那些入口自动获得提交协议的审查条件。私有对象不能由查重暴露，来源判断也不能由标题匹配代替。

## 合并与冲突

更新按照“基线、当前值、请求值”比较每条路径。远端没有改该字段时应用本地修改；双方改成同一个值时视为已完成，不产生多余修订；双方改成不同值时返回：

```json
{"error":"commit_conflict","applied":false,"conflict":{"operation":0,"id":"<UUID>","base_version":3,"current_version":4,"paths":["/title"]}}
```

其他字段的并发修改会保留。冲突结果只提供路径与版本，不返回隐藏事实；整个批次回滚。`definitions_conflict` 表示动态定义基线改变，需要重新核字段契约。隐藏 Track contents 必须走单条收录专用端点；Track 题名、属性、图片和状态可用稀疏 patch，服务端会保留未提交的完整事实。

## 断线与重试

固定提交 ID 是持久幂等键。同一操作者、ID 和载荷返回首个回执；同 ID 不同内容或不同操作者返回 `409 idempotency_conflict`。不要改 ID 后重建同一批数据。查询回执的 404 可能表示请求仍在执行，不能据此断言失败；可用同 ID、同载荷再次 push，由服务端协调并发请求。

已明确拒绝的提交可重新 checkout、审查冲突并 rebase，生成新提交 ID，保留旧本地提交。未知结果必须先查回执，不能 rebase。回执持久保留，不按创建接口的短期幂等窗口清除。

推送默认预算 60 次/分钟，预览 30 次/分钟，checkout 120 次/分钟；实例配额可能覆盖这些默认值。服务端提交期限 15 秒、锁等待 3 秒，失败后按机器码与回执判断结果。批量减少请求数，不保证任意大小的关系图都能在期限内提交。
