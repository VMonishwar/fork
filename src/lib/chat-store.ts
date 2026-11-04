// Chat storage: IndexedDB (large, private to this browser) with a localStorage fallback.
// Old chats saved in localStorage are moved over on first load.
const DB = "fork";
const STORE = "kv";
const KEY = "conversations";
export const LEGACY_KEY = "fork:conversations";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((res) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((res, rej) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result as T);
    req.onerror = () => rej(req.error);
  });
}

export async function loadChats(): Promise<unknown[]> {
  const legacy = (() => {
    try { const v = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
  })();
  const db = await openDb();
  if (!db) return legacy;
  try {
    const saved = await tx<unknown>(db, "readonly", (s) => s.get(KEY));
    if (Array.isArray(saved)) return saved;
    if (legacy.length) {
      await tx(db, "readwrite", (s) => s.put(legacy, KEY));
      localStorage.removeItem(LEGACY_KEY);
    }
    return legacy;
  } catch { return legacy; }
}

let pending: unknown[] | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
export function saveChats(list: unknown[]): void {
  pending = list;
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}
async function flush() {
  const list = pending; pending = null;
  if (!list) return;
  const db = await openDb();
  try {
    if (db) { await tx(db, "readwrite", (s) => s.put(list, KEY)); return; }
  } catch { /* fall through */ }
  try { localStorage.setItem(LEGACY_KEY, JSON.stringify(list)); } catch { /* full */ }
}

/** Ask the browser not to clear Fork's data when space runs low. */
export function requestPersistence(): void {
  try { void navigator.storage?.persist?.(); } catch { /* unsupported */ }
}
