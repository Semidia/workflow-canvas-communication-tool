# AI 对接：本地 `/api/state`

> 只服务本机 `127.0.0.1`，无鉴权、不上云。路径与示例全部 **ASCII**，便于脚本直接粘贴。

## 端点

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/api/state` | 读完整状态 `{ok, state, file, mtime, etag, size}` |
| GET | `/api/state?meta=1` | 只读元数据 `{ok, file, mtime, etag, size, mtimeIso}`（页面轮询用） |
| POST | `/api/state` | 写入 `{version, activeCanvasId, canvases}`，返回同样带 `mtime/etag` |

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

# 写回（body 必须含 canvases 数组）
curl -sS -X POST http://127.0.0.1:4173/api/state \
  -H "Content-Type: application/json" \
  --data-binary @state.json
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

// 写
await fetch("http://127.0.0.1:4173/api/state", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(state),
});
```

## 约定

- 页面每 4s 轮询 `?meta=1`：`etag` 变了 → 状态栏「不一致」+「磁盘已更新，点击重载」→ 按钮调 `loadFromDisk()`。
- 外部改盘时**不会**静默覆盖浏览器草稿；`persistToDiskSilent` 在 `diskOutOfSync` 时会先不写盘。
- 校验：`ok === true` 且（读时）`state.canvases` 为非空数组。
