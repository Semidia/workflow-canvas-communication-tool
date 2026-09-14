/* ============================================================================
   核心装配卷（拆分自原 app.js，内容逐字照搬，未改一行逻辑）

   这一份文件只留「装配」函数——被各卷反复调用、负责把画面拼起来的中枢：
     clearTransient（清空一切进行中的手势与选择）、render（整体渲染）、showToast（气泡提示）、
     setTool（切换工具）、screenToWorld（屏幕坐标转世界坐标）、undo / redo（撤销重做）。

   ⚠ 加载顺序：constants.js → storage.js → state.js → canvas.js → node.js → edge.js → inspector.js
     → ai-bridge.js → modules.js → marquee.js → **本文件** → events.js（事件绑定与启动引导，最后）
   本文件**只声明函数、不在顶层执行任何语句**。
   它调用各卷的 renderTabs / renderNodes / renderEdges / renderTransform / renderInspector /
   updateStatus / renderModuleEditBar / clearModuleEdit / removeResizeHandles 等，都发生在运行时。
   ——反过来说：**往这里加顶层执行语句之前，先回来看这一段**。
   ============================================================================ */

function clearTransient() { editing = null; inspectorEdit = null; drag = null; resizing = null; pan = null; pinch = null; connecting = null; reattaching = null; connectorSourceId = null; resizeModeNodeId = null; selectedEdgeId = null; selectedNodeId = null; composing = false; composingJustEnded = false; finishEditOnCompositionEnd = false; refocusNodeAfterEdit = false; temporaryEdge.setAttribute("hidden", ""); viewport.classList.remove("is-panning"); selectedNodeIds = new Set(); clearModuleEdit(); removeResizeHandles(); }
function render() { renderTabs(); renderNodes(); renderEdges(); renderTransform(); renderInspector(); updateStatus(); renderModuleEditBar(); }
function showToast(message) { clearTimeout(toastTimer); toast.textContent = message; toast.classList.add("is-visible"); toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 1900); }
function setTool(tool) { const hadConnector = !!(connectorSourceId || connecting); if (editing) commitPendingEdit(); activeTool = tool; connectorSourceId = null; connecting = null; drag = null; resizing = null; pan = null; resizeModeNodeId = null; temporaryEdge.setAttribute("hidden", ""); viewport.classList.remove("is-panning"); viewport.classList.toggle("is-connector", tool === "connector"); removeResizeHandles(); renderEdgeHandles(); document.querySelectorAll(".tool-button").forEach((b) => b.classList.toggle("is-active", b.dataset.tool === tool)); if (hadConnector) syncSelectionUI(); showToast(tool === "select" ? "选择工具" : tool === "connector" ? "连线工具：点两个节点，把它们连起来" : tool === "marquee" ? "选多个：在空白处按住拖动，框住多个节点" : "在画布空白处点一下，放一个节点"); }
function screenToWorld(x, y) { const r = viewport.getBoundingClientRect(), view = activeCanvas().view || { zoom: 1, panX: 0, panY: 0 }; return { x: (x - r.left - view.panX) / view.zoom, y: (y - r.top - view.panY) / view.zoom }; }
function undo() { if (!history.length) return showToast("没有可撤销的操作"); const liveViews = new Map(state.canvases.map((c) => [c.id, c.view || { zoom: 1, panX: 0, panY: 0 }])), keepActiveId = state.activeCanvasId; future.push(snapshot()); state = normalizeState(history.pop().snap); state.canvases.forEach((c) => { const v = liveViews.get(c.id); if (v) c.view = { zoom: v.zoom, panX: v.panX, panY: v.panY }; }); if (state.canvases.some((c) => c.id === keepActiveId)) state.activeCanvasId = keepActiveId; clearTransient(); lastArrowMoveAt = 0; render(); viewport.focus({ preventScroll: true }); saveLocal("已撤销"); }
function redo() { if (!future.length) return showToast("没有可重做的操作"); const liveViews = new Map(state.canvases.map((c) => [c.id, c.view || { zoom: 1, panX: 0, panY: 0 }])), keepActiveId = state.activeCanvasId; history.push({ snap: snapshot(), token: ++historyToken, future: future.slice() }); state = normalizeState(future.pop()); state.canvases.forEach((c) => { const v = liveViews.get(c.id); if (v) c.view = { zoom: v.zoom, panX: v.panX, panY: v.panY }; }); if (state.canvases.some((c) => c.id === keepActiveId)) state.activeCanvasId = keepActiveId; clearTransient(); lastArrowMoveAt = 0; render(); viewport.focus({ preventScroll: true }); saveLocal("已重做"); }
