// 运行时依赖统一入口：playwright（装在 npm 全局）与 Chrome 路径集中在这里，
// 优先从环境变量读，缺省用本机默认值。验收 / 探针脚本不要各自再写死这两条路径，
// 换机器时改环境变量、或只改这里一处，不用逐个文件去翻。
//
// 环境变量：
//   CANVAS_TOOL_NODE_GLOBAL —— npm 全局目录（默认 D:/nodejs/npm-global）
//   CANVAS_TOOL_CHROME       —— Chrome 可执行文件（默认 C:/Program Files/Google/Chrome/Application/chrome.exe）
import { createRequire } from "node:module";

const nodeGlobal = process.env.CANVAS_TOOL_NODE_GLOBAL || "D:/nodejs/npm-global";
const chromePath = process.env.CANVAS_TOOL_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";

// playwright 是装在 npm 全局的 CJS 包，不在项目 node_modules 里，所以用 createRequire
// 锚到全局目录去 require。锚点用「全局目录下的 package.json」这个路径：createRequire 只取
// 它的 dirname 来解析模块，文件本身是否存在不影响解析。
const require = createRequire(`${nodeGlobal}/package.json`);
const { chromium } = require("playwright");

// 统一 launch：executablePath 从这里注入，脚本不用各自写死 Chrome 路径。
export function launchChromium(options = {}) {
  return chromium.launch({ executablePath: chromePath, ...options });
}

export { chromium, chromePath };
