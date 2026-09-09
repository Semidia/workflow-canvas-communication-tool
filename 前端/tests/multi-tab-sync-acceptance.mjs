// 画布工具 多标签页同步 专项验收
// 覆盖：干净标签页自动同步、脏标签页冲突对话框(确定/取消)、rev 单调递增、非法 rev 防御
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire("D:/nodejs/npm-global/package.json");
const { chromium } = require("playwright");
const url = process.argv[2] || "http://127.0.0.1:4173/index.html";
const shotDir = "D:/agent临时/郄的工作流画布沟通工具验收";
const KEY = "workflow-canvas-communication-draft-v1";

const mkState = (rev, label) => ({
  rev,
  version: 1,
  activeCanvasId: "canvas-main",
  canvases: [{
    id: "canvas-main", name: "同步验收", category: "",
    nodes: [{ id: "a", type: "rect", x: 100, y: 200, w: 176, h: 92, label, note: "", marker: "待讨论" }],
    edges: [],
    view: { zoom: 1, panX: 0, panY: 0 },
  }],
});

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const results = [];
const pageErrors = [];
const check = (name, pass, detail = "") => results.push({ name, pass, detail });
let shot = 0;
const snap = async (page, name) => {
  try { mkdirSync(shotDir, { recursive: true }); } catch {}
  await page.screenshot({ path: `${shotDir}/multi-tab-sync-${++shot}-${name}.png` });
};

// 每个场景独立 context + 两个共享 localStorage 的 page，初始都加载 rev=1 状态（单节点 a，label="初始"）
async function newPair() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 820 } });
  const pageA = await ctx.newPage();
  const pageB = await ctx.newPage();
  pageA.on("pageerror", (e) => pageErrors.push(`A: ${e}`));
  pageB.on("pageerror", (e) => pageErrors.push(`B: ${e}`));
  await pageA.goto(url);
  await pageA.evaluate(({ s, k }) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(s)); }, { s: mkState(1, "初始"), k: KEY });
  await pageA.reload();
  await pageA.waitForLoadState("networkidle");
  await pageB.goto(url);
  await pageB.waitForLoadState("networkidle");
  return { ctx, pageA, pageB };
}

const labelOf = (page) => page.locator('.node[data-node-id="a"] .node-label').textContent();
const revOf = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)).rev, KEY);

try {
  // ── 场景 1：干净标签页自动同步 ──────────────────────────────
  {
    const { ctx, pageA, pageB } = await newPair();
    let dialogsB = 0;
    pageB.on("dialog", (d) => { dialogsB++; d.dismiss().catch(() => {}); });
    await pageA.locator('.node[data-node-id="a"]').click();
    await pageA.locator("#inspectorName").fill("同步后的名字");
    await pageA.locator("#inspectorName").press("Tab"); // blur → change → saveLocal
    await pageA.waitForTimeout(200);
    await pageB.waitForTimeout(400);
    check("干净标签页自动同步 label", (await labelOf(pageB)) === "同步后的名字", `B label="${await labelOf(pageB)}"`);
    check("干净标签页不弹冲突对话框", dialogsB === 0, `dialogsB=${dialogsB}`);
    check("A 保存后 rev 递增为 2", (await revOf(pageA)) === 2, `rev=${await revOf(pageA)}`);
    await snap(pageB, "1-clean-auto-sync");
    await ctx.close();
  }

  // ── 场景 2：脏标签页冲突 → 确定（丢弃本地、加载远程）────────
  {
    const { ctx, pageA, pageB } = await newPair();
    let dialogSeen = false, dialogText = "";
    pageB.on("dialog", async (d) => { dialogSeen = true; dialogText = d.message(); await d.accept(); });
    // B 进入编辑态（双击节点、键入但未提交 → 持久未保存状态，无 600ms 竞态）
    await pageB.locator('.node[data-node-id="a"] .node-label').dblclick();
    await pageB.keyboard.type("Blocal");
    // A 真实保存（改 label → blur → saveLocal rev=2）
    await pageA.locator('.node[data-node-id="a"]').click();
    await pageA.locator("#inspectorName").fill("Aupdate");
    await pageA.locator("#inspectorName").press("Tab");
    await pageB.waitForTimeout(400);
    check("脏标签页弹出冲突对话框", dialogSeen, `dialogSeen=${dialogSeen}`);
    check("冲突对话框文案提示另一标签页", (dialogText || "").includes("另一标签页"), `text="${(dialogText || "").slice(0, 24)}..."`);
    check("确定后丢弃本地改动、加载远程", (await labelOf(pageB)) === "Aupdate", `B label="${await labelOf(pageB)}"`);
    await snap(pageB, "2-conflict-accept");
    await ctx.close();
  }

  // ── 场景 3：脏标签页冲突 → 取消（保留本地改动）──────────────
  {
    const { ctx, pageA, pageB } = await newPair();
    let dialogSeen = false;
    pageB.on("dialog", async (d) => { dialogSeen = true; await d.dismiss(); });
    await pageB.locator('.node[data-node-id="a"] .node-label').dblclick();
    await pageB.keyboard.type("Blocal");
    await pageA.locator('.node[data-node-id="a"]').click();
    await pageA.locator("#inspectorName").fill("Aupdate");
    await pageA.locator("#inspectorName").press("Tab");
    await pageB.waitForTimeout(400);
    check("取消场景也弹出冲突对话框", dialogSeen, `dialogSeen=${dialogSeen}`);
    check("取消后保留本地改动", (await labelOf(pageB)) === "Blocal", `B label="${await labelOf(pageB)}"`);
    check("取消后 localStorage 仍为 A 的 rev=2 内容", (await revOf(pageB)) === 2, `rev=${await revOf(pageB)}`);
    await snap(pageB, "3-conflict-cancel");
    await ctx.close();
  }

  // ── 场景 4：rev 单调递增 ──────────────────────────────────
  {
    const { ctx, pageA } = await newPair();
    await pageA.locator('.node[data-node-id="a"]').click();
    await pageA.locator("#inspectorName").fill("名字1");
    await pageA.locator("#inspectorName").press("Tab");
    await pageA.waitForTimeout(200);
    const rev1 = await revOf(pageA);
    await pageA.locator('.node[data-node-id="a"]').click();
    await pageA.locator("#inspectorNote").fill("备注2");
    await pageA.locator("#inspectorNote").press("Tab");
    await pageA.waitForTimeout(200);
    const rev2 = await revOf(pageA);
    check("连续保存 rev 严格递增", rev1 === 2 && rev2 === 3, `rev1=${rev1} rev2=${rev2}`);
    await ctx.close();
  }

  // ── 场景 5：非法 rev 防御 ─────────────────────────────────
  {
    const { ctx, pageA, pageB } = await newPair();
    await pageA.evaluate(({ s, k }) => localStorage.setItem(k, JSON.stringify(s)), { s: mkState(0, "非法rev0"), k: KEY });
    await pageB.waitForTimeout(400);
    check("rev=0 被忽略，B 不加载", (await labelOf(pageB)) === "初始", `B label="${await labelOf(pageB)}"`);
    await pageA.evaluate(({ s, k }) => localStorage.setItem(k, JSON.stringify({ ...s, rev: "abc" })), { s: mkState(3, "非法rev字符串"), k: KEY });
    await pageB.waitForTimeout(400);
    check("rev 非数字被忽略，B 不加载", (await labelOf(pageB)) === "初始", `B label="${await labelOf(pageB)}"`);
    // B 后续正常保存，rev 不被非法值污染（stateRev 仍 1 → 保存为 2）
    await pageB.locator('.node[data-node-id="a"]').click();
    await pageB.locator("#inspectorName").fill("B后续保存");
    await pageB.locator("#inspectorName").press("Tab");
    await pageB.waitForTimeout(200);
    check("非法 rev 之后 B 保存 rev 正确递增为 2", (await revOf(pageB)) === 2, `rev=${await revOf(pageB)}`);
    await snap(pageB, "5-invalid-rev-defense");
    await ctx.close();
  }

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
