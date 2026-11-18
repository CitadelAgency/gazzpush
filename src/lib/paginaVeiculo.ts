// Página pública do veículo (`/v/:slug`): os posts publicados de verdade, para o público achar o veículo quando a conta cai.
// Desligada por padrão. Sem nada interno: só arte, legenda e link.
import type { Env } from '../env';
import { assinarMedia } from './crypto';

export const POSTS_POR_PAGINA = 30;

const h = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Post { arte: string | null; legenda: string; link: string | null; em: string | null; manchete: string; publicidade: boolean }

export function htmlVeiculo(c: { nome: string; slug: string; idioma: string; posts: Post[]; pagina: number; temMais: boolean }) {
  const en = c.idioma === 'en';
  const tr = (pt: string, ing: string) => (en ? ing : pt);
  const data = (s: string) => new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`).toLocaleDateString(en ? 'en-US' : 'pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  const posts = c.posts.map((p) => `<li>
${p.arte ? `<img src="${h(p.arte)}" alt="${h(p.manchete)}" width="540" height="675" loading="lazy">` : ''}
<div>${p.publicidade ? `<p class="publi">${h(tr('Publicidade', 'Advertisement'))}</p>` : ''}<h2>${h(p.manchete)}</h2>
${p.em ? `<p class="mono">${h(data(p.em))}</p>` : ''}<p class="legenda">${h(p.legenda)}</p>
${p.link ? `<p><a href="${h(p.link)}" rel="noopener">${h(tr('Ver no Instagram', 'View on Instagram'))}</a></p>` : ''}</div></li>`).join('\n');
  const nav = [
    c.pagina > 1 ? `<a href="/v/${h(c.slug)}?p=${c.pagina - 1}">${h(tr('Mais recentes', 'Newer'))}</a>` : '',
    c.temMais ? `<a href="/v/${h(c.slug)}?p=${c.pagina + 1}">${h(tr('Mais antigos', 'Older'))}</a>` : '',
  ].filter(Boolean).join(' ');
  return `<!DOCTYPE html>
<html lang="${en ? 'en' : 'pt-BR'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(c.nome)}</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#F7F9FA;color:#2A2D33;font:400 17px/1.6 "Atkinson Hyperlegible Next",system-ui,sans-serif}
main{max-width:680px;margin:0 auto;padding:40px 20px 64px}h1{font-size:30px;line-height:1.2;margin:0 0 4px;color:#15171B}h2{font-size:20px;line-height:1.3;margin:0 0 4px;color:#15171B}
.mono{font-family:"Fragment Mono",ui-monospace,monospace;font-size:13px;color:#5A5E66;margin:0 0 8px}.apoio{color:#5A5E66;margin:0 0 24px}.publi{font-family:"Fragment Mono",ui-monospace,monospace;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#15171B;margin:0 0 4px}
ul{list-style:none;margin:0;padding:0}li{display:grid;gap:14px;padding:24px 0;border-top:1px solid rgb(21 23 27 / .11)}img{display:block;width:100%;max-width:360px;height:auto}
.legenda{white-space:pre-line;margin:0 0 8px}a{color:#0B5CC4;text-underline-offset:2px}nav{display:flex;gap:20px;margin-top:24px}
</style></head><body><main>
<h1>${h(c.nome)}</h1><p class="apoio">${h(tr('Os posts publicados por este veículo.', 'The posts published by this outlet.'))}</p>
${c.posts.length ? `<ul>${posts}</ul>` : `<p>${h(tr('Nenhum post publicado ainda.', 'No posts published yet.'))}</p>`}
${nav ? `<nav>${nav}</nav>` : ''}
</main></body></html>`;
}

/** null: não existe, ou está desligada. O slug não diz qual dos dois. */
export async function paginaDoVeiculo(env: Env, slug: string, pagina: number): Promise<string | null> {
  const t = await env.DB.prepare('SELECT id, nome, slug, idioma FROM tenants WHERE slug = ? AND pagina_publica_em IS NOT NULL').bind(slug).first<{ id: string; nome: string; slug: string; idioma: string }>();
  if (!t) return null;
  const p = Number.isInteger(pagina) && pagina > 0 ? pagina : 1;
  const { results } = await env.DB.prepare(
    `SELECT pu.url, pu.publicado_em, pc.conteudo_json, json_extract(pc.arte_r2_keys_json, '$[0].jpg') AS capa, pa.tipo_post
       FROM publicacoes pu JOIN pecas pc ON pc.id = pu.peca_id AND pc.tenant_id = pu.tenant_id
       JOIN pautas pa ON pa.id = pc.pauta_id AND pa.tenant_id = pc.tenant_id
      WHERE pu.tenant_id = ? AND pu.status = 'publicada' AND pu.modo != 'simulada' AND pc.status = 'publicada'
      ORDER BY pu.publicado_em DESC, pu.id DESC LIMIT ? OFFSET ?`,
  ).bind(t.id, POSTS_POR_PAGINA + 1, (p - 1) * POSTS_POR_PAGINA).all<{ url: string | null; publicado_em: string | null; conteudo_json: string | null; capa: string | null; tipo_post: string | null }>();
  const posts = await Promise.all(results.slice(0, POSTS_POR_PAGINA).map(async (r) => {
    const c = (r.conteudo_json ? JSON.parse(r.conteudo_json) : {}) as { manchete?: string; legenda?: string };
    return {
      arte: r.capa ? await assinarMedia(env, r.capa, 3600) : null, legenda: c.legenda ?? '', manchete: c.manchete ?? '', em: r.publicado_em,
      link: r.url && /^https?:\/\//.test(r.url) ? r.url : null, publicidade: r.tipo_post === 'publicidade',
    };
  }));
  return htmlVeiculo({ nome: t.nome, slug: t.slug, idioma: t.idioma, posts, pagina: p, temMais: results.length > POSTS_POR_PAGINA });
}
