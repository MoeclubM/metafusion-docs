---
title: "AI Agent 接入与自动化编目协作指南"
description: "身份设定、七步 SOP、八类 kind 层级建模、盒装与合集、表达复用、审计留痕与可照抄示例。"
order: 35
group: "api"
---

# AI Agent 接入与自动化编目协作指南

本指南面向以 Agent 身份接入 MetaFusion 的自动化编目流程：身份设定与铁律、七步标准作业流程、八类 kind 的层级建模、盒装与合集的层级处理、表达跨发行复用、写入与审计留痕，以及可照抄的 Python / TypeScript / cURL 脚本。

接口与错误码契约见 [AI Agent 自动化 API 与工具规范](/api-agent)，写入 DTO 与乐观锁细节见 [新建与编辑](/api-edit)，实体边界与动态定义见 [元数据目录](/catalog) 与 [API 概览](/api-overview)。

> 运行时事实来源是 `GET /api/openapi.json` 与 `GET /api/catalog/definitions`。本页示例只示范请求形状，字段码、词表项与关系码一律以目标实例的定义为准。

## 1. 身份设定

### 1.1 角色与三条铁律

- **角色标识**：MetaFusion Curator & Cataloging Reviewer（编目审查员）
- **职责范围**：跨媒介（文学、漫画、动画、影视、音乐、游戏）的考据、层级建模、关系织网、审计留痕与写后复核
- **三条铁律**：
  1. **题名纯净**：Work 只保留能辨识创作母体的主名；季数、卷号、载体、规格、画质、包装、字幕组信息归 Release / Medium / Track 或标签
  2. **写入留痕**：每次写入都带具体 `edit_note` 和至少一条 `sources` 项（`{kind, citation, url}`），缺证据服务端一律拒绝
  3. **检索查重优先**：创建前先查重，能复用就不新建；只有证据显示是不同创作实体时才新建 Work

题名纯净、ISBN 校验位、封面宽高比属于**编目规范**（社区准则与技能约束），不是接口拦截：服务端不会因为题名里带"第 1 季"或"1080P"而拒绝写入，那是建模错误；`attributes` 里的画幅、书号等值也只在该字段被 definitions 声明时按定义校验。规范细节见 [权威编目与审查准则](/curation-guide) 与 [元数据目录](/catalog)。

### 1.2 System Prompt 模版

```markdown
你是 MetaFusion 的编目审查员（Curator & Cataloging Reviewer），负责把考据结论落到目录数据模型里。

数据模型（固定八类 kind）：
- agent / collection / work / content_unit / expression / release / medium / track
- work 只放纯净题名、原始语言、作品级简介与标签；季数、卷号、品番、条码、包装、规格归 release 与 medium
- content_unit 与 expression 必须挂 work_id；medium 必须挂 release_id；track 必须挂 medium_id
- release 没有 work_id：被其收录表达所属的 Work 全部在 subjects 里声明，role 取 primary / compilation / supplement
- track 的 contents[] 是唯一收录来源，项为 {expression_id, position, locator}；跨发行复用同一个 expression
- 关系只用 GET /api/catalog/definitions 中 enabled 的码；声明 acyclic 的关系服务端会拒绝自环与成环

工作纪律：
1. 先查重（GET /api/catalog/entities?q=…&kind=…），能复用不新建，能补层级不另建母体。
2. 每次写入都带具体 edit_note 与至少一条 sources{kind, citation, url}。
3. 创建用 POST /api/catalog/entities：entity.id 留空、expected_version 传 0；更新用 PUT：先 GET 全量，只改要改的字段，其余原样带回，并带上当前 version。
4. 没有跨层级的原子提交端点：按 agent/work → content_unit/expression → release → medium → track → relations 的顺序逐层提交，记录每步返回的 id；失败就停下并报告已写入的部分。
5. 收到 409 version_conflict 时回读实体取最新 version 再重放，不盲目重试；不确定是否成功就先 GET 回读。
6. 第 7 步回读实体、relations、occurrences、revisions 复核，结论只写在已复核的范围内。
7. 题名纯净、ISBN 校验位与封面比例是编目规范，服务端不做这类自动拦截；不确定就报"需补证据"，不要用近似数据填充。
```

### 1.3 技能包

编目任务先读独立技能仓库 [MoeclubM/metafusion-skills](https://github.com/MoeclubM/metafusion-skills)：

- [metafusion-curator](https://github.com/MoeclubM/metafusion-skills/blob/main/skills/metafusion-curator/SKILL.md)：流程、证据、API 写入与回读、审查结论格式
- [lrm-catalog-standards](https://github.com/MoeclubM/metafusion-skills/blob/main/skills/lrm-catalog-standards/SKILL.md)：实体边界、发行版命名、内容复用

技能里的枚举是说明书，不是运行时事实：实际可用的字段码与关系码仍以目标实例的 `GET /api/catalog/definitions` 为准。

## 2. 七步标准作业流程

```text
1 确认实例与工具  →  2 考据与查重  →  3 层级建模  →  4 题名清洗与多语言
   →  5 按依赖顺序写入  →  6 关系织网  →  7 写后复核与报告
```

| 步骤 | 动作 | 依据或端点 |
| --- | --- | --- |
| 1 确认实例与工具 | 读端点清单、发布态定义、当前用户与权限 | `GET /api/openapi.json`、`GET /api/catalog/definitions`、`GET /api/auth/me` |
| 2 考据与查重 | 收集与字段对应的权威来源；按题名、别名、条码、品番、外部 ID 查重 | `GET /api/catalog/entities?q=…&kind=…` |
| 3 层级建模 | 把事实拆到 Work / ContentUnit / Expression / Release / Medium / Track | 见 §3、§4 |
| 4 题名清洗与多语言 | Work 题名只留主名，规格移到发行层；补齐 `translations` | `GET /api/catalog/definitions` |
| 5 按依赖顺序写入 | 逐层 `POST`，保存每步返回的 id；无原子端点 | `POST /api/catalog/entities` |
| 6 关系织网 | 只用 enabled 的关系码；无环关系不得成环 | `POST /api/catalog/relations` |
| 7 写后复核与报告 | 回读实体、关系、收录与修订；结论分「通过 / 需补证据 / 需修正 / 实现缺口」 | `GET …/{id}`、`/relations`、`/occurrences`、`/revisions` |

**各步要点**

1. 统一入口是 `/api`，没有版本前缀；先确认令牌有效、`permissions` 覆盖要用的端点和状态。
2. `q` 是题名或 `translations` 整段文本的子串匹配；`limit` 默认 50、上限 100。来源必须与字段对应：作品身份、发行规格、篇目与表达、关系各要各自的证据。
3. 先决定每层放什么再写载荷。简单作品不必凑齐全部层级；没有来源就不造层级。
4. `translations` 是按 locale 分组的对象，发布态要求至少一条翻译行。
5. 创建一律 `entity.id` 留空、`expected_version` 传 0；更新先 `GET` 再 `PUT` 整实体替换。
6. 关系两端实体必须先存在；职位原文、番位、语言等上下文放 `attributes`。
7. 回读校验，别把「POST 返回 200」当成建模正确；请求成功也不等于全库图谱已证明无环。

## 3. 八类 kind 的层级建模

| kind | 保存的事实 | 归属字段 | 不要放 |
| --- | --- | --- | --- |
| `agent` | 责任主体：个人、团体、机构、虚构角色 | 无 | 按单部作品重复创建同一主体 |
| `collection` | 系列、企划、世界观等聚合枢纽 | 无 | 为作者个人作品全集硬造企划 |
| `work` | 纯净创作母体、基础题名、创作主体、原始语言、作品级简介与标签 | 无（顶层） | 季数、盘号、卷号、品番、条码、规格、包装 |
| `content_unit` | 同一 Work 内的逻辑章、集、篇目目录 | `work_id`（必填）、`parent_id`（同 Work） | 专辑名、发行品番、具体盘号 |
| `expression` | 可被多个发行复用的表达：母版、正片、录音、译本 | `work_id`（必填）、`content_unit_id`（可选） | 发行专属的版次信息；`expression` 没有 `parent_id` |
| `release` | 一次真实发行的版本信息与 `subjects` | 无上级；`subjects` 声明收录的 Work | 挂到某部作品名下的 `work_id` |
| `medium` | 发行内真实的盘、卷、文件集及其顺序与载体规格 | `release_id`（必填）、`parent_id`（同 Release） | 作品目录树、没有来源的虚构盘片 |
| `track` | 载体内的物理位置项与其 `contents` 收录 | `medium_id`（必填）、`parent_id`（同 Medium） | 把 Track 当独立作品或当目录层 |

归属与父子规则：

- `content_unit` / `expression` 必须有 `work_id`，`medium` 必须有 `release_id`，`track` 必须有 `medium_id`；缺归属返回 `parent_required`
- `parent_id` 只能指向同域父节点（同一 Work 的篇目、同一 Release / Medium 的载体与位置），跨域父子由库内复合外键拦截
- `release` 的 `subjects` 必须覆盖其载体实际收录的全部 Work，`role` 取 `primary` / `compilation` / `supplement`；漏声明返回 `undeclared_release_subject`
- `position` 是非负排序整数，`number` 保留官方原文（`A1`、`EX` 不要改写成整数）

## 4. 盒装、合集与跨 Work 收录

盒装与合集最容易出错的地方是把整套的品番挂到其中一部单作品上。正确做法是给汇编内容独立建档。

```text
单作品发行   Release VWBS-1530（1×BD）              subjects: primary → Work《千与千寻》
             └ Medium 01 ─ Track 1 ─ contents[0].expression_id → Expression（千与千寻 正片）

盒装发行     Release VWBS-1531（13×BD 套盒）        subjects: compilation → Work《宫崎骏监督作品集》
             ├ Medium 01 ─ Track 1 ─→ Expression（鲁邦三世 卡里奥斯特罗之城 正片）
             ├ Medium 02 ─ Track 1 ─→ Expression（风之谷 正片）
             ├ Medium 03 ─ Track 1 ─→ Expression（天空之城 正片）
             ├ …（各分碟指向各自作品下的 Expression）
             └ Medium 13 ─ Track 1 ─→ Expression（特典：引退记者会）

关系         Work《宫崎骏监督作品集》--includes--> Work《千与千寻》
             （includes 声明 aggregate，页面按「组成」展示；反向方向由服务端按反向名渲染，不要另建反向边）
```

建模规则：

1. **汇编独立建档**：为盒装建汇编 Work，在其下建该盒装的 Release；不要把盒装品番挂到其中任何一部作品
2. **subjects 声明齐全**：该 Release 的 `subjects` 列出实际收录的全部 Work，盒装内的作品用 `compilation`，主作品用 `primary`，附加内容用 `supplement`
3. **按实际包装建载体**：13 张 BD 就是 13 个 Medium（`format` 取 definitions 中 `format` 词表的项），特典盘同样按真实盘片建
4. **分碟回溯到作品**：每个 Medium 下 Track 的 `contents[].expression_id` 指向对应作品下的 Expression——跨 Work 引用是允许的，前提是 `subjects` 已声明
5. **组成关系**：用 `includes`（`collection`/`work` → `work`/`collection`，声明无环且 aggregate）表达"谁被这套收录"；同一角色跨作品的登场用多条 `character_in`

## 5. 表达跨发行复用

`Expression` 是"收录到 Track 上的那一层"（原版母带、正片剪辑、译本正文、分集）。同一表达出现在多个发行里时，只建**一个** Expression，各发行的 Track 通过 `contents[].expression_id` 指向它：

```json
{
  "entity": {
    "kind": "track",
    "medium_id": "<Medium UUID>",
    "title": "A1",
    "translations": { "zh-CN": { "title": "A1" } },
    "types": ["track"],
    "status": "published",
    "attributes": { "role": "side", "duration": 291 },
    "contents": [{ "expression_id": "<Expression UUID>", "position": 0, "locator": {} }]
  },
  "expected_version": 0,
  "edit_note": "依据黑胶内页标注建立 A 面第一首的收录位置",
  "sources": [{ "kind": "url", "citation": "官方黑胶内页", "url": "https://example.com/vinyl" }]
}
```

- **contents 项的形状**：`{expression_id, position, locator}`；`locator` 走 definitions 的 `locator` 组字段（页码、时间码、文件路径、章节），整轨收录允许 `{}`
- **反查收录**：`GET /api/catalog/entities/{id}/occurrences`——expression 返回自身，`content_unit` / `work` 返回其表达；发行页要一次取多条表达用 `POST /api/catalog/expressions/details`（请求体 `{ids:[…]}`，上限 500）
- **表达之间的关系**：译本是 `translation_of`、修订是 `revision_of`、翻唱是 `cover_of`、别版是 `alternate_take_of`（均为 expression → expression，声明无环）
- **版次差异不要改共用表达**：同一表达在不同发行的时长、署名差异属于该版次，写在该 Track 自己的 `attributes`，不要改共用 Expression

## 6. 写入与审计留痕

| 操作 | 端点 | 权限 |
| --- | --- | --- |
| 创建实体 | `POST /api/catalog/entities` | 登录；直接发布需 `catalog.entity.edit`（或 `catalog.lifecycle.manage`） |
| 更新实体 | `PUT /api/catalog/entities/:id` | 同上，且必须是该条目的可写者 |
| 合并 / 退役 | `POST /api/catalog/entities/:id/lifecycle` | `catalog.lifecycle.manage` |
| 创建关系 | `POST /api/catalog/relations` | `catalog.relation.edit` |
| 更新 / 删除关系 | `PUT / DELETE /api/catalog/relations/:id` | `catalog.relation.edit` |
| 修订历史 | `GET /api/catalog/entities/:id/revisions` | 开放（按可见性过滤） |
| 外部导入 | `POST /api/importer/preview`、`POST /api/importer/import` | `catalog.import.submit` |

- **没有跨层级原子端点**：一条发行链就是多次 `POST /api/catalog/entities`，按依赖顺序提交，保存每步返回的 id；中途失败时停止后续依赖写入，报告已写入的部分，不做"整体回滚"的假设
- **证据与修订**：每次写入都带 `edit_note` + `sources`（`kind` 为 `url` / `publication` / `self`，`citation` 必填，带 `url` 时必须是合法 HTTP(S)）；服务端同时写修订行与事件，可用 `GET /api/catalog/entities/:id/revisions` 复核
- **幂等**：`POST /api/catalog/entities` 与 `POST /api/catalog/relations` 认 `Idempotency-Key` 请求头（进程内存 24 小时，缓存键为「路由 + 用户 + key」，不做载荷哈希）；更新与删除靠 `expected_version`，不要在 409 之后盲目重复创建
- **PUT 是整实体替换**：先 `GET` 拿全量，只改要改的字段，其余原样带回；`kind` / `work_id` / `release_id` / `medium_id` 不可改
- **状态流转**：新建缺省 `draft`；发布态要求至少一条 `translations` 且结构引用的实体已发布；`deleted` / `merged` 只能经生命周期端点写入，已发布条目也不能经实体写入降级
- **关系码取用**：署名类关系是 `*_by` 系列（`created_by` / `composed_by` / `performed_by` / `directed_by` / `voiced_by` / `photographed_by` …），角色登场用 `character_in`，作品之间的派生用 `adaptation_of` / `sequel_of` / `spin_off_of` / `soundtrack_of`，组成用 `includes`；没有贴切码时用通用兜底 `credit_for`，把职位原文写进 `credit_role`
- **外部导入**：导入器当前只支持 Bangumi（`source` 留空或 `auto` 都归一为 `bangumi`），`entity_type` 取 `work` / `artist` / `organization` / `character`，`link_mode` 取 `new_work` / `append_release_to_work` / `create_relation`；`merge_translations` 与其它取值报 `invalid_link_mode`。载荷**声明了就必须被兑现**：没有落点的字段在零写入预检里报 `unsupported_field_for_entity_type: entity_type=… field=…`（如 `mediums[].media_category`、`release.cover_aspect`、`release.notes`），`has_release=true` 或带了非空 `release` 却没有 `mediums` 报 `invalid_payload: … requires mediums`（无载体发行改走 `append_release_to_work`），`entity_type` 越出上面四个值报 `invalid_entity_type`；`media_type_hint` 是声明而非输入，非空即 `not_supported: media_type_hint`。预览与落库同权限、同一预检判据：预览同样按载荷出站抓取，因此也受限流约束

## 7. 可照抄示例

前置：`METAFUSION_API_BASE` 形如 `http://127.0.0.1:8080/api`；`METAFUSION_TOKEN` 是会话令牌或 OAuth 访问令牌。示例把每层都直接建成 `published`，因此令牌需要 `catalog.entity.edit`（或 `catalog.lifecycle.manage`）；只有普通权限时先建 `draft`，复核后再 `PUT` 发布。

三个示例做同一件事：检索查重 → 建 Work → 建 Expression → 建 Release / Medium / Track → 建关系 → 回读校验。

### 7.1 Python

```python
#!/usr/bin/env python3
"""按依赖顺序建立一条发行链：检索 → Work → Expression → Release/Medium/Track → 关系 → 回读。"""
import os
import requests

BASE = os.environ["METAFUSION_API_BASE"]
TOKEN = os.environ["METAFUSION_TOKEN"]
S = requests.Session()
S.headers.update({"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})

NOTE = "依据官方作品页与官方发行页建立作品、表达与发行链"
SOURCES = [
    {"kind": "url", "citation": "官方作品页题名与作品形态", "url": "https://example.com/work"},
    {"kind": "url", "citation": "官方发行页品番与包装", "url": "https://example.com/release"},
]

def tr(zh, en):
    """translations 是按 locale 分组的对象，不是数组。"""
    return {"zh-CN": {"title": zh}, "en-US": {"title": en}}

def call(method, path, body=None, key=None):
    headers = {"Idempotency-Key": key} if key else {}
    r = S.request(method, BASE + path, json=body, headers=headers)
    if r.status_code == 409:
        raise SystemExit("409 version_conflict：回读实体取最新 version 再重放")
    if not r.ok:
        raise SystemExit(f"{r.status_code} {r.text}")
    return r.json()

def create(entity, key):
    return call("POST", "/catalog/entities", {
        "entity": entity, "expected_version": 0, "edit_note": NOTE, "sources": SOURCES,
    }, key)

# 1. 检索查重：q 是题名或翻译文本的子串匹配
hits = S.get(f"{BASE}/catalog/entities", params={"q": "城市光影", "kind": "work", "limit": 5}).json()
if hits["total"]:
    raise SystemExit(f"已有候选 {hits['items'][0]['id']}，先复核是补层级还是合并")

# 2. Work：只放创作层事实
work = create({
    "kind": "work", "title": "城市光影", "original_language": "zh-CN",
    "translations": tr("城市光影", "City Lights"), "types": ["photobook"],
    "status": "published", "attributes": {"tags": ["摄影"]},
}, "demo-work")

# 3. Expression：可被多个发行复用的那一层
expr = create({
    "kind": "expression", "work_id": work["id"], "title": "初版正文",
    "translations": tr("初版正文", "First edition"), "types": ["expression"],
    "status": "published", "attributes": {"language": "zh-CN"},
}, "demo-expr")

# 4. Release 声明 subjects，再按实际包装建 Medium 与 Track
release = create({
    "kind": "release", "title": "城市光影（初版精装）",
    "translations": tr("城市光影（初版精装）", "City Lights (first edition)"),
    "types": ["release"], "status": "published",
    "attributes": {"edition_date": "2024-05-01", "edition_type": "standard",
                   "country": "CN", "catalog_number": "DEMO-0001"},
    "subjects": [{"work_id": work["id"], "role": "primary", "position": 0}],
}, "demo-release")

medium = create({
    "kind": "medium", "release_id": release["id"], "title": "纸质册",
    "translations": tr("纸质册", "Printed volume"), "types": ["medium"],
    "status": "published", "attributes": {"format": "paper"},
}, "demo-medium")

track = create({
    "kind": "track", "medium_id": medium["id"], "title": "正文",
    "translations": tr("正文", "Body"), "types": ["track"],
    "status": "published", "attributes": {"role": "primary"},
    "contents": [{"expression_id": expr["id"], "position": 0, "locator": {}}],
}, "demo-track")

# 5. 关系：两端实体已存在后再织网
agent = create({
    "kind": "agent", "title": "示例摄影师",
    "translations": tr("示例摄影师", "Example Photographer"), "types": ["person"],
    "status": "published",
}, "demo-agent")

call("POST", "/catalog/relations", {
    "relation": {"type": "photographed_by", "source_id": work["id"],
                 "target_id": agent["id"], "position": 0, "attributes": {}},
    "expected_version": 0, "edit_note": NOTE, "sources": SOURCES,
}, "demo-rel")

# 6. 回读校验
back = call("GET", f"/catalog/entities/{track['id']}")
assert back["contents"][0]["expression_id"] == expr["id"], "收录引用与写入不一致"
print("收录反查：", call("GET", f"/catalog/entities/{expr['id']}/occurrences"))
```

### 7.2 TypeScript

在 ESM 环境运行（Node 20+，自带 `fetch` 与顶层 `await`）：

```typescript
const BASE = process.env.METAFUSION_API_BASE ?? "http://127.0.0.1:8080/api";
const TOKEN = process.env.METAFUSION_TOKEN ?? "";
const NOTE = "依据官方发行页建立作品与发行链";
const SOURCES = [{ kind: "url", citation: "官方发行页", url: "https://example.com/release" }];

type Entity = { id: string; version: number; contents?: Array<{ expression_id: string }> };

async function call(method: string, path: string, body?: unknown, key?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: "Bearer " + TOKEN,
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 409) throw new Error("version_conflict：回读实体取最新 version 再重放");
  if (!res.ok) throw new Error(res.status + " " + (await res.text()));
  return res.json() as Promise<Entity>;
}

const tr = (zh: string, en: string) => ({ "zh-CN": { title: zh }, "en-US": { title: en } });
const create = (entity: Record<string, unknown>, key: string) =>
  call("POST", "/catalog/entities", { entity, expected_version: 0, edit_note: NOTE, sources: SOURCES }, key);

// 1. 检索查重
const hits = (await call("GET", "/catalog/entities?q=" + encodeURIComponent("城市光影") + "&kind=work&limit=5")) as unknown as {
  items: Array<{ id: string; title: string }>;
  total: number;
};
if (hits.total > 0) throw new Error("已有候选 " + hits.items[0].id + "，先复核再写入");

// 2–4. 按依赖顺序建链：Work → Expression → Release → Medium → Track
const work = await create(
  { kind: "work", title: "城市光影", original_language: "zh-CN", translations: tr("城市光影", "City Lights"),
    types: ["photobook"], status: "published", attributes: { tags: ["摄影"] } },
  "demo-work"
);
const expr = await create(
  { kind: "expression", work_id: work.id, title: "初版正文", translations: tr("初版正文", "First edition"),
    types: ["expression"], status: "published" },
  "demo-expr"
);
const release = await create(
  { kind: "release", title: "城市光影（初版精装）", translations: tr("城市光影（初版精装）", "City Lights (first edition)"),
    types: ["release"], status: "published",
    attributes: { edition_date: "2024-05-01", catalog_number: "DEMO-0001" },
    subjects: [{ work_id: work.id, role: "primary", position: 0 }] },
  "demo-release"
);
const medium = await create(
  { kind: "medium", release_id: release.id, title: "纸质册", translations: tr("纸质册", "Printed volume"),
    types: ["medium"], status: "published", attributes: { format: "paper" } },
  "demo-medium"
);
const track = await create(
  { kind: "track", medium_id: medium.id, title: "正文", translations: tr("正文", "Body"),
    types: ["track"], status: "published",
    contents: [{ expression_id: expr.id, position: 0, locator: {} }] },
  "demo-track"
);

// 5. 关系：两端实体已存在后再织网（关系码以 GET /api/catalog/definitions 为准）
const agent = await create(
  { kind: "agent", title: "示例摄影师", translations: tr("示例摄影师", "Example Photographer"),
    types: ["person"], status: "published" },
  "demo-agent"
);
await call("POST", "/catalog/relations", {
  relation: { type: "photographed_by", source_id: work.id, target_id: agent.id, position: 0, attributes: {} },
  expected_version: 0, edit_note: NOTE, sources: SOURCES,
}, "demo-rel");

// 6. 回读校验
const back = await call("GET", "/catalog/entities/" + track.id);
if (back.contents?.[0]?.expression_id !== expr.id) throw new Error("收录引用与写入不一致");
console.log("发行链已建立", { work: work.id, release: release.id, track: track.id });
```

### 7.3 cURL

需要 `curl` 与 `jq`。`mfpost` 从 stdin 读载荷、用 `jq -n` 构造 JSON，避免手工拼接转义：

```bash
BASE=http://127.0.0.1:8080/api
TOKEN="<会话令牌或 OAuth 访问令牌>"   # 换成真实令牌
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
NOTE='依据官方作品页与官方发行页建立作品、表达与发行链'
SRC='[{"kind":"url","citation":"官方作品页","url":"https://example.com/work"}]'

mfpost() { curl -s -X POST "$BASE$1" "${AUTH[@]}" -H "Idempotency-Key: $2" -d @- | jq -r .id; }

# 1. 检索查重
curl -s "$BASE/catalog/entities?q=城市光影&kind=work&limit=5" | jq '.total'

# 2. Work
WORK=$(jq -n --arg note "$NOTE" --argjson src "$SRC" '{
  entity: { kind: "work", title: "城市光影", original_language: "zh-CN",
            translations: { "zh-CN": { title: "城市光影" }, "en-US": { title: "City Lights" } },
            types: ["photobook"], status: "published", attributes: { tags: ["摄影"] } },
  expected_version: 0, edit_note: $note, sources: $src }' | mfpost /catalog/entities demo-work)

# 3. Expression
EXPR=$(jq -n --arg note "$NOTE" --argjson src "$SRC" --arg work "$WORK" '{
  entity: { kind: "expression", work_id: $work, title: "初版正文",
            translations: { "zh-CN": { title: "初版正文" } },
            types: ["expression"], status: "published" },
  expected_version: 0, edit_note: $note, sources: $src }' | mfpost /catalog/entities demo-expr)

# 4. Release（subjects 声明收录的 Work）→ Medium → Track
RELEASE=$(jq -n --arg note "$NOTE" --argjson src "$SRC" --arg work "$WORK" '{
  entity: { kind: "release", title: "城市光影（初版精装）",
            translations: { "zh-CN": { title: "城市光影（初版精装）" } }, types: ["release"],
            status: "published", attributes: { edition_date: "2024-05-01", catalog_number: "DEMO-0001" },
            subjects: [{ work_id: $work, role: "primary", position: 0 }] },
  expected_version: 0, edit_note: $note, sources: $src }' | mfpost /catalog/entities demo-release)

MEDIUM=$(jq -n --arg note "$NOTE" --argjson src "$SRC" --arg release "$RELEASE" '{
  entity: { kind: "medium", release_id: $release, title: "纸质册",
            translations: { "zh-CN": { title: "纸质册" } }, types: ["medium"],
            status: "published", attributes: { format: "paper" } },
  expected_version: 0, edit_note: $note, sources: $src }' | mfpost /catalog/entities demo-medium)

TRACK=$(jq -n --arg note "$NOTE" --argjson src "$SRC" --arg medium "$MEDIUM" --arg expr "$EXPR" '{
  entity: { kind: "track", medium_id: $medium, title: "正文",
            translations: { "zh-CN": { title: "正文" } }, types: ["track"], status: "published",
            contents: [{ expression_id: $expr, position: 0, locator: {} }] },
  expected_version: 0, edit_note: $note, sources: $src }' | mfpost /catalog/entities demo-track)

# 5. 关系：两端实体已存在
AGENT=$(jq -n --arg note "$NOTE" --argjson src "$SRC" '{
  entity: { kind: "agent", title: "示例摄影师", translations: { "zh-CN": { title: "示例摄影师" } },
            types: ["person"], status: "published" },
  expected_version: 0, edit_note: $note, sources: $src }' | mfpost /catalog/entities demo-agent)

jq -n --arg note "$NOTE" --argjson src "$SRC" --arg work "$WORK" --arg agent "$AGENT" '{
  relation: { type: "photographed_by", source_id: $work, target_id: $agent, position: 0, attributes: {} },
  expected_version: 0, edit_note: $note, sources: $src }' | mfpost /catalog/relations demo-rel

# 6. 回读校验
curl -s "$BASE/catalog/entities/$TRACK" | jq '{id, title, contents}'
curl -s "$BASE/catalog/entities/$EXPR/occurrences" | jq .
curl -s "$BASE/catalog/entities/$WORK/relations" | jq '.items | length'
```

## 8. 排错

完整错误码表见 [AI Agent 自动化 API 与工具规范](/api-agent)。编目过程中最常撞到的几类：

| 现象 | 含义 | 动作 |
| --- | --- | --- |
| `400 evidence_required` | `edit_note` 为空或 `sources` 为空 | 补具体修改说明 + 至少一条来源；`sources[].citation` 必填 |
| `400 invalid_payload` | 载荷形状错误，或含未知字段 | 按当前 DTO 重写：`{entity, expected_version, edit_note, sources}`，不要提交旧契约字段 |
| `400 parent_required` | 缺 `work_id` / `release_id` / `medium_id` | 补归属，或改到正确层级提交 |
| `400 immutable_scope` | 想改 `kind` / `work_id` / `release_id` / `medium_id` | 换归属要重建实体，重复建档走生命周期合并 |
| `400 undeclared_release_subject` | Track 收录的表达所属 Work 没在该发行的 `subjects` 里 | 先补 `subjects`（`primary` / `compilation` / `supplement`），再重放 Track |
| `400 invalid_reference` | 引用的实体不存在、kind 不符或不可见（含引用未发布的实体去发布） | 先读该实体；合并过的先用 `/resolve` |
| `400 constraint_violation` | 跨 Work 的父子、跨 Release 的载体父子等 | 父子只能在同一 Work / Release / Medium 内 |
| `400 translation_required` | 发布态没有 `translations` | 至少补一条翻译行再发布 |
| `400 use_lifecycle_endpoint` | 用实体写入提交 `deleted` / `merged`，或把已发布条目降级 | 改走 `POST /api/catalog/entities/:id/lifecycle` |
| `400 relation_cycle` / `invalid_endpoints` / `duplicate_relation` | 无环关系成环、两端 kind 不允许（含自环）、重复边 | 按 definitions 的端点与无环声明改方向；先删冲突旧边 |
| `400 invalid_term` / `invalid_type` | 词表值或业务类型不在定义内 | 用 definitions 的 `terms` 与 `types`，不要按字面猜 |
| `401 authentication_required` / `403 forbidden` | 令牌无效，或缺权限码、不是该条目的可写者 | 重新登录；发布、合并归生命周期权限 |
| `404 not_found` | 不存在，或对调用者不可见 | 未发布条目只对创建者与持权限者可见 |
| `409 version_conflict` | `expected_version` 与当前版本不一致 | 回读实体取最新 version 再重放，不盲目重试 |
| `429 rate_limited` | 命中路由级限流 | 按 `Retry-After` 退避 |

遇到表里没有的错误：先用最小载荷复现一次，再核对 `GET /api/openapi.json` 与 `GET /api/catalog/definitions`；仍无法解释就停止写入，把「错误码 + 请求摘要 + 目标实体」作为实现缺口上报，不要用近似数据填充，也不要绕过接口改库。

## 9. 相关文档

- [AI Agent 自动化 API 与工具规范](/api-agent)：工具声明、权限码、幂等与完整错误码表
- [新建与编辑](/api-edit)：写入 DTO、乐观锁、关系与生命周期
- [API 概览](/api-overview)：能力分组、分页、限流与可见性
- [实体查询与详情](/api-entities)：过滤参数、详情、关系与收录反查
- [元数据目录](/catalog)：固定层级、动态定义与编目边界
- [权威编目与审查准则](/curation-guide)：题名、证据与审查口径
