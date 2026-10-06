---
title: "AI Agent 协作指南"
description: "MetaFusion 技能接入、安装与更新、授权边界及无技能环境的协议入口。"
order: 80
group: "api"
---

# AI Agent 协作指南

已安装或能获取 MetaFusion 技能的 Agent，优先使用技能。编目规范、工具参数与操作流程由技能维护，本页只提供接入入口。

技能入口：[MetaFusion 技能仓库（需访问权限）](https://github.com/MoeclubM/metafusion-skills)。目前匿名访问返回 404，公开可获取性尚未验证；下列技能及安装说明链接也需要相应访问权限。

## 安装与更新

有仓库访问权限时，获取仓库版本并按 [使用说明](https://github.com/MoeclubM/metafusion-skills/blob/main/README.md#使用)将所需技能目录复制到 Agent 的技能目录。更新时重新获取仓库版本并更新相应技能文件；只复制版本库内容，不复制或覆盖本机凭据与运行产物。

| 任务 | 技能 |
| --- | --- |
| 编目、查重、来源检索与目录读写 | [metafusion-curator](https://github.com/MoeclubM/metafusion-skills/blob/main/skills/metafusion-curator/SKILL.md) |
| 实体层级、命名与表达复用 | [lrm-catalog-standards](https://github.com/MoeclubM/metafusion-skills/blob/main/skills/lrm-catalog-standards/SKILL.md) |
| 只读批量关系查询 | [metafusion-relationship-query](https://github.com/MoeclubM/metafusion-skills/blob/main/skills/metafusion-relationship-query/SKILL.md) |

编目时将 `metafusion-curator` 与 `lrm-catalog-standards` 同级安装并保持同一仓库修订；关系查询技能可独立安装。

## 实例与授权

- 使用用户指定的实例，统一入口为 `/api`。接口以该实例的 `GET /api/openapi.json` 为准，字段、词项与关系以 `GET /api/catalog/definitions` 的当前启用定义为准。
- 安装或使用技能**不等于线上写入授权**。写入前需用户明确授权目标、操作与范围，并具备相应 API 权限；凭据按 [认证与凭证](/api-auth)配置，不写入技能或对话。

## 无技能环境

无法访问技能仓库或环境不支持技能时，使用目标实例的 OpenAPI（本站：[OpenAPI JSON](https://findverse.cc/api/openapi.json)）与 [AI Agent API 与工具规范](/api-agent)接入。
