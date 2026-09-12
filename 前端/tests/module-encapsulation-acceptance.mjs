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
page.on("pageerror", (error) => errors.push(String(error)));

// 记一下到底验了多少条：统一入口 run-all-acceptance.mjs 要靠这个数字报「通过=N」，
// 只报场景文字的话它数不出条数，只能显示 ?（不是通过的意思）。
let assertCount = 0;
const expect = (condition, message) => {
  assertCount += 1;
  if (!condition) throw new Error(message);
};

const fresh = async () => {
  await page.evaluate(() => { isDirty = false; clearTimeout(autosaveTimer); autosaveTimer = null; localStorage.clear(); });
  await page.reload();
  await page.waitForLoadState("networkidle");
};

const moduleLibrarySnapshot = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("workflow-canvas-module-library-v1") || "[]"));

// ===== 场景 1：核心封装、展示、放置、边界 =====
await page.goto(url);
await page.waitForLoadState("networkidle");
await fresh();

expect(await page.locator(".node").count() === 4, `场景1 初始应有 4 个节点，实际 ${await page.locator(".node").count()}`);
expect(await page.locator(".edge").count() === 3, `场景1 初始应有 3 条连线，实际 ${await page.locator(".edge").count()}`);

// 1. 用框选工具框选 node-source + node-analysis
await page.locator('[data-tool="marquee"]').click();
const vp = await page.locator("#viewport").boundingBox();
expect(Boolean(vp), "viewport 应可见");
await page.mouse.move(vp.x + 40, vp.y + 280);
await page.mouse.down();
await page.mouse.move(vp.x + 400, vp.y + 400);
await page.mouse.up();

// 2. 验证框选结果面板
expect(await page.locator("#multiSelectPanel").isVisible(), "框选后应显示多选面板");
expect(await page.locator("#inspectorCount").textContent() === "2 个节点", `框选应选中 2 个节点，实际 ${await page.locator("#inspectorCount").textContent()}`);
expect((await page.locator("#multiSelectSummary").textContent()).includes("2 个节点、1 条内部连线"), "摘要应显示 2 节点 1 内部连线");

// 3. 封装为模块
page.once("dialog", (dialog) => dialog.accept("测试模块"));
await page.locator('#multiSelectPanel [data-action="save-module"]').click();
let lib = await moduleLibrarySnapshot();
expect(lib.length === 1, `封装后模块库应有 1 条，实际 ${lib.length}`);
expect(lib[0].name === "测试模块", `模块名应为 测试模块，实际 ${lib[0].name}`);
expect(lib[0].nodes.length === 2 && lib[0].edges.length === 1, "模块应含 2 节点 1 连线");

// 4. 打开模块库验证列表
await page.locator('[data-action="open-modules"]').click();
expect(await page.locator("#moduleModal").isVisible(), "模块库弹窗应打开");
expect(await page.locator(".module-item").count() === 1, "模块库应显示 1 项");
expect(await page.locator(".module-item-name").textContent() === "测试模块", "列表项名称正确");
const metaText = await page.locator(".module-item-meta").textContent();
expect(metaText.includes("2 个节点 · 1 条连线") && metaText.includes("保存于"), `列表项 meta 应含节点连线数与保存时间，实际 ${metaText}`);

// 5. 放置模块
const before1 = { nodes: await page.locator(".node").count(), edges: await page.locator(".edge").count() };
await page.locator('[data-module-action="place"]').click();
expect(await page.locator("#moduleModal").isHidden(), "放置后弹窗应关闭");
expect(await page.locator(".node").count() === before1.nodes + 2, "放置应新增 2 个节点");
expect(await page.locator(".edge").count() === before1.edges + 1, "放置应新增 1 条连线");

// 6. 再次放置，验证 id 不冲突
await page.locator('[data-action="open-modules"]').click();
await page.locator('[data-module-action="place"]').click();
expect(await page.locator(".node").count() === before1.nodes + 4, "二次放置应再新增 2 个节点");
const nodeIds = await page.locator(".node").evaluateAll((els) => els.map((el) => el.dataset.nodeId));
expect(new Set(nodeIds).size === nodeIds.length, "节点 id 不应重复");
const edgeIds = await page.locator(".edge").evaluateAll((els) => els.map((el) => el.dataset.edgeId));
expect(new Set(edgeIds).size === edgeIds.length, "连线 id 不应重复");

// 7. 改名
await page.locator('[data-action="open-modules"]').click();
page.once("dialog", (dialog) => dialog.accept("改名模块"));
await page.locator('[data-module-action="rename"]').click();
expect(await page.locator(".module-item-name").textContent() === "改名模块", "改名后名称应更新");
expect((await moduleLibrarySnapshot())[0].name === "改名模块", "改名应持久化到本地存储");

// 8. 删除（取消）
page.once("dialog", (dialog) => dialog.dismiss());
await page.locator('[data-module-action="delete"]').click();
expect(await page.locator(".module-item").count() === 1, "取消删除后模块应仍在");

// 9. 删除（确认）
page.once("dialog", (dialog) => dialog.accept());
await page.locator('[data-module-action="delete"]').click();
expect(await page.locator(".module-item").count() === 0, "确认删除后模块应移除");
expect(await page.locator(".module-empty").count() === 1, "删除后应显示空状态");
expect((await moduleLibrarySnapshot()).length === 0, "删除应持久化（本地存储为空）");

// ===== 场景 2：同名并存 + 持久化 =====
await fresh();
expect(await page.locator(".node").count() === 4, `场景2 初始应有 4 个节点，实际 ${await page.locator(".node").count()}`);

await page.locator('[data-tool="marquee"]').click();
const vp2 = await page.locator("#viewport").boundingBox();
await page.mouse.move(vp2.x + 40, vp2.y + 280);
await page.mouse.down();
await page.mouse.move(vp2.x + 400, vp2.y + 400);
await page.mouse.up();

page.once("dialog", (dialog) => dialog.accept("测试模块"));
await page.locator('#multiSelectPanel [data-action="save-module"]').click();
page.once("dialog", (dialog) => dialog.accept("测试模块"));
await page.locator('#multiSelectPanel [data-action="save-module"]').click();

let lib2 = await moduleLibrarySnapshot();
expect(lib2.length === 2, `两个同名模块应并存，实际 ${lib2.length}`);
expect(lib2[0].name === "测试模块" && lib2[1].name === "测试模块", "两个模块都应叫 测试模块");
expect(lib2[0].id !== lib2[1].id, "同名模块 id 应不同（不覆盖）");

// 持久化：reload 后仍在
await page.reload();
await page.waitForLoadState("networkidle");
lib2 = await moduleLibrarySnapshot();
expect(lib2.length === 2, `reload 后模块库应保留 2 条，实际 ${lib2.length}`);

// 放置其中一个模块验证可复用
await page.locator('[data-action="open-modules"]').click();
expect(await page.locator(".module-item").count() === 2, "reload 后模块库列表应有 2 项");
const nodesBeforePlace2 = await page.locator(".node").count();
await page.locator(".module-item").first().locator('[data-module-action="place"]').click();
expect(await page.locator(".node").count() === nodesBeforePlace2 + 2, "reload 后放置应新增 2 个节点");

await page.screenshot({ path: `${screenshotDir}/模块封装验收.png`, fullPage: true });

console.log(JSON.stringify({
  scenario1: "封装 / 展示 / 放置 / id 不冲突 / 改名 / 删除取消 / 删除确认 全部通过",
  scenario2: "同名并存 / 持久化 / 复用放置 全部通过",
  断言总数: assertCount,
  errors,
}, null, 2));
await browser.close();
