// "Baixar o mês": arte, legenda, link e certidão de cada post. Um mês pode passar da memória do Worker, então o zip é montado
// em streaming, e JPEG e MP4 entram sem compressão.
import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import type { Env } from '../env';

export const mesValido = (m: unknown): m is string => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

function proximoMes(m: string) {
  const [a, b] = m.split('-').map(Number);
  return b === 12 ? `${a + 1}-01` : `${a}-${String(b + 1).padStart(2, '0')}`;
}

interface Linha { peca_id: string; url: string | null; publicado_em: string | null; versao: number; conteudo_json: string | null; arte_r2_keys_json: string | null }

export async function zipDoMes(env: Env, tenantId: string, mes: string) {
  const { results } = await env.DB.prepare(
    `SELECT pu.peca_id, pu.url, pu.publicado_em, pc.versao, pc.conteudo_json, pc.arte_r2_keys_json
       FROM publicacoes pu JOIN pecas pc ON pc.id = pu.peca_id AND pc.tenant_id = pu.tenant_id
      WHERE pu.tenant_id = ? AND pu.status = 'publicada' AND pu.modo != 'simulada' AND pu.publicado_em >= ? AND pu.publicado_em < ?
      ORDER BY pu.publicado_em, pu.id`,
  ).bind(tenantId, `${mes}-01`, `${proximoMes(mes)}-01`).all<Linha>();

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const escritor = writable.getWriter();
  let fila: Promise<unknown> = Promise.resolve();
  const zip = new Zip((erro, dados, fim) => {
    if (erro) { fila = fila.then(() => escritor.abort(erro)); return; }
    fila = fila.then(() => escritor.write(dados));
    if (fim) fila = fila.then(() => escritor.close());
  });
  const texto = (nome: string, s: string) => {
    const f = new ZipPassThrough(nome);
    zip.add(f);
    f.push(strToU8(s), true);
  };
  const objeto = async (nome: string, chave: string) => {
    const o = await env.MEDIA.get(chave);
    if (!o) return;
    const f = new ZipPassThrough(nome);
    zip.add(f);
    const leitor = o.body.getReader();
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      f.push(value);
      await fila;   // quem baixa dita o ritmo: nada acumula na memória
    }
    f.push(new Uint8Array(0), true);
    await fila;
  };

  const montar = async () => {
    texto('LEIA-ME.txt', `Arquivo de ${mes}: ${results.length} posts. Cada pasta tem as artes, a legenda, o link e, quando houver, a certidão (manifesto.json e carimbo.tsr).\n`);
    for (const [i, r] of results.entries()) {
      const pasta = `${String(i + 1).padStart(3, '0')}-${(r.publicado_em ?? '').slice(0, 10)}`;
      const c = (r.conteudo_json ? JSON.parse(r.conteudo_json) : {}) as { legenda?: string };
      texto(`${pasta}/legenda.txt`, c.legenda ?? '');
      texto(`${pasta}/link.txt`, r.url ?? '');
      const artes = (r.arte_r2_keys_json ? JSON.parse(r.arte_r2_keys_json) : []) as { jpg?: string; mp4?: string }[];
      for (const [j, a] of artes.entries()) {
        if (a.jpg) await objeto(`${pasta}/card-${String(j + 1).padStart(2, '0')}.jpg`, a.jpg);
        if (a.mp4) await objeto(`${pasta}/video.mp4`, a.mp4);
      }
      const ce = await env.DB.prepare('SELECT r2_manifesto, r2_carimbo FROM certidoes WHERE peca_id = ? AND tenant_id = ? AND versao = ?').bind(r.peca_id, tenantId, r.versao).first<{ r2_manifesto: string | null; r2_carimbo: string | null }>();
      if (ce?.r2_manifesto) await objeto(`${pasta}/certidao/manifesto.json`, ce.r2_manifesto);
      if (ce?.r2_carimbo) await objeto(`${pasta}/certidao/carimbo.tsr`, ce.r2_carimbo);
    }
    zip.end();
    await fila;
  };
  const pronto = montar().catch((e) => escritor.abort(e));
  return { corpo: readable, pronto };
}
