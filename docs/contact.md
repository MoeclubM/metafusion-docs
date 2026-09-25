---
title: "联系方式"
description: "如何联系站务、报告问题与贡献文档。"
order: 40
group: "legal"
---

# 联系方式

## 站务

- **GitHub**：[MoeclubM/MetaFusion](https://github.com/MoeclubM/MetaFusion)（提 Issue / PR 最快）
- **社区板块**：在 `/community` 发布话题——`bug_report`（反馈与建议）用于问题与合规报告、`qa`（求助答疑）用于使用与编目问题、`casual`（闲聊杂谈）用于其它交流
- **站内私信**：可以给某个用户发私信（入口在该用户主页，收件箱在 `/messages`），但平台**没有拉黑**——接到骚扰可以在对方主页用**站内举报**（对象类型「用户」，理由选骚扰）提交，举报只有处理人可见，不必公开发帖
- **公告板块**：`announcement` 用于站务通知与运营公告；编目与合规问题请走 `bug_report`，不要把日常讨论发在这里

## 报告问题

| 类型 | 去哪 |
|---|---|
| 侵权 / 合规 | 站内举报入口（实体 / 资源 / 短评 / 帖子页面的「举报」），理由选**侵权**，证据链接填权属证明 URL——只有处理人可见（口径见 [社区使用指南](/community-guide) 的「举报与申诉」，流程见 [版权与 DMCA](/copyright)）；也可在 `bug_report` 板块发帖 |
| 内容处置申诉 | 被处置方在「我的举报」里提交**一次**申诉（申诉队列见 [社区使用指南](/community-guide)）；编目审核的异议仍走 `bug_report`，附 Work/Release ID 与修订记录 |
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
