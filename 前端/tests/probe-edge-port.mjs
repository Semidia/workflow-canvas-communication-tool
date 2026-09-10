// 探针：复现「删除连线」「port 拖拽连线」现状，定位根因
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire("D:/nodejs/npm-global/package.json");
const { chromium } = require("playwright");
const url = process.argv[2] || "http://127.0.0.1:4173/index.html";
const shotDir = "D:/agent临时/郄的工作流画布沟通工具验收";
const STORAGE_KEY = "workflow-canvas-communication-draft-v1";

const base = (edges = []) => ({
  version: 1,
  activeCanvasId: "canvas-main",
  canvases: [{
    id: "canvas-main", name: "探针", category: "",
    nodes: [
      { id: "a", type: "rect", x: 120, y: 240, w: 176, h: 92, label: "A", note: "", marker: "待讨论" },
      { id: "b", type: "rect", x: 460, y: 240, w: 176, h: 92, label: "B", note: "", marker: "待讨论" },
    ],
    edges,
    view: { zoom: 1, panX: 0, panY: 0 },
  }],
});

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const pageErrors = [];
const out = [];
try {
  mkdirSync(shotDir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  const state = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), STORAGE_KEY);

  // ── 场景 1：port 拖拽连线 ──────────────────────────────
  await page.goto(url);
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem("workflow-canvas-communication-draft-v1", JSON.stringify(s)); }, base([]));
  await page.reload();
  await page.waitForLoadState("networkidle");

  const aRight = await page.locator('.node[data-node-id="a"] .port[data-side="right"]').boundingBox();
  const bLeft = await page.locator('.node[data-node-id="b"] .port[data-side="left"]').boundingBox();
  out.push({ step: "port盒子", aRight, bLeft });

  // 先 hover 到 a 中心让 port 显示
  const aBox = await page.locator('.node[data-node-id="a"]').boundingBox();
  await page.mouse.move(aBox.x + aBox.width / 2, aBox.y + aBox.height / 2);
  await page.waitForTimeout(200);
  const portOpacityAfterHover = await page.locator('.node[data-node-id="a"] .port[data-side="right"]').evaluate((el) => getComputedStyle(el).opacity);
  out.push({ step: "hover后a端口opacity", portOpacityAfterHover });

  await page.mouse.move(aRight.x + aRight.width / 2, aRight.y + aRight.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  const tempVisible = await page.locator("#temporaryEdge").evaluate((el) => !el.hidden && el.getAttribute("d") && el.getAttribute("d") !== "");
  const tempD = await page.locator("#temporaryEdge").getAttribute("d");
  out.push({ step: "按下后临时线可见", tempVisible, tempD });
  await page.mouse.move(bLeft.x + bLeft.width / 2, bLeft.y + bLeft.height / 2, { steps: 8 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const s1 = await state();
  const newEdge = s1?.canvases?.[0]?.edges?.find((e) => e.from === "a" && e.to === "b");
  out.push({ step: "拖拽后新增边", edge: newEdge || null, allEdges: s1?.canvases?.[0]?.edges || [] });
  await page.screenshot({ path: `${shotDir}/probe-port-drag.png` });

  // ── 场景 2：edge 删除 ──────────────────────────────
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem("workflow-canvas-communication-draft-v1", JSON.stringify(s)); }, base([{ id: "e1", from: "a", to: "b", label: "" }]));
  await page.reload();
  await page.waitForLoadState("networkidle");

  const mid = await page.evaluate(() => {
    const p = document.querySelector('.edge[data-edge-id="e1"]');
    if (!p) return null;
    const len = p.getTotalLength();
    const pt = p.getPointAtLength(len / 2);
    const m = p.getScreenCTM();
    const s = new DOMPoint(pt.x, pt.y).matrixTransform(m);
    return { x: s.x, y: s.y, len };
  });
  out.push({ step: "edge中点", mid });

  // 命中尝试：直接点中点（无 bend，单条边是直线，中点在两节点正中）
  await page.mouse.click(mid.x, mid.y);
  await page.waitForTimeout(150);
  const selectedClass = await page.locator('.edge[data-edge-id="e1"]').getAttribute("class");
  out.push({ step: "点击后edge选中态", selectedClass });
  await page.keyboard.press("Delete");
  await page.waitForTimeout(200);
  const s2 = await state();
  out.push({ step: "Delete后edges", edges: s2?.canvases?.[0]?.edges || [] });
  await page.screenshot({ path: `${shotDir}/probe-edge-delete.png` });

  console.log(JSON.stringify({ out, pageErrors }, null, 2));
} finally {
  await browser.close();
}
