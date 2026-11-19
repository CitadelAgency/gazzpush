// "Download the month": art, caption, link and certificate for each post. A month can exceed the Worker's memory, so the
// zip is streamed, and JPEG and MP4 go in uncompressed.
import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import type { Env } from '../env';

export const validMonth = (m: unknown): m is string => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

function nextMonth(m: string) {
  const [a, b] = m.split('-').map(Number);
  return b === 12 ? `${a + 1}-01` : `${a}-${String(b + 1).padStart(2, '0')}`;
}

interface Line { peca_id: string; url: string | null; publicado_em: string | null; versao: number; conteudo_json: string | null; arte_r2_keys_json: string | null }

export async function zipMonth(env: Env, tenantId: string, month: string) {
  const { results } = await env.DB.prepare(
    `SELECT pu.peca_id, pu.url, pu.publicado_em, pc.versao, pc.conteudo_json, pc.arte_r2_keys_json
       FROM publicacoes pu JOIN pecas pc ON pc.id = pu.peca_id AND pc.tenant_id = pu.tenant_id
      WHERE pu.tenant_id = ? AND pu.status = 'publicada' AND pu.modo != 'simulada' AND pu.publicado_em >= ? AND pu.publicado_em < ?
      ORDER BY pu.publicado_em, pu.id`,
  ).bind(tenantId, `${month}-01`, `${nextMonth(month)}-01`).all<Line>();

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let queue: Promise<unknown> = Promise.resolve();
  const zip = new Zip((error, data, end) => {
    if (error) { queue = queue.then(() => writer.abort(error)); return; }
    queue = queue.then(() => writer.write(data));
    if (end) queue = queue.then(() => writer.close());
  });
  const text = (name: string, s: string) => {
    const f = new ZipPassThrough(name);
    zip.add(f);
    f.push(strToU8(s), true);
  };
  const object = async (name: string, key: string) => {
    const o = await env.MEDIA.get(key);
    if (!o) return;
    const f = new ZipPassThrough(name);
    zip.add(f);
    const reader = o.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      f.push(value);
      await queue;   // the downloader sets the pace: nothing piles up in memory
    }
    f.push(new Uint8Array(0), true);
    await queue;
  };

  const build = async () => {
    text('LEIA-ME.txt', `Arquivo de ${month}: ${results.length} posts. Cada pasta tem as artes, a legenda, o link e, quando houver, a certidão (manifesto.json e carimbo.tsr).\n`);
    for (const [i, r] of results.entries()) {
      const folder = `${String(i + 1).padStart(3, '0')}-${(r.publicado_em ?? '').slice(0, 10)}`;
      const c = (r.conteudo_json ? JSON.parse(r.conteudo_json) : {}) as { legenda?: string };
      text(`${folder}/legenda.txt`, c.legenda ?? '');
      text(`${folder}/link.txt`, r.url ?? '');
      const artwork = (r.arte_r2_keys_json ? JSON.parse(r.arte_r2_keys_json) : []) as { jpg?: string; mp4?: string }[];
      for (const [j, a] of artwork.entries()) {
        if (a.jpg) await object(`${folder}/card-${String(j + 1).padStart(2, '0')}.jpg`, a.jpg);
        if (a.mp4) await object(`${folder}/video.mp4`, a.mp4);
      }
      const ce = await env.DB.prepare('SELECT r2_manifesto, r2_carimbo FROM certidoes WHERE peca_id = ? AND tenant_id = ? AND versao = ?').bind(r.peca_id, tenantId, r.versao).first<{ r2_manifesto: string | null; r2_carimbo: string | null }>();
      if (ce?.r2_manifesto) await object(`${folder}/certidao/manifesto.json`, ce.r2_manifesto);
      if (ce?.r2_carimbo) await object(`${folder}/certidao/carimbo.tsr`, ce.r2_carimbo);
    }
    zip.end();
    await queue;
  };
  const ready = build().catch((e) => writer.abort(e));
  return { corpo: readable, pronto: ready };
}
