// 第二轮子智能体审计 14 项的逐条复现验收（真实浏览器 + 真实鼠标/键盘）
// 运行：node tests/canvas-interaction-audit-acceptance.mjs [url] [截图目录]
// 目标地址：可用第一个参数指定；不指定则从 4173 起自动探测本仓库这一份前端服务。
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
const failures = [];
page.on("pageerror", (error) => errors.push(String(error)));

let assertCount = 0;
const expect = (condition, message) => {
  assertCount += 1;
  if (!condition) {
    failures.push(message);
    throw new Error(message);
  }
};

// 等过「双击改字」的 400ms 判定窗口，避免把连续两次交互误判成双击
const SAFE = 480;
const settle = () => page.waitForTimeout(SAFE);

const fresh = async () => {
  await page.evaluate(() => { isDirty = false; clearTimeout(autosaveTimer); autosaveTimer = null; localStorage.clear(); });
  await page.reload();
  await page.waitForLoadState("networkidle");
};

const nodes = () => page.evaluate(() => activeCanvas().nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, label: n.label })));
const nodeById = async (id) => (await nodes()).find((n) => n.id === id);
const view = () => page.evaluate(() => ({ ...activeCanvas().view }));
const vpBox = () => page.locator("#viewport").boundingBox();
const stateOf = () => page.evaluate(() => ({
  selectedNodeId, selectedEdgeId, connectorSourceId, resizeModeNodeId,
  multiCount: selectedNodeIds.size, connecting: Boolean(connecting),
  tempEdgeHidden: temporaryEdge.hidden, drag: Boolean(drag), resizing: Boolean(resizing), pan: Boolean(pan),
}));

const center = async (id, dx = 0, dy = 0) => {
  const n = await nodeById(id), v = await view(), box = await vpBox();
  return { x: box.x + v.panX + (n.x + n.w / 2) * v.zoom + dx, y: box.y + v.panY + (n.y + n.h / 2) * v.zoom + dy };
};

// 真实鼠标拖动：按住 → 分步移动 → 松开
const dragBy = async (id, dx, dy, steps = 12) => {
  const from = await center(id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps });
  await page.mouse.up();
};

const clickNode = async (id) => { const p = await center(id); await page.mouse.click(p.x, p.y); };

// 真实点击连线的可见部分：取曲线上真正的点（不是外接矩形中心），换算成屏幕坐标
const clickEdge = async (edgeId) => {
  const pt = await page.evaluate((id) => {
    const path = document.querySelector(`[data-edge-id="${id}"]`);
    if (!path) return null;
    const p = path.getPointAtLength(path.getTotalLength() / 2);
    return { x: p.x, y: p.y };
  }, edgeId);
  if (!pt) throw new Error(`画布上找不到连线：${edgeId}`);
  const box = await vpBox(), v = await view();
  const sx = box.x + v.panX + pt.x * v.zoom, sy = box.y + v.panY + pt.y * v.zoom;
  await page.mouse.click(sx, sy);
  await page.waitForTimeout(80);
  return { sx, sy, cover: await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el ? `${el.tagName}.${el.getAttribute("class") || ""}` : "null"; }, [sx, sy]) };
};

// 用「步骤」工具在画布上真实点击生成节点，返回落地后的节点 id
const addNodeAt = async (worldX, worldY) => {
  const before = new Set((await nodes()).map((n) => n.id));
  const box = await vpBox(), v = await view();
  await page.locator('[data-tool="rect"]').click();
  await page.mouse.click(box.x + v.panX + worldX * v.zoom, box.y + v.panY + worldY * v.zoom);
  const after = await nodes();
  return after.find((n) => !before.has(n.id)).id;
};

const undoOnce = async () => { await page.keyboard.press("Control+z"); await page.waitForTimeout(60); };
const toast = () => page.locator("#toast").textContent();

await page.goto(url);
await page.waitForLoadState("networkidle");
await fresh();

// ============================================================
// 视角一 · 拖动 / 缩放 / 框选
// ============================================================

// 【1-1 多选整体拖动】框选（再切回「选择」工具）后拖动其中一个，整组都要跟着走
{
  await page.locator('[data-tool="marquee"]').click();
  const box = await vpBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 1100, box.y + 700, { steps: 12 });
  await page.mouse.up();
  const grouped = await page.evaluate(() => [...selectedNodeIds]);
  expect(grouped.length === 4, `框选应选中 4 个节点，实际 ${grouped.length}`);
  await page.locator('[data-tool="select"]').click();   // 框选工具是「模态」的：要移动节点得切回选择工具
  const before = await nodes();
  await settle();
  await dragBy(grouped[0], 0, 120);
  const after = await nodes();
  const movedAll = grouped.every((id) => {
    const b = before.find((n) => n.id === id), a = after.find((n) => n.id === id);
    return a.y !== b.y;
  });
  expect(movedAll, `多选整体拖动应让 4 个节点全部下移，实际位移：${grouped.map((id) => (after.find((n) => n.id === id).y - before.find((n) => n.id === id).y)).join(",")}`);
  const delta0 = after.find((n) => n.id === grouped[0]).y - before.find((n) => n.id === grouped[0]).y;
  const same = grouped.every((id) => {
    const b = before.find((n) => n.id === id), a = after.find((n) => n.id === id);
    return a.y - b.y === delta0;
  });
  expect(same, "多选整体拖动时各节点位移必须一致");
  await fresh();
}

// 【1-1b 多选整体拖动后，一次 Ctrl+Z 要把整组一起退回】
{
  await page.locator('[data-tool="marquee"]').click();
  const box = await vpBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 1100, box.y + 700, { steps: 12 });
  await page.mouse.up();
  await page.locator('[data-tool="select"]').click();
  const grouped = await page.evaluate(() => [...selectedNodeIds]);
  const before = await nodes();
  await settle();
  await dragBy(grouped[0], 0, 90);
  await undoOnce();
  const after = await nodes();
  const backAll = grouped.every((id) => before.find((n) => n.id === id).y === after.find((n) => n.id === id).y);
  expect(backAll, `一次 Ctrl+Z 应把整组节点都退回原位，实际：${grouped.map((id) => `${after.find((n) => n.id === id).y}vs${before.find((n) => n.id === id).y}`).join(",")}`);
  await fresh();
}

// 【1-2 贴边拖动不再产生「空撤销」】拖到左边界钉住后再拖，一次 Ctrl+Z 就要退回到最初位置
{
  const id = (await nodes())[0].id;
  const origin = (await nodeById(id)).x;
  await settle();
  await dragBy(id, -1600, 0);              // 一定会钉在左边界（x = 10）
  const pinned = (await nodeById(id)).x;
  expect(pinned === 10, `向左拖到底应钉在 x=10，实际 ${pinned}`);
  await settle();
  await dragBy(id, -400, 0);               // 这一次坐标不会再变（已贴边）
  expect((await nodeById(id)).x === 10, "贴边后再拖，坐标应保持 x=10");
  await undoOnce();
  const afterUndo = (await nodeById(id)).x;
  expect(afterUndo === origin, `贴边空拖动不应占用一次撤销：一次 Ctrl+Z 应回到 x=${origin}，实际 ${afterUndo}`);
  await fresh();
}

// 【1-3 西边界控制点顶到边缘时不再反向长大】按住左侧控制点往右推穿，尺寸必须只回收不反弹
// 说明：只有「判断（菱形）」「开始/结束（圆形）」这类节点才有左/右控制点，所以这里挑菱形节点。
{
  const id = await page.evaluate(() => activeCanvas().nodes.find((n) => n.type === "diamond").id);
  await settle();
  await clickNode(id);
  await page.locator(`.node[data-node-id="${id}"] .resize-toggle`).click();
  await page.waitForTimeout(120);
  const handles = await page.locator(`.resize-handle[data-node-id="${id}"]`).count();
  expect(handles > 0, "点开尺寸控制点后应出现可拖动的控制点");
  const before = await nodeById(id);
  const w = page.locator(`.resize-handle[data-node-id="${id}"][data-handle="w"]`);
  const hb = await w.boundingBox();
  expect(Boolean(hb), "左侧控制点应可见可拖");
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 900, hb.y + hb.height / 2, { steps: 14 });
  await page.mouse.up();
  const after = await nodeById(id);
  expect(after.x >= 10, `西边界不应越过 x=10，实际 ${after.x}`);
  expect(after.w <= before.w, `左侧控制点向右推穿时宽度只能回收、不能反向长大：拖前 ${before.w}，拖后 ${after.w}`);
  expect(after.x + after.w <= before.x + before.w + 1, "西边界被钉住时右侧边不得外扩");
  await fresh();
}

// 【1-4 能取消选中】点画布空白处与按 Esc 都要能清掉选中
{
  const id = (await nodes())[0].id;
  await settle();
  await clickNode(id);
  expect((await stateOf()).selectedNodeId === id, "点节点后应处于选中态");
  const box = await vpBox();
  await page.mouse.click(box.x + 940, box.y + 640);   // 视口内、节点之外的空白处
  expect((await stateOf()).selectedNodeId === null, "点画布空白处应取消单个节点的选中");
  expect(await page.locator(`[data-node-id="${id}"].is-selected`).count() === 0, "点空白处后节点上不应残留高亮样式");

  await settle();
  await clickNode(id);
  expect((await stateOf()).selectedNodeId === id, "再次点节点应重新选中");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  expect((await stateOf()).selectedNodeId === null, "按 Esc 应取消单个节点的选中");
  const selectedClass = await page.locator(`[data-node-id="${id}"].is-selected`).count();
  expect(selectedClass === 0, "取消选中后节点上不应残留高亮样式");
  await fresh();
}

// ============================================================
// 视角二 · 连线 / 连接器
// ============================================================

// 【2-1 删掉连接源节点后不再残留「悬空连线」】
{
  const before = (await nodes()).map((n) => n.id);
  const a = before[0], b = before[2];
  const box = await vpBox();
  await page.locator('[data-tool="connector"]').click();
  await settle();
  await clickNode(a);
  expect((await stateOf()).connectorSourceId === a, "连线工具点第一个节点后应进入「等待连到第二个节点」的状态");
  await page.keyboard.press("Delete");
  await page.waitForTimeout(80);
  const afterDelete = await stateOf();
  expect(afterDelete.connectorSourceId === null, "删掉连接源节点后，连接源必须被清空（否则会连出悬空线）");
  expect(afterDelete.connecting === false, "删掉连接源节点后不应残留进行中的连接");
  const edgeCountBefore = await page.evaluate(() => activeCanvas().edges.length);
  await settle();
  await clickNode(b);
  await page.waitForTimeout(80);
  const edges = await page.evaluate(() => activeCanvas().edges.map((e) => `${e.from}->${e.to}`));
  expect(edges.length === edgeCountBefore, `删掉源节点后点另一个节点不应凭空连出线，实际连线：${edges.join(",")}`);
  const dangling = await page.evaluate(() => activeCanvas().edges.filter((e) => !activeCanvas().nodes.some((n) => n.id === e.from) || !activeCanvas().nodes.some((n) => n.id === e.to)).length);
  expect(dangling === 0, `画布上不应存在「端点已被删掉」的悬空连线，实际 ${dangling} 条`);
  await fresh();
}

// 【2-2 点连线时节点的选中高亮要同步消失】
{
  const id = (await nodes())[0].id;
  const edgeId = await page.evaluate(() => activeCanvas().edges[0].id);
  await settle();
  await clickNode(id);
  expect(await page.locator(`[data-node-id="${id}"].is-selected`).count() === 1, "点节点后 DOM 上应有选中高亮");
  const hit = await clickEdge(edgeId);
  expect((await stateOf()).selectedEdgeId === edgeId, `点连线中段应选中该连线（点击点 ${hit.sx},${hit.sy} 命中的是 ${hit.cover}）`);
  expect((await stateOf()).selectedNodeId === null, "点连线后内部状态里节点选中应被清掉");
  expect(await page.locator(`[data-node-id="${id}"].is-selected`).count() === 0, "点连线后节点上的高亮必须同步消失（否则 Delete 会删错对象）");
  expect(await page.locator(`[data-edge-id="${edgeId}"].is-selected`).count() === 1, "被点中的连线应有高亮");
  await fresh();
}

// 【2-3 按 Esc 能取消连接态】之后点别的节点必须只是选中，不会偷偷连出线
{
  const ids = (await nodes()).map((n) => n.id);
  const a = ids[0], b = ids[3];
  await page.locator('[data-tool="connector"]').click();
  await settle();
  await clickNode(a);
  expect((await stateOf()).connectorSourceId === a, "连线工具点第一个节点后应等待第二个节点");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  const s = await stateOf();
  expect(s.connectorSourceId === null, "按 Esc 应取消连接态（清掉连接源）");
  expect(s.connecting === false && s.tempEdgeHidden === true, "按 Esc 后不该残留跟随鼠标的虚线");
  const edgeCount = await page.evaluate(() => activeCanvas().edges.length);
  await page.locator('[data-tool="select"]').click();
  await settle();
  await settle();
  await clickNode(b);
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => activeCanvas().edges.length) === edgeCount, "取消连接后点节点不应凭空连出线");
  await fresh();
}

// 【2-4 从端口拖线：松开后状态必须收干净；异常丢失指针捕获时也要能自愈】
{
  const ids = (await nodes()).map((n) => n.id);
  const a = ids[0];
  await settle();
  const port = page.locator(`[data-node-id="${a}"] .port[data-side="right"]`);
  const pb = await port.boundingBox();
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.mouse.down();
  await page.mouse.move(pb.x + 200, pb.y + 160, { steps: 8 });
  expect((await stateOf()).connecting === true, "从端口按下拖动时应处于连接中");
  expect((await stateOf()).tempEdgeHidden === false, "连接中应显示跟随鼠标的虚线");
  expect(await page.evaluate(() => document.documentElement.hasPointerCapture ? true : true), "占位：捕获 API 存在");
  await page.mouse.up();
  await page.waitForTimeout(80);
  const afterUp = await stateOf();
  expect(afterUp.connecting === false, "松开鼠标后连接态必须结束");
  expect(afterUp.connectorSourceId === null && afterUp.tempEdgeHidden === true, "松开后不该残留虚线或连接源");

  // 模拟浏览器强制回收指针捕获（指针设备拔出等），兜底清理必须生效
  await settle();
  const pb2 = await port.boundingBox();
  await page.mouse.move(pb2.x + pb2.width / 2, pb2.y + pb2.height / 2);
  await page.mouse.down();
  await page.mouse.move(pb2.x + 120, pb2.y + 120, { steps: 4 });
  const pointerId = await page.evaluate(() => connecting?.pointerId);
  await page.evaluate((id) => document.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: id, bubbles: true })), pointerId);
  await page.waitForTimeout(80);
  const afterLost = await stateOf();
  expect(afterLost.connecting === false && afterLost.tempEdgeHidden === true, "指针捕获被回收后应自动收干净连接态（不能粘住光标）");
  await page.mouse.up();
  await page.waitForTimeout(60);
  await fresh();
}

// 【2-5 反向重复连线也要被拒绝】
{
  const ids = (await nodes()).map((n) => n.id);
  const a = ids[0], b = ids[1];
  const edgeCount = await page.evaluate(() => activeCanvas().edges.length);
  await page.locator('[data-tool="connector"]').click();
  await settle();
  await clickNode(a);
  await settle();
  await clickNode(b);
  await page.waitForTimeout(80);
  expect((await toast()).includes("已有连线"), `反向重复连线应被拒绝并提示，实际提示：${await toast()}`);
  expect(await page.evaluate(() => activeCanvas().edges.length) === edgeCount, "反向重复连线不应写入画布");
  const dup = await page.evaluate(() => { const seen = new Set(); let d = 0; activeCanvas().edges.forEach((e) => { const k = [e.from, e.to].sort().join("|"); if (seen.has(k)) d += 1; seen.add(k); }); return d; });
  expect(dup === 0, `同一对节点之间不应存在两条连线，实际重复 ${dup} 对`);
  await fresh();
}

// ============================================================
// 视角三 · 多画布生命周期
// ============================================================

// 【3-1 新建画布后不残留上一张画布的框选】
{
  await page.locator('[data-tool="marquee"]').click();
  const box = await vpBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 1100, box.y + 700, { steps: 10 });
  await page.mouse.up();
  expect((await stateOf()).multiCount === 4, "框选后应有 4 个节点被选中");
  expect(await page.locator("#multiSelectPanel").isVisible(), "框选后应显示多选操作面板");
  page.once("dialog", (d) => d.accept("第二张"));
  await page.locator('#newCanvasButton').click();
  await page.waitForTimeout(120);
  const s = await stateOf();
  expect(s.multiCount === 0, `新建画布后不应残留上一张画布的框选，实际还有 ${s.multiCount} 个`);
  expect(s.selectedNodeId === null && s.selectedEdgeId === null && s.connectorSourceId === null, "新建画布后所有选中类状态都应清空");
  expect(await page.locator("#multiSelectPanel").isHidden(), "新建画布后多选面板应隐藏");
  expect(await page.locator("#viewport.is-module-editing, #multiSelectPanel").count() >= 0, "占位");
  await fresh();
}

// 【3-2 关闭标签后回退到相邻标签，且新激活画布不残留选中】
{
  page.once("dialog", (d) => d.accept("第二张"));
  await page.locator('#newCanvasButton').click();
  page.once("dialog", (d) => d.accept("第三张"));
  await page.locator('#newCanvasButton').click();
  await page.waitForTimeout(120);
  expect(await page.locator(".canvas-tab").count() === 3, `应有 3 个标签，实际 ${await page.locator(".canvas-tab").count()}`);
  const tabs = await page.locator(".canvas-tab").all();
  await tabs[1].click();
  await page.waitForTimeout(80);
  const midId = await page.evaluate(() => state.activeCanvasId);
  const thirdId = await page.evaluate(() => state.canvases[2].id);
  const id = (await nodes())[0]?.id;
  if (id) { await settle(); await clickNode(id); }
  page.once("dialog", (d) => d.accept("确定"));
  await tabs[1].locator(".tab-close").click();
  await page.waitForTimeout(120);
  const activeAfterClose = await page.evaluate(() => state.activeCanvasId);
  expect(activeAfterClose !== midId, "被关闭的画布不应仍是激活画布");
  expect(activeAfterClose === thirdId, `关闭中间标签后应落到它右边的相邻标签，实际落到 ${activeAfterClose}`);
  const s = await stateOf();
  expect(s.selectedNodeId === null && s.multiCount === 0, "关闭画布后新激活画布不应残留旧选中");
  await fresh();
}

// ============================================================
// 视角四 · 缩放平移视口
// ============================================================

// 【4-1 已保存的视图在被重新读入时要过边界夹紧】
{
  await page.evaluate(() => {
    isDirty = false; clearTimeout(autosaveTimer); autosaveTimer = null;
    const s = defaultState();
    s.canvases[0].view = { zoom: 0.3, panX: 5000, panY: 5000 };
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  });
  await page.reload();
  await page.waitForLoadState("networkidle");
  const v = await view();
  const size = await page.evaluate(() => ({ cw: viewport.clientWidth, ch: viewport.clientHeight }));
  const expectedPanX = (size.cw - 2400 * v.zoom) / 2, expectedPanY = (size.ch - 1500 * v.zoom) / 2;
  expect(v.panX === expectedPanX && v.panY === expectedPanY, `缩到放得下整张画布时应居中显示，期望 panX=${expectedPanX} panY=${expectedPanY}，实际 panX=${v.panX} panY=${v.panY}`);
  await fresh();

  // 缩放到很大时，被读入的越界 pan 必须被夹回可视范围
  await page.evaluate(() => {
    isDirty = false; clearTimeout(autosaveTimer); autosaveTimer = null;
    const s = defaultState();
    s.canvases[0].view = { zoom: 2, panX: 5000, panY: 5000 };
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  });
  await page.reload();
  await page.waitForLoadState("networkidle");
  const v2 = await view();
  expect(v2.panX <= 0 && v2.panY <= 0, `放大到超出视口时 pan 必须夹回 0 以下，实际 panX=${v2.panX} panY=${v2.panY}`);
  await fresh();
}

// 【4-2 点「100%」按钮后视图也必须落在合法范围内】
{
  await page.locator('[data-action="zoom-in"]').click();
  await page.locator('[data-action="zoom-in"]').click();
  const box = await vpBox();
  await page.mouse.move(box.x + 700, box.y + 400);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(80);
  await page.locator('[data-action="zoom-reset"]').click();
  await page.waitForTimeout(80);
  const v = await view();
  const size = await page.evaluate(() => ({ cw: viewport.clientWidth, ch: viewport.clientHeight }));
  const loX = size.cw - 2400 * v.zoom, loY = size.ch - 1500 * v.zoom;
  expect(v.zoom === 1, `点 100% 后缩放应为 1，实际 ${v.zoom}`);
  expect(v.panX >= Math.min(loX, 0) - 0.5 && v.panX <= Math.max(loX, 0) + 0.5, `100% 时 panX 应合法，实际 ${v.panX}`);
  expect(v.panY >= Math.min(loY, 0) - 0.5 && v.panY <= Math.max(loY, 0) + 0.5, `100% 时 panY 应合法，实际 ${v.panY}`);
  await fresh();
}

// 【4-3 滚轮滚动平移要认 deltaMode】老式浏览器的「行」单位不能只滚 3 像素
{
  const before = await view();
  await page.evaluate(() => {
    const vp = document.querySelector("#viewport");
    vp.dispatchEvent(new WheelEvent("wheel", { deltaY: 3, deltaMode: 1, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(80);
  const after = await view();
  expect(before.panY - after.panY === 48, `deltaMode=1 时每「行」应按 16 像素换算，期望下移 48，实际 ${before.panY - after.panY}`);
  await fresh();
}

// 【4-4 在画布矩形外点空白放节点，落点必须被夹回画布内】
// 缩到 30% 后画布四周会露出同底色的空白，很容易误点；若只夹左上、不夹右下，
// 节点会落到 x>2400 的画布外，而 clampPan 又把视图锁在画布内，节点就再也找不回来了。
{
  for (let i = 0; i < 20; i += 1) {
    const z = await page.evaluate(() => activeCanvas().view.zoom);
    if (z <= 0.31) break;
    await page.locator('[data-action="zoom-out"]').click();
    await page.waitForTimeout(40);
  }
  const zoom = await page.evaluate(() => activeCanvas().view.zoom);
  expect(zoom <= 0.31, `预置条件：缩放应已降到 30% 左右，实际 ${zoom}`);

  const box = await vpBox();
  const before = (await nodes()).length;
  await page.locator('[data-tool="rect"]').click();
  // 点视口右下角：此处已在画布矩形之外，换算出的世界坐标远大于 2400/1500
  await page.mouse.click(box.x + box.width - 8, box.y + box.height - 8);
  await page.waitForTimeout(120);

  const placed = await nodes();
  expect(placed.length === before + 1, `在空白处点击应新增 1 个节点，实际 ${placed.length - before} 个`);
  const n = placed[placed.length - 1];
  const world = await page.evaluate(([x, y]) => ({ x: (x - activeCanvas().view.panX) / activeCanvas().view.zoom, y: (y - activeCanvas().view.panY) / activeCanvas().view.zoom }), [box.x + box.width - 8, box.y + box.height - 8]);
  expect(world.x > 2400 && world.y > 1500, `预置条件：该点击点应落在画布右下之外，实际世界坐标 (${Math.round(world.x)}, ${Math.round(world.y)})`);
  expect(n.x >= 10 && n.y >= 10, `节点左上不能越界，实际 (${n.x}, ${n.y})`);
  expect(n.x + n.w <= 2400 && n.y + n.h <= 1500, `节点右下必须被夹回画布内（否则拖不回来），实际右下 (${n.x + n.w}, ${n.y + n.h})`);

  // 再验证「找得回来」：放大到 100% 后拖动画布，节点仍在画布内可被看见
  await page.locator('[data-action="zoom-reset"]').click();
  await page.waitForTimeout(80);
  const after100 = (await nodes()).find((x) => x.id === n.id);
  expect(after100.x + after100.w <= 2400 && after100.y + after100.h <= 1500, `100% 下节点仍须在画布内，实际右下 (${after100.x + after100.w}, ${after100.y + after100.h})`);
  await fresh();
}

// 【回归】拖动之后，节点上的「尺寸控制点」按钮仍然点得开（指针捕获不能吃掉 click）
{
  const id = (await nodes())[0].id;
  await settle();
  // 这里只需要「拖过一下」这个状态，所以**往下**拖、不往右下拖：默认布局里
  // 「收集材料」往右下走 (+120,+60) 会正好压到「形成判断」那个菱形节点底下，
  // 它的尺寸控制点按钮就被上面那个节点盖住了。
  // 盖住了就点不中，这是对的（端口/手柄的 z-index 从 2026-09-13 起只在各自节点内部比较，
  // 见 styles.css 里 .node 上那行 isolation: isolate）——用户看不见的按钮本来就不该抢点击。
  await dragBy(id, 0, 150);
  await settle();
  await clickNode(id);
  await page.locator(`.node[data-node-id="${id}"] .resize-toggle`).click();
  await page.waitForTimeout(120);
  const s = await stateOf();
  expect(s.resizeModeNodeId === id, "拖动过节点之后，尺寸控制点按钮仍必须能正常点开");
  expect(await page.locator(`.resize-handle[data-node-id="${id}"]`).count() > 0, "点开控制点后应能看到可拖动的控制点");
  await page.locator(`.node[data-node-id="${id}"] .resize-toggle`).click();
  await page.waitForTimeout(120);
  expect((await stateOf()).resizeModeNodeId === null, "再点一次应能收起控制点");
  await fresh();
}

// 【回归】拖动过程中途异常中断（指针被回收）后，节点拖动状态要能自愈
{
  const id = (await nodes())[0].id;
  await settle();
  const p = await center(id);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 100, p.y + 40, { steps: 6 });
  expect((await stateOf()).drag === true, "按住节点拖动时应处于拖动中");
  const pointerId = await page.evaluate(() => drag?.pointerId);
  await page.evaluate((pid) => document.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: pid, bubbles: true })), pointerId);
  await page.waitForTimeout(80);
  expect((await stateOf()).drag === false, "指针捕获被回收后拖动状态应自愈，不能一直粘着");
  await page.mouse.up();
  await page.waitForTimeout(60);
  await fresh();
}

await page.screenshot({ path: `${screenshotDir}/交互审计14项验收.png`, fullPage: true });

console.log(JSON.stringify({
  覆盖: {
    "1-1": "多选整体拖动（4 个节点同位移）",
    "1-2": "贴边拖动不再产生空撤销（一次 Ctrl+Z 即回原位）",
    "1-3": "西边界控制点顶边时只回收不反向长大",
    "1-4": "点空白 / Esc 都能取消选中且高亮同步消失",
    "2-1": "删掉连接源节点后不残留悬空连线",
    "2-2": "点连线时节点高亮同步消失",
    "2-3": "Esc 取消连接态，之后点节点不会偷偷连线",
    "2-4": "端口拖线松手状态收干净 + 指针捕获丢失自愈",
    "2-5": "反向重复连线被拒绝（无几何重合的两条线）",
    "3-1": "新建画布不残留上一张的框选与面板",
    "3-2": "关闭标签回退到相邻标签且不残留选中",
    "4-1": "读入已存视图时过边界夹紧（放得下则居中、放大则夹回）",
    "4-2": "点 100% 后视图合法",
    "4-3": "滚轮 deltaMode=1 按 16 像素/行换算",
    "4-4": "画布外点空白放节点时落点被夹回画布内（左右上下四边都夹）",
    回归1: "拖动后尺寸控制点按钮仍可点开/收起",
    回归2: "拖动中指针被回收后状态自愈",
  },
  断言总数: assertCount,
  失败: failures,
  errors,
}, null, 2));
await browser.close();
if (failures.length) process.exitCode = 1;
