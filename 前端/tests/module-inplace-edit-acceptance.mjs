import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire("D:/nodejs/npm-global/package.json");
const { chromium } = require("playwright");
import { resolveCanvasUrl } from "./_served-target.mjs";
const url = await resolveCanvasUrl(process.argv[2]);
const screenshotDir = process.argv[3] || "D:/agent临时/郄的工作流画布沟通工具验收";
fs.mkdirSync(screenshotDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));

let assertCount = 0;
const expect = (condition, message) => {
  assertCount += 1;
  if (!condition) throw new Error(message);
};

const fresh = async () => {
  await page.evaluate(() => { isDirty = false; clearTimeout(autosaveTimer); autosaveTimer = null; localStorage.clear(); });
  await page.reload();
  await page.waitForLoadState("networkidle");
};

const lib = () => page.evaluate(() => JSON.parse(localStorage.getItem("workflow-canvas-module-library-v1") || "[]"));
const nodeCount = () => page.locator(".node").count();
const editBarVisible = () => page.locator("#moduleEditBar").isVisible();
const moduleLabels = async () => (await lib())[0].nodes.map((n) => n.label).join("|");

// 框选画布左半部分（覆盖 node-source + node-analysis），封装为模块
const encapsulate = async (name) => {
  await page.locator('[data-tool="marquee"]').click();
  const vp = await page.locator("#viewport").boundingBox();
  await page.mouse.move(vp.x + 40, vp.y + 280);
  await page.mouse.down();
  await page.mouse.move(vp.x + 400, vp.y + 400);
  await page.mouse.up();
  page.once("dialog", (dialog) => dialog.accept(name));
  await page.locator('#multiSelectPanel [data-action="save-module"]').click();
};

const openEdit = async () => {
  await page.locator('[data-action="open-modules"]').click();
  await page.locator('[data-module-action="edit"]').click();
};

// 按节点 id 定位（画布上同名节点会有多个，按文字找会找错）
const idByLabel = (label) => page.evaluate((lb) => activeCanvas().nodes.find((x) => x.label === lb)?.id ?? null, label);
const firstModuleNodeId = () => page.evaluate(() => [...moduleEditing.nodeIds][0]);

// 双击指定节点，改文字，回车提交（Escape 是取消编辑，会把改动还原）
// 用 mouse.dblclick 而不是连点两次 click：产品进编辑态靠的是浏览器的 dblclick 事件
// （viewport 的 dblclick 监听），两次独立 click 会不会合成 dblclick 取决于两次之间
// 的间隔是否落在系统双击判定窗口内，不稳定；dblclick 明确带 clickCount=2。
const retypeById = async (nodeId, text) => {
  if (!nodeId) throw new Error(`画布上找不到要改文字的节点：${nodeId}`);
  const node = page.locator(`[data-node-id="${nodeId}"]`);
  const box = await node.locator(".node-label").boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(120);
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(120);
};
const labelOf = (nodeId) => page.evaluate((id) => activeCanvas().nodes.find((n) => n.id === id)?.label ?? null, nodeId);
const retypeFirstModuleNode = async (text) => retypeById(await firstModuleNodeId(), text);

await page.goto(url);
await page.waitForLoadState("networkidle");
await fresh();

// ===== 场景 1：打开 → 改文字 → 保存回模块 =====
await encapsulate("就地编辑模块");
expect((await lib()).length === 1, "场景1 应先封装出 1 个模块");
const labelsBefore = await moduleLabels();
expect((await nodeCount()) === 4, `场景1 初始画布应有 4 个节点，实际 ${await nodeCount()}`);

await openEdit();
expect(await page.locator("#moduleModal").isHidden(), "打开编辑后模块库弹窗应关闭");
expect(await editBarVisible(), "应显示模块编辑条");
expect((await page.locator("#moduleEditName").textContent()) === "就地编辑模块", "编辑条应显示模块名");
expect((await nodeCount()) === 6, `打开编辑应把模块 2 个节点叠加到画布上（4+2），实际 ${await nodeCount()}`);
expect((await page.locator(".edge").count()) === 4, `连线应为 3+1=4，实际 ${await page.locator(".edge").count()}`);
expect((await page.locator(".node.is-in-selection").count()) === 2, "模块内容应高亮，便于识别哪几个节点属于模块");

const moduleNodeId = await firstModuleNodeId();
await retypeById(moduleNodeId, "改过的名字");
expect((await labelOf(moduleNodeId)) === "改过的名字", "模块节点文字应改成 改过的名字");

await page.locator('[data-action="save-module-edit"]').click();
expect(await editBarVisible() === false, "保存后编辑条应隐藏");
const after1 = await lib();
expect(after1.length === 1, `保存回模块不应新增条目，实际 ${after1.length} 条`);
expect(after1[0].name === "就地编辑模块", "模块名不应变");
expect((await moduleLabels()) !== labelsBefore, "模块内文字应已被更新");
expect(after1[0].nodes.some((n) => n.label === "改过的名字"), "模块里应存下新文字");
expect(after1[0].nodes.length === 2, `模块节点数应仍为 2，实际 ${after1[0].nodes.length}`);
const minX = Math.min(...after1[0].nodes.map((n) => n.x));
const minY = Math.min(...after1[0].nodes.map((n) => n.y));
expect(minX === 0 && minY === 0, `模块相对坐标应重新归零，实际 minX=${minX} minY=${minY}`);
expect((await nodeCount()) === 6, `保存后画布内容不应被吃掉，仍应是 6 个节点，实际 ${await nodeCount()}`);

await page.locator('[data-action="open-modules"]').click();
await page.locator('[data-module-action="place"]').click();
expect((await page.locator(".node-label").allTextContents()).includes("改过的名字"), "放置出来的新实例应带着改过的文字");
expect((await nodeCount()) === 8, `再放置一份应为 6+2=8 个节点，实际 ${await nodeCount()}`);

// ===== 场景 2：取消编辑不改动原模块 =====
await fresh();
await encapsulate("取消编辑模块");
const labels2 = await moduleLabels();
await openEdit();
expect(await editBarVisible(), "场景2 编辑条应显示");
await retypeFirstModuleNode("不该被保存");
await page.locator('[data-action="cancel-module-edit"]').click();
expect(await editBarVisible() === false, "取消编辑后编辑条应隐藏");
const after2 = await lib();
expect(after2.length === 1, `取消编辑不应增删模块，实际 ${after2.length}`);
expect((await moduleLabels()) === labels2, "取消编辑后模块内容必须原封不动");
expect((await page.locator(".node-label").allTextContents()).includes("不该被保存"), "取消编辑后画布上的改动应保留（只是没写回模块）");

// ===== 场景 3：编辑中不能重复打开 / 不能删该模块 / 不能新建画布 =====
await fresh();
await encapsulate("锁定模块");
await openEdit();
await page.locator('[data-action="open-modules"]').click();
await page.locator('[data-module-action="edit"]').click();
expect((await page.locator("#toast").textContent()).includes("正在编辑模块"), "重复打开应提示已在编辑中");
expect(await editBarVisible(), "重复打开不应破坏当前编辑态");

await page.locator('[data-module-action="delete"]').click();
expect((await page.locator(".module-item").count()) === 1, "编辑中的模块不应被删除");
expect((await page.locator("#toast").textContent()).includes("正在编辑中"), "删除编辑中模块应给出提示");
await page.locator('[data-action="close-modules"]').click();

await page.locator('#newCanvasButton').click();
expect((await page.locator(".canvas-tab").count()) === 1, `编辑中不应新建出画布，实际 ${await page.locator(".canvas-tab").count()} 个标签`);
expect((await page.locator("#toast").textContent()).includes("正在编辑中"), "编辑中新建画布应给出提示");

await page.locator('[data-action="save-module-edit"]').click();
page.once("dialog", (dialog) => dialog.accept("新画布"));
await page.locator('#newCanvasButton').click();
expect((await page.locator(".canvas-tab").count()) === 2, "保存后应解除锁定，可以正常新建画布");

// ===== 场景 4：编辑中新增的节点会被算进模块 =====
await fresh();
await encapsulate("加节点模块");
await openEdit();
const before4 = await nodeCount();
await page.locator('[data-tool="rect"]').click();
const vp4 = await page.locator("#viewport").boundingBox();
await page.mouse.click(vp4.x + 300, vp4.y + 620);
expect((await nodeCount()) === before4 + 1, `编辑中新增节点后画布应 +1，实际 ${await nodeCount()}`);
await page.locator('[data-action="save-module-edit"]').click();
const after4 = await lib();
expect(after4[0].nodes.length === 3, `编辑中新增的节点应被存进模块，实际 ${after4[0].nodes.length} 个`);
expect((await page.locator("#toast").textContent()).includes("3 个节点"), "提示应显示更新后的节点数");

// ===== 场景 5：编辑中删空节点后保存应被拒绝 =====
await openEdit();
await page.locator('[data-tool="marquee"]').click();
const vp5 = await page.locator("#viewport").boundingBox();
await page.mouse.move(vp5.x + 10, vp5.y + 10);
await page.mouse.down();
await page.mouse.move(vp5.x + 900, vp5.y + 700);
await page.mouse.up();
await page.keyboard.press("Delete");
expect((await nodeCount()) === 0, `应已删空画布节点，实际 ${await nodeCount()}`);
await page.locator('[data-action="save-module-edit"]').click();
expect((await page.locator("#toast").textContent()).includes("删空"), "删空后保存应被拒绝并提示");
expect(await editBarVisible(), "被拒绝后应仍处于编辑态");
expect((await lib())[0].nodes.length === 3, `被拒绝后模块内容不应被破坏，实际 ${(await lib())[0].nodes.length} 个`);

// ===== 场景 6：编辑中刷新页面，模块不受影响 =====
await page.reload();
await page.waitForLoadState("networkidle");
expect(await editBarVisible() === false, "刷新后编辑条不应残留（编辑态不跨刷新）");
expect((await lib())[0].nodes.length === 3, `刷新后模块内容应完好，实际 ${(await lib())[0].nodes.length} 个`);

await page.screenshot({ path: `${screenshotDir}/模块就地编辑验收.png`, fullPage: true });

console.log(JSON.stringify({
  场景1: "打开编辑 → 叠加到画布 → 改文字 → 保存回模块：就地更新、不新增条目、相对坐标归零、画布内容不被吃掉",
  场景2: "取消编辑不改动原模块，画布上的改动保留",
  场景3: "编辑中禁止重复打开 / 禁止删除该模块 / 禁止新建画布，保存后解除锁定",
  场景4: "编辑中新增的节点会被算进模块",
  场景5: "编辑中删空节点后保存被拒绝，模块内容不被破坏",
  场景6: "编辑中刷新页面，模块内容不受影响",
  断言总数: assertCount,
  errors,
}, null, 2));
await browser.close();
