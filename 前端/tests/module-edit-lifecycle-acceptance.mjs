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
const results = [];

const fresh = async () => {
  await page.evaluate(() => { isDirty = false; clearTimeout(autosaveTimer); autosaveTimer = null; localStorage.clear(); });
  await page.reload();
  await page.waitForLoadState("networkidle");
};
const vp = async () => page.locator("#viewport").boundingBox();
const nodeLabel = (id) => page.evaluate((nid) => activeCanvas().nodes.find((n) => n.id === nid)?.label, id);
const editingState = () => page.evaluate(() => ({ editing: !!editing, editingNodeId: editing?.nodeId, before: editing?.before }));
const historyLen = () => page.evaluate(() => canvasStack(activeCanvas().id).history.length);
const tool = () => page.evaluate(() => activeTool);

async function run(name, fn) {
  try { await fn(); results.push(`✅ ${name}`); }
  catch (err) { results.push(`❌ ${name}: ${err.message}`); }
}

// ===== 场景1：编辑中点击文字内部移动光标，不应被迫结束编辑 =====
await run("编辑中移动光标不结束", async () => {
  await page.goto(url); await fresh();
  await page.locator('[data-tool="select"]').click();
  await page.locator('[data-node-id="node-source"] .node-label').dblclick();
  expect((await editingState()).editing, "双击后应进入编辑态");
  // 在 label 元素内部另一点单击（移动光标），不应结束编辑
  const lb = await page.locator('[data-node-id="node-source"] .node-label').boundingBox();
  await page.mouse.click(lb.x + lb.width * 0.3, lb.y + lb.height / 2);
  await page.waitForTimeout(30);
  const st = await editingState();
  expect(st.editing, `点击文字内部后应仍在编辑态，实际 editing=${st.editing}`);
  expect(st.editingNodeId === "node-source", "编辑目标仍是 node-source");
});

// ===== 场景2：编辑中点空白，结束编辑且文字落盘 =====
await run("编辑中点空白落盘", async () => {
  await fresh();
  await page.locator('[data-tool="select"]').click();
  await page.locator('[data-node-id="node-source"] .node-label').dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("改写后的名字");
  const box = await vp();
  await page.mouse.click(box.x + 900, box.y + 700);
  await page.waitForTimeout(60);
  expect(!(await editingState()).editing, "点空白后应退出编辑态");
  expect(await nodeLabel("node-source") === "改写后的名字", `文字应落盘为「改写后的名字」，实际 ${await nodeLabel("node-source")}`);
});

// ===== 场景3：编辑中不失焦就刷新，flushPendingSave 应把文字落盘 =====
await run("编辑不失焦刷新落盘", async () => {
  await fresh();
  await page.locator('[data-tool="select"]').click();
  await page.locator('[data-node-id="node-source"] .node-label').dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("未失焦文字");
  // 此时 DOM 里已改，但 node.label 尚未结算
  expect((await editingState()).editing, "仍应处于编辑态");
  expect(await nodeLabel("node-source") === "收集材料", "结算前 node.label 仍是原值");
  await page.evaluate(() => flushPendingSave());
  expect(await nodeLabel("node-source") === "未失焦文字", `flushPendingSave 后文字应落盘，实际 ${await nodeLabel("node-source")}`);
  // reload 后应持久化
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(await nodeLabel("node-source") === "未失焦文字", "reload 后文字应仍在");
});

// ===== 场景4：编辑态按 Ctrl+Z 取消编辑，恢复原文字 =====
await run("编辑态 Ctrl+Z 取消", async () => {
  await fresh();
  await page.locator('[data-tool="select"]').click();
  await page.locator('[data-node-id="node-source"] .node-label').dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("临时乱改");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(60);
  expect(!(await editingState()).editing, "Ctrl+Z 后应退出编辑态");
  expect(await nodeLabel("node-source") === "收集材料", `应恢复原文字「收集材料」，实际 ${await nodeLabel("node-source")}`);
});

// ===== 场景5：编辑中直接 Shift 增选其他节点，编辑的文字应落盘 =====
await run("编辑中增选落盘", async () => {
  await fresh();
  await page.locator('[data-tool="select"]').click();
  await page.locator('[data-node-id="node-source"] .node-label').dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("增选前改名");
  const box = await vp();
  await page.keyboard.down("Shift");
  await page.mouse.click(box.x + 470 + 88, box.y + 300 + 46); // node-review
  await page.keyboard.up("Shift");
  await page.waitForTimeout(60);
  expect(await nodeLabel("node-source") === "增选前改名", `增选后编辑文字应落盘，实际 ${await nodeLabel("node-source")}`);
});

// ===== 场景6：inspector 聚焦但未修改，点空白后不留空撤销 =====
await run("inspector 空撤销", async () => {
  await fresh();
  await page.locator('[data-tool="select"]').click();
  const box = await vp();
  await page.mouse.click(box.x + 50 + 88, box.y + 300 + 46); // 选中 node-source
  const before = await historyLen();
  await page.locator("#inspectorName").click(); // 聚焦触发 beginInspectorEdit
  const during = await historyLen();
  expect(during === before + 1, `聚焦时应 push 一次历史，before=${before} during=${during}`);
  await page.mouse.click(box.x + 900, box.y + 700); // 点空白 blur，未修改
  await page.waitForTimeout(80);
  const after = await historyLen();
  expect(after === before, `未修改点空白后撤销栈应回到聚焦前，before=${before} after=${after}`);
});

// ===== 场景7：撤销后 inspector 输入框应清空（resetSelection 同步） =====
await run("撤销后输入框清空", async () => {
  await fresh();
  await page.locator('[data-tool="select"]').click();
  const box = await vp();
  await page.mouse.click(box.x + 50 + 88, box.y + 300 + 46);
  await page.locator("#inspectorName").fill("改名节点");
  await page.mouse.click(box.x + 900, box.y + 700);
  await page.waitForTimeout(60);
  expect(await nodeLabel("node-source") === "改名节点", "改名应生效");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(60);
  const nameVal = await page.evaluate(() => inspectorName.value);
  expect(nameVal === "", `撤销后名称输入框应清空，实际 ${JSON.stringify(nameVal)}`);
});

// ===== 场景8：导入后撤销栈清空，不可撤销导入 =====
await run("导入清空撤销栈", async () => {
  await fresh();
  await page.locator('[data-tool="select"]').click();
  const box = await vp();
  await page.mouse.click(box.x + 50 + 88, box.y + 300 + 46);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(40);
  expect(await historyLen() > 0, "删除操作后应有可撤销历史");
  const imported = { version: 1, activeCanvasId: "canvas-main", canvases: [{ id: "canvas-main", name: "导入画布", nodes: [{ id: "n1", type: "rect", x: 100, y: 100, w: 176, h: 92, label: "导入节点", note: "", marker: "待讨论" }], edges: [], view: { zoom: 1, panX: 0, panY: 0 } }] };
  await page.locator("#importInput").setInputFiles({ name: "import.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => activeCanvas().nodes.length) === 1, "导入后应替换为 1 个节点");
  expect(await historyLen() === 0, `导入后撤销栈应清空，实际 ${await historyLen()}`);
  await page.keyboard.press("Control+z");
  expect(await page.evaluate(() => activeCanvas().nodes.length) === 1, "导入后 Ctrl+Z 不应撤销导入");
});

// ===== 场景9：Ctrl+V 不应切换工具 =====
await run("Ctrl+V 不切工具", async () => {
  await fresh();
  await page.locator('[data-tool="text"]').click();
  expect(await tool() === "text", "前置：应处于 text 工具");
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(40);
  expect(await tool() === "text", `Ctrl+V 不应切换工具，实际 ${await tool()}`);
  await page.keyboard.press("Control+m");
  await page.waitForTimeout(40);
  expect(await tool() === "text", `Ctrl+M 不应切换工具，实际 ${await tool()}`);
});

// ===== 场景10：normalizeState 过滤指向不存在节点的连线 =====
await run("normalizeState 校验连线", async () => {
  await fresh();
  const bad = { version: 1, activeCanvasId: "canvas-main", canvases: [{ id: "canvas-main", name: "坏数据", nodes: [{ id: "a", type: "rect", x: 10, y: 10, w: 176, h: 92, label: "A", note: "", marker: "待讨论" }], edges: [{ id: "e1", from: "a", to: "不存在的节点" }, { id: "e2", from: "a", to: "a" }, { id: "e3", from: "a", to: "b" }], view: { zoom: 1, panX: 0, panY: 0 } }] };
  await page.locator("#importInput").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bad)) });
  await page.waitForTimeout(120);
  const st = await page.evaluate(() => ({ nodes: activeCanvas().nodes.length, edges: activeCanvas().edges.length }));
  expect(st.nodes === 1, `应有 1 个节点，实际 ${st.nodes}`);
  expect(st.edges === 0, `指向不存在节点/自环的连线应被过滤，实际 ${st.edges}`);
});

console.log(JSON.stringify({ results, errors }, null, 2));
await browser.close();
