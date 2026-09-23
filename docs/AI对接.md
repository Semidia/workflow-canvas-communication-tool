# AI 对接：本地 `/api/state`

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

写成功响应统一为：

```json
{ "ok": true, "file": "...", "updated": "full|canvas-replaced|canvas-created|canvas-merged|node-updated|edge-updated", "mtime": 0, "etag": "\"...\"", "size": 0, "canvasId": null, "nodeId": null, "edgeId": null }
```

细粒度写在服务进程内加锁做读-改-写，不会整包覆盖其它画布。

磁盘文件（本机绝对路径含中文，**推荐走 HTTP 而不是直接拼中文路径**）：

```text
工作流导出/画布数据.json
```

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

## 约定

- 页面每 4s 轮询 `?meta=1`：`etag` 变了 → 状态栏「磁盘已更新」+「磁盘已更新，点击重载」。
- **本页干净**（无未保存草稿、无进行中手势）时，约 0.8s 后**自动重载**；有草稿则只提示一键重载，绝不静默覆盖。
- 外部改盘时**不会**静默覆盖浏览器草稿；`persistToDiskSilent` 在 `diskOutOfSync` 时会先不写盘。
- 校验：`ok === true` 且（读时）`state.canvases` 为非空数组。

## 自测

```bash
python 后端/test_api_state.py
```
