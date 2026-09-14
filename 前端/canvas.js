/* ============================================================================
   画布卷（拆分自原 app.js，内容逐字照搬，未改一行逻辑）

   这一份文件管「一张画布以外的东西」：
     1. 多画布——新建、关闭、改名、分类、标签页渲染；
     2. 视图变换与缩放平移——平移夹取、缩放、滚轮步进、恢复 100%；
     3. 状态条——底部「选择」那一行文字与提示；
     4. 视口指针捕获的释放。

   ⚠ 加载顺序：constants.js → storage.js → state.js → **本文件** → … → app.js
   本文件**只声明函数、不在顶层执行任何语句**，所以放在 app.js 之前即可；
   它调用 state.js 的 state / commit、storage.js 的 markDirty、app.js 的 render 等，
   都发生在被调用的那一刻，那时全部脚本都已加载完，按名字都能找到。
   ——反过来说：**往这里加顶层执行语句之前，先回来看这一段**。
   ============================================================================ */

/* ---- 画布标签页 ---- */

function renderTabs() { canvasTabs.innerHTML = ""; const groups = [], byCategory = new Map(); state.canvases.forEach((canvas) => { const key = canvas.category || ""; if (!byCategory.has(key)) { byCategory.set(key, []); groups.push(key); } byCategory.get(key).push(canvas); }); const ordered = groups.filter((k) => k !== "").concat(groups.includes("") ? [""] : []); const appendTab = (canvas) => { const isActive = canvas.id === state.activeCanvasId; const tab = document.createElement("div"); tab.className = `canvas-tab${isActive ? " is-active" : ""}`; tab.dataset.canvasId = canvas.id; tab.draggable = true; tab.id = `tab-${canvas.id}`; tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", String(isActive)); tab.setAttribute("aria-controls", "viewport"); tab.setAttribute("aria-label", canvas.category ? `${canvas.name}（分类：${canvas.category}）` : canvas.name); tab.tabIndex = isActive ? 0 : -1; tab.innerHTML = `<span class="tab-label"></span><button class="tab-rename" title="给这个画布改名" aria-label="给这个画布改名" tabindex="-1">✎</button><button class="tab-close" title="关闭画布" aria-label="关闭画布" tabindex="-1">×</button>`; tab.querySelector(".tab-label").textContent = canvas.name; canvasTabs.append(tab); }; ordered.forEach((category) => { const chip = document.createElement("div"); chip.className = "canvas-category"; chip.dataset.category = category; chip.textContent = category || "未分类"; chip.setAttribute("role", "presentation"); chip.setAttribute("aria-hidden", "true"); canvasTabs.append(chip); byCategory.get(category).forEach(appendTab); }); const activeTab = canvasTabs.querySelector(".canvas-tab.is-active"); viewport.setAttribute("aria-labelledby", activeTab ? activeTab.id : ""); const active = activeCanvas(); document.title = active?.name ? `${active.name} · 设计沟通画布｜本地编辑` : "设计沟通画布｜本地编辑"; }

/* ---- 多画布：新建 / 关闭 / 改名 / 分类 ---- */

function defaultCanvasName() { let n = state.canvases.length + 1, name = `工作流 ${n}`; while (state.canvases.some((c) => c.name === name)) { n++; name = `工作流 ${n}`; } return name; }
function createCanvas() { if (moduleEditing) return showToast(`模块「${moduleEditing.name}」正在编辑中，请先「保存回模块」或「取消编辑」`); if (state.canvases.length >= MAX_CANVASES) return showToast("画布数量已达上限（100），无法继续新建"); const name = window.prompt("请输入新画布名称", defaultCanvasName()); if (!name?.trim()) return; const trimmed = name.trim().slice(0, 80); if (state.canvases.some((c) => c.name === trimmed)) return showToast(`已存在同名画布“${trimmed}”`); commitPendingEdit(); commit(() => { const c = { id: createId("canvas"), name: trimmed, category: "", nodes: [], edges: [], view: { zoom: 1, panX: 0, panY: 0 } }; state.canvases.push(c); state.activeCanvasId = c.id; clearTransient(); }, "新画布已创建"); }
function clearCanvas() { const c = activeCanvas(); if (moduleEditing) return showToast(`模块「${moduleEditing.name}」正在编辑中，请先「保存回模块」或「取消编辑」`); if (!c.nodes.length && !c.edges.length) return showToast("当前画布已经是空的，无需清空"); if (!window.confirm(`清空当前画布“${c.name}”上的所有节点和连线？可通过撤销找回。`)) return; commitPendingEdit(); commit(() => { c.nodes = []; c.edges = []; clearTransient(); }, "画布已清空"); }
function closeCanvas(id) { if (state.canvases.length === 1) return showToast("至少保留一个画布"); if (moduleEditing && state.activeCanvasId === id) return showToast(`模块「${moduleEditing.name}」正在这个画布上编辑，请先「保存回模块」或「取消编辑」`); const c = state.canvases.find((x) => x.id === id); if (!c || !window.confirm(`关闭“${c.name}”？该画布将从本机保存中移除，可通过撤销找回。`)) return; commitPendingEdit(); commit(() => { const closingIndex = state.canvases.findIndex((x) => x.id === id); state.canvases = state.canvases.filter((x) => x.id !== id); if (state.activeCanvasId === id) state.activeCanvasId = (state.canvases[closingIndex] || state.canvases[closingIndex - 1] || state.canvases[0]).id; clearTransient(); }, "画布已关闭"); document.getElementById(`tab-${state.activeCanvasId}`)?.focus(); }
function renameCanvas(id) { const c = state.canvases.find((x) => x.id === id), name = c && window.prompt("请输入画布名称", c.name); if (!c || !name?.trim() || name.trim() === c.name) return; const trimmed = name.trim().slice(0, 80); if (state.canvases.some((x) => x.id !== id && x.name === trimmed)) return showToast(`已存在同名画布“${trimmed}”`); commit(() => { c.name = trimmed; }, "画布名称已更新"); document.getElementById(`tab-${id}`)?.focus(); }
function setCategoryCanvas(id) { const c = state.canvases.find((x) => x.id === id); if (!c) return; const current = c.category || "", next = window.prompt("请输入分类名称（留空 = 未分类）", current); if (next === null) return; const trimmed = next.trim().slice(0, 40); if (trimmed === current) return; commit(() => { c.category = trimmed; }, trimmed ? "画布已分类" : "已取消分类"); document.getElementById(`tab-${id}`)?.focus(); }
function dragCategoryCanvas(id, category) { const c = state.canvases.find((x) => x.id === id); if (!c || (c.category || "") === category) return; commit(() => { c.category = category; }, category ? "画布已拖入分类" : "画布已拖回未分类"); }
function dropCategoryKeyFromElement(target) { const chip = target?.closest?.(".canvas-category"); if (chip) return chip.dataset.category || ""; const tab = target?.closest?.(".canvas-tab"); if (tab) { const c = state.canvases.find((x) => x.id === tab.dataset.canvasId); return c ? (c.category || "") : null; } return null; }

/* ---- 视图变换与缩放平移 ---- */

function renderTransform() { const view = activeCanvas().view || { zoom: 1, panX: 0, panY: 0 }; clampPan(view); surface.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`; const pct = Math.round(view.zoom * 100); zoomValue.textContent = `${pct}%`; zoomValue.setAttribute("aria-label", `缩放 ${pct}%，点击恢复 100%`); }
function clampPan(v) { const cw = viewport.clientWidth, ch = viewport.clientHeight, sw = 2400 * v.zoom, sh = 1500 * v.zoom; v.panX = sw <= cw ? (cw - sw) / 2 : clamp(v.panX, cw - sw, 0); v.panY = sh <= ch ? (ch - sh) / 2 : clamp(v.panY, ch - sh, 0); }
function changeZoom(next, cx = viewport.clientWidth / 2, cy = viewport.clientHeight / 2) { const c = activeCanvas(), v = c.view || { zoom: 1, panX: 0, panY: 0 }, before = { x: (cx - v.panX) / v.zoom, y: (cy - v.panY) / v.zoom }; v.zoom = clampZoom(next); v.panX = cx - before.x * v.zoom; v.panY = cy - before.y * v.zoom; clampPan(v); c.view = v; renderTransform(); markDirty(); }
function stepZoom(direction) { const v = activeCanvas().view || { zoom: 1 }, isBelowFineThreshold = v.zoom < ZOOM_FINE_THRESHOLD - 1e-9; const delta = direction === "in" ? ZOOM_CLICK_IN : isBelowFineThreshold ? -ZOOM_CLICK_OUT_FINE : -ZOOM_CLICK_OUT_COARSE; changeZoom(v.zoom + delta); }
function resetView() { const c = activeCanvas(); c.view = { zoom: 1, panX: 0, panY: 0 }; renderTransform(); markDirty(); }
function wheelZoomStep(e) { let deltaY = e.deltaY; if (e.deltaMode === 1) deltaY *= 16; else if (e.deltaMode === 2) deltaY *= 800; const v = activeCanvas().view || { zoom: 1 }, base = v.zoom < ZOOM_FINE_THRESHOLD ? ZOOM_CLICK_OUT_FINE : ZOOM_CLICK_OUT_COARSE, magnitude = clamp(Math.abs(deltaY) / 120, 0.2, 4); return (deltaY > 0 ? -base : base) * magnitude; }

/* ---- 状态条 ---- */

function updateStatus() { if (selectedNodeIds.size) { selectionStatus.textContent = `已框选 ${selectedNodeIds.size} 个节点`; selectionHint.hidden = true; return; } const node = activeCanvas().nodes.find((n) => n.id === selectedNodeId), edge = selectedEdgeId ? activeCanvas().edges.find((e) => e.id === selectedEdgeId) : null; selectionStatus.textContent = node ? `已选择：${node.label}` : edge ? ((edge.branch || edge.label) ? `已选择连线：${edge.branch || edge.label}` : "已选择：连线") : "未选择节点"; selectionHint.hidden = !node; if (node) selectionHint.textContent = `${node.label} · 点节点右上角的小图标，再拖四周的小方块改大小；拖边上小圆点来连线`; }

/* ---- 视口指针捕获的释放（R10 修②：捕获从不释放） ---- */

function releaseViewportCapture(pointerId) { try { if (pointerId != null && viewport.hasPointerCapture?.(pointerId)) viewport.releasePointerCapture(pointerId); } catch { /* 捕获已随指针结束自动释放，忽略 */ } }
