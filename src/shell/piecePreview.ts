// What carousel editing in Review needs to build each card's preview in the browser with the same template as the
// render: the card's fixed part (baseCard), logo, illustration and photos with signed URLs (1 h), the watermark and
// the brand's CTAs to choose from. No brand R2 keys and no copy outside the CTAs.
import type { Env } from '../env';
import { signMedia } from '../lib/crypto';
import { illustrationsPrefix } from '../lib/illustrate';
import { loadLead } from '../lib/lead';
import { chooseCta } from '../lib/drafting';
import type { PieceStyle } from '../lib/style';
import { baseCard, leadStyle, type ArtRendered } from '../lib/render';
import { currentIllustration } from './editing';
import type { Card } from '../lib/cards';

export async function previewPiece(env: Env, tenantId: string, piece: { id: string; pauta_id: string }, cards: Card[], artwork: ArtRendered[], style?: PieceStyle) {
  const loaded = await loadLead(env, tenantId, piece.pauta_id).catch(() => null);
  if (!loaded) return null;
  const lead = leadStyle(loaded, style);
  const brand = lead.marca;
  // The illustration the current version used (the same one editing will use), or the brand's default art.
  const artKey = (await currentIllustration(env, tenantId, piece.id, artwork)) ?? brand.arteR2 ?? null;
  const prefix = illustrationsPrefix(tenantId, piece.id);
  const photos = [...new Set(cards.flatMap((c) => [c.imagem, c.ilustracao]).filter((k): k is string => typeof k === 'string' && (k.startsWith(`fotos/${tenantId}/${piece.id}/`) || k.startsWith(prefix))))];
  const fallback = chooseCta(lead);
  const base = baseCard(lead);
  const logoSponsorship = lead.patrocinador?.logoR2 ? await signMedia(env, lead.patrocinador.logoR2, 3600) : null;
  return {
    base: base.patrocinio ? { ...base, patrocinio: { ...base.patrocinio, logo: logoSponsorship } } : base,
    modo: lead.modo ?? 'local',
    nome: brand.nome ?? '', handle: brand.handle ?? '',
    logo: brand.logoR2 ? await signMedia(env, brand.logoR2, 3600) : null,
    arte: artKey ? await signMedia(env, artKey, 3600) : null,
    marcaDagua: brand.marcaDagua ?? null,
    imagens: Object.fromEntries(await Promise.all(photos.map(async (k) => [k, await signMedia(env, k, 3600)] as const))),
    // The CTAs the editor can choose for the last card (index into marca.ctas); `padrao` is the rotation's.
    // Rich CTA (sample phone): its configuration, so the preview comes out in the cta.html template as in the render.
    convites: (brand.ctas ?? []).map((c, index) => ({
      indice: index, titulo: c.titulo, texto: c.texto,
      rico: c.telefone ? { titulo: c.titulo, texto: c.texto, url: c.url, acao: c.acao, edicao: c.edicao, destaques: c.destaques, telefone: c.telefone } : null,
    })).filter((c) => c.titulo && c.texto),
    convitePadrao: (brand.ctas ?? []).indexOf(fallback),
    conviteGenerico: { titulo: fallback.titulo, texto: fallback.texto },
  };
}
