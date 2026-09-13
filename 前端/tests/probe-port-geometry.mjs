// 探针：量清楚端口的真实几何与可点范围（定位/出报告用，不是验收证据）
//
// 什么时候用它：怀疑「端口的可点范围到底有多大」「改了 ::after 的 inset 之后实际变成多大」
//   这类几何问题时，先跑它拿到实测数字，别凭 CSS 里的注释推断——2026-09-13 就是靠它发现
//   注释写「≥44px」而实际只有 40×40（端口 16px 是 border-box，含 2px 边框，::after 的 inset
//   相对 padding box 算，12 + 14×2 = 40）。同一天用户抱怨「鼠标离端口中心 20 像素、明明在空白处
//   也会被端口抢走」，于是把 inset 由 -14px 收小到 -8px（12 + 8×2 = 28，半径 14），收完又用它复量。
//
// 量法：不推算，只用 document.elementFromPoint 从端口中心向上下左右四个方向**逐像素**打点，
//   记下「最后一个还能命中端口的距离」——那就是热区的真实半径。这跟浏览器决定「这一下点到谁」
//   是同一套规则，所以读数跟真点下去的结果一致。再用 getComputedStyle(port, "::after").width
//   取一份「样式上算出来的」直径，两者对照，对不上就说明有渲染取整或别的样式插了手。
//
// 读报告时注意一处会吓人一跳的正常现象：四个方向测出来的半径常常不是同一个数，而是
//   「右 13 / 左 14 / 下 13 / 上 14」这样两两差 1 像素。这不是形状不圆，也不是缺陷——
//   热区是偶数直径（28）且中心正好落在整数像素线上时，它的左右边界恰好压在整数像素坐标上；
//   浏览器判定命中用的是「含左不含右、含上不含下」的半开区间，于是向右/向下走到边界那一步
//   判定为「不在里面」，向左/向上走到边界那一步判定为「在里面」，各差 1 像素。换成奇数直径
//   或者中心落在半像素上，这个差值就会换个方向出现。结论口径因此定为「四方向半径极差 ≤ 1 像素」。
//
// 本探针只读、只打印，不改仓库里任何文件。
//
// 用法：
//   node tests/probe-port-geometry.mjs [目标地址] [证据目录]
//   环境变量 PORT_PROBE_DPR=1.25 可以指定设备像素比，用来对照「Windows 125% 缩放」那一档。
//   2026-09-13 就这件事量过一次，结论出乎意料：按 dpr=1 和 dpr=1.25 各跑一遍，两次都量到 28、
//   半径 14——用 deviceScaleFactor 模拟出来的像素比，并不会让边框宽度走上真实缩放下的取整路径。
//   同一天用 Playwright MCP 驱动**真实有头** Chrome 153（本机 Windows 125% 缩放）量同一份 CSS，
//   得到的是 28.8、逐像素实测半径约 15（左 15，右/上/下各 14）。所以 28.8 是真的，只是本探针
//   模拟不出来：真实显示器上的浮动只能在真机上量，别拿模拟值推断「换台机器会变成多少」。
//   指定 dpr 时报告另存为 端口热区几何报告_dpr1.25.json，不覆盖 dpr=1 的那份主证据。
//   环境变量 PORT_PROBE_HEADFUL=1 会开一个**真实有头的 Chrome 窗口**来量（量完自己关掉）。
//   什么时候非要开这个：要回答「在用户这块屏幕上热区到底多大」时。无头环境量不出真机的边界取整
//   （见上面那条），所以真机读数只能让真窗口量；开头的报告会另存为 端口热区几何报告_真机有头.json。
// 说明：目标地址靠 _served-target.mjs「按 app.js 内容认人」解析，不会误跑到别处的副本上。

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { resolveCanvasUrl } from "./_served-target.mjs";

const require = createRequire("D:/nodejs/npm-global/package.json");
const { chromium } = require("playwright");

const url = await resolveCanvasUrl(process.argv[2]);
const outDir = process.argv[3] || "D:/agent临时/画布端口热区验收-20260913"; // 与 port-hotspot-stacking-acceptance.mjs 用同一个证据目录，免得一份证据散在两处
fs.mkdirSync(outDir, { recursive: true });

const 指定DPR = Number(process.env.PORT_PROBE_DPR || 0) || null;
// 有头模式：真机屏幕缩放下的边框取整只有在真窗口里才量得到（无头 + deviceScaleFactor 量不出来）。
const 有头 = process.env.PORT_PROBE_HEADFUL === "1";
const browser = await chromium.launch({
  headless: !有头,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ...(有头 ? { args: ["--window-size=1440,900", "--window-position=40,40"] } : {}),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 820 },
  ...(指定DPR ? { deviceScaleFactor: 指定DPR } : {}),
});
const KEY = "workflow-canvas-communication-draft-v1";

// 「后画」那个节点挪到远处，免得它挡住「先画」那个节点的右侧端口
const seed = {
  version: 1, activeCanvasId: "canvas-main",
  canvases: [{
    id: "canvas-main", name: "探针", category: "",
    nodes: [
      { id: "zao", type: "rect", x: 128, y: 372, w: 176, h: 92, label: "先画", note: "", marker: "待讨论" },
      { id: "wan", type: "diamond", x: 700, y: 600, w: 112, h: 112, label: "后画", note: "", marker: "待讨论", condition: "", exitCondition: "" },
    ],
    edges: [], view: { zoom: 1, panX: 0, panY: 0 },
  }],
};

await page.goto(url);
await page.waitForLoadState("networkidle");
await page.evaluate(({ s, k }) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(s)); }, { s: seed, k: KEY });
await page.reload();
await page.waitForLoadState("networkidle");

const 扫描上限 = 30; // 从端口中心向外最多打这么多像素

const out = await page.evaluate((上限) => {
  const node = document.querySelector('.node[data-node-id="zao"]');
  const nr = node.getBoundingClientRect();
  const port = node.querySelector('.port[data-side="right"]');
  const pr = port.getBoundingClientRect();
  const cs = getComputedStyle(port);
  const after = getComputedStyle(port, "::after");
  const nodeCS = getComputedStyle(node);

  const cx = pr.left + pr.width / 2;
  const cy = pr.top + pr.height / 2;

  // 一个方向逐像素打一遍：返回每个距离上的命中，以及「最后一个还命中端口的距离」
  const 方向 = {
    右: { dx: 1, dy: 0 }, 左: { dx: -1, dy: 0 },
    下: { dx: 0, dy: 1 }, 上: { dx: 0, dy: -1 },
  };
  const 逐像素 = {};
  const 实测半径 = {};
  for (const [名称, d] of Object.entries(方向)) {
    const rows = [];
    let 最后命中 = null;
    for (let t = 0; t <= 上限; t += 1) {
      const x = cx + d.dx * t;
      const y = cy + d.dy * t;
      const el = document.elementFromPoint(x, y);
      const 是端口 = !!el?.closest?.(".port");
      const 属于节点 = el?.closest?.(".node")?.dataset.nodeId ?? null;
      if (是端口 && 属于节点 === "zao") 最后命中 = t;
      rows.push({ 距中心: t, 命中元素: el?.tagName?.toLowerCase() ?? null, 命中的类: String(el?.getAttribute?.("class") ?? ""), 属于节点, 是端口 });
    }
    逐像素[名称] = rows;
    实测半径[名称] = 最后命中;
  }

  const 样式直径 = { w: parseFloat(after.width), h: parseFloat(after.height) };

  return {
    节点矩形: { left: nr.left, right: nr.right, top: nr.top, bottom: nr.bottom },
    端口矩形: { left: pr.left, right: pr.right, top: pr.top, bottom: pr.bottom, w: pr.width, h: pr.height },
    端口中心: { x: cx, y: cy },
    端口计算样式: { boxSizing: cs.boxSizing, position: cs.position, zIndex: cs.zIndex, pointerEvents: cs.pointerEvents, opacity: cs.opacity, padding: cs.padding, border: cs.borderWidth },
    after样式: { top: after.top, right: after.right, bottom: after.bottom, left: after.left, width: after.width, height: after.height, position: after.position, inset: after.inset, borderRadius: after.borderRadius },
    节点样式: { overflow: nodeCS.overflow, isolation: nodeCS.isolation },
    设备像素比: window.devicePixelRatio,
    样式算出来的热区直径: 样式直径,
    样式算出来的半径: 样式直径.w / 2,
    四方向实测半径: 实测半径,
    四方向逐像素: 逐像素,
  };
}, 扫描上限);

const 半径们 = Object.values(out.四方向实测半径).filter((v) => v !== null);
const 半径极差 = 半径们.length ? Math.max(...半径们) - Math.min(...半径们) : null;
const 报告 = {
  目标地址: url,
  采样时间说明: "本报告由 probe-port-geometry.mjs 现场实测生成，数字不是从 CSS 注释抄的",
  ...out,
  结论: {
    "样式直径": out.样式算出来的热区直径.w,
    "样式半径": out.样式算出来的半径,
    "四方向实测半径": out.四方向实测半径,
    "四方向半径极差（像素）": 半径极差,
    // 不写「四个方向必须一模一样」：偶数直径 + 整数中心必然让边界两侧各差 1 像素（见文件头说明）。
    // 卡成「完全相等」会把一个正常的边界语义判成失败，也会掩盖真正该报的「差出 2 像素以上」。
    "四方向半径是否吻合（极差 ≤ 1 像素）": 半径极差 !== null && 半径极差 <= 1,
    "端口中心是否落在整数像素上": Number.isInteger(out.端口中心.x) && Number.isInteger(out.端口中心.y),
    "实测半径与样式半径是否吻合（容差 1 像素，留给亚像素取整）":
      半径们.length === 4 && 半径们.every((v) => Math.abs(v - out.样式算出来的半径) <= 1),
    "端口视觉直径": out.端口矩形.w,
  },
};

const 报告名 = 有头
  ? (指定DPR ? `端口热区几何报告_真机有头_dpr${指定DPR}.json` : "端口热区几何报告_真机有头.json")
  : (指定DPR ? `端口热区几何报告_dpr${指定DPR}.json` : "端口热区几何报告.json");
const 证据路径 = path.join(outDir, 报告名);
fs.writeFileSync(证据路径, JSON.stringify(报告, null, 2), "utf8");
console.log(JSON.stringify(报告.结论, null, 2));
console.log(`\n端口热区几何：样式算出来直径 ${out.样式算出来的热区直径.w}（半径 ${out.样式算出来的半径}），四方向逐像素实测半径 ${JSON.stringify(out.四方向实测半径)}，设备像素比 ${out.设备像素比}。`);
console.log(`完整报告：${证据路径}`);

await browser.close();
