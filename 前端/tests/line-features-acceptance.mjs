// 画布工具 连线系统 7 项改进 专项验收
// 覆盖：删除连线(按钮+右键)、port 拖拽连线、粗细三档、颜色可调、自然弯曲、port 重新附着、乐观锁时间戳
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire("D:/nodejs/npm-global/package.json");
const { chromium } = require("playwright");
const url = process.argv[2] || "http://127.0.0.1:4173/index.html";
const shotDir = "D:/agent临时/郄的工作流画布沟通工具验收";
const KEY = "workflow-canvas-communication-draft-v1";

const base = (edges = [], extra = {}) => ({
  version: 1,
  activeCanvasId: "canvas-main",
  canvases: [{
    id: "canvas-main", name: "连线验收", category: "",
    nodes: [
      { id: "a", type: "rect", x: 120, y: 240, w: 176, h: 92, label: "A", note: "", marker: "待讨论" },
      { id: "b", type: "rect", x: 460, y: 240, w: 176, h: 92, label: "B", note: "", marker: "待讨论" },
    ],
    edges,
    view: { zoom: 1, panX: 0, panY: 0 },
  }],
  ...extra,
});

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const results = [];
const pageErrors = [];
const check = (name, pass, detail = "") => results.push({ name, pass, detail });
let shot = 0;
const snap = async (page, name) => { try { mkdirSync(shotDir, { recursive: true }); } catch {} await page.screenshot({ path: `${shotDir}/line-${++shot}-${name}.png` }); };

const stateOf = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), KEY);
const edgesOf = async (page) => (await stateOf(page))?.canvases?.[0]?.edges ?? [];
const edgePathD = (page, id) => page.locator(`.edge[data-edge-id="${id}"]`).getAttribute("d");

async function freshPage(browser, seed) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(url);
  await page.evaluate(({ s, k }) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(s)); }, { s: seed, k: KEY });
  await page.reload();
  await page.waitForLoadState("networkidle");
  return { ctx, page };
}

async function edgeMid(page, id) {
  return page.evaluate((eid) => {
    const p = document.querySelector(`.edge-hit[data-edge-id="${eid}"]`);
    if (!p) return null;
    const len = p.getTotalLength();
    const pt = p.getPointAtLength(len / 2);
    const m = p.getScreenCTM();
    const s = new DOMPoint(pt.x, pt.y).matrixTransform(m);
    return { x: s.x, y: s.y };
  }, id);
}

try {
  // ── 场景 1：port 拖拽连线 + 自然弯曲 + 时间戳 ──────────────
  {
    const { ctx, page } = await freshPage(browser, base([]));
    await page.click('[data-tool="connector"]');
    await page.waitForTimeout(200);
    const aRight = await page.locator('.node[data-node-id="a"] .port[data-side="right"]').boundingBox();
    const bLeft = await page.locator('.node[data-node-id="b"] .port[data-side="left"]').boundingBox();
    const portVisible = await page.locator('.node[data-node-id="a"] .port[data-side="right"]').evaluate((el) => getComputedStyle(el).opacity);
    check("connector 下 port 常显", portVisible === "1", `opacity=${portVisible}`);
    await page.mouse.move(aRight.x + aRight.width / 2, aRight.y + aRight.height / 2);
    await page.mouse.down();
    await page.mouse.move(bLeft.x + bLeft.width / 2, bLeft.y + bLeft.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const s1 = await stateOf(page);
    const e1 = s1.canvases[0].edges[0];
    check("port 拖拽产生连线", !!e1 && e1.from === "a" && e1.to === "b", JSON.stringify(e1));
    check("拖拽连线记录接触边", e1?.fromSide === "right" && e1?.toSide === "left", `fromSide=${e1?.fromSide} toSide=${e1?.toSide}`);
    check("新连线默认中粗细 + 无颜色", e1?.width === "medium" && e1?.color === "", `width=${e1?.width} color=${e1?.color}`);
    const d = await edgePathD(page, e1.id);
    check("单边为自然贝塞尔曲线(含 C 命令)", typeof d === "string" && d.includes("C"), `d=${d}`);
    check("乐观锁时间戳已写入", typeof s1.updatedAt === "string" && !Number.isNaN(Date.parse(s1.updatedAt)), `updatedAt=${s1.updatedAt}`);
    check("保存后 rev 递增", s1.rev === 1, `rev=${s1.rev}`);
    await snap(page, "1-port-drag-curve");
    await ctx.close();
  }

  // ── 场景 2：粗细三档 ────────────────────────────────────
  {
    const { ctx, page } = await freshPage(browser, base([{ id: "e1", from: "a", to: "b", label: "", fromSide: "right", toSide: "left" }]));
    const mid = await edgeMid(page, "e1");
    await page.mouse.click(mid.x, mid.y);
    await page.waitForTimeout(150);
    const activeBefore = await page.locator('.width-button[data-width="medium"]').getAttribute("class");
    check("选中后默认中档高亮", (activeBefore || "").includes("is-active"), activeBefore);
    await page.click('.width-button[data-width="thick"]');
    await page.waitForTimeout(150);
    let e = (await edgesOf(page)).find((x) => x.id === "e1");
    check("切到粗档 width=thick", e?.width === "thick", `width=${e?.width}`);
    const swThick = await page.locator('.edge[data-edge-id="e1"]').getAttribute("stroke-width");
    check("粗档描边 5.5px", swThick === "5.5", `stroke-width=${swThick}`);
    await page.click('.width-button[data-width="thin"]');
    await page.waitForTimeout(150);
    e = (await edgesOf(page)).find((x) => x.id === "e1");
    const swThin = await page.locator('.edge[data-edge-id="e1"]').getAttribute("stroke-width");
    check("切到细档 width=thin", e?.width === "thin", `width=${e?.width}`);
    check("细档描边 2.8px(比旧默认更粗一丢丢)", swThin === "2.8", `stroke-width=${swThin}`);
    await snap(page, "2-width-3tier");
    await ctx.close();
  }

  // ── 场景 3：颜色可调 ────────────────────────────────────
  {
    const { ctx, page } = await freshPage(browser, base([{ id: "e1", from: "a", to: "b", label: "" }]));
    const mid = await edgeMid(page, "e1");
    await page.mouse.click(mid.x, mid.y);
    await page.waitForTimeout(150);
    const swatchCount = await page.locator("#edgeColorSwatches .color-swatch").count();
    check("色板已生成 8 色", swatchCount === 8, `count=${swatchCount}`);
    await page.click('#edgeColorSwatches .color-swatch[data-color="#d9724b"]');
    await page.waitForTimeout(150);
    let e = (await edgesOf(page)).find((x) => x.id === "e1");
    check("选色后 edge.color 写入", e?.color === "#d9724b", `color=${e?.color}`);
    const stroke = await page.locator('.edge[data-edge-id="e1"]').getAttribute("stroke");
    check("描边颜色同步", stroke === "#d9724b", `stroke=${stroke}`);
    const markerOk = await page.evaluate(() => !!document.querySelector('#arrow-d9724b'));
    check("对应颜色箭头 marker 已生成", markerOk);
    // 切回默认色 → 存储为空串
    await page.click('#edgeColorSwatches .color-swatch[data-color="#4a7c8b"]');
    await page.waitForTimeout(150);
    e = (await edgesOf(page)).find((x) => x.id === "e1");
    check("切回默认色回写空串", e?.color === "", `color=${e?.color}`);
    await snap(page, "3-color");
    await ctx.close();
  }

  // ── 场景 4：删除连线（inspector 按钮）────────────────────
  {
    const { ctx, page } = await freshPage(browser, base([{ id: "e1", from: "a", to: "b", label: "审批" }]));
    const mid = await edgeMid(page, "e1");
    await page.mouse.click(mid.x, mid.y);
    await page.waitForTimeout(150);
    const formVisible = await page.locator("#inspectorEdgeForm").evaluate((el) => !el.hidden);
    check("选中连线显示连线面板", formVisible);
    await page.click(".edge-delete-button");
    await page.waitForTimeout(200);
    check("删除按钮后连线移除", (await edgesOf(page)).length === 0, JSON.stringify(await edgesOf(page)));
    await snap(page, "4-delete-button");
    await ctx.close();
  }

  // ── 场景 5：删除连线（右键菜单）─────────────────────────
  {
    const { ctx, page } = await freshPage(browser, base([{ id: "e1", from: "a", to: "b", label: "依赖" }]));
    const mid = await edgeMid(page, "e1");
    await page.mouse.click(mid.x, mid.y, { button: "right" });
    await page.waitForTimeout(150);
    const menuVisible = await page.locator(".context-menu").evaluate((el) => !el.hidden);
    check("右键弹出上下文菜单", menuVisible);
    const menuText = await page.locator(".context-menu-item.is-danger").textContent();
    check("菜单含删除连线项", (menuText || "").includes("删除连线"), menuText);
    await page.locator(".context-menu-item.is-danger").click();
    await page.waitForTimeout(200);
    check("右键删除后连线移除", (await edgesOf(page)).length === 0, JSON.stringify(await edgesOf(page)));
    await snap(page, "5-delete-contextmenu");
    await ctx.close();
  }

  // ── 场景 6：port 重新附着（同卡片换接触点）────────────────
  {
    const { ctx, page } = await freshPage(browser, base([{ id: "e1", from: "a", to: "b", label: "", fromSide: "right", toSide: "left" }]));
    const mid = await edgeMid(page, "e1");
    await page.mouse.click(mid.x, mid.y);
    await page.waitForTimeout(150);
    const handleCount = await page.locator(".edge-handle").count();
    check("选中连线出现两个端点手柄", handleCount === 2, `count=${handleCount}`);
    const fromHandle = await page.locator('.edge-handle-from[data-edge-id="e1"]').boundingBox();
    const aTop = await page.locator('.node[data-node-id="a"] .port[data-side="top"]').boundingBox();
    await page.mouse.move(fromHandle.x + fromHandle.width / 2, fromHandle.y + fromHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(aTop.x + aTop.width / 2, aTop.y + aTop.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const e = (await edgesOf(page)).find((x) => x.id === "e1");
    check("起点换到同卡片顶部", e?.from === "a" && e?.fromSide === "top", `from=${e?.from} fromSide=${e?.fromSide}`);
    check("终点保持不变", e?.to === "b" && e?.toSide === "left", `to=${e?.to} toSide=${e?.toSide}`);
    await snap(page, "6-reattach");
    await ctx.close();
  }

  console.log(JSON.stringify({
    results,
    pageErrors,
    summary: { passed: results.filter((r) => r.pass).length, total: results.length, failed: results.filter((r) => !r.pass).length },
  }, null, 2));
} finally {
  await browser.close();
}
