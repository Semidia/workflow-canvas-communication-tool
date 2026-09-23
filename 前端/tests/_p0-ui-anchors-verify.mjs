import { launchChromium } from "./_runtime.mjs";

const browser = await launchChromium({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://127.0.0.1:4173/index.html", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".node", { timeout: 10000 });
await page.waitForTimeout(400);

// --- A. brand badge ---
const badge = ((await page.locator(".brand-badge").textContent()) || "").trim();
const badgeVisible = await page.locator(".brand-badge").isVisible();

// --- B. right-click copy canvas ID (after anchors so context menu doesn't interfere) ---
// --- anchors first ---
const geom = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll(".node")];
  const pr = nodes[0].querySelector('.port[data-side="right"]').getBoundingClientRect();
  const pl = nodes[2].querySelector('.port[data-side="left"]').getBoundingClientRect();
  return {
    src: { x: pr.x + pr.width / 2, y: pr.y + pr.height / 2 },
    dst: { x: pl.x + pl.width / 2, y: pl.y + pl.height / 2 },
  };
});
const opacityIdle = await page.evaluate(() => {
  const n = [...document.querySelectorAll(".node")][2];
  return getComputedStyle(n.querySelector('.port[data-side="left"]')).opacity;
});

await page.mouse.move(geom.src.x, geom.src.y);
await page.mouse.down();
await page.waitForTimeout(120);
const mid = await page.evaluate(() => ({
  linking: viewport.classList.contains("is-linking"),
  connecting: !!connecting,
  otherOpacity: getComputedStyle([...document.querySelectorAll(".node")][2].querySelector('.port[data-side="left"]')).opacity,
  allVisible: [...document.querySelectorAll(".port")].every((p) => getComputedStyle(p).opacity === "1"),
}));

await page.mouse.move(geom.dst.x, geom.dst.y, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(200);
const after = await page.evaluate(() => ({
  linking: viewport.classList.contains("is-linking"),
  connecting: !!connecting,
  otherOpacity: getComputedStyle([...document.querySelectorAll(".node")][2].querySelector('.port[data-side="left"]')).opacity,
}));

// Esc path: start drag then Escape
await page.mouse.move(geom.src.x, geom.src.y);
await page.mouse.down();
await page.waitForTimeout(80);
await page.keyboard.press("Escape");
await page.waitForTimeout(80);
const afterEsc = await page.evaluate(() => ({
  linking: viewport.classList.contains("is-linking"),
  connecting: !!connecting,
}));

// --- C. right-click copy ID ---
await page.locator(".canvas-tab").first().click({ button: "right" });
await page.waitForSelector(".context-menu:not([hidden])", { timeout: 3000 });
const items = await page.locator(".context-menu-item").allTextContents();
await page.keyboard.press("Escape");

// --- D. exitCondition on diamond ---
const diamonds = page.locator(".node.shape-diamond");
let exitOk = false;
if (await diamonds.count()) {
  await diamonds.first().click();
  await page.waitForTimeout(80);
  exitOk = await page.locator("#exitConditionGroup").isVisible();
}
const warnCount = await page.locator("#loopExitWarning").count();

const out = {
  badge,
  badgeVisible,
  hasCopyId: items.some((t) => t.includes("复制画布 ID")),
  hasCopyIdName: items.some((t) => t.includes("复制画布 ID + 名称")),
  firstIsCopyId: (items[0] || "").includes("复制画布 ID"),
  opacityIdle,
  mid,
  after,
  afterEsc,
  exitGroupVisibleOnDiamond: exitOk,
  loopWarningEl: warnCount,
  errors,
};
console.log(JSON.stringify(out, null, 2));

const checks = [
  ["badgeVisible", badgeVisible],
  ["badgeText", badge.includes("≠") && badge.includes("课堂")],
  ["hasCopyId", out.hasCopyId],
  ["hasCopyIdName", out.hasCopyIdName],
  ["firstIsCopyId", out.firstIsCopyId],
  ["opacityIdle0", opacityIdle === "0"],
  ["midLinking", mid.linking === true && mid.connecting === true],
  ["midAllPorts", mid.allVisible === true && mid.otherOpacity === "1"],
  ["afterHide", after.linking === false && after.connecting === false && after.otherOpacity === "0"],
  ["escHide", afterEsc.linking === false && afterEsc.connecting === false],
  ["exitField", exitOk],
  ["loopWarnEl", warnCount === 1],
  ["noPageErrors", errors.length === 0],
];
const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
console.log(failed.length ? "FAIL: " + failed.join(", ") : "ALL_PASS " + checks.length);
await browser.close();
process.exit(failed.length ? 1 : 0);
