// 测试目标地址解析：保证测试跑的一定是「本仓库这一份」前端代码。
//
// 背景（风险 R1）：这台机器上可能同时开着本仓库之外的旧副本画布服务（例如
// `D:\郄的工作流画布沟通工具\画布工具本体\后端\canvas_server.py` 的 4173 端口）。
// 旧副本页面同样是「设计沟通画布」，肉眼几乎分不出，但里面没有模块功能，
// 会让测试莫名其妙地失败、或让你双击后看不到新界面。
//
// 所以这里不靠端口号认人，靠内容认人。判定口径是「**页面自己声明的全部脚本**」：
//   1. 取回 `index.html`（本地的直接读文件，远端的是 HTTP 响应体）；
//   2. 按 **文档顺序** 抽出里面所有 `<script src="...">` 的 `src`；
//   3. 逐个取回脚本内容，算出「文件名 + 字节数 + sha256」的汇总指纹；
//   4. 两端指纹一致，才算「是这一份」。
//
// 为什么不是「只比对 app.js 的 sha256」（这是 2026-09-13 改的）：
// 前端本来把所有代码塞在单个 `app.js` 里，所以「app.js 一致」就等于「代码一致」。
// 一旦把 `app.js` 拆成十几个小文件（`state.js` / `canvas.js` / `node.js` …），
// 这个口径就失效了——拆完后 `index.html` 会引用一长串脚本，只看 `app.js`
// 等于只验了其中一小块，其余文件被换掉也发现不了。
// 改成「按 `index.html` 列出的全部脚本合并指纹」之后，**拆分前后都成立**：
// 拆分前只有一个 `app.js`，指纹退化回原来的口径；拆分后自动覆盖全部文件，
// 不需要为「拆没拆」写任何分支。
//
// 用法：const url = await resolveCanvasUrl(process.argv[2]);
//   - 传了 url：只校验这一个地址，不是这一份就报错退出（不静默换端口）；
//   - 没传 url：从 4173 起逐个探测到 4181，取第一个指纹一致的服务。

import fs from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const FRONTEND_DIR = new URL("../", import.meta.url);
const LOCAL_INDEX = new URL("index.html", FRONTEND_DIR);
const PROBE_PORTS = [4173, 4174, 4175, 4176, 4177, 4178, 4179, 4180, 4181];
const TIMEOUT_MS = 1500;

// 从一段 HTML 里按文档顺序抽出所有 `<script src="...">` 的 src。
// 只取相对路径：`http(s)://` 与协议相对地址（`//cdn...`）属于外链，不参与指纹，
// 否则指纹会随外网可用性抖动。
function extractScriptSrcs(html) {
  const srcs = [];
  const tagRe = /<script\b[^>]*>/gi;
  let tag;
  while ((tag = tagRe.exec(html)) !== null) {
    const srcMatch = tag[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!srcMatch) continue;
    const src = srcMatch[1].trim();
    if (/^(?:[a-z]+:)?\/\//i.test(src) || src.startsWith("data:")) continue;
    srcs.push(src);
  }
  return srcs;
}

// 把「一串（文件名, 内容）」算成一个指纹串。文件名进指纹是刻意的：
// 光比对内容的话，「两个文件对调」或「少了一个文件」这类变动可能被漏掉。
function fingerprintOf(entries) {
  const hasher = createHash("sha256");
  const parts = [];
  for (const { name, bytes } of entries) {
    const sha = createHash("sha256").update(bytes).digest("hex");
    hasher.update(`${name}\u0000${bytes.length}\u0000${sha}\n`);
    parts.push(`${name}(${bytes.length}B/${sha.slice(0, 12)})`);
  }
  return { sha256: hasher.digest("hex"), parts };
}

// 本仓库这一份：index.html + 它列出的每个脚本，全部从磁盘读。
export function localBundleInfo() {
  const indexPath = fileURLToPath(LOCAL_INDEX);
  const html = fs.readFileSync(LOCAL_INDEX, "utf8");
  const srcs = extractScriptSrcs(html);
  const entries = [{ name: "index.html", bytes: Buffer.from(html, "utf8") }];
  for (const src of srcs) {
    // 去掉可能的查询串（本仓库不需要，但免得将来加了缓存戳就崩）
    const clean = src.split("?")[0].replace(/^\.\//, "");
    entries.push({ name: clean, bytes: fs.readFileSync(new URL(clean, FRONTEND_DIR)) });
  }
  const { sha256, parts } = fingerprintOf(entries);
  return { indexPath, scripts: srcs, sha256, parts, totalBytes: entries.reduce((a, e) => a + e.bytes.length, 0) };
}

// 远端这一份：同样从它自己的 index.html 出发，按它自己声明的脚本清单取回。
async function fetchServedBundle(baseUrl) {
  const indexRes = await fetch(`${baseUrl}/index.html`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!indexRes.ok) throw new Error(`HTTP ${indexRes.status}（index.html）`);
  const html = Buffer.from(await indexRes.arrayBuffer()).toString("utf8");

  const entries = [{ name: "index.html", bytes: Buffer.from(html, "utf8") }];
  for (const src of extractScriptSrcs(html)) {
    const clean = src.split("?")[0].replace(/^\.\//, "");
    const res = await fetch(`${baseUrl}/${clean}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}（${clean}）`);
    entries.push({ name: clean, bytes: Buffer.from(await res.arrayBuffer()) });
  }
  const { sha256, parts } = fingerprintOf(entries);
  return { sha256, parts, totalBytes: entries.reduce((a, e) => a + e.bytes.length, 0) };
}

async function probe(baseUrl) {
  try {
    const served = await fetchServedBundle(baseUrl);
    return { baseUrl, ...served, matches: served.sha256 === localBundleInfo().sha256 };
  } catch {
    return null;
  }
}

function describeMismatch(baseUrl, found, local) {
  return (
    `指定的地址不是本仓库这一份前端代码，已中止测试：${baseUrl}\n` +
    `  该服务上的脚本指纹：sha256 ${found.sha256.slice(0, 12)} / 共 ${found.totalBytes} 字节\n` +
    `      ${found.parts.join("、")}\n` +
    `  本仓库的脚本指纹：sha256 ${local.sha256.slice(0, 12)} / 共 ${local.totalBytes} 字节\n` +
    `      ${local.parts.join("、")}\n` +
    `  本仓库文件：${local.indexPath}\n` +
    `多半是另一份旧副本占着这个端口。请换端口启动本仓库前端，再把地址作为第一个参数传进来。`
  );
}

export async function resolveCanvasUrl(explicitUrl) {
  const local = localBundleInfo();

  if (explicitUrl) {
    const baseUrl = explicitUrl.replace(/\/index\.html.*$/, "").replace(/\/$/, "");
    const found = await probe(baseUrl);
    if (!found) {
      throw new Error(
        `指定的画布服务连不上：${baseUrl}\n` +
          `请先启动服务（双击「启动画布工具.bat」，或在「前端」目录执行 python -m http.server <端口> --bind 127.0.0.1）。`
      );
    }
    if (!found.matches) throw new Error(describeMismatch(baseUrl, found, local));
    console.log(
      `[目标] ${baseUrl}（已校验与本仓库一致：${local.scripts.length} 个脚本、共 ${local.totalBytes} 字节，指纹 ${local.sha256.slice(0, 12)}）`
    );
    return `${baseUrl}/index.html`;
  }

  const tried = [];
  for (const port of PROBE_PORTS) {
    const baseUrl = `http://127.0.0.1:${port}`;
    const found = await probe(baseUrl);
    if (!found) {
      tried.push(`${port}(无服务)`);
      continue;
    }
    if (found.matches) {
      console.log(
        `[目标] ${baseUrl}（自动探测命中，${local.scripts.length} 个脚本、共 ${local.totalBytes} 字节，已校验一致）`
      );
      return `${baseUrl}/index.html`;
    }
    tried.push(`${port}(是别的一份：指纹 ${found.sha256.slice(0, 12)}、${found.totalBytes} 字节)`);
  }

  throw new Error(
    `没找到本仓库这一份前端服务。已探测：${tried.join("、")}\n` +
      `本仓库应为 ${local.scripts.length} 个脚本、共 ${local.totalBytes} 字节（${local.indexPath}）。\n` +
      `请双击「启动画布工具.bat」，或在「前端」目录执行 python -m http.server 4174 --bind 127.0.0.1 后重试。`
  );
}
