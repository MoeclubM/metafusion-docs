# MetaFusion 文档站

在线访问：<https://findverse.cc/docs/>

本仓库是 MetaFusion 的**对外文档站**（VitePress 静态站，唯一来源），面向两类读者：

| 读者 | 在这里看什么 |
| --- | --- |
| **普通用户 / 社区成员** | 平台是什么、怎么找作品、怎么贡献与投稿、资源上传下载、社区规则、隐私与版权条款 |
| **开发者 / 第三方接入** | REST API 参考（认证与凭证、实体查询与详情、检索、写入与关系、存储上传）、Agent 接入指引、数据模型与术语 |

## 这里不放什么

- **不放内部实现文档**：代码结构、数据库结构、部署与切流、各服务的实现细节属于主仓库
  [MetaFusion](https://github.com/MoeclubM/MetaFusion) 的 `AGENTS.md` 与 `docs/`。
- **不放本机运维信息**：机器、路径、凭据一律不进任何仓库。
- **不放 Agent 的操作手册**：怎么用接口浏览/修改站点数据、写库被拒时怎么改，见
  [metafusion-skills](https://github.com/MoeclubM/metafusion-skills)；本站只描述**接口本身**。

## 内容分区

五个分区按读者划分。导航与侧栏**由每页 frontmatter 单源生成**，本仓库不再有手写的页面清单：

| 分区（`group`） | 面向 | 页面 |
| --- | --- | --- |
| **认识 MetaFusion**（`intro`） | 第一次接触本站 | 平台概览、核心理念与定位、快速上手指南、常见问题 |
| **使用与共建**（`participate`） | 注册用户与共建成员 | 社区使用指南、资源上传与下载、资源收录与投稿标准、词条编辑与合并规范、权威编目与审查准则 |
| **数据模型与术语**（`model`） | 需要弄清结构的人 | 元数据目录核心架构、IFLA LRM 增强版实体模型、标签、货架与多语言体系 |
| **API 与 Agent 接入**（`api`） | 第三方站点与自动化 | API 概览、认证与凭证、实体查询、检索、新建与编辑、存储上传与下载、OAuth 接入、AI Agent 协作指南与工具规范 |
| **条款与站务**（`legal`） | 所有人 | 服务条款、隐私政策、版权与 DMCA、联系方式、更新日志 |

### 新增或改名页面

每页 frontmatter 写四个字段：

```yaml
---
title: "存储上传与下载"            # 同时是侧栏文字与浏览器标签
description: "内容寻址存储、分片直传……"
order: 60                         # 分区内排序，步长 10，留插入空位
group: "api"                      # intro / participate / model / api / legal
---
```

- **`title` 必须与页面第一个 H1 完全一致**：不一致会让侧栏、浏览器标签与正文各说一套。
- 分区显示名和分区先后只在 `docs/.vitepress/config.mts` 的 `sections` 里改，页面归属不要写回配置。
- `group` 拼错、缺 `title` 或 `order` 不是数字时，构建直接报错并指出文件名——导航不接受猜测。
- 提交前跑 `npm run check:nav`（CI 同一条）：它逐页核 `title` = H1、frontmatter 齐备、同分区 `order`
  不重号、正文站内链接可达。解析不到分区清单时它是报错而不是"0 条通过"。
- 正文里引用其他页面时，链接文字用对方页面的 `title`，别再用旧的侧栏叫法。

## 本地与生产

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 本地写作预览（VitePress dev server） |
| `npm run build` | 产出静态站到 `docs/.vitepress/dist` |
| `npm run preview` | 本地预览构建产物（按 `base=/docs/` 挂载） |
| `npm run start` | **生产**静态服务器：站点根为 `site/`，由镜像把构建产物放进 `site/docs`，让网关 `location /docs`（原样转发不改写路径）与文件一一对应 |

## 参与

发现表述错误、字段与接口不一致、或缺少章节，直接开 issue 或提 PR；文档以**实例的实际响应**为准，
示例里的枚举与字段名不代替运行时核实。
