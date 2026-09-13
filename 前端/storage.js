/* ============================================================================
   本机存储层（拆分自原 app.js 的第 52–53、83–86、132–138 行，内容逐字照搬）

   这一份文件管「跟本机存储打交道的一切」：
     1. 草稿的读回与保存（localStorage）+ 自动保存与写入门面；
     2. 模块库的读回与保存；
     3. 存盘时「搬哪些字段」的那两份清单（moduleNodeFields / normalizeEdgeFields）。

   为什么字段清单放这里：模块的四处读写（封装、读取、就地编辑铺开、放置）各自手写
   了一遍「搬哪些字段」，四份清单都不全——节点漏了 condition / exitCondition，连线只
   搬 from/to，于是带判断节点的流程一封装就退化成「只有名字的菱形」，分支和循环回边
   也一起丢。把清单收敛成唯一一份，以后再加节点或连线字段只改这里，四处自动跟上。
   它们定义的是「落到本机 / 出到文件时保留哪些字段」，属于存储契约，故与存盘同住一卷。

   ⚠ 加载顺序：constants.js → **本文件** → state.js → … → app.js
   本体必须早于 state.js：state.js 顶部 `let state = loadState()` 在**它自己被求值时**
   就会调用本文件的 loadState。反过来，本文件里的函数只有在被调用时才需要 state.js 的
   normalizeState / normalizeNode / moduleNodeFields（那时 state.js 的函数声明已提升完毕），
   所以本体先加载是安全的——**但只对「只声明函数、不在顶层执行语句」成立**，
   往这里加顶层语句前先想清楚这一条。
   ============================================================================ */

/* ---- 草稿的读回与保存 ---- */

function clearBrokenDraft() { try { const cur = localStorage.getItem(STORAGE_KEY); if (cur) localStorage.setItem(STORAGE_KEY + "-corrupt-backup", cur); const leg = localStorage.getItem(LEGACY_STORAGE_KEY); if (leg) localStorage.setItem(LEGACY_STORAGE_KEY + "-corrupt-backup", leg); localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { } }

function loadState() { try { const current = localStorage.getItem(STORAGE_KEY), legacy = localStorage.getItem(LEGACY_STORAGE_KEY), parseOne = (raw) => { try { const p = JSON.parse(raw); return p && typeof p === "object" && Array.isArray(p.canvases) && p.canvases.length ? p : null; } catch { return null; } }, currentParsed = current ? parseOne(current) : null, legacyParsed = legacy ? parseOne(legacy) : null, parsed = currentParsed || legacyParsed; if (!parsed) { if (current || legacy) { draftUnreadable = true; clearBrokenDraft(); } return defaultState(); } const normalized = normalizeState(parsed); stateRev = typeof parsed?.rev === "number" ? parsed.rev : 0; if (!currentParsed && legacyParsed) { let migrated = false; try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...normalized, rev: stateRev })); migrated = true; } catch { } if (migrated) localStorage.removeItem(LEGACY_STORAGE_KEY); } else if (legacy) localStorage.removeItem(LEGACY_STORAGE_KEY); return normalized; } catch { draftUnreadable = true; clearBrokenDraft(); return defaultState(); } }

function hasSavedDraft() { try { return Boolean(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)); } catch { return false; } }

function saveLocal(message = "已保存到本机") { clearTimeout(autosaveTimer); autosaveTimer = null; try { const nextRev = Math.max(stateRev, lastSeenRemoteRev) + 1; localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, rev: nextRev, updatedAt: new Date().toISOString() })); stateRev = nextRev; saveStatus.textContent = message; statusDot.classList.remove("is-dirty"); isDirty = false; saveLocal._warned = false; saveLocal._backoff = false; return true; } catch { saveStatus.textContent = message === "已自动保存" ? "自动保存失败" : "保存失败"; statusDot.classList.add("is-dirty"); isDirty = true; saveLocal._backoff = true; if (!saveLocal._warned) { saveLocal._warned = true; showToast("本地存储空间不足，请立即导出 JSON 备份"); } return false; } }

function markDirty() { if (!isDirty) { saveStatus.textContent = "有未保存改动"; statusDot.classList.add("is-dirty"); } isDirty = true; clearTimeout(autosaveTimer); autosaveTimer = setTimeout(() => { autosaveTimer = null; if (saveLocal._backoff) return; saveLocal("已自动保存"); }, AUTOSAVE_DELAY_MS); }

function flushPendingSave() { commitPendingEdit(); if (isDirty || autosaveTimer) saveLocal("已保存到本机"); }

/* ---- 模块库的读回与保存 ---- */

/* ---- moduleNodeFields / normalizeEdgeFields（模块字段清单，合并后新增） ----
   为什么要有这两个函数：模块的四处读写（封装、读取、就地编辑铺开、放置）各自手写了一遍
   「搬哪些字段」，四份清单都不全——节点漏了 condition / exitCondition，连线只搬 from/to，
   于是带判断节点的流程一封装就退化成「只有名字的菱形」，分支和循环回边也一起丢。
   把清单收敛成唯一一份，以后再加节点或连线字段只改这里，四处自动跟上。 */
function moduleNodeFields(n) { return { type: n.type, w: n.w, h: n.h, label: n.label, note: n.note, marker: n.marker, condition: typeof n.condition === "string" ? n.condition : "", exitCondition: typeof n.exitCondition === "string" ? n.exitCondition : "" }; }

function normalizeEdgeFields(e) { return { label: typeof e.label === "string" ? e.label.trim().slice(0, 80) : "", branch: ["是", "否", "未定"].includes(e.branch) ? e.branch : "", fromSide: ["top", "right", "bottom", "left"].includes(e.fromSide) ? e.fromSide : "", toSide: ["top", "right", "bottom", "left"].includes(e.toSide) ? e.toSide : "", loop: e.loop === true, width: EDGE_WIDTHS.includes(e.width) ? e.width : "medium", color: typeof e.color === "string" && /^#[0-9a-fA-F]{6}$/.test(e.color) ? e.color : "" }; }

/* ---- loadModules（自 B 线移植） ---- */
function loadModules() { try { const raw = localStorage.getItem(MODULE_STORAGE_KEY); if (!raw) return []; const arr = JSON.parse(raw); if (!Array.isArray(arr)) return []; return arr.map(normalizeModule).filter(Boolean); } catch { return []; } }

/* ---- normalizeModule（自 B 线移植） ---- */
function normalizeModule(m) { if (!m || typeof m.id !== "string" || typeof m.name !== "string") return null; const nodes = Array.isArray(m.nodes) ? m.nodes.map(normalizeNode).filter(Boolean) : []; if (!nodes.length) return null; const ids = new Set(nodes.map((n) => n.id)); const edges = Array.isArray(m.edges) ? m.edges.filter((e) => e && ids.has(e.from) && ids.has(e.to)).map((e) => ({ from: e.from, to: e.to, ...normalizeEdgeFields(e) })) : []; return { id: m.id, name: m.name.trim() || "未命名模块", createdAt: m.createdAt, nodes, edges }; }

/* ---- saveModules（自 B 线移植） ---- */
function saveModules() { try { localStorage.setItem(MODULE_STORAGE_KEY, JSON.stringify(moduleLibrary)); } catch {} }
