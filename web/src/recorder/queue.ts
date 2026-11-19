// An unconfirmed slice stays in IndexedDB: the tab may crash, and what was recorded uploads when the network comes back.
const DB = "redacao-gravador";
const STORE = "fatias";

export interface SliceSaved { sessao: string; segmento: number; fatia: number; blob: Blob }

function launch() {
  return new Promise<IDBDatabase>((ok, failed) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: ["sessao", "segmento", "fatia"] }); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => failed(r.error);
  });
}

async function inStore<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await launch();
  try {
    return await new Promise<T>((ok, failed) => {
      const request = make(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => ok(request.result);
      request.onerror = () => failed(request.error);
    });
  } finally {
    db.close();
  }
}

export const saveSlice = (f: SliceSaved) => inStore("readwrite", (l) => l.put(f));
export const deleteSlice = (f: Omit<SliceSaved, "blob">) => inStore("readwrite", (l) => l.delete([f.sessao, f.segmento, f.fatia]));
export const slicesSession = (session: string) =>
  inStore<SliceSaved[]>("readonly", (l) => l.getAll(IDBKeyRange.bound([session], [session, []])));
