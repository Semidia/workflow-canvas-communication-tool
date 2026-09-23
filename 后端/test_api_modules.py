# -*- coding: utf-8 -*-
"""画布薄后端 /api/modules 独立模块库落盘的本地自测。

在临时端口起 canvas_server，跑完即停；不碰仓库里的 工作流导出/ 下真实文件
（通过把 EXPORT_DIR/MODULES_FILE/STATE_FILE 指到临时目录——需在 import 后 monkeypatch）。
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
    tmp = tempfile.mkdtemp(prefix="canvas-modules-test-")
    export_dir = os.path.join(tmp, "工作流导出")
    state_file = os.path.join(export_dir, "画布数据.json")
    modules_file = os.path.join(export_dir, "模块库.json")
    os.makedirs(export_dir, exist_ok=True)

    seed_state = {
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
                        "note": "",
                        "marker": "待讨论",
                        "condition": "",
                        "exitCondition": "",
                    }
                ],
                "edges": [],
                "view": {"zoom": 1, "panX": 0, "panY": 0},
            }
        ],
    }
    with open(state_file, "w", encoding="utf-8") as f:
        json.dump(seed_state, f, ensure_ascii=False, indent=2)

    canvas_server.EXPORT_DIR = export_dir
    canvas_server.STATE_FILE = state_file
    canvas_server.MODULES_FILE = modules_file

    port = 41740
    server = canvas_server.ThreadingHTTPServer(("127.0.0.1", port), canvas_server.CanvasHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.15)
    base_state = f"http://127.0.0.1:{port}/api/state"
    base_mods = f"http://127.0.0.1:{port}/api/modules"

    failures = []

    def check(name, cond, detail=""):
        if cond:
            print(f"  ok  {name}")
        else:
            failures.append(f"{name}: {detail}")
            print(f" FAIL {name}: {detail}")

    sample = {
        "kind": "workflow-canvas-module-library",
        "version": 1,
        "exportedAt": 1700000000000,
        "modules": [
            {
                "id": "module-demo",
                "name": "演示模块",
                "createdAt": 1700000000000,
                "nodes": [
                    {
                        "id": "n1",
                        "type": "rect",
                        "x": 0,
                        "y": 0,
                        "w": 176,
                        "h": 92,
                        "label": "步骤",
                        "note": "",
                        "marker": "待讨论",
                        "condition": "",
                        "exitCondition": "",
                    },
                    {
                        "id": "n2",
                        "type": "diamond",
                        "x": 200,
                        "y": 0,
                        "w": 112,
                        "h": 112,
                        "label": "判断",
                        "note": "",
                        "marker": "待讨论",
                        "condition": "ok?",
                        "exitCondition": "",
                    },
                ],
                "edges": [
                    {
                        "from": "n1",
                        "to": "n2",
                        "label": "",
                        "branch": "",
                        "fromSide": "",
                        "toSide": "",
                        "loop": False,
                        "width": "medium",
                        "color": "",
                    }
                ],
            }
        ],
    }

    try:
        # 1) GET missing → 404
        st, resp = _req(base_mods)
        check("GET modules 404 when missing", st == 404, f"{st} {resp}")

        # 2) POST writes 模块库.json only (state untouched)
        st, resp = _req(base_mods, data=sample, method="POST")
        check("POST modules ok", st == 200 and resp.get("ok") and resp.get("updated") == "modules", str(resp)[:240])
        check("modules file exists", os.path.exists(modules_file), modules_file)
        with open(modules_file, "r", encoding="utf-8") as f:
            on_disk = json.load(f)
        check(
            "disk kind correct",
            on_disk.get("kind") == "workflow-canvas-module-library"
            and on_disk.get("modules", [{}])[0].get("id") == "module-demo",
            str(on_disk)[:200],
        )
        with open(state_file, "r", encoding="utf-8-sig") as f:
            state_on_disk = json.load(f)
        check("state has no modules field", "modules" not in state_on_disk, str(list(state_on_disk.keys())))

        # 3) GET returns library payload
        st, data = _req(base_mods)
        check(
            "GET modules ok",
            st == 200
            and data.get("ok") is True
            and data["library"]["kind"] == "workflow-canvas-module-library"
            and len(data["library"]["modules"]) == 1
            and data.get("etag"),
            str(data)[:240],
        )

        # 4) invalid kind rejected
        bad = dict(sample)
        bad = {**sample, "kind": "nope"}
        st, resp = _req(base_mods, data=bad, method="POST")
        check("bad kind 400", st == 400 and "kind" in str(resp.get("error", "")), str(resp))

        # 5) bad edge endpoint rejected
        bad_edge = json.loads(json.dumps(sample))
        bad_edge["modules"][0]["edges"][0]["to"] = "missing-node"
        st, resp = _req(base_mods, data=bad_edge, method="POST")
        check("bad edge 400", st == 400, str(resp))

        # 6) modules write does not change state etag path contract
        st0, m0 = _req(base_state + "?meta=1")
        st, resp = _req(base_mods, data={**sample, "exportedAt": 1700000001000}, method="POST")
        st1, m1 = _req(base_state + "?meta=1")
        check("state etag unchanged by modules write", st0 == 200 and st1 == 200 and m0.get("etag") == m1.get("etag"), f"{m0} vs {m1}")

        # 7) backup created after second write
        check("modules .bak exists", os.path.exists(modules_file + ".bak"), modules_file + ".bak")

        # 8) non-local Origin rejected
        st, resp = _req(base_mods, data=sample, method="POST", headers={"Origin": "http://evil.example"})
        check("cross-origin POST 403", st == 403, f"{st} {resp}")

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
