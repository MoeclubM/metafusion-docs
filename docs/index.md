---
layout: home

hero:
  name: "MetaFusion Docs"
  text: "开放元数据与资源共建平台"
  tagline: "聚焦 ACG、影音与文学的开放资源站。公开元数据与标签、货架分类，注册用户可参与编辑与共建，并对外开放 API 与 Agent 接入。"
  image:
    src: /favicon.svg
    alt: MetaFusion
  actions:
    - theme: brand
      text: 快速开始 →
      link: /quickstart
    - theme: alt
      text: 平台概览
      link: /overview
    - theme: alt
      text: 开放 API 接入
      link: /api-overview

features:
  - icon: 🌐
    title: 开放元数据资源站
    details: 社区驱动的多媒体元数据库。作品、关系图谱与标签元数据公开可读，支持关键词检索，以及按实体种类、类型、状态与标签过滤。
  - icon: ✍️
    title: 人人可编辑可贡献
    details: 注册用户可以创建与修订词条，每次改动都写入修订历史并附修改说明；合并、退役等操作按权限码授权。
  - icon: 🏛️
    title: IFLA LRM 规范化编目
    details: 采用作品 (Work)、表现 (Expression)、发行 (Release) 与载体 (Medium) 增强架构，条理清晰地组织多版本、多语言与曲目。
  - icon: ⚡
    title: 开放 API 与 Agent 友好
    details: 提供开放的 REST API 与会话令牌 / OAuth 2.0 / 个人访问令牌（PAT）接入，实体查询、检索与写入均可程序化调用；写入需登录并具备对应权限码。
---

## 本站写什么

- **给用户与社区**：平台介绍、检索与投稿指南、资源上传下载、社区规范与条款。
- **给开发者与第三方接入**：REST API 参考、数据模型与术语、Agent 接入指引。

**不写内部实现与部署**：代码结构、数据库结构、部署与切流属于主仓库的协作文档；
本机运维信息一律不入库。Agent 如何用接口浏览与修改站点数据，见
[metafusion-skills](https://github.com/MoeclubM/metafusion-skills)。

