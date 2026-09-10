# -*- coding: utf-8 -*-
"""画布工具本地薄后端：静态文件 + 磁盘读写接口。

职责只有两件事：
1. 服务前端目录的静态文件（替代 python -m http.server）。
2. 提供 /api/state 接口，把画布完整状态读写到「工作流导出/画布数据.json」，
   让本机 AI agent 能直接 Read/Edit 这个真实落盘文件（类比 Codex 深度链接的定位文件）。
"""
import json
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "前端")
EXPORT_DIR = os.path.join(ROOT, "工作流导出")
STATE_FILE = os.path.join(EXPORT_DIR, "画布数据.json")
API_PATH = "/api/state"


class CanvasHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND, **kwargs)

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _is_api(self):
        return self.path.split("?")[0].rstrip("/") == API_PATH

    def do_GET(self):
        if self._is_api():
            if not os.path.exists(STATE_FILE):
                return self._send_json(
                    {"ok": False, "error": "尚无磁盘保存", "file": STATE_FILE}, 404
                )
            try:
                with open(STATE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except (OSError, ValueError) as exc:
                return self._send_json(
                    {"ok": False, "error": f"读取磁盘文件失败：{exc}", "file": STATE_FILE}, 500
                )
            return self._send_json({"ok": True, "state": data, "file": STATE_FILE})
        return super().do_GET()

    def do_POST(self):
        if not self._is_api():
            return self._send_json({"ok": False, "error": "未知接口"}, 404)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        body = self.rfile.read(length) if length else b""
        if not body:
            return self._send_json({"ok": False, "error": "请求体为空"}, 400)
        try:
            data = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            return self._send_json({"ok": False, "error": f"JSON 解析失败：{exc}"}, 400)
        if not isinstance(data, dict) or not isinstance(data.get("canvases"), list):
            return self._send_json({"ok": False, "error": "数据缺少 canvases 数组"}, 400)
        try:
            os.makedirs(EXPORT_DIR, exist_ok=True)
            tmp = STATE_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, STATE_FILE)
        except OSError as exc:
            return self._send_json(
                {"ok": False, "error": f"写入磁盘文件失败：{exc}", "file": STATE_FILE}, 500
            )
        return self._send_json({"ok": True, "file": STATE_FILE})


def main():
    port = 4173
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            port = 4173
    server = HTTPServer(("127.0.0.1", port), CanvasHandler)
    print(f"画布服务已启动：http://127.0.0.1:{port}/index.html")
    print(f"数据落盘文件：{STATE_FILE}")
    server.serve_forever()


if __name__ == "__main__":
    main()
