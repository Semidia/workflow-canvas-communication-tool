# -*- coding: utf-8 -*-
"""画布工具本地薄后端：静态文件 + 磁盘读写接口。

职责只有两件事：
1. 服务前端目录的静态文件（替代 python -m http.server）。
2. 提供 /api/state 接口，把画布完整状态读写到「工作流导出/画布数据.json」，
   让本机 AI agent 能直接 Read/Edit 这个真实落盘文件（类比 Codex 深度链接的定位文件）。
3. 提供 /api/modules 薄接口，把模块库单独落盘到「工作流导出/模块库.json」
   （kind=workflow-canvas-module-library；不并入画布数据.json）。

写接口分两档（兼容旧整包 POST）：
- POST /api/state                              整包替换 {version, activeCanvasId, canvases}
- POST|PATCH /api/state?canvasId=…             只替换/合并一个画布
- POST|PATCH /api/state?canvasId=…&nodeId=…    只合并单节点字段
- POST|PATCH /api/state?canvasId=…&edgeId=…    只合并单连线字段
- GET|POST /api/modules                        读/写独立模块库文件
细粒度写在进程内用锁做读-改-写，避免 ThreadingHTTPServer 下互相踩踏。
"""
import hashlib
import json
import os
import re
import shutil
import sys
import threading
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "前端")
EXPORT_DIR = os.path.join(ROOT, "工作流导出")
STATE_FILE = os.path.join(EXPORT_DIR, "画布数据.json")
MODULES_FILE = os.path.join(EXPORT_DIR, "模块库.json")
API_PATH = "/api/state"
MODULES_API_PATH = "/api/modules"
MODULES_KIND = "workflow-canvas-module-library"
MAX_BODY_BYTES = 32 * 1024 * 1024
MAX_CANVASES = 100
MAX_NODES_PER_CANVAS = 1000
MAX_EDGES_PER_CANVAS = 4000
MAX_MODULES = 500

_ID_RE = re.compile(r"^[\w-]{1,64}$")
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_MARKER_SET = {"待讨论", "已决定", "有疑问", "不采用"}
_EDGE_WIDTH_SET = {"thin", "medium", "thick"}
_EDGE_SIDES = {"top", "right", "bottom", "left"}
_BRANCH_SET = {"是", "否", "未定"}
_NODE_TYPES = {"rect", "diamond", "circle", "document", "triangle", "text"}

NODE_PATCH_FIELDS = (
    "type", "x", "y", "w", "h", "label", "note", "marker",
    "condition", "exitCondition",
)
EDGE_PATCH_FIELDS = (
    "label", "branch", "fromSide", "toSide", "loop", "width", "color",
    "from", "to",
)
CANVAS_MERGE_FIELDS = ("name", "category", "view")

# 细粒度读-改-写串行化（整包 POST 也走同一把锁，避免与补丁写交错）
_STATE_LOCK = threading.Lock()
# 模块库与画布状态文件不同，独立一把锁即可
_MODULES_LOCK = threading.Lock()


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class CanvasHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND, **kwargs)

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _api_path(self):
        return self.path.split("?")[0].rstrip("/")

    def _is_api(self):
        return self._api_path() == API_PATH

    def _is_modules_api(self):
        return self._api_path() == MODULES_API_PATH

    def _is_local_request(self):
        host = self.headers.get("Host", "")
        hostname = host.rsplit(":", 1)[0] if ":" in host else host
        if hostname not in ("127.0.0.1", "localhost"):
            return False
        origin = self.headers.get("Origin")
        if origin:
            o = urlparse(origin)
            if o.hostname not in ("127.0.0.1", "localhost"):
                return False
        return True

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    @staticmethod
    def _file_meta(path):
        """mtime/ETag 元数据：判断磁盘是否被外部（AI/编辑器）改过。"""
        st = os.stat(path)
        mtime_ms = int(st.st_mtime * 1000)
        with open(path, "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()[:16]
        etag = f'"{st.st_mtime_ns}-{st.st_size}-{digest}"'
        return {
            "mtime": mtime_ms,
            "mtimeIso": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
            "etag": etag,
            "size": st.st_size,
        }

    def _state_meta(self):
        return self._file_meta(STATE_FILE)

    def _modules_meta(self):
        return self._file_meta(MODULES_FILE)

    def _read_state_unlocked(self):
        if not os.path.exists(STATE_FILE):
            raise ApiError("尚无磁盘保存", 404)
        try:
            with open(STATE_FILE, "r", encoding="utf-8-sig") as f:
                data = json.load(f)
        except (OSError, ValueError) as exc:
            raise ApiError(f"读取磁盘文件失败：{exc}", 500) from exc
        if not isinstance(data, dict) or not isinstance(data.get("canvases"), list):
            raise ApiError("磁盘文件结构非法：缺少 canvases 数组", 500)
        return data

    def _write_state_unlocked(self, data):
        tmp = None
        try:
            os.makedirs(EXPORT_DIR, exist_ok=True)
            if os.path.exists(STATE_FILE):
                shutil.copy2(STATE_FILE, STATE_FILE + ".bak")
            tmp = f"{STATE_FILE}.{os.getpid()}.{threading.get_ident()}.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, STATE_FILE)
        except OSError as exc:
            raise ApiError(f"写入磁盘文件失败：{exc}", 500) from exc
        finally:
            if tmp and os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass

    @staticmethod
    def _validate_full_state(data):
        if not isinstance(data, dict) or not isinstance(data.get("canvases"), list):
            raise ApiError("数据缺少 canvases 数组")
        if len(data["canvases"]) > MAX_CANVASES:
            raise ApiError("画布数量超限")
        for c in data["canvases"]:
            if not isinstance(c, dict):
                raise ApiError("画布数据格式非法")
            if not isinstance(c.get("nodes"), list) or not isinstance(c.get("edges"), list):
                raise ApiError("画布缺少 nodes/edges 数组")

    @staticmethod
    def _read_modules_unlocked():
        if not os.path.exists(MODULES_FILE):
            raise ApiError("尚无模块库磁盘保存", 404)
        try:
            with open(MODULES_FILE, "r", encoding="utf-8-sig") as f:
                data = json.load(f)
        except (OSError, ValueError) as exc:
            raise ApiError(f"读取模块库文件失败：{exc}", 500) from exc
        CanvasHandler._validate_module_library(data)
        return data

    @staticmethod
    def _write_modules_unlocked(data):
        tmp = None
        try:
            os.makedirs(EXPORT_DIR, exist_ok=True)
            if os.path.exists(MODULES_FILE):
                shutil.copy2(MODULES_FILE, MODULES_FILE + ".bak")
            tmp = f"{MODULES_FILE}.{os.getpid()}.{threading.get_ident()}.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, MODULES_FILE)
        except OSError as exc:
            raise ApiError(f"写入模块库文件失败：{exc}", 500) from exc
        finally:
            if tmp and os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass

    @staticmethod
    def _validate_module_library(data):
        if not isinstance(data, dict):
            raise ApiError("模块库必须是 JSON 对象")
        if data.get("kind") != MODULES_KIND:
            raise ApiError(f"kind 必须是 {MODULES_KIND}")
        modules = data.get("modules")
        if not isinstance(modules, list):
            raise ApiError("缺少 modules 数组")
        if len(modules) > MAX_MODULES:
            raise ApiError("模块数量超限")
        for m in modules:
            if not isinstance(m, dict):
                raise ApiError("模块条目必须是对象")
            mid = m.get("id")
            name = m.get("name")
            nodes = m.get("nodes")
            edges = m.get("edges", [])
            if not isinstance(mid, str) or not mid:
                raise ApiError("模块缺少 id")
            if not isinstance(name, str) or not name.strip():
                raise ApiError("模块缺少 name")
            if not isinstance(nodes, list) or not nodes:
                raise ApiError("模块缺少 nodes 数组")
            if not isinstance(edges, list):
                raise ApiError("模块 edges 必须是数组")
            for n in nodes:
                if not isinstance(n, dict) or not isinstance(n.get("id"), str) or not n.get("id"):
                    raise ApiError("模块节点格式非法")
            node_ids = {n.get("id") for n in nodes}
            for e in edges:
                if not isinstance(e, dict):
                    raise ApiError("模块连线格式非法")
                if e.get("from") not in node_ids or e.get("to") not in node_ids:
                    raise ApiError("模块连线端点不在该模块 nodes 内")
        version = data.get("version", 1)
        if not isinstance(version, int) or isinstance(version, bool) or version < 1:
            raise ApiError("version 必须是正整数")
        exported_at = data.get("exportedAt", 0)
        if not isinstance(exported_at, (int, float)) or isinstance(exported_at, bool):
            raise ApiError("exportedAt 必须是数字")

    @classmethod
    def _normalize_module_library(cls, data):
        cls._validate_module_library(data)
        return {
            "kind": MODULES_KIND,
            "version": int(data.get("version", 1)),
            "exportedAt": data.get("exportedAt", 0),
            "modules": data["modules"],
        }

    @staticmethod
    def _coerce_number(value):
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                return None
        return None

    @classmethod
    def _sanitize_node_patch(cls, body):
        if not isinstance(body, dict):
            raise ApiError("节点补丁必须是 JSON 对象")
        unknown = [k for k in body if k not in NODE_PATCH_FIELDS]
        if unknown:
            raise ApiError(f"节点不支持的字段：{', '.join(sorted(unknown))}")
        if not body:
            raise ApiError("节点补丁为空")
        patch = {}
        if "type" in body:
            if body["type"] not in _NODE_TYPES:
                raise ApiError(f"非法节点 type：{body['type']}")
            patch["type"] = body["type"]
        for key in ("x", "y", "w", "h"):
            if key in body:
                num = cls._coerce_number(body[key])
                if num is None:
                    raise ApiError(f"字段 {key} 必须是数字")
                patch[key] = num
        if "label" in body:
            if not isinstance(body["label"], str):
                raise ApiError("label 必须是字符串")
            patch["label"] = body["label"].strip() or "未命名节点"
        if "note" in body:
            if not isinstance(body["note"], str):
                raise ApiError("note 必须是字符串")
            patch["note"] = body["note"]
        if "marker" in body:
            if body["marker"] not in _MARKER_SET:
                raise ApiError(f"非法 marker：{body['marker']}")
            patch["marker"] = body["marker"]
        for key in ("condition", "exitCondition"):
            if key in body:
                if not isinstance(body[key], str):
                    raise ApiError(f"{key} 必须是字符串")
                patch[key] = body[key]
        return patch

    @classmethod
    def _sanitize_edge_patch(cls, body):
        if not isinstance(body, dict):
            raise ApiError("连线补丁必须是 JSON 对象")
        unknown = [k for k in body if k not in EDGE_PATCH_FIELDS]
        if unknown:
            raise ApiError(f"连线不支持的字段：{', '.join(sorted(unknown))}")
        if not body:
            raise ApiError("连线补丁为空")
        patch = {}
        for key in ("from", "to"):
            if key in body:
                if not isinstance(body[key], str) or not _ID_RE.match(body[key]):
                    raise ApiError(f"字段 {key} 必须是合法 id")
                patch[key] = body[key]
        if "label" in body:
            if not isinstance(body["label"], str):
                raise ApiError("label 必须是字符串")
            patch["label"] = body["label"]
        if "branch" in body:
            if body["branch"] not in _BRANCH_SET and body["branch"] != "":
                raise ApiError(f"非法 branch：{body['branch']}")
            patch["branch"] = body["branch"]
        for key in ("fromSide", "toSide"):
            if key in body:
                if body[key] not in _EDGE_SIDES and body[key] != "":
                    raise ApiError(f"非法 {key}：{body[key]}")
                patch[key] = body[key]
        if "loop" in body:
            if not isinstance(body["loop"], bool):
                raise ApiError("loop 必须是布尔值")
            patch["loop"] = body["loop"]
        if "width" in body:
            if body["width"] not in _EDGE_WIDTH_SET:
                raise ApiError(f"非法 width：{body['width']}")
            patch["width"] = body["width"]
        if "color" in body:
            color = body["color"]
            if color != "" and not (isinstance(color, str) and _HEX_COLOR_RE.match(color)):
                raise ApiError("color 必须是 #RRGGBB 或空字符串")
            patch["color"] = color
        return patch

    @classmethod
    def _validate_canvas_payload(cls, canvas):
        if not isinstance(canvas, dict):
            raise ApiError("画布数据格式非法")
        if "nodes" in canvas and not isinstance(canvas["nodes"], list):
            raise ApiError("画布缺少 nodes 数组")
        if "edges" in canvas and not isinstance(canvas["edges"], list):
            raise ApiError("画布缺少 edges 数组")
        if isinstance(canvas.get("nodes"), list) and len(canvas["nodes"]) > MAX_NODES_PER_CANVAS:
            raise ApiError("节点数量超限")
        if isinstance(canvas.get("edges"), list) and len(canvas["edges"]) > MAX_EDGES_PER_CANVAS:
            raise ApiError("连线数量超限")
        for node in canvas.get("nodes") or []:
            if not isinstance(node, dict):
                raise ApiError("节点数据格式非法")
            nid = node.get("id")
            if not isinstance(nid, str) or not _ID_RE.match(nid):
                raise ApiError("节点缺少合法 id")
        for edge in canvas.get("edges") or []:
            if not isinstance(edge, dict):
                raise ApiError("连线数据格式非法")
            eid = edge.get("id")
            if not isinstance(eid, str) or not _ID_RE.match(eid):
                raise ApiError("连线缺少合法 id")

    @staticmethod
    def _find_canvas(state, canvas_id):
        for idx, canvas in enumerate(state.get("canvases") or []):
            if isinstance(canvas, dict) and canvas.get("id") == canvas_id:
                return idx, canvas
        return None, None

    @classmethod
    def _apply_canvas_write(cls, state, canvas_id, body):
        if not isinstance(canvas_id, str) or not _ID_RE.match(canvas_id):
            raise ApiError("canvasId 非法（需匹配 [\\w-]{1,64}）")
        if not isinstance(body, dict):
            raise ApiError("画布补丁必须是 JSON 对象")
        payload = body.get("canvas") if isinstance(body.get("canvas"), dict) else body
        cls._validate_canvas_payload(payload)
        has_nodes = isinstance(payload.get("nodes"), list)
        has_edges = isinstance(payload.get("edges"), list)
        has_merge_fields = any(k in payload for k in CANVAS_MERGE_FIELDS)
        if not (has_nodes or has_edges or has_merge_fields):
            raise ApiError("画布补丁为空（需 name/category/view/nodes/edges 之一）")

        idx, existing = cls._find_canvas(state, canvas_id)
        if idx is None:
            if len(state["canvases"]) >= MAX_CANVASES:
                raise ApiError("画布数量超限")
            name = payload.get("name")
            category = payload.get("category")
            canvas = {
                "id": canvas_id,
                "name": str(name)[:80] if isinstance(name, str) and name else canvas_id,
                "category": str(category)[:40] if isinstance(category, str) else "",
                "nodes": payload["nodes"] if has_nodes else [],
                "edges": payload["edges"] if has_edges else [],
                "view": payload["view"] if isinstance(payload.get("view"), dict)
                else {"zoom": 1, "panX": 0, "panY": 0},
            }
            state["canvases"].append(canvas)
            return "canvas-created", canvas

        if has_nodes or has_edges:
            # 整画布替换：以已有画布为底，覆盖 body 给出的部分
            canvas = dict(existing)
            canvas["id"] = canvas_id
            if has_nodes:
                canvas["nodes"] = payload["nodes"]
            if has_edges:
                canvas["edges"] = payload["edges"]
            for key in CANVAS_MERGE_FIELDS:
                if key not in payload:
                    continue
                value = payload[key]
                if key == "view" and not isinstance(value, dict):
                    raise ApiError("view 必须是对象")
                if key in ("name", "category") and not isinstance(value, str):
                    raise ApiError(f"{key} 必须是字符串")
                canvas[key] = value
            if not isinstance(canvas.get("name"), str) or not canvas["name"]:
                canvas["name"] = canvas_id
            if not isinstance(canvas.get("category"), str):
                canvas["category"] = ""
            if not isinstance(canvas.get("view"), dict):
                canvas["view"] = {"zoom": 1, "panX": 0, "panY": 0}
            state["canvases"][idx] = canvas
            return "canvas-replaced", canvas

        # 纯字段合并（不带 nodes/edges）
        for key in CANVAS_MERGE_FIELDS:
            if key not in payload:
                continue
            value = payload[key]
            if key == "view" and not isinstance(value, dict):
                raise ApiError("view 必须是对象")
            if key in ("name", "category") and not isinstance(value, str):
                raise ApiError(f"{key} 必须是字符串")
            existing[key] = value
        return "canvas-merged", existing

    @classmethod
    def _apply_node_write(cls, state, canvas_id, node_id, body):
        if not isinstance(canvas_id, str) or not _ID_RE.match(canvas_id):
            raise ApiError("canvasId 非法")
        if not isinstance(node_id, str) or not _ID_RE.match(node_id):
            raise ApiError("nodeId 非法")
        _idx, canvas = cls._find_canvas(state, canvas_id)
        if canvas is None:
            raise ApiError(f"找不到画布：{canvas_id}", 404)
        node = None
        for candidate in canvas.get("nodes") or []:
            if isinstance(candidate, dict) and candidate.get("id") == node_id:
                node = candidate
                break
        if node is None:
            raise ApiError(f"找不到节点：{node_id}", 404)
        patch_body = body.get("node") if isinstance(body.get("node"), dict) else body
        patch = cls._sanitize_node_patch(patch_body)
        for key, value in patch.items():
            if key in ("x", "y", "w", "h"):
                node[key] = int(round(value)) if float(value).is_integer() else value
            else:
                node[key] = value
        return "node-updated", canvas

    @classmethod
    def _apply_edge_write(cls, state, canvas_id, edge_id, body):
        if not isinstance(canvas_id, str) or not _ID_RE.match(canvas_id):
            raise ApiError("canvasId 非法")
        if not isinstance(edge_id, str) or not _ID_RE.match(edge_id):
            raise ApiError("edgeId 非法")
        _idx, canvas = cls._find_canvas(state, canvas_id)
        if canvas is None:
            raise ApiError(f"找不到画布：{canvas_id}", 404)
        edge = None
        for candidate in canvas.get("edges") or []:
            if isinstance(candidate, dict) and candidate.get("id") == edge_id:
                edge = candidate
                break
        if edge is None:
            raise ApiError(f"找不到连线：{edge_id}", 404)
        patch_body = body.get("edge") if isinstance(body.get("edge"), dict) else body
        patch = cls._sanitize_edge_patch(patch_body)
        if "from" in patch or "to" in patch:
            node_ids = {n.get("id") for n in (canvas.get("nodes") or []) if isinstance(n, dict)}
            for key in ("from", "to"):
                if key in patch and patch[key] not in node_ids:
                    raise ApiError(f"连线端点 {key} 不存在：{patch[key]}")
        edge.update(patch)
        return "edge-updated", canvas

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY_BYTES:
            raise ApiError("请求体过大或长度非法", 413)
        body = self.rfile.read(length) if length else b""
        if not body:
            raise ApiError("请求体为空")
        try:
            return json.loads(body.decode("utf-8-sig"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise ApiError(f"JSON 解析失败：{exc}") from exc

    def _respond_written(self, updated, extra=None):
        try:
            meta = self._state_meta()
        except OSError:
            meta = {}
        payload = {"ok": True, "file": STATE_FILE, "updated": updated, **meta}
        if extra:
            payload.update(extra)
        return self._send_json(payload)

    def _handle_write(self):
        if not self._is_api():
            return self._send_json({"ok": False, "error": "未知接口"}, 404)
        if not self._is_local_request():
            return self._send_json({"ok": False, "error": "禁止跨源访问"}, 403)
        try:
            data = self._read_body()
            qs = parse_qs(urlparse(self.path).query)
            canvas_id = (qs.get("canvasId") or [""])[0]
            node_id = (qs.get("nodeId") or [""])[0]
            edge_id = (qs.get("edgeId") or [""])[0]

            if canvas_id and node_id and edge_id:
                raise ApiError("nodeId 与 edgeId 不能同时出现")

            if canvas_id and (node_id or edge_id):
                with _STATE_LOCK:
                    state = self._read_state_unlocked()
                    if node_id:
                        updated, canvas = self._apply_node_write(state, canvas_id, node_id, data)
                    else:
                        updated, canvas = self._apply_edge_write(state, canvas_id, edge_id, data)
                    self._validate_full_state(state)
                    self._write_state_unlocked(state)
                return self._respond_written(
                    updated,
                    {
                        "canvasId": canvas_id,
                        "nodeId": node_id or None,
                        "edgeId": edge_id or None,
                        "canvasNodeCount": len(canvas.get("nodes") or []),
                        "canvasEdgeCount": len(canvas.get("edges") or []),
                    },
                )

            if canvas_id:
                with _STATE_LOCK:
                    if os.path.exists(STATE_FILE):
                        state = self._read_state_unlocked()
                    else:
                        state = {"version": 1, "activeCanvasId": canvas_id, "canvases": []}
                    updated, canvas = self._apply_canvas_write(state, canvas_id, data)
                    if not state.get("activeCanvasId"):
                        state["activeCanvasId"] = canvas_id
                    self._validate_full_state(state)
                    self._write_state_unlocked(state)
                return self._respond_written(
                    updated,
                    {
                        "canvasId": canvas_id,
                        "canvasNodeCount": len(canvas.get("nodes") or []),
                        "canvasEdgeCount": len(canvas.get("edges") or []),
                    },
                )

            # 整包兼容路径
            self._validate_full_state(data)
            with _STATE_LOCK:
                self._write_state_unlocked(data)
            return self._respond_written("full")
        except ApiError as exc:
            return self._send_json({"ok": False, "error": str(exc)}, exc.status)

    def _handle_modules_get(self):
        if not self._is_local_request():
            return self._send_json({"ok": False, "error": "禁止跨源访问"}, 403)
        try:
            with _MODULES_LOCK:
                if not os.path.exists(MODULES_FILE):
                    return self._send_json(
                        {"ok": False, "error": "尚无模块库磁盘保存", "file": MODULES_FILE}, 404
                    )
                library = self._read_modules_unlocked()
                meta = self._modules_meta()
            return self._send_json({"ok": True, "library": library, "file": MODULES_FILE, **meta})
        except ApiError as exc:
            return self._send_json({"ok": False, "error": str(exc)}, exc.status)

    def _handle_modules_write(self):
        if not self._is_local_request():
            return self._send_json({"ok": False, "error": "禁止跨源访问"}, 403)
        try:
            data = self._read_body()
            library = self._normalize_module_library(data)
            with _MODULES_LOCK:
                self._write_modules_unlocked(library)
                meta = self._modules_meta()
            return self._send_json(
                {
                    "ok": True,
                    "file": MODULES_FILE,
                    "updated": "modules",
                    "count": len(library["modules"]),
                    **meta,
                }
            )
        except ApiError as exc:
            return self._send_json({"ok": False, "error": str(exc)}, exc.status)

    def do_GET(self):
        if self._is_modules_api():
            return self._handle_modules_get()
        if self._is_api():
            if not self._is_local_request():
                return self._send_json({"ok": False, "error": "禁止跨源访问"}, 403)
            if not os.path.exists(STATE_FILE):
                return self._send_json(
                    {"ok": False, "error": "尚无磁盘保存", "file": STATE_FILE}, 404
                )
            parsed_path = urlparse(self.path)
            want_meta = parse_qs(parsed_path.query).get("meta", [""])[0] in ("1", "true", "yes")
            try:
                meta = self._state_meta()
                if want_meta:
                    return self._send_json({"ok": True, "file": STATE_FILE, **meta})
                with open(STATE_FILE, "r", encoding="utf-8-sig") as f:
                    data = json.load(f)
            except (OSError, ValueError) as exc:
                return self._send_json(
                    {"ok": False, "error": f"读取磁盘文件失败：{exc}", "file": STATE_FILE}, 500
                )
            return self._send_json(
                {"ok": True, "state": data, "file": STATE_FILE, **meta}
            )
        return super().do_GET()

    def do_POST(self):
        if self._is_modules_api():
            return self._handle_modules_write()
        return self._handle_write()

    def do_PATCH(self):
        # PATCH 语义与带 query 的 POST 细粒度写一致；必须带 canvasId
        if not self._is_api():
            return self._send_json({"ok": False, "error": "未知接口"}, 404)
        if not self._is_local_request():
            return self._send_json({"ok": False, "error": "禁止跨源访问"}, 403)
        qs = parse_qs(urlparse(self.path).query)
        if not (qs.get("canvasId") or [""])[0]:
            return self._send_json(
                {"ok": False, "error": "PATCH 需要 canvasId 查询参数"}, 400
            )
        return self._handle_write()


def main():
    port = 4173
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            port = 4173
    server = ThreadingHTTPServer(("127.0.0.1", port), CanvasHandler)
    print(f"画布服务已启动：http://127.0.0.1:{port}/index.html")
    print(f"数据落盘文件：{STATE_FILE}")
    server.serve_forever()


if __name__ == "__main__":
    main()
