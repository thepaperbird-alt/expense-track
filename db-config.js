const FIREBASE_VERSION = "12.11.0";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCvzQYlmRpIDiOqdGABJf8SgZajbdlpQ7M",
  authDomain: "expense-537b5.firebaseapp.com",
  projectId: "expense-537b5",
  storageBucket: "expense-537b5.firebasestorage.app",
  messagingSenderId: "463071851103",
  appId: "1:463071851103:web:91524a8fb09968876f21ea",
};

const COLLECTION_NAME = "expenseFlowMonths";

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
  const nodes = Array.isArray(month?.nodes) ? month.nodes.map(normalizeNode) : [];
  const hasBalanceNode = nodes.some((node) => node.id === "balance" && node.type === "balance");

  if (!hasBalanceNode) {
    nodes.unshift({
      id: "balance",
      type: "balance",
      purpose: "",
      amount: 0,
      recurring: false,
      connectedTo: null,
      parentId: null,
      connectedAt: null,
      connectedSide: null,
      targetSide: null,
      x: 420,
      y: 420,
    });
  }

  return {
    key: monthKey,
    baseBalance: Number.isFinite(Number(month?.baseBalance)) ? Number(month.baseBalance) : 0,
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
