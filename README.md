# MetaFusion 文档站

在线文档：<https://findverse.cc/docs/>

本仓库维护 MetaFusion 的使用指南、编目规范和对外 API 参考。普通用户从「开始使用」进入，开发者与 Agent 从「API 概览」进入。

## 内容边界

用户页面描述如何浏览、编辑与参与；模型页面解释事实的组织；API 页面记录请求、响应、权限、分页与失败处理。共享契约保留一个主要说明入口，其他页面链接引用。

代码结构、数据库迁移、部署与恢复在[主仓库](https://github.com/MoeclubM/MetaFusion)维护。凭据和本机运维信息不进入文档。Agent 编目操作流程由[技能接入入口](docs/agent-integration.md)指向的技能维护，本站描述接口本身。

## 文档分区

| group | 分区 | 主要内容 |
| --- | --- | --- |
| intro | 开始使用 | 平台概览、快速上手、理念、FAQ |
| participate | 参与共建 | 社区、文件、投稿、编辑与审查 |
| model | 理解数据 | 编目教程、字段、标签与多语言 |
| api | API 与 Agent 接入 | 认证、实体与关系查询、检索、写入、定义配置、社区、存储、OAuth 与 Agent |
| legal | 条款与支持 | 条款、隐私、版权、联系方式与更新 |

## 修改页面

每个内容页位于 `docs/*.md`，声明以下 frontmatter：

```yaml
---
title: "页面标题"
description: "一句话说明页面用途。"
order: 30
group: "api"
---
```

title 与正文 H1 完全一致；同分区 order 不重号。页面归属与顺序来自 frontmatter，分区名称与先后来自 `docs/.vitepress/config.mts`，不另维护导航清单。

站内链接使用 `/slug`，引用具体小节时保留有效锚点。改名后同步链接文字；接口变化只更新直接受影响的页面。

示例采用占位符或虚构数据，说明适用前提。动态字段和关系码以目标实例 definitions 为准；确认代码与响应一致后再描述能力，避免把计划或旧部署快照写成现行契约。

## 本地验证

依赖以 package-lock.json 为准，CI 和镜像使用 `npm ci` 安装。

| 命令 | 用途 |
| --- | --- |
| `bun run dev` | 本地写作预览 |
| `bun run check:nav` | 检查页面元数据、标题、分区顺序、首页入口、正文链接及锚点 |
| `bun run build` | 构建静态站，并拒绝死链 |
| `bun run preview` | 预览构建产物 |

npm 可以运行相同脚本。提交前运行导航检查与构建。

生产镜像将构建产物放在 `site/docs`，`npm run start` 从 `site/` 提供静态文件，与 `base=/docs/` 和网关路径一致。部署流程见主仓库。

## 参与

文档问题请在本仓库提交 Issue 或 PR，注明页面、问题和依据。网站使用反馈与站务联系见[联系方式](docs/contact.md)。
