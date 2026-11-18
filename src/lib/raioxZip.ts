// Leitura do arquivo do Instagram em streaming: o zip pode ter gigabytes, e nada dele sai inteiro do navegador. Roda duas
// vezes sobre o arquivo: a primeira só lê os JSON, porque a ordem das pastas no zip não é garantida; a segunda só lê as mídias.
import { Unzip, UnzipInflate } from 'fflate';
import { acharPosts, type PostArquivo } from './raiox';

interface Entrada { nome: string; bytes: Uint8Array }

async function percorrer(stream: ReadableStream<Uint8Array>, quer: (nome: string) => boolean, usar: (e: Entrada) => Promise<void>, viu?: (nome: string) => void) {
  const prontos: Entrada[] = [];
  let erro: Error | null = null;
  const uz = new Unzip((arq) => {
    viu?.(arq.name);
    if (!quer(arq.name)) return;
    const partes: Uint8Array[] = [];
    arq.ondata = (e, dado, fim) => {
      if (e) { erro = e; return; }
      partes.push(dado);
      if (!fim) return;
      const bytes = new Uint8Array(partes.reduce((n, p) => n + p.byteLength, 0));
      let i = 0;
      for (const p of partes) { bytes.set(p, i); i += p.byteLength; }
      prontos.push({ nome: arq.name, bytes });
    };
    arq.start();
  });
  uz.register(UnzipInflate);
  const leitor = stream.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    uz.push(value);
    if (erro) throw erro;
    while (prontos.length) await usar(prontos.shift()!);
  }
  uz.push(new Uint8Array(0), true);
  if (erro) throw erro;
  while (prontos.length) await usar(prontos.shift()!);
}

const decodificar = new TextDecoder();

/** Os posts do arquivo. `html`: exportação em HTML, que não dá para ler. Mensagens privadas ficam de fora. */
export async function lerPostsDoZip(stream: ReadableStream<Uint8Array>): Promise<{ posts: PostArquivo[]; html: boolean }> {
  const porUri = new Map<string, PostArquivo>();
  let viuHtml = false;
  await percorrer(stream, (nome) => /\.json$/i.test(nome) && !/(^|\/)messages\//i.test(nome), async ({ bytes }) => {
    try {
      for (const p of acharPosts(JSON.parse(decodificar.decode(bytes)))) if (!porUri.has(p.uri)) porUri.set(p.uri, p);
    } catch { /* JSON quebrado não para a leitura dos outros */ }
  }, (nome) => { if (/\.html?$/i.test(nome)) viuHtml = true; });
  return { posts: [...porUri.values()].sort((a, b) => b.data.localeCompare(a.data)), html: viuHtml && porUri.size === 0 };
}

/** Entrega cada mídia dos `posts`, resolvendo o `uri` pela raiz do zip, que pode ter uma pasta a mais na frente. */
export async function lerMidiasDoZip(stream: ReadableStream<Uint8Array>, posts: PostArquivo[], usar: (post: PostArquivo, bytes: Uint8Array) => Promise<void>) {
  const porFim = new Map(posts.map((p) => [p.uri.split('/').pop()!, p]));
  const achar = (nome: string) => {
    const p = porFim.get(nome.split('/').pop()!);
    return p && (nome === p.uri || nome.endsWith(`/${p.uri}`)) ? p : null;
  };
  await percorrer(stream, (nome) => !!achar(nome), async ({ nome, bytes }) => { await usar(achar(nome)!, bytes); });
}
