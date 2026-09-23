/* ============================================================================
   AI 桥接卷（拆分自原 app.js，内容逐字照搬，未改一行逻辑）

   这一份文件管「把画布数据交给 AI / 剪贴板 / 磁盘」：
     1. 导出与右键菜单——sanitizeFileName / exportCanvases / exportWorkflow（导出工作流 JSON）、
        contextMenuEl / closeContextMenu / openContextMenu（右键菜单骨架）；
     2. AI 快照——snapshotHeader / nodeSnapshotText / edgeSnapshotText / buildCanvasSnapshotBody /
        buildCanvasSnapshot / buildWholeSnapshot / canvasPayloadForAI / statePayloadForAI、
        aiCanvasMenuItems / aiStateMenuItems / aiIoMenuItems（右键菜单里的 AI 复制项）；
     3. 剪贴板与磁盘——copyText / readClipboardText / extractJsonFromText / pasteCanvasJson、
        saveToDisk / loadFromDisk（保存到 / 从磁盘加载，走 /api/state）。

   ⚠ 加载顺序：constants.js → storage.js → state.js → canvas.js → node.js → edge.js → inspector.js → **本文件** → app.js
   本文件**只声明函数、不在顶层执行任何语句**，所以放在 app.js 之前即可；
   它调用 app.js 的 render / showToast、state.js 的 commit / pushHistory / normalizeState / commitPendingEdit、
   canvas.js 的 activeCanvas 等，都发生在被调用的那一刻，那时全部脚本都已加载完。
   注意：loadFromDisk 会在启动引导时每次都被调用一次（磁盘为权威，静默加载；磁盘无文件时才保留本地草稿），
   正因本文件先于 app.js 加载、函数声明已就位，那次调用才成立。
   ——反过来说：**往这里加顶层执行语句之前，先回来看这一段**。
   ============================================================================ */

/* ---- 导出与右键菜单骨架 ---- */

function sanitizeFileName(rawName) { const cleaned = String(rawName || "").replace(/[\\/:*?"<>|]/g, "_").replace(/[. ]+$/, "").trim(); return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(cleaned) ? `_${cleaned}` : cleaned || "工作流"; }
function exportCanvases(canvases, baseName, activeId) { const fileName = sanitizeFileName(baseName), payload = { version: 1, activeCanvasId: activeId, canvases }, blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `${fileName}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function exportWorkflow() { const canvas = activeCanvas(); if (state.canvases.length === 1) { exportCanvases([canvas], canvas.name || "工作流", canvas.id); showToast("当前画布已导出"); } else { exportCanvases(state.canvases, "工作流", state.activeCanvasId); showToast("全部画布已导出"); } }
function contextMenuEl() { let menu = document.querySelector(".context-menu"); if (!menu) { menu = document.createElement("div"); menu.className = "context-menu"; menu.hidden = true; document.body.append(menu); } return menu; }
function closeContextMenu() { const menu = document.querySelector(".context-menu"); if (menu) menu.hidden = true; }
function openContextMenu(x, y, items) { const menu = contextMenuEl(); menu.innerHTML = ""; items.forEach((item) => { if (!item) return; if (item.separator) { const sep = document.createElement("div"); sep.className = "context-menu-separator"; menu.append(sep); return; } const btn = document.createElement("button"); btn.type = "button"; btn.className = `context-menu-item${item.danger ? " is-danger" : ""}`; btn.textContent = item.label; btn.disabled = !!item.disabled; btn.addEventListener("click", () => { closeContextMenu(); item.action(); }); menu.append(btn); }); menu.hidden = false; menu.style.left = "0px"; menu.style.top = "0px"; const rect = menu.getBoundingClientRect(); menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 8))}px`; menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 8))}px`; }

/* ---- AI 快照与右键菜单项 ---- */

function snapshotHeader() { return `# 工作流画布数据说明（发给 AI 阅读）\n# 字段含义：\n#  - id：唯一标识，节点/连线/画布间引用时用；type：节点类型（rect=步骤·矩形, diamond=判断·菱形, circle=开始/结束·圆, document=材料·文档, triangle=提醒·三角, text=文字）\n#  - x/y：节点左上角画布坐标（px）；w/h：节点宽高（px）\n#  - label：名称；note：说明；marker：讨论标记（待讨论/已决定/有疑问/不采用）\n#  - condition：判断条件（仅 diamond）；exitCondition：退出循环条件（仅 diamond）\n#  - 循环：连线 loop=true 为循环回边（虚线）；循环结束标准必须在目标/相关【菱形判断节点】填写 exitCondition（退出循环条件）。快照里该边会带 结束条件=… ；为空表示 未填写。\n#  - 连线 edge：from/to=两端节点 id；branch=分支标签（是/否/未定）；fromSide/toSide=连接方向(top/right/bottom/left)；loop=循环回边(虚线)；width=粗细(thin/medium/thick)；color=颜色(十六进制)\n#  - view：缩放与平移 {zoom, panX, panY}`; }
function nodeSnapshotText(node) { const parts = [`节点「${node.label}」`, `id=${node.id}`, `类型=${NODE_TYPE_LABELS[node.type] || node.type}`, `位置=(${Math.round(node.x)},${Math.round(node.y)})`, `尺寸=${Math.round(node.w)}×${Math.round(node.h)}`]; if (node.marker) parts.push(`标记=${node.marker}`); if (node.condition) parts.push(`判断条件=${node.condition}`); if (node.type === "diamond") parts.push(`退出条件=${(node.exitCondition || "").trim() || "未填写"}`); if (node.note) parts.push(`说明=${node.note}`); return parts.join("  "); }
/* loop 回边的结束标准挂在目标（或从端）菱形的 exitCondition 上；快照必须把它带出来，否则 AI 看不出何时退出循环。 */
function loopExitConditionText(edge, canvas) { const to = canvas.nodes.find((n) => n.id === edge.to), from = canvas.nodes.find((n) => n.id === edge.from); const diamond = to?.type === "diamond" ? to : from?.type === "diamond" ? from : null; const exit = (diamond?.exitCondition || "").trim(); return { text: `结束条件=${exit || "未填写"}`, filled: !!exit, diamond }; }
function edgeSnapshotText(edge, canvas) { const from = canvas.nodes.find((n) => n.id === edge.from), to = canvas.nodes.find((n) => n.id === edge.to), parts = [`连线「${from?.label || edge.from}」→「${to?.label || edge.to}」`, `id=${edge.id}`]; if (edge.branch) parts.push(`分支=${edge.branch}`); if (edge.label) parts.push(`名称=${edge.label}`); if (edge.loop) { parts.push("循环回边"); parts.push(loopExitConditionText(edge, canvas).text); } if (edge.fromSide) parts.push(`起点方向=${edge.fromSide}`); if (edge.toSide) parts.push(`终点方向=${edge.toSide}`); if (edge.width) parts.push(`粗细=${edge.width}`); if (edge.color) parts.push(`颜色=${edge.color}`); return parts.join("  "); }
function buildCanvasSnapshotBody(canvas) { const lines = [`画布「${canvas.name}」 id=${canvas.id} 分类=${canvas.category || "未分类"} 节点=${canvas.nodes.length} 连线=${canvas.edges.length}`]; canvas.nodes.forEach((n) => lines.push(`  节点: ${nodeSnapshotText(n)}`)); canvas.edges.forEach((e) => lines.push(`  连线: ${edgeSnapshotText(e, canvas)}`)); return lines.join("\n"); }
function buildCanvasSnapshot(canvas) { return snapshotHeader() + "\n\n" + buildCanvasSnapshotBody(canvas); }
function buildWholeSnapshot() { const lines = [`共 ${state.canvases.length} 个画布，当前画布 id=${state.activeCanvasId}`]; state.canvases.forEach((c) => lines.push(buildCanvasSnapshotBody(c))); return snapshotHeader() + "\n\n" + lines.join("\n\n"); }
function canvasPayloadForAI(canvas) { return { version: 1, activeCanvasId: canvas.id, canvases: [canvas] }; }
function statePayloadForAI() { return { version: state.version || 1, activeCanvasId: state.activeCanvasId, canvases: state.canvases }; }
function aiCanvasMenuItems(canvas) { return [{ label: "复制画布文本快照（发给 AI）", action: () => copyText(buildCanvasSnapshot(canvas)) }, { label: "复制画布 JSON", action: () => copyText(JSON.stringify(canvasPayloadForAI(canvas), null, 2)) }]; }
function aiStateMenuItems() { return [{ label: "复制全部画布文本快照", action: () => copyText(buildWholeSnapshot()) }, { label: "复制全部画布 JSON", action: () => copyText(JSON.stringify(statePayloadForAI(), null, 2)) }]; }
function aiIoMenuItems() { return [{ label: "从剪贴板粘贴 JSON 回写", action: () => pasteCanvasJson() }, { label: "保存到磁盘（工作流导出/画布数据.json）", action: () => saveToDisk() }, { label: "从磁盘加载（覆盖当前）", action: () => loadFromDisk() }]; }

/* ---- 真相状态条（浏览器草稿 / 磁盘已同步 / 不一致） ---- */

function updateTruthStatus() {
  const syncMissing = lastDiskEtag === null;
  let truth = "draft", label = "浏览器草稿";
  if (diskOutOfSync) { truth = "stale"; label = "不一致"; }
  else if (syncMissing) { truth = "draft"; label = "浏览器草稿"; }
  else if (!isDirty && !autosaveTimer && !editing) { truth = "synced"; label = "磁盘已同步"; }
  else { truth = "draft"; label = "浏览器草稿"; }
  if (statusTruthDot) statusTruthDot.dataset.truth = truth;
  if (statusTruthText) statusTruthText.textContent = label;
  if (reloadDiskButton) reloadDiskButton.hidden = !diskOutOfSync;
}
function noteDiskAligned(meta) {
  if (meta && typeof meta.etag === "string") { lastDiskEtag = meta.etag; diskOutOfSync = false; }
  updateTruthStatus();
}
function noteDiskOutOfSync() {
  if (diskOutOfSync) return;
  diskOutOfSync = true;
  /* 不更新 lastDiskEtag：它记录「本页内容对齐的磁盘版本」，
     若改成磁盘新 ETag，下一轮轮询会误判一致并清掉「不一致」。 */
  updateTruthStatus();
  showToast("磁盘已更新，点击状态栏「磁盘已更新，点击重载」");
}
async function pollDiskState() {
  try {
    const resp = await fetch("/api/state?meta=1", { cache: "no-store" });
    if (resp.status === 404) { lastDiskEtag = null; diskOutOfSync = false; updateTruthStatus(); return; }
    if (!resp.ok) return;
    const data = await resp.json().catch(() => null);
    if (!data || data.ok !== true) return;
    if (lastDiskEtag === null) { lastDiskEtag = data.etag || null; updateTruthStatus(); return; }
    if (data.etag && data.etag !== lastDiskEtag) noteDiskOutOfSync();
    else if (data.etag === lastDiskEtag) { diskOutOfSync = false; updateTruthStatus(); }
  } catch { /* 离线/服务未起：保持当前真相状态 */ }
}
function startDiskPoll() { if (diskPollTimer) return; pollDiskState(); diskPollTimer = setInterval(pollDiskState, DISK_POLL_MS); }

/* ---- 剪贴板与磁盘读写 ---- */

async function copyText(text) { try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return showToast("已复制到剪贴板"); } } catch { } const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "position:fixed;left:-9999px;top:0"; document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch { } ta.remove(); showToast(ok ? "已复制到剪贴板" : "复制失败，请手动选择文本"); }
async function readClipboardText() { try { if (navigator.clipboard?.readText) return await navigator.clipboard.readText(); } catch { } showToast("无法读取剪贴板，请改用「导入」或允许浏览器剪贴板权限"); return ""; }
function extractJsonFromText(text) { const t = String(text || "").trim(); if (!t || t.length > 8 * 1024 * 1024) return null; try { return JSON.parse(t); } catch { } const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) { try { return JSON.parse(fence[1].trim()); } catch { } } const start = t.indexOf("{"), end = t.lastIndexOf("}"); if (start >= 0 && end > start) { try { return JSON.parse(t.slice(start, end + 1)); } catch { } } return null; }
async function pasteCanvasJson() { const text = await readClipboardText(); if (!text) return; const parsed = extractJsonFromText(text); if (!parsed || typeof parsed !== "object") return showToast("剪贴板里没有有效 JSON"); const single = Array.isArray(parsed.canvases) && parsed.canvases.length === 1 ? parsed.canvases[0] : (parsed.nodes && Array.isArray(parsed.nodes) ? parsed : null); if (single && single.nodes && Array.isArray(single.nodes)) { const normalized = normalizeState({ version: 1, activeCanvasId: single.id || "", canvases: [single] }), c = normalized.canvases[0]; if (!c) return showToast("JSON 里没有有效画布"); if (!state.canvases.some((x) => x.id === c.id) && state.canvases.length >= MAX_CANVASES) return showToast("画布数量已达上限（100），无法新增"); if (!window.confirm(`粘贴将用「${c.name}」替换或新增画布，是否继续？`)) return; commitPendingEdit(); pushHistory(); const existing = state.canvases.find((x) => x.id === c.id); if (existing) Object.assign(existing, c); else state.canvases.push(c); state.activeCanvasId = c.id; clearTransient(); render(); saveLocal("已粘贴画布 JSON"); showToast("已粘贴并回写画布"); return; } if (Array.isArray(parsed.canvases)) { if (!parsed.canvases.length) return showToast("JSON 里没有画布"); if (!window.confirm(`粘贴将整体替换当前所有画布（共 ${parsed.canvases.length} 个），是否继续？`)) return; commitPendingEdit(); pushHistory(); state = normalizeState(parsed); clearTransient(); render(); saveLocal("已粘贴 JSON"); showToast("已粘贴并回写画布"); return; } showToast("无法识别 JSON 结构：需要 canvases 数组或单画布(nodes+edges)"); }
async function saveToDisk() { try { const resp = await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(statePayloadForAI()) }), data = await resp.json().catch(() => ({})); if (!resp.ok || data.ok !== true) return showToast(`保存到磁盘失败：${data.error || resp.status}`); noteDiskAligned(data); showToast(`已保存到磁盘：${data.file || "工作流导出/画布数据.json"}`); } catch (err) { showToast(`保存到磁盘失败：${err.message || err}`); } }
/* 静默写磁盘：与 saveToDisk 同一条路，但不弹提示、失败不打断。
   自动保存（saveLocal）每次落盘后都会顺手调它，让正式磁盘与浏览器草稿保持一致，
   这样用户画了东西即使不点「保存到磁盘」也不会在下次打开时被磁盘旧数据盖掉。
   磁盘已被外部改过（diskOutOfSync）时先不静默覆盖，等用户点重载或显式保存。 */
async function persistToDiskSilent() { try { if (diskOutOfSync) return false; const resp = await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(statePayloadForAI()) }); const data = await resp.json().catch(() => ({})); if (resp.ok && data.ok === true) { noteDiskAligned(data); return true; } return false; } catch { return false; } }
async function loadFromDisk(opts = {}) { try { const resp = await fetch("/api/state", { cache: "no-store" }); if (resp.status === 404) { if (!opts.silent) showToast("磁盘尚无保存文件"); lastDiskEtag = null; diskOutOfSync = false; updateTruthStatus(); return false; } const data = await resp.json().catch(() => ({})); if (!resp.ok || data.ok !== true) { if (!opts.silent) showToast(`从磁盘加载失败：${data.error || resp.status}`); return false; } const parsed = data.state; if (!parsed || !Array.isArray(parsed.canvases) || !parsed.canvases.length) { if (!opts.silent) showToast("磁盘文件里没有有效画布"); return false; } if (!opts.silent && !window.confirm("从磁盘加载将覆盖当前所有画布，是否继续？")) return false; if (opts.silent && (isDirty || autosaveTimer || editing || drag || resizing || pan || userTouched || diskOutOfSync)) return false; commitPendingEdit(); if (!opts.silent) pushHistory(); state = normalizeState(parsed); clearTransient(); if (opts.silent) { history = []; future = []; } noteDiskAligned(data); render(); saveLocal("已从磁盘加载"); if (!opts.silent) showToast("已从磁盘加载"); return true; } catch (err) { if (!opts.silent) showToast(`从磁盘加载失败：${err.message || err}`); return false; } }
