const canvas = document.getElementById("canvas");
const world = document.getElementById("canvas-world");
const svg = document.getElementById("connections");
const popup = document.getElementById("node-popup");
const popupForm = document.getElementById("popup-form");
const popupTypeLabel = document.getElementById("popup-type-label");
const popupPurpose = document.getElementById("popup-purpose");
const popupAmount = document.getElementById("popup-amount");
const popupCancel = document.getElementById("popup-cancel");
const monthLabel = document.getElementById("month-label");
const topbarNote = document.getElementById("topbar-note");
const prevMonthButton = document.getElementById("prev-month");
const nextMonthButton = document.getElementById("next-month");
const zoomInButton = document.getElementById("zoom-in");
const zoomOutButton = document.getElementById("zoom-out");
const zoomResetButton = document.getElementById("zoom-reset");
const downloadStatementButton = document.getElementById("download-statement");
const toolbarIncomeButton = document.getElementById("toolbar-income");
const toolbarExpenseButton = document.getElementById("toolbar-expense");

const WORLD_WIDTH = 3600;
const WORLD_HEIGHT = 2400;
const STORAGE_KEY = "expense-flow-monthly-db-v1";
const DB_CONFIG_PATH = "./db-config.js";
const BALANCE_NODE_DEFS = [
  {
    id: "balance-axis",
    bankKey: "axis",
    title: "Axis Bank",
    kicker: "Available Balance",
    accentClass: "axis-bank",
    x: 320,
    y: 120,
  },
  {
    id: "balance-kotak",
    bankKey: "kotak",
    title: "Kotak Bank",
    kicker: "Available Balance",
    accentClass: "kotak-bank",
    x: 580,
    y: 120,
  },
];
const BALANCE_NODE_IDS = new Set(BALANCE_NODE_DEFS.map((node) => node.id));
const DEFAULT_BASE_BALANCES = {
  axis: 50000,
  kotak: 0,
};
const DEFAULT_SCALE = 0.6;
const INITIAL_PAN_X = 190;
const INITIAL_PAN_Y = 24;
const WORLD_EDGE_PADDING = 8;
const WORLD_MIN_X = -180;
const WORLD_MIN_Y = -50;
const RECURRING_LAYOUT_SLOTS = [
  { x: 940, y: 240 },
  { x: 940, y: 380 },
  { x: 940, y: 520 },
  { x: 1130, y: 300 },
  { x: 1130, y: 440 },
];

const PRESET_TEMPLATES = [
  { type: "income", purpose: "Salary", amount: 85000, recurring: true },
  { type: "expense", purpose: "Home EMI", amount: 26500, recurring: true },
  { type: "expense", purpose: "Car EMI", amount: 12400, recurring: true },
  { type: "expense", purpose: "Electricity Bill", amount: 2500, recurring: true },
  { type: "expense", purpose: "Internet Bill", amount: 999, recurring: true },
];

const state = {
  db: null,
  syncStatusNote: "",
  months: {},
  currentMonthKey: null,
  currentMonth: null,
  selectedTool: null,
  pendingCreatePosition: null,
  scale: 1,
  panX: INITIAL_PAN_X,
  panY: INITIAL_PAN_Y,
  connectionDraft: null,
  isSpacePressed: false,
  isPanning: false,
  panPointerId: null,
  panStartX: 0,
  panStartY: 0,
  initialPanX: 0,
  initialPanY: 0,
  didPanThisPointer: false,
};

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatMonth(date) {
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatDate(dateString) {
  if (!dateString) {
    return "";
  }
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(dateString));
}

function monthKeyForDate(date) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

function parseMonthKey(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function getTodayIsoDate() {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createLocalDb() {
  return {
    async load() {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { months: {} };
      }
      return JSON.parse(raw);
    },
    async save(data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    },
    kind: "local",
  };
}

async function createDatabase() {
  try {
    const module = await import(DB_CONFIG_PATH);
    if (typeof module.createCloudDb === "function") {
      return module.createCloudDb(STORAGE_KEY);
    }
  } catch (_error) {
    // Local fallback is intentional until db-config.js is created and configured.
  }

  return createLocalDb();
}

function setWorldTransform() {
  world.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
}

function syncConnectionCanvasBounds() {
  const width = WORLD_WIDTH - WORLD_MIN_X + WORLD_EDGE_PADDING;
  const height = WORLD_HEIGHT - WORLD_MIN_Y + WORLD_EDGE_PADDING;
  svg.style.left = `${WORLD_MIN_X}px`;
  svg.style.top = `${WORLD_MIN_Y}px`;
  svg.setAttribute("width", `${width}`);
  svg.setAttribute("height", `${height}`);
  svg.setAttribute("viewBox", `${WORLD_MIN_X} ${WORLD_MIN_Y} ${width} ${height}`);
}

function getCanvasRect() {
  return canvas.getBoundingClientRect();
}

function getWorldPoint(clientX, clientY) {
  const rect = getCanvasRect();
  return {
    x: (clientX - rect.left - state.panX) / state.scale,
    y: (clientY - rect.top - state.panY) / state.scale,
  };
}

function setZoom(nextScale) {
  state.scale = clamp(nextScale, 0.6, 1.8);
  zoomResetButton.textContent = `${Math.round(state.scale * 100)}%`;
  setWorldTransform();
  render();
}

function getCurrentMonth() {
  return state.currentMonth;
}

function getNode(nodeId) {
  return getCurrentMonth().nodes.find((node) => node.id === nodeId);
}

function getChildren(nodeId) {
  return getCurrentMonth().nodes.filter((node) => node.parentId === nodeId);
}

function getVisibleNodes() {
  return getCurrentMonth().nodes.filter((node) => node.type === "balance" || !node.parentId);
}

function getBalanceDefinition(balanceNodeId) {
  return BALANCE_NODE_DEFS.find((node) => node.id === balanceNodeId) || BALANCE_NODE_DEFS[0];
}

function getMonthBaseBalance(balanceNodeId) {
  const bankKey = getBalanceDefinition(balanceNodeId).bankKey;
  const month = getCurrentMonth();

  if (!month.baseBalances || typeof month.baseBalances !== "object") {
    month.baseBalances = { ...DEFAULT_BASE_BALANCES };
  }

  if (!Number.isFinite(Number(month.baseBalances[bankKey]))) {
    month.baseBalances[bankKey] = DEFAULT_BASE_BALANCES[bankKey] || 0;
  }

  return Number(month.baseBalances[bankKey]);
}

function getSubtreeNodes(nodeId) {
  const descendants = [];

  function walk(currentId) {
    const children = getChildren(currentId);
    children.forEach((child) => {
      descendants.push(child);
      walk(child.id);
    });
  }

  walk(nodeId);
  return descendants;
}

function getSubtreeNodeIds(nodeId) {
  return [nodeId, ...getSubtreeNodes(nodeId).map((node) => node.id)];
}

function getRootNode(node) {
  let current = node;
  while (current?.parentId) {
    current = getNode(current.parentId);
  }
  return current;
}

function isIncludedInBalance(node) {
  if (node.type === "balance") {
    return false;
  }
  const root = getRootNode(node);
  return BALANCE_NODE_IDS.has(root?.connectedTo);
}

function calculateBalance(balanceNodeId) {
  return (
    getMonthBaseBalance(balanceNodeId) +
    getConnectedFlowDelta(balanceNodeId)
  );
}

function getConnectedFlowDelta(balanceNodeId) {
  return getCurrentMonth().nodes
    .filter((node) => node.type !== "balance" && isIncludedInBalance(node))
    .filter((node) => getRootNode(node)?.connectedTo === balanceNodeId)
    .reduce((total, node) => total + (node.type === "income" ? node.amount : -node.amount), 0);
}

function getStackTotal(node) {
  return [node, ...getSubtreeNodes(node.id)].reduce((sum, item) => sum + item.amount, 0);
}

function placeRecurringCards(nodes) {
  return nodes.map((node, index) => {
    const slot = RECURRING_LAYOUT_SLOTS[index] || {
      x: 1130 + Math.floor(index / RECURRING_LAYOUT_SLOTS.length) * 190,
      y: 240 + (index % RECURRING_LAYOUT_SLOTS.length) * 135,
    };

    return {
      ...node,
      x: slot.x,
      y: slot.y,
    };
  });
}

function buildRecurringNodesForMonth(monthKey, sourceMonth) {
  return placeRecurringCards(
    sourceMonth.nodes
      .filter((node) => node.type !== "balance" && node.recurring)
      .map((node, index) => ({
        id: `${monthKey}-${index + 1}`,
        type: node.type,
        purpose: node.purpose,
        amount: node.amount,
        recurring: true,
        connectedTo: null,
        parentId: null,
        connectedAt: null,
        connectedSide: null,
        targetSide: null,
      }))
  );
}

function refreshMonthNextId(month) {
  const highestId = month.nodes.reduce((max, node) => {
    if (!node.id.startsWith(`${month.key}-`)) {
      return max;
    }

    const parsed = Number(node.id.slice(month.key.length + 1));
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);

  month.nextId = highestId + 1;
}

function maybeCompactRecurringCards(month) {
  const recurringRoots = month.nodes.filter(
    (node) => node.type !== "balance" && node.recurring && !node.parentId && !node.connectedTo
  );

  if (!recurringRoots.length) {
    return;
  }

  const seededMonth = recurringRoots.every((node) => node.id.startsWith(`${month.key}-`));
  const layoutLooksFar = recurringRoots.some((node) => node.x > 1180 || node.y > 760);

  if (!seededMonth || !layoutLooksFar) {
    return;
  }

  const compactedNodes = new Map(placeRecurringCards(recurringRoots).map((node) => [node.id, node]));
  month.nodes = month.nodes.map((node) => compactedNodes.get(node.id) || node);
}

function enableRecurringForAllSavedNodes(months) {
  Object.values(months).forEach((month) => {
    month.nodes?.forEach((node) => {
      if (node.type !== "balance" && typeof node.recurring !== "boolean") {
        node.recurring = true;
      }
    });
  });
}

function syncFutureRecurringMonths(startMonthKey) {
  const monthKeys = Object.keys(state.months).sort();
  const startIndex = monthKeys.indexOf(startMonthKey);

  if (startIndex === -1) {
    return;
  }

  let sourceMonth = state.months[startMonthKey];

  for (let index = startIndex + 1; index < monthKeys.length; index += 1) {
    const monthKey = monthKeys[index];
    const month = state.months[monthKey];
    const balanceNodes = BALANCE_NODE_DEFS.map((balanceDef) => (
      month.nodes.find((node) => node.id === balanceDef.id && node.type === "balance") || {
        id: balanceDef.id,
        type: "balance",
        x: balanceDef.x,
        y: balanceDef.y,
      }
    ));
    const nonRecurringNodes = month.nodes.filter((node) => node.type !== "balance" && !node.recurring);
    const recurringNodes = buildRecurringNodesForMonth(monthKey, sourceMonth);

    month.nodes = [...balanceNodes, ...recurringNodes, ...nonRecurringNodes];
    refreshMonthNextId(month);
    sourceMonth = month;
  }
}

function buildMonthSeed(monthKey, previousMonth) {
  const sourcePresets = previousMonth
    ? buildRecurringNodesForMonth(monthKey, previousMonth)
    : placeRecurringCards(
        PRESET_TEMPLATES.map((template, index) => ({
        id: `${monthKey}-${index + 1}`,
        ...template,
        connectedTo: null,
        parentId: null,
        connectedAt: null,
        connectedSide: null,
        targetSide: null,
      }))
      );

  return {
    key: monthKey,
    baseBalances: previousMonth?.baseBalances
      ? { ...DEFAULT_BASE_BALANCES, ...previousMonth.baseBalances }
      : { ...DEFAULT_BASE_BALANCES },
    nextId: sourcePresets.length + 1,
    nodes: [
      ...BALANCE_NODE_DEFS.map((balanceDef) => ({
        id: balanceDef.id,
        type: "balance",
        x: balanceDef.x,
        y: balanceDef.y,
      })),
      ...sourcePresets,
    ],
  };
}

function ensureMonth(monthKey) {
  if (state.months[monthKey]) {
    return state.months[monthKey];
  }

  const monthDate = parseMonthKey(monthKey);
  const previousDate = new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1);
  const previousKey = monthKeyForDate(previousDate);
  const previousMonth = state.months[previousKey] || null;
  state.months[monthKey] = buildMonthSeed(monthKey, previousMonth);
  return state.months[monthKey];
}

async function persist() {
  if (!state.db) {
    return;
  }
  try {
    if (state.currentMonthKey) {
      syncFutureRecurringMonths(state.currentMonthKey);
    }
    await state.db.save({ months: state.months });
    if (state.db.kind === "cloud" && state.syncStatusNote) {
      state.syncStatusNote = "";
      updateMonthHeader();
    }
  } catch (error) {
    console.error("Failed to persist ledger data.", error);
    state.syncStatusNote = "Cloud sync hit an issue. Your latest changes may not be saved yet.";
    updateMonthHeader();
  }
}

function updateMonthHeader() {
  const monthDate = parseMonthKey(state.currentMonthKey);
  monthLabel.textContent = formatMonth(monthDate);
  if (topbarNote) {
    topbarNote.textContent =
      state.syncStatusNote ||
      (state.db?.kind === "cloud"
        ? "Cloud persistence is configured with Firestore."
        : "Local storage is active. Add Firebase config in db-config.js to turn on Firestore sync.");
  }
}

async function selectMonth(monthKey) {
  state.currentMonthKey = monthKey;
  state.currentMonth = ensureMonth(monthKey);
  maybeCompactRecurringCards(state.currentMonth);
  updateMonthHeader();
  await persist();
  render();
}

function shiftMonth(offset) {
  const current = parseMonthKey(state.currentMonthKey);
  const next = new Date(current.getFullYear(), current.getMonth() + offset, 1);
  selectMonth(monthKeyForDate(next));
}

function setSelectedTool(tool) {
  state.selectedTool = tool;
  canvas.classList.toggle("tool-armed", Boolean(tool));
  toolbarIncomeButton?.classList.toggle("active", tool === "income");
  toolbarExpenseButton?.classList.toggle("active", tool === "expense");
}

function downloadMonthlyStatement() {
  const month = getCurrentMonth();
  const incomeTotal = month.nodes
    .filter((node) => node.type === "income")
    .reduce((sum, node) => sum + node.amount, 0);
  const expenseTotal = month.nodes
    .filter((node) => node.type === "expense")
    .reduce((sum, node) => sum + node.amount, 0);
  const axisBalance = calculateBalance("balance-axis");
  const kotakBalance = calculateBalance("balance-kotak");
  const closingBalance = axisBalance + kotakBalance;
  const statement = [
    `Monthly Statement: ${formatMonth(parseMonthKey(month.key))}`,
    `Generated on: ${new Date().toLocaleString("en-IN")}`,
    "",
    `Opening Axis Balance: ${formatCurrency(getMonthBaseBalance("balance-axis"))}`,
    `Opening Kotak Balance: ${formatCurrency(getMonthBaseBalance("balance-kotak"))}`,
    `Total Income: ${formatCurrency(incomeTotal)}`,
    `Total Expenses: ${formatCurrency(expenseTotal)}`,
    `Closing Axis Balance: ${formatCurrency(axisBalance)}`,
    `Closing Kotak Balance: ${formatCurrency(kotakBalance)}`,
    `Closing Total Balance: ${formatCurrency(closingBalance)}`,
    "",
    "Line Items",
    ...month.nodes
      .filter((node) => node.type !== "balance")
      .map((node) => `- ${node.type.toUpperCase()}: ${node.purpose} | ${formatCurrency(node.amount)}${node.recurring ? " | recurring" : ""}`),
  ].join("\n");

  const blob = new Blob([statement], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${month.key}-statement.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function showPopup(clientX, clientY) {
  const rect = getCanvasRect();
  const card = popup.querySelector(".popup-card");
  popup.hidden = false;
  card.style.left = `${clamp(clientX - rect.left, 18, rect.width - 320)}px`;
  card.style.top = `${clamp(clientY - rect.top, 18, rect.height - 260)}px`;
  popupTypeLabel.value = state.selectedTool || "";
  popupPurpose.focus();
}

function hidePopup() {
  popup.hidden = true;
  popupForm.reset();
  popupPurpose.value = "";
  popupAmount.value = "0";
  state.pendingCreatePosition = null;
}

function clearSnapState() {
  world.querySelectorAll(".node.snap-target").forEach((nodeEl) => {
    nodeEl.classList.remove("snap-target");
  });
}

function getConnectorPoint(nodeEl, side = "left") {
  return {
    x: side === "right" ? nodeEl.offsetLeft + nodeEl.offsetWidth : nodeEl.offsetLeft,
    y: nodeEl.offsetTop + nodeEl.offsetHeight / 2,
  };
}

function createCurve(start, end) {
  const delta = Math.max(Math.abs(end.x - start.x) * 0.45, 70);
  return `M ${start.x} ${start.y} C ${start.x + delta} ${start.y}, ${end.x - delta} ${end.y}, ${end.x} ${end.y}`;
}

function drawPath(start, end, type = null) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("class", `connection${type ? ` connection-${type}` : ""}`);
  path.setAttribute("d", createCurve(start, end));
  svg.appendChild(path);
}

function isDescendant(candidateId, targetAncestorId) {
  let current = getNode(candidateId);
  while (current?.parentId) {
    if (current.parentId === targetAncestorId) {
      return true;
    }
    current = getNode(current.parentId);
  }
  return false;
}

function getSnapTarget(clientX, clientY) {
  if (!state.connectionDraft) {
    return null;
  }

  const sourceNode = getNode(state.connectionDraft.fromNodeId);
  if (!sourceNode) {
    return null;
  }

  const candidates = getVisibleNodes().filter((node) => {
    if (node.id === sourceNode.id) {
      return false;
    }
    if (node.type === "balance") {
      return true;
    }
    if (node.type !== sourceNode.type) {
      return false;
    }
    if (isDescendant(node.id, sourceNode.id)) {
      return false;
    }
    return true;
  });

  for (const candidate of candidates) {
    const candidateEl = world.querySelector(`[data-node-id="${candidate.id}"]`);
    if (!candidateEl) {
      continue;
    }

    const rect = candidateEl.getBoundingClientRect();
    const padding = 30;
    const within =
      clientX >= rect.left - padding &&
      clientX <= rect.right + padding &&
      clientY >= rect.top - padding &&
      clientY <= rect.bottom + padding;

    if (!within) {
      continue;
    }

    const side = clientX >= rect.left + rect.width / 2 ? "right" : "left";
    return {
      id: candidate.id,
      side,
      point: getConnectorPoint(candidateEl, side),
    };
  }

  return null;
}

function renderConnections() {
  svg.innerHTML = "";

  getCurrentMonth().nodes
    .filter((node) => node.type !== "balance" && (node.connectedTo || node.parentId))
    .forEach((node) => {
      const sourceEl = world.querySelector(`[data-node-id="${node.id}"]`);
      const targetId = node.parentId || node.connectedTo;
      const targetEl = world.querySelector(`[data-node-id="${targetId}"]`);

      if (!sourceEl || !targetEl) {
        return;
      }

      drawPath(
        getConnectorPoint(sourceEl, node.connectedSide || "right"),
        getConnectorPoint(targetEl, node.targetSide || "left"),
        node.type
      );
    });

  if (state.connectionDraft) {
    const draftNode = getNode(state.connectionDraft.fromNodeId);
    drawPath(state.connectionDraft.start, state.connectionDraft.current, draftNode?.type || null);
  }
}

function beginConnection(nodeId, side, event) {
  const nodeEl = world.querySelector(`[data-node-id="${nodeId}"]`);
  if (!nodeEl) {
    return;
  }

  state.connectionDraft = {
    fromNodeId: nodeId,
    startSide: side,
    start: getConnectorPoint(nodeEl, side),
    current: getWorldPoint(event.clientX, event.clientY),
    snapTargetId: null,
    snapSide: null,
  };

  clearSnapState();
  renderConnections();
}

async function finishConnection(targetId) {
  if (!state.connectionDraft) {
    return;
  }

  const sourceNode = getNode(state.connectionDraft.fromNodeId);
  const targetNode = getNode(targetId);

  if (!sourceNode || !targetNode) {
    state.connectionDraft = null;
    clearSnapState();
    render();
    return;
  }

  sourceNode.connectedSide = state.connectionDraft.startSide;
  sourceNode.targetSide = state.connectionDraft.snapSide || "left";

  if (targetNode.type === "balance") {
    sourceNode.parentId = null;
    sourceNode.connectedTo = targetNode.id;
    sourceNode.connectedAt = getTodayIsoDate();
  } else if (targetNode.type === sourceNode.type) {
    sourceNode.parentId = targetNode.id;
    sourceNode.connectedTo = null;
    sourceNode.connectedAt = null;
  }

  state.connectionDraft = null;
  clearSnapState();
  await persist();
  render();
}

function cancelConnection() {
  state.connectionDraft = null;
  clearSnapState();
  renderConnections();
}

async function detachNode(nodeId) {
  const node = getNode(nodeId);
  if (!node) {
    return;
  }

  node.connectedTo = null;
  node.parentId = null;
  node.connectedSide = null;
  node.targetSide = null;
  node.connectedAt = null;
  await persist();
  render();
}

async function unstackNode(nodeId) {
  const descendants = getSubtreeNodes(nodeId);
  if (!descendants.length) {
    return;
  }

  descendants.forEach((node) => {
    node.parentId = null;
    node.connectedTo = null;
    node.connectedSide = null;
    node.targetSide = null;
    node.connectedAt = null;
  });

  await persist();
  render();
}

async function deleteNode(nodeId) {
  const ids = new Set(getSubtreeNodeIds(nodeId));
  getCurrentMonth().nodes = getCurrentMonth().nodes.filter((node) => !ids.has(node.id));
  await persist();
  render();
}

function refreshBalanceNodes() {
  BALANCE_NODE_DEFS.forEach((balanceDef) => {
    const balanceEl = world.querySelector(`[data-node-id="${balanceDef.id}"]`);
    if (!balanceEl) {
      return;
    }

    const connectedRoots = getCurrentMonth().nodes.filter(
      (node) => node.type !== "balance" && !node.parentId && node.connectedTo === balanceDef.id
    ).length;

    balanceEl.querySelector(".balance-total-input").value = calculateBalance(balanceDef.id).toFixed(2);
    balanceEl.querySelector(".balance-caption").textContent = `${connectedRoots} connected root node(s)`;
  });
}

function updateConnectionDraft(clientX, clientY) {
  if (!state.connectionDraft) {
    return;
  }

  const snapTarget = getSnapTarget(clientX, clientY);
  clearSnapState();

  if (snapTarget) {
    state.connectionDraft.current = snapTarget.point;
    state.connectionDraft.snapTargetId = snapTarget.id;
    state.connectionDraft.snapSide = snapTarget.side;
    world.querySelector(`[data-node-id="${snapTarget.id}"]`)?.classList.add("snap-target");
  } else {
    state.connectionDraft.current = getWorldPoint(clientX, clientY);
    state.connectionDraft.snapTargetId = null;
    state.connectionDraft.snapSide = null;
  }

  renderConnections();
}

function createStackMarkup(node) {
  const descendants = getSubtreeNodes(node.id);
  if (!descendants.length) {
    return "";
  }

  const itemCount = descendants.length + 1;
  const stackTotal = getStackTotal(node);

  return `
    <section class="stack-summary">
      <div class="stack-summary-rows">
        <p class="stack-summary-row"><span>Total</span><strong>${formatCurrency(stackTotal)}</strong></p>
        <p class="stack-summary-row"><span>Items</span><strong>${itemCount}</strong></p>
      </div>
      <div class="stack-actions">
        <button type="button" class="stack-unstack-button" data-unstack-stack="${node.id}">Unstack</button>
      </div>
    </section>
  `;
}

function attachDrag(node, nodeEl) {
  let pointerId = null;
  let offsetX = 0;
  let offsetY = 0;
  let childPositions = [];

  nodeEl.addEventListener("pointerdown", (event) => {
    if (event.target.closest("input, button, .connector")) {
      return;
    }

    pointerId = event.pointerId;
    const point = getWorldPoint(event.clientX, event.clientY);
    offsetX = point.x - node.x;
    offsetY = point.y - node.y;
    childPositions = getSubtreeNodes(node.id).map((child) => ({
      id: child.id,
      x: child.x,
      y: child.y,
    }));
    nodeEl.classList.add("dragging");
    nodeEl.setPointerCapture(pointerId);
  });

  nodeEl.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) {
      return;
    }

    const point = getWorldPoint(event.clientX, event.clientY);
    const nextX = clamp(
      point.x - offsetX,
      WORLD_MIN_X,
      WORLD_WIDTH - nodeEl.offsetWidth - WORLD_EDGE_PADDING
    );
    const nextY = clamp(
      point.y - offsetY,
      WORLD_MIN_Y,
      WORLD_HEIGHT - nodeEl.offsetHeight - WORLD_EDGE_PADDING
    );
    const deltaX = nextX - node.x;
    const deltaY = nextY - node.y;
    node.x = nextX;
    node.y = nextY;

    childPositions.forEach((childPos) => {
      const child = getNode(childPos.id);
      if (!child) {
        return;
      }
      child.x = childPos.x + deltaX;
      child.y = childPos.y + deltaY;
    });

    nodeEl.style.left = `${node.x}px`;
    nodeEl.style.top = `${node.y}px`;
    if (node.type === "balance") {
      refreshBalanceNodes();
    }
    renderConnections();
  });

  async function stopDrag(event) {
    if (pointerId !== event.pointerId) {
      return;
    }

    nodeEl.classList.remove("dragging");
    nodeEl.releasePointerCapture(pointerId);
    pointerId = null;
    await persist();
  }

  nodeEl.addEventListener("pointerup", stopDrag);
  nodeEl.addEventListener("pointercancel", stopDrag);
}

function buildIconButton(type, hidden = false) {
  if (type === "disconnect") {
    return `
      <button class="node-icon-button disconnect-button" type="button" ${hidden ? "hidden" : ""} title="Disconnect node">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9.5 14.5 14.5 9.5" />
          <path d="M7 17a4 4 0 0 1 0-5.66l2.34-2.34a4 4 0 0 1 5.66 0" />
          <path d="M17 7a4 4 0 0 1 0 5.66l-2.34 2.34a4 4 0 0 1-5.66 0" />
        </svg>
      </button>
    `;
  }

  return `
    <button class="node-icon-button delete-button" type="button" title="Delete node">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16" />
        <path d="M9 7V4h6v3" />
        <path d="M8 10v8" />
        <path d="M12 10v8" />
        <path d="M16 10v8" />
        <path d="M6 7l1 13h10l1-13" />
      </svg>
    </button>
  `;
}

function buildBalanceNode(node) {
  const balanceDef = getBalanceDefinition(node.id);
  const calculatedBalance = calculateBalance(node.id);
  const article = document.createElement("article");
  article.className = `node balance ${balanceDef.accentClass}`;
  article.dataset.nodeId = node.id;
  article.style.left = `${node.x}px`;
  article.style.top = `${node.y}px`;
  article.innerHTML = `
    <div class="node-card">
      <div class="balance-accent"></div>
      <div class="node-head">
        <div>
          <p class="node-kicker">${balanceDef.kicker}</p>
          <h3 class="node-title">${balanceDef.title}</h3>
        </div>
        <div class="node-icon">₹</div>
      </div>
      <label class="balance-total-edit">
        <span class="field-label">Available Balance</span>
        <input class="balance-total-input" type="number" step="0.01" value="${calculatedBalance.toFixed(2)}" />
      </label>
      <p class="balance-caption">0 connected root node(s)</p>
      <div class="connector connector-left" data-side="left"></div>
      <div class="connector connector-right" data-side="right"></div>
    </div>
  `;

  article.querySelector(".balance-total-input").addEventListener("change", async (event) => {
    const parsed = Number(event.target.value);
    const month = getCurrentMonth();
    const bankKey = balanceDef.bankKey;

    if (!month.baseBalances || typeof month.baseBalances !== "object") {
      month.baseBalances = { ...DEFAULT_BASE_BALANCES };
    }

    month.baseBalances[bankKey] = Number.isFinite(parsed) ? parsed - getConnectedFlowDelta(node.id) : 0;
    refreshBalanceNodes();
    await persist();
  });

  attachDrag(node, article);
  world.appendChild(article);
}

function buildValueNode(node) {
  const article = document.createElement("article");
  const hasStack = getSubtreeNodes(node.id).length > 0;
  const displayedAmount = hasStack ? getStackTotal(node) : node.amount;
  article.className = `node ${node.type}${node.connectedTo || node.parentId ? " connected" : ""}${hasStack ? " stack-parent" : ""}`;
  article.dataset.nodeId = node.id;
  article.style.left = `${node.x}px`;
  article.style.top = `${node.y}px`;
  const amountPrefix = node.type === "income" ? "+ " : "- ";
  article.innerHTML = `
    <div class="node-card compact-card">
      <p class="node-compact-title">${node.purpose}</p>
      <div class="node-amount-figure">
        <strong class="node-amount-value">${amountPrefix}${displayedAmount.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}</strong>
      </div>
      <div class="node-actions compact-actions">
        <button type="button" class="node-action-text disconnect-button" ${!(node.connectedTo || node.parentId) ? "hidden" : ""}>Unlink</button>
        <button type="button" class="node-action-text delete-button">Delete</button>
      </div>
      ${createStackMarkup(node)}
      <div class="connector connector-out connector-left" data-side="left"></div>
      <div class="connector connector-out connector-right" data-side="right"></div>
    </div>
  `;

  article.querySelector(".disconnect-button")?.addEventListener("click", async (event) => {
    event.stopPropagation();
    await detachNode(node.id);
  });

  article.querySelector(".delete-button").addEventListener("click", async (event) => {
    event.stopPropagation();
    await deleteNode(node.id);
  });

  article.querySelector("[data-unstack-stack]")?.addEventListener("click", async (event) => {
    event.stopPropagation();
    await unstackNode(node.id);
  });

  article.querySelectorAll("[data-unstack-id]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await detachNode(button.dataset.unstackId);
    });
  });

  article.querySelectorAll(".connector-out").forEach((connector) => {
    connector.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      connector.setPointerCapture(event.pointerId);
      beginConnection(node.id, connector.dataset.side || "right", event);
    });

    connector.addEventListener("pointermove", (event) => {
      if (!state.connectionDraft || state.connectionDraft.fromNodeId !== node.id) {
        return;
      }
      updateConnectionDraft(event.clientX, event.clientY);
    });

    function finishDrag(event) {
      if (!state.connectionDraft || state.connectionDraft.fromNodeId !== node.id) {
        return;
      }

      connector.releasePointerCapture(event.pointerId);
      if (state.connectionDraft.snapTargetId) {
        finishConnection(state.connectionDraft.snapTargetId);
        return;
      }
      cancelConnection();
    }

    connector.addEventListener("pointerup", finishDrag);
    connector.addEventListener("pointercancel", finishDrag);
  });

  attachDrag(node, article);
  world.appendChild(article);
}

function render() {
  svg.innerHTML = "";
  world.querySelectorAll(".node").forEach((nodeEl) => nodeEl.remove());

  getVisibleNodes().forEach((node) => {
    if (node.type === "balance") {
      buildBalanceNode(node);
    } else {
      buildValueNode(node);
    }
  });

  refreshBalanceNodes();
  renderConnections();
}

async function addNode(type, amount, purpose, position) {
  const month = getCurrentMonth();
  const id = `${month.key}-${month.nextId++}`;
  month.nodes.push({
    id,
    type,
    purpose,
    amount,
    recurring: false,
    connectedTo: null,
    parentId: null,
    connectedAt: null,
    connectedSide: null,
    targetSide: null,
    x: clamp(position.x, WORLD_MIN_X, WORLD_WIDTH - 260),
    y: clamp(position.y, WORLD_MIN_Y, WORLD_HEIGHT - 150),
  });
  await persist();
  render();
}

function applyPan(nextPanX, nextPanY) {
  state.panX = nextPanX;
  state.panY = nextPanY;
  setWorldTransform();
}

function maybeRollToCurrentMonth() {
  const currentKey = monthKeyForDate(new Date());
  if (state.currentMonthKey !== currentKey) {
    selectMonth(currentKey);
  }
}

toolbarIncomeButton?.addEventListener("click", () => {
  setSelectedTool(state.selectedTool === "income" ? null : "income");
});

toolbarExpenseButton?.addEventListener("click", () => {
  setSelectedTool(state.selectedTool === "expense" ? null : "expense");
});

downloadStatementButton?.addEventListener("click", () => {
  downloadMonthlyStatement();
});

prevMonthButton.addEventListener("click", () => shiftMonth(-1));
nextMonthButton.addEventListener("click", () => shiftMonth(1));

zoomInButton.addEventListener("click", () => setZoom(state.scale + 0.1));
zoomOutButton.addEventListener("click", () => setZoom(state.scale - 0.1));
zoomResetButton.addEventListener("click", () => setZoom(DEFAULT_SCALE));

canvas.addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey) {
      return;
    }
    event.preventDefault();
    setZoom(state.scale + (event.deltaY < 0 ? 0.08 : -0.08));
  },
  { passive: false }
);

canvas.addEventListener("pointerdown", (event) => {
  if (!state.isSpacePressed) {
    return;
  }

  state.isPanning = true;
  state.panPointerId = event.pointerId;
  state.panStartX = event.clientX;
  state.panStartY = event.clientY;
  state.initialPanX = state.panX;
  state.initialPanY = state.panY;
  state.didPanThisPointer = false;
  canvas.classList.add("space-panning");
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.isPanning || state.panPointerId !== event.pointerId) {
    return;
  }

  const deltaX = event.clientX - state.panStartX;
  const deltaY = event.clientY - state.panStartY;
  if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
    state.didPanThisPointer = true;
  }
  applyPan(state.initialPanX + deltaX, state.initialPanY + deltaY);
});

function endPan(event) {
  if (!state.isPanning || state.panPointerId !== event.pointerId) {
    return;
  }
  canvas.releasePointerCapture(event.pointerId);
  state.isPanning = false;
  state.panPointerId = null;
  canvas.classList.remove("space-panning");
}

canvas.addEventListener("pointerup", endPan);
canvas.addEventListener("pointercancel", endPan);

canvas.addEventListener("click", (event) => {
  if (state.didPanThisPointer) {
    state.didPanThisPointer = false;
    return;
  }

  if (state.isSpacePressed || !state.selectedTool) {
    return;
  }

  if (event.target !== canvas && event.target !== world && event.target !== svg) {
    return;
  }

  state.pendingCreatePosition = getWorldPoint(event.clientX, event.clientY);
  showPopup(event.clientX, event.clientY);
});

document.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !event.repeat) {
    state.isSpacePressed = true;
    canvas.classList.add("space-ready");
    event.preventDefault();
  }

  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
    event.preventDefault();
    const step = 60;
    if (event.code === "ArrowUp") {
      applyPan(state.panX, state.panY + step);
    }
    if (event.code === "ArrowDown") {
      applyPan(state.panX, state.panY - step);
    }
    if (event.code === "ArrowLeft") {
      applyPan(state.panX + step, state.panY);
    }
    if (event.code === "ArrowRight") {
      applyPan(state.panX - step, state.panY);
    }
  }
});

document.addEventListener("keyup", (event) => {
  if (event.code === "Space") {
    state.isSpacePressed = false;
    canvas.classList.remove("space-ready");
    canvas.classList.remove("space-panning");
  }
});

popup.addEventListener("click", (event) => {
  if (event.target === popup) {
    hidePopup();
  }
});

popupCancel.addEventListener("click", () => hidePopup());

popupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.pendingCreatePosition || !state.selectedTool) {
    hidePopup();
    return;
  }

  await addNode(
    state.selectedTool,
    Math.max(Number(popupAmount.value) || 0, 0),
    popupPurpose.value.trim() || (state.selectedTool === "income" ? "Income" : "Expense"),
    state.pendingCreatePosition
  );
  hidePopup();
  setSelectedTool(null);
});

window.addEventListener("pointermove", (event) => {
  if (state.connectionDraft) {
    updateConnectionDraft(event.clientX, event.clientY);
  }
});

window.addEventListener("pointerup", () => {
  if (!state.connectionDraft) {
    return;
  }
  if (state.connectionDraft.snapTargetId) {
    finishConnection(state.connectionDraft.snapTargetId);
    return;
  }
  cancelConnection();
});

window.addEventListener("resize", renderConnections);

async function init() {
  state.db = await createDatabase();
  let data;

  try {
    data = await state.db.load();
  } catch (error) {
    console.error("Failed to load ledger data from the active database.", error);
    state.db = createLocalDb();
    data = await state.db.load();
    state.syncStatusNote = "Cloud sync was unavailable, so the app fell back to local storage.";
  }

  state.months = data.months || {};
  enableRecurringForAllSavedNodes(state.months);
  syncConnectionCanvasBounds();
  const initialKey = monthKeyForDate(new Date());
  ensureMonth(initialKey);
  await selectMonth(initialKey);
  setSelectedTool(null);
  setWorldTransform();
  setZoom(DEFAULT_SCALE);
  setInterval(maybeRollToCurrentMonth, 60 * 1000);
}

init();
