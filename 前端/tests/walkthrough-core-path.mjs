import { launchChromium } from "./_runtime.mjs";
// 真实浏览器 + 真实输入事件的人工走查（核心成功路径 + 恢复路径）
//
// 覆盖节点 11 ②要求的八件事：
//   建节点、连线、框选、封装成模块、放置模块、就地编辑、导出再导入、刷新看草稿是否还在。
//
// 与自动断言套件（*-acceptance.mjs）不同，本脚本是「按用户会怎么点」一步步走完整条主链，
// 每步用真实点击 / 拖拽 / 文件选择驱动，不做 DOM / Store 直改。断言看「用户可见的结果」——
// 画布上的 .node 个数、.edge-hit 条数、多选面板 / 模块编辑栏显隐，而不是 localStorage 草稿
// （草稿要等 750ms 自动保存落盘，不能拿它当即时结果）。
//
// 用法：
//   node tests/walkthrough-core-path.mjs [http://127.0.0.1:4192] [证据目录]
// 说明：目标地址靠 _served-target.mjs「按 app.js 内容认人」解析，不会误跑到别处副本。

import { resolveCanvasUrl } from "./_served-target.mjs";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const url = await resolveCanvasUrl(process.argv[2]);
const outDir = process.argv[3] || "D:/agent临时/画布拆分走查-20260913";
try { mkdirSync(outDir, { recursive: true }); } catch {}

const KEY = "workflow-canvas-communication-draft-v1";
const MODULE_KEY = "workflow-canvas-module-library-v1";

let step = 0;
let asserts = 0;
const expect = (cond, msg) => { asserts++; if (!cond) throw new Error(`断言失败（第 ${step} 步）：${msg}`); };
const log = (m) => console.log(`[走查] ${m}`);

const browser = await launchChromium({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
// 弹窗统一应答：prompt 起模块名「走查模块」，其余 confirm 一律接受。
page.on("dialog", async (d) => {
  if (d.type() === "prompt") await d.accept("走查模块");
  else await d.accept();
});

const nodeCount = () => page.locator(".node").count();
const edgeCount = () => page.locator(".edge-hit").count();
const moduleCount = () => page.evaluate((k) => {
  const arr = JSON.parse(localStorage.getItem(k) || "[]");
  return Array.isArray(arr) ? arr.length : 0;
}, MODULE_KEY);
const snap = async (name) => {
  await page.screenshot({ path: join(outDir, `${String(step).padStart(2, "0")}-${name}.png`) });
};

try {
  // 0. 种一个「空画布」种子（清掉旧草稿与模块库），得到 0 节点的干净画布
  //    说明：defaultState 自带 4 个示例节点，直接清 localStorage 会回到示例画布而非空；
  //    这里种一个 0 节点的画布作为走查起点（准备初始数据，不是冒充用户操作）。
  const emptySeed = { version: 1, activeCanvasId: "canvas-main", canvases: [{ id: "canvas-main", name: "走查画布", category: "", nodes: [], edges: [], view: { zoom: 1, panX: 0, panY: 0 } }] };
  await page.goto(url);
  await page.evaluate(({ k, mk, s }) => { localStorage.clear(); localStorage.removeItem(mk); localStorage.setItem(k, JSON.stringify(s)); }, { k: KEY, mk: MODULE_KEY, s: emptySeed });
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect((await nodeCount()) === 0, "初始画布应为空");
  log("0 空画布就绪");

  const vp = await page.locator("#viewport").boundingBox();
  const px = (rx) => vp.x + vp.width * rx;
  const py = (ry) => vp.y + vp.height * ry;

  // 1. 建节点 A：点「步骤」工具，点画布空白
  step = 1;
  await page.click('[data-tool="rect"]');
  await page.mouse.click(px(0.30), py(0.35));
  await page.waitForTimeout(200);
  expect((await nodeCount()) === 1, `建节点 A 后应有 1 个节点（实际 ${await nodeCount()}）`);
  await snap("建节点A");
  log("1 建节点 A ✓（1 个节点）");

  // 2. 建节点 B
  step = 2;
  await page.mouse.click(px(0.55), py(0.55));
  await page.waitForTimeout(200);
  expect((await nodeCount()) === 2, `建节点 B 后应有 2 个节点（实际 ${await nodeCount()}）`);
  await snap("建节点B");
  log("2 建节点 B ✓（2 个节点）");

  // 3. 连线 A→B：点「连线」工具，点 A 再点 B
  step = 3;
  await page.click('[data-tool="connector"]');
  const boxA = await page.locator(".node").nth(0).boundingBox();
  const boxB = await page.locator(".node").nth(1).boundingBox();
  await page.mouse.click(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
  await page.mouse.click(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2);
  await page.waitForTimeout(200);
  expect((await edgeCount()) === 1, `连线后应有 1 条边（实际 ${await edgeCount()}）`);
  await snap("连线");
  log("3 连线 A→B ✓（1 条边）");

  // 4. 框选两个节点：点「框选」工具，从左上拖到右下罩住 A、B
  step = 4;
  await page.click('[data-tool="marquee"]');
  await page.mouse.move(px(0.15), py(0.15));
  await page.mouse.down();
  await page.mouse.move(px(0.75), py(0.75), { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const panelVisible = await page.locator("#multiSelectPanel").isVisible();
  expect(panelVisible, "框选后多选面板应显示");
  await snap("框选");
  log("4 框选 ✓（多选面板已出现）");

  // 5. 封装为模块：点框选面板里的「封装为模块」，弹窗起名「走查模块」
  step = 5;
  await page.click('#multiSelectPanel [data-action="save-module"]');
  await page.waitForTimeout(350);
  expect((await moduleCount()) === 1, `封装后模块库应有 1 个模块（实际 ${await moduleCount()}）`);
  await snap("封装为模块");
  log("5 封装为模块 ✓（模块库 1 个）");

  // 6. 放置模块：打开模块库，点「放置」
  step = 6;
  const nodesBeforePlace = await nodeCount();
  await page.click('[data-action="open-modules"]');
  await page.waitForTimeout(250);
  await page.click('.module-item [data-module-action="place"]');
  await page.waitForTimeout(300);
  const nodesAfterPlace = await nodeCount();
  expect(nodesAfterPlace > nodesBeforePlace, `放置模块后节点数应增加（${nodesBeforePlace} → ${nodesAfterPlace}）`);
  await snap("放置模块");
  log(`6 放置模块 ✓（节点数 ${nodesBeforePlace} → ${nodesAfterPlace}）`);

  // 7. 就地编辑：打开模块库，点「编辑」，改完点「保存回模块」
  step = 7;
  await page.click('[data-action="open-modules"]');
  await page.waitForTimeout(250);
  await page.click('.module-item [data-module-action="edit"]');
  await page.waitForTimeout(300);
  expect(await page.locator("#moduleEditBar").isVisible(), "就地编辑后模块编辑栏应显示");
  await snap("就地编辑中");
  await page.click('[data-action="save-module-edit"]');
  await page.waitForTimeout(300);
  expect(await page.locator("#moduleEditBar").isHidden(), "保存回模块后编辑栏应隐藏");
  await snap("保存回模块");
  log("7 就地编辑 ✓（编辑栏出现又收起）");

  // 8. 导出：点「导出」，拿到 JSON 文件
  step = 8;
  const nodesBeforeExport = await nodeCount();
  const dlPromise = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
  await page.click('[data-action="export"]');
  const dl = await dlPromise;
  expect(Boolean(dl), "导出应触发下载");
  const exportedPath = join(outDir, "导出的工作流.json");
  if (dl) await dl.saveAs(exportedPath);
  const exportedJson = JSON.parse(readFileSync(exportedPath, "utf8"));
  expect(Array.isArray(exportedJson?.canvases), "导出文件应是含 canvases 数组的 JSON");
  const exportedNodeCount = exportedJson.canvases.reduce((n, c) => n + (c.nodes?.length ?? 0), 0);
  expect(exportedNodeCount === nodesBeforeExport, `导出文件节点数 ${exportedNodeCount} 应等于画布节点数 ${nodesBeforeExport}`);
  await snap("导出后");
  log(`8 导出 ✓（${exportedNodeCount} 个节点写入 导出的工作流.json）`);

  // 9. 再建 1 个节点，制造「画布与导出文件不一致」的状态
  step = 9;
  await page.click('[data-tool="rect"]');
  await page.mouse.click(px(0.80), py(0.20));
  await page.waitForTimeout(200);
  expect((await nodeCount()) === nodesBeforeExport + 1, `再建 1 节点后应为 ${nodesBeforeExport + 1}（实际 ${await nodeCount()}）`);
  await snap("再建一个节点");
  log(`9 再建 1 节点 ✓（现 ${await nodeCount()} 个）`);

  // 10. 导入：把刚导出的文件喂给「导入」，画布应被整体替换回导出时状态
  step = 10;
  await page.setInputFiles("#importInput", exportedPath);
  await page.waitForTimeout(400);
  expect((await nodeCount()) === nodesBeforeExport, `导入后节点数应回到 ${nodesBeforeExport}（实际 ${await nodeCount()}）`);
  await snap("导入后");
  log(`10 导入 ✓（节点数回到 ${await nodeCount()}）`);

  // 11. 刷新看草稿：保存后重载，节点还在（本机草稿持久化）
  step = 11;
  await page.click('[data-action="save"]');
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(200);
  expect((await nodeCount()) === nodesBeforeExport, `刷新后草稿节点应为 ${nodesBeforeExport}（实际 ${await nodeCount()}）`);
  await snap("刷新后草稿仍在");
  log(`11 刷新看草稿 ✓（${await nodeCount()} 个节点还在）`);

  expect(pageErrors.length === 0, `全程不应有页面 JS 错误：${pageErrors.join(" | ")}`);
  console.log(`\nDONE 走查通过，${asserts} 条断言全绿，无页面 JS 错误。`);
  // 输出一份 JSON 汇总，字段与 *-acceptance.mjs 对齐（断言总数 + pageErrors），
  // 这样 run-all-acceptance.mjs 的统一入口能把它当作一条可纳入的走查来计数，
  // 不会因为「没有 JSON 汇总」而让通过数显示成问号。
  console.log(JSON.stringify({ 套件: "walkthrough-core-path", 断言总数: asserts, pageErrors }));
} finally {
  await browser.close();
}
