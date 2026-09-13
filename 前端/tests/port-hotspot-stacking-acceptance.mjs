// 端口热区「抢点击」层叠缺陷 修复验收（真实浏览器 + 真实输入事件）
//
// 症状（本轮实测到的、用户真会踩的毛病）：两个节点叠在一起时，按上面那个节点**看得见的内容**，
//   结果却从下面那个**看不见的端口**拉出一条连线。用户感受到的是「点节点点不中 / 莫名开始连线 /
//   拖不动节点」。本轮定位时，连「把节点拖回原位」这个动作都因此失败过一次。
//
// 根因：`.node .port` 写了自己的 z-index: 7（`.resize-handle` 6、`.resize-toggle` 8 同理），
//   而 `.node` 自己不建层叠上下文，于是这些 z-index 全都跑到「所有节点共用的那一层」去比较——
//   所有节点的端口都画在所有节点本体的上面，跟谁先画谁后画完全无关。下面那个节点看不见的
//   端口热区（实测 40×40），因此盖住了上面那个节点看得见的内容。
//
// 修法（治本，一行）：给 `.node` 加 `isolation: isolate`，让端口/缩放手柄/缩放按钮的 z-index
//   只在「自己这个节点内部」比较，命中于是始终跟着「谁看得见在上面」走。这一行只改「谁赢」，
//   任何热区尺寸都没动，默认布局下端口手感不变。
//
// 本套件验三件事：
//   一、两个节点叠在一起时，按上层节点看得见的内容 → 选中的必须是上层节点，且不开始连线
//       （本轮修好的那一面）；
//   二、上层节点的本体处处不再被下层节点的端口「偷走」（把上层节点矩形内的点逐格扫一遍，
//       外来命中数必须是 0）；
//   三、手感没变：端口的热区仍是 40 像素见方（半径 20 像素），热区之内点得中、之外点不中。
//       注：CSS 注释里原先写的是「≥44px」，2026-09-13 实测是 40×40（端口 16px 是 border-box，
//       含 2px 边框，::after 的 inset 相对 padding box 算，12 + 14×2 = 40）。本套件把
//       「40 像素见方」这个当前事实钉住（留 ±2 的宽容度：dpr=1.25 的屏幕上浏览器把 2px 边框
//       取整成 1.6px，热区会量到 40.8，那是渲染取整不是 CSS 变了），将来谁改了热区尺寸
//       都会被这套件发现。
//
// 本套件的灵敏度另有一份自检：`tests\probe-port-hotspot-sensitivity.mjs` 会把修复临时撤销
// （只加一条 `isolation: auto` 的覆盖样式），用来证明本套件真的抓得住这个缺陷、不是空跑。
//
// 用法：
//   node tests/port-hotspot-stacking-acceptance.mjs [http://127.0.0.1:4192] [证据目录]
// 说明：目标地址靠 _served-target.mjs「按 app.js 内容认人」解析，不会误跑到别处的副本上。

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { resolveCanvasUrl } from "./_served-target.mjs";

const require = createRequire("D:/nodejs/npm-global/package.json");
const { chromium } = require("playwright");

const url = await resolveCanvasUrl(process.argv[2]);
const outDir = process.argv[3] || "D:/agent临时/画布端口热区验收-20260913";
fs.mkdirSync(outDir, { recursive: true });

const KEY = "workflow-canvas-communication-draft-v1";

// 先画的（矩形，在下面）与后画的（决定节点，叠在上面）。两者故意重叠：
// 先画那个节点的左端口热区（以端口中心为圆心、半径 20 像素）整个落在后画那个节点的本体里。
const FIRST = { id: "zao", type: "rect", x: 128, y: 372, w: 176, h: 92 };
const LATER = { id: "wan", type: "diamond", x: 88, y: 354, w: 112, h: 112 };

const seedState = () => ({
  version: 1,
  activeCanvasId: "canvas-main",
  canvases: [{
    id: "canvas-main",
    name: "端口热区层叠验收",
    category: "",
    nodes: [
      // 数组里靠前的先画 → 叠在下面；靠后的后画 → 叠在上面
      { id: FIRST.id, type: "rect", x: FIRST.x, y: FIRST.y, w: FIRST.w, h: FIRST.h, label: "先画的矩形节点", note: "", marker: "待讨论" },
      { id: LATER.id, type: "diamond", x: LATER.x, y: LATER.y, w: LATER.w, h: LATER.h, label: "后画的决定节点", note: "", marker: "待讨论", condition: "", exitCondition: "" },
    ],
    edges: [],
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

const nodeCount = () => page.locator(".node").count();
const edgeCount = () => page.locator("#edges .edge").count();
const selectedNodeIds = () => page.evaluate(() =>
  [...document.querySelectorAll(".node.is-selected")].map((el) => el.dataset.nodeId));
const connectingNodeIds = () => page.evaluate(() =>
  [...document.querySelectorAll(".node.is-connecting")].map((el) => el.dataset.nodeId));
const tempEdgeShown = () => page.evaluate(() => document.querySelector("#temporaryEdge").hidden === false);
const nodePos = (id) => page.evaluate((nid) => {
  const el = document.querySelector(`.node[data-node-id="${nid}"]`);
  return el ? { left: parseFloat(el.style.left), top: parseFloat(el.style.top) } : null;
}, id);
const nodeRect = (id) => page.evaluate((nid) => {
  const el = document.querySelector(`.node[data-node-id="${nid}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}, id);
const hitAt = (pt) => page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  const owner = el?.closest?.(".node")?.dataset.nodeId ?? null;
  return {
    tag: el?.tagName?.toLowerCase() ?? null,
    cls: String(el?.getAttribute?.("class") ?? ""),
    属于节点: owner,
    是不是端口: !!el?.closest?.(".port"),
  };
}, pt);

// 端口热区：不写死数字，直接问浏览器。端口 `.port` 是 16×16（border-box，含 2px 边框），
// 热区由 `.node .port::after { inset: -14px }` 在 padding box 上向外扩，所以热区是
// 「以端口中心为中心、边长 = ::after 计算宽高」的正方形——实测 40×40（半径 20），
// 可由 12 + 14×2 推出。用 getComputedStyle 取 ::after 的宽高，好处是将来谁改了 inset，
// 热区和断言一起跟着走，不会再留下「注释写 44、实际 40」这种假口径。
const portHotspot = (nodeId, side) => page.evaluate(({ nid, s }) => {
  const port = document.querySelector(`.node[data-node-id="${nid}"] .port[data-side="${s}"]`);
  if (!port) return null;
  const r = port.getBoundingClientRect();
  const after = getComputedStyle(port, "::after");
  const w = parseFloat(after.width);
  const h = parseFloat(after.height);
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return {
    端口矩形: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
    中心: { x: cx, y: cy },
    热区边长: { w, h },
    热区: { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 },
  };
}, { nid: nodeId, s: side });

// 把某个节点矩形内的点逐格扫一遍，统计「命中的元素不属于这个节点」的点。
// 修复之前：后画那个节点的本体里会大量命中先画那个节点的端口。
const scanForeignHits = (insideId) => page.evaluate((nid) => {
  const box = document.querySelector(`.node[data-node-id="${nid}"]`).getBoundingClientRect();
  const foreign = [];
  const 命中分类 = {};
  const 外来命中归属 = {};
  for (let y = Math.ceil(box.top) + 2; y <= Math.floor(box.bottom) - 2; y += 2) {
    for (let x = Math.ceil(box.left) + 2; x <= Math.floor(box.right) - 2; x += 2) {
      const el = document.elementFromPoint(x, y);
      const owner = el?.closest?.(".node")?.dataset.nodeId ?? null;
      const isPort = !!el?.closest?.(".port");
      const key = `${owner ?? "无节点"}${isPort ? "+端口" : ""}`;
      命中分类[key] = (命中分类[key] || 0) + 1;
      if (owner !== nid) {
        外来命中归属[owner ?? "无节点"] = (外来命中归属[owner ?? "无节点"] || 0) + 1;
        foreign.push({ x, y, hit: el?.tagName?.toLowerCase() ?? null, cls: String(el?.getAttribute?.("class") ?? ""), 属于节点: owner, 是不是端口: isPort });
      }
    }
  }
  return { 扫描矩形: { left: box.left, top: box.top, right: box.right, bottom: box.bottom }, 外来命中数: foreign.length, 外来命中里属于端口的点数: foreign.filter((f) => f.是不是端口).length, 外来命中归属, 命中分类, 前几例: foreign.slice(0, 6) };
}, insideId);

// 把两个节点在屏幕上重叠的那一块逐格扫一遍，看每个点到底命中了谁
const scanOverlap = (idUnder, idOver) => page.evaluate(({ a, b }) => {
  const ra = document.querySelector(`.node[data-node-id="${a}"]`).getBoundingClientRect();
  const rb = document.querySelector(`.node[data-node-id="${b}"]`).getBoundingClientRect();
  const box = { left: Math.max(ra.left, rb.left), top: Math.max(ra.top, rb.top), right: Math.min(ra.right, rb.right), bottom: Math.min(ra.bottom, rb.bottom) };
  const 命中分类 = {};
  const 命中上层本体的点 = [];
  for (let y = Math.ceil(box.top) + 1; y <= Math.floor(box.bottom) - 1; y += 2) {
    for (let x = Math.ceil(box.left) + 1; x <= Math.floor(box.right) - 1; x += 2) {
      const el = document.elementFromPoint(x, y);
      const owner = el?.closest?.(".node")?.dataset.nodeId ?? null;
      const isPort = !!el?.closest?.(".port");
      const key = `${owner ?? "无节点"}${isPort ? "+端口" : ""}`;
      命中分类[key] = (命中分类[key] || 0) + 1;
      if (owner === b && !isPort) 命中上层本体的点.push({ x, y });
    }
  }
  return { 重叠矩形: box, 命中分类, 命中后画节点本体的点数: 命中上层本体的点.length, 示例: 命中上层本体的点.slice(0, 3) };
}, { a: idUnder, b: idOver });

// 两个矩形的交集中心：用来算「既在上层节点本体里、又在下层节点端口热区里」的那个点
const overlapCentre = (a, b) => ({
  x: (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2,
  y: (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2,
});
const 在矩形内 = (pt, box) => pt.x > box.left && pt.x < box.right && pt.y > box.top && pt.y < box.bottom;

const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });

// ---------------------------------------------------------------- 0. 铺场景
await page.goto(url);
await page.waitForLoadState("networkidle");
await page.evaluate(({ s, k }) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(s)); }, { s: seedState(), k: KEY });
await page.reload();
await page.waitForLoadState("networkidle");
await shot("00_开局_两个节点叠在一起");

const 场景 = {};
{
  expect(await nodeCount() === 2, `开局应有 2 个节点，实际 ${await nodeCount()}`);
  expect(await edgeCount() === 0, `开局不该有连线，实际 ${await edgeCount()}`);
  expect((await selectedNodeIds()).length === 0, "开局不该有任何节点处于选中状态");
  expect(await tempEdgeShown() === false, "开局不该显示临时连线");

  场景.先画的节点矩形 = await nodeRect(FIRST.id);
  场景.后画的节点矩形 = await nodeRect(LATER.id);
  expect(场景.先画的节点矩形 !== null && 场景.后画的节点矩形 !== null, "两个节点都应出现在页面上");
  expect(
    场景.后画的节点矩形.left < 场景.先画的节点矩形.left &&
    场景.后画的节点矩形.right > 场景.先画的节点矩形.left &&
    场景.后画的节点矩形.top < 场景.先画的节点矩形.bottom,
    `两个节点应是重叠的（这是本套件的前提），实际 后画 ${JSON.stringify(场景.后画的节点矩形)}、先画 ${JSON.stringify(场景.先画的节点矩形)}`
  );

  // 前提核对：重叠区里，凡是不被端口热区覆盖的地方，命中的都应该是后画的那个节点本体
  // （这才叫「后画的叠在上面」）。这一条是后面所有断言的地基，所以单独扫一遍。
  场景.重叠区扫描 = await scanOverlap(FIRST.id, LATER.id);
  expect(
    场景.重叠区扫描.命中后画节点本体的点数 > 0,
    `前提：重叠区里应命得中后画的那个节点本体，实际 ${JSON.stringify(场景.重叠区扫描)}`
  );
  note(`场景就绪：先画 ${JSON.stringify(场景.先画的节点矩形)}、后画 ${JSON.stringify(场景.后画的节点矩形)}；重叠区命中分类 ${JSON.stringify(场景.重叠区扫描.命中分类)}`);
}

// ---------------------------- 1. 上层节点本体内的点，逐格扫描：不许再被下层端口偷走
const 扫描 = {};
{
  扫描.后画节点内 = await scanForeignHits(LATER.id);
  扫描.先画节点内 = await scanForeignHits(FIRST.id);
  note(`逐格扫描：后画那个节点本体里共 ${扫描.后画节点内.外来命中数} 个点命中别的节点（命中分类 ${JSON.stringify(扫描.后画节点内.命中分类)}）`);
  note(`逐格扫描：先画那个节点本体里共 ${扫描.先画节点内.外来命中数} 个点命中别的节点（归属 ${JSON.stringify(扫描.先画节点内.外来命中归属)}）——先画那个节点被后画的盖住是正常的层叠，这里只查「有没有第三方或越界的端口抢」`);

  expect(
    扫描.后画节点内.外来命中数 === 0,
    `后画那个节点的本体里不该有任何一点命中别的节点，实际有 ${扫描.后画节点内.外来命中数} 个点被偷走，前几例 ${JSON.stringify(扫描.后画节点内.前几例)}`
  );
  // 反过来（先画那个节点的矩形里）大多数点会被后画的那个节点盖住，这是正常的层叠，不是毛病；
  // 要查的是「抢点击的只能是在上面的那个，不能是第三个节点、更不能是别的节点的端口」。
  expect(
    Object.keys(扫描.先画节点内.外来命中归属).every((key) => key === LATER.id),
    `先画那个节点的矩形里，若命中别的节点，只允许是在上面的那个（${LATER.id}），实际归属 ${JSON.stringify(扫描.先画节点内.外来命中归属)}`
  );
  // 顺带把「先画那个节点里被盖住的比例」记下来，说明上面为什么不对它的外来命中数下死断言
  扫描.先画节点内被后画的盖住的点数 = 扫描.先画节点内.外来命中数;
}

// -------------------- 2. 主场景：按上层节点看得见的内容 → 选中上层、不开始连线（真实鼠标输入）
const 主场景 = {};
{
  const 下层左端口 = await portHotspot(FIRST.id, "left");
  expect(下层左端口 !== null, "应能取到先画那个节点左端口的矩形");
  主场景.下层左端口 = 下层左端口;

  const 争议点 = overlapCentre(下层左端口.热区, 场景.后画的节点矩形);
  主场景.争议点 = 争议点;
  expect(在矩形内(争议点, 场景.后画的节点矩形), `争议点应落在后画那个节点的本体里，实际 ${JSON.stringify(争议点)}`);
  expect(在矩形内(争议点, 下层左端口.热区), `争议点应落在先画那个节点左端口的热区里（这才是「争」点），实际 ${JSON.stringify(争议点)}`);

  主场景.按下前命中 = await hitAt(争议点);
  expect(
    主场景.按下前命中.属于节点 === LATER.id,
    `按之前先看一眼：这个点应命中后画的那个节点（看得见在上面的那个），实际 ${JSON.stringify(主场景.按下前命中)}`
  );
  expect(
    主场景.按下前命中.是不是端口 === false,
    `这个点不该命中任何端口（热区在下面那个节点上，是不该赢的一方），实际 ${JSON.stringify(主场景.按下前命中)}`
  );
  note(`争议点 ${JSON.stringify(争议点)}：按下前命中 ${JSON.stringify(主场景.按下前命中)}`);

  // 真实鼠标：按下 → 立刻看状态 → 抬手
  await page.mouse.move(争议点.x, 争议点.y);
  await page.mouse.down();
  await page.waitForTimeout(150);
  主场景.按下后的选中节点 = await selectedNodeIds();
  主场景.按下后正在连线的节点 = await connectingNodeIds();
  主场景.按下后是否显示临时连线 = await tempEdgeShown();
  await shot("01_按下_争议点");
  await page.mouse.up();
  await page.waitForTimeout(250);

  expect(
    主场景.按下后的选中节点.length === 1 && 主场景.按下后的选中节点[0] === LATER.id,
    `按上层节点看得见的内容，应选中上层节点（${LATER.id}），实际选中 ${JSON.stringify(主场景.按下后的选中节点)}`
  );
  expect(
    主场景.按下后正在连线的节点.length === 0,
    `不该开始连线，实际正在连线的节点是 ${JSON.stringify(主场景.按下后正在连线的节点)}`
  );
  expect(主场景.按下后是否显示临时连线 === false, "不该显示临时连线");
  expect(await edgeCount() === 0, `抬手后不该多出连线，实际 ${await edgeCount()} 条`);
  expect(await nodeCount() === 2, `节点数应还是 2，实际 ${await nodeCount()}`);
  await shot("02_抬手_已选中上层节点");
  note(`按下 → 选中 ${JSON.stringify(主场景.按下后的选中节点)}，正在连线 ${JSON.stringify(主场景.按下后正在连线的节点)}，临时连线 ${主场景.按下后是否显示临时连线}`);

  // 再按一次下层节点「自己的本体」（避开它的端口热区），确认下层节点照样能选中——不是把下层节点修坏了
  const 下层本体点 = { x: 场景.先画的节点矩形.right - 12, y: 场景.先画的节点矩形.bottom - 12 };
  const 下层本体命中 = await hitAt(下层本体点);
  主场景.下层本体点 = { 点: 下层本体点, ...下层本体命中 };
  expect(
    下层本体命中.属于节点 === FIRST.id && 下层本体命中.是不是端口 === false,
    `先画那个节点的右下角本体应命中它自己、且不是端口，实际 ${JSON.stringify(主场景.下层本体点)}`
  );
  await page.mouse.click(下层本体点.x, 下层本体点.y);
  await page.waitForTimeout(200);
  主场景.点下层本体后的选中节点 = await selectedNodeIds();
  expect(
    主场景.点下层本体后的选中节点.length === 1 && 主场景.点下层本体后的选中节点[0] === FIRST.id,
    `点下层节点自己的本体，应选中下层节点，实际 ${JSON.stringify(主场景.点下层本体后的选中节点)}`
  );
  note(`点下层节点自己的本体（露在外面的右下角）→ 选中 ${JSON.stringify(主场景.点下层本体后的选中节点)}`);
}

// ------------------------------- 3. 真实拖动：从争议点按住拖，动的是上层节点，下层节点不动
const 拖动 = {};
{
  await page.mouse.click(10, 700); // 先点空白处，清掉选中，避免误当成「多选拖动」
  await page.waitForTimeout(150);
  const 上层前 = await nodePos(LATER.id);
  const 下层前 = await nodePos(FIRST.id);
  const dx = 70, dy = 40;
  await page.mouse.move(主场景.争议点.x, 主场景.争议点.y);
  await page.mouse.down();
  await page.mouse.move(主场景.争议点.x + dx, 主场景.争议点.y + dy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const 上层后 = await nodePos(LATER.id);
  const 下层后 = await nodePos(FIRST.id);
  拖动.计划的位移 = { x: dx, y: dy };
  拖动.上层节点实际位移 = { x: 上层后.left - 上层前.left, y: 上层后.top - 上层前.top };
  拖动.下层节点实际位移 = { x: 下层后.left - 下层前.left, y: 下层后.top - 下层前.top };
  expect(
    Math.abs(拖动.上层节点实际位移.x - dx) <= 3 && Math.abs(拖动.上层节点实际位移.y - dy) <= 3,
    `从争议点按住拖，动的应是上层节点，应位移 ${JSON.stringify({ x: dx, y: dy })}，实际 ${JSON.stringify(拖动.上层节点实际位移)}`
  );
  expect(
    拖动.下层节点实际位移.x === 0 && 拖动.下层节点实际位移.y === 0,
    `下层节点不该跟着动，实际 ${JSON.stringify(拖动.下层节点实际位移)}`
  );
  expect(await edgeCount() === 0, `拖动过程中不该多出连线，实际 ${await edgeCount()} 条`);
  await shot("03_拖上层节点");
  note(`从争议点拖：上层节点位移 ${JSON.stringify(拖动.上层节点实际位移)}（计划 ${JSON.stringify(拖动.计划的位移)}），下层节点位移 ${JSON.stringify(拖动.下层节点实际位移)}`);
}

// --------------------- 4. 手感回归：下层节点自己端口的可点范围仍是半径 20 像素（40×40）
const 手感 = {};
{
  // 把上层节点先挪开，免得它挡住下层节点的右侧端口
  await page.evaluate(() => {
    const el = document.querySelector('.node[data-node-id="wan"]');
    el.style.left = "700px";
    el.style.top = "600px";
  });
  await page.waitForTimeout(150);

  for (const [方位, 中文] of [["right", "右"], ["left", "左"]]) {
    const port = await portHotspot(FIRST.id, 方位);
    expect(port !== null, `应能取到先画那个节点「${中文}」端口的矩形`);
    // 热区边长：口径是「40 像素左右」，不是卡死 40.000。
    // 原因（2026-09-13 实测于真实 Chrome，devicePixelRatio=1.25 的那一档）：样式里写的是
    // `border: 2px`，而浏览器会把边框宽度按设备像素取整——2px × 1.25 = 2.5 设备像素被按 2 设备像素
    // 渲染，报回来的计算值是 1.6px，于是热区变成 12.8 + 14×2 = 40.8。同一份 CSS 在 dpr=1 的
    // 无头浏览器里就是整数 40。差值来自渲染取整、不来自 CSS，所以这里给 ±2 的宽容度：
    // 既能挡住「热区被改大/改小」（比如真要改成 44），又不会因为换台显示器就误报失败。
    expect(
      Math.abs(port.热区边长.w - 40) <= 2 && Math.abs(port.热区边长.h - 40) <= 2,
      `端口热区应是以端口中心为中心、边长 40 像素左右的正方形（2026-09-13 实测口径：dpr=1 时为 40×40，dpr=1.25 时为 40.8×40.8；都不是 44×44），实际 ${JSON.stringify(port.热区边长)}。若确实要改成 44，得同时改这里的断言和 styles.css 里 ::after 的 inset`
    );
    const 水平方向 = 方位 === "right" ? 1 : -1;

    const 热区内 = { x: port.中心.x + 水平方向 * 16, y: port.中心.y };
    const 热区外 = { x: port.中心.x + 水平方向 * 24, y: port.中心.y };
    const 热区内命中 = await hitAt(热区内);
    const 热区外命中 = await hitAt(热区外);
    手感[`${中文}端口`] = {
      端口矩形: port.端口矩形,
      端口中心: port.中心,
      热区边长: port.热区边长,
      热区: port.热区,
      距中心16像素: { 点: 热区内, ...热区内命中 },
      距中心24像素: { 点: 热区外, ...热区外命中 },
    };

    expect(
      热区内命中.属于节点 === FIRST.id && 热区内命中.是不是端口 === true,
      `「${中文}」端口距中心 16 像素（在半径 20 的热区之内）应能命中该端口，实际 ${JSON.stringify(热区内命中)}`
    );
    expect(
      !(热区外命中.属于节点 === FIRST.id && 热区外命中.是不是端口 === true),
      `「${中文}」端口距中心 24 像素（已超出半径 20 的热区）不该再命中该端口，实际 ${JSON.stringify(热区外命中)}`
    );
    note(`手感：${中文}端口热区边长 ${port.热区边长.w}×${port.热区边长.h}；距中心 16 像素 → ${JSON.stringify(热区内命中)}；距中心 24 像素 → ${JSON.stringify(热区外命中)}`);
  }

  // 端口的真身仍是 16×16（视觉尺寸一个字没改，只是周围铺了看不见的可点范围）
  const 右端口 = 手感.右端口;
  expect(
    Math.round(右端口.端口矩形.width) === 16 && Math.round(右端口.端口矩形.height) === 16,
    `端口本体视觉尺寸仍应是 16×16，实际 ${右端口.端口矩形.width}×${右端口.端口矩形.height}`
  );
  expect(
    Math.round(右端口.距中心16像素.点.x - 右端口.端口中心.x) === 16,
    "手感记录里的取样点应与端口中心相距 16 像素"
  );
  await shot("04_端口热区仍在");
}

// ------------------------------------------------------------------ 5. 收尾
expect(errors.length === 0, `页面不应报错，实际：${JSON.stringify(errors)}`);
await shot("05_收尾");

const result = {
  目标地址: url,
  断言条数: assertCount,
  场景,
  逐格扫描: 扫描,
  主场景: 主场景,
  拖动,
  手感,
  页面报错: errors,
  记录: notes,
};
fs.writeFileSync(path.join(outDir, "端口热区层叠_验收结果.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));

await browser.close();
console.log(`\n端口热区层叠验收通过：共 ${assertCount} 条断言全部成立。证据目录：${outDir}`);
