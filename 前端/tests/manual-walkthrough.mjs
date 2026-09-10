// 手动走查：有头真实 Chrome，逐项点一遍连线系统 7 项，每步截图
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire("D:/nodejs/npm-global/package.json");
const { chromium } = require("playwright");
const url = process.argv[2] || "http://127.0.0.1:4173/index.html";
const shotDir = "D:/agent临时/郄的工作流画布沟通工具手动验收";
const KEY = "workflow-canvas-communication-draft-v1";

const base = (edges = []) => ({
  version: 1,
  activeCanvasId: "canvas-main",
  canvases: [{
    id: "canvas-main", name: "手动验收", category: "",
    nodes: [
      { id: "a", type: "rect", x: 140, y: 240, w: 176, h: 92, label: "节点 A", note: "", marker: "待讨论" },
      { id: "b", type: "rect", x: 480, y: 240, w: 176, h: 92, label: "节点 B", note: "", marker: "待讨论" },
    ],
    edges,
    view: { zoom: 1, panX: 0, panY: 0 },
  }],
});

const browser = await chromium.launch({
  headless: false,
  slowMo: 180,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
let shot = 0;
const snap = async (page, name) => {
  try { mkdirSync(shotDir, { recursive: true }); } catch {}
  const p = `${shotDir}/${String(++shot).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log("SHOT", p);
};
const stateOf = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), KEY);
const edgesOf = async (page) => (await stateOf(page))?.canvases?.[0]?.edges ?? [];
const edgeMid = (page, id) => page.evaluate((eid) => {
  const p = document.querySelector(`.edge-hit[data-edge-id="${eid}"]`);
  if (!p) return null;
  const len = p.getTotalLength();
  const pt = p.getPointAtLength(len / 2);
  const m = p.getScreenCTM();
  const s = new DOMPoint(pt.x, pt.y).matrixTransform(m);
  return { x: s.x, y: s.y };
}, id);

async function fresh(seed) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
  await page.goto(url);
  await page.evaluate(({ s, k }) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(s)); }, { s: seed, k: KEY });
  await page.reload();
  await page.waitForLoadState("networkidle");
  return { ctx, page };
}

try {
  // ── 1. port 拖拽连线（先点连线工具，让 port 常显）────────
  {
    const { ctx, page } = await fresh(base([]));
    await snap(page, "初始两节点无连线");
    await page.click('[data-tool="connector"]');
    await page.waitForTimeout(250);
    await snap(page, "点连线工具后port常显");
    const aRight = await page.locator('.node[data-node-id="a"] .port[data-side="right"]').boundingBox();
    const bLeft = await page.locator('.node[data-node-id="b"] .port[data-side="left"]').boundingBox();
    await page.mouse.move(aRight.x + aRight.width / 2, aRight.y + aRight.height / 2);
    await page.mouse.down();
    await page.mouse.move(bLeft.x + bLeft.width / 2, bLeft.y + bLeft.height / 2, { steps: 12 });
    await snap(page, "拖拽中出现临时线");
    await page.mouse.up();
    await page.waitForTimeout(350);
    await snap(page, "拖拽完成连线");
    const e1 = (await edgesOf(page))[0];
    console.log("RESULT 连线", JSON.stringify(e1));
    await ctx.close();
  }

  // ── 2. 选中线 → 粗细/颜色/端点手柄 ──────────────────────
  {
    const { ctx, page } = await fresh(base([{ id: "e1", from: "a", to: "b", label: "", fromSide: "right", toSide: "left" }]));
    const mid = await edgeMid(page, "e1");
    await page.mouse.click(mid.x, mid.y);
    await page.waitForTimeout(300);
    await snap(page, "选中线显示面板与端点手柄");
    await page.click('.width-button[data-width="thick"]');
    await page.waitForTimeout(250);
    await snap(page, "切到粗档");
    await page.click('#edgeColorSwatches .color-swatch[data-color="#d9724b"]');
    await page.waitForTimeout(250);
    await snap(page, "选橙色");
    await page.click('.width-button[data-width="thin"]');
    await page.waitForTimeout(250);
    await snap(page, "切回细档");
    console.log("RESULT 样式", JSON.stringify((await edgesOf(page)).find((x) => x.id === "e1")));
    await ctx.close();
  }

  // ── 3. 同卡片换接触点（拖 from 手柄到 top）────────────────
  {
    const { ctx, page } = await fresh(base([{ id: "e1", from: "a", to: "b", label: "", fromSide: "right", toSide: "left" }]));
    const mid = await edgeMid(page, "e1");
    await page.mouse.click(mid.x, mid.y);
    await page.waitForTimeout(300);
    const fromHandle = await page.locator('.edge-handle-from[data-edge-id="e1"]').boundingBox();
    const aTop = await page.locator('.node[data-node-id="a"] .port[data-side="top"]').boundingBox();
    await page.mouse.move(fromHandle.x + fromHandle.width / 2, fromHandle.y + fromHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(aTop.x + aTop.width / 2, aTop.y + aTop.height / 2, { steps: 12 });
    await snap(page, "拖动手柄到顶部port");
    await page.mouse.up();
    await page.waitForTimeout(300);
    await snap(page, "起点已换到顶部");
    console.log("RESULT 换接触点", JSON.stringify((await edgesOf(page)).find((x) => x.id === "e1")));
    await ctx.close();
  }

  // ── 4. 右键删除 ────────────────────────────────────────
  {
    const { ctx, page } = await fresh(base([{ id: "e1", from: "a", to: "b", label: "依赖" }]));
    const mid = await edgeMid(page, "e1");
    await page.mouse.click(mid.x, mid.y, { button: "right" });
    await page.waitForTimeout(300);
    await snap(page, "右键弹出上下文菜单");
    await page.locator(".context-menu-item.is-danger").click();
    await page.waitForTimeout(300);
    await snap(page, "右键删除后无连线");
    console.log("RESULT 右键删除剩余边数", (await edgesOf(page)).length);
    await ctx.close();
  }

  console.log("DONE");
} finally {
  await browser.close();
}
