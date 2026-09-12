import { createRequire } from "node:module";

const require = createRequire("D:/nodejs/npm-global/package.json");
const { chromium } = require("playwright");
import { resolveCanvasUrl } from "./_served-target.mjs";
const url = await resolveCanvasUrl(process.argv[2]);

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const fresh = async () => {
  await page.evaluate(() => { isDirty = false; clearTimeout(autosaveTimer); autosaveTimer = null; localStorage.clear(); });
  await page.reload();
  await page.waitForLoadState("networkidle");
};
const vp = async () => page.locator("#viewport").boundingBox();
const nodeCenter = (box, x, y, w, h) => ({ x: box.x + x + w / 2, y: box.y + y + h / 2 });

const results = [];
async function run(name, fn) {
  try { await fn(); results.push(`✅ ${name}`); }
  catch (err) { results.push(`❌ ${name}: ${err.message}`); }
}

// ===== 场景1：双击节点标签进入编辑（缺陷1：双击编辑失效） =====
await run("双击编辑", async () => {
  await page.goto(url); await fresh();
  await page.locator('[data-tool="select"]').click();
  await page.locator('[data-node-id="node-source"] .node-label').dblclick();
  const st = await page.evaluate(() => ({ editing: !!editing, ce: document.activeElement?.getAttribute?.("contenteditable") }));
  expect(st.editing, "双击后应进入编辑态");
  expect(st.ce === "true", `label 应 contentEditable=true，实际 ${st.ce}`);
});

// ===== 场景2：单击连线选中（缺陷2：单击连线失效） =====
await run("单击连线选中", async () => {
  await fresh();
  await page.locator('[data-tool="select"]').click();
  const box = await vp();
  await page.mouse.click(box.x + 253, box.y + 342);
  await page.waitForTimeout(30);
  const edgeId = await page.evaluate(() => selectedEdgeId);
  expect(edgeId === "edge-1", `单击连线应选中 edge-1，实际 ${edgeId}`);
});

// ===== 场景3：编辑名称后点击空白，焦点离开输入框（缺陷3：焦点粘住） =====
await run("焦点不粘住", async () => {
  await fresh();
  await page.locator('[data-tool="select"]').click();
  const box = await vp();
  await page.mouse.click(box.x + 138, box.y + 346);
  await page.locator("#inspectorName").click();
  await page.keyboard.type("新名");
  await page.mouse.click(box.x + 300, box.y + 700);
  await page.waitForTimeout(60);
  const activeId = await page.evaluate(() => document.activeElement?.id);
  expect(activeId !== "inspectorName", `焦点应离开名称框，实际 activeElement=${activeId}`);
});

// ===== 场景4：改名只影响选中节点，不写到别的节点（缺陷4） =====
await run("改名不串节点", async () => {
  await fresh();
  await page.locator('[data-tool="select"]').click();
  const box = await vp();
  await page.mouse.click(box.x + 138, box.y + 346);
  await page.locator("#inspectorName").fill("改名节点A");
  await page.mouse.click(box.x + 300, box.y + 700);
  await page.waitForTimeout(60);
  const labels = await page.evaluate(() => activeCanvas().nodes.map((n) => n.label));
  expect(labels[0] === "改名节点A", `node-source 应改为「改名节点A」，实际 ${labels[0]}`);
  expect(labels[1] === "形成判断", `node-analysis 不应被改，实际 ${labels[1]}`);
});

// ===== 场景5：文字工具单击空白新增节点（缺陷5） =====
await run("文字工具单击空白", async () => {
  await fresh();
  await page.locator('[data-tool="text"]').click();
  const box = await vp();
  const before = await page.evaluate(() => activeCanvas().nodes.length);
  await page.mouse.click(box.x + 800, box.y + 200);
  await page.waitForTimeout(60);
  const after = await page.evaluate(() => activeCanvas().nodes.length);
  expect(after === before + 1, `文字工具单击空白应新增节点，before=${before} after=${after}`);
});

// ===== 场景6：编辑名称后首次点击节点即选中（缺陷6：首次点标签被吞） =====
await run("首次点击即选中", async () => {
  await fresh();
  await page.locator('[data-tool="select"]').click();
  const box = await vp();
  await page.mouse.click(box.x + 138, box.y + 346);
  await page.locator("#inspectorName").click();
  await page.mouse.click(box.x + 558, box.y + 346);
  await page.waitForTimeout(60);
  const sel = await page.evaluate(() => selectedNodeId);
  expect(sel === "node-review", `首次点击应选中 node-review，实际 ${sel}`);
});

// ===== 场景7：模块库弹窗 Tab 循环焦点不逃逸（缺陷7） =====
await run("弹窗 Tab 不逃逸", async () => {
  await fresh();
  await page.locator('[data-action="open-modules"]').click();
  await page.waitForTimeout(30);
  const initialIn = await page.evaluate(() => !!document.activeElement?.closest?.("#moduleModal"));
  expect(initialIn, "打开弹窗后焦点应在弹窗内");
  let escaped = false;
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    const inModal = await page.evaluate(() => !!document.activeElement?.closest?.("#moduleModal"));
    if (!inModal) { escaped = true; break; }
  }
  expect(!escaped, "Tab 循环焦点不应逃出弹窗");
});

// ===== 场景8：弹窗打开时 Ctrl+Z 不撤销画布（缺陷8） =====
await run("弹窗屏蔽 Ctrl+Z", async () => {
  await fresh();
  await page.locator('[data-tool="select"]').click();
  const box = await vp();
  await page.mouse.click(box.x + 138, box.y + 346);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(30);
  const afterDelete = await page.evaluate(() => activeCanvas().nodes.length);
  await page.locator('[data-action="open-modules"]').click();
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(60);
  const afterUndo = await page.evaluate(() => activeCanvas().nodes.length);
  const modalOpen = await page.evaluate(() => !moduleModal.hidden);
  expect(afterUndo === afterDelete, `弹窗打开时 Ctrl+Z 不应撤销删除，删除后=${afterDelete} 撤销后=${afterUndo}`);
  expect(modalOpen, "Ctrl+Z 后弹窗应保持打开");
});

// ===== 场景9：编辑态按 Escape 恢复原文字（缺陷9） =====
await run("编辑态 Escape 取消", async () => {
  await fresh();
  await page.locator('[data-tool="select"]').click();
  await page.locator('[data-node-id="node-source"] .node-label').dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("临时改");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(60);
  const label = await page.evaluate(() => activeCanvas().nodes.find((n) => n.id === "node-source").label);
  const editingNull = await page.evaluate(() => !editing);
  expect(label === "收集材料", `Escape 应恢复原文字「收集材料」，实际 ${label}`);
  expect(editingNull, "Escape 后应退出编辑态");
});

// ===== 场景10：只读类型框聚焦后快捷键仍生效（缺陷10） =====
await run("只读框不吞快捷键", async () => {
  await fresh();
  await page.locator('[data-tool="select"]').click();
  const box = await vp();
  await page.mouse.click(box.x + 138, box.y + 346);
  await page.locator("#inspectorType").click();
  const before = await page.evaluate(() => activeCanvas().nodes.length);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(60);
  const after = await page.evaluate(() => activeCanvas().nodes.length);
  expect(after === before - 1, `只读框聚焦后 Delete 应删除节点，before=${before} after=${after}`);
});

console.log(JSON.stringify({ results, errors }, null, 2));
await browser.close();
