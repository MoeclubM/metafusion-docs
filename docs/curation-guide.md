---
title: "权威编目与元数据审查准则"
description: "纯净题名、分层建模、盒装合集、表达复用、DAG 织网与审查核验清单。"
order: 12
group: "guide"
---

# MetaFusion 权威编目与元数据审查准则

本准则面向在本平台创建、修改、导入与审核元数据的社区考据员与 AI Agent。
实体边界与发行版命名的权威来源是独立技能仓库
[metafusion-skills](https://github.com/MoeclubM/metafusion-skills)（`metafusion-curator` +
`lrm-catalog-standards`）；落地字段与端点见 [元数据目录教程](/catalog) 与
[IFLA LRM 增强版实体模型](/frbr-model)（本页只讲原则与审查口径）。

## 1. 角色设定与八条底线

- **角色定位**：`MetaFusion Archivist & Cataloging Reviewer`（档案考据员与编目审查员）
- **使命**：消除信息孤岛与污染，构建结构化、可拓扑互联、带完整修订快照的跨媒介元数据

八条底线：

1. **实体题名必须纯净**：作品层（`work`）不写季数、载体、规格、音质、字幕组等修饰词
2. **发行规格只写实**：条码、厂牌、装帧等物理/数字出版特征落在发行版（`release`）与载体（`medium`）
3. **创作内核与表现层分离**：作品层承载抽象创作（作词/作曲/原著/剧本原案），`expression` 承载具体表现
   （录音母版、正片剪辑、章节正文及其演职），`track` 只承载载体上的收录位置
4. **多作品盒装不许张冠李戴**：全集盒装必须独立建模为汇编作品与发行版，再分盘关联各母作品
5. **世界观拓扑有向无环**：企划用 `collection` + `includes` 聚合，声明 `acyclic` 的关系不得成环
6. **变更必须可溯**：每次写入都带 `edit_note` 与至少一条可核验的 `sources`
7. **封面必须官方保真**：比例遵循 1:1 / 2:3 / 3:4，杜绝占位图、拉伸与盗链
8. **多语言零硬编码**：`original_language` 与 `translations` 完整对齐，按固定回退链展示

## 2. 分层建模：八类固定骨架

| 层级 | 对应关系 | 边界 |
|---|---|---|
| `work` | 抽象创作本体 | 一部作品只有一个作品实体；季、卷、规格不进这层 |
| `content_unit` | 同作品内的目录节点 | 第几章、第几话、某条路线；父子必须同属一个 `work` |
| `expression` | 具体表现 | 属于一个 `work`，可选挂在 `content_unit` 下；版本差异与演职在这一层 |
| `release` | 公开发行 | `subjects` 声明收录了哪些 `work`；条码与品番在这一层 |
| `medium` | 载体容器 | 分盘分卷，可嵌套；不跨发行版 |
| `track` | 收录位置 | `contents[].expression_id` 指向被收录的表达 |
| `agent` | 责任主体 | 个人、团体、虚构角色；「谁做了什么」用关系表达 |
| `collection` | 集合与企划 | 用 `includes` 聚合作品，不复制作品的身份 |

### 2.1 演职关系的落点

- **作品层创作关系**：`created_by`、`composed_by`、`lyricist_of`、`written_by`（剧场动画、影视剧本、原著改编）
- **表现层制作与演职**：`performed_by`（演唱/演奏）、`arranged_by`（编曲）、`directed_by`（导演/分集导演）、
  `photographed_by`、`illustrated_by`（插画）、`narrated_by`（朗读/旁白）、
  `voiced_by`（配音，角色经 `character` 引用实体）
- **译本与改写**：`translated_by`（译者）、表达层之间用 `translation_of` / `revision_of`
- **没有贴切职位码时**：用 `credit_for` 兜底，职位原文写进 `attributes.credit_role`；有精确码时不重复建边

### 2.2 表达复用与「Appears on Releases」

同一份录音、同一条正文被多个发行版收录时，全库只建 **1 个 `expression`**：

- 各发行版的 `track.contents[].expression_id` 指向它，数据位置是 `catalog.track_contents`
- 反查接口是 `GET /api/catalog/entities/:id/occurrences`：`expression` 返回自身收录，
  `content_unit` 返回该篇目下各表达的收录，`work` 返回该作品下全部表达的收录
- 被收录表达所属的 `work` 必须出现在该发行版的 `subjects` 里（`undeclared_release_subject` 校验）
- 同篇目的其它表达（另一录音、加长版）在批量端点里单列在 `siblings`，不与自身收录混同
- 专辑曲序等「概念编排」用有序 `includes` 关系；**真正的版次顺序以 Medium 与 Track 收录为准**

## 3. 多作品盒装与合集

```
[ 汇编 Work: 宮崎駿監督作品集 ]
        │
        ▼ 物化发售
[ Release: 宮崎駿監督作品集（13BD 豪华限定盒装，VWBS-1531）]
   ├── Medium 1 (BD): 鲁邦三世 卡里奥斯特罗之城 ── Track 1 ──▶ [ Work: 鲁邦三世 卡里奥斯特罗之城 ]
   ├── Medium 2 (BD): 风之谷                     ── Track 1 ──▶ [ Work: 风之谷 ]
   ├── Medium 8 (BD): 千与千寻                   ── Track 1 ──▶ [ Work: 千与千寻 ]
   └── Medium 13 (BD): 特典盘                    ── Track 1..N ─▶ 特典表达
```

1. **严禁混淆挂载**：不能把全集盒装的品番/条码挂到其中单部作品名下。
   《千与千寻》只挂它自己的发行版（如 `VWBS-1530`），盒装 `VWBS-1531` 属于汇编
2. **盒装展开步骤**：
   - 建汇编 `work`（或聚合 `collection`）与它的 `release`
   - 按实物建全部 `medium`（逐盘、标明格式）
   - 各盘 `track` 的 `contents[].expression_id` 指向各母作品下对应的 `expression`
   - `release.subjects` 声明全部被收录的 `work`
   - 用 `includes` 关系把汇编作品与各母作品连起来
   - 特典不属于盒内正片时用 `bonus_included_in` / `store_bonus_for` 表达，不要误建为盒内 Medium

## 4. 企划聚合与拓扑约束

企划/世界观由 `collection` + `includes` 表达（没有独立的「世界观」实体）。以系列为例：

```
[ Collection: 流浪地球系列 ] ──includes──▶ Work: 流浪地球（原著小说）
        │                        │
        │                        ├──includes──▶ Work: 流浪地球（电影第 1 部）
        │                        └──includes──▶ Work: 流浪地球 2（电影第 2 部）
        │
        └── 内容关系：电影 1 ──adaptation_of──▶ 原著小说
                     电影 2 ──sequel_of────▶ 电影 1
                     原声大碟 ─soundtrack_of▶ 电影 1
        └── 署名关系：刘慈欣 ─created_by─▶ 原著小说；郭帆 ─directed_by─▶ 电影 1/2；阿鲲 ─composed_by─▶ 原声
```

### 4.1 关系码矩阵（以 `GET /api/catalog/definitions` 为准）

| 关系码 | 中文谓词 | 方向与端点 | 约束 |
|---|---|---|---|
| `includes` | 组成包含 / 组成属于 | collection/work → work/collection | 企划聚合与嵌套，有向无环，声明为聚合关系 |
| `adaptation_of` | 改编自 | work → work | 跨媒介改编，有向无环 |
| `sequel_of` | 续作于 | work → work | 严格单向 |
| `spin_off_of` | 外传自 | work → work | 有向无环 |
| `soundtrack_of` | 配乐用于 | work → work | 音乐作品指向影视/游戏 |
| `translation_of` / `revision_of` / `cover_of` / `alternate_take_of` | 翻译自 / 修订自 / 翻唱自 / 别版取自 | expression → expression | 表现层派生，有向无环 |
| `pressing_of` | 再版自 | release → release | 版次链，有向无环 |
| `character_in` | 角色登场 | agent → work/collection | 同一角色跨作品多条边；番位写 `attributes.character_rank` 词表项 |
| `credit_for` | 参与制作 | work/content_unit/expression/release → agent | 通用署名兜底，原文写 `credit_role` |
| `member_of` | 所属团体 | agent → agent | 个人与团体，有向无环 |
| `bonus_included_in` | 特典收录于 | expression → release/medium | 有向无环 |
| `store_bonus_for` | 渠道特典归属 | expression/release → agent | 有向无环 |

署名类关系（`created_by` / `performed_by` / `composed_by` / `lyricist_of` / `arranged_by` /
`directed_by` / `written_by` / `illustrated_by` / `narrated_by` / `voiced_by` /
`photographed_by` / `modeled_by` / `developed_by` / `translated_by`）统一为
work/content_unit/expression/release → agent。需要新关系码时，走后台 Definitions 的
草稿 → 影响面校验 → 发布，而不是改代码。

### 4.2 多边区分

同一对实体存在同类多条关系时，用边属性区分，不要为它拆实体：

- 声优配音：多条 `voiced_by`，`character` 引用角色实体，`language` / `context` 区分语种与适用篇目
- 角色登场：同一角色跨作品用多条 `character_in`，番位落 `character_rank`，原文落 `credit_role`
- 服务端按「端点 + 类型 + 属性」判重（不按人名去重）；同一端点同属性、仅 `position` 不同的边会被唯一索引拒绝
  （`400 constraint_violation`）——要表达同一演员的两个角色位，请让 `character` 等属性不同
- 声明 `acyclic` 的关系写入前会做环路检测

## 5. 封面保真

| 媒介形态 | `cover_aspect` | 建议最低分辨率 | 可用来源 |
|---|---|---|---|
| 音乐唱片 / OST / 单曲 | `"1:1"` | ≥ 1400 × 1400 px | 官方数字版封面、Cover Art Archive |
| 电影 / TV 动画 / 纪录片 | `"2:3"` | ≥ 1000 × 1500 px | 官方宣发海报、院线海报 |
| 图书 / 轻小说 / 漫画 | `"3:4"` | ≥ 1200 × 1600 px | 出版社官网、ISBN 官方归档图 |

1. 杜绝纯色占位图、404 图、带「暂无图片」水印的过渡图
2. 作品主封面必须是官方商业出版物或宣发物料，不用同人图
3. 目录侧的 `pictures` 只保存**引用**（URL + 出处），服务端不抓取、不转存；
   需要长期稳定可引用的图片地址时，把文件交给存储服务后用
   `GET /api/storage/assets/:id/content`（对象存储的预签名地址会过期，不适合长期引用）

## 6. 多语言与证据

### 6.1 翻译与回退

- 实体写明 `original_language`（如 `ja` / `zh-CN` / `en-US`）
- `translations` 是按 locale 分组的对象，每个语种含 `title` / `summary` / `aliases`；
  原语言题名归它自己的语种行，不塞进实体级别的别名
- 展示回退链：请求语言 → `en-US` → `original_language` → 基础字段（只影响展示，不回写数据）
- 动态术语（类型、字段、词表项、关系码）的多语言名称来自 definitions，前端不硬编码；
  UI 文案走四个语种字典 `frontend/src/messages/{zh-CN,en-US,zh-TW,ja-JP}.json`

### 6.2 修订与证据

每次写入都会在 `catalog.revisions` 落一行（操作者、说明、来源、快照），并写一条 outbox 事件；
客户端必须提供：

- `edit_note`：说清本次修改的依据与范围（服务端只要求非空）
- `sources`：至少一条，每项为 `{ kind, citation, url }`，`kind` 取 `url` / `publication` / `self`；
  没有来源就没法核对，也拿不到 `400 evidence_required` 之外的宽容

## 7. 审查核验清单

### 7.1 纯净题名
- [ ] 作品题名是否混入 `TV(动画)?`、`剧场版`、`OVA`、`OAD`、`第[0-9]季`、`Season`、`Vol`、
      `1080P`、`4K`、`UHD`、`Hi-Res`、`FLAC`、`初回限定`、`字幕组`？命中就剥离到发行版与载体
      （这是审查口径，服务端不做自动拦截）

### 7.2 盒装与合集
- [ ] 单部作品的 `catalog_number` / 条码是否为该单品的，而不是全集盒装的
- [ ] 盒装的分盘数量与实物一致，每个 Track 是否指回正确的母作品表达
- [ ] `release.subjects` 是否覆盖全部被收录的 `work`

### 7.3 标识符
- [ ] 图书条码是否通过 ISBN-13 校验位验算
- [ ] 唱片编号 `catalog_number` 是否按官方形态书写（如 `VICL-60017`），不用口语化文本

### 7.4 封面
- [ ] `cover_aspect` 与实际宽高比是否一致（音乐 1:1、影视 2:3、书籍 3:4）
- [ ] 分辨率是否达标、无盗链水印、无占位图

### 7.5 图谱与多语言
- [ ] 声明 `acyclic` 的关系没有自环或双向回环
- [ ] `original_language` 明确，多语言行齐备且原语言行存在
- [ ] `edit_note` 说清依据，`sources` 至少一条且可访问

## 8. 延伸阅读

- [AI Agent 接入与自动化编目协作指南](/agent-integration)
- [IFLA LRM 增强版实体模型](/frbr-model)
- [分类体系与动态标签](/taxonomy)
- [新建与编辑（写入 API）](/api-edit)
