// 画布工具 判断三态(是/否/未定) + 循环回边虚线 + 判断条件/退出循环条件 + port 方向记录 专项验收
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire("D:/nodejs/npm-global/package.json");
const { chromium } = require("playwright");
const url = process.argv[2] || "http://127.0.0.1:4173/index.html";
const shotDir = "D:/agent临时/郄的工作流画布沟通工具验收";
const STORAGE_KEY = "workflow-canvas-communication-draft-v1";

const testState = {
  version: 1,
  activeCanvasId: "canvas-main",
  canvases: [{
    id: "canvas-main", name: "验收画布", category: "",
    nodes: [
      { id: "a", type: "rect", x: 100, y: 200, w: 176, h: 92, label: "A步骤", note: "", marker: "待讨论" },
      { id: "b", type: "diamond", x: 420, y: 190, w: 112, h: 112, label: "B判断", note: "", marker: "待讨论" },
      { id: "c", type: "rect", x: 680, y: 200, w: 176, h: 92, label: "C步骤", note: "", marker: "待讨论" },
    ],
    edges: [
      { id: "e1", from: "b", to: "c", label: "" },
    ],
    view: { zoom: 1, panX: 0, panY: 0 },
  }],
};

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass, detail });
const pageErrors = [];
let shot = 0;
const snap = async (page, name) => {
  try { mkdirSync(shotDir, { recursive: true }); } catch {}
  await page.screenshot({ path: `${shotDir}/judge-branch-loop-${++shot}-${name}.png` });
};

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.evaluate((s) => localStorage.setItem("workflow-canvas-communication-draft-v1", JSON.stringify(s)), testState);
  await page.reload();
  await page.waitForLoadState("networkidle");

  const state = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), STORAGE_KEY);
  const node = async (id) => (await state())?.canvases?.[0]?.nodes?.find((n) => n.id === id);
  const edge = async (id) => (await state())?.canvases?.[0]?.edges?.find((e) => e.id === id);

  // 0. 注入状态渲染正确
  const nodeCount = await page.locator(".node").count();
  const edgeCount = await page.locator(".edge").count();
  check("注入状态渲染 3 节点 1 连线", nodeCount === 3 && edgeCount === 1, `nodes=${nodeCount} edges=${edgeCount}`);
  const bIsDiamond = await page.locator('.node[data-node-id="b"]').getAttribute("class");
  check("判断节点渲染为 shape-diamond", /shape-diamond/.test(bIsDiamond || ""), bIsDiamond);
  const pendingCount0 = await page.locator(".edge-branch-pending").count();
  check("未标注的判断连线显示「未标分支」提示", pendingCount0 === 1, `pending=${pendingCount0}`);

  // 1. 判断条件字段只在 diamond 显示
  await page.locator('.node[data-node-id="b"]').click();
  await page.waitForTimeout(80);
  const condVisibleOnDiamond = await page.locator("#conditionGroup").isVisible();
  const exitVisibleOnDiamond = await page.locator("#exitConditionGroup").isVisible();
  check("diamond 显示判断条件字段", condVisibleOnDiamond && exitVisibleOnDiamond, `cond=${condVisibleOnDiamond} exit=${exitVisibleOnDiamond}`);

  await page.locator("#inspectorCondition").fill("材料是否齐全？");
  await page.locator("#inspectorExitCondition").fill("齐全，或已核对 3 轮");
  await page.locator("#inspectorCondition").press("Tab"); // blur 提交
  await page.waitForTimeout(150);
  const bAfter = await node("b");
  check("判断条件保存到数据模型", bAfter?.condition === "材料是否齐全？", `condition="${bAfter?.condition}"`);
  check("退出循环条件保存到数据模型", bAfter?.exitCondition === "齐全，或已核对 3 轮", `exitCondition="${bAfter?.exitCondition}"`);
  await snap(page, "diamond-condition");

  await page.locator('.node[data-node-id="a"]').click();
  await page.waitForTimeout(80);
  const condVisibleOnRect = await page.locator("#conditionGroup").isVisible();
  check("非判断节点隐藏判断条件字段", !condVisibleOnRect, `condVisible=${condVisibleOnRect}`);

  // 2. 分支三态按钮设置 edge.branch（独立于 edge.label）
  const mid = await page.evaluate(() => {
    const p = document.querySelector('.edge[data-edge-id="e1"]');
    const len = p.getTotalLength();
    const pt = p.getPointAtLength(len / 2);
    const m = p.getScreenCTM();
    const s = new DOMPoint(pt.x, pt.y).matrixTransform(m);
    return { x: s.x, y: s.y };
  });
  await page.mouse.click(mid.x, mid.y);
  await page.waitForTimeout(80);
  const branchVisible = await page.locator("#branchGroup").isVisible();
  check("从判断节点出发的连线显示分支按钮", branchVisible, `branchVisible=${branchVisible}`);
  await page.locator('.branch-button[data-branch="是"]').click();
  await page.waitForTimeout(100);
  const e1AfterShi = await edge("e1");
  check("点「是」设置 branch 字段", e1AfterShi?.branch === "是", `branch="${e1AfterShi?.branch}"`);
  check("点「是」不污染连线名称", e1AfterShi?.label === "" , `label="${e1AfterShi?.label}"`);
  const activeShi = await page.locator('.branch-button[data-branch="是"]').getAttribute("class");
  check("「是」按钮呈选中态", /is-active/.test(activeShi || ""), activeShi);
  const pendingAfterShi = await page.locator(".edge-branch-pending").count();
  check("标注分支后提示消失", pendingAfterShi === 0, `pending=${pendingAfterShi}`);
  await page.locator("#inspectorEdgeName").fill("审批通过");
  await page.locator("#inspectorEdgeName").press("Tab");
  await page.waitForTimeout(120);
  const e1AfterName = await edge("e1");
  check("填写连线名称独立保存", e1AfterName?.label === "审批通过", `label="${e1AfterName?.label}"`);
  check("填名称后 branch 保持不变", e1AfterName?.branch === "是", `branch="${e1AfterName?.branch}"`);
  await page.locator('.branch-button[data-branch="未定"]').click();
  await page.waitForTimeout(100);
  const e1AfterWeiding = await edge("e1");
  check("点「未定」切换三态分支", e1AfterWeiding?.branch === "未定", `branch="${e1AfterWeiding?.branch}"`);
  check("切换分支不清空连线名称", e1AfterWeiding?.label === "审批通过", `label="${e1AfterWeiding?.label}"`);
  await snap(page, "branch-tristate");

  // 2b. 重复点击同一分支按钮应幂等：不产生多余历史，undo 一次回到上一分支
  await page.locator('.branch-button[data-branch="是"]').click();
  await page.waitForTimeout(80);
  await page.locator('.branch-button[data-branch="是"]').click();
  await page.waitForTimeout(80);
  check("重复点「是」后 branch 仍为是", (await edge("e1"))?.branch === "是", `branch="${(await edge("e1"))?.branch}"`);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(180);
  check("幂等：undo 一次回到上一分支「未定」", (await edge("e1"))?.branch === "未定", `branch="${(await edge("e1"))?.branch}"`);
  await page.mouse.click(mid.x, mid.y);
  await page.waitForTimeout(80);

  // 3. 循环回边虚线
  await page.locator("#inspectorEdgeLoop").check();
  await page.waitForTimeout(150);
  const loopClass = await page.locator('.edge[data-edge-id="e1"]').getAttribute("class");
  check("勾选循环后边带 is-loop class", /is-loop/.test(loopClass || ""), loopClass);
  check("循环状态保存到数据模型", (await edge("e1"))?.loop === true, `loop=${(await edge("e1"))?.loop}`);
  await snap(page, "loop-dashed");

  // 4. port 方向记录（从 a bottom port 拖到 c top port）
  const aBottom = await page.locator('.node[data-node-id="a"] .port[data-side="bottom"]').boundingBox();
  const cTop = await page.locator('.node[data-node-id="c"] .port[data-side="top"]').boundingBox();
  await page.mouse.move(aBottom.x + aBottom.width / 2, aBottom.y + aBottom.height / 2);
  await page.mouse.down();
  await page.mouse.move(cTop.x + cTop.width / 2, cTop.y + cTop.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const s2 = await state();
  const newEdge = s2?.canvases?.[0]?.edges?.find((e) => e.from === "a" && e.to === "c");
  check("port 拖拽新增连线 a->c", !!newEdge, `edge=${JSON.stringify(newEdge)}`);
  check("记录起点方向 bottom", newEdge?.fromSide === "bottom", `fromSide=${newEdge?.fromSide}`);
  check("记录终点方向 top", newEdge?.toSide === "top", `toSide=${newEdge?.toSide}`);
  await snap(page, "port-direction");

  // 5. 连线图层低于节点图层（不遮挡卡片）
  const zIndex = await page.evaluate(() => ({
    edge: getComputedStyle(document.querySelector("#edgeLayer")).zIndex,
    node: getComputedStyle(document.querySelector("#nodeLayer")).zIndex,
  }));
  check("edge 图层 z-index 低于 node 图层", Number(zIndex.edge) < Number(zIndex.node), JSON.stringify(zIndex));

  console.log(JSON.stringify({
    results,
    pageErrors,
    summary: {
      passed: results.filter((r) => r.pass).length,
      total: results.length,
      failed: results.filter((r) => !r.pass).length,
    },
  }, null, 2));
} finally {
  await browser.close();
}
