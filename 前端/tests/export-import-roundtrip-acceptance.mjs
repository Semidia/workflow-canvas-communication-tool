import { launchChromium } from "./_runtime.mjs";
// 导出 / 导入 往返验收（真实浏览器 + 真实输入事件）
//
// 验四件事：
//   1. 导出：点「导出」真能落下一个文件，内容与画布上所见一致；
//   2. 往返：把这个文件改一处再导回来，改的那处真的生效（内容能进能出）；
//   3. 模块库不随文件走：文件里到底有没有模块库？（这是要摆到台面上的取舍）
//      ——顺手证明「导入新文件不会清掉本机模块库」这件事的两面性；
//   4. 坏文件不给数据造成损失：乱码 JSON、结构不对的 JSON，都只提示失败，画布原样不动。
//
// 用法：
//   node tests/export-import-roundtrip-acceptance.mjs [http://127.0.0.1:4173] [截图/证据目录]
// 说明：目标是靠 _served-target.mjs「按 app.js 内容认人」解析出来的，不会误跑到别处的副本上。

import fs from "node:fs";
import path from "node:path";
import { resolveCanvasUrl } from "./_served-target.mjs";


const url = await resolveCanvasUrl(process.argv[2]);
const outDir = process.argv[3] || "D:/agent临时/画布导入导出验收-20260913";
fs.mkdirSync(outDir, { recursive: true });

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

const browser = await launchChromium({
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });

// 提示记录器：在页面每次加载「之前」就装好（addInitScript 随每次导航自动重跑，包括本文件里的 reload），
// 把每一次真正弹出的提示原文按顺序记进 window.__toastLog，后面所有「等某条提示」都查这本账。
//
// 为什么不能当场等「#toast 上挂着 is-visible」：app.js 的 showToast 只把 is-visible 挂 1900ms，
// 到点摘掉类名、文字并不清空。而调用方点完按钮之后往往还有别的活要干才轮到等待
// （导出这一段要 saveAs 落盘、读文件、JSON.parse），机器一忙就可能超过这 1900ms，
// 于是出现「文字明明写着「当前画布已导出」，却永远等不到」的假失败。
// 2026-09-14 实测：在开始等待前空转 2500ms 可稳定复现该超时；机器空闲时同一套件 8.4s 跑完、29 条全绿。
// 改成记账再断言，就与机器快慢无关，也不必去猜「等多久才够」。
await page.addInitScript(() => {
  window.__toastLog = [];
  const toastOf = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement;
    return el?.closest?.("#toast") || null;
  };
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const toast = toastOf(mutation.target);
      if (toast && toast.classList.contains("is-visible")) {
        window.__toastLog.push((toast.textContent || "").trim());
      }
    }
  }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
});

const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));

const dialogs = [];
page.on("dialog", async (dialog) => {
  dialogs.push({ type: dialog.type(), message: dialog.message() });
  // 模块命名是 prompt，导入替换确认是 confirm —— 两种都「答应」
  await dialog.accept(dialog.type() === "prompt" ? "往返验收模块为证" : undefined);
});

const toastText = () => page.locator("#toast").textContent();
const nodeLabels = () => page.locator(".node-label").allTextContents();
const nodeCount = () => page.locator(".node").count();
const edgeCount = () => page.locator("#edges .edge").count();
const moduleItemCount = () => page.locator(".module-item").count();
const tabNames = () => page.locator(".canvas-tab").allTextContents();

async function openModuleModal() {
  await page.locator('[data-action="open-modules"]').click();
  await page.locator("#moduleModal").waitFor({ state: "visible" });
}
async function closeModuleModal() {
  await page.locator('[data-action="close-modules"]').click();
  await page.locator("#moduleModal").waitFor({ state: "hidden" });
}
async function shot(name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
}

// 等「这一次操作」的提示真的弹过 —— 查记录器账本上的最后一条，而不是看 #toast 此刻可不可见。
//
// 为什么不能只 waitFor({ state: "visible" })：上一条消息还挂着的时候，提示条本来就是可见的，
// waitFor 立刻返回，读到的还是上一条的文案。2026-09-13 批量跑时就撞上过这种假失败（当时读到
// 的是上一条的提示，而要验的文案根本没出现）。
// 为什么也不能等「此刻可见 + 文案对得上」：showToast 只挂 1900ms 的 is-visible，机器一忙，
// 等待开始得比它消失还晚，就永远等不到（见文件顶部记录器的说明，2026-09-14 已实测复现）。
// 账本口径把这两条一起解决：只认「新弹出来的那一条」，快慢都不影响。
async function waitToastContains(text, timeout = 15000) {
  await page.waitForFunction(
    (expected) => {
      const log = window.__toastLog || [];
      return log.length > 0 && log[log.length - 1].includes(expected);
    },
    text,
    { timeout }
  );
}

// ---------------------------------------------------------------- 0. 干净起步
await page.goto(url);
await page.waitForLoadState("networkidle");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForLoadState("networkidle");

const startNodes = await nodeCount();
const startEdges = await edgeCount();
const startLabels = await nodeLabels();
// 不写死节点个数：默认画布内容以后可能变，这里只要求「有东西可验」
expect(startNodes >= 2, `开局应有至少 2 个节点（否则框选/往返没东西可验），实际 ${startNodes}`);
expect(startEdges > 0, "开局应至少有一条连线（否则导出的连线数据没东西可验）");
note(`开局：${startNodes} 个节点、${startEdges} 条连线、${(await tabNames()).length} 个画布标签页`);

// ------------------------------------------------- 1. 框选全部 → 封装为模块
await page.locator('[data-tool="marquee"]').click();
const viewportBox = await page.locator("#viewport").boundingBox();
// 从左上角拉一个大框，扫过所有节点（框选按「相交」判定，扫到即选中）
await page.mouse.move(viewportBox.x + 4, viewportBox.y + 4);
await page.mouse.down();
await page.mouse.move(viewportBox.x + viewportBox.width - 4, viewportBox.y + viewportBox.height - 4, { steps: 12 });
await page.mouse.up();
await page.locator("#multiSelectPanel").waitFor({ state: "visible" });
const summary = (await page.locator("#multiSelectSummary").textContent()) || "";
note(`框选结果：${summary.trim()}`);
await shot("01_框选全部");

await page.locator('#multiSelectPanel [data-action="save-module"]').click();
await waitToastContains("已保存");
expect((await toastText()).includes("已保存"), `封装模块应有成功提示，实际：「${await toastText()}」`);

await openModuleModal();
const modulesBeforeExport = await moduleItemCount();
expect(modulesBeforeExport === 1, `模块库应有 1 个模块，实际 ${modulesBeforeExport}`);
await shot("02_模块库有一个模块");
await closeModuleModal();
note(`模块库：${modulesBeforeExport} 个模块（名字取自 prompt「往返验收模块为证」）`);

// ------------------------------------------------------------------ 2. 导出
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }),
  page.locator('[data-action="export"]').click(),
]);
const exportPath = path.join(outDir, "导出_原始.json");
await download.saveAs(exportPath);
const exported = JSON.parse(fs.readFileSync(exportPath, "utf8"));
const exportedKeys = Object.keys(exported).sort();
note(`导出文件顶层字段：${JSON.stringify(exportedKeys)}`);
await waitToastContains("已导出");
expect((await toastText()).includes("已导出"), `导出应有成功提示，实际：「${await toastText()}」`);

expect(exportedKeys.includes("canvases"), "导出文件里必须有 canvases");
expect(Array.isArray(exported.canvases) && exported.canvases.length === 1, "本次只开了一个画布，导出文件里应有 1 个画布");
const exportedCanvas = exported.canvases[0];
expect(exportedCanvas.nodes.length === startNodes, `导出节点数应等于屏幕上所见 ${startNodes}，实际 ${exportedCanvas.nodes.length}`);
expect(exportedCanvas.edges.length === startEdges, `导出连线数应等于屏幕上所见 ${startEdges}，实际 ${exportedCanvas.edges.length}`);
const exportedLabels = exportedCanvas.nodes.map((n) => n.label);
expect(JSON.stringify(exportedLabels) === JSON.stringify(startLabels), `导出节点文字应与屏幕上一致：文件 ${JSON.stringify(exportedLabels)} vs 屏幕 ${JSON.stringify(startLabels)}`);

// ★ 取舍点：文件里到底有没有模块库？
const moduleishKeys = exportedKeys.filter((k) => /module|模块/i.test(k));
const moduleishInCanvas = Object.keys(exportedCanvas).filter((k) => /module|模块/i.test(k));
expect(moduleishKeys.length === 0, `导出文件顶层不应出现模块相关字段，实际出现：${JSON.stringify(moduleishKeys)}`);
expect(moduleishInCanvas.length === 0, `导出的画布里不应出现模块相关字段，实际出现：${JSON.stringify(moduleishInCanvas)}`);
note("★ 关键证据：导出文件里**没有**任何模块相关字段（模块库只存本机 localStorage）");

// -------------------------------------------- 3. 往返：改一处再导回来，验证生效
const modified = JSON.parse(JSON.stringify(exported));
modified.canvases[0].name = "往返改过的画布名";
modified.canvases[0].nodes[0].label = "往返改过的标签";
modified.canvases[0].nodes[0].marker = "已确认";
const modifiedPath = path.join(outDir, "往返导入_改过一处.json");
fs.writeFileSync(modifiedPath, JSON.stringify(modified, null, 2), "utf8");

await page.locator("#importInput").setInputFiles(modifiedPath);
await waitToastContains("工作流已导入");
expect((await toastText()).includes("工作流已导入"), `导入应有成功提示，实际：「${await toastText()}」`);
await page.waitForTimeout(200);

const afterLabels = await nodeLabels();
expect(afterLabels.includes("往返改过的标签"), `导入后屏幕上应出现改过的标签，实际：${JSON.stringify(afterLabels)}`);
expect(await nodeCount() === startNodes, `导入后节点数应不变（${startNodes}），实际 ${await nodeCount()}`);
expect(await edgeCount() === startEdges, `导入后连线数应不变（${startEdges}），实际 ${await edgeCount()}`);
expect((await tabNames()).join(" ").includes("往返改过的画布名"), `导入后画布名应变成「往返改过的画布名」，实际：${JSON.stringify(await tabNames())}`);
await shot("03_导入后改过的标签在屏幕上");

// 一面之词的反面：导入新文件**不会**清掉本机模块库
await openModuleModal();
const modulesAfterImport = await moduleItemCount();
expect(modulesAfterImport === 1, `导入文件后本机模块库应仍在（1 个），实际 ${modulesAfterImport}`);
await closeModuleModal();
note("模块库与本机画布数据是两个互不影响的仓库：导入文件不会清掉模块库");

// ------------------------- 4. 「换一台机器」：模块库不随文件走（这是取舍点）
await page.evaluate(() => localStorage.clear()); // 相当于换台电脑：本机什么都没有
await page.reload();
await page.waitForLoadState("networkidle");
await openModuleModal();
const modulesOnFreshMachine = await moduleItemCount();
const emptyHint = (await page.locator("#moduleList").textContent()) || "";
await shot("04_新机器上模块库是空的");
await closeModuleModal();
note(`★ 关键证据：清白环境里模块库为空（${modulesOnFreshMachine} 个），提示语「${emptyHint.trim().slice(0, 24)}…」`);

await page.locator("#importInput").setInputFiles(modifiedPath);
await waitToastContains("工作流已导入");
await page.waitForTimeout(200);
expect(await nodeCount() === startNodes, `清白环境导入后节点数应为 ${startNodes}，实际 ${await nodeCount()}`);
expect((await tabNames()).join(" ").includes("往返改过的画布名"), "清白环境导入后画布名应来自文件");
await openModuleModal();
const modulesAfterImportOnFreshMachine = await moduleItemCount();
await closeModuleModal();
expect(modulesAfterImportOnFreshMachine === 0, `★ 导出文件里不带模块库：清白环境导入后模块库仍应为 0，实际 ${modulesAfterImportOnFreshMachine}`);
note("★ 结论：画布数据能随文件走，模块库**不能** —— 换机器/发给别人，模块库到不了对方那里");

// ------------------------------------------------- 5. 坏文件不给数据造成损失
const beforeBadCount = await nodeCount();
const beforeBadLabels = await nodeLabels();

const junkPath = path.join(outDir, "坏文件_乱码.json");
fs.writeFileSync(junkPath, '{"version": 1, "canvases": [ {"id": "x"', "utf8");
await page.locator("#importInput").setInputFiles(junkPath);
await waitToastContains("导入失败");
expect((await toastText()).includes("导入失败"), `乱码文件应提示导入失败，实际：「${await toastText()}」`);
await shot("05_乱码文件被拒");
expect(await nodeCount() === beforeBadCount, "乱码文件被拒后画布节点数不应变化");
expect(JSON.stringify(await nodeLabels()) === JSON.stringify(beforeBadLabels), "乱码文件被拒后画布内容不应变化");

const shapePath = path.join(outDir, "坏文件_结构不对.json");
fs.writeFileSync(shapePath, '{"版本": 2, "说明": "这压根不是工作流文件"}', "utf8");
await page.locator("#importInput").setInputFiles(shapePath);
await waitToastContains("导入失败");
expect((await toastText()).includes("导入失败"), `结构不对的文件应提示导入失败，实际：「${await toastText()}」`);
expect(await nodeCount() === beforeBadCount, "结构不对的文件被拒后画布节点数不应变化");

const emptyCanvasPath = path.join(outDir, "坏文件_空画布列表.json");
fs.writeFileSync(emptyCanvasPath, '{"version": 1, "canvases": []}', "utf8");
await page.locator("#importInput").setInputFiles(emptyCanvasPath);
await waitToastContains("导入失败");
expect((await toastText()).includes("导入失败"), `空 canvases 应提示导入失败，实际：「${await toastText()}」`);
expect(await nodeCount() === beforeBadCount, "空 canvases 被拒后画布节点数不应变化");
note("三种坏文件（截断 JSON / 结构不对 / 空画布列表）都被拒，画布内容一处没动");

// ------------------------------------------------------------------ 6. 收尾
expect(errors.length === 0, `页面不应报错，实际：${JSON.stringify(errors)}`);
await page.screenshot({ path: path.join(outDir, "06_收尾.png") });

const result = {
  目标地址: url,
  断言条数: assertCount,
  开局: { 节点: startNodes, 连线: startEdges },
  导出文件顶层字段: exportedKeys,
  导出文件里的模块相关字段: moduleishKeys,
  导出画布里的模块相关字段: moduleishInCanvas,
  模块库: {
    导出前: modulesBeforeExport,
    "导入文件后（同机）": modulesAfterImport,
    "清白环境（相当于换台机器）": modulesOnFreshMachine,
    "清白环境导入文件后": modulesAfterImportOnFreshMachine
  },
  坏文件三种都被拒且画布未变: true,
  页面报错: errors,
  弹窗记录: dialogs,
  记录: notes
};
fs.writeFileSync(path.join(outDir, "导出导入往返_验收结果.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));

await browser.close();
console.log(`\n导出导入往返验收通过：共 ${assertCount} 条断言全部成立。证据目录：${outDir}`);
