/* ============================================================================
   框选与选择集卷（拆分自原 app.js，内容逐字照搬，未改一行逻辑）

   这一份文件管「框选与多选」：
     1. 框选（marquee）——startMarquee / updateMarquee / finishMarquee / cancelMarquee（在空白处拖动框选多个节点）；
     2. 多选与选择集——toggleMultiSelect（Shift 点击增减多选）、clearMultiSelect（清空多选）、
        currentSelectionNodeIds（返回当前选择集：多选优先，否则单选，否则空）、resetSelection（重置全部选择与连线状态）。

   ⚠ 加载顺序：constants.js → storage.js → state.js → canvas.js → node.js → edge.js → inspector.js → ai-bridge.js → modules.js → **本文件** → app.js
   本文件**只声明函数、不在顶层执行任何语句**，所以放在 app.js 之前即可；
   它调用 canvas.js 的 activeCanvas、app.js 的 render / updateStatus / screenToWorld、state.js 里的选择与手势全局量等，
   都发生在被调用的那一刻，那时全部脚本都已加载完。
   saveSelectionAsModule（modules.js）会调用 currentSelectionNodeIds（本文件），同为事件时调用，无先后问题。
   ——反过来说：**往这里加顶层执行语句之前，先回来看这一段**。
   ============================================================================ */

/* ---- 框选（marquee） ---- */

/* ---- startMarquee（自 B 线移植） ---- */
function startMarquee(e) { const p = screenToWorld(e.clientX, e.clientY); marqueeDrag = { pointerId: e.pointerId, startWorld: p, currentWorld: p }; marquee.hidden = false; }
/* ---- updateMarquee（自 B 线移植） ---- */
function updateMarquee(e) { if (!marqueeDrag) return; const p = screenToWorld(e.clientX, e.clientY); marqueeDrag.currentWorld = p; const a = marqueeDrag.startWorld, b = p, left = Math.min(a.x, b.x), top = Math.min(a.y, b.y); marquee.style.left = `${left}px`; marquee.style.top = `${top}px`; marquee.style.width = `${Math.abs(b.x - a.x)}px`; marquee.style.height = `${Math.abs(b.y - a.y)}px`; }
/* ---- finishMarquee（自 B 线移植） ---- */
function finishMarquee() { if (!marqueeDrag) return; const a = marqueeDrag.startWorld, b = marqueeDrag.currentWorld, left = Math.min(a.x, b.x), top = Math.min(a.y, b.y), right = Math.max(a.x, b.x), bottom = Math.max(a.y, b.y); marqueeDrag = null; marquee.hidden = true; marquee.style.width = "0px"; marquee.style.height = "0px"; const selected = activeCanvas().nodes.filter((n) => n.x < right && n.x + n.w > left && n.y < bottom && n.y + n.h > top).map((n) => n.id); selectedNodeIds = new Set(selected); selectedNodeId = null; selectedEdgeId = null; connectorSourceId = null; resizeModeNodeId = null; render(); updateStatus(); }
/* ---- cancelMarquee（自 B 线移植） ---- */
function cancelMarquee() { if (!marqueeDrag) return; marqueeDrag = null; marquee.hidden = true; marquee.style.width = "0px"; marquee.style.height = "0px"; }

/* ---- 多选与选择集 ---- */

/* ---- toggleMultiSelect（自 B 线移植） ---- */
function toggleMultiSelect(id) { const set = new Set(selectedNodeIds); if (!set.size && selectedNodeId) set.add(selectedNodeId); set.has(id) ? set.delete(id) : set.add(id); selectedNodeIds = set; selectedNodeId = null; selectedEdgeId = null; connectorSourceId = null; resizeModeNodeId = null; render(); updateStatus(); }
/* ---- clearMultiSelect（自 B 线移植） ---- */
function clearMultiSelect() { selectedNodeIds = new Set(); render(); updateStatus(); }
/* ---- currentSelectionNodeIds（自 B 线移植） ---- */
function currentSelectionNodeIds() { if (selectedNodeIds.size) return [...selectedNodeIds]; if (selectedNodeId) return [selectedNodeId]; return []; }
/* ---- resetSelection（自 B 线移植） ---- */
function resetSelection() { selectedNodeId = null; resizeModeNodeId = null; selectedEdgeId = null; connectorSourceId = null; selectedNodeIds = new Set(); connecting = null; temporaryEdge.hidden = true; }
