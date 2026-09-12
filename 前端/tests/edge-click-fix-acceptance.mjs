// 连线「点第一下不管用」三处交互缺陷 修复验收（真实浏览器 + 真实输入事件）
//
// 来历：D:\agent临时\画布验收-真实浏览器-20260913\验收记录.md 证明了三个先于本轮就有的毛病
// （甲/乙/乙2/丙 四组对照的日志在那一份记录里）：
//   ① 连线是「整层清空重建」（edgeGroup.innerHTML = ""）。右栏还有没提交的输入时，按下的
//      那一瞬间会失焦提交 → 重建 → 按下的那条线被换掉，浏览器于是根本不派发 click，
//      结果是「连线的第一下白点，得点两下才选中」；
//   ② 框选工具下，「按到连线」的判断排在「开始框选」后面，连线的第一下被框选吃掉；
//   ③ 全文件从没有 releasePointerCapture：指针捕获只借不还（浏览器会在抬手时隐式还，
//      所以这一条是加固，不是用户能看见的毛病——本套件只验它没把别的手势弄坏）。
//
// 本套件用真实鼠标/键盘输入复现这三个场景：甲（无未提交内容）、乙（有未提交内容）、
// 丙（框选工具下），再加两条回归（框选照旧、拖节点照旧）。
//
// 用法：
//   node tests/edge-click-fix-acceptance.mjs [http://127.0.0.1:4192] [证据目录]
// 说明：目标地址是靠 _served-target.mjs「按 app.js 内容认人」解析出来的，不会误跑到别处的副本上。

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { resolveCanvasUrl } from "./_served-target.mjs";

const require = createRequire("D:/nodejs/npm-global/package.json");
const { chromium } = require("playwright");

const url = await resolveCanvasUrl(process.argv[2]);
const outDir = process.argv[3] || "D:/agent临时/画布交互修复验收-20260913";
fs.mkdirSync(outDir, { recursive: true });

const KEY = "workflow-canvas-communication-draft-v1";

// 干净的对照组：3 个节点、2 条连线（e-1: A→判断，e-2: 判断→B）
const seedState = () => ({
  version: 1,
  activeCanvasId: "canvas-main",
  canvases: [{
    id: "canvas-main",
    name: "连线点击修复验收",
    category: "",
    nodes: [
      { id: "a", type: "rect", x: 120, y: 240, w: 176, h: 92, label: "A", note: "", marker: "待讨论" },
      { id: "d", type: "diamond", x: 460, y: 240, w: 96, h: 96, label: "判断", note: "", marker: "待讨论", condition: "", exitCondition: "" },
      { id: "b", type: "rect", x: 760, y: 240, w: 176, h: 92, label: "B", note: "", marker: "待讨论" },
    ],
    edges: [
      { id: "e-1", from: "a", to: "d", width: "medium", color: "", label: "", branch: "", loop: false },
      { id: "e-2", from: "d", to: "b", width: "medium", color: "", label: "", branch: "", loop: false },
    ],
    view: { zoom: 1, panX: 0, panY: 0 },
  }],
});

let assertCount = 0;
const expect = (condition, message) => {
  assertCount += 1;
  if (!condition) throw new Error(message);
};
const notes = [];
const note = (message) => {
  notes.push(message);
  console.log(`[记录] ${message}`);
};

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));

const dialogs = [];
page.on("dialog", async (dialog) => {
  dialogs.push({ type: dialog.type(), message: dialog.message() });
  await dialog.accept();
});

const edgeCount = () => page.locator("#edges .edge").count();
const nodeCount = () => page.locator(".node").count();
const selectedEdge = () => page.evaluate(() => document.querySelector(".edge.is-selected")?.dataset.edgeId ?? null);
const selectedInSelection = () => page.locator(".node.is-in-selection").count();
const edgeFormVisible = () => page.locator("#inspectorEdgeForm").isVisible();
const nodePos = (id) => page.evaluate((nid) => {
  const el = document.querySelector(`.node[data-node-id="${nid}"]`);
  return el ? { left: parseFloat(el.style.left), top: parseFloat(el.style.top) } : null;
}, id);
const savedNodeField = (id, field) => page.evaluate(({ k, nid, f }) => {
  const s = JSON.parse(localStorage.getItem(k) || "null");
  const n = s?.canvases?.[0]?.nodes?.find((x) => x.id === nid);
  return n ? n[f] ?? "" : null;
}, { k: KEY, nid: id, f: field });

// 真实坐标：取连线命中层中点（用浏览器自己的 getPointAtLength + getScreenCTM，不是硬编码像素）
const edgePoint = (id) => page.evaluate((eid) => {
  const p = document.querySelector(`.edge-hit[data-edge-id="${eid}"]`);
  if (!p) return null;
  const len = p.getTotalLength();
  const pt = p.getPointAtLength(len / 2);
  const m = p.getScreenCTM();
  const s = new DOMPoint(pt.x, pt.y).matrixTransform(m);
  return { x: s.x, y: s.y };
}, id);
// 按下之前先看一眼「这个坐标上到底是什么元素」——这是对照组能成立的前提
const hitAt = (pt) => page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  return el ? { tag: el.tagName, cls: String(el.getAttribute("class") || ""), edgeId: el.dataset?.edgeId ?? null } : null;
}, pt);

async function reseed(label) {
  await page.evaluate(({ s, k }) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(s)); }, { s: seedState(), k: KEY });
  await page.reload();
  await page.waitForLoadState("networkidle");
  note(`—— ${label}：重新铺一张干净画布（${await nodeCount()} 个节点、${await edgeCount()} 条连线）——`);
}
async function shot(name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
}

// ---------------------------------------------------------------- 0. 干净起步
await page.goto(url);
await page.waitForLoadState("networkidle");
await page.evaluate(({ s, k }) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(s)); }, { s: seedState(), k: KEY });
await page.reload();
await page.waitForLoadState("networkidle");

expect(await nodeCount() === 3, `开局应有 3 个节点，实际 ${await nodeCount()}`);
expect(await edgeCount() === 2, `开局应有 2 条连线，实际 ${await edgeCount()}`);
expect(await selectedEdge() === null, "开局不该有任何连线处于选中状态");
note(`开局：${await nodeCount()} 个节点、${await edgeCount()} 条连线、连线选中 = ${await selectedEdge()}`);

// ------------------------------------------- 1. 甲组：没有未提交内容时，一下就该选中
const jia = {};
{
  const pt = await edgePoint("e-1");
  expect(pt !== null, "应能在屏幕上算出连线 e-1 的中点坐标");
  const hit = await hitAt(pt);
  jia.按下时命中的元素 = hit;
  expect(String(hit?.cls).includes("edge-hit"), `连线中点应命中连线命中层（.edge-hit），实际命中 ${JSON.stringify(hit)}`);

  await page.mouse.click(pt.x, pt.y);
  jia.点一下之后的选中连线 = await selectedEdge();
  expect(jia.点一下之后的选中连线 === "e-1", `甲：没有未提交内容时，点一下就该选中 e-1，实际选中 ${jia.点一下之后的选中连线}`);
  expect(await edgeFormVisible(), "甲：选中连线后，右栏「连线信息」应展开");
  expect(await page.locator("#inspectorEdgeName").isVisible(), "甲：连线信息里应能改「连线名称」");
  await shot("01_甲_点一下选中连线");
  note(`甲组（无未提交内容）：点一下 → 选中 ${jia.点一下之后的选中连线}，右栏连线信息已展开`);

  // 顺手验一条真实键盘路径：选中的连线，按 Delete 能删掉
  await page.keyboard.press("Delete");
  await page.waitForTimeout(200);
  jia.按Delete后的连线数 = await edgeCount();
  jia.按Delete后的状态栏 = ((await page.locator("#saveStatus").textContent()) || "").trim();
  expect(jia.按Delete后的连线数 === 1, `甲：选中连线后按 Delete 应删掉 1 条，剩 1 条，实际剩 ${jia.按Delete后的连线数}`);
  expect((await selectedEdge()) === null, "甲：删掉之后不该还有连线处于选中状态");
  expect(jia.按Delete后的状态栏 === "已删除", `甲：删除后状态栏应写上「已删除」，实际「${jia.按Delete后的状态栏}」`);
  await shot("02_甲_选中后按Delete删掉连线");
}

// ------------------------- 2. 乙组：右栏有未提交内容（会触发整层重建）时，一下仍要选中
const yi = {};
{
  await reseed("乙组");

  // 先把判断节点选中，往「判断条件」里打字——不回车、不点别处，保持「未提交」状态
  await page.locator('.node[data-node-id="d"]').click();
  await page.waitForTimeout(150);
  expect(await page.locator("#conditionGroup").isVisible(), "乙：选中判断节点后，右栏应出现「判断条件」输入框");

  await page.locator("#inspectorCondition").click();
  const pending = "验收：材料是否齐全？";
  await page.keyboard.type(pending, { delay: 20 });
  yi.未提交的输入内容 = await page.locator("#inspectorCondition").inputValue();
  const focusedId = await page.evaluate(() => document.activeElement?.id ?? "");
  yi.打字后焦点所在元素 = focusedId;
  expect(yi.未提交的输入内容 === pending, `乙：输入框里应是刚打的字，实际「${yi.未提交的输入内容}」`);
  expect(focusedId === "inspectorCondition", `乙：打字后焦点应还在输入框里（这才叫未提交），实际焦点在 ${focusedId}`);
  yi.此刻已落盘的条件 = await savedNodeField("d", "condition");
  expect(yi.此刻已落盘的条件 !== pending, `乙：此刻条件应还没落盘（真未提交），实际已落盘「${yi.此刻已落盘的条件}」`);
  note(`乙组前置：判断节点右栏有未提交内容「${pending}」，焦点在输入框，尚未落盘`);

  const pt = await edgePoint("e-2");
  yi.按下时命中的元素 = await hitAt(pt);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300); // 等「失焦提交 → 整层重建」那一步跑完

  yi.点一下之后的选中连线 = await selectedEdge();
  yi.这段时间的状态栏 = ((await page.locator("#saveStatus").textContent()) || "").trim();
  yi.提交后落盘的条件 = await savedNodeField("d", "condition");
  expect(yi.点一下之后的选中连线 === "e-2", `乙：右栏有未提交内容时，点一下也应选中 e-2，实际选中 ${yi.点一下之后的选中连线}`);
  expect(await edgeFormVisible(), "乙：选中连线后，右栏「连线信息」应展开");
  expect(yi.提交后落盘的条件 === pending, `乙：失焦应把未提交内容提交落盘，实际落盘「${yi.提交后落盘的条件}」`);
  expect(yi.这段时间的状态栏 === "节点信息已保存", `乙：那一刻状态栏应写「节点信息已保存」（证明确实发生了失焦提交+整层重建），实际「${yi.这段时间的状态栏}」`);
  await shot("03_乙_有未提交内容也能一下选中");
  note(`乙组（有未提交内容）：打字 → 点连线一下 → 选中 ${yi.点一下之后的选中连线}；同一刻未提交内容被失焦提交（状态栏「${yi.这段时间的状态栏}」），说明整层重建确实发生过`);
}

// --------------------------------------------- 3. 丙组：框选工具下点连线，一下也要选中
const bing = {};
{
  await reseed("丙组");
  await page.locator('[data-tool="marquee"]').click();
  await page.waitForTimeout(150);
  bing.当前工具 = await page.locator('.tool-button.is-active').getAttribute("data-tool");
  expect(bing.当前工具 === "marquee", `丙：应先切到框选工具，实际当前工具 ${bing.当前工具}`);

  const pt = await edgePoint("e-1");
  bing.按下时命中的元素 = await hitAt(pt);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(200);
  bing.点一下之后的选中连线 = await selectedEdge();
  bing.框选结果面板是否出现 = await page.locator("#multiSelectPanel").isVisible();
  bing.被框选节点数 = await selectedInSelection();
  expect(bing.点一下之后的选中连线 === "e-1", `丙：框选工具下点连线，一下就该选中 e-1，实际选中 ${bing.点一下之后的选中连线}`);
  expect(await edgeFormVisible(), "丙：选中连线后，右栏「连线信息」应展开");
  expect(bing.框选结果面板是否出现 === false, "丙：点连线不该顺带启动一次框选（框选结果面板不该出现）");
  expect(bing.被框选节点数 === 0, `丙：点连线不该顺带框住节点，实际框住 ${bing.被框选节点数} 个`);
  await shot("04_丙_框选工具下点连线");
  note(`丙组（框选工具）：点连线一下 → 选中 ${bing.点一下之后的选中连线}，没有误启动框选`);
}

// ------------------------------------- 4. 回归一：框选工具本身照旧好使（真实拖动框选）
const regress = {};
{
  const vb = await page.locator("#viewport").boundingBox();
  await page.mouse.move(vb.x + 6, vb.y + 6);
  await page.mouse.down();
  await page.mouse.move(vb.x + vb.width - 6, vb.y + vb.height - 6, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  regress.框选结果面板是否出现 = await page.locator("#multiSelectPanel").isVisible();
  regress.框选摘要 = ((await page.locator("#multiSelectSummary").textContent()) || "").trim();
  regress.被框选节点数 = await selectedInSelection();
  regress.框选后是否有连线被选中 = await selectedEdge();
  expect(regress.框选结果面板是否出现 === true, "回归一：从空白处拖一个框，应照旧弹出框选结果面板");
  expect(regress.被框选节点数 === 3, `回归一：框住整张画布应选中 3 个节点，实际 ${regress.被框选节点数}`);
  expect(regress.框选摘要.includes("3 个节点"), `回归一：框选摘要应写 3 个节点，实际「${regress.框选摘要}」`);
  expect(regress.框选后是否有连线被选中 === null, "回归一：框选不该顺手选中连线");
  await shot("05_回归_框选照旧");
  note(`回归一（框选）：${regress.框选摘要}`);
}

// ---------------------- 5. 回归二：框选（会抓指针捕获）之后，拖节点仍然好使（真实拖动）
{
  await page.locator('[data-tool="select"]').click();
  await page.waitForTimeout(150);
  const box = await page.locator('.node[data-node-id="a"]').boundingBox();
  const before = await nodePos("a");
  const dx = 70, dy = 50;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await nodePos("a");
  regress.拖动的位移 = { 计划: { x: dx, y: dy }, 实际: { x: after.left - before.left, y: after.top - before.top } };
  expect(Math.abs(after.left - before.left - dx) <= 3, `回归二：拖节点应平移 ${dx} 像素，实际 ${after.left - before.left}`);
  expect(Math.abs(after.top - before.top - dy) <= 3, `回归二：拖节点应平移 ${dy} 像素，实际 ${after.top - before.top}`);
  expect(await page.locator('.node[data-node-id="a"]').isVisible(), "回归二：拖完之后节点应还在画布上");
  await shot("06_回归_拖节点照旧");
  note(`回归二（拖节点）：位移 实际 ${JSON.stringify(regress.拖动的位移.实际)}（计划 ${JSON.stringify(regress.拖动的位移.计划)}）`);
}

// ------------------------------------------------------------------ 6. 收尾
expect(errors.length === 0, `页面不应报错，实际：${JSON.stringify(errors)}`);
await page.screenshot({ path: path.join(outDir, "07_收尾.png") });

const result = {
  目标地址: url,
  断言条数: assertCount,
  甲组_无未提交内容: jia,
  乙组_有未提交内容触发整层重建: yi,
  丙组_框选工具下点连线: bing,
  回归: regress,
  页面报错: errors,
  弹窗记录: dialogs,
  记录: notes,
};
fs.writeFileSync(path.join(outDir, "连线点击修复_验收结果.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));

await browser.close();
console.log(`\n连线点击修复验收通过：共 ${assertCount} 条断言全部成立。证据目录：${outDir}`);
