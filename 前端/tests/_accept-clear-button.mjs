// 验收脚本：验证「清空当前画布」按钮 —— 真实交互搭 2 节点 + 1 连线，点清空 → 确认 → 归零 → 撤销找回。
// 只做真实输入事件，不做 DOM/Store 直改（除起始空画布 seed 外）。
import { launchChromium } from "./_runtime.mjs";
import { resolveCanvasUrl } from "./_served-target.mjs";

const url = await resolveCanvasUrl(process.argv[2] || "http://127.0.0.1:4173/index.html");
const STORAGE_KEY = "workflow-canvas-communication-draft-v1";

const empty = {
  version: 1,
  activeCanvasId: "canvas-main",
  canvases: [{
    id: "canvas-main", name: "清空验收", category: "",
    nodes: [], edges: [],
    view: { zoom: 1, panX: 0, panY: 0 },
  }],
};

const browser = await launchChromium({ headless: true });
const exp = [];
const pageErrors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  // 关键：clearCanvas 用 window.confirm，headless 下默认 auto-dismiss(返回 false)，
  // 必须注册 dialog handler 接受，否则清空不会执行。
  page.on("dialog", (d) => d.accept());

  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }, empty);
  await page.reload();
  await page.waitForLoadState("networkidle");

  const vp = await page.locator("#viewport").boundingBox();
  const world2screen = (wx, wy) => ({ x: vp.x + wx, y: vp.y + wy });
  const counts = () => page.evaluate((k) => {
    const s = JSON.parse(localStorage.getItem(k));
    return { nodes: s?.canvases?.[0]?.nodes?.length ?? 0, edges: s?.canvases?.[0]?.edges?.length ?? 0 };
  }, STORAGE_KEY);

  // 搭：2 个步骤节点 + 1 条连线
  for (const [cx, cy] of [[200, 200], [450, 300]]) {
    await page.locator('.tool-button[data-tool="rect"]').click();
    const p = world2screen(cx, cy);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(80);
  }
  const afterAdd = await counts();
  exp.push({ step: "加 2 个步骤节点", ok: afterAdd.nodes === 2, detail: JSON.stringify(afterAdd) });

  // 连线：从第 1 个节点右侧端口拖到第 2 个节点左侧端口
  const n1 = await page.locator(".node").nth(0).getAttribute("data-node-id");
  const n2 = await page.locator(".node").nth(1).getAttribute("data-node-id");
  const p1 = await page.locator(`.node[data-node-id="${n1}"] .port[data-side="right"]`).boundingBox();
  const p2 = await page.locator(`.node[data-node-id="${n2}"] .port[data-side="left"]`).boundingBox();
  await page.mouse.move(p1.x + p1.width / 2, p1.y + p1.height / 2);
  await page.mouse.down();
  await page.mouse.move(p2.x + p2.width / 2, p2.y + p2.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const afterEdge = await counts();
  exp.push({ step: "连 1 条线", ok: afterEdge.edges === 1, detail: JSON.stringify(afterEdge) });

  // 点清空按钮 → 确认
  await page.locator('[data-action="clear-canvas"]').click();
  await page.waitForTimeout(200);
  const afterClear = await counts();
  exp.push({ step: "点清空按钮后归零", ok: afterClear.nodes === 0 && afterClear.edges === 0, detail: JSON.stringify(afterClear) });

  // 撤销找回
  await page.locator('[data-action="undo"]').click();
  await page.waitForTimeout(200);
  const afterUndo = await counts();
  exp.push({ step: "撤销找回", ok: afterUndo.nodes === 2 && afterUndo.edges === 1, detail: JSON.stringify(afterUndo) });

  console.log(JSON.stringify({ experience: exp, pageErrors }, null, 2));
} finally {
  await browser.close();
}
