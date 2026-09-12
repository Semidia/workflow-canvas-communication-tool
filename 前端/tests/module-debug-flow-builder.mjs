import { createRequire } from "node:module";

const require = createRequire("D:/nodejs/npm-global/package.json");
const { chromium } = require("playwright");
import { resolveCanvasUrl } from "./_served-target.mjs";
const url = await resolveCanvasUrl(process.argv[2]);
const screenshotDir = "D:/agent临时/郄的工作流画布沟通工具验收";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(url);
await page.waitForLoadState("networkidle");
await page.evaluate(() => { isDirty = false; clearTimeout(autosaveTimer); autosaveTimer = null; localStorage.clear(); });
await page.reload();
await page.waitForLoadState("networkidle");

// 新建一个空画布，用来画流程图（避免默认 4 个节点干扰框选）
page.once("dialog", (d) => d.accept("多视角调试流程"));
await page.locator('[data-action="new-canvas"]').click();
await page.waitForTimeout(80);

const vp = await page.locator("#viewport").boundingBox();
const px = (wx) => vp.x + wx;
const py = (wy) => vp.y + wy;

async function placeNode(type, wx, wy, label) {
  await page.locator(`[data-tool="${type}"]`).click();
  await page.mouse.click(px(wx), py(wy));
  await page.waitForTimeout(40);
  const id = await page.evaluate(() => activeCanvas().nodes[activeCanvas().nodes.length - 1].id);
  await page.locator(`[data-node-id="${id}"] .node-label`).dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type(label);
  await page.mouse.click(px(300), py(70)); // 点空白结算文字
  await page.waitForTimeout(40);
  return id;
}

async function connect(ax, ay, bx, by) {
  await page.locator('[data-tool="connector"]').click();
  await page.mouse.click(px(ax), py(ay));
  await page.waitForTimeout(25);
  await page.mouse.click(px(bx), py(by));
  await page.waitForTimeout(40);
}

// 8 个节点
await placeNode("circle", 50, 350, "接收调试目标");
await placeNode("rect", 165, 350, "拆分审查视角");
await placeNode("rect", 300, 350, "并行扇出子智能体");
await placeNode("rect", 435, 350, "回收去重归类");
await placeNode("diamond", 570, 350, "有实际缺陷？");
await placeNode("rect", 570, 185, "修复缺陷换新视角");
await placeNode("diamond", 700, 350, "连续3次理论边界？");
await placeNode("circle", 820, 350, "结束：汇总汇报");

// 9 条连线
await connect(50, 350, 165, 350);
await connect(165, 350, 300, 350);
await connect(300, 350, 435, 350);
await connect(435, 350, 570, 350);
await connect(570, 350, 570, 185);   // 5→6 是（向上）
await connect(570, 185, 165, 350);   // 6→2 回环
await connect(570, 350, 700, 350);   // 5→7 否（向右）
await connect(700, 350, 820, 350);   // 7→8 是
await connect(700, 350, 165, 350);   // 7→2 否回环

const stat = await page.evaluate(() => ({ nodes: activeCanvas().nodes.length, edges: activeCanvas().edges.length, labels: activeCanvas().nodes.map((n) => n.label), edgesDetail: activeCanvas().edges.map((e) => ({ from: activeCanvas().nodes.find((n) => n.id === e.from)?.label, to: activeCanvas().nodes.find((n) => n.id === e.to)?.label })) }));
console.log("画布节点数/连线数：", JSON.stringify(stat, null, 2));

// 框选封装
await page.locator('[data-tool="marquee"]').click();
await page.mouse.move(px(10), py(120));
await page.mouse.down();
await page.mouse.move(px(880), py(420), { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(80);
const summary = await page.locator("#multiSelectSummary").textContent();
console.log("框选摘要：", summary);

page.once("dialog", (d) => d.accept("循环派智能体多视角调试收敛流程"));
await page.locator('#multiSelectPanel [data-action="save-module"]').click();
await page.waitForTimeout(80);
const lib = await page.evaluate(() => JSON.parse(localStorage.getItem("workflow-canvas-module-library-v1") || "[]"));
console.log("模块库：", JSON.stringify(lib.map((m) => ({ name: m.name, nodes: m.nodes.length, edges: m.edges.length })), null, 2));

await page.screenshot({ path: `${screenshotDir}/debug流程图封装模块.png` });
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
