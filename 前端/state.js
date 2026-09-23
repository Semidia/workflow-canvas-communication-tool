/* ============================================================================
   状态层（拆分自原 app.js 的第 37–39、41、45–51、54–58、83 行，内容逐字照搬）

   这一份文件是「会变的东西」：
     1. 全局可变状态——当前文档 state、选中项、拖拽/连线/缩放手势、撤销重做栈等，
        所有全局 `let` 集中在这里声明，只此一处，别处只读只写不再声明；
     2. 状态的形状——建 id、默认文档、节点与画布的规范化（把外部 JSON 收拾成可信形状）；
     3. 当前画布与撤销重做栈；
     4. 写入门面 commit（记一笔历史 → 改 → 重画 → 存本机）。

   ⚠ 加载顺序：constants.js → storage.js → **本文件** → … → app.js
   本文件顶部的 `let state = loadState()` 在**它自己被求值时**就会用到 storage.js 的
   loadState；那一刻本文件自身的函数声明已经全部提升，所以 loadState 内部反过来调
   defaultState / normalizeState 也是通的。这条依赖是双向的、只靠加载顺序成立，
   **改动本文件顶部的初始化顺序、或往 storage.js 加顶层执行语句之前，先回来看这一段。**

   浏览器把顶层 `let`/`const` 放在**全局词法环境**里，多个 classic script 共用同一个环境，
   所以搬到本文件的 `state` / `history` 等，仍然能被 app.js 与页面里的 page.evaluate 直接
   按名字读到（module-edit-lifecycle 验收就靠 `history !== window.history` 认这条栈）。
   也正因如此：**这些名字不能在任何别的文件里再声明一次**，否则整页报重复声明。
   ============================================================================ */

let stateRev = 0, lastSeenRemoteRev = 0, draftUnreadable = false, state = loadState(), activeTool = "select", selectedNodeId = null, resizeModeNodeId = null, selectedEdgeId = null, connectorSourceId = null, history = [], future = [], drag = null, resizing = null, pan = null, connecting = null, reattaching = null, editing = null, inspectorEdit = null, toastTimer, autosaveTimer = null, isDirty = false;
let dragCategorySourceId = null, composing = false, composingJustEnded = false, finishEditOnCompositionEnd = false, refocusNodeAfterEdit = false, clipboardNode = null, lastArrowMoveAt = 0, historyToken = 0, userTouched = false, pinch = null;
let selectedNodeIds = new Set(), marqueeDrag = null, moduleLibrary = loadModules(), modulePlaceOffset = 0, lastModalTrigger = null, moduleEditing = null;
/* 磁盘真相：lastDiskEtag 是本页最近一次与磁盘对齐时的 ETag；
   diskOutOfSync 为 true 表示磁盘已被外部改过、等待用户点「重载」，绝不静默覆盖草稿。 */
let lastDiskEtag = null, diskOutOfSync = false, diskPollTimer = null, autoReloadDiskTimer = null, lastLoopWarningShown = false;

/* 连线第一下按在哪条线上（R10 修①的配套状态；读写见 app.js 的 edgeGroup pointerdown） */
let edgePress = null;

/* ---- 状态的形状：建 id / 默认文档 / 规范化 ---- */

function createId(prefix) { if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`; createId._c = (createId._c || 0) + 1; return `${prefix}-${Date.now()}-${createId._c}-${Math.random().toString(16).slice(2)}`; }
function defaultState() { return { version: 1, activeCanvasId: "canvas-main", canvases: [{ id: "canvas-main", name: "产品逻辑草图", category: "", nodes: [{ id: "node-source", type: "document", x: 50, y: 300, w: 176, h: 92, label: "收集材料", note: "把已有信息放到一起", marker: "已决定" }, { id: "node-analysis", type: "diamond", x: 280, y: 282, w: 112, h: 112, label: "形成判断", note: "这里需要讨论依据", marker: "待讨论" }, { id: "node-review", type: "rect", x: 470, y: 300, w: 176, h: 92, label: "共同核对", note: "人与 AI 一起检查", marker: "有疑问" }, { id: "node-publish", type: "document", x: 680, y: 300, w: 176, h: 92, label: "整理结论", note: "形成下一步沟通材料", marker: "待讨论" }], edges: [{ id: "edge-1", from: "node-source", to: "node-analysis" }, { id: "edge-2", from: "node-analysis", to: "node-review" }, { id: "edge-3", from: "node-review", to: "node-publish" }], view: { zoom: 1, panX: 0, panY: 0 } }] }; }
function clampZoom(value) { return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(value) ? value : 1)); }
function minSizeForType(type) { return Object.hasOwn(NODE_MIN_SIZES, type) ? NODE_MIN_SIZES[type] : NODE_MIN_SIZES.rect; }
function normalizeNode(node) { if (!node || typeof node.id !== "string") return null; if (!/^[\w-]{1,64}$/.test(node.id)) node.id = createId("node"); const type = Object.hasOwn(NODE_DEFAULTS, node.type) ? node.type : "rect", d = NODE_DEFAULTS[type], minimum = minSizeForType(type), fallbackW = type === "diamond" || type === "circle" ? 112 : type === "text" ? 150 : type === "triangle" ? 126 : 176, fallbackH = type === "diamond" || type === "circle" ? 112 : type === "text" ? 48 : type === "triangle" ? 112 : 92, marker = typeof node.marker === "string" && DISCUSSION_MARKERS.includes(node.marker.trim()) ? node.marker.trim() : "待讨论", num = (v, fb) => { const n = typeof v === "string" ? Number(v) : v; return Number.isFinite(n) ? n : fb; }; let w = clamp(Math.max(minimum.w, num(node.w, fallbackW)), minimum.w, 2400), h = clamp(Math.max(minimum.h, num(node.h, fallbackH)), minimum.h, 1500); if (type === "circle") { const dim = Math.min(Math.max(w, h), 1490); w = dim; h = dim; } const x = clamp(num(node.x, 240), 10, Math.max(10, 2400 - w)), y = clamp(num(node.y, 240), 10, Math.max(10, 1500 - h)); return { id: node.id, type, x, y, w, h, label: typeof node.label === "string" ? (node.label.trim() || "未命名节点").slice(0, 80) : d.label, note: typeof node.note === "string" ? node.note.trim().slice(0, 240) : d.note, marker, condition: typeof node.condition === "string" ? node.condition.trim().slice(0, 80) : "", exitCondition: typeof node.exitCondition === "string" ? node.exitCondition.trim().slice(0, 80) : "" }; }
function normalizeState(input) { if (input && typeof input === "object") input = migrateLegacyEdgeBranches(input); if (!input || !Array.isArray(input.canvases) || !input.canvases.length) return defaultState(); const seenIds = new Set(), seenNames = new Set(), canvases = []; for (let i = 0; i < input.canvases.length && i < MAX_CANVASES; i++) { const canvas = input.canvases[i]; if (!canvas || typeof canvas !== "object") continue; let id = typeof canvas.id === "string" && /^[\w-]{1,64}$/.test(canvas.id) ? canvas.id : createId("canvas"); if (seenIds.has(id)) id = createId("canvas"); seenIds.add(id); const idMap = new Map(), nodes = Array.isArray(canvas.nodes) ? (() => { const seenNodeIds = new Set(), out = []; for (const raw of canvas.nodes) { if (out.length >= MAX_NODES_PER_CANVAS) break; const oldId = raw && typeof raw.id === "string" ? raw.id : null; const n = normalizeNode(raw); if (!n) continue; if (seenNodeIds.has(n.id)) n.id = createId("node"); seenNodeIds.add(n.id); if (oldId && oldId !== n.id) idMap.set(oldId, n.id); out.push(n); } return out; })() : []; const nodeIds = new Set(nodes.map((n) => n.id)), seenEdgeIds = new Set(), seenPairs = new Set(); const edges = Array.isArray(canvas.edges) ? canvas.edges.filter((e) => { if (e && typeof e.from === "string") e.from = idMap.get(e.from) || e.from; if (e && typeof e.to === "string") e.to = idMap.get(e.to) || e.to; const key = e && typeof e.from === "string" && typeof e.to === "string" ? JSON.stringify([e.from, e.to]) : null; if (!key || e.from === e.to || !nodeIds.has(e.from) || !nodeIds.has(e.to) || seenPairs.has(key)) return false; seenPairs.add(key); return true; }).slice(0, MAX_EDGES_PER_CANVAS).map((e) => { let eid = typeof e.id === "string" && /^[\w-]{1,64}$/.test(e.id) ? e.id : createId("edge"); if (seenEdgeIds.has(eid)) eid = createId("edge"); seenEdgeIds.add(eid); return { id: eid, from: e.from, to: e.to, ...normalizeEdgeFields(e) }; }) : []; canvases.push({ id, name: (() => { let base = (typeof canvas.name === "string" && canvas.name.trim() ? canvas.name.trim() : `工作流 ${i + 1}`).slice(0, 80), name = base; for (let k = 2; seenNames.has(name); k++) name = `${base} (${k})`; seenNames.add(name); return name; })(), category: typeof canvas.category === "string" ? canvas.category.trim().slice(0, 40) : "", nodes, edges, view: { zoom: clampZoom(canvas.view?.zoom), panX: clamp(Number.isFinite(canvas.view?.panX) ? canvas.view.panX : 0, -2400, 2400), panY: clamp(Number.isFinite(canvas.view?.panY) ? canvas.view.panY : 0, -1500, 1500) } }); } if (!canvases.length) return defaultState(); return { version: 1, activeCanvasId: canvases.some((c) => c.id === input.activeCanvasId) ? input.activeCanvasId : canvases[0].id, canvases }; }
function migrateLegacyEdgeBranches(input) { if (!input || !Array.isArray(input.canvases)) return input; input.canvases.forEach((c) => { if (!c || !Array.isArray(c.edges)) return; c.edges.forEach((e) => { if (!e || typeof e !== "object") return; if (["是", "否", "未定"].includes(e.branch)) return; if (typeof e.label === "string" && ["是", "否", "未定"].includes(e.label.trim())) { e.branch = e.label.trim(); e.label = ""; } }); }); return input; }

/* ---- 当前画布 / 快照 / 撤销重做栈 ---- */

function activeCanvas() { return state.canvases.find((c) => c.id === state.activeCanvasId) || state.canvases[0]; }
function snapshot() { return JSON.parse(JSON.stringify(state)); }
function pushHistory() { historyToken++; history.push({ snap: snapshot(), token: historyToken, future: future.slice() }); if (history.length > 80) history.shift(); future = []; lastArrowMoveAt = 0; userTouched = true; return historyToken; }
function popRollback(token) { const top = history[history.length - 1]; if (!top || top.token !== token) return false; history.pop(); future = top.future; return true; }
function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }

/* ---- 写入门面：凡是改文档都走这里，别处别自己 pushHistory + render + saveLocal ---- */

function commit(mutator, message = "已更新") { pushHistory(); mutator(); render(); saveLocal(message); }
