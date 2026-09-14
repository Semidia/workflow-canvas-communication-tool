// 验收脚本：验证循环回边「人工核实→判断：有无库存」修复后不再穿过判断菱形本体。
// 方法（纯几何，不依赖 elementFromPoint 的 DOM 命中边界）：
//   1. seed 一个最小场景：人工核实(rect) + 判断：有无库存(diamond) + 一条 loop 回边，坐标与电商场景一致；
//   2. 沿 loop 边整条 path（C + L 两段）等距采样；
//   3. 用菱形方程 |x-cx|/halfW + |y-cy|/halfH <= 1 判断每个采样点是否落进菱形内部；
//   4. 统计落进菱形的采样点数量与 t 区间（用于区分「端点接触」与「真正穿节点」）。
// 只读验证，不改任何状态。
import { launchChromium } from "./_runtime.mjs";
import { resolveCanvasUrl } from "./_served-target.mjs";

const url = await resolveCanvasUrl(process.argv[2] || "http://127.0.0.1:4173/index.html");
const STORAGE_KEY = "workflow-canvas-communication-draft-v1";

// 与电商场景一致的几何：人工核实 rect(52,574,176x92)，判断 diamond(84,364,112x112)
const seed = {
  version: 1,
  activeCanvasId: "canvas-main",
  canvases: [{
    id: "canvas-main", name: "循环回边几何验证", category: "",
    nodes: [
      { id: "n-from", type: "rect", x: 52, y: 574, w: 176, h: 92, label: "人工核实", note: "", marker: "待讨论", condition: "", exitCondition: "" },
      { id: "n-to", type: "diamond", x: 84, y: 364, w: 112, h: 112, label: "判断：有无库存", note: "", marker: "待讨论", condition: "库存是否充足？", exitCondition: "" },
    ],
    edges: [
      { id: "e-loop", from: "n-from", to: "n-to", label: "", branch: "", fromSide: "", toSide: "", loop: true, width: "medium", color: "" },
    ],
    view: { zoom: 1, panX: 0, panY: 0 },
  }],
};

const browser = await launchChromium({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }, seed);
  await page.reload();
  await page.waitForLoadState("networkidle");

  const result = await page.evaluate((k) => {
    const s = JSON.parse(localStorage.getItem(k));
    const c = s?.canvases?.[0];
    if (!c) return { error: "无画布数据" };
    const loopEdge = c.edges.find((e) => e.loop);
    if (!loopEdge) return { error: "无 loop 边" };
    const from = c.nodes.find((n) => n.id === loopEdge.from);
    const to = c.nodes.find((n) => n.id === loopEdge.to);
    const pathEl = document.querySelector(`.edge[data-edge-id="${loopEdge.id}"]`);
    const hitEl = document.querySelector(`.edge-hit[data-edge-id="${loopEdge.id}"]`);
    if (!hitEl || !to) return { error: "缺元素" };
    const len = hitEl.getTotalLength();
    // 判断菱形：中心 + 半宽/半高（diamond 是正菱形，w=h，这里用一般式以防万一）
    const cx = to.x + to.w / 2, cy = to.y + to.h / 2, halfW = to.w / 2, halfH = to.h / 2;
    const N = 400;
    let insideCount = 0;
    let tFirst = null, tLast = null;
    const insideTs = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const pt = hitEl.getPointAtLength(len * t);
      // 菱形内部判定：|x-cx|/halfW + |y-cy|/halfH <= 1（含边界）
      const inside = Math.abs(pt.x - cx) / halfW + Math.abs(pt.y - cy) / halfH <= 1;
      if (inside) {
        insideCount++;
        if (tFirst === null) tFirst = t;
        tLast = t;
        if (insideTs.length < 40) insideTs.push(t.toFixed(3));
      }
    }
    return {
      fromLabel: from?.label, toLabel: to?.label,
      fromBox: { x: from?.x, y: from?.y, w: from?.w, h: from?.h },
      toBox: { x: to?.x, y: to?.y, w: to?.w, h: to?.h },
      diamond: { cx, cy, halfW, halfH },
      d: pathEl?.getAttribute("d"),
      pathLength: Math.round(len * 10) / 10,
      totalSamples: N + 1,
      insideCount,
      insideTFirst: tFirst, insideTLast: tLast,
      insideTsSample: insideTs,
      pass: insideCount === 0,
    };
  }, STORAGE_KEY);

  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
