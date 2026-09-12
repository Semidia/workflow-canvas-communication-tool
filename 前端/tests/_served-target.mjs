// 测试目标地址解析：保证测试跑的一定是「本仓库这一份」前端代码。
//
// 背景（风险 R1）：这台机器上可能同时开着本仓库之外的旧副本画布服务（例如
// `D:\郄的工作流画布沟通工具\画布工具本体\后端\canvas_server.py` 的 4173 端口）。
// 旧副本页面同样是「设计沟通画布」，肉眼几乎分不出，但里面没有模块功能，
// 会让测试莫名其妙地失败、或让你双击后看不到新界面。
//
// 所以这里不靠端口号认人，靠内容认人：把候选端口上的 `/app.js` 取回来，
// 与本目录上一级的 `app.js` 做 SHA-256 比对，一致才认为「是这一份」。
//
// 用法：const url = await resolveCanvasUrl(process.argv[2]);
//   - 传了 url：只校验这一个地址，不是这一份就报错退出（不静默换端口）；
//   - 没传 url：从 4173 起逐个探测到 4181，取第一个代码一致的服务。

import fs from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const LOCAL_APP_JS = new URL("../app.js", import.meta.url);
const PROBE_PORTS = [4173, 4174, 4175, 4176, 4177, 4178, 4179, 4180, 4181];
const TIMEOUT_MS = 1500;

export function localAppJsInfo() {
  const bytes = fs.readFileSync(LOCAL_APP_JS);
  return {
    path: fileURLToPath(LOCAL_APP_JS),
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function fetchServedAppJs(baseUrl) {
  const res = await fetch(`${baseUrl}/app.js`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function probe(baseUrl) {
  try {
    const served = await fetchServedAppJs(baseUrl);
    return { baseUrl, ...served, matches: served.sha256 === localAppJsInfo().sha256 };
  } catch {
    return null;
  }
}

export async function resolveCanvasUrl(explicitUrl) {
  const local = localAppJsInfo();

  if (explicitUrl) {
    const baseUrl = explicitUrl.replace(/\/index\.html.*$/, "").replace(/\/$/, "");
    const found = await probe(baseUrl);
    if (!found) {
      throw new Error(
        `指定的画布服务连不上：${baseUrl}\n` +
          `请先启动服务（双击「启动画布工具.bat」，或在「前端」目录执行 python -m http.server <端口> --bind 127.0.0.1）。`
      );
    }
    if (!found.matches) {
      throw new Error(
        `指定的地址不是本仓库这一份前端代码，已中止测试：${baseUrl}\n` +
          `  该服务上的 app.js：${found.size} 字节 / sha256 ${found.sha256.slice(0, 12)}\n` +
          `  本仓库的 app.js：${local.size} 字节 / sha256 ${local.sha256.slice(0, 12)}\n` +
          `  本仓库文件：${local.path}\n` +
          `多半是另一份旧副本占着这个端口。请换端口启动本仓库前端，再把地址作为第一个参数传进来。`
      );
    }
    console.log(`[目标] ${baseUrl}（已校验 app.js 与本仓库一致：${local.size} 字节）`);
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
      console.log(`[目标] ${baseUrl}（自动探测命中，app.js ${local.size} 字节，已校验一致）`);
      return `${baseUrl}/index.html`;
    }
    tried.push(`${port}(是别的一份：app.js ${found.size} 字节)`);
  }

  throw new Error(
    `没找到本仓库这一份前端服务。已探测：${tried.join("、")}\n` +
      `本仓库的 app.js 应为 ${local.size} 字节（${local.path}）。\n` +
      `请双击「启动画布工具.bat」，或在「前端」目录执行 python -m http.server 4174 --bind 127.0.0.1 后重试。`
  );
}
