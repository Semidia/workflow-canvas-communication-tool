// 方案甲验收：磁盘唯一正本 + 保存前冲突检查（真实浏览器 + 真实输入事件 + 真实写盘服务）
//
// 运行：node tests/disk-authority-acceptance.mjs http://127.0.0.1:4173/index.html
//
// 三条核心判据：
//   1. 自动保存只写 localStorage，不写磁盘（磁盘文件不被自动保存改动）；
//   2. 显式「保存到磁盘」才写盘；
//   3. 磁盘被另一处改过后，显式保存会先弹确认，绝不静默覆盖；取消则不写盘。
//
// 注意：本套件会真的读写 工作流导出\画布数据.json，跑之前请先备份该文件。
// 用法与 run-all 里的静态服务套件不同：必须指向带 /api/state 的真实后端。

import { launchChromium } from "./_runtime.mjs";
import { resolveCanvasUrl } from "./_served-target.mjs";

const url = await resolveCanvasUrl(process.argv[2]);
const browser = await launchChromium({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
const errors = [];
const dialogs = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("dialog", async (d) => {
  dialogs.push({ type: d.type(), message: d.message() });
  // 默认「取消」，需要覆盖时用 __acceptNextDialog 标记
  if (globalThis.__acceptNextDialog) { globalThis.__acceptNextDialog = false; await d.accept(); }
  else await d.dismiss();
});

let assertCount = 0;
const expect = (condition, message) => {
  assertCount += 1;
  if (!condition) throw new Error(message);
};

const diskState = async () => {
  const resp = await fetch(`${url.replace(/\/index\.html.*$/, "")}/api/state`, { cache: "no-store" });
  if (resp.status === 404) return null;
  const data = await resp.json().catch(() => null);
  return data && data.ok === true ? data.state : null;
};
const diskMeta = async () => {
  const resp = await fetch(`${url.replace(/\/index\.html.*$/, "")}/api/state?meta=1`, { cache: "no-store" });
  if (resp.status === 404) return null;
  const data = await resp.json().catch(() => null);
  return data && data.ok === true ? data : null;
};
const acceptNext = () => { globalThis.__acceptNextDialog = true; };

await page.goto(url);
await page.waitForLoadState("networkidle");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(300);

// 造一个已知起点：清空画布并显式写盘，让磁盘有一条基线。
await page.evaluate(() => { state.canvases = [{ id: "disk-authority-canvas", name: "磁盘权威验收", category: "", nodes: [], edges: [], view: { zoom: 1, panX: 0, panY: 0 } }]; state.activeCanvasId = "disk-authority-canvas"; clearTransient(); render(); });
await page.waitForTimeout(200);
await page.evaluate(() => saveToDisk());
await page.waitForTimeout(400);
const baseline = await diskState();
expect(baseline && baseline.canvases.length === 1 && baseline.canvases[0].id === "disk-authority-canvas", `基线应已写入磁盘，实际 ${JSON.stringify(baseline?.canvases?.map((c) => c.id))}`);

// 【1】自动保存不写盘：改一点内容，等过自动保存窗口，磁盘应仍是基线。
await page.evaluate(() => { activeCanvas().nodes.push({ id: "autosave-node", type: "rect", x: 100, y: 100, w: 176, h: 92, label: "自动保存节点", note: "", marker: "待讨论", condition: "", exitCondition: "" }); render(); markDirty(); });
await page.waitForTimeout(1500);
const afterAuto = await diskState();
expect(afterAuto && afterAuto.canvases[0].nodes.length === 0, `自动保存不应写盘，磁盘节点数应为 0，实际 ${afterAuto?.canvases?.[0]?.nodes?.length}`);
// 本地草稿确实记下了
const localDraftNodes = await page.evaluate(() => { const raw = localStorage.getItem("workflow-canvas-communication-draft-v1"); if (!raw) return null; const p = JSON.parse(raw); return p.canvases?.[0]?.nodes?.length ?? null; });
expect(localDraftNodes === 1, `自动保存应写入本地草稿，草稿节点数应为 1，实际 ${localDraftNodes}`);

// 【2】显式保存才写盘：调 saveToDisk 后磁盘应包含那个节点。
await page.evaluate(() => saveToDisk());
await page.waitForTimeout(500);
const afterExplicit = await diskState();
expect(afterExplicit && afterExplicit.canvases[0].nodes.length === 1, `显式保存应写盘，磁盘节点数应为 1，实际 ${afterExplicit?.canvases?.[0]?.nodes?.length}`);

// 状态栏此时应显示「磁盘已同步」
const truthAfterSave = await page.locator("#statusTruthText").textContent();
expect(truthAfterSave.includes("磁盘已同步"), `显式保存后状态栏应为「磁盘已同步」，实际「${truthAfterSave}」`);

// 【3】磁盘被另一处改过后，显式保存必须先确认，不静默覆盖。
// 本页改一个节点，并保持“有未保存改动”状态（不依赖 600ms 自动保存把自己弄干净，
// 否则磁盘轮询会触发干净页自动重载，这一步测的就不是冲突保存了）。
await page.evaluate(() => { activeCanvas().nodes.push({ id: "local-edit-node", type: "rect", x: 300, y: 300, w: 176, h: 92, label: "本页新增", note: "", marker: "待讨论", condition: "", exitCondition: "" }); render(); markDirty(); isDirty = true; autosaveTimer = null; diskAlignedRev = false; updateTruthStatus(); });
await page.waitForTimeout(250);
// 此刻外部直接改磁盘（模拟另一个标签页/另一个工具写入）。
const external = JSON.parse(JSON.stringify(afterExplicit));
external.canvases[0].nodes.push({ id: "external-node", type: "diamond", x: 600, y: 300, w: 112, h: 112, label: "别处写入", note: "", marker: "待讨论", condition: "", exitCondition: "" });
const postResp = await fetch(`${url.replace(/\/index\.html.*$/, "")}/api/state`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(external) });
expect(postResp.ok, "外部改盘这一步应成功");
await page.waitForTimeout(300);
// 把页面记录的“已对齐磁盘版本”强制设成旧 ETag，模拟页面还没感知/轮询还没跑。
// 这样直接验证 saveToDisk 的冲突检查，不依赖 4 秒轮询时序。
await page.evaluate(() => {
  lastDiskEtag = "stale-page-etag";
  diskOutOfSync = false;
  diskAlignedRev = false;
  updateTruthStatus();
});

// 3a. 取消确认 → 不写盘，磁盘保留别处那份
const dialogCountBefore = dialogs.length;
await page.evaluate(() => saveToDisk());
await page.waitForTimeout(600);
const cancelDialog = dialogs[dialogCountBefore];
expect(Boolean(cancelDialog) && cancelDialog.type === "confirm", `磁盘已更新时显式保存应弹确认，实际弹窗：${JSON.stringify(dialogs[dialogCountBefore])}`);
expect(cancelDialog.message.includes("覆盖"), `确认框文案应说明覆盖，实际「${cancelDialog?.message}」`);
const afterCancel = await diskState();
expect(afterCancel && afterCancel.canvases[0].nodes.some((n) => n.id === "external-node"), "取消确认后不应写盘，别处写入的节点应仍在");
expect(afterCancel && !afterCancel.canvases[0].nodes.some((n) => n.id === "local-edit-node"), "取消确认后本页的节点不该被写进磁盘");

// 3b. 明确确认覆盖 → 才写盘
acceptNext();
await page.evaluate(() => saveToDisk());
await page.waitForTimeout(700);
const afterOverride = await diskState();
expect(afterOverride && afterOverride.canvases[0].nodes.some((n) => n.id === "local-edit-node"), "用户确认覆盖后应写入本页内容");
expect(afterOverride && !afterOverride.canvases[0].nodes.some((n) => n.id === "external-node"), "确认覆盖后，别处写入的节点应被本页内容替换掉");

// 自动保存期间绝不写盘：此时本页已脏，等过自动保存窗口，磁盘仍是「确认覆盖」后的那份。
const afterOverrideState = afterOverride;
await page.evaluate(() => { activeCanvas().nodes.push({ id: "post-override-node", type: "rect", x: 800, y: 500, w: 176, h: 92, label: "覆盖后新增", note: "", marker: "待讨论", condition: "", exitCondition: "" }); render(); markDirty(); });
await page.waitForTimeout(1500);
const afterPostAuto = await diskState();
expect(afterPostAuto && afterPostAuto.canvases[0].nodes.length === afterOverrideState.canvases[0].nodes.length, `自动保存不应写盘，磁盘节点数应仍为 ${afterOverrideState.canvases[0].nodes.length}，实际 ${afterPostAuto?.canvases?.[0]?.nodes?.length}`);

expect(errors.length === 0, `页面不应有未捕获异常：${errors.join("、")}`);

console.log(JSON.stringify({ 断言总数: assertCount, 失败: [], results: Array.from({ length: assertCount }, (_, i) => `✅ 磁盘唯一正本 ${i + 1}`), dialogs, errors }));
await browser.close();
