const FIREBASE_VERSION = "12.11.0";

const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

const COLLECTION_NAME = "expenseFlowMonths";
const BALANCE_NODE_DEFS = [
  { id: "balance-axis", bankKey: "axis", x: 320, y: 120 },
  { id: "balance-kotak", bankKey: "kotak", x: 580, y: 120 },
];
const DEFAULT_BASE_BALANCES = {
  axis: 50000,
  kotak: 0,
};

function createLocalFallback(storageKey) {
  return {
    kind: "local",
    async load() {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : { months: {} };
    },
    async save(data) {
      localStorage.setItem(storageKey, JSON.stringify(data));
    },
  };
}

function hasFirebaseConfig() {
  return ["apiKey", "authDomain", "projectId", "appId"].every(
    (key) => typeof FIREBASE_CONFIG[key] === "string" && FIREBASE_CONFIG[key].trim().length > 0
  );
}

function normalizeNode(node) {
  return {
    id: String(node?.id || ""),
    type: node?.type === "income" || node?.type === "expense" || node?.type === "balance" ? node.type : "expense",
    purpose: typeof node?.purpose === "string" ? node.purpose : "",
    amount: Number.isFinite(Number(node?.amount)) ? Number(node.amount) : 0,
    recurring: Boolean(node?.recurring),
    connectedTo: typeof node?.connectedTo === "string" ? node.connectedTo : null,
    parentId: typeof node?.parentId === "string" ? node.parentId : null,
    connectedAt: typeof node?.connectedAt === "string" ? node.connectedAt : null,
    connectedSide: node?.connectedSide === "left" || node?.connectedSide === "right" ? node.connectedSide : null,
    targetSide: node?.targetSide === "left" || node?.targetSide === "right" ? node.targetSide : null,
    x: Number.isFinite(Number(node?.x)) ? Number(node.x) : 0,
    y: Number.isFinite(Number(node?.y)) ? Number(node.y) : 0,
  };
}

function normalizeMonth(monthKey, month) {
  const rawNodes = Array.isArray(month?.nodes) ? month.nodes.map(normalizeNode) : [];
  const legacyBaseBalance = Number.isFinite(Number(month?.baseBalance)) ? Number(month.baseBalance) : null;
  const baseBalances = {
    ...DEFAULT_BASE_BALANCES,
    ...(month?.baseBalances && typeof month.baseBalances === "object" ? month.baseBalances : {}),
  };

  if (legacyBaseBalance !== null && !Number.isFinite(Number(month?.baseBalances?.axis))) {
    baseBalances.axis = legacyBaseBalance;
  }

  const normalizedNodes = rawNodes
    .filter((node) => node.type !== "balance")
    .map((node) => ({
      ...node,
      connectedTo: node.connectedTo === "balance" ? "balance-axis" : node.connectedTo,
    }));

  const balanceNodes = BALANCE_NODE_DEFS.map((balanceDef) => {
    const existingNode = rawNodes.find((node) => node.id === balanceDef.id && node.type === "balance");

    if (existingNode) {
      const looksLikeLegacyPosition = existingNode.y >= 360;
      return {
        ...existingNode,
        x: looksLikeLegacyPosition ? balanceDef.x : existingNode.x,
        y: looksLikeLegacyPosition ? balanceDef.y : existingNode.y,
      };
    }

    return {
      id: balanceDef.id,
      type: "balance",
      purpose: "",
      amount: 0,
      recurring: false,
      connectedTo: null,
      parentId: null,
      connectedAt: null,
      connectedSide: null,
      targetSide: null,
      x: balanceDef.x,
      y: balanceDef.y,
    };
  });

  const nodes = [...balanceNodes, ...normalizedNodes];

  return {
    key: monthKey,
    baseBalances: {
      axis: Number.isFinite(Number(baseBalances.axis)) ? Number(baseBalances.axis) : DEFAULT_BASE_BALANCES.axis,
      kotak: Number.isFinite(Number(baseBalances.kotak)) ? Number(baseBalances.kotak) : DEFAULT_BASE_BALANCES.kotak,
    },
    nextId: Number.isFinite(Number(month?.nextId)) ? Number(month.nextId) : nodes.length + 1,
    nodes,
  };
}

async function loadFirebaseModules() {
  const [{ initializeApp, getApps, getApp }, firestore] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`),
  ]);

  return {
    initializeApp,
    getApps,
    getApp,
    ...firestore,
  };
}

export async function createCloudDb(storageKey) {
  if (!hasFirebaseConfig()) {
    console.warn("Firestore is not configured yet. Falling back to local storage.");
    return createLocalFallback(storageKey);
  }

  const {
    initializeApp,
    getApps,
    getApp,
    getFirestore,
    collection,
    deleteDoc,
    doc,
    getDocs,
    setDoc,
  } = await loadFirebaseModules();

  const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
  const db = getFirestore(app);

  return {
    kind: "cloud",
    async load() {
      const snapshot = await getDocs(collection(db, COLLECTION_NAME));
      const months = {};

      snapshot.forEach((monthDoc) => {
        months[monthDoc.id] = normalizeMonth(monthDoc.id, monthDoc.data());
      });

      return { months };
    },
    async save(data) {
      const months = data?.months || {};
      const monthKeys = Object.keys(months);
      const collectionRef = collection(db, COLLECTION_NAME);
      const existingSnapshot = await getDocs(collectionRef);
      const existingKeys = new Set(existingSnapshot.docs.map((monthDoc) => monthDoc.id));

      await Promise.all(
        monthKeys.map((monthKey) =>
          setDoc(doc(db, COLLECTION_NAME, monthKey), normalizeMonth(monthKey, months[monthKey]))
        )
      );

      await Promise.all(
        [...existingKeys]
          .filter((monthKey) => !monthKeys.includes(monthKey))
          .map((monthKey) => deleteDoc(doc(db, COLLECTION_NAME, monthKey)))
      );
    },
  };
}
