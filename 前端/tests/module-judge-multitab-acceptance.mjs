// 交叉场景验收：模块 × 判断分支/循环回边 × 多标签页。
//
// 为什么要单独一个套件：模块（封装/放置/就地编辑）是 B 线带来的功能，而判断三态
// （condition/exitCondition）、连线分支（branch）、循环回边（loop）、连接方向
// （fromSide/toSide）是 A 线的功能。两条线的功能各自都测过，但「模块里装着判断节点」
// 这种交叉用法是合并后才第一次存在的东西，前面任何一套验收都没覆盖到——两个功能各自
// 全绿，合起来照样可能丢数据。
//
// 用法（工作目录必须是「画布工具本体\前端」，另一个终端里先起只读静态服务）：
//   python -m http.server 4192 --bind 127.0.0.1
//   node tests/module-judge-multitab-acceptance.mjs http://127.0.0.1:4192

import { createRequire } from "node:module";

const require = createRequire("D:/nodejs/npm-global/package.json");
const { chromium } = require("playwright");
import { resolveCanvasUrl } from "./_served-target.mjs";
const url = await resolveCanvasUrl(process.argv[2]);

const STORAGE_KEY = "workflow-canvas-communication-draft-v1";
const MODULE_KEY = "workflow-canvas-module-library-v1";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const dialogs = [];
// 封装要弹「给这个模块起个名字」，新建画布要弹「请输入新画布名称」，删除要弹确认框。
// 没人接对话框时 Playwright 默认「取消」，会导致操作被静默放弃（后面断言看到一个没变
// 的世界，看起来像产品的 bug）。这里统一接受，并把原文记进 dialogs 便于事后核对。
const answers = [];
page.on("dialog", (dialog) => { dialogs.push(dialog.message()); return dialog.accept(answers.shift() ?? ""); });

const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const results = [];

// 每个场景都要回到「同一个干净的起点」：清掉本机保存 → 重新写入本套件的种子数据 →
// 刷新。注意必须连着种子一起重写：只清不写的话，app 会退回它内置的演示画布（节点 id
// 完全不同），后面按 [data-node-id="judge"] 找节点就会一路超时，报出来的错看起来像产品
// 坏了，其实只是起点不是自己以为的那个。
const fresh = async () => {
  await page.evaluate(() => { isDirty = false; clearTimeout(autosaveTimer); autosaveTimer = null; localStorage.clear(); });
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [STORAGE_KEY, seed]);
  await page.reload();
  await page.waitForLoadState("networkidle");
};
const nodeCount = () => page.locator(".node").count();
const vp = () => page.locator("#viewport").boundingBox();
// 单选一个节点（而不是选中一片）。放置模块 / 打开模块编辑之后，新铺上画布的那几个节点是
// 处于「框选」状态的，此时检视面板显示的是多选面板，单个节点的字段（判断条件等）是隐藏的。
// 所以要先点一下画布空白把选中清掉，再点目标节点——这是用户真实会做的动作，不是绕路。
const selectOnly = async (id) => {
  const box = await vp();
  // 空白点按视口的实际尺寸算（左下角内侧），不写死偏移量：写死的偏移一旦落到窗口外面，
  // 这一次点击会被静默丢掉（不报错），选中没被清掉，后面看到检视面板里没有单节点字段，
  // 就会误判成产品丢了字段。
  await page.mouse.click(box.x + 60, box.y + box.height - 40);
  await page.waitForTimeout(80);
  const left = await page.evaluate(() => selectedNodeIds.size);
  expect(left === 0, `前置：点画布空白应清掉框选，实际还剩 ${left} 个`);
  await clickNode(id);
  await page.waitForTimeout(120);
  const picked = await page.evaluate(() => selectedNodeId);
  expect(picked === id, `前置：点击后应单选 ${id}，实际 ${picked}`);
};
const lib = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), MODULE_KEY);
const canvasState = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), STORAGE_KEY);
const activeId = () => page.evaluate(() => state.activeCanvasId);

// 用节点元素自己的位置算点击点，而不是硬编码画布坐标：硬编码一旦节点的默认位置变了就
// 会点空，失败信息还看不出来是「点错了」还是「产品坏了」。
// 选择器必须带上 .node：同一个 data-node-id 会同时挂在节点本体（div.node）和它内部的
// 「显示尺寸控制点」按钮（button.resize-toggle）上，只用 [data-node-id=…] 会命中两个元素，
// Playwright 直接以 strict mode violation 报错——那是测试写法的错，不是产品的问题。
const clickNode = async (id, modifiers = []) => {
  const box = await page.locator(`.node[data-node-id="${id}"]`).boundingBox();
  expect(box, `画布上找不到节点 ${id}`);
  // 修饰键必须用 keyboard.down/up 按住再点：page.mouse.click 的第二个参数只认
  // button/clickCount/delay，传进去的 modifiers 会被**静默忽略**（不报错），于是 Shift
  // 多选变成普通单击——后面断言「应选中 2 个」拿到 0，看起来像产品不能多选。
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  for (const key of modifiers) await page.keyboard.up(key);
};

// 选中 a、b 两个节点后封装成模块（走产品真实入口：框选面板上的「封装为模块」）
const encapsulate = async (name, ids) => {
  await page.locator('[data-tool="select"]').click();
  await clickNode(ids[0]);
  for (const id of ids.slice(1)) await clickNode(id, ["Shift"]);
  const selected = await page.evaluate(() => selectedNodeIds.size);
  expect(selected === ids.length, `前置：应选中 ${ids.length} 个节点，实际 ${selected}`);
  answers.push(name);
  await page.locator('#multiSelectPanel [data-action="save-module"]').click();
  await page.waitForTimeout(120);
};
const placeFirstModule = async () => {
  await page.locator('[data-action="open-modules"]').click();
  await page.locator('[data-module-action="place"]').click();
  await page.waitForTimeout(150);
};
// 放置出来的判断节点 = 画布上 type 为 diamond 且不是原来那个 id 的节点
const placedDiamondId = () => page.evaluate((known) => activeCanvas().nodes.find((n) => n.type === "diamond" && n.id !== known)?.id ?? null, "judge");
const placedEdge = () => page.evaluate(() => {
  const e = activeCanvas().edges.find((x) => x.branch || x.loop);
  return e ? { branch: e.branch || "", loop: e.loop === true, fromSide: e.fromSide || "", toSide: e.toSide || "" } : null;
});

async function run(name, fn) {
  try { await fn(); results.push(`✅ ${name}`); }
  catch (err) { results.push(`❌ ${name}: ${err.message}`); }
}

// 初始数据：一个判断节点（带判断条件、退出循环条件）、一个从判断节点出发的分支连线
// （标了「是」并且是循环回边的虚线），外加一条普通依赖连线。
const seed = {
  version: 1,
  activeCanvasId: "canvas-main",
  canvases: [{
    id: "canvas-main", name: "主画布", category: "",
    nodes: [
      { id: "collect", type: "rect", x: 120, y: 320, w: 176, h: 92, label: "收集材料", note: "", marker: "待讨论" },
      { id: "judge", type: "diamond", x: 440, y: 310, w: 112, h: 112, label: "材料是否齐全", note: "", marker: "有疑问", condition: "材料是否齐全？", exitCondition: "齐全，或已核对 3 轮" },
      { id: "file", type: "document", x: 720, y: 320, w: 176, h: 92, label: "归档", note: "", marker: "待讨论" },
    ],
    edges: [
      { id: "e-dep", from: "collect", to: "judge", label: "依赖", branch: "", fromSide: "", toSide: "", loop: false, width: "medium", color: "" },
      { id: "e-branch", from: "judge", to: "file", label: "审批通过", branch: "是", fromSide: "bottom", toSide: "top", loop: true, width: "medium", color: "" },
    ],
    view: { zoom: 1, panX: 0, panY: 0 },
  }],
};

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [STORAGE_KEY, seed]);
await page.reload();
await page.waitForLoadState("networkidle");

// ===== 场景1：封装模块时，判断节点的判断条件/退出条件应跟着进模块 =====
//
// 这是本套件要抓的主缺陷：saveSelectionAsModule 里节点只搬了
// type/x/y/w/h/label/note/marker，condition/exitCondition 没搬，于是「判断节点」一旦
// 被封装成模块，就退化成一个只有名字的菱形——复用出来的流程还叫「材料是否齐全」，
// 但「齐全」到底指什么、几轮算退出，全丢了。
await run("封装保留判断条件", async () => {
  await fresh();
  expect(await nodeCount() === 3, `初始应有 3 个节点，实际 ${await nodeCount()}`);
  await encapsulate("判断模块", ["judge", "file"]);
  const mods = await lib();
  expect(mods.length === 1, `应封装出 1 个模块，实际 ${mods.length}`);
  const diamond = mods[0].nodes.find((n) => n.type === "diamond");
  expect(diamond, "模块里应有一个判断节点");
  expect(diamond.condition === "材料是否齐全？", `模块里判断节点的判断条件应保留，实际 ${JSON.stringify(diamond.condition)}`);
  expect(diamond.exitCondition === "齐全，或已核对 3 轮", `模块里判断节点的退出条件应保留，实际 ${JSON.stringify(diamond.exitCondition)}`);
  expect(diamond.marker === "有疑问", `讨论标记也应保留，实际 ${JSON.stringify(diamond.marker)}`);
});

// ===== 场景2：封装模块时，连线的分支三态 / 循环回边 / 连接方向应跟着进模块 =====
await run("封装保留连线分支与循环", async () => {
  await fresh();
  await encapsulate("分支模块", ["judge", "file"]);
  const mods = await lib();
  const edge = mods[0].edges[0];
  expect(mods[0].edges.length === 1, `模块里应有 1 条连线，实际 ${mods[0].edges.length}`);
  expect(edge.branch === "是", `模块里的连线应保留分支「是」，实际 ${JSON.stringify(edge.branch)}`);
  expect(edge.loop === true, "模块里的连线应保留循环回边标记");
  expect(edge.fromSide === "bottom" && edge.toSide === "top", `模块里的连线应保留连接方向，实际 fromSide=${JSON.stringify(edge.fromSide)} toSide=${JSON.stringify(edge.toSide)}`);
});

// ===== 场景3：放置模块后，判断语义应原样出现在新实例上（字段有搬，还要真的渲染出来） =====
await run("放置后判断语义可见", async () => {
  await fresh();
  await encapsulate("判断模块", ["judge", "file"]);
  await placeFirstModule();
  expect(await nodeCount() === 5, `放置 2 个节点后应为 3+2=5，实际 ${await nodeCount()}`);
  const newId = await placedDiamondId();
  expect(newId, "放置后应能在画布上找到新放上来的判断节点");
  await page.locator('[data-tool="select"]').click();
  await selectOnly(newId);
  expect(await page.locator("#conditionGroup").isVisible(), "选中新判断节点后应显示判断条件字段");
  const cond = await page.inputValue("#inspectorCondition");
  const exitCond = await page.inputValue("#inspectorExitCondition");
  expect(cond === "材料是否齐全？", `放置出来的判断节点判断条件应为「材料是否齐全？」，实际 ${JSON.stringify(cond)}`);
  expect(exitCond === "齐全，或已核对 3 轮", `放置出来的判断节点退出条件应保留，实际 ${JSON.stringify(exitCond)}`);
  const placed = await placedEdge();
  expect(placed, "放置出来的连线应带着分支或循环标记");
  expect(placed.branch === "是", `放置出来的连线分支应为「是」，实际 ${JSON.stringify(placed.branch)}`);
  expect(placed.loop === true, "放置出来的连线应仍是循环回边");
  const loopClass = await page.locator(".edge.is-loop").count();
  expect(loopClass >= 1, `画布上应有循环回边的虚线样式，实际 ${loopClass} 条`);
});

// ===== 场景4：模块就地编辑时，判断条件应铺到画布上且能改、能存回模块 =====
await run("就地编辑保留判断条件", async () => {
  await fresh();
  await encapsulate("可编辑判断模块", ["judge", "file"]);
  await page.locator('[data-action="open-modules"]').click();
  await page.locator('[data-module-action="edit"]').click();
  await page.waitForTimeout(150);
  const newId = await placedDiamondId();
  await page.locator('[data-tool="select"]').click();
  await selectOnly(newId);
  const cond = await page.inputValue("#inspectorCondition");
  expect(cond === "材料是否齐全？", `就地编辑铺上来的判断节点应带着原判断条件，实际 ${JSON.stringify(cond)}`);
  await page.locator("#inspectorCondition").fill("材料与预算是否都齐全？");
  await page.locator("#inspectorCondition").press("Tab");
  await page.waitForTimeout(150);
  await page.locator('[data-action="save-module-edit"]').click();
  await page.waitForTimeout(120);
  expect(await page.locator("#moduleEditBar").isHidden(), "保存后模块编辑条应隐藏");
  const mods = await lib();
  const diamond = mods[0].nodes.find((n) => n.type === "diamond");
  expect(diamond?.condition === "材料与预算是否都齐全？", `改过的判断条件应存回模块，实际 ${JSON.stringify(diamond?.condition)}`);
  expect(diamond?.exitCondition === "齐全，或已核对 3 轮", `没改的退出条件不应被抹掉，实际 ${JSON.stringify(diamond?.exitCondition)}`);
});

// ===== 场景5：多标签页——模块放到画布 B，画布 A 不受影响；撤销只在 B 生效 =====
await run("多画布放置与撤销隔离", async () => {
  await fresh();
  await encapsulate("跨画布模块", ["judge", "file"]);
  const aNodes = await nodeCount();
  const aId = await activeId();
  answers.push("画布B");
  await page.locator("#newCanvasButton").click();
  await page.waitForTimeout(150);
  const bId = await activeId();
  expect(bId !== aId, `新建后应切到新画布，实际仍停在 ${bId}`);
  expect(await nodeCount() === 0, `新画布 B 应是空的，实际 ${await nodeCount()} 个节点`);
  await placeFirstModule();
  expect(await nodeCount() === 2, `画布 B 放置后应有 2 个节点，实际 ${await nodeCount()}`);
  // 切回画布 A：应当一行没变（模块是放在 B 上的）
  await page.locator(`.canvas-tab[data-canvas-id="${aId}"]`).click();
  await page.waitForTimeout(120);
  expect(await activeId() === aId, "应切回画布 A");
  expect(await nodeCount() === aNodes, `画布 A 不应被影响，应仍是 ${aNodes} 个节点，实际 ${await nodeCount()}`);
  // 回 B 撤销：B 上刚放的模块被撤掉，切回 A 仍完好
  await page.locator(`.canvas-tab[data-canvas-id="${bId}"]`).click();
  await page.waitForTimeout(120);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(150);
  expect(await nodeCount() === 0, `撤销后画布 B 应回到空的，实际 ${await nodeCount()} 个节点`);
  await page.locator(`.canvas-tab[data-canvas-id="${aId}"]`).click();
  await page.waitForTimeout(120);
  expect(await nodeCount() === aNodes, `跨画布撤销不应动到画布 A，应仍是 ${aNodes} 个节点，实际 ${await nodeCount()}`);
});

// ===== 场景6：重构前先留档——模块库不进导出文件 =====
//
// 这一条不是断言「应该怎样」，而是把当前真实行为测出来、写进结果里。走的是产品真实
// 入口（点「导出」按钮 → 浏览器真的下载一个 JSON 文件），把下载到的文件读出来看它
// 到底打包了什么：exportWorkflow 只打包 {version, activeCanvasId, canvases}，模块库
// 存在另一个 localStorage 键里、不随文件走。也就是说「导出 → 换台电脑导入」之后，
// 画布内容全在，但模块库是空的。
// 是否需要把模块库也打包进导出文件，属于产品取舍，留给曈曈拍板（见 合并计划.md 的
// 待确认项）；本场景只如实记录现状，不写「必须包含」的断言。
await run("记录：导出文件里有什么（现状）", async () => {
  await fresh();
  await encapsulate("导出观察模块", ["judge", "file"]);
  const mods = await lib();
  expect(mods.length === 1, "前置：模块库应有 1 条");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('[data-action="export"]').click(),
  ]);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const topKeys = Object.keys(payload).sort().join(",");
  expect(topKeys === "activeCanvasId,canvases,version", `导出文件顶层字段应为画布三件套，实际 ${topKeys}`);
  const exportedNodes = payload.canvases.flatMap((c) => c.nodes);
  const diamond = exportedNodes.find((n) => n.type === "diamond");
  expect(diamond?.condition === "材料是否齐全？", `导出文件里判断条件应完整，实际 ${JSON.stringify(diamond?.condition)}`);
  const exportedEdge = payload.canvases.flatMap((c) => c.edges).find((e) => e.branch);
  expect(exportedEdge?.branch === "是" && exportedEdge?.loop === true, `导出文件里分支/循环应完整，实际 ${JSON.stringify(exportedEdge)}`);
  expect(!("modules" in payload) && !("moduleLibrary" in payload), "导出文件里没有模块库字段");
  results.push(`ℹ️ 现状留档：导出文件只有 ${topKeys}（画布内容含判断条件/分支/循环都完整），模块库存在独立键 ${MODULE_KEY}，不随导出文件走——换台电脑导入后模块库为空`);
});

console.log(JSON.stringify({ results, dialogs, errors }, null, 2));
await browser.close();
