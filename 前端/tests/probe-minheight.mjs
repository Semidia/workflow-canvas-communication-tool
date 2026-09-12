// 弄清「缩到最小宽度时高度为何是 93 而不是 92」。
import { createRequire } from "node:module";
const require = createRequire("D:/nodejs/npm-global/package.json");
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
await page.goto(process.argv[2] || "http://127.0.0.1:4192");
await page.waitForLoadState("networkidle");
const out = await page.evaluate(() => {
  const n = activeCanvas().nodes.find((x) => x.id === "node-source");
  const el = nodeLayer.querySelector('[data-node-id="node-source"]');
  const probe = [];
  for (const w of [176, 140, 120]) {
    el.style.width = `${w}px`;
    n.w = w;
    probe.push({ 宽度: w, 内容自然高度: nodeContentHeight(n), 渲染高度: nodeRenderHeight(n), 样式minHeight: el.style.minHeight, 上下内边距: getComputedStyle(el).paddingTop + "/" + getComputedStyle(el).paddingBottom });
  }
  const label = el.querySelector(".node-label");
  return { 标签: n.label, 备注: n.note, 标记: n.marker, 标签高: label?.offsetHeight, 标签文本: label?.textContent, 标记元素: el.querySelector(".node-marker")?.offsetHeight, probe };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
