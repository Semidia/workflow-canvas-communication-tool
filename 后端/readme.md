# 后端目录

当前版本没有业务后端、数据库、模型 API 或云端服务，只有一层「本地薄后端」，负责静态文件 + 磁盘落盘两件事。

## 本目录内容

- `启动画布工具.ps1`：由上一级的 `启动画布工具.bat` 调用，启动本地 HTTP 服务（**唯一正式入口是根目录的 bat**，不要直接开 `前端\index.html`）。若默认端口被其他程序占用，会自动尝试下一个端口；若检测到已经运行的画布，会询问“终止并重启”或“打开现有画布”。
- `canvas_server.py`：本地薄后端。在 `前端` 目录上提供静态文件（替代 `python -m http.server`），并额外提供 `/api/state` 接口，把画布状态读写到 `工作流导出/画布数据.json`（整包 POST + 按 `canvasId`/`nodeId`/`edgeId` 的细粒度 POST/PATCH）。
- `test_api_state.py`：临时目录起服务的 API 自测（整包兼容、单画布、单节点、单连线、并发）。

## canvas_server.py 做了什么

- 静态文件：服务 `前端/` 下的 `index.html`、`app.js`、`styles.css` 等，并统一加 `Cache-Control: no-store`，避免开发期改完代码浏览器仍用旧缓存。
- `/api/state`：
  - `GET`：读取 `工作流导出/画布数据.json`，返回 `{ok, state, file, mtime, etag, size, mtimeIso}`。
  - `GET ?meta=1`：只返回元数据（不含 `state`），供页面每 4s 轮询是否被外部改盘。
  - `POST`：整包写入 `{version, activeCanvasId, canvases}`（原子写：先写 `.tmp` 再 `os.replace`），响应带 `mtime/etag` 与 `updated:"full"`。
  - `POST|PATCH ?canvasId=`：只替换/合并一个画布，其它画布不动。
  - `POST|PATCH ?canvasId=&nodeId=`：只合并单节点字段；`?edgeId=` 同理合并连线字段。
  - 细粒度读-改-写在进程锁内完成，避免多线程互相覆盖。
  - 示例见 `docs/AI对接.md`（ASCII 路径 curl/node）。
- 用 `ThreadingHTTPServer`（不是单线程 `HTTPServer`），避免一个慢请求阻塞后续连接。

这个落盘文件的用途是让本机 AI agent 能直接 `Read/Edit` 真实文件，再让页面「从磁盘加载」回写画布（类比 Codex 深度链接的定位文件）。它不是多用户服务，也没有鉴权，只绑定 `127.0.0.1` 本地回环。

以后如果增加真实后端，应在本目录建立独立服务入口、配置说明和测试，不要把后端代码混入 `前端`。
