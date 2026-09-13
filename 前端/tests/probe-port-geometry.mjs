// 探针：量清楚端口的真实几何与可点范围（定位用，不是验收证据）
//
// 什么时候用它：怀疑「端口的可点范围到底有多大」「改了 ::after 的 inset 之后实际变成多大」
//   这类几何问题时，先跑它拿到实测数字，别凭 CSS 里的注释推断——2026-09-13 就是靠它发现
//   注释写「≥44px」而实际只有 40×40（端口 16px 是 border-box，含 2px 边框，::after 的 inset
//   相对 padding box 算，12 + 14×2 = 40）。本探针只读、只打印，不改仓库里任何文件。
//
// 用法：
//   node tests/probe-port-geometry.mjs [目标地址]
// 说明：目标地址靠 _served-target.mjs「按 app.js 内容认人」解析，不会误跑到别处的副本上。
import { createRequire } from "node:module";
import { resolveCanvasUrl } from "./_served-target.mjs";

const require = createRequire("D:/nodejs/npm-global/package.json");
const { chromium } = require("playwright");

const url = await resolveCanvasUrl(process.argv[2]);

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
const KEY = "workflow-canvas-communication-draft-v1";

const seed = {
  version: 1, activeCanvasId: "canvas-main",
  canvases: [{
    id: "canvas-main", name: "探针", category: "",
    nodes: [
      { id: "zao", type: "rect", x: 128, y: 372, w: 176, h: 92, label: "先画", note: "", marker: "待讨论" },
      { id: "wan", type: "diamond", x: 700, y: 600, w: 112, h: 112, label: "后画", note: "", marker: "待讨论", condition: "", exitCondition: "" },
    ],
    edges: [], view: { zoom: 1, panX: 0, panY: 0 },
  }],
};

await page.goto(url);
await page.waitForLoadState("networkidle");
await page.evaluate(({ s, k }) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(s)); }, { s: seed, k: KEY });
await page.reload();
await page.waitForLoadState("networkidle");

const out = await page.evaluate(() => {
  const node = document.querySelector('.node[data-node-id="zao"]');
  const nr = node.getBoundingClientRect();
  const port = node.querySelector('.port[data-side="right"]');
  const pr = port.getBoundingClientRect();
  const cs = getComputedStyle(port);
  const after = getComputedStyle(port, "::after");
  const nodeCS = getComputedStyle(node);
  const samples = [];
  const cy = pr.top + pr.height / 2;
  for (let d = 0; d <= 30; d += 2) {
    const x = pr.left + pr.width / 2 + d;
    const el = document.elementFromPoint(x, cy);
    samples.push({ d, x, tag: el?.tagName?.toLowerCase() ?? null, cls: String(el?.getAttribute?.("class") ?? ""), 端口: el?.closest?.(".port")?.dataset.side ?? null, 节点: el?.closest?.(".node")?.dataset.nodeId ?? null });
  }
  return {
    节点矩形: { left: nr.left, right: nr.right, top: nr.top, bottom: nr.bottom },
    端口矩形: { left: pr.left, right: pr.right, top: pr.top, bottom: pr.bottom, w: pr.width, h: pr.height },
    端口计算样式: { boxSizing: cs.boxSizing, position: cs.position, zIndex: cs.zIndex, pointerEvents: cs.pointerEvents, opacity: cs.opacity, padding: cs.padding, border: cs.borderWidth },
    after样式: { top: after.top, right: after.right, bottom: after.bottom, left: after.left, width: after.width, height: after.height, position: after.position, inset: after.inset },
    节点样式: { overflow: nodeCS.overflow, isolation: nodeCS.isolation },
    向右取样: samples,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
