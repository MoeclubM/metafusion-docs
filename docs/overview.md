---
title: "概览"
description: "MetaFusion 平台定位、核心特色与文档导航。"
order: 0
group: "start"
---

# 平台概览

MetaFusion 是一个**开放媒体资源站与元数据共建平台**，专注于 ACG、音乐、影视、文学等多元媒体资源的收录与结构化整理。

## 核心定位

> **公开元数据，受控媒体资源。** 平台提供公开的元数据索引、标签与货架分类、关键词检索，以及注册用户参与的词条编辑与社区贡献能力，并对外开放 REST API 供程序化调用。

## 目标群体

- **普通用户**：在首页按货架分区浏览推荐内容，或在探索页按实体种类、状态、类型与标签筛选，并通过关系图谱在实体之间跳转。
- **编辑与共建者**：基于 IFLA LRM 规范进行结构化编目，补充作品背景、外部权威链接与修订说明。
- **开发者与 Agent**：用会话令牌或 OAuth 2.0 授权调用 `GET /api/catalog/*` 等接口，查询、写入元数据并参与社区互动。
- **管理团队**：通过后台编目审核、实例设置与权限组分配维护社区秩序与合规运营。

## 文档导航

- **核心理念**：开放元数据目录的建设原则与邀请机制
- **快速上手**：5 分钟完成注册、探索资源与创建第一条元数据
- **资源体系**：IFLA LRM 增强版实体模型、标签系统与虚拟货架体系
- **编辑与投稿**：词条创建、实体合并、分片上传与哈希秒传（不做转码，原档分发）
- **开放 API**：会话令牌与 OAuth 2.0 认证、实体查询、关键词检索与 Agent 自动化接入
- **服务与合规**：服务条款、隐私政策、版权与 DMCA 处理机制

## 多系统解耦生态架构

MetaFusion 整体采用**「元数据系统为主项目，周边外围子系统解耦自治」**的架构矩阵（下面括号里是各服务的**响应头标记** `X-MetaFusion-Service`；编排里的容器名分别是 `backend` / `auth` / `storage` / `community` / `gateway`）：

- **元数据核心系统 (metafusion-catalog)**：**主项目**，聚焦于固定实体骨架（Agent, Collection, Work, ContentUnit, Expression, Release, Medium, Track）、动态定义引擎、关系图谱与修订历史。仅依赖 PostgreSQL 即可独立运行；检索走 PostgreSQL 子串匹配（OpenSearch 容器已随编排部署，但 Go 侧尚未接入），限流分两层：网关的 `limit_req` 与目录服务内部分重路由的进程内限流。
- **账号与身份认证中心 (metafusion-auth)**：独立身份服务，提供注册与登录、令牌签发（RS256 访问令牌 + 服务端会话）、基于权限组与权限码的授权、OAuth 2.0 / OIDC 接入与实例准入设置。
- **资源存储与下载管理中枢 (metafusion-storage)**：原始文件归档与分发，支持本地对象模式与 S3 对象存储、sha256 内容寻址校验，并按绑定实体可见性授权下载（不做转码）。
- **社区交流与论坛系统 (metafusion-community)**：独立讨论板块与主题回复，以及实体短评、收藏与互动记录。
- **API 网关与边缘路由**：单端口 Nginx 反向代理，按 `/api/*` 前缀把流量分流到目录、账号、互动与存储，并把 `/docs` 反代到文档站；生效矩阵在主仓库 `deploy/nginx.conf`（compose 的 `gateway` 服务）。`metafusion-api-gateway` 仓库现在只剩切流自检脚本，旧矩阵已归档、不参与部署。
- **开发者文档站点 (metafusion-docs)**：独立 VitePress 文档工程，承载对外规范、API 文档与 Agent 接入指引。

## 访问与权限模型

| 模块 | 权限要求 | 内容与能力 |
|---|---|---|
| 基础元数据 | 开放浏览与检索 | Work / Release / Medium / Track 等实体详情、标签与货架体系、关系图谱、关键词检索（标题与译文子串匹配）、社区公开讨论 |
| 资源操作 | 需登录用户 | 原档下载（需至少一个绑定实体对调用者可见）、分片上传与哈希秒传、发帖/回帖 |
| 词条维护 | 需登录用户 | 新建作品/发行版/创作者、修改元数据、提交审核、查看修订历史；合并、退役与下架按 `catalog.lifecycle.manage` 授权 |
| 系统管理 | 按权限码授权 | 实例设置（`auth.settings.manage`）、权限组与用户（`auth.groups.manage` / `auth.users.manage`）、邀请码签发（`auth.invites.manage`）、OAuth 客户端与客户端审计（`auth.oauth.manage`）、类型与关系定义（`catalog.definitions.manage`）、货架与外部库规则（`catalog.shelves.manage`）、编目审核与实体合并（`catalog.lifecycle.manage`） |

## 快速入口

下一节：[核心理念与定位](/philosophy)
