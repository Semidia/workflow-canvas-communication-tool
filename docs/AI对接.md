# AI 对接：本地 `/api/state` 与 `/api/modules`

> 只服务本机 `127.0.0.1`，无鉴权、不上云。路径与示例全部 **ASCII**，便于脚本直接粘贴。

## 端点

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/api/state` | 读完整状态 `{ok, state, file, mtime, etag, size}` |
| GET | `/api/state?meta=1` | 只读元数据 `{ok, file, mtime, etag, size, mtimeIso}`（页面轮询用） |
| POST | `/api/state` | **整包**写入 `{version, activeCanvasId, canvases}`（兼容旧客户端），返回带 `mtime/etag` |
| POST | `/api/state?canvasId=ID` | **单画布**写入：body 为画布对象；带 `nodes/edges` 则替换该画布，否则只合并 `name/category/view` |
| PATCH | `/api/state?canvasId=ID` | 同上（必须带 `canvasId`） |
| POST | `/api/state?canvasId=ID&nodeId=NID` | **单节点字段**合并：body 为字段对象（如 `{"label":"..."}`） |
| PATCH | `/api/state?canvasId=ID&nodeId=NID` | 同上 |
| POST | `/api/state?canvasId=ID&edgeId=EID` | **单连线字段**合并 |
| PATCH | `/api/state?canvasId=ID&edgeId=EID` | 同上 |
| GET | `/api/modules` | 读模块库 `{ok, library, file, mtime, etag, size}`（无文件 → 404） |
| POST | `/api/modules` | 写模块库 payload（`kind=workflow-canvas-module-library`），**不**并入画布数据.json |

写成功响应统一为：

```json
{ "ok": true, "file": "...", "updated": "full|canvas-replaced|canvas-created|canvas-merged|node-updated|edge-updated", "mtime": 0, "etag": "\"...\"", "size": 0, "canvasId": null, "nodeId": null, "edgeId": null }
```

细粒度写在服务进程内加锁做读-改-写，不会整包覆盖其它画布。

磁盘文件（本机绝对路径含中文，**推荐走 HTTP 而不是直接拼中文路径**）：

```text
工作流导出/画布数据.json
工作流导出/模块库.json
```

模块库 payload（与浏览器「导出模块库」同形）：

```json
{
  "kind": "workflow-canvas-module-library",
  "version": 1,
  "exportedAt": 0,
  "modules": [ { "id": "…", "name": "…", "createdAt": 0, "nodes": [], "edges": [] } ]
}
```

前端 `saveModules()`：先写 localStorage，再 **fire-and-forget** `POST /api/modules`（失败不打断 UI）。启动时若本地模块库为空且磁盘有稿，`restoreModulesFromDisk` 会恢复。**首版不做模块 ETag 轮询**；画布 `statePayloadForAI` / `画布数据.json` **仍不含** `modules`。

## curl

```bash
# 读完整状态
curl -sS http://127.0.0.1:4173/api/state

# 只看是否被外部改过（mtime / etag）
curl -sS "http://127.0.0.1:4173/api/state?meta=1"

# 整包写回（body 必须含 canvases 数组）——兼容旧路径
curl -sS -X POST http://127.0.0.1:4173/api/state \
  -H "Content-Type: application/json" \
  --data-binary @state.json

# 只替换一个画布（其它画布不动）
curl -sS -X POST "http://127.0.0.1:4173/api/state?canvasId=canvas-main" \
  -H "Content-Type: application/json" \
  --data-binary @one-canvas.json

# 只改一个节点的字段
curl -sS -X PATCH "http://127.0.0.1:4173/api/state?canvasId=canvas-main&nodeId=node-a" \
  -H "Content-Type: application/json" \
  -d '{"label":"核对材料","marker":"已决定"}'

# 只改一条连线
curl -sS -X PATCH "http://127.0.0.1:4173/api/state?canvasId=canvas-main&edgeId=edge-1" \
  -H "Content-Type: application/json" \
  -d '{"loop":true,"branch":"是"}'

# 读模块库
curl -sS http://127.0.0.1:4173/api/modules

# 写模块库（独立文件，不碰画布数据.json）
curl -sS -X POST http://127.0.0.1:4173/api/modules \
  -H "Content-Type: application/json" \
  --data-binary @modules.json
```

## Node

```js
// 读
const r = await fetch("http://127.0.0.1:4173/api/state");
const { ok, state, etag } = await r.json();
console.log(ok, state.canvases.length, etag);

// 轮询元数据
const m = await (await fetch("http://127.0.0.1:4173/api/state?meta=1")).json();
console.log(m.mtime, m.etag);

// 整包写（兼容）
await fetch("http://127.0.0.1:4173/api/state", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(state),
});

// 只写一个画布
await fetch("http://127.0.0.1:4173/api/state?canvasId=canvas-main", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(state.canvases[0]),
});

// 只改节点字段
await fetch(
  "http://127.0.0.1:4173/api/state?canvasId=canvas-main&nodeId=node-a",
  {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "核对材料", x: 120 }),
  }
);

// 读模块库（独立文件）
const mr = await fetch("http://127.0.0.1:4173/api/modules");
const mlib = await mr.json();
console.log(mlib.ok, mlib.library?.modules?.length, mlib.file);

// 写模块库
await fetch("http://127.0.0.1:4173/api/modules", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    kind: "workflow-canvas-module-library",
    version: 1,
    exportedAt: Date.now(),
    modules: [],
  }),
});
```

### 节点可合并字段

`type` `x` `y` `w` `h` `label` `note` `marker` `condition` `exitCondition`

- `marker` ∈ `待讨论 | 已决定 | 有疑问 | 不采用`
- `type` ∈ `rect | diamond | circle | document | triangle | text`
- 未知字段 → `400`

### 连线可合并字段

`label` `branch` `from` `to` `fromSide` `toSide` `loop` `width` `color`

### 画布 body

- 含 `nodes` 和/或 `edges` → 替换该画布对应数组（缺省的一侧保留原值）
- 仅 `name` / `category` / `view` → 字段合并
- 目标 `canvasId` 不存在 → 创建新画布（upsert）

### 模块库 body（`POST /api/modules`）

- 必须 `kind === "workflow-canvas-module-library"` 且 `modules` 为数组
- 条目至少含 `id` / `name` / 非空 `nodes`；`edges[].from|to` 必须落在该模块 `nodes` 内
- 成功写入 `工作流导出/模块库.json`（原子替换 + `.bak`）；**不写** `画布数据.json`

## 约定

- 页面每 4s 轮询 `?meta=1`：`etag` 变了 → 状态栏「磁盘已更新」+「磁盘已更新，点击重载」。
- **本页干净**（无未保存草稿、无进行中手势）时，约 0.8s 后**自动重载**；有草稿则只提示一键重载，绝不静默覆盖。
- 外部改盘时**不会**静默覆盖浏览器草稿；`persistToDiskSilent` 在 `diskOutOfSync` 时会先不写盘。
- 校验：`ok === true` 且（读时）`state.canvases` 为非空数组。
- 模块库：本地非空时**本地优先**（启动不覆盖）；本地空才从磁盘恢复。画布 ETag 轮询**不**覆盖模块。

## 自测

```bash
python 后端/test_api_state.py
python 后端/test_api_modules.py
```
