/* ============================================================================
   常量与页面元素引用（拆分自原 app.js 的第 1–36 行，内容逐字照搬，未改一行逻辑）

   这一份文件是「不变的东西」：数值常量、字段枚举、类型表，以及页面元素引用。
   它们在页面加载时一次性确定，运行期间不再变。
   真正会变的东西（当前状态、选中项、拖拽中的手势）在 state.js 里。

   ⚠ 加载顺序是**有意义的**（拆成多个 script 之后，顺序就是依赖）：
       constants.js → storage.js → state.js → … → app.js
   本文件必须最先加载：后面每个文件都要用这里的常量或元素引用。
   ============================================================================ */

const STORAGE_KEY = "workflow-canvas-communication-draft-v1";
const LEGACY_STORAGE_KEY = "workflow-canvas-legal-blueprint-v1";
const MODULE_STORAGE_KEY = "workflow-canvas-module-library-v1";
const MODULE_FILE_KIND = "workflow-canvas-module-library";
const MAX_MODULE_FILE_BYTES = 8 * 1024 * 1024;
const ZOOM_MIN = 0.01;
const ZOOM_MAX = 2.2;
const ZOOM_CLICK_IN = 0.05;
const ZOOM_CLICK_OUT_COARSE = 0.05;
const ZOOM_CLICK_OUT_FINE = 0.01;
const ZOOM_FINE_THRESHOLD = 0.1;
const AUTOSAVE_DELAY_MS = 600;
const DISK_POLL_MS = 4000;
const MAX_CANVASES = 100;
const MAX_NODES_PER_CANVAS = 1000;
const MAX_EDGES_PER_CANVAS = 4000;
const DISCUSSION_MARKERS = ["待讨论", "已决定", "有疑问", "不采用"];
const EDGE_WIDTHS = ["thin", "medium", "thick"];
const EDGE_WIDTH_PX = { thin: 2.8, medium: 4, thick: 5.5 };
const EDGE_COLORS = ["#4a7c8b", "#2f8f6f", "#d9724b", "#b5486b", "#7a6db8", "#c79a2e", "#3d6fd6", "#6b7280"];
const DEFAULT_EDGE_COLOR = "#4a7c8b";
const EDGE_SELECTED_COLOR = "#d9724b";
const NODE_DEFAULTS = {
  rect: { label: "步骤", note: "双击编辑文字" }, diamond: { label: "判断", note: "条件分支" }, circle: { label: "开始 / 结束", note: "" }, document: { label: "材料", note: "来源或文档" }, triangle: { label: "提醒", note: "需要处理" }, text: { label: "输入文字", note: "" },
};
const NODE_TYPE_LABELS = { rect: "步骤（矩形）", diamond: "判断（菱形）", circle: "开始 / 结束（圆形）", document: "材料（文档形）", triangle: "提醒（三角形）", text: "文字" };
const RESIZE_HANDLES_BY_TYPE = {
  rect: ["nw", "ne", "se", "sw"],
  document: ["nw", "ne", "se", "sw"],
  text: ["nw", "ne", "se", "sw"],
  diamond: ["n", "e", "s", "w"],
  circle: ["n", "e", "s", "w"],
  triangle: ["n", "se", "sw"],
};
const NODE_MIN_SIZES = { rect: { w: 120, h: 92 }, document: { w: 120, h: 92 }, diamond: { w: 76, h: 76 }, circle: { w: 76, h: 76 }, triangle: { w: 96, h: 84 }, text: { w: 80, h: 40 } };
const viewport = document.querySelector("#viewport"), surface = document.querySelector("#surface"), nodeLayer = document.querySelector("#nodeLayer"), edgeGroup = document.querySelector("#edges"), temporaryEdge = document.querySelector("#temporaryEdge"), canvasTabs = document.querySelector("#canvasTabs"), importInput = document.querySelector("#importInput"), saveStatus = document.querySelector("#saveStatus"), selectionStatus = document.querySelector("#selectionStatus"), statusDot = document.querySelector("#statusDot"), statusTruthDot = document.querySelector("#statusTruthDot"), statusTruthText = document.querySelector("#statusTruthText"), reloadDiskButton = document.querySelector("#reloadDiskButton"), zoomValue = document.querySelector("#zoomValue"), selectionHint = document.querySelector("#selectionHint"), toast = document.querySelector("#toast"), inspector = document.querySelector("#nodeInspector"), inspectorEmpty = document.querySelector("#inspectorEmpty"), inspectorForm = document.querySelector("#inspectorForm"), inspectorCount = document.querySelector("#inspectorCount"), inspectorName = document.querySelector("#inspectorName"), inspectorNote = document.querySelector("#inspectorNote"), inspectorType = document.querySelector("#inspectorType"), inspectorMarker = document.querySelector("#inspectorMarker"), inspectorEdgeForm = document.querySelector("#inspectorEdgeForm"), inspectorEdgeName = document.querySelector("#inspectorEdgeName"), previousNodes = document.querySelector("#previousNodes"), nextNodes = document.querySelector("#nextNodes"), previousCount = document.querySelector("#previousCount"), nextCount = document.querySelector("#nextCount"), inspectorCondition = document.querySelector("#inspectorCondition"), inspectorExitCondition = document.querySelector("#inspectorExitCondition"), conditionGroup = document.querySelector("#conditionGroup"), exitConditionGroup = document.querySelector("#exitConditionGroup"), inspectorEdgeLoop = document.querySelector("#inspectorEdgeLoop"), loopExitWarning = document.querySelector("#loopExitWarning"), branchGroup = document.querySelector("#branchGroup"), edgeNameLabel = document.querySelector("#edgeNameLabel");
const marquee = document.querySelector("#marquee"), multiSelectPanel = document.querySelector("#multiSelectPanel"), multiSelectSummary = document.querySelector("#multiSelectSummary"), moduleModal = document.querySelector("#moduleModal"), moduleList = document.querySelector("#moduleList"), moduleEditBar = document.querySelector("#moduleEditBar"), moduleEditName = document.querySelector("#moduleEditName"), moduleImportInput = document.querySelector("#moduleImportInput");
