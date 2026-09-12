// 统一验收入口：把 tests 目录下所有 *-acceptance.mjs 依次跑一遍，最后汇成一张表。
//
// 用法（工作目录必须是「画布工具本体\前端」）：
//   node tests/run-all-acceptance.mjs [http://127.0.0.1:4192]
//
// 为什么要单独一个入口：合并后验收套件有十来个，逐个手敲命令容易漏跑（漏跑的套件
// 等于没验收，但看结果时会误以为「都过了」）。这里改成「按文件名自动发现」——以后
// 新增 *-acceptance.mjs 会被自动带进来，不需要再改这个文件。
//
// 前置：另一个终端里先起一个只读静态服务（不要在 4190 端口，Node 的 undici 按 FETCH
// 规范的禁用端口名单直接拒绝 4190，请求根本发不出去）：
//   cd "D:\郄的工作流画布沟通工具\画布工具本体\前端"
//   python -m http.server 4192 --bind 127.0.0.1
// 这里故意不用 canvas_server.py：那是带写盘接口的服务，跑验收会把 工作流导出\画布数据.json
// 写掉。静态服务只读，验收里对 /api/state 的 404 是预期现象。
//
// 套件之间是顺序跑的：每个套件都会开一个自己的 Chrome，并发跑会互相抢 CPU/内存，
// 而且验收里有拖拽、等待 750ms 自动保存之类的时序断言，抢资源容易出假失败。

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || "http://127.0.0.1:4192";

// 只读静态服务活着吗？活着才继续，省得每个套件都报一遍「连不上」。
try {
  const resp = await fetch(url, { method: "GET" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
} catch (err) {
  console.error(`连不上 ${url}：${err.message}`);
  console.error("请先在「画布工具本体\\前端」目录里起只读静态服务：python -m http.server 4192 --bind 127.0.0.1");
  process.exit(2);
}

// 按文件名自动发现所有 *-acceptance.mjs，但必须把自己排除掉：这个入口文件本身也以
// "-acceptance.mjs" 结尾，不排除的话 spawnSync 会拿自己当套件再启动一个自己，那个自己
// 又启动一个自己——父等子、子等孙一路挂下去，每两分钟长一层，永远不结束。实测表现是
// 「日志里跑到倒数第二个套件就不动了」：其实那一行之后轮到的是它自己，卡死在等孙子。
// 排除自己是治本（而不是加个「最大深度」护栏，那只是把无限递归变成有限递归）。
const selfName = basename(fileURLToPath(import.meta.url));
const suites = readdirSync(here).filter((name) => name.endsWith("-acceptance.mjs") && name !== selfName).sort();

// 从套件输出里挑出最后一个完整 JSON 对象（各套件都在最后 console.log 一份汇总）。
const lastJson = (text) => {
  const end = text.lastIndexOf("}");
  if (end < 0) return null;
  for (let start = text.lastIndexOf("{", end); start >= 0; start = text.lastIndexOf("{", start - 1)) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // 从更靠前的 { 再试一次，直到找到一个能整体解析的片段
    }
    if (start === 0) break;
  }
  return null;
};

const collectStrings = (value, out = []) => {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, out));
  return out;
};

const rows = [];
let failed = 0;

// 各套件的汇总格式并不统一（有的报 summary.passed/total，有的报 断言总数+失败数组，
// 有的只报一列 "✅ …" 字符串），所以下面按「先认结构化计数、认不到再退回数 ✅/❌ 字符串」
// 的顺序解析，绝不把「认不出来」当成「通过」——认不出来时通过数显示 ? 并在失败判定上
// 保持从严（只要有 ❌、有 errors/pageErrors、或进程非 0 退出就算这条没绿）。
const countBadStrings = (strings) => strings.filter((line) => line.includes("❌")).length;

for (const suite of suites) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [join(here, suite), url], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout || ""}${run.stderr || ""}`;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const parsed = lastJson(out);
  const strings = parsed ? collectStrings(parsed) : [];
  const badStrings = strings.filter((line) => line.includes("❌"));
  const summary = parsed && parsed.summary && typeof parsed.summary === "object" ? parsed.summary : null;
  const declaredFailures = parsed && Array.isArray(parsed.失败) ? parsed.失败 : null;
  // results 数组是「一条记录 = 一个场景」的清单，但各套件的成功写法并不统一：有的是
  // "✅ 场景名"，有的是 "场景1 连续放置不重叠：通过"。所以按「不是失败、也不是备注」来数
  // 通过条数——❌ 是失败，ℹ️/⚠️ 是留档或告警，都不算通过。数不出来时宁可显示 ?，也不硬凑。
  const notPassMarks = ["❌", "ℹ️", "⚠️"];
  const passCount = summary && Number.isFinite(summary.passed)
    ? summary.passed
    : parsed && Array.isArray(parsed.results)
      ? parsed.results.filter((line) => typeof line === "string" && !notPassMarks.some((mark) => line.includes(mark))).length
      : parsed && Number.isFinite(parsed.断言总数)
        ? parsed.断言总数 - badStrings.length
        : null;
  const failCount = summary && Number.isFinite(summary.failed)
    ? summary.failed
    : declaredFailures
      ? declaredFailures.length
      : badStrings.length;
  const errorCount = ["errors", "pageErrors"].reduce((sum, key) => sum + (parsed && Array.isArray(parsed[key]) ? parsed[key].length : 0), 0);
  const ok = run.status === 0 && failCount === 0 && errorCount === 0 && badStrings.length === 0;
  if (!ok) failed += 1;
  rows.push({ suite, ok, seconds, passCount, failCount, errorCount, failedItems: badStrings, declaredFailures: declaredFailures || [], tail: ok ? "" : out.trim().split("\n").slice(-12).join("\n") });
  console.log(`${ok ? "✅" : "❌"} ${suite}  ${seconds}s  通过=${passCount ?? "?"} 失败=${failCount} 报错=${errorCount}`);
}

console.log("");
console.log(`共 ${suites.length} 个套件，${suites.length - failed} 个全绿，${failed} 个有问题。`);
// 通过数显示 ? 不等于通过：那是「这个套件没报条数」的意思。单独列一行，免得有人把 ?
// 当成 0 或者当成绿。
const uncounted = rows.filter((row) => row.passCount === null).map((row) => row.suite);
if (uncounted.length) console.log(`（这些套件不报断言条数、通过数显示 ?：${uncounted.join("、")}）`);
for (const row of rows.filter((r) => !r.ok)) {
  console.log("");
  console.log(`—— ${row.suite} ——`);
  row.failedItems.forEach((line) => console.log(`  ${line}`));
  row.declaredFailures.forEach((line) => console.log(`  ${typeof line === "string" ? line : JSON.stringify(line)}`));
  if (row.tail) console.log(row.tail.split("\n").map((line) => `  | ${line}`).join("\n"));
}
process.exit(failed ? 1 : 0);
