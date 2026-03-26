const canvas = document.getElementById("canvas");
const world = document.getElementById("canvas-world");
const svg = document.getElementById("connections");
const selectionPill = document.getElementById("selection-pill");
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
const toolButtons = document.querySelectorAll("[data-tool]");

const WORLD_WIDTH = 3600;
const WORLD_HEIGHT = 2400;
const STORAGE_KEY = "expense-flow-monthly-db-v1";
const DB_CONFIG_PATH = "./db-config.js";

const PRESET_TEMPLATES = [
  { type: "income", purpose: "Salary", amount: 85000, recurring: true, x: 1100, y: 320 },
  { type: "expense", purpose: "Home EMI", amount: 26500, recurring: true, x: 1080, y: 560 },
  { type: "expense", purpose: "Car EMI", amount: 12400, recurring: true, x: 1080, y: 760 },
  { type: "expense", purpose: "Electricity Bill", amount: 2500, recurring: true, x: 1390, y: 540 },
  { type: "expense", purpose: "Internet Bill", amount: 999, recurring: true, x: 1390, y: 740 },
];

const state = {
  db: null,
  months: {},
  currentMonthKey: null,
  currentMonth: null,
  selectedTool: null,
  pendingCreatePosition: null,
  scale: 1,
  panX: 130,
  panY: 120,
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
  return root?.connectedTo === "balance";
}

function calculateBalance() {
  return (
    getCurrentMonth().baseBalance +
    getCurrentMonth().nodes
      .filter((node) => node.type !== "balance" && isIncludedInBalance(node))
      .reduce((total, node) => total + (node.type === "income" ? node.amount : -node.amount), 0)
  );
}

function getStackTotal(node) {
  return [node, ...getSubtreeNodes(node.id)].reduce((sum, item) => sum + item.amount, 0);
}

function buildMonthSeed(monthKey, previousMonth) {
  const presets = previousMonth
    ? previousMonth.nodes
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
          x: node.x,
          y: node.y,
        }))
    : PRESET_TEMPLATES.map((template, index) => ({
        id: `${monthKey}-${index + 1}`,
        ...template,
        connectedTo: null,
        parentId: null,
        connectedAt: null,
        connectedSide: null,
        targetSide: null,
      }));

  return {
    key: monthKey,
    baseBalance: previousMonth ? previousMonth.baseBalance : 50000,
    nextId: presets.length + 1,
    nodes: [
      {
        id: "balance",
        type: "balance",
        x: 420,
        y: 420,
      },
      ...presets,
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
  await state.db.save({ months: state.months });
}

function updateMonthHeader() {
  const monthDate = parseMonthKey(state.currentMonthKey);
  monthLabel.textContent = formatMonth(monthDate);
  topbarNote.textContent =
    state.db?.kind === "cloud"
      ? "Cloud persistence is configured with Firestore."
      : "Local storage is active. Add Firebase config in db-config.js to turn on Firestore sync.";
}

async function selectMonth(monthKey) {
  state.currentMonthKey = monthKey;
  state.currentMonth = ensureMonth(monthKey);
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
  selectionPill.textContent = `Selected: ${tool ? `${tool} node` : "none"}`;
  toolButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
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

function drawPath(start, end) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("class", "connection");
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
    .filter((node) => node.type !== "balance" && (node.connectedTo === "balance" || node.parentId))
    .forEach((node) => {
      const sourceEl = world.querySelector(`[data-node-id="${node.id}"]`);
      const targetId = node.parentId || node.connectedTo;
      const targetEl = world.querySelector(`[data-node-id="${targetId}"]`);

      if (!sourceEl || !targetEl) {
        return;
      }

      drawPath(
        getConnectorPoint(sourceEl, node.connectedSide || "right"),
        getConnectorPoint(targetEl, node.targetSide || "left")
      );
    });

  if (state.connectionDraft) {
    drawPath(state.connectionDraft.start, state.connectionDraft.current);
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
    sourceNode.connectedTo = "balance";
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

async function deleteNode(nodeId) {
  const ids = new Set(getSubtreeNodeIds(nodeId));
  getCurrentMonth().nodes = getCurrentMonth().nodes.filter((node) => !ids.has(node.id));
  await persist();
  render();
}

function refreshBalanceNode() {
  const balanceEl = world.querySelector('[data-node-id="balance"]');
  if (!balanceEl) {
    return;
  }

  const connectedRoots = getCurrentMonth().nodes.filter(
    (node) => node.type !== "balance" && !node.parentId && node.connectedTo === "balance"
  ).length;

  balanceEl.querySelector(".balance-input").value = getCurrentMonth().baseBalance;
  balanceEl.querySelector(".balance-figure").textContent = formatCurrency(calculateBalance());
  balanceEl.querySelector(".balance-caption").textContent = `${connectedRoots} connected root node(s)`;
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

  const items = descendants
    .slice(0, 4)
    .map(
      (child) => `
        <div class="stack-chip">
          <span class="stack-name">${child.purpose}</span>
          <span>${formatCurrency(child.amount)}</span>
          <button type="button" data-unstack-id="${child.id}">Unstack</button>
        </div>
      `
    )
    .join("");

  const moreCount = descendants.length - 4;
  const moreMarkup = moreCount > 0 ? `<p class="stack-meta">+${moreCount} more nested node(s)</p>` : "";

  return `
    <section class="stack-summary">
      <p class="stack-meta">Stack total ${formatCurrency(getStackTotal(node))} across ${descendants.length + 1} node(s)</p>
      <div class="stack-list">${items}</div>
      ${moreMarkup}
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
    const nextX = clamp(point.x - offsetX, 18, WORLD_WIDTH - nodeEl.offsetWidth - 18);
    const nextY = clamp(point.y - offsetY, 18, WORLD_HEIGHT - nodeEl.offsetHeight - 18);
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
      refreshBalanceNode();
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
  const article = document.createElement("article");
  article.className = "node balance";
  article.dataset.nodeId = node.id;
  article.style.left = `${node.x}px`;
  article.style.top = `${node.y}px`;
  article.innerHTML = `
    <div class="node-header">
      <span class="node-type">Available Balance</span>
    </div>
    <label>
      <span class="field-label">Base Balance</span>
      <input class="balance-input" type="number" step="0.01" value="${getCurrentMonth().baseBalance}" />
    </label>
    <p class="balance-figure">${formatCurrency(calculateBalance())}</p>
    <p class="balance-caption">0 connected root node(s)</p>
    <div class="connector connector-left" data-side="left"></div>
    <div class="connector connector-right" data-side="right"></div>
  `;

  article.querySelector(".balance-input").addEventListener("input", async (event) => {
    const parsed = Number(event.target.value);
    getCurrentMonth().baseBalance = Number.isFinite(parsed) ? parsed : 0;
    refreshBalanceNode();
    await persist();
  });

  attachDrag(node, article);
  world.appendChild(article);
}

function buildValueNode(node) {
  const article = document.createElement("article");
  const hasStack = getSubtreeNodes(node.id).length > 0;
  article.className = `node ${node.type}${node.connectedTo === "balance" || node.parentId ? " connected" : ""}${hasStack ? " stack-parent" : ""}`;
  article.dataset.nodeId = node.id;
  article.style.left = `${node.x}px`;
  article.style.top = `${node.y}px`;
  article.innerHTML = `
    <div class="node-header">
      <span class="node-type">${node.type}</span>
      <div class="node-actions">
        ${buildIconButton("disconnect", !(node.connectedTo || node.parentId))}
        ${buildIconButton("delete")}
      </div>
    </div>
    <p class="purpose-line">${node.purpose}</p>
    ${node.connectedTo === "balance" && node.connectedAt ? `<p class="date-chip">${formatDate(node.connectedAt)}</p>` : ""}
    <div class="node-meta-row">
      <label>
        <span class="field-label">Value</span>
        <input class="node-amount" type="number" step="0.01" value="${node.amount}" />
      </label>
    </div>
    <label class="recurring-toggle">
      <input class="node-recurring" type="checkbox" ${node.recurring ? "checked" : ""} />
      Recurring next month
    </label>
    ${createStackMarkup(node)}
    <div class="connector connector-out connector-left" data-side="left"></div>
    <div class="connector connector-out connector-right" data-side="right"></div>
  `;

  article.querySelector(".node-amount").addEventListener("input", async (event) => {
    const parsed = Number(event.target.value);
    node.amount = Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
    refreshBalanceNode();
    await persist();
  });

  article.querySelector(".node-recurring").addEventListener("change", async (event) => {
    node.recurring = event.target.checked;
    await persist();
  });

  article.querySelector(".disconnect-button")?.addEventListener("click", async (event) => {
    event.stopPropagation();
    await detachNode(node.id);
  });

  article.querySelector(".delete-button").addEventListener("click", async (event) => {
    event.stopPropagation();
    await deleteNode(node.id);
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

  refreshBalanceNode();
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
    x: clamp(position.x, 24, WORLD_WIDTH - 260),
    y: clamp(position.y, 24, WORLD_HEIGHT - 150),
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

toolButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setSelectedTool(state.selectedTool === button.dataset.tool ? null : button.dataset.tool);
  });
});

prevMonthButton.addEventListener("click", () => shiftMonth(-1));
nextMonthButton.addEventListener("click", () => shiftMonth(1));

zoomInButton.addEventListener("click", () => setZoom(state.scale + 0.1));
zoomOutButton.addEventListener("click", () => setZoom(state.scale - 0.1));
zoomResetButton.addEventListener("click", () => setZoom(1));

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
  const data = await state.db.load();
  state.months = data.months || {};
  const initialKey = monthKeyForDate(new Date());
  ensureMonth(initialKey);
  await selectMonth(initialKey);
  setSelectedTool(null);
  setWorldTransform();
  setZoom(1);
  setInterval(maybeRollToCurrentMonth, 60 * 1000);
}

init();
