import { launchChromium } from "./_runtime.mjs";
import { resolveCanvasUrl } from "./_served-target.mjs";

const pageUrl = await resolveCanvasUrl(process.argv[2] || "http://127.0.0.1:4173/index.html");
const browser = await launchChromium({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console:" + m.text());
});

await page.goto(pageUrl, { waitUntil: "networkidle" });
const truth = await page.locator("#statusTruthText").textContent();

const tab = page.locator(".canvas-tab").first();
await tab.click({ button: "right" });
await page.waitForSelector(".context-menu:not([hidden])", { timeout: 3000 });
const items = await page.locator(".context-menu-item").allTextContents();
const hasCopyId = items.some((t) => t.includes("复制画布 ID"));
const hasCopyIdName = items.some((t) => t.includes("复制画布 ID + 名称"));
const firstIsCopyId = (items[0] || "").includes("复制画布 ID");
const reloadHidden = await page.locator("#reloadDiskButton").isHidden();

const globalsOk = await page.evaluate(() => ({
  render: typeof render === "function",
  loadFromDisk: typeof loadFromDisk === "function",
  updateTruthStatus: typeof updateTruthStatus === "function",
  startDiskPoll: typeof startDiskPoll === "function",
}));

let metaHasEtag = false;
let truthAfter = null;
let reloadVisible = false;
let truthAfterReload = null;
// disk poll only exists against canvas_server (4173+). Static acceptance server returns 404.
const hasApi = await page.evaluate(async () => {
  try {
    const r = await fetch("/api/state?meta=1", { cache: "no-store" });
    return r.status !== 404;
  } catch {
    return false;
  }
});

if (hasApi) {
  const meta1 = await page.evaluate(async () =>
    (await (await fetch("/api/state?meta=1", { cache: "no-store" })).json())
  );
  metaHasEtag = !!meta1.etag;
  await page.evaluate(async () => {
    const data = await (await fetch("/api/state", { cache: "no-store" })).json();
    if (data.state.canvases[0]?.nodes?.[0]) {
      data.state.canvases[0].nodes[0].note = "smoke-" + Date.now();
    }
    await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data.state),
    });
    await pollDiskState();
  });
  truthAfter = await page.locator("#statusTruthText").textContent();
  reloadVisible = await page.locator("#reloadDiskButton").isVisible();
  page.once("dialog", (d) => d.accept());
  await page.locator("#reloadDiskButton").click();
  await page.waitForTimeout(700);
  truthAfterReload = await page.locator("#statusTruthText").textContent();
}

// second clean load — no console errors
const page2 = await browser.newPage({ viewport: { width: 1440, height: 820 } });
const errors2 = [];
page2.on("pageerror", (e) => errors2.push(String(e)));
page2.on("console", (m) => {
  if (m.type() === "error") errors2.push("console:" + m.text());
});
await page2.goto(pageUrl, { waitUntil: "networkidle" });

const result = {
  pageUrl,
  truth,
  hasCopyId,
  hasCopyIdName,
  firstIsCopyId,
  items: items.slice(0, 8),
  reloadHidden,
  globalsOk,
  hasApi,
  metaHasEtag,
  truthAfter,
  reloadVisible,
  truthAfterReload,
  errors,
  errors2,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();

const fail =
  !hasCopyId ||
  !hasCopyIdName ||
  !firstIsCopyId ||
  errors.length ||
  errors2.length ||
  !Object.values(globalsOk).every(Boolean);
if (fail) process.exit(1);
if (hasApi && (!reloadVisible || !metaHasEtag || truthAfter !== "不一致")) process.exit(2);
