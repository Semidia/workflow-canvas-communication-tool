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
await page.goto(url);
await page.waitForLoadState("networkidle");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForLoadState("networkidle");

// 记一下到底验了多少条：统一入口 run-all-acceptance.mjs 要靠这个数字报「通过=N」，
// 只报一串描述性字段的话它数不出条数，只能显示 ?（不是通过的意思）。
let assertCount = 0;
const expect = (condition, message) => {
  assertCount += 1;
  if (!condition) throw new Error(message);
};

const initialNodes = await page.locator(".node").count();
expect(initialNodes === 4, `expected 4 initial nodes, got ${initialNodes}`);
expect((await page.title()).includes("设计沟通画布"), "page title should use the general communication canvas name");
expect(await page.locator(".topbar-group-title").allTextContents().then((items) => JSON.stringify(items) === JSON.stringify(["画布", "编辑", "文件", "模块"])), "topbar groups should be canvas/edit/file/module");
const paletteSections = await page.locator(".palette-section-title").allTextContents();
expect(JSON.stringify(paletteSections) === JSON.stringify(["操作", "节点"]), `expected 操作/节点 groups, got ${JSON.stringify(paletteSections)}`);
expect(await page.locator('[aria-labelledby="palette-actions-title"] [data-tool]').count() === 4, "operation group should contain 4 tools");
expect(await page.locator('[aria-labelledby="palette-nodes-title"] [data-tool]').count() === 5, "node group should contain 5 tools");
expect(JSON.stringify(await page.locator('[aria-labelledby="palette-nodes-title"] small').allTextContents()) === JSON.stringify(["步骤", "判断", "开始/结束", "材料", "提醒"]), "node tools should use purpose names");
expect(await page.locator(".node-marker").count() === initialNodes, "every node should show a discussion marker");

const source = page.locator('.node[data-node-id="node-source"]');
const sourceBox = await source.boundingBox();
expect(Boolean(sourceBox), "source node is not visible");
await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
await page.mouse.down();
await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 90, sourceBox.y + sourceBox.height / 2 + 35);
await page.mouse.up();
const movedLeft = await source.evaluate((element) => element.style.left);
expect(movedLeft !== "220px", "node drag did not change position");

await page.locator('.node[data-node-id="node-source"]').click();
expect(await page.locator("#inspectorForm").isVisible(), "node inspector should open after node selection");
expect(await page.locator('.resize-handle[data-node-id="node-source"]').count() === 0, "resize handles should stay hidden after selecting a node");
expect(await page.locator('.resize-toggle[data-node-id="node-source"]').isVisible(), "selected node should show resize toggle");
await page.locator('.resize-toggle[data-node-id="node-source"]').click();
expect(await page.locator('.resize-handle[data-node-id="node-source"]').count() === 4, "document node should show four corner resize handles");
expect(await page.locator('.resize-toggle[data-node-id="node-source"]').getAttribute("aria-pressed") === "true", "resize toggle should report active state");
const resizePortOverlap = await page.locator('.node[data-node-id="node-source"]').evaluate((node) => {
  const rects = (selector) => [...node.parentElement.querySelectorAll(selector)].map((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  });
  const ports = rects(".port");
  const handles = rects(".resize-handle");
  return handles.some((handle) => ports.some((port) => handle.left < port.right && handle.right > port.left && handle.top < port.bottom && handle.bottom > port.top));
});
expect(!resizePortOverlap, "resize handles should not overlap connection ports");
let resizeHandle = page.locator('.resize-handle[data-node-id="node-source"][data-handle="se"]');
let resizeBox = await resizeHandle.boundingBox();
expect(Boolean(resizeBox), "south-east resize handle should be visible");
await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
await page.mouse.down();
await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 80, resizeBox.y + resizeBox.height / 2 + 40);
await page.mouse.up();
const resizedWidth = Number.parseFloat(await page.locator('.node[data-node-id="node-source"]').evaluate((element) => element.style.width));
const resizedHeight = Number.parseFloat(await page.locator('.node[data-node-id="node-source"]').evaluate((element) => element.style.minHeight));
expect(resizedWidth > 176 && resizedHeight > 92, `resize should increase node dimensions, got ${resizedWidth}x${resizedHeight}`);
resizeHandle = page.locator('.resize-handle[data-node-id="node-source"][data-handle="se"]');
resizeBox = await resizeHandle.boundingBox();
await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
await page.mouse.down();
await page.mouse.move(resizeBox.x - 1000, resizeBox.y - 1000);
await page.mouse.up();
const minimumWidth = Number.parseFloat(await page.locator('.node[data-node-id="node-source"]').evaluate((element) => element.style.width));
const minimumHeight = Number.parseFloat(await page.locator('.node[data-node-id="node-source"]').evaluate((element) => element.style.minHeight));
// 高度下限不是写死的 92，而是 max(类型最小高度 92, 内容自然高度)。
// 实测（probe-minheight.mjs）：document 节点「收集材料 / 已决定」这一套内容，
// 上下内边距各 12px + 标签 18px + 标记 17px + 行距，自然高度就是 93px，与宽度无关
// （176/140/120 三档都是 93）。也就是说 NODE_MIN_SIZES.document.h = 92 这个常量
// 天生比内容矮 1px、永远够不着，真正生效的是内容高度 93。产品取 93 是对的：
// 若强行压到 92 就会裁掉 1px 内容。这里断言「宽度夹到 120、高度不低于类型下限」。
expect(minimumWidth === 120 && minimumHeight >= 92, `resize should clamp to minimum width 120 and at least height 92, got ${minimumWidth}x${minimumHeight}`);
resizeHandle = page.locator('.resize-handle[data-node-id="node-source"][data-handle="se"]');
resizeBox = await resizeHandle.boundingBox();
await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
await page.mouse.down();
await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 80, resizeBox.y + resizeBox.height / 2 + 40);
await page.mouse.up();
const sizeBeforeCancel = await page.locator('.node[data-node-id="node-source"]').evaluate((element) => ({
  width: Number.parseFloat(element.style.width),
  height: Number.parseFloat(element.style.minHeight),
}));
resizeHandle = page.locator('.resize-handle[data-node-id="node-source"][data-handle="se"]');
resizeBox = await resizeHandle.boundingBox();
await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
await page.mouse.down();
await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 30, resizeBox.y + resizeBox.height / 2 + 15);
await page.locator("#viewport").dispatchEvent("pointercancel", { pointerId: 1 });
// dispatchEvent 只是把 pointercancel 事件塞进 DOM，浏览器自己的输入状态并不知道
// 「这次按下的指针已经取消」——鼠标按键仍是按下状态，缩放开始时底层调用的
// setPointerCapture 也仍然生效。于是后面每一次真实点击都会被浏览器重定向到那个
// 捕获元素（此处是 #viewport），而不是鼠标指针实际所在的位置，后面的字段点击就会
// 变成「点了画布空白处」，从而清空选中、收起检视面板。真实的 pointercancel 由浏览器
// 自己发出（触摸被系统打断等），会同时解除捕获，不会留下这种错位。这里补一次
// mouse.up() 把物理按键状态收干净，才等价于一次真实的「手势被取消」。
await page.mouse.up();
const sizeAfterCancel = await page.locator('.node[data-node-id="node-source"]').evaluate((element) => ({
  width: Number.parseFloat(element.style.width),
  height: Number.parseFloat(element.style.minHeight),
}));
expect(sizeAfterCancel.width === sizeBeforeCancel.width && sizeAfterCancel.height === sizeBeforeCancel.height, `pointercancel should restore ${sizeBeforeCancel.width}x${sizeBeforeCancel.height}, got ${sizeAfterCancel.width}x${sizeAfterCancel.height}`);
expect(await page.locator("#inspectorName").inputValue() === "收集材料", "inspector should show selected node name");
expect(await page.locator("#previousCount").textContent() === "0", "source node should have no previous nodes");
expect(await page.locator("#nextCount").textContent() === "1", "source node should show one next node");
await page.locator("#inspectorName").fill("材料入口");
await page.locator("#inspectorNote").fill("用于说明输入从哪里来");
await page.locator("#inspectorMarker").selectOption("已决定");
await page.locator("#inspectorType").click();
expect(await page.locator('.node[data-node-id="node-source"] .node-label').textContent() === "材料入口", "inspector name edit should update node");
expect(await page.locator('.node[data-node-id="node-source"] .node-marker').textContent() === "已决定", "discussion marker should update node");
expect(await page.locator("#nextNodes .relation-item").textContent() === "形成判断", "inspector should list next node");
await page.locator("#nextNodes .relation-item").click();
expect(await page.locator("#inspectorName").inputValue() === "形成判断", "relation item should select related node");

await page.locator('[data-tool="text"]').click();
const viewport = await page.locator("#viewport").boundingBox();
expect(Boolean(viewport), "viewport is not visible");
await page.mouse.dblclick(viewport.x + 760, viewport.y + 260);
await page.keyboard.type("文字节点");
await page.keyboard.press("Enter");
const textNodeCount = await page.locator(".node-label").filter({ hasText: "文字节点" }).count();
expect(textNodeCount === 1, "text node editing failed");

await page.locator('[data-tool="triangle"]').click();
const shapePoint = await page.locator("#viewport").boundingBox();
await page.locator("#viewport").click({ position: { x: Math.min(360, shapePoint.width - 40), y: Math.min(220, shapePoint.height - 40) } });
const triangleNode = page.locator(".node.shape-triangle").last();
const triangleNodeId = await triangleNode.getAttribute("data-node-id");
await triangleNode.click();
await triangleNode.locator(".resize-toggle").click();
expect(await page.locator(`.resize-handle[data-node-id="${triangleNodeId}"]`).count() === 3, "triangle node should show three vertex resize handles");

await page.locator('[data-tool="diamond"]').click();
await page.locator("#viewport").click({ position: { x: Math.min(500, shapePoint.width - 40), y: Math.min(220, shapePoint.height - 40) } });
const diamondNode = page.locator(".node.shape-diamond").last();
const diamondNodeId = await diamondNode.getAttribute("data-node-id");
await diamondNode.click();
await diamondNode.locator(".resize-toggle").click();
expect(await page.locator(`.resize-handle[data-node-id="${diamondNodeId}"]`).count() === 4, "diamond node should show four vertex resize handles");

await page.locator('[data-tool="connector"]').click();
await page.locator('.node[data-node-id="node-source"]').click();
await page.locator('.node[data-node-id="node-review"]').click();
const edgeCount = await page.locator(".edge").count();
expect(edgeCount === 4, `expected 4 edges after connecting, got ${edgeCount}`);
await page.locator('[data-action="undo"]').click();
const edgeCountAfterUndo = await page.locator(".edge").count();
expect(edgeCountAfterUndo === 3, `expected 3 edges after undo, got ${edgeCountAfterUndo}`);
await page.locator('[data-action="redo"]').click();
const edgeCountAfterRedo = await page.locator(".edge").count();
expect(edgeCountAfterRedo === 4, `expected 4 edges after redo, got ${edgeCountAfterRedo}`);

await page.locator('[data-action="zoom-reset"]').click();
await page.locator('[data-action="zoom-in"]').click();
const zoomAfterIn = await page.locator("#zoomValue").textContent();
expect(zoomAfterIn === "105%", `expected 105% after one zoom-in, got ${zoomAfterIn}`);
await page.waitForTimeout(750);
const saveStatusAfterAutoSave = await page.locator("#saveStatus").textContent();
expect(saveStatusAfterAutoSave === "已自动保存", `expected automatic save status, got ${saveStatusAfterAutoSave}`);
await page.reload();
await page.waitForLoadState("networkidle");
const zoomAfterAutoSaveReload = await page.locator("#zoomValue").textContent();
expect(zoomAfterAutoSaveReload === "105%", `expected 105% after autosave reload, got ${zoomAfterAutoSaveReload}`);
const resizedWidthAfterReload = Number.parseFloat(await page.locator('.node[data-node-id="node-source"]').evaluate((element) => element.style.width));
expect(resizedWidthAfterReload > 120, `expected resized width to persist after reload, got ${resizedWidthAfterReload}`);
await page.locator('[data-action="zoom-reset"]').click();
await page.reload();
await page.waitForLoadState("networkidle");
const zoomAfterImmediateReload = await page.locator("#zoomValue").textContent();
expect(zoomAfterImmediateReload === "100%", `expected immediate reload flush to save 100%, got ${zoomAfterImmediateReload}`);
await page.locator('[data-action="zoom-reset"]').click();
for (let i = 0; i < 18; i += 1) await page.locator('[data-action="zoom-out"]').click();
const zoomAtTen = await page.locator("#zoomValue").textContent();
expect(zoomAtTen === "10%", `expected 10% before fine step, got ${zoomAtTen}`);
await page.locator('[data-action="zoom-out"]').click();
const zoomAtFive = await page.locator("#zoomValue").textContent();
expect(zoomAtFive === "5%", `expected 5% at coarse/fine boundary, got ${zoomAtFive}`);
await page.locator('[data-action="zoom-out"]').click();
const zoomAtFour = await page.locator("#zoomValue").textContent();
expect(zoomAtFour === "4%", `expected 4% after fine step, got ${zoomAtFour}`);
for (let i = 0; i < 3; i += 1) await page.locator('[data-action="zoom-out"]').click();
const zoomAtMinimum = await page.locator("#zoomValue").textContent();
expect(zoomAtMinimum === "1%", `expected 1% minimum, got ${zoomAtMinimum}`);
await page.locator('[data-action="zoom-out"]').click();
const zoomClamped = await page.locator("#zoomValue").textContent();
expect(zoomClamped === "1%", `expected minimum clamp at 1%, got ${zoomClamped}`);
await page.locator('[data-action="zoom-reset"]').click();

const saveFailureStatus = await page.evaluate(async () => {
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function failSetItem() {
    throw new DOMException("quota", "QuotaExceededError");
  };
  document.querySelector('[data-action="zoom-in"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 750));
  const status = document.querySelector("#saveStatus")?.textContent;
  Storage.prototype.setItem = originalSetItem;
  return status;
});
expect(saveFailureStatus === "自动保存失败", `expected automatic save failure status, got ${saveFailureStatus}`);

await page.reload();
await page.waitForLoadState("networkidle");
const legacyCompatibility = await page.evaluate(() => {
  const legacy = { version: 1, activeCanvasId: "legacy", canvases: [{ id: "legacy", name: "旧稿", nodes: [{ id: "legacy-node", type: "rect", x: 120, y: 120, w: 176, h: 80, label: "旧节点", note: "没有新字段" }], edges: [], view: { zoom: 1, panX: 0, panY: 0 } }] };
  localStorage.removeItem("workflow-canvas-communication-draft-v1");
  localStorage.setItem("workflow-canvas-legal-blueprint-v1", JSON.stringify(legacy));
  return legacy;
});
await page.reload();
await page.waitForLoadState("networkidle");
expect(await page.locator(".node").count() === 1, "legacy JSON should still load");
expect(await page.locator(".node-marker").textContent() === "待讨论", "legacy node should receive default discussion marker");
const storageMigration = await page.evaluate(() => ({
  current: Boolean(localStorage.getItem("workflow-canvas-communication-draft-v1")),
  legacy: Boolean(localStorage.getItem("workflow-canvas-legal-blueprint-v1")),
}));
expect(storageMigration.current && !storageMigration.legacy, "legacy draft should migrate to the generic storage key");

await page.screenshot({ path: `${screenshotDir}/工作流画布-1440.png`, fullPage: true });

console.log(JSON.stringify({
  initialNodes,
  paletteSections,
  movedLeft,
  textNodeCount,
  edgeCount,
  edgeCountAfterRedo,
  zoomAfterIn,
  saveStatusAfterAutoSave,
  zoomAfterAutoSaveReload,
  zoomAfterImmediateReload,
  saveFailureStatus,
  storageMigration,
  zoomAtFive,
  zoomAtMinimum,
  zoomClamped,
  edgeCountAfterUndo,
  inspectorName: "材料入口",
  inspectorMarker: "已决定",
  resizedWidth,
  resizedHeight,
  minimumWidth,
  minimumHeight,
  sizeBeforeCancel,
  sizeAfterCancel,
  resizedWidthAfterReload,
  legacyCompatibility: "marker defaulted to 待讨论",
  断言总数: assertCount,
  errors,
}, null, 2));
await browser.close();
