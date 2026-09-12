// 丙方案「模块库单独导出／导入」验收（真实浏览器 + 真实点击/上传/弹窗）
//
// 要解决的毛病：模块库只住在本机浏览器里（localStorage 的 workflow-canvas-module-library-v1），
// 既不在「导出工作流」里，导入工作流时也不会被清掉。换台电脑、发给同事，模块就全没了。
// 丙方案给模块库配一对自己的「导出／导入」按钮，本套件逐条验它：
//   ① 空的模块库点导出 → 只给提示，不产生文件；
//   ② 导出出来的文件是「模块库」专属格式（kind/version/exportedAt/modules），且不含 canvases；
//   ③ 导入是「合并」不是「清空替换」：同 id 覆盖、没见过的追加、本机其他模块一个不动；
//   ④ 换台电脑（清空浏览器存储）也能把模块搬过去 —— 这就是丙方案的兑现点；
//   ⑤ 坏文件、工作流文件、更新版本文件、取消确认、模块正在编辑 —— 都不能弄坏已有模块库。
//
// 用法：
//   node tests/module-library-export-import-acceptance.mjs [http://127.0.0.1:4192] [证据目录]

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { resolveCanvasUrl } from "./_served-target.mjs";

const require = createRequire("D:/nodejs/npm-global/package.json");
const { chromium } = require("playwright");

const url = await resolveCanvasUrl(process.argv[2]);
const outDir = process.argv[3] || "D:/agent临时/画布模块库验收-20260913";
fs.mkdirSync(outDir, { recursive: true });

const KEY = "workflow-canvas-communication-draft-v1";
const MODULE_KEY = "workflow-canvas-module-library-v1";
const KIND = "workflow-canvas-module-library";

const seedState = () => ({
  version: 1,
  activeCanvasId: "canvas-main",
  canvases: [{
    id: "canvas-main",
    name: "模块库验收",
    category: "",
    nodes: [
      { id: "a", type: "rect", x: 160, y: 260, w: 176, h: 92, label: "收需求", note: "", marker: "待讨论" },
      { id: "d", type: "diamond", x: 500, y: 260, w: 96, h: 96, label: "齐了吗", note: "", condition: "", exitCondition: "", marker: "待讨论" },
      { id: "b", type: "rect", x: 800, y: 260, w: 176, h: 92, label: "出稿", note: "", marker: "待讨论" },
    ],
    edges: [
      { id: "e-1", from: "a", to: "d", width: "medium", color: "", label: "", branch: "", loop: false },
      { id: "e-2", from: "d", to: "b", width: "medium", color: "", branch: "", loop: false },
    ],
    view: { zoom: 1, panX: 0, panY: 0 },
  }],
});

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

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 820 }, acceptDownloads: true });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));

// 弹窗策略：prompt 按队列回答；confirm 默认「确定」，个别用例临时改成「取消」
const promptQueue = [];
let confirmAnswer = true;
const dialogLog = [];
page.on("dialog", async (dialog) => {
  const entry = { type: dialog.type(), message: dialog.message(), 回答: "" };
  if (dialog.type() === "prompt") {
    const answer = promptQueue.length ? promptQueue.shift() : dialog.defaultValue();
    entry.回答 = `确定：${answer}`;
    dialogLog.push(entry);
    await dialog.accept(answer);
    return;
  }
  entry.回答 = confirmAnswer ? "确定" : "取消";
  dialogLog.push(entry);
  if (confirmAnswer) await dialog.accept();
  else await dialog.dismiss();
});

const downloads = [];
page.on("download", (d) => downloads.push(d));

const lib = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), MODULE_KEY);
const libNames = async () => (await lib()).map((m) => m.name);
const libIds = async () => (await lib()).map((m) => m.id).sort();
const libSnapshot = async () => JSON.stringify((await lib()).map((m) => ({ id: m.id, name: m.name, n: m.nodes.length, e: m.edges.length })).sort((a, b) => a.id.localeCompare(b.id)));
const canvasCounts = () => page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem(k) || "null");
  const c = s?.canvases?.[0];
  return { 画布数: s?.canvases?.length ?? 0, 节点数: c?.nodes?.length ?? 0, 连线数: c?.edges?.length ?? 0 };
}, KEY);
const itemCount = () => page.locator("#moduleList .module-item").count();
const itemNames = () => page.locator("#moduleList .module-item-name").allTextContents();
const toastInfo = () => page.evaluate(() => {
  const t = document.querySelector("#toast");
  return { 文字: (t?.textContent || "").trim(), 正在显示: !!t?.classList.contains("is-visible") };
});
const dialogsOfType = (type) => dialogLog.filter((d) => d.type === type);
const lastDialog = (type) => [...dialogsOfType(type)].pop();

async function openModal() {
  if (await page.locator("#moduleModal").isVisible()) return;
  await page.locator('[data-action="open-modules"]').click();
  await page.waitForTimeout(200);
}
async function closeModal() {
  if (!(await page.locator("#moduleModal").isVisible())) return;
  await page.locator('.modal-close[data-action="close-modules"]').click();
  await page.waitForTimeout(200);
}
async function shot(name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
}

// 「真实的文件选择」：点按钮 → 系统文件选择框 → 投喂文件；弹不出来才退到隐藏输入框
let chooserFallback = false;
async function feedFile(triggerSelector, inputSelector, filePath) {
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 3000 }),
      page.locator(triggerSelector).click(),
    ]);
    await chooser.setFiles(filePath);
    note(`投喂文件 ${path.basename(filePath)}：走的是「真实点击 → 系统文件选择框」`);
  } catch {
    chooserFallback = true;
    await page.setInputFiles(inputSelector, filePath);
    note(`投喂文件 ${path.basename(filePath)}：系统文件选择框没弹出来，退回给隐藏输入框直接投喂`);
  }
  await page.waitForTimeout(400);
}
const importModuleFile = (filePath) => feedFile('[data-action="import-modules"]', "#moduleImportInput", filePath);

// 导出：真实点击，等浏览器交出一个下载文件（先挂监听再点，免得快得来不及接）
async function clickExportAndSave(saveName) {
  let download = null;
  try {
    [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 3000 }),
      page.locator('[data-action="export-modules"]').click(),
    ]);
  } catch {
    return { 有文件: false, 文件名: "", 路径: "", 提示: (await toastInfo()).文字 };
  }
  const target = path.join(outDir, saveName);
  await download.saveAs(target);
  return { 有文件: true, 文件名: download.suggestedFilename(), 路径: target, 提示: (await toastInfo()).文字 };
}

async function marqueeSelectAll() {
  await page.locator('[data-tool="marquee"]').click();
  await page.waitForTimeout(150);
  const vb = await page.locator("#viewport").boundingBox();
  await page.mouse.move(vb.x + 6, vb.y + 6);
  await page.mouse.down();
  await page.mouse.move(vb.x + vb.width - 6, vb.y + vb.height - 6, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}
async function encapsulate(name, triggerSelector = '#multiSelectPanel [data-action="save-module"]') {
  promptQueue.push(name);
  await page.locator(triggerSelector).click();
  await page.waitForTimeout(300);
}

async function reseed() {
  await page.evaluate(({ s, k }) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(s)); }, { s: seedState(), k: KEY });
  await page.reload();
  await page.waitForLoadState("networkidle");
}

const result = {};

// ------------------------------------------------------------- 0. 干净起步
await page.goto(url);
await page.waitForLoadState("networkidle");
await reseed();
expect((await lib()).length === 0, "开局模块库应为空");
note(`开局：模块库为空，画布 ${JSON.stringify(await canvasCounts())}`);

// ------------------------------------- 1. 空模块库点导出：只提示，不出文件
{
  await openModal();
  expect(await itemCount() === 0, `空模块库应显示「还没有模块」而不是列表项，实际 ${await itemCount()} 项`);
  expect(await page.locator("#moduleList .module-empty").isVisible(), "空模块库应显示引导文字");
  const r = await clickExportAndSave("空库不该有文件.json");
  result.空库导出 = { 有文件: r.有文件, 提示: r.提示 };
  expect(r.有文件 === false, "空的模块库点导出，不该产生任何文件");
  expect(r.提示 === "模块库还是空的，没有可导出的模块", `空库导出的提示应说明「模块库还是空的」，实际「${r.提示}」`);
  await shot("01_空库导出只提示");
  note(`空库点导出：${r.提示}（没有产生文件）`);
}

// ----------------------------------- 2. 用真实操作封装一个模块（3 节点 2 连线）
{
  await closeModal();
  await marqueeSelectAll();
  expect(await page.locator("#multiSelectPanel").isVisible(), "框选后应出现框选结果面板");
  await encapsulate("验收模块甲");
  expect((await lib()).length === 1 && (await libNames())[0] === "验收模块甲", `应存下 1 个模块「验收模块甲」，实际 ${JSON.stringify(await libNames())}`);
  const t = await toastInfo();
  expect(t.文字 === "模块「验收模块甲」已保存（3 个节点、2 条连线）", `封装提示应写清节点数与连线数，实际「${t.文字}」`);
  await shot("02_封装第一个模块");
  note(`封装模块甲：${t.文字}`);
}

// ------------------------- 3. 导出：文件应是「模块库」专属格式，且不含工作流的 canvases
let fileA = "";
{
  await openModal();
  expect(await itemCount() === 1, `模块库列表应有 1 项，实际 ${await itemCount()}`);
  const r = await clickExportAndSave("导出的模块库_甲.json");
  result.导出甲 = { 有文件: r.有文件, 文件名: r.文件名, 提示: r.提示 };
  expect(r.有文件 === true, "有模块时点导出应产生文件");
  expect(r.文件名 === "模块库-1个模块.json", `导出文件名应带模块数，实际「${r.文件名}」`);
  expect(r.提示 === "模块库已导出（1 个模块）", `导出提示应写清模块数，实际「${r.提示}」`);
  fileA = r.路径;

  const payload = JSON.parse(fs.readFileSync(fileA, "utf8"));
  result.导出甲.文件内容要点 = {
    kind: payload.kind, version: payload.version, 有导出时间: typeof payload.exportedAt === "number",
    模块数: payload.modules?.length, 含canvases: Object.prototype.hasOwnProperty.call(payload, "canvases"),
    模块字段: Object.keys(payload.modules?.[0] || {}),
  };
  expect(payload.kind === KIND, `导出文件的 kind 应为 ${KIND}，实际 ${payload.kind}`);
  expect(payload.version === 1, `导出文件的 version 应为 1，实际 ${payload.version}`);
  expect(typeof payload.exportedAt === "number" && payload.exportedAt > 0, "导出文件应带导出时间 exportedAt");
  expect(Array.isArray(payload.modules) && payload.modules.length === 1, `导出文件里应有 1 个模块，实际 ${payload.modules?.length}`);
  expect(!Object.prototype.hasOwnProperty.call(payload, "canvases"), "模块库文件里不该混进工作流的 canvases 字段");
  expect((payload.modules[0].nodes || []).length === 3, `模块甲里应含 3 个节点，实际 ${payload.modules[0].nodes?.length}`);
  expect((payload.modules[0].edges || []).length === 2, `模块甲里应含 2 条连线，实际 ${payload.modules[0].edges?.length}`);
  await shot("03_导出模块库");
  note(`导出模块甲：文件名「${r.文件名}」，kind=${payload.kind}，version=${payload.version}，模块字段 ${JSON.stringify(Object.keys(payload.modules[0]))}`);
}

// --------------------- 4. 把同一个文件导回来：同 id 覆盖，模块数不变（合并而非替换）
{
  await importModuleFile(fileA);
  const ask = lastDialog("confirm");
  result.导入自己 = { 确认弹窗: ask?.message ?? "", 提示: (await toastInfo()).文字, 模块数: (await lib()).length };
  expect(String(ask?.message).includes("新增 0 个、覆盖同 id 1 个"), `同文件导回时应提示「新增 0 个、覆盖同 id 1 个」，实际「${ask?.message}」`);
  expect(result.导入自己.提示 === "模块库已导入：新增 0 个、覆盖 1 个", `导入提示不对：「${result.导入自己.提示}」`);
  expect(result.导入自己.模块数 === 1, `同文件导回后模块数应仍是 1，实际 ${result.导入自己.模块数}`);
  expect((await itemCount()) === 1, "列表应同步刷新为 1 项");
  await shot("04_同文件导回_合并覆盖");
  note(`同一个文件导回：${ask?.message} → ${result.导入自己.提示}，模块数仍为 1`);
}

// ------------------- 5. 换 id 的文件导进来：新增而非覆盖（本机其他模块不受影响）
{
  const payload = JSON.parse(fs.readFileSync(fileA, "utf8"));
  payload.modules[0].id = "mod-验收乙";
  payload.modules[0].name = "验收模块乙";
  const fileB = path.join(outDir, "模块库_乙_换了id.json");
  fs.writeFileSync(fileB, JSON.stringify(payload, null, 2), "utf8");

  await importModuleFile(fileB);
  const ask = lastDialog("confirm");
  result.导入乙 = { 确认弹窗: ask?.message ?? "", 提示: (await toastInfo()).文字, 模块名: await libNames() };
  expect(String(ask?.message).includes("新增 1 个、覆盖同 id 0 个"), `新 id 文件应提示「新增 1 个、覆盖同 id 0 个」，实际「${ask?.message}」`);
  expect(result.导入乙.模块名.join("|") === "验收模块甲|验收模块乙", `导入后应并存两个模块，实际 ${JSON.stringify(result.导入乙.模块名)}`);
  expect(await itemCount() === 2, `列表应同步为 2 项，实际 ${await itemCount()}`);
  await shot("05_新id导入_追加");
  note(`导入新 id 文件：${ask?.message} → 模块库 ${JSON.stringify(result.导入乙.模块名)}`);

  // 本机再封装一个「仅本机模块丙」，用来验「导入绝不清空本机其他模块」
  // 走的是另一条真实入口：顶栏「封装为模块」按钮 + 真实输入框里打名字
  await closeModal();
  await marqueeSelectAll();
  await encapsulate("仅本机模块丙", '.topbar [data-action="save-module"]');
  const names3 = await libNames();
  result.本机第三个模块 = { 模块名: names3, 提示: (await toastInfo()).文字 };
  expect(names3.length === 3, `本机应有 3 个模块，实际 ${names3.length}（${JSON.stringify(names3)}）`);
  expect(names3.includes("仅本机模块丙"), `「仅本机模块丙」应在本机模块库里，实际 ${JSON.stringify(names3)}`);
  note(`再封装「仅本机模块丙」：当前模块库 ${JSON.stringify(names3)}`);
}

// ------------------ 6. 拿旧文件再导一次：只覆盖同 id，本机独有的模块必须活着
{
  await openModal();
  const before = await libSnapshot();
  const fileB = path.join(outDir, "模块库_乙_换了id.json");
  await importModuleFile(fileB);
  const ask = lastDialog("confirm");
  const after = await libSnapshot();
  result.再导旧文件 = { 确认弹窗: ask?.message ?? "", 模块名: await libNames(), 前后一致: before === after };
  expect(String(ask?.message).includes("新增 0 个、覆盖同 id 1 个"), `再导同一文件应提示「新增 0 个、覆盖同 id 1 个」，实际「${ask?.message}」`);
  expect(after === before, "再导同一文件，模块库内容应完全不变（不许清空重建）");
  expect((await libNames()).includes("仅本机模块丙"), "导入不许把本机独有的模块弄丢");
  await shot("06_再导_本机模块还在");
  note(`再导旧文件：${ask?.message}；本机独有的「仅本机模块丙」仍在，模块库 ${JSON.stringify(result.再导旧文件.模块名)}`);
}

// --------------------- 7. 导出整库（3 个模块），拿去给「另一台电脑」用
let fileC = "";
{
  const r = await clickExportAndSave("导出的模块库_三个模块.json");
  result.导出全部 = { 文件名: r.文件名, 提示: r.提示 };
  expect(r.文件名 === "模块库-3个模块.json", `整库导出文件名应写 3 个模块，实际「${r.文件名}」`);
  expect(r.提示 === "模块库已导出（3 个模块）", `整库导出提示不对：「${r.提示}」`);
  fileC = r.路径;
  const payload = JSON.parse(fs.readFileSync(fileC, "utf8"));
  expect(payload.modules.length === 3, `整库文件里应有 3 个模块，实际 ${payload.modules.length}`);
  await shot("07_导出整库");
  note(`整库导出：${r.提示}，文件 ${r.文件名}`);
}

// ----------------------- 8. 换台电脑：清空浏览器存储后导入，模块必须整批搬过去
{
  await closeModal();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect((await lib()).length === 0, "清空浏览器存储后模块库应为空（模拟换了一台电脑）");

  await openModal();
  expect(await itemCount() === 0, "新电脑上模块库列表应为空");
  await importModuleFile(fileC);
  const ask = lastDialog("confirm");
  const names = await libNames();
  result.换电脑导入 = { 确认弹窗: ask?.message ?? "", 提示: (await toastInfo()).文字, 模块名: names, 列表项: await itemCount() };
  expect(names.length === 3, `换台电脑导入整库文件后应有 3 个模块，实际 ${names.length}（${JSON.stringify(names)}）`);
  expect(names.includes("验收模块甲") && names.includes("验收模块乙") && names.includes("仅本机模块丙"), `三个模块应逐个到位，实际 ${JSON.stringify(names)}`);
  expect(result.换电脑导入.提示 === "模块库已导入：新增 3 个、覆盖 0 个", `提示应写清新增 3 个，实际「${result.换电脑导入.提示}」`);
  expect(result.换电脑导入.列表项 === 3, `列表应显示 3 项，实际 ${result.换电脑导入.列表项}`);
  expect(await page.locator("#moduleList .module-empty").isVisible() === false, "有模块时不该再显示空库引导文字");
  await shot("08_换台电脑导入成功");
  note(`★ 丙方案兑现点：清空浏览器存储后导入整库文件，3 个模块全部搬到新电脑（${JSON.stringify(names)}）`);
}

// ------------------------ 9. 把「工作流文件」投给模块库导入：要给出人话指引，且不动已有模块库
{
  const wf = path.join(outDir, "工作流文件_故意投给模块库.json");
  fs.writeFileSync(wf, JSON.stringify({ version: 1, activeCanvasId: "canvas-main", canvases: [{ id: "canvas-main", name: "外来工作流", nodes: [], edges: [], view: { zoom: 1, panX: 0, panY: 0 } }] }, null, 2), "utf8");
  const before = await libSnapshot();
  await importModuleFile(wf);
  const t = (await toastInfo()).文字;
  result.工作流文件投给模块库 = { 提示: t, 模块库未变: before === (await libSnapshot()) };
  expect(t === "模块库导入失败：这是画布工作流文件，请改用顶栏的「导入」按钮", `应给人话指引，实际「${t}」`);
  expect(result.工作流文件投给模块库.模块库未变, "被拒绝的导入不许改动已有模块库");
  await shot("09_工作流文件投给模块库");
  note(`把工作流文件投给模块库导入：${t}（模块库未改动）`);
}

// -------------------------------- 10. 各种坏文件：一个个都拒绝，且模块库分毫不动
{
  const cases = [];
  const truncated = path.join(outDir, "坏文件_截断的JSON.json");
  fs.writeFileSync(truncated, '{ "kind": "workflow-canvas-module-library", "modules": [', "utf8");
  cases.push({ 名字: "截断的 JSON", 路径: truncated, 期待: "模块库导入失败：文件不是有效的模块库 JSON" });

  const wrongShape = path.join(outDir, "坏文件_形状不对.json");
  fs.writeFileSync(wrongShape, JSON.stringify({ 你好: "世界" }, null, 2), "utf8");
  cases.push({ 名字: "形状不对", 路径: wrongShape, 期待: "模块库导入失败：文件不是有效的模块库 JSON" });

  const emptyModules = path.join(outDir, "坏文件_空模块数组.json");
  fs.writeFileSync(emptyModules, JSON.stringify({ kind: KIND, version: 1, modules: [] }, null, 2), "utf8");
  cases.push({ 名字: "modules 为空数组", 路径: emptyModules, 期待: "模块库导入失败：文件里没有可用的模块" });

  const garbage = path.join(outDir, "坏文件_模块都不认识.json");
  fs.writeFileSync(garbage, JSON.stringify({ kind: KIND, version: 1, modules: [{}, { foo: 1 }, { id: "x" }] }, null, 2), "utf8");
  cases.push({ 名字: "模块全是残废的", 路径: garbage, 期待: "模块库导入失败：文件里没有可用的模块" });

  const huge = path.join(outDir, "坏文件_超过8MB.json");
  const base = JSON.stringify({ kind: KIND, version: 1, modules: [] });
  fs.writeFileSync(huge, base + " ".repeat(9 * 1024 * 1024), "utf8");
  cases.push({ 名字: "超过 8MB", 路径: huge, 期待: "模块库导入失败：文件过大（超过 8MB）" });

  result.坏文件 = [];
  for (const c of cases) {
    const before = await libSnapshot();
    const confirmsBefore = dialogsOfType("confirm").length;
    await importModuleFile(c.路径);
    const t = (await toastInfo()).文字;
    const unchanged = before === (await libSnapshot());
    result.坏文件.push({ 名字: c.名字, 提示: t, 模块库未变: unchanged, 追问了确认框: dialogsOfType("confirm").length > confirmsBefore });
    expect(t === c.期待, `坏文件「${c.名字}」应提示「${c.期待}」，实际「${t}」`);
    expect(unchanged, `坏文件「${c.名字}」不该改动模块库`);
    expect(dialogsOfType("confirm").length === confirmsBefore, `坏文件「${c.名字}」在被判定无效前不该先弹确认框`);
  }
  await shot("10_坏文件全被拒");
  note(`坏文件共 ${cases.length} 种，逐个拒绝且模块库分毫未动：${result.坏文件.map((x) => x.名字).join("、")}`);
}

// ------------------- 11. 更新版本导出的文件：取消就不导，确认才导
{
  const v2 = path.join(outDir, "模块库_版本2.json");
  fs.writeFileSync(v2, JSON.stringify({
    kind: KIND, version: 2, exportedAt: 1,
    modules: [{ id: "mod-版本二", name: "版本二模块", createdAt: 1, nodes: [{ id: "n1", type: "rect", x: 0, y: 0, w: 176, h: 92, label: "来自新版本", note: "", marker: "待讨论", condition: "", exitCondition: "" }], edges: [] }],
  }, null, 2), "utf8");

  const before = await libSnapshot();
  confirmAnswer = false;
  await importModuleFile(v2);
  const askDismiss = lastDialog("confirm");
  const afterDismiss = await libSnapshot();
  confirmAnswer = true;
  expect(String(askDismiss?.message).includes("由更新版本导出"), `更新版本文件应先问一句，实际「${askDismiss?.message}」`);
  expect(askDismiss?.回答 === "取消", "这一次应该点的是「取消」");
  expect(before === afterDismiss, "点了取消，模块库就不许有变化");
  note(`更新版本文件 + 点取消：${askDismiss?.message} → 模块库未变`);

  await importModuleFile(v2);
  const askAccept = lastDialog("confirm");
  const names = await libNames();
  result.更新版本文件 = { 取消时未变: before === afterDismiss, 确定后模块名: names };
  expect(askAccept?.回答 === "确定", "第二次应该点「确定」");
  expect(names.includes("版本二模块"), `点了确定应把模块导进来，实际 ${JSON.stringify(names)}`);
  expect(names.length === 4, `导入后应有 4 个模块，实际 ${names.length}`);
  await shot("11_更新版本文件");
  note(`更新版本文件 + 点确定：模块库变成 ${JSON.stringify(names)}`);
}

// --------------------- 12. 合并确认框上点「取消」：模块库一点都不能变
{
  const before = await libSnapshot();
  confirmAnswer = false;
  await importModuleFile(path.join(outDir, "模块库_乙_换了id.json"));
  const ask = lastDialog("confirm");
  confirmAnswer = true;
  const after = await libSnapshot();
  result.取消合并 = { 确认弹窗: ask?.message ?? "", 点取消后未变: before === after };
  expect(String(ask?.message).includes("导入将与本机模块库合并"), `合并前应问清「合并」这件事，实际「${ask?.message}」`);
  expect(ask?.回答 === "取消", "这一次应该点的是「取消」");
  expect(after === before, "点了取消，模块库就不许有变化");
  await shot("12_取消合并不生效");
  note("合并确认框点取消：模块库未变");
}

// --------------- 13. 模块正在编辑时不许导入：先给提示，退出编辑后照常能导
{
  await openModal();
  await page.locator('#moduleList .module-item [data-module-action="edit"]').first().click();
  await page.waitForTimeout(300);
  const editingName = (await page.locator("#moduleEditName").textContent() || "").trim();
  expect(await page.locator("#moduleEditBar").isVisible(), "点「编辑」后应出现「正在编辑模块」的横条");

  await openModal();
  const before = await libSnapshot();
  await importModuleFile(path.join(outDir, "模块库_乙_换了id.json"));
  const t = (await toastInfo()).文字;
  const unchanged = before === (await libSnapshot());
  result.编辑中导入被拦 = { 正在编辑: editingName, 提示: t, 模块库未变: unchanged };
  expect(t.includes("正在编辑中"), `编辑模块时应拦住导入并说明原因，实际「${t}」`);
  expect(t.includes(editingName), `提示里应点名是哪个模块在编辑，实际「${t}」`);
  expect(unchanged, "被拦下的导入不该改动模块库");
  await shot("13_编辑中不许导入");

  await closeModal();
  await page.locator('[data-action="cancel-module-edit"]').click();
  await page.waitForTimeout(300);
  expect(await page.locator("#moduleEditBar").isVisible() === false, "点「取消编辑」后横条应消失");
  note(`编辑「${editingName}」时导入被拦：${t}；点「取消编辑」后恢复`);

  await openModal();
  await importModuleFile(path.join(outDir, "模块库_乙_换了id.json"));
  // 注意：这个文件此前已经导进来过，再导一次内容是一样的，模块库快照不会变——
  // 所以这里要看的是「导入这一步有没有真的走完」（弹了合并确认框 + 播了成功提示），
  // 而不是拿快照变化当证据，否则这条断言会因为「本来就没变化」而假性失败。
  const askAfterEdit = lastDialog("confirm");
  const toastAfterEdit = (await toastInfo()).文字;
  result.退出编辑后再导入 = { 确认弹窗: askAfterEdit?.message ?? "", 成功提示: toastAfterEdit };
  expect(String(askAfterEdit?.message).includes("导入将与本机模块库合并"), `退出编辑后应能走到合并确认这一步，实际「${askAfterEdit?.message}」`);
  expect(askAfterEdit?.回答 === "确定", "退出编辑后这一次的合并确认应该是点「确定」");
  expect(toastAfterEdit === "模块库已导入：新增 0 个、覆盖 1 个", `退出编辑后再导入应正常生效并给出成功提示，实际「${toastAfterEdit}」`);
  await shot("13b_退出编辑再导入");
  note(`退出编辑后再导一次：正常生效（${toastAfterEdit}）`);
}

// ---- 14. 反向对照：把「模块库文件」投给顶栏的工作流「导入」，应被拒绝且画布不动
{
  await closeModal();
  const beforeCanvas = await canvasCounts();
  const beforeLib = await libSnapshot();
  await feedFile("label.file-button", "#importInput", fileC);
  const t = (await toastInfo()).文字;
  result.模块库文件投给工作流导入 = { 提示: t, 画布未变: JSON.stringify(beforeCanvas) === JSON.stringify(await canvasCounts()), 模块库未变: beforeLib === (await libSnapshot()) };
  expect(t === "导入失败：文件不是有效的工作流 JSON", `模块库文件不该被当成工作流导入，实际「${t}」`);
  expect(result.模块库文件投给工作流导入.画布未变, "被拒绝的工作流导入不该改动画布");
  expect(result.模块库文件投给工作流导入.模块库未变, "被拒绝的工作流导入不该改动模块库");
  await shot("14_模块库文件投给工作流导入");
  note(`把模块库文件投给顶栏「导入」：${t}（画布与模块库都没动）`);
}

// ------------------------------------------------------------------ 15. 收尾
expect(errors.length === 0, `页面不应报错，实际：${JSON.stringify(errors)}`);
expect(chooserFallback === false, "全程应走「真实点击 → 系统文件选择框」的路径，不该退回隐藏输入框投喂");
await shot("15_收尾");

const finalResult = {
  目标地址: url,
  断言条数: assertCount,
  ...result,
  页面报错: errors,
  弹窗记录: dialogLog,
  记录: notes,
};
fs.writeFileSync(path.join(outDir, "模块库导出导入_验收结果.json"), JSON.stringify(finalResult, null, 2), "utf8");
console.log(JSON.stringify(finalResult, null, 2));

await browser.close();
console.log(`\n模块库单独导出／导入验收通过：共 ${assertCount} 条断言全部成立。证据目录：${outDir}`);
