// 搭建脚本：用真实交互（点工具栏、点画布、双击改字、从端口拖线、勾循环）把电商订单打印发货流程搭到画布上
// 边搭边记录使用体验（exp 数组）。只做真实输入事件，不做 DOM/Store 直改（除起始空画布 seed 外）。
// 判断节点（diamond）端口新语义：进=上(top)、出=分支端口（是=下、否=右、未定=左）；
// 从输出端口拖出的连线会自动带上分支标签（edge.branch），本脚本据此验证，不再手动点分支按钮。
import { launchChromium } from "./_runtime.mjs";
import { resolveCanvasUrl } from "./_served-target.mjs";
import { mkdirSync } from "node:fs";

const url = await resolveCanvasUrl(process.argv[2] || "http://127.0.0.1:4173/index.html");
const shotDir = "C:/Users/Administrator/AppData/Local/Temp/canvas-ecommerce";
const STORAGE_KEY = "workflow-canvas-communication-draft-v1";

const empty = {
  version: 1,
  activeCanvasId: "canvas-main",
  canvases: [{
    id: "canvas-main", name: "电商订单打印发货", category: "",
    nodes: [], edges: [],
    view: { zoom: 1, panX: 0, panY: 0 },
  }],
};

// 节点（cx/cy 为期望的世界坐标中心）
const NODES = [
  { type: "circle",  label: "开始", cx: 140, cy: 100 },
  { type: "rect",    label: "打印订单", cx: 140, cy: 250 },
  { type: "diamond", label: "判断：有无库存", cx: 140, cy: 420, condition: "库存是否充足？" },
  { type: "rect",    label: "拣货打包", cx: 420, cy: 180 },
  { type: "rect",    label: "缺货登记", cx: 420, cy: 380 },
  { type: "rect",    label: "人工核实", cx: 140, cy: 620 },
  { type: "diamond", label: "判断：重量地址异常", cx: 700, cy: 420, condition: "重量或地址是否异常？" },
  { type: "rect",    label: "贴单发货", cx: 980, cy: 180 },
  { type: "rect",    label: "人工处理", cx: 980, cy: 380 },
  { type: "circle",  label: "结束", cx: 1180, cy: 420 },
];

const EDGES = [
  { from: "开始", to: "打印订单" },
  { from: "打印订单", to: "判断：有无库存" },
  { from: "判断：有无库存", to: "拣货打包", branch: "是" },
  { from: "判断：有无库存", to: "缺货登记", branch: "否" },
  { from: "判断：有无库存", to: "人工核实", branch: "未定" },
  { from: "拣货打包", to: "判断：重量地址异常" },
  { from: "缺货登记", to: "判断：重量地址异常" },
  { from: "人工核实", to: "判断：有无库存", loop: true },
  { from: "判断：重量地址异常", to: "人工处理", branch: "是" },
  { from: "判断：重量地址异常", to: "贴单发货", branch: "否" },
  { from: "贴单发货", to: "结束" },
  { from: "人工处理", to: "结束" },
];

// 几何侧向：普通节点间的连线按相对位置选端口
function geomSide(a, b, end) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? (end === "from" ? "right" : "left") : (end === "from" ? "left" : "right");
  return dy >= 0 ? (end === "from" ? "bottom" : "top") : (end === "from" ? "top" : "bottom");
}
// 分支标签 → 判断节点输出端口：是=下(bottom)、否=右(right)、未定=左(left)
function branchSide(branch) { if (branch === "是") return "bottom"; if (branch === "否") return "right"; if (branch === "未定") return "left"; return ""; }
// 判断节点端口语义：进=上(top)、出=branch 端口；目标是判断节点时从 top（进）进
function sidesFor(e, a, b) {
  const from = e.branch ? branchSide(e.branch) : geomSide(a, b, "from");
  const to = b.type === "diamond" ? "top" : geomSide(a, b, "to");
  return { from, to };
}

const browser = await launchChromium({ headless: true });
const exp = [];
const pageErrors = [];
try {
  mkdirSync(shotDir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(url);
  // 关键：先等 loadFromDisk 的异步 fetch 完成（networkidle 覆盖它），否则它稍后 resolve 会用 saveLocal
  // 把磁盘旧数据写回 localStorage，覆盖下面即将 seed 的空画布。
  await page.waitForLoadState("networkidle");
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }, empty);
  await page.reload();
  await page.waitForLoadState("networkidle");

  const vp = await page.locator("#viewport").boundingBox();
  const world2screen = (wx, wy) => ({ x: vp.x + wx, y: vp.y + wy });
  const readState = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), STORAGE_KEY);
  const nodeCount = () => page.evaluate((k) => { const s = JSON.parse(localStorage.getItem(k)); return s?.canvases?.[0]?.nodes?.length ?? 0; }, STORAGE_KEY);
  const edgeCount = () => page.evaluate((k) => { const s = JSON.parse(localStorage.getItem(k)); return s?.canvases?.[0]?.edges?.length ?? 0; }, STORAGE_KEY);

  // 1) 加节点：点工具栏按钮 → 点画布坐标
  const labelToId = {};
  for (const n of NODES) {
    const before = await nodeCount();
    await page.locator(`.tool-button[data-tool="${n.type}"]`).click();
    const p = world2screen(n.cx, n.cy);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(80);
    const after = await nodeCount();
    // 读回刚加的节点（最后一个）
    const st = await readState();
    const last = st.canvases[0].nodes[st.canvases[0].nodes.length - 1];
    labelToId[n.label] = last.id;
    exp.push({ step: `加节点「${n.label}」(${n.type})`, ok: after === before + 1, detail: `节点数 ${before}→${after}, id=${last.id}` });
  }

  // 2) 改标签：双击节点中心 → 输入 → Enter
  for (const n of NODES) {
    const id = labelToId[n.label];
    const el = page.locator(`.node[data-node-id="${id}"]`);
    const box = await el.boundingBox();
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(120);
    const editable = await el.locator(".node-label").evaluate((x) => x.isContentEditable);
    await page.keyboard.insertText(n.label);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(120);
    const st = await readState();
    const got = st.canvases[0].nodes.find((x) => x.id === id)?.label;
    exp.push({ step: `双击改字「${n.label}」`, ok: editable && got === n.label, detail: `contenteditable=${editable}, 结果label=${got}` });
  }

  // 3) 判断节点设条件：切选择工具 → 选中 → inspectorCondition 输入 → Tab 失焦
  for (const n of NODES.filter((x) => x.condition)) {
    const id = labelToId[n.label];
    await page.locator('.tool-button[data-tool="select"]').click(); // 点节点选中依赖 select 工具（events.js:52）
    await page.locator(`.node[data-node-id="${id}"]`).click();
    await page.waitForTimeout(120);
    const condVisible = await page.locator("#inspectorCondition").isVisible().catch(() => false);
    if (condVisible) {
      await page.locator("#inspectorCondition").fill(n.condition);
      await page.locator("#inspectorCondition").press("Tab");
      await page.waitForTimeout(120);
    }
    const st = await readState();
    const got = st.canvases[0].nodes.find((x) => x.id === id)?.condition;
    exp.push({ step: `设判断条件「${n.condition}」`, ok: got === n.condition, detail: `condition字段可见=${condVisible}, 结果=${got}` });
  }

  // 4) 连线：从源端口 mousedown → 目标端口 mouseup；记录拖线时虚线的 display（体验「看不到虚线」）
  //    对判断节点的输出边，从对应 branch 端口拖出并验证 branch 自动带对。
  const nodeByLabel = {};
  for (const n of NODES) nodeByLabel[n.label] = { id: labelToId[n.label], cx: n.cx, cy: n.cy, type: n.type };
  const dashDisplays = [];
  for (const e of EDGES) {
    const from = nodeByLabel[e.from], to = nodeByLabel[e.to];
    const sides = sidesFor(e, from, to);
    const fromPort = await page.locator(`.node[data-node-id="${from.id}"] .port[data-side="${sides.from}"]`).boundingBox();
    const toPort = await page.locator(`.node[data-node-id="${to.id}"] .port[data-side="${sides.to}"]`).boundingBox();
    // hover 源节点让端口显示（记录端口是否本来隐形）
    const srcEl = page.locator(`.node[data-node-id="${from.id}"]`);
    const sbox = await srcEl.boundingBox();
    await page.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2);
    await page.waitForTimeout(200);
    await page.mouse.move(fromPort.x + fromPort.width / 2, fromPort.y + fromPort.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(80);
    const dashOnDown = await page.locator("#temporaryEdge").evaluate((el) => getComputedStyle(el).display);
    await page.mouse.move(toPort.x + toPort.width / 2, toPort.y + toPort.height / 2, { steps: 8 });
    await page.waitForTimeout(80);
    const dashOnMove = await page.locator("#temporaryEdge").evaluate((el) => getComputedStyle(el).display);
    await page.mouse.up();
    await page.waitForTimeout(150);
    dashDisplays.push({ from: e.from, to: e.to, dashOnDown, dashOnMove });
    const st = await readState();
    const edges = st.canvases[0].edges;
    const lastEdge = edges[edges.length - 1];
    const branchOk = !e.branch || lastEdge?.branch === e.branch;
    const ok = lastEdge && lastEdge.from === from.id && lastEdge.to === to.id && branchOk;
    exp.push({ step: `连线「${e.from}」→「${e.to}」`, ok, detail: `虚线display: down=${dashOnDown} move=${dashOnMove}; 边from/to=${lastEdge?.from}/${lastEdge?.to}; branch自动=${lastEdge?.branch || ""}（期望${e.branch || "空"}）` });
  }

  // 5) 设循环回边（勾 loop）+ 验证分支标签已在拖线时自动带对（不再手动点分支按钮）
  const st0 = await readState();
  const edgeByPair = new Map();
  st0.canvases[0].edges.forEach((ed) => edgeByPair.set(ed.from + "->" + ed.to, ed.id));
  for (const e of EDGES.filter((x) => x.branch || x.loop)) {
    const from = nodeByLabel[e.from], to = nodeByLabel[e.to];
    const id = edgeByPair.get(from.id + "->" + to.id);
    if (!id) { exp.push({ step: `找连线「${e.from}→${e.to}」`, ok: false, detail: "未找到边id" }); continue; }
    // 点连线选中：反向对/循环回边会弯曲，其中点可能被端口热区或节点本体遮挡
    // （elementFromPoint 命中 port/node 而非 edge-hit，点击落空——探针已坐实）。
    // 所以沿曲线从 0.5 向两端扫，取第一个 elementFromPoint 命中本 edge-hit 的点。
    // getPointAtLength 返回 SVG 用户坐标（= 世界坐标）；#viewport 的 left/top 即屏幕偏移
    // （画布无平移缩放时与 world2screen 同一条换算路径，已被验证正确）。
    const hitWorld = await page.evaluate((edgeId) => {
      const el = document.querySelector(`.edge-hit[data-edge-id="${edgeId}"]`);
      if (!el) return null;
      const len = el.getTotalLength();
      const vp = document.querySelector("#viewport").getBoundingClientRect();
      for (let t = 0.5; t >= 0.05; t -= 0.05) {
        const pt = el.getPointAtLength(len * t);
        const hit = document.elementFromPoint(vp.left + pt.x, vp.top + pt.y);
        if (hit && hit.classList && hit.classList.contains("edge-hit") && hit.dataset.edgeId === edgeId) return { x: pt.x, y: pt.y };
      }
      return null;
    }, id);
    if (hitWorld) { const s = world2screen(hitWorld.x, hitWorld.y); await page.mouse.click(s.x, s.y); await page.waitForTimeout(150); }
    // 注意：selectedEdgeId 是顶层 let 声明（state.js:23），不挂到 window 上，
    // 必须用裸标识符读，不能写 window.selectedEdgeId（那样恒为 null）。
    const selectedEdgeId = await page.evaluate(() => (typeof selectedEdgeId !== "undefined" ? selectedEdgeId : null));
    exp.push({ step: `选中连线「${e.from}→${e.to}」`, ok: selectedEdgeId === id, detail: `selectedEdgeId=${selectedEdgeId}` });
    if (e.branch) {
      const st = await readState();
      const got = st.canvases[0].edges.find((x) => x.id === id)?.branch;
      exp.push({ step: `验证分支标签「${e.branch}」`, ok: got === e.branch, detail: `拖线自动带branch=${got}` });
    }
    if (e.loop) {
      const chk = page.locator("#inspectorEdgeLoop");
      const vis = await chk.isVisible().catch(() => false);
      if (vis) { await chk.check(); await page.waitForTimeout(120); }
      const st = await readState();
      const got = st.canvases[0].edges.find((x) => x.id === id)?.loop;
      exp.push({ step: `设循环回边`, ok: got === true, detail: `loop勾选框可见=${vis}, 结果=${got}` });
    }
    // 取消选中，准备下一条
    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
  }

  // 6) 取消选中，缩放到能看全貌，截图
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  const finalState = await readState();
  // 读内容包围盒，判断是否需要缩小
  const bbox = await page.evaluate(() => {
    const els = [...document.querySelectorAll(".node")];
    if (!els.length) return null;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    els.forEach((el) => { const r = el.getBoundingClientRect(); minX = Math.min(minX, r.left); minY = Math.min(minY, r.top); maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom); });
    return { minX, minY, maxX, maxY };
  });
  await page.screenshot({ path: `${shotDir}/ecommerce-flow.png` });

  // 6.5) 保存到磁盘：走产品正式「保存到磁盘」功能（saveToDisk → POST /api/state → 工作流导出/画布数据.json），
  //      不手工拼 JSON 直写文件。存完再从 /api/state GET 读回，验证磁盘上确实落的是这一份电商场景。
  await page.evaluate(async () => { await saveToDisk(); });
  await page.waitForTimeout(400);
  const disk = await page.evaluate(async () => {
    try {
      const resp = await fetch("/api/state", { cache: "no-store" });
      const data = await resp.json().catch(() => ({}));
      const c = data?.state?.canvases?.[0];
      return { ok: data?.ok === true, file: data?.file || "", nodes: c?.nodes?.length ?? 0, edges: c?.edges?.length ?? 0, loopEdge: !!(c?.edges || []).some((e) => e.loop) };
    } catch (e) { return { ok: false, error: String(e) }; }
  });
  exp.push({ step: "保存到磁盘（正式功能）", ok: disk.ok === true && disk.nodes === 10 && disk.edges === 12 && disk.loopEdge, detail: JSON.stringify(disk) });

  // 汇总
  const summary = {
    nodes: finalState.canvases[0].nodes.map((n) => ({ label: n.label, type: n.type, condition: n.condition || "" })),
    edges: finalState.canvases[0].edges.map((ed) => {
      const fromL = NODES.find((x) => labelToId[x.label] === ed.from)?.label || ed.from;
      const toL = NODES.find((x) => labelToId[x.label] === ed.to)?.label || ed.to;
      return { from: fromL, to: toL, branch: ed.branch || "", loop: !!ed.loop };
    }),
    dashDisplays,
    contentBBox: bbox,
    experience: exp,
    pageErrors,
    shot: `${shotDir}/ecommerce-flow.png`,
  };
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
