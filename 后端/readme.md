# 后端目录

当前版本没有业务后端、数据库、模型 API 或云端服务，只有一层「本地薄后端」，负责静态文件 + 磁盘落盘两件事。

## 本目录内容

- `启动画布工具.ps1`：由上一级的 `启动画布工具.bat` 调用，启动本地 HTTP 服务。若默认端口被其他程序占用，会自动尝试下一个端口；若检测到已经运行的画布，会询问“终止并重启”或“打开现有画布”。
- `canvas_server.py`：本地薄后端。在 `前端` 目录上提供静态文件（替代 `python -m http.server`），并额外提供 `/api/state` 接口，把画布完整状态读写到 `工作流导出/画布数据.json`。

## canvas_server.py 做了什么

- 静态文件：服务 `前端/` 下的 `index.html`、`app.js`、`styles.css` 等，并统一加 `Cache-Control: no-store`，避免开发期改完代码浏览器仍用旧缓存。
- `/api/state`：
  - `GET`：读取 `工作流导出/画布数据.json`，返回 `{ok, state, file}`。
  - `POST`：把请求体（`{version, activeCanvasId, canvases}`）原子写入同一文件（先写 `.tmp` 再 `os.replace`）。
- 用 `ThreadingHTTPServer`（不是单线程 `HTTPServer`），避免一个慢请求阻塞后续连接。

这个落盘文件的用途是让本机 AI agent 能直接 `Read/Edit` 真实文件，再让页面「从磁盘加载」回写画布（类比 Codex 深度链接的定位文件）。它不是多用户服务，也没有鉴权，只绑定 `127.0.0.1` 本地回环。

以后如果增加真实后端，应在本目录建立独立服务入口、配置说明和测试，不要把后端代码混入 `前端`。
