# -*- coding: utf-8 -*-
"""画布薄后端 /api/state 细粒度写 + 整包兼容 的本地自测。

在临时端口起 canvas_server，跑完即停；不碰仓库里的 工作流导出/画布数据.json
（通过把 STATE_FILE/EXPORT_DIR 指到临时目录——需在 import 后 monkeypatch）。
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import canvas_server  # noqa: E402


def _req(url, data=None, method=None, headers=None):
    body = None
    if data is not None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        headers = dict(headers or {})
        headers.setdefault("Content-Type", "application/json; charset=utf-8")
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            return exc.code, json.loads(raw)
        except ValueError:
            return exc.code, {"raw": raw}


def main():
    tmp = tempfile.mkdtemp(prefix="canvas-api-test-")
    export_dir = os.path.join(tmp, "工作流导出")
    state_file = os.path.join(export_dir, "画布数据.json")
    os.makedirs(export_dir, exist_ok=True)
    canvas_server.EXPORT_DIR = export_dir
    canvas_server.STATE_FILE = state_file

    seed = {
        "version": 1,
        "activeCanvasId": "canvas-main",
        "canvases": [
            {
                "id": "canvas-main",
                "name": "主画布",
                "category": "",
                "nodes": [
                    {
                        "id": "node-a",
                        "type": "rect",
                        "x": 10,
                        "y": 20,
                        "w": 176,
                        "h": 92,
                        "label": "A",
                        "note": "na",
                        "marker": "待讨论",
                        "condition": "",
                        "exitCondition": "",
                    },
                    {
                        "id": "node-b",
                        "type": "diamond",
                        "x": 200,
                        "y": 20,
                        "w": 112,
                        "h": 112,
                        "label": "B",
                        "note": "",
                        "marker": "已决定",
                        "condition": "ok?",
                        "exitCondition": "",
                    },
                ],
                "edges": [
                    {
                        "id": "edge-ab",
                        "from": "node-a",
                        "to": "node-b",
                        "label": "",
                        "branch": "",
                        "fromSide": "",
                        "toSide": "",
                        "loop": False,
                        "width": "medium",
                        "color": "",
                    }
                ],
                "view": {"zoom": 1, "panX": 0, "panY": 0},
            }
        ],
    }
    with open(state_file, "w", encoding="utf-8") as f:
        json.dump(seed, f, ensure_ascii=False, indent=2)

    port = 41739
    server = canvas_server.ThreadingHTTPServer(("127.0.0.1", port), canvas_server.CanvasHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.15)
    base = f"http://127.0.0.1:{port}/api/state"

    failures = []

    def check(name, cond, detail=""):
        if cond:
            print(f"  ok  {name}")
        else:
            failures.append(f"{name}: {detail}")
            print(f" FAIL {name}: {detail}")

    try:
        # 1) GET full + meta
        st, data = _req(base)
        check("GET full", st == 200 and data.get("ok") is True and data["state"]["canvases"][0]["id"] == "canvas-main", str(data)[:200])
        st, meta = _req(base + "?meta=1")
        check("GET meta", st == 200 and meta.get("etag"), str(meta)[:200])

        # 2) legacy full POST still works
        full = json.loads(json.dumps(seed))
        full["canvases"][0]["name"] = "主画布-整包"
        st, resp = _req(base, data=full, method="POST")
        check("POST full", st == 200 and resp.get("ok") and resp.get("updated") == "full", str(resp)[:200])
        st, data = _req(base)
        check("full name applied", data["state"]["canvases"][0]["name"] == "主画布-整包", data["state"]["canvases"][0]["name"])

        # 3) canvas-only replace by canvasId (does not wipe other canvases)
        other = {
            "id": "canvas-other",
            "name": "另一画布",
            "category": "X",
            "nodes": [],
            "edges": [],
            "view": {"zoom": 1, "panX": 0, "panY": 0},
        }
        st, resp = _req(base + "?canvasId=canvas-other", data=other, method="POST")
        check("POST canvasId create", st == 200 and resp.get("updated") == "canvas-created", str(resp)[:200])
        st, data = _req(base)
        ids = [c["id"] for c in data["state"]["canvases"]]
        check("two canvases", ids == ["canvas-main", "canvas-other"], str(ids))

        # replace canvas-main nodes only — other canvas untouched
        patch_canvas = {
            "id": "canvas-main",
            "name": "主画布-单写",
            "nodes": [
                {
                    "id": "node-a",
                    "type": "rect",
                    "x": 11,
                    "y": 21,
                    "w": 176,
                    "h": 92,
                    "label": "A2",
                    "note": "updated",
                    "marker": "有疑问",
                    "condition": "",
                    "exitCondition": "",
                }
            ],
            "edges": [],
        }
        st, resp = _req(base + "?canvasId=canvas-main", data=patch_canvas, method="POST")
        check("POST canvasId replace", st == 200 and resp.get("updated") == "canvas-replaced", str(resp)[:200])
        st, data = _req(base)
        main_c = next(c for c in data["state"]["canvases"] if c["id"] == "canvas-main")
        other_c = next(c for c in data["state"]["canvases"] if c["id"] == "canvas-other")
        check("main node replaced", len(main_c["nodes"]) == 1 and main_c["nodes"][0]["label"] == "A2", str(main_c["nodes"])[:200])
        check("other intact", other_c["name"] == "另一画布", str(other_c)[:120])
        check("main name via body", main_c["name"] == "主画布-单写", main_c["name"])

        # 4) node field patch — restore a second node first via canvas write
        restore = {
            "id": "canvas-main",
            "nodes": [
                seed["canvases"][0]["nodes"][0],
                seed["canvases"][0]["nodes"][1],
            ],
            "edges": seed["canvases"][0]["edges"],
            "name": "主画布",
        }
        st, resp = _req(base + "?canvasId=canvas-main", data=restore, method="POST")
        check("restore nodes", st == 200 and resp.get("ok"), str(resp)[:160])

        st, resp = _req(
            base + "?canvasId=canvas-main&nodeId=node-b",
            data={"label": "B改", "marker": "不采用", "condition": "材料齐全？"},
            method="PATCH",
        )
        check("PATCH node fields", st == 200 and resp.get("updated") == "node-updated", str(resp)[:200])
        st, data = _req(base)
        main_c = next(c for c in data["state"]["canvases"] if c["id"] == "canvas-main")
        node_b = next(n for n in main_c["nodes"] if n["id"] == "node-b")
        other_node = next(n for n in main_c["nodes"] if n["id"] == "node-a")
        check("node-b patched", node_b["label"] == "B改" and node_b["marker"] == "不采用" and node_b["condition"] == "材料齐全？", str(node_b))
        check("node-a untouched", other_node["label"] == "A" and other_node["note"] == "na", str(other_node))

        # POST with nodeId also works
        st, resp = _req(
            base + "?canvasId=canvas-main&nodeId=node-a",
            data={"note": "note-from-post"},
            method="POST",
        )
        check("POST node note", st == 200 and resp.get("updated") == "node-updated", str(resp)[:160])
        st, data = _req(base)
        main_c = next(c for c in data["state"]["canvases"] if c["id"] == "canvas-main")
        node_a = next(n for n in main_c["nodes"] if n["id"] == "node-a")
        check("note applied", node_a["note"] == "note-from-post", str(node_a))

        # 5) edge field patch
        st, resp = _req(
            base + "?canvasId=canvas-main&edgeId=edge-ab",
            data={"label": "去判断", "branch": "是", "loop": True},
            method="PATCH",
        )
        check("PATCH edge", st == 200 and resp.get("updated") == "edge-updated", str(resp)[:200])
        st, data = _req(base)
        main_c = next(c for c in data["state"]["canvases"] if c["id"] == "canvas-main")
        edge = main_c["edges"][0]
        check("edge patched", edge["label"] == "去判断" and edge["branch"] == "是" and edge["loop"] is True, str(edge))

        # 6) errors
        st, resp = _req(base + "?canvasId=nope&nodeId=missing", data={"label": "x"}, method="PATCH")
        check("missing canvas 404", st == 404, f"status={st} {resp}")
        st, resp = _req(base + "?canvasId=canvas-main&nodeId=missing", data={"label": "x"}, method="PATCH")
        check("missing node 404", st == 404, f"status={st} {resp}")
        st, resp = _req(base + "?canvasId=canvas-main&nodeId=node-a", data={"evil": 1}, method="PATCH")
        check("unknown field 400", st == 400 and "evil" in str(resp.get("error", "")), str(resp))
        st, resp = _req(base, data={"canvases": []}, method="PATCH")
        check("PATCH without canvasId 400", st == 400, str(resp))
        st, resp = _req(base, data={"nope": True}, method="POST")
        check("full POST missing canvases 400", st == 400, str(resp))

        # 7) mtime advances after fine-grained write
        st0, m0 = _req(base + "?meta=1")
        time.sleep(0.02)
        st, resp = _req(
            base + "?canvasId=canvas-main&nodeId=node-a",
            data={"x": 99},
            method="PATCH",
        )
        st1, m1 = _req(base + "?meta=1")
        check("mtime/etag after patch", m1.get("etag") and m1.get("etag") != m0.get("etag"), f"{m0.get('etag')} vs {m1.get('etag')}")

        # 8) concurrent node patches don't lose other canvas
        def bump(i):
            _req(
                base + "?canvasId=canvas-main&nodeId=node-a",
                data={"note": f"n{i}"},
                method="PATCH",
            )

        threads = [threading.Thread(target=bump, args=(i,)) for i in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        st, data = _req(base)
        ids = [c["id"] for c in data["state"]["canvases"]]
        check("concurrent keeps canvases", "canvas-other" in ids and "canvas-main" in ids, str(ids))

    finally:
        server.shutdown()
        server.server_close()

    if failures:
        print(f"\nFAILED {len(failures)} checks:")
        for f in failures:
            print(" -", f)
        return 1
    print("\nALL PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
