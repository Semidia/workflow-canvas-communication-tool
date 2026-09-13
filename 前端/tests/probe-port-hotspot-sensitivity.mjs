// 端口热区层叠验收套件的「灵敏度自检」（探针，不是验收证据）
//
// 干什么：把本轮那个修复临时撤销（只往页面里加一条 `.node { isolation: auto !important }`，
//   不改仓库里的文件），然后重跑与验收套件完全相同的「逐格扫描」和「争议点」两步。
//
// 为什么要有它：一个只会「变绿」的回归套件说明不了任何事——要先证明它在缺陷还在时**会变红**，
//   才能说它守得住这个缺陷。本探针的期望结果是：撤销修复后，外来命中数明显大于 0、
//   争议点重新命中下层节点的端口。这正好与验收套件的期望反着来，两者互为对照。
//
// 用法：
//   node tests/probe-port-hotspot-sensitivity.mjs [http://127.0.0.1:4192]

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
const FIRST = { id: "zao", x: 128, y: 372, w: 176, h: 92 };
const LATER = { id: "wan", x: 88, y: 354, w: 112, h: 112 };

const seedState = () => ({
  version: 1,
  activeCanvasId: "canvas-main",
  canvases: [{
    id: "canvas-main",
    name: "端口热区层叠灵敏度自检",
    category: "",
    nodes: [
      { id: FIRST.id, type: "rect", x: FIRST.x, y: FIRST.y, w: FIRST.w, h: FIRST.h, label: "先画的矩形节点", note: "", marker: "待讨论" },
      { id: LATER.id, type: "diamond", x: LATER.x, y: LATER.y, w: LATER.w, h: LATER.h, label: "后画的决定节点", note: "", marker: "待讨论", condition: "", exitCondition: "" },
    ],
    edges: [],
    view: { zoom: 1, panX: 0, panY: 0 },
  }],
});

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });

await page.goto(url);
await page.waitForLoadState("networkidle");
await page.evaluate(({ s, k }) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(s)); }, { s: seedState(), k: KEY });
await page.reload();
await page.waitForLoadState("networkidle");

const 修复是否生效 = await page.evaluate(() =>
  getComputedStyle(document.querySelector('.node[data-node-id="wan"]')).isolation);

const scanForeignHits = (insideId) => page.evaluate((nid) => {
  const box = document.querySelector(`.node[data-node-id="${nid}"]`).getBoundingClientRect();
  const foreign = [];
  for (let y = Math.ceil(box.top) + 2; y <= Math.floor(box.bottom) - 2; y += 2) {
    for (let x = Math.ceil(box.left) + 2; x <= Math.floor(box.right) - 2; x += 2) {
      const el = document.elementFromPoint(x, y);
      const owner = el?.closest?.(".node")?.dataset.nodeId ?? null;
      if (owner !== nid) foreign.push({ x, y, hit: el?.tagName?.toLowerCase() ?? null, cls: String(el?.getAttribute?.("class") ?? ""), 属于节点: owner, 是不是端口: !!el?.closest?.(".port") });
    }
  }
  return { 外来命中数: foreign.length, 前几例: foreign.slice(0, 6) };
}, insideId);

// 「争议点」＝既在后画那个节点本体里、又在先画那个节点左端口热区里的那个点。
// 跟验收套件用同一套算法**现算**，不写死坐标——世界坐标和屏幕坐标差着一段（实测 x+78、y+72），
// 写死坐标会指到别的地方去，那这个自检就白做了。
const 争议点 = await page.evaluate(({ firstId, laterId }) => {
  const port = document.querySelector(`.node[data-node-id="${firstId}"] .port[data-side="left"]`);
  const node = document.querySelector(`.node[data-node-id="${laterId}"]`);
  if (!port || !node) return null;
  const pr = port.getBoundingClientRect();
  const after = getComputedStyle(port, "::after");
  const w = parseFloat(after.width);
  const h = parseFloat(after.height);
  const cx = pr.left + pr.width / 2;
  const cy = pr.top + pr.height / 2;
  const 热区 = { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 };
  const nb = node.getBoundingClientRect();
  const box = {
    left: Math.max(热区.left, nb.left),
    top: Math.max(热区.top, nb.top),
    right: Math.min(热区.right, nb.right),
    bottom: Math.min(热区.bottom, nb.bottom),
  };
  return {
    点: { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 },
    热区,
    后画节点矩形: { left: nb.left, top: nb.top, right: nb.right, bottom: nb.bottom },
  };
}, { firstId: FIRST.id, laterId: LATER.id });

const 命中 = (pt) => page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  return { tag: el?.tagName?.toLowerCase() ?? null, cls: String(el?.getAttribute?.("class") ?? ""), 属于节点: el?.closest?.(".node")?.dataset.nodeId ?? null, 是不是端口: !!el?.closest?.(".port") };
}, pt);

// 第一遍：修复原样（应干净）——争议点该选中上面那个节点、不该碰到底下那个端口
const 修复原样 = {
  isolation: 修复是否生效,
  后画节点内外来命中: await scanForeignHits(LATER.id),
  争议点命中: 争议点 ? await 命中(争议点.点) : null,
};

// 第二遍：把修复临时撤销（只改这一页的样式，不动仓库文件）——缺陷应当重现
await page.addStyleTag({ content: ".node { isolation: auto !important; }" });
await page.waitForTimeout(100);
const 撤销修复 = {
  isolation: await page.evaluate(() => getComputedStyle(document.querySelector('.node[data-node-id="wan"]')).isolation),
  后画节点内外来命中: await scanForeignHits(LATER.id),
  争议点命中: 争议点 ? await 命中(争议点.点) : null,
};
await page.screenshot({ path: path.join(outDir, "灵敏度自检_撤销修复后.png") });
await page.evaluate(() => { const tags = document.querySelectorAll("style"); tags[tags.length - 1]?.remove(); });

const 结论 = {
  目标地址: url,
  争议点: 争议点,
  修复原样,
  撤销修复,
  自检项: {
    "修复在时页面确实生效（isolation=isolate）": 修复原样.isolation === "isolate",
    "修复在时上层节点本体没被偷（外来命中=0）": 修复原样.后画节点内外来命中.外来命中数 === 0,
    "修复在时争议点命中上层节点本体": 修复原样.争议点命中?.属于节点 === LATER.id && 修复原样.争议点命中?.是不是端口 === false,
    "撤销修复后缺陷重现（外来命中>0）": 撤销修复.后画节点内外来命中.外来命中数 > 0,
    "撤销修复后争议点落到下层节点的端口上": 撤销修复.争议点命中?.是不是端口 === true,
  },
};
结论.套件是否真的有灵敏度 = Object.values(结论.自检项).every(Boolean);
fs.writeFileSync(path.join(outDir, "灵敏度自检.json"), JSON.stringify(结论, null, 2), "utf8");
console.log(JSON.stringify(结论, null, 2));

await browser.close();
console.log(`\n灵敏度自检：修复在时外来命中 ${修复原样.后画节点内外来命中.外来命中数} 个点、争议点命中 ${JSON.stringify(修复原样.争议点命中)}；把修复撤销后 ${撤销修复.后画节点内外来命中.外来命中数} 个点、争议点命中 ${JSON.stringify(撤销修复.争议点命中)}。套件有灵敏度 = ${结论.套件是否真的有灵敏度}`);
