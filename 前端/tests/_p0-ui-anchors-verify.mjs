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

// --- B. right-click copy canvas ID FIRST (before any drag leaves gesture residue) ---
await page.locator(".canvas-tab").first().click({ button: "right" });
await page.waitForSelector(".context-menu:not([hidden])", { timeout: 3000 });
const items = await page.locator(".context-menu-item").allTextContents();
await page.keyboard.press("Escape");
await page.waitForTimeout(80);

// --- C. anchors during connect drag ---
// Saved localStorage view may pan nodes off-screen; pick ports whose centers are inside the viewport.
let geom = null;
let hitPort = false;
for (let i = 0; i < 12; i++) {
  geom = await page.evaluate(() => {
    const vw = viewport.getBoundingClientRect();
    const nodes = [...document.querySelectorAll(".node")];
    const pick = (side) => {
      for (const n of nodes) {
        const p = n.querySelector(`.port[data-side="${side}"]`);
        if (!p) continue;
        const r = p.getBoundingClientRect();
        if (r.width < 4) continue;
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        if (x > vw.left + 8 && x < vw.right - 8 && y > vw.top + 8 && y < vw.bottom - 8) {
          return { x, y, id: n.dataset.nodeId };
        }
      }
      return null;
    };
    const src = pick("right") || pick("bottom") || pick("left") || pick("top");
    // prefer a different node for dst
    let dst = null;
    for (const n of nodes) {
      if (src && n.dataset.nodeId === src.id) continue;
      for (const side of ["left", "top", "bottom", "right"]) {
        const p = n.querySelector(`.port[data-side="${side}"]`);
        if (!p) continue;
        const r = p.getBoundingClientRect();
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        if (r.width >= 4 && x > vw.left + 8 && x < vw.right - 8 && y > vw.top + 8 && y < vw.bottom - 8) {
          dst = { x, y, id: n.dataset.nodeId };
          break;
        }
      }
      if (dst) break;
    }
    if (!src || !dst) return null;
    return { src, dst };
  });
  if (!geom) { await page.waitForTimeout(100); continue; }
  hitPort = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return !!el?.closest?.(".port");
  }, [geom.src.x, geom.src.y]);
  if (hitPort) break;
  await page.waitForTimeout(120);
}
if (!hitPort || !geom) throw new Error("could not hit-test a visible node port for connect drag");
const opacityIdle = await page.evaluate(() => {
  // any port not hovered / not selected should start at 0
  const ports = [...document.querySelectorAll(".port")];
  return ports.some((p) => getComputedStyle(p).opacity === "0") ? "0" : "1";
});

await page.mouse.move(geom.src.x, geom.src.y);
await page.mouse.down();
await page.waitForTimeout(120);
const mid = await page.evaluate(() => {
  const ports = [...document.querySelectorAll(".port")];
  return {
    linking: viewport.classList.contains("is-linking"),
    connecting: !!connecting,
    otherOpacity: ports.filter((p) => getComputedStyle(p).opacity === "1").length + "/" + ports.length,
    allVisible: ports.every((p) => getComputedStyle(p).opacity === "1"),
  };
});

await page.mouse.move(geom.dst.x, geom.dst.y, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(200);
const after = await page.evaluate(() => {
  const ports = [...document.querySelectorAll(".port")];
  // after release, only hover/selected/connector may show — default idle should not stay all-visible
  const allStill = ports.every((p) => getComputedStyle(p).opacity === "1");
  return {
    linking: viewport.classList.contains("is-linking"),
    connecting: !!connecting,
    allStillVisible: allStill,
  };
});

// Esc path: start drag then Escape (re-hit in case first port moved)
if (geom) {
  await page.mouse.move(geom.src.x, geom.src.y);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
}
const afterEsc = await page.evaluate(() => ({
  linking: viewport.classList.contains("is-linking"),
  connecting: !!connecting,
}));

// --- D. exitCondition on diamond (select programmatically after gestures) ---
await page.keyboard.press("Escape");
await page.waitForTimeout(80);
let exitOk = false;
const dcount = await page.locator(".node.shape-diamond").count();
if (dcount) {
  await page.evaluate(() => {
    const d = activeCanvas().nodes.find((n) => n.type === "diamond");
    if (d) { selectedNodeId = d.id; selectedEdgeId = null; connectorSourceId = null; render(); }
  });
  await page.waitForTimeout(120);
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
  ["hitPort", hitPort],
  ["opacityIdle0", opacityIdle === "0"],
  ["midLinking", mid.linking === true && mid.connecting === true],
  ["midAllPorts", mid.allVisible === true],
  ["afterHide", after.linking === false && after.connecting === false && after.allStillVisible === false],
  ["escHide", afterEsc.linking === false && afterEsc.connecting === false],
  ["exitField", exitOk],
  ["loopWarnEl", warnCount === 1],
  ["noPageErrors", errors.length === 0],
];
const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
console.log(failed.length ? "FAIL: " + failed.join(", ") : "ALL_PASS " + checks.length);
await browser.close();
process.exit(failed.length ? 1 : 0);
