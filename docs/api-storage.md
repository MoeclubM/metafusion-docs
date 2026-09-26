---
title: "存储上传与下载"
description: "内容寻址存储、分片直传、绑定用途与读取可见性。"
order: 60
group: "api"
---

# 存储上传与下载

::: tip 状态
本页描述的 `/api/storage/*` 由独立服务 `metafusion-storage` 实现（源码见其仓库 `internal/handler/`），网关把 `/api/storage/` 分流到该服务。

现行文件路径只有 `/api/storage/*`；`/api/archive/*`、`/api/playback/*`、`/api/media/*` 按实例响应为准（当前部署返回 404 属正常，换回本页的 `/api/storage/*` 路径重试）。

某条 `/api/storage/*` 端点在实例返回 404 时，以实例响应为准：记差异、停掉依赖它的写入，等实例侧补齐后再继续。
:::

文件本体、哈希与绑定由存储服务负责，目录只保存作品、表达与发行元数据。
两者用实体 UUID 互指：存储侧不复制目录数据，目录侧不保存对象存储物理路径。

存储基于内容寻址（SHA-256）去重，元数据与物理资产完全解耦。

写接口（`initiate` / `complete` / `upload/stream` / `bind` / `unbind`）与 `/stats` 需要登录：
`Authorization: Bearer <token>` 或 HttpOnly Cookie `mf_session`。
其余读接口允许匿名，但只返回对调用者可见的内容，不可读一律 404。

`initiate` / `complete` / `upload/stream` / `bind` 另外要求权限码 `storage.asset.upload`，缺码返回 `403 forbidden`（未登录仍是 `401 authentication_required`）。`member` 组默认持有该码，所以"登录即可上传"在默认配置下不变；实例要收紧上传时，从该组权限里移除它即可。

`unbind` 不需要该码：它只能删自己的绑定（所有权在服务内判定）。

两个存储权限码的分工：

| 权限码 | 分工 |
|---|---|
| `storage.asset.upload` | 创建并登记自己的东西 |
| `storage.asset.moderate` | 处置他人的东西：续传/覆盖他人未完成的上传、完成或绑定他人资产、读全局 `/stats` |

两者互不蕴含：只有审核权的人不能替别人创建资产，只有上传权的人也不能动他人的资产。

## 初始化（秒传检测）

```http
POST /api/storage/upload/initiate
Authorization: Bearer <token>
Content-Type: application/json

{
  "file_name": "track.flac",
  "file_size": 12345678,
  "sha256_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "mime_type": "audio/flac",
  "part_count": 3,
  "target_entity_id": "<uuid>",
  "binding_role": "track_audio"
}
```

字段说明：

- `sha256_hash`（必填）：客户端本地计算的 64 位十六进制 SHA-256，是文件的身份
- `part_count`（可选，默认 1）：分片数量，`presigned_urls` 按它给出对应个数的预签名地址，>1 时另给 `part_size_hint`
- 超过 `STORAGE_MAX_PARTS`（默认 10000）返回 `400 too_many_parts`
- `target_entity_id`（可选）：同时绑定到该实体，必须对调用者可见；`target_entity_type` 若填写，必须与目录给出的 kind 一致
- `binding_role`（可选，默认 `master_archive`）：绑定用途，取值匹配 `^[a-z][a-z0-9_]{0,31}$`，例如 `track_audio`、`disc_image`、`video`、`scans`
- `binding_role` 不设封闭枚举，新增用途不需要改代码

响应：

```json
{
  "is_instant_upload": false,
  "asset_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "object_key": "objects/e3/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855/track.flac",
  "upload_id": "VXBsb2FkIElE…",
  "presigned_urls": ["https://<对象存储对外地址>/metafusion-master/objects/…?partNumber=1&uploadId=…"],
  "part_size_hint": 4115226,
  "expires_at": "2026-09-15T10:00:00Z"
}
```

- `is_instant_upload: true`：库中已有同一 SHA-256 且服务端验过内容（`hash_verified=true`）的资产，无需再上传
- 请求带了 `target_entity_id` 时服务端会顺手建好绑定，响应里带 `asset` 与 `binding`
- 命中同一 SHA-256 但尚未验证（上传中，或 complete 校验失败过）不算秒传，按"没有这份内容"继续正常上传
- 未配置对象存储端点时是本地对象模式：不返回预签名地址，而是给出 `direct_upload_url`，客户端把原始字节 `PUT` 到该地址即可（服务端边收边算 SHA-256 并校验）

::: warning 注意
同一 SHA-256 的未完成上传由上传者本人续传（复用同一次分片会话），他人重传得到 `409 upload_in_progress`；
持 `storage.asset.moderate` 的审核者可接手。否则一次失败上传会把该 SHA-256 永久占死。
:::

## 直传分片（浏览器/客户端 → 对象存储）

```bash
# 各分片直接 PUT 到预签名地址，完成后从响应头 ETag 取值回传
curl -X PUT "<presigned_url_1>" --data-binary @part_1.bin
```

分片不经过业务服务器，也不消耗业务 API 带宽。

::: warning 注意
预签名 URL 的 host 参与签名，因此对象存储必须从客户端可达：编排里对象存储端口默认不对宿主机开放，
需要浏览器直传时应经反代暴露并设置 `STORAGE_S3_PUBLIC_ENDPOINT`。
:::

## 完成上传

```http
POST /api/storage/upload/complete
Authorization: Bearer <token>
Content-Type: application/json

{
  "asset_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "upload_id": "VXBsb2FkIElE…",
  "parts": [
    { "part_number": 1, "etag": "\"etag-from-part1\"" },
    { "part_number": 2, "etag": "\"etag-from-part2\"" }
  ]
}
```

服务端在对象存储完成 Multipart 合并，然后回读对象核验内容：

- 合并后先 HEAD 回读实际大小（S3 的合并响应体里没有长度），与 `file_size` 不一致返回 `409 size_mismatch`
- 随后把整份对象读回、重算 SHA-256 与 `sha256_hash` 比对：一致才置 `complete` 并记 `hash_verified=true`
- 不一致返回 `409 hash_mismatch`，资产留在 `pending`（`fail_reason=hash_mismatch`），并删除对不上声明的对象键，绝不发布
- 读回受两个部署上限约束：对象超过 `STORAGE_VERIFY_MAX_MB` 返回 `413 hash_verify_too_large`，读回超过 `STORAGE_VERIFY_TIMEOUT_SECONDS` 返回 `408 verify_timeout`；两者同样令资产留在 `pending`
- 声明的 `file_size` 就已超限时不再合并，直接失败，避免留下必然发布不了的碎片
- 这两个上限默认都不限制（大文件优先），代价是对象越大越可能撞上限
- 读回阶段的其它失败（客户端断开、对象存储不可用）返回 `503 storage_unavailable`

成功响应仍是 `{"asset": {…}}`：资产已置 `complete`、`hash_verified=true` 且 `size_bytes` 用实际读回字节数。

资产已是 `complete` 时重复提交直接返回同一结构并加 `already_complete: true`（不再合并与回读）。
`upload_id` 省略时使用该资产已记录的分片会话。

本地对象模式下内容已在 `PUT /api/storage/upload/stream/{asset_id}` 边收边算并校验（摘要不符在那里就返回 `409 hash_mismatch`），complete 只做幂等确认。

::: tip 大文件优先的做法
走服务端流式 `PUT /api/storage/upload/stream/{asset_id}`（边收边算，没有二次回读成本），
或分片上传并在 complete 前用 `POST /api/storage/verify-hash`（带 `asset_id`）先自检一次，提前发现内容不符。
:::

::: warning 职责边界：原始文件
存储服务收原始文件、按权限分发原始文件。HLS 切片、预览音频、波形图、雪碧图由客户端拿原档自行处理。
:::

## 绑定与解绑

```http
POST /api/storage/bind
Authorization: Bearer <token>

{ "asset_id": "<uuid>", "target_entity_id": "<uuid>", "binding_role": "track_audio" }

DELETE /api/storage/bindings/{binding_id}
```

绑定表达的是"这份文件是谁的什么用途"；收录位置（页码、时间码、路径）留在目录侧的 `locator`，两处不重复。

同一 `(asset, entity, role)` 只保留一条。解绑用于纠错，绑定创建者、文件上传者或审核者（持 `storage.asset.moderate`）都可以操作。

## 查询与下载

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/storage/entities/{id}/files` | 实体可见 | 「这个介质/轨道/表达上挂了哪些文件」入口 |
| GET | `/api/storage/assets/{id}` | 可读 | 文件元数据与绑定列表 |
| GET | `/api/storage/download/{asset_id}` | 可读 | 对象存储模式返回预签名地址；本地模式直接流式下发 |
| GET | `/api/storage/assets/{id}/content` | 可读 | 长期可引用的原档内联地址 |
| POST | `/api/storage/verify-hash` | 探测匿名可用；按 asset 校验需登录 | 秒传探测或按 asset 校验摘要 |
| GET | `/api/storage/stats` | 审核者 | 完成态文件数与占用字节、待完成数、禁发数（`storage.asset.moderate`） |
| GET | `/api/storage/moderation/blocked?limit=100&offset=0` | 审核者 | 禁发资产清单；`limit` 范围 1–500，默认 100，按禁发时间倒序 |
| POST | `/api/storage/assets/{id}/block` | 审核者 | 禁发资产，可传 JSON `{"reason":"处置原因"}`（最多 280 字） |
| POST | `/api/storage/assets/{id}/unblock` | 审核者 | 解除禁发，保留资产状态与绑定 |

`/stats` 返回 `{ "assets": 0, "bytes": 0, "pending": 0, "blocked": 0 }`。禁发清单返回 `{ "assets": [...], "limit": 100, "offset": 0 }`；资产对象含 `blocked`、`blocked_reason`、`blocked_at`。

`/api/storage/assets/{id}/content` 的补充说明：对象存储模式下预签名地址的主机对浏览器不可达且会过期，
目录侧引用外部图片时改用本端点（原样下发，不转码；按请求判可见性，只进私有缓存）。

`verify-hash` 的两种分支：

- `sha256_hash` 探测：判定与 `initiate` 同一口径，只认服务端验过内容（`hash_verified=true`）且对调用者可见的资产；命中返回 `{"exists": true, "asset_id": …, "status": "complete", "size_bytes": …}`，否则 `{"exists": false}`
- `asset_id` 校验：必须登录（匿名返回 `401`，非法 uuid 先返回 `404`），读回整份对象重算摘要，返回 `{"asset_id", "sha256", "declared_sha256", "verified", "size_bytes"}`
- `asset_id` 校验摘要不符时 `verified=false`，尚未发布的资产会被钉在 `pending`（`fail_reason=hash_mismatch`）；已 `complete` 的资产不会因此降级（只记日志）

```http
GET /api/storage/download/{asset_id}

→ { "asset_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", "download_url": "https://…?X-Amz-Signature=…&response-content-disposition=attachment%3B%20filename%3D…",
    "file_name": "track.flac", "size_bytes": 12345678, "sha256": "…", "expires_at": "…" }
```

::: warning 注意
读取可见性只有一条口径：上传者本人或审核者（持 `storage.asset.moderate`）直通，
其余人在资产已 `complete` 时只要任一绑定目标实体可见即可读。
:::

下载、元数据读取与哈希校验共用该判定，同一份文件在各接口的可见性一致。
无可见性时统一返回 404（各原因同码），避免泄露他人上传的存在性。

## 限流与审计

- 上传与下载经网关转发；网关按 IP 对 `/api/` 限流（令牌桶 `30 r/s`），`/api/storage/` 的突发额度放宽到 `burst 100`
- 限流按请求数计、与字节数无关，而分片上传天然是多请求，放宽突发额度是为了不掐正常分片
- 超限由网关直接返回 `429`；网关这一层的 429 不带 `Retry-After`（只有目录服务自身的路由级限流才带该头）
- 目录侧的写入审计按编目流程记录；存储服务的操作审计口径以目标实例响应为准
