// Fatia sem confirmação fica no IndexedDB: a aba pode cair, e o que foi gravado sobe quando a rede voltar.
const BANCO = "redacao-gravador";
const LOJA = "fatias";

export interface FatiaGuardada { sessao: string; segmento: number; fatia: number; blob: Blob }

function abrir() {
  return new Promise<IDBDatabase>((ok, falhou) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(LOJA, { keyPath: ["sessao", "segmento", "fatia"] }); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falhou(r.error);
  });
}

async function naLoja<T>(modo: IDBTransactionMode, fazer: (loja: IDBObjectStore) => IDBRequest<T>) {
  const db = await abrir();
  try {
    return await new Promise<T>((ok, falhou) => {
      const pedido = fazer(db.transaction(LOJA, modo).objectStore(LOJA));
      pedido.onsuccess = () => ok(pedido.result);
      pedido.onerror = () => falhou(pedido.error);
    });
  } finally {
    db.close();
  }
}

export const guardarFatia = (f: FatiaGuardada) => naLoja("readwrite", (l) => l.put(f));
export const apagarFatia = (f: Omit<FatiaGuardada, "blob">) => naLoja("readwrite", (l) => l.delete([f.sessao, f.segmento, f.fatia]));
export const fatiasDaSessao = (sessao: string) =>
  naLoja<FatiaGuardada[]>("readonly", (l) => l.getAll(IDBKeyRange.bound([sessao], [sessao, []])));
