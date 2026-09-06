// Minimal IndexedDB key/value store, dependency-free.
// Shared between the React app and the service worker (which cannot read
// localStorage) so reminder settings survive when the app is closed.
const DB = "run5k";
const STORE = "kv";

// One connection, reused. Every get/set used to open its own: the live-run
// notification alone reads the reminder four times a second for the length of a
// run, so a 40-minute run leaked ~10k IDBDatabase handles. The promise is
// dropped if the connection ever closes or errors, so the next call reopens.
let conn = null;
function open() {
  if (conn) return conn;
  conn = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      const db = req.result;
      // A version change from another tab, or the browser evicting storage,
      // closes the handle underneath us — forget it so we reconnect.
      db.onclose = db.onversionchange = () => { conn = null; try { db.close(); } catch { /* already closed */ } };
      resolve(db);
    };
    req.onerror = () => { conn = null; reject(req.error); };
  }).catch((e) => { conn = null; throw e; });
  return conn;
}

export async function idbGet(key) {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      tx.onsuccess = () => resolve(tx.result);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    conn = null;   // the handle may be dead; the next call reopens
    return undefined;
  }
}

export async function idbSet(key, value) {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    conn = null;   // the handle may be dead; the next call reopens
  }
}
