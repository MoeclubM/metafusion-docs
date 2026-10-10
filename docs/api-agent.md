---
title: "AI Agent API 与工具规范"
description: "技能接入、动态工具声明、关系遍历、写入计划与失败恢复。"
order: 90
group: "api"
---

# AI Agent API 与工具规范

本页说明 Agent 如何组织技能、工具和任务状态。请求体、权限和参数以对应 API 页面及目标实例为准，先从[API 概览](/api-overview)确认服务入口与契约。

## 技能接入

已安装或能获取 MetaFusion 技能时，优先按技能执行编目操作。技能入口：[MetaFusion 技能仓库](https://github.com/MoeclubM/metafusion-skills)，公开提供技能及安装说明。无法访问或环境不支持技能时，可按本页和目标实例的协议直接接入。

按仓库[使用说明](https://github.com/MoeclubM/metafusion-skills/blob/main/README.md#使用)复制完整技能目录并保留相对路径。编目技能与建模技能同级安装并保持同一仓库修订；更新时只复制版本库内容，不覆盖本机凭据或运行产物。

| 任务 | 技能 |
| --- | --- |
| 编目、查重、来源检索与目录读写 | [metafusion-curator](https://github.com/MoeclubM/metafusion-skills/blob/main/skills/metafusion-curator/SKILL.md) |
| 实体层级、命名与表达复用 | [lrm-catalog-standards](https://github.com/MoeclubM/metafusion-skills/blob/main/skills/lrm-catalog-standards/SKILL.md) |
| 只读批量关系查询，可独立安装 | [metafusion-relationship-query](https://github.com/MoeclubM/metafusion-skills/blob/main/skills/metafusion-relationship-query/SKILL.md) |

使用用户指定的实例。安装或使用技能不等于线上写入授权；写入前确认用户授权的目标、操作和范围，并具备对应 API 权限。凭据按[认证与凭证](/api-auth)配置，不写入技能或对话。

## 运行时事实与工具声明

| 事实 | 来源 |
| --- | --- |
| HTTP 方法、路径、输入与响应模式 | `GET /api/openapi.json`，只覆盖目录服务 |
| 字段、词项、结构、关系与可遍历规则 | `GET /api/catalog/definitions`，记录 etag 与 relationship_rules |
| 外围账号、社区、存储能力 | 对应 API 页面、实例能力声明及实际响应；能力声明不能代替健康检查 |

字段与关系可由站点扩展，不能把种子定义固化在 Agent 中。工具输入遵循当前 schema，记录目标实例、读写属性与所需权限；文档和实例响应冲突时停止依赖该差异的写入，报告差异。

读、创建、替换和删除分别声明工具。每个工具映射一个 HTTP 方法与路径，不把方法组合或中文说明写进 path。

| 建议工具 | HTTP 入口 | 用途 |
| --- | --- | --- |
| find_entities | `GET /api/catalog/entities` | 浏览与筛选，分页按查询模式处理 |
| find_identity_candidates | `POST /api/catalog/entities/candidates` | [一次快照查重并解析身份](/api-entities#并发编目的查重候选) |
| get_entity | `GET /api/catalog/entities/{id}` | 获取完整实体与当前 version |
| resolve_identity | `GET /api/catalog/entities/{id}/identity` | 解析保留身份与历史别名 |
| query_relationships | `POST /api/catalog/relationships/query` | 读取直接关系与上下文引用 |
| get_definitions | `GET /api/catalog/definitions` | 获取当前动态约束 |
| create_entity / replace_entity | 分别映射 `POST /api/catalog/entities`、`PUT .../{id}` | 按[新建与编辑](/api-edit)写入 |
| 关系与单条收录工具 | 按 OpenAPI 分别映射 `/catalog/relations`、`/catalog/tracks/{id}/contents` 的写方法 | 保留版本条件与证据 |

接入后先做只读验证：读取定义，查询一个可见条目，解析身份并读取关系。长期运行凭据及撤销窗口见[PAT](/api-auth#个人访问令牌-pat)，路由预算见[限流](/api-overview#限流)。

## 关系遍历与完整性

接口读取可见的一跳；完整参数与响应见[批量关系查询](/api-entities#agent-批量关系查询)。Agent 应维护任务范围和进度：

1. 将起始实体解析到保留身份，记录待查队列、已访问 ID 与筛选条件。
2. 将页进度相同的主体组成一批，读取关系。逐主体保存 offset、has_more 和已收集的事实，不能用某个主体的页结束代替整批完成。
3. 同时读取端点与 references；via 标记主体通过非端点属性匹配的路径，只看 source_id / target_id 会遗漏上下文引用。
4. 每个主体分页完成后，再将范围内的新实体加入待查队列并去重。记录 unavailable_ids、definition_etag 和发生失败的页。
5. 定义变化或跨页数据变化时重新核对受影响范围；没有不可用主体且约定范围全部完成后，才声明该可见范围完整。

关键词检索按[检索](/api-search)的 has_more / next_cursor 继续，不能因 items 为空就结束。查询失败不等于零命中，不据此直接创建新条目。

完整性只覆盖已声明的目录结构、语义关系与实体属性引用。普通字符串、外部文件、收藏和跨服务资源不会自动推断为目录关系；批量响应的 entities 是摘要，不能直接用于编辑。

## 编目与写入计划

1. 用 candidates 查询查重，核对 complete、canonical 与来源；不要在并发写入时用 offset 扫全库证明没有重复。再按[目录教程](/catalog)确定层级与复用对象，用[编辑与审查规范](/editing-guide)核对事实。
2. 为每一步保存目标、输入、证据、创建键及返回 ID；按依赖逐层提交：

   ```text
   agent / work → content_unit / expression → release（声明 subjects） → medium → track → relations
   ```

3. 更新前重新读取完整实体，仅修改需要改变的字段，并按[新建与编辑](/api-edit#编辑实体)保留无关数据和逐条收录证据。不可见历史引用需由能查看完整事实的人处理。
4. 保存后回读条目、关系、收录与修订记录。后续失败不会回滚前序成功步骤，报告应分别列出已完成、未完成和待复核内容。

创建结果不确定时保持同一任务的原幂等键和原载荷，不盲目换键；版本冲突时回读并合并修改，不直接覆盖最新数据。生命周期操作与常规编辑分开选择，详细载荷和权限只在[新建与编辑](/api-edit)维护。

## 失败后的动作

根据 HTTP 状态和机器码选择动作。下表聚焦任务恢复，具体字段约束查看相关 API 页面。

| 情况 | Agent 动作 |
| --- | --- |
| 400 载荷、字段、词项或来源校验失败 | 用当前 OpenAPI / definitions 与来源改正输入，不用近似值绕过校验 |
| `invalid_reference` 或身份已合并 | 回读引用并解析身份，核对允许层级、可见性与[UUID 格式](/api-edit#实体引用格式) |
| `four_locale_names_required` | 补齐定义名称所缺的语言，不通过停用条目规避校验 |
| `immutable_scope`、结构或收录约束失败 | 修正建模计划；补齐发行声明后再提交收录，不能原地换不可变归属 |
| 401 / 403 / 404 | 分别核对凭据、权限与可见性；不可见和不存在不区分，不能据此探测私有实体 |
| `version_conflict` | 回读并合并修改，再以最新版本提交 |
| `idempotency_conflict` | 核对任务是否误用创建键，勿通过换键重复创建 |
| `invalid_search_cursor` / `search_cursor_expired` / `search_window_exceeded` | 按[检索](/api-search#失败与重试)继续或重新开始，重启后对已收集 ID 去重 |
| 429 | 尊重 Retry-After 与实际窗口头，降低并发与重复查询 |
| candidates 的 complete=false 或 canonical=null | 收窄条件或核验未解析身份，不能盲目重试、等待低峰或据此创建 |
| `auth_unavailable` / `search_unavailable` | 视为依赖故障并退避，不更换有效凭据、不把搜索失败当作零命中 |
| 数据库故障或无法解释的协议差异 | 保留请求摘要和任务进度，停止依赖故障的写入，报告已完成范围 |

未知机器码先核对实例契约；仍无法解释时报告差异，不绕过接口直接改库。
