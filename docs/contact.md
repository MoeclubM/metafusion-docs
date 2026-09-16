---
title: "联系方式"
description: "如何联系站务、报告问题与贡献文档。"
order: 60
group: "meta"
---

# 联系方式

## 站务

- **GitHub**：[MoeclubM/MetaFusion](https://github.com/MoeclubM/MetaFusion)（提 Issue / PR 最快）
- **社区板块**：在 `/community` 发布话题（平台当前不提供站内私信）——`bug_report`（反馈与建议）用于问题与合规报告、`qa`（求助答疑）用于使用与编目问题、`casual`（闲聊杂谈）用于其它交流
- **公告板块**：`announcement` 由站务发布通知，不开放日常发帖

## 报告问题

| 类型 | 去哪 |
|---|---|
| 侵权 / 合规 | 在 `bug_report` 板块发帖，附 URL 与权属证明（见 [版权与 DMCA](/copyright)） |
| 审核申诉 | 在 `bug_report` 板块发帖，附 Work/Release ID 与修订记录 |
| Bug / 功能建议 | GitHub Issue，附复现步骤与截图 |
| 文档错误 | 到 [metafusion-docs](https://github.com/MoeclubM/metafusion-docs) 提 PR 直接改 `docs/*.md` |
| 其它合作 | GitHub Issue，或在 `casual` 板块发帖 |

## 贡献文档

文档内容在本仓库的 `docs/`（这是文档的唯一源），每篇 Markdown 含 frontmatter：

```yaml
---
title: "标题"
description: "一句话摘要"
order: 31
group: "api"  # start / model / guide / api / community / legal / meta
---
```

修改后本地预览：

文档内容与站点源码在独立仓库 [metafusion-docs](https://github.com/MoeclubM/metafusion-docs)；
发现表述错误、缺失章节或字段与接口不一致，直接开 issue 或提 PR。

## 响应时间

站务为志愿运营，工作日 24–48 小时内响应，合规类优先处理。
