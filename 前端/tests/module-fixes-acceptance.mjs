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
const nodes = () => page.evaluate(() => activeCanvas().nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h })));
const view = () => page.evaluate(() => ({ zoom: activeCanvas().view.zoom, panX: activeCanvas().view.panX, panY: activeCanvas().view.panY }));
const activeId = () => page.evaluate(() => state.activeCanvasId);
const canvasCount = () => page.evaluate(() => state.canvases.length);
const libLen = () => page.evaluate(() => JSON.parse(localStorage.getItem("workflow-canvas-module-library-v1") || "[]").length);
const multiCount = () => page.evaluate(() => selectedNodeIds.size);

const marqueeSelect = async (x1, y1, x2, y2) => {
  const box = await vp();
  await page.locator('[data-tool="marquee"]').click();
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 6 });
  await page.mouse.up();
};
const makeModule = async (name) => {
  page.once("dialog", (d) => d.accept(name));
  await page.locator('#multiSelectPanel [data-action="save-module"]').click();
};
const placeFirst = async () => {
  await page.locator('[data-action="open-modules"]').click();
  await page.locator('.module-item').first().locator('[data-module-action="place"]').click();
};

await page.goto(url);
await page.waitForLoadState("networkidle");

// ===== 场景 1：连续放置不重叠（modulePlaceOffset） =====
await fresh();
await marqueeSelect(40, 280, 400, 400);
await makeModule("偏移模块");
await placeFirst();
const place1 = (await nodes()).slice(-2).map((n) => `${n.x},${n.y}`);
await placeFirst();
const place2 = (await nodes()).slice(-2).map((n) => `${n.x},${n.y}`);
expect(place1.join("|") !== place2.join("|"), `连续放置应有偏移，实际两次坐标完全相同 ${place1.join("|")}`);
results.push("场景1 连续放置不重叠：通过");

// ===== 场景 2：pan 很远后放置，节点坐标被 clamp 到画布内 =====
await fresh();
await marqueeSelect(40, 280, 400, 400);
await makeModule("越界模块");
await page.locator('[data-tool="select"]').click();
{
  const box = await vp();
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(box.x + 300, box.y + 650);
    await page.mouse.down();
    await page.mouse.move(box.x + 300 - 900, box.y + 650, { steps: 6 });
    await page.mouse.up();
  }
}
await placeFirst();
const placed = (await nodes()).slice(-2);
const outOfBounds = placed.filter((n) => n.x < 10 || n.y < 10 || n.x > 2400 - n.w || n.y > 1500 - n.h);
expect(outOfBounds.length === 0, `放置节点越界：${JSON.stringify(outOfBounds)}`);
results.push("场景2 放置越界 clamp：通过");

// ===== 场景 3：封装不进撤销栈（Ctrl+Z 不删除模块库） =====
await fresh();
await marqueeSelect(40, 280, 400, 400);
await makeModule("撤销模块");
expect(await libLen() === 1, "封装后模块库应有 1 条");
await page.keyboard.press("Control+z");
expect(await libLen() === 1, `模块库操作不进撤销栈，Ctrl+Z 后模块库应仍为 1 条，实际 ${await libLen()}`);
results.push("场景3 封装不进撤销栈：通过");

// ===== 场景 4：撤销不跳视图（放置→平移→撤销，view 不变） =====
await fresh();
await marqueeSelect(40, 280, 400, 400);
await makeModule("视图模块");
await page.locator('[data-tool="select"]').click();
await placeFirst();
{
  const box = await vp();
  await page.mouse.move(box.x + 900, box.y + 650);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 200, { steps: 8 });
  await page.mouse.up();
}
const viewAfterPan = await view();
await page.keyboard.press("Control+z");
const viewAfterUndo = await view();
expect(
  viewAfterUndo.zoom === viewAfterPan.zoom && viewAfterUndo.panX === viewAfterPan.panX && viewAfterUndo.panY === viewAfterPan.panY,
  `撤销后视图不应跳，pan 后 ${JSON.stringify(viewAfterPan)} 撤销后 ${JSON.stringify(viewAfterUndo)}`
);
results.push("场景4 撤销不跳视图：通过");

// ===== 场景 5：切到另一画布后撤销，不跳回原画布 =====
await fresh();
page.once("dialog", (d) => d.accept("画布B"));
await page.locator('#newCanvasButton').click();
await page.locator('.canvas-tab[data-canvas-id="canvas-main"]').click();
await marqueeSelect(40, 280, 400, 400);
await makeModule("跳画布模块");
await placeFirst();
await page.locator('.canvas-tab').last().click();
const beforeUndo = await activeId();
await page.keyboard.press("Control+z");
expect(await activeId() === beforeUndo, `切到画布 B 后撤销不应跳回主画布，撤销前 ${beforeUndo} 撤销后 ${await activeId()}`);
results.push("场景5 撤销不跳画布：通过");

// ===== 场景 6：关闭画布可撤销，撤销后画布连同内容一起回来 =====
//
// 【待确认｜设计分歧，需幸福的曈曈拍板】B 线原本断言「关闭画布不可撤销」，
// 但那是 B 线「每个画布各有一条独立历史栈」结构的自然结果——画布一关，它那条栈
// 也就没了，所以想撤也撤不回来，并非刻意做的安全设计。合并版保留了 A 线的
// 「一条全局历史栈」，因此关闭是可以撤销的；A 线关闭确认框里也向用户明说了
// 「该画布将从本机保存中移除，可通过撤销找回」。
// 保留 A 线语义的理由：对使用者更安全（误关还能救回来），且不要求改写确认框文案
// （改成 B 的语义就得同时删掉那句承诺，否则等于对用户撒谎）。
// 代价：Ctrl+Z 有可能把用户以为已经关掉的画布「变回来」。若曈曈认为这更困扰，
// 再改成 B 的语义（同时修改确认框文案）。在曈曈确认前，本场景按合并版的真实
// 行为断言——关掉能撤销、且撤销回来的是原样内容，而不是一张空画布。
await fresh();
page.once("dialog", (d) => d.accept("画布B"));
await page.locator('#newCanvasButton').click();
const canvasBId = await activeId();
expect(await canvasCount() === 2, "新建后应有 2 个画布");
// 在画布 B 上放一个节点，用来验证撤销回来的是「有内容的画布 B」而不是空壳
await page.locator('[data-tool="rect"]').click();
{
  const box = await vp();
  await page.mouse.click(box.x + 700, box.y + 500);
}
const canvasBNodes = (await nodes()).length;
expect(canvasBNodes >= 1, "画布 B 上应至少放下 1 个节点");
page.once("dialog", (d) => d.accept());
await page.locator(`.canvas-tab[data-canvas-id="${canvasBId}"] .tab-close`).click();
expect(await canvasCount() === 1, "关闭后应剩 1 个画布");
await page.keyboard.press("Control+z");
expect(await canvasCount() === 2, `合并版关闭画布可撤销，Ctrl+Z 后应恢复为 2 个画布，实际 ${await canvasCount()}`);
// 撤销后停在哪个画布：合并版的 undo() 会「尽量保留当前正在看的画布」（这一条正是
// 场景 5「切到别的画布后撤销不跳回去」成立的原因），所以撤销关闭后仍停在原画布，
// 被关掉的画布以标签形式回到标签栏。这里断言「标签回来了、切过去内容完整」。
expect(await activeId() === "canvas-main", `撤销后应停在当前画布 canvas-main（合并版 undo 的既有语义），实际 ${await activeId()}`);
const restoredTab = page.locator(`.canvas-tab[data-canvas-id="${canvasBId}"]`);
expect(await restoredTab.count() === 1, `撤销后标签栏应重新出现被关闭的画布 ${canvasBId}`);
await restoredTab.click();
expect(await activeId() === canvasBId, `点击恢复出来的标签后应切到 ${canvasBId}`);
expect((await nodes()).length === canvasBNodes, `撤销回来的画布内容应完整（${canvasBNodes} 个节点），实际 ${(await nodes()).length}`);
results.push("场景6 关闭画布可撤销且内容完整：通过（B 线原断言「不可撤销」为待确认分歧）");

// ===== 场景 7：模块库弹窗打开时 Delete 被屏蔽，不删节点 =====
await fresh();
await page.locator('[data-tool="select"]').click();
{
  const box = await vp();
  await page.mouse.click(box.x + 50 + 88, box.y + 300 + 46);
}
const beforeN = (await nodes()).length;
await page.locator('[data-action="open-modules"]').click();
await page.keyboard.press("Delete");
await page.waitForTimeout(120);
expect((await nodes()).length === beforeN, `弹窗打开时 Delete 应被屏蔽，节点数 ${beforeN} → ${(await nodes()).length}`);
expect(await page.locator("#moduleModal").isVisible(), "Delete 后弹窗应保持打开");
results.push("场景7 弹窗屏蔽 Delete：通过");

// ===== 场景 8：框选后按 Escape 清除多选 =====
await fresh();
await marqueeSelect(40, 280, 400, 400);
expect(await multiCount() === 2, `框选后应选 2 个节点，实际 ${await multiCount()}`);
await page.keyboard.press("Escape");
expect(await multiCount() === 0, `Escape 后多选应清空，实际 ${await multiCount()}`);
expect(await page.locator("#multiSelectPanel").isHidden(), "Escape 后多选面板应隐藏");
results.push("场景8 Escape 清除多选：通过");

// ===== 场景 9：shift 点击增选节点 =====
await fresh();
await page.locator('[data-tool="select"]').click();
{
  const box = await vp();
  await page.mouse.click(box.x + 50 + 88, box.y + 300 + 46); // node-source
  await page.keyboard.down("Shift");
  await page.mouse.click(box.x + 470 + 88, box.y + 300 + 46); // node-review
  await page.keyboard.up("Shift");
}
expect(await multiCount() === 2, `shift 增选后应选 2 个节点，实际 ${await multiCount()}`);
results.push("场景9 shift 增选：通过");

// ===== 场景 10：marquee 工具下从节点上起拖框选 =====
await fresh();
await page.locator('[data-tool="marquee"]').click();
{
  const box = await vp();
  await page.mouse.move(box.x + 50 + 88, box.y + 300 + 46); // 从 node-source 内部开始
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 400, { steps: 6 });
  await page.mouse.up();
}
expect(await multiCount() >= 2, `从节点起拖框选应选中至少 2 个节点，实际 ${await multiCount()}`);
results.push("场景10 从节点起拖框选：通过");

console.log(JSON.stringify({ results, errors }, null, 2));
await browser.close();
