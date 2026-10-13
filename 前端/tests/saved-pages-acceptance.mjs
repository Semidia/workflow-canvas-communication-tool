import { launchChromium } from "./_runtime.mjs";
import { resolveCanvasUrl } from "./_served-target.mjs";

const url = await resolveCanvasUrl(process.argv[2]);
const browser = await launchChromium({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(url);
await page.waitForLoadState("networkidle");

// 与既有套件一致：先清空本地草稿，从默认状态起步，避免上一轮套件留下的状态串扰。
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForLoadState("networkidle");

let assertCount = 0;
const expect = (condition, message) => {
  assertCount += 1;
  if (!condition) throw new Error(message);
};

const button = page.locator('[data-action="open-saved"]');
expect(await button.count() === 1, "顶栏应有「已保存页面」按钮");
expect((await button.textContent()).trim() === "已保存页面", "按钮文案应为“已保存页面”");

await button.click();
await page.waitForTimeout(150);
expect(await page.locator("#savedPagesModal").isVisible(), "点击按钮应打开已保存页面弹层");
expect((await page.locator("#savedPagesModalTitle").textContent()).trim() === "已保存页面", "弹层标题应为“已保存页面”");
expect((await page.locator(".saved-page-item").count()) >= 1, "弹层应至少列出一个已保存画布");

// 独立新增一个画布，验证列表实时更新、点击切换后弹层关闭。
const addedId = await page.evaluate(() => {
  const c = { id: "saved-pages-acceptance-canvas", name: "已保存页面验收画布", category: "", nodes: [], edges: [], view: { zoom: 1, panX: 0, panY: 0 } };
  state.canvases.push(c);
  return c.id;
});
await page.locator('[data-action="reload-saved-pages"]').click();
await page.waitForTimeout(150);
expect(await page.locator(`.saved-page-item[data-canvas-id="${addedId}"]`).count() === 1, "刷新后列表应出现新增画布");
const activeBefore = await page.evaluate(() => state.activeCanvasId);
await page.locator(`.saved-page-item[data-canvas-id="${addedId}"]`).click();
await page.waitForTimeout(100);
const activeAfter = await page.evaluate(() => state.activeCanvasId);
expect(activeAfter === addedId, `点击已保存页面后应切到该画布，实际 ${activeAfter}`);
expect(activeBefore !== activeAfter, "点击不同画布应改变当前画布");
expect(await page.locator("#savedPagesModal").isHidden(), "点击列表项后应关闭弹层");

await page.locator('[data-action="open-saved"]').click();
await page.waitForTimeout(100);
expect(await page.locator("#savedPagesModal").isVisible(), "再次点击应重新打开已保存页面弹层");
await page.keyboard.press("Escape");
await page.waitForTimeout(100);
expect(await page.locator("#savedPagesModal").isHidden(), "按 Escape 应关闭已保存页面弹层");

// 只读静态服务下 /api/state 为 404，入口必须能降级为当前本机列表，不报页面异常。
expect(errors.length === 0, `页面不应有未捕获异常：${errors.join("、")}`);

console.log(JSON.stringify({ 断言总数: assertCount, 失败: [], results: Array.from({ length: assertCount }, (_, i) => `✅ 已保存页面 ${i + 1}`), errors }));
await browser.close();
