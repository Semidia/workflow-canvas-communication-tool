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
const dialogs = [];
// 导入动作会先弹「导入将整体替换当前所有画布，是否继续？」的确认框。Playwright 在没人
// 接对话框时默认「取消」，等于导入被静默放弃，后面的断言会看到一个没被替换的旧画布。
// 这里统一按下「确定」，与用户真去点「是」等价；同时把弹窗原文记进 dialogs 一并输出，
// 万一有预期之外的弹窗（比如某个操作偷偷弹了确认框）能在结果里看见，不会被静默吞掉。
page.on("dialog", (dialog) => { dialogs.push(dialog.message()); return dialog.accept(); });

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
// 合并版只有「一条全局撤销栈」：变量名就叫 history，由 app.js 用 let 声明成全局绑定，
// 会遮住浏览器自带的 window.history。B 线那种「每个画布各有一条栈」的 canvasStack
// 在合并版里不存在（那是 B 独有的结构），所以这里读全局 history。
const historyLen = () => page.evaluate(() => history.length);
const appHistoryIsGlobalStack = () => page.evaluate(() => Array.isArray(history) && history !== window.history);
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

// ===== 场景6：inspector 聚焦，但没真改动，不能往撤销栈里塞空记录 =====
//
// B 线的实现是「聚焦就 push 一条历史，离开时发现没改再 pop 回来」，所以原断言写成
// 「聚焦 +1、未修改回落」。合并版保留的是 A 线的写法：聚焦（beginInspectorEdit）只记下
// 进入前的值、不推历史；直到真的改动了某个字段（updateInspectorField 里
// `node[field] !== value`）才 push 一次；离开时若值已回到进入前，就 popRollback 把这条
// 撤回。两种写法要达到的目的完全一样——**不留下一条什么也没做的撤销记录**（否则用户按
// Ctrl+Z 会觉得「按了没反应」）。所以这里按 A 线语义重写断言，并且把「改了又改回去」
// 这条真正的空撤销路径测到，而不是只测「聚焦」这个动作。
await run("inspector 空撤销", async () => {
  await fresh();
  expect(await appHistoryIsGlobalStack(), "history 应解析到 app.js 的全局撤销栈，而不是浏览器自带的 window.history");
  await page.locator('[data-tool="select"]').click();
  const box = await vp();
  await page.mouse.click(box.x + 50 + 88, box.y + 300 + 46); // 选中 node-source
  const before = await historyLen();
  await page.locator("#inspectorName").click(); // 聚焦（beginInspectorEdit）
  expect(await historyLen() === before, `仅聚焦不应推历史，before=${before} 聚焦后=${await historyLen()}`);
  await page.mouse.click(box.x + 900, box.y + 700); // 点空白 blur，未修改
  await page.waitForTimeout(80);
  expect(await historyLen() === before, `未修改就离开，撤销栈不应变动，before=${before} after=${await historyLen()}`);
  // 真正的空撤销路径：改一下（推一条）→ 又改回进入前的原值 → 离开时应把那条撤回。
  // 注意：上一步点空白已经把选中清掉了（合并版点画布空白会取消选中），所以要先重新选中
  // 这个节点才能再摸检视面板；单纯「选中节点」本身不推历史（选择不算一次改动）。
  await page.mouse.click(box.x + 50 + 88, box.y + 300 + 46); // 重新选中 node-source
  expect(await historyLen() === before, `重新选中不应改变撤销栈，before=${before} after=${await historyLen()}`);
  await page.locator("#inspectorName").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("临时改一下");
  expect(await historyLen() === before + 1, `真改动后应推一条历史，before=${before} 改后=${await historyLen()}`);
  await page.keyboard.press("Control+a");
  await page.keyboard.type("收集材料"); // 改回进入前的原值
  await page.mouse.click(box.x + 900, box.y + 700);
  await page.waitForTimeout(80);
  expect(await nodeLabel("node-source") === "收集材料", `改回原值后节点文字应仍是「收集材料」，实际 ${await nodeLabel("node-source")}`);
  expect(await historyLen() === before, `改回原值再离开应撤回那条空历史，before=${before} after=${await historyLen()}`);
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

// ===== 场景8：导入是「整体替换」，所以能撤销（A 线语义；与 B 线原断言相反，待曈曈拍板） =====
//
// 【待确认｜设计分歧，需幸福的曈曈拍板】B 线原本断言「导入后撤销栈清空、导入不可撤销」。
// 合并版保留的是 A 线的写法：导入前 pushHistory() 一次，所以撤销能把导入前的画布整体
// 找回来。这与 module-fixes 场景 6（关闭画布可撤销）是同一族取舍——A 线一贯主张
// 「会吃掉用户内容的操作都留一条退路」。
// 保留 A 线语义的理由：导入是整体替换，误选一个文件就会把当前所有画布换掉，留一条撤销
// 是最省事的安全网；而且与「关闭画布可撤销」保持一致，用户不必记两套规则。
// 代价：导入后按 Ctrl+Z 会把文件内容撤掉、回到导入前，用户可能觉得「怎么又变回去了」
// （界面会提示「已撤销」，不算静默）。
// 在曈曈确认前，本场景按合并版的真实行为断言：导入可撤销、且重做能回到导入后的状态。
await run("导入可撤销且可重做", async () => {
  await fresh();
  await page.locator('[data-tool="select"]').click();
  const box = await vp();
  await page.mouse.click(box.x + 50 + 88, box.y + 300 + 46);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(40);
  const afterDelete = await page.evaluate(() => activeCanvas().nodes.length);
  expect(afterDelete === 3, `删掉一个节点后应剩 3 个，实际 ${afterDelete}`);
  expect(await historyLen() > 0, "删除操作后应有可撤销历史");
  const beforeImport = await historyLen();
  const imported = { version: 1, activeCanvasId: "canvas-main", canvases: [{ id: "canvas-main", name: "导入画布", nodes: [{ id: "n1", type: "rect", x: 100, y: 100, w: 176, h: 92, label: "导入节点", note: "", marker: "待讨论" }], edges: [], view: { zoom: 1, panX: 0, panY: 0 } }] };
  await page.locator("#importInput").setInputFiles({ name: "import.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await page.waitForTimeout(120);
  const afterImport = () => page.evaluate(() => activeCanvas().nodes.length);
  expect(await afterImport() === 1, `导入后应替换为 1 个节点，实际 ${await afterImport()}`);
  expect(await historyLen() === beforeImport + 1, `导入应推一条历史，before=${beforeImport} 导入后=${await historyLen()}`);
  await page.locator('[data-action="undo"]').click();
  await page.waitForTimeout(80);
  expect(await afterImport() === 3, `撤销导入应找回导入前的 3 个节点，实际 ${await afterImport()}`);
  await page.locator('[data-action="redo"]').click();
  await page.waitForTimeout(80);
  expect(await afterImport() === 1, `重做应回到导入后的 1 个节点，实际 ${await afterImport()}`);
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

console.log(JSON.stringify({ results, dialogs, errors }, null, 2));
await browser.close();
