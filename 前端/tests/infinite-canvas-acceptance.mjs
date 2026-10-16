import { launchChromium } from "./_runtime.mjs";
import { resolveCanvasUrl } from "./_served-target.mjs";

const url = await resolveCanvasUrl(process.argv[2]);
const browser = await launchChromium({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(url);
await page.waitForLoadState("networkidle");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForLoadState("networkidle");

let assertCount = 0;
const expect = (condition, message) => {
  assertCount += 1;
  if (!condition) throw new Error(message);
};

await page.evaluate(() => {
  state.canvases = [{
    id: "infinite",
    name: "无限画布验收",
    category: "",
    nodes: [
      { id: "a", type: "rect", x: 200, y: 300, w: 176, h: 92, label: "A", note: "", marker: "待讨论", condition: "", exitCondition: "" },
      { id: "b", type: "rect", x: 500, y: 300, w: 176, h: 92, label: "B", note: "", marker: "待讨论", condition: "", exitCondition: "" },
      { id: "c", type: "rect", x: 300, y: 550, w: 176, h: 92, label: "C", note: "", marker: "待讨论", condition: "", exitCondition: "" }
    ],
    edges: [{ id: "e1", from: "a", to: "b", label: "", branch: "", fromSide: "", toSide: "", loop: false, width: "medium", color: "" }],
    view: { zoom: 1, panX: 0, panY: 0 }
  }];
  state.activeCanvasId = "infinite";
  clearTransient();
  render();
});
await page.waitForTimeout(100);

// 1. 节点拖到远超旧 2400/1500 的世界坐标后，位置保留、不被夹回。
const box = await page.locator("#viewport").boundingBox();
const a = await page.locator('.node[data-node-id="a"]').boundingBox();
await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
await page.mouse.down();
await page.mouse.move(a.x + a.width / 2 + 4000, a.y + a.height / 2 + 3000, { steps: 10 });
await page.mouse.up();
const afterMove = await page.evaluate(() => {
  const n = activeCanvas().nodes.find((x) => x.id === "a");
  return { x: n.x, y: n.y };
});
expect(afterMove.x > 2400 && afterMove.y > 1500, `节点应能拖到旧边界之外，实际 (${afterMove.x}, ${afterMove.y})`);

// 2. 画布可以无限平移。
await page.mouse.move(box.x + 500, box.y + 500);
await page.mouse.down();
await page.mouse.move(box.x + 500 - 5000, box.y + 500 - 3000, { steps: 10 });
await page.mouse.up();
const view = await page.evaluate(() => activeCanvas().view);
expect(view.panX === -5000 && view.panY === -3000, `画布应能无限平移，实际 panX=${view.panX} panY=${view.panY}`);

// 回到可点击布局再测重接。
await page.evaluate(() => {
  state.canvases[0].view = { zoom: 1, panX: 0, panY: 0 };
  state.canvases[0].nodes = [
    { id: "a", type: "rect", x: 200, y: 300, w: 176, h: 92, label: "A", note: "", marker: "待讨论", condition: "", exitCondition: "" },
    { id: "b", type: "rect", x: 500, y: 300, w: 176, h: 92, label: "B", note: "", marker: "待讨论", condition: "", exitCondition: "" },
    { id: "c", type: "rect", x: 300, y: 550, w: 176, h: 92, label: "C", note: "", marker: "待讨论", condition: "", exitCondition: "" }
  ];
  clearTransient();
  render();
});
await page.waitForTimeout(100);
await page.evaluate(() => { selectEdgeById("e1"); render(); });
await page.waitForTimeout(100);

// 3. 拖动连线端点时，连线路径实时跟随鼠标。
const handle = await page.locator(".edge-handle-from").boundingBox();
const targetC = await page.locator('.node[data-node-id="c"]').boundingBox();
await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
await page.mouse.down();
await page.mouse.move(targetC.x + targetC.width / 2, targetC.y + targetC.height / 2, { steps: 6 });
const mid = await page.evaluate(() => {
  const path = document.querySelector('.edge[data-edge-id="e1"]');
  return { d: path?.getAttribute("d") || null, point: reattaching?.point || null };
});
const expectedWorld = await page.evaluate(([x, y]) => screenToWorld(x, y), [targetC.x + targetC.width / 2, targetC.y + targetC.height / 2]);
expect(mid.point && Math.abs(mid.point.x - expectedWorld.x) <= 2 && Math.abs(mid.point.y - expectedWorld.y) <= 2, `拖动中端点应跟随鼠标世界坐标，实际 point=${JSON.stringify(mid.point)} 期望=${JSON.stringify(expectedWorld)}`);
expect(mid.d && mid.d.startsWith(`M ${Math.round(mid.point.x)} ${Math.round(mid.point.y)}`), `拖动中连线路径起点应跟随鼠标，实际 d=${mid.d}`);
await page.mouse.up();
await page.waitForTimeout(200);

// 4. 松手吸附到另一个节点，线两端不在同一张卡片。
const edge = await page.evaluate(() => activeCanvas().edges[0]);
expect(edge.from === "c" && edge.to === "b", `松手后连线应吸附到目标节点，实际 ${edge.from} -> ${edge.to}`);

expect(errors.length === 0, `页面不应有未捕获异常：${errors.join("、")}`);

console.log(JSON.stringify({ 断言总数: assertCount, 失败: [], results: Array.from({ length: assertCount }, (_, i) => `✅ 无限画布 ${i + 1}`), errors }));
await browser.close();
