// Carousel editing in Review (Phase 3): the editor changes text, order, count, layout, photo and which CTA goes in.
// Saving creates a new version in peca_versoes (author = whoever saved), revalidates (numbers, dates, days, names) and,
// if it passed, renders only the cards whose HTML changed. It does not spend a Rewrite round. Expected version: someone
// else saved first → 409.
import type { Env } from '../env';
import { newId } from '../lib/db';
import type { PieceStyle } from '../lib/style';
import { freezeToPiece, listStyles } from '../lib/styles';
import { illustrationsPrefix } from '../lib/illustrate';
import { loadLead, type Lead } from '../lib/lead';
import { cardInvite, ctaDraft, validCta, swapClosing, type Draft } from '../lib/drafting';
import { validate, type Validation } from '../lib/validation';
import { LayoutError, renderCards, type OpenBrowser, type ArtRendered } from '../lib/render';
import { AUTHOR_PHOTO_MAX, MAX_CARDS, ORIGIN_PHOTO_TYPES, isFocus, isLayout, layoutOf, normalizeCards, type Card, type Focus, type PhotoOrigin, type Sentence, type OldRole, type OriginPhotoType } from '../lib/cards';
import type { Language } from './language';

export const ID_CARD = /^[A-Za-z0-9_-]{1,40}$/;
const TEXT_MAX = 600;

/** R2 prefix for a piece's own photos: a card only accepts a photo uploaded for this piece of this outlet. */
export const photosPrefix = (tenantId: string, pieceId: string) => `fotos/${tenantId}/${pieceId}/`;

export type ResultEdit =
  | { ok: true; versao: number; validacao: Validation; renderizados: string[]; reaproveitados: string[] }
  | { ok: false; status: 400 | 404 | 409; erro: string };

/**
 * Reads and cleans the request's cards. The CTA comes with only its id and which CTA: title and text come from the
 * brand. `gravadas`: the current version's photos. A new photo requires saying who took it; one already on the piece
 * before the origin field existed still counts.
 */
export async function readCards(env: Env, lead: Lead, tenantId: string, pieceId: string, body: unknown, language: Language = 'pt-BR', recorded: ReadonlySet<string> = new Set()): Promise<Card[] | string> {
  const tr = (pt: string, en: string) => (language === 'en' ? en : pt);
  if (!Array.isArray(body) || !body.length || body.length > MAX_CARDS) return tr(`cards: de 1 a ${MAX_CARDS}`, `cards: 1 to ${MAX_CARDS}`);
  const ids = new Set<string>();
  const cards: Card[] = [];
  for (const [i, raw] of body.entries()) {
    const c = raw as Record<string, unknown>;
    if (!c || typeof c !== 'object') return tr(`cards[${i}]: objeto`, `cards[${i}]: object`);
    // An object property name (__proto__, constructor…) cannot be an id: the id becomes a map key in validation.
    if (typeof c.id !== 'string' || !ID_CARD.test(c.id) || ids.has(c.id) || c.id in Object.prototype) return tr(`cards[${i}].id: único, letras, números, - ou _`, `cards[${i}].id: unique, letters, numbers, - or _`);
    ids.add(c.id);
    if (!isLayout(c.layout)) return tr(`cards[${i}].layout inválido`, `cards[${i}].layout is invalid`);
    if (c.layout === 'convite') {
      if (c.cta !== undefined && c.cta !== null && !validCta(lead, c.cta)) return tr(`cards[${i}].cta: escolha um dos convites da marca`, `cards[${i}].cta: choose one of the brand's invite cards`);
      cards.push(cardInvite(lead, (c.cta as number | null | undefined) ?? null, c.id));
      continue;
    }
    if (typeof c.titulo !== 'string' || c.titulo.length > TEXT_MAX) return tr(`cards[${i}].titulo: texto`, `cards[${i}].titulo: text`);
    if (!Array.isArray(c.frases) || c.frases.length > 6) return tr(`cards[${i}].frases: lista`, `cards[${i}].frases: list`);
    const sentences: Sentence[] = [];
    for (const [j, f] of (c.frases as Record<string, unknown>[]).entries()) {
      if (!f || typeof f.texto !== 'string' || f.texto.length > TEXT_MAX) return tr(`cards[${i}].frases[${j}].texto: texto`, `cards[${i}].frases[${j}].texto: text`);
      if (f.fatoId !== null && f.fatoId !== undefined && typeof f.fatoId !== 'string') return tr(`cards[${i}].frases[${j}].fatoId: id do fato ou null`, `cards[${i}].frases[${j}].fatoId: fact id or null`);
      // The author mark is stored as it came; validation decides whether it counts (author outlet only, human version only).
      if (f.rotulo !== undefined && typeof f.rotulo !== 'string') return tr(`cards[${i}].frases[${j}].rotulo: texto`, `cards[${i}].frases[${j}].rotulo: text`);
      const label = typeof f.rotulo === 'string' ? f.rotulo.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
      sentences.push({ texto: f.texto.replace(/\s+/g, ' ').trim(), fatoId: (f.fatoId as string | null | undefined) ?? null, ...(f.autor === true ? { autor: true } : {}), ...(label ? { rotulo: label } : {}) });
    }
    let image: string | undefined;
    if (c.imagem !== undefined && c.imagem !== null && c.imagem !== '') {
      if (typeof c.imagem !== 'string' || !c.imagem.startsWith(photosPrefix(tenantId, pieceId)) || c.imagem.includes('..')) return tr(`cards[${i}].imagem: foto subida para esta peça`, `cards[${i}].imagem: a photo uploaded for this post`);
      if (!(await env.MEDIA.head(c.imagem))) return tr(`cards[${i}].imagem: foto não encontrada`, `cards[${i}].imagem: photo not found`);
      image = c.imagem;
    }
    let illustration: string | undefined;
    if (c.ilustracao !== undefined && c.ilustracao !== null && c.ilustracao !== '') {
      if (typeof c.ilustracao !== 'string' || !c.ilustracao.startsWith(illustrationsPrefix(tenantId, pieceId)) || c.ilustracao.includes('..')) return tr(`cards[${i}].ilustracao: ilustração gerada para esta peça`, `cards[${i}].ilustracao: an illustration made for this post`);
      if (!(await env.MEDIA.head(c.ilustracao))) return tr(`cards[${i}].ilustracao: não encontrada`, `cards[${i}].ilustracao: not found`);
      illustration = c.ilustracao;
    }
    let focus: Focus | undefined;
    let photoOrigin: PhotoOrigin | undefined;
    if (image) {
      if (c.foco !== undefined && c.foco !== null && !isFocus(c.foco)) return tr(`cards[${i}].foco inválido`, `cards[${i}].foco is invalid`);
      focus = (c.foco as Focus | null | undefined) ?? undefined;
      const o = c.fotoOrigem as { autor?: unknown; tipo?: unknown } | null | undefined;
      if (o !== undefined && o !== null) {
        const author = typeof o.autor === 'string' ? o.autor.replace(/\s+/g, ' ').trim() : '';
        if (!author || author.length > AUTHOR_PHOTO_MAX) return tr(`cards[${i}].fotoOrigem.autor: até ${AUTHOR_PHOTO_MAX} caracteres`, `cards[${i}].fotoOrigem.autor: up to ${AUTHOR_PHOTO_MAX} characters`);
        if (!(ORIGIN_PHOTO_TYPES as readonly unknown[]).includes(o.tipo)) return tr(`cards[${i}].fotoOrigem.tipo inválido`, `cards[${i}].fotoOrigem.tipo is invalid`);
        photoOrigin = { autor: author, tipo: o.tipo as OriginPhotoType };
      } else if (!recorded.has(image)) return tr(`Card ${i + 1}: diga quem fez a foto`, `Card ${i + 1}: say who took the photo`);
    }
    // The old role stays while the layout is the same: an untouched card comes out the same (and reuses its art). The old
    // cover hid its sentences in the carousel; with a sentence written by the editor, it stops being the old cover and shows them.
    const role = typeof c.papel === 'string' && ['capa', 'o_que_aconteceu', 'contexto'].includes(c.papel) && layoutOf({ papel: c.papel as OldRole }) === c.layout
      && !(c.papel === 'capa' && sentences.length) ? (c.papel as OldRole) : undefined;
    cards.push({ id: c.id, ...(role ? { papel: role } : {}), layout: c.layout, titulo: c.titulo.replace(/\s+/g, ' ').trim(), frases: sentences, ...(image ? { imagem: image } : {}), ...(illustration ? { ilustracao: illustration } : {}), ...(focus ? { foco: focus } : {}), ...(photoOrigin ? { fotoOrigem: photoOrigin } : {}) });
  }
  return cards;
}

/**
 * The illustration the current version used (edited cards without their own photo keep it). Art already built by this
 * code stores the illustration used (or none, when it fell back to the brand background). An old piece: the
 * illustration of the last version written by the AI, only if it did not fail in that version.
 */
export async function currentIllustration(env: Env, tenantId: string, pieceId: string, artwork: ArtRendered[]): Promise<string | undefined> {
  if (artwork.some((a) => a.hash)) return artwork.find((a) => a.arte)?.arte;
  const r = await env.DB.prepare(
    `SELECT e.tipo, json_extract(e.payload_json, '$.r2Key') AS k FROM eventos e
      WHERE e.tenant_id = ? AND e.ref_tipo = 'peca' AND e.ref_id = ? AND e.tipo IN ('peca.ilustracao', 'peca.ilustracao_falhou')
        AND json_extract(e.payload_json, '$.versao') = (SELECT MAX(versao) FROM peca_versoes WHERE peca_id = e.ref_id AND tenant_id = e.tenant_id AND autor = 'ia')
      ORDER BY e.id DESC LIMIT 1`,
  ).bind(tenantId, pieceId).first<{ tipo: string; k: string | null }>();
  return r?.tipo === 'peca.ilustracao' ? r.k ?? undefined : undefined;
}

const CONFLICT_BRAND = 'edicao_conflito';

/** Swaps the piece's template through the editing path: a new version, render of what changed, 409 on a stale version. `null`: no template. */
export async function applyStyle(env: Env, a: { tenantId: string; pecaId: string; por: string; versao: unknown; estiloId: unknown; idioma?: Language }, launch?: OpenBrowser): Promise<ResultEdit> {
  const tr = (pt: string, en: string) => (a.idioma === 'en' ? en : pt);
  if (a.estiloId !== null && typeof a.estiloId !== 'string') return { ok: false, status: 400, erro: tr('estiloId: id do modelo ou null', 'estiloId: template id or null') };
  const piece = await env.DB.prepare('SELECT pauta_id, conteudo_json FROM pecas WHERE id = ? AND tenant_id = ?').bind(a.pecaId, a.tenantId).first<{ pauta_id: string; conteudo_json: string | null }>();
  if (!piece) return { ok: false, status: 404, erro: tr('não encontrado', 'not found') };
  const lead = await loadLead(env, a.tenantId, piece.pauta_id);
  const chosen = a.estiloId === null ? null : (await listStyles(env, a.tenantId)).find((e) => e.id === a.estiloId);
  if (chosen === undefined) return { ok: false, status: 404, erro: tr('modelo não encontrado', 'template not found') };
  const cards = normalizeCards((JSON.parse(piece.conteudo_json || '{}') as Draft).cards ?? []);
  return editCards(env, { ...a, cards, estilo: chosen && await freezeToPiece(env, a.tenantId, chosen, lead) }, launch);
}

/** `idioma`: the language of the error messages returned to the screen (default, Portuguese). */
export async function editCards(env: Env, a: { tenantId: string; pecaId: string; por: string; versao: unknown; cards: unknown; manchete?: unknown; idioma?: Language; estilo?: PieceStyle | null }, launch?: OpenBrowser): Promise<ResultEdit> {
  const { tenantId, pecaId: pieceId, por: actor } = a;
  const tr = (pt: string, en: string) => (a.idioma === 'en' ? en : pt);
  if (!Number.isInteger(a.versao)) return { ok: false, status: 400, erro: tr('versao: inteiro (a versão que está na tela)', 'versao: integer (the version on screen)') };
  if (a.manchete !== undefined && a.manchete !== null && (typeof a.manchete !== 'string' || !a.manchete.trim() || a.manchete.length > TEXT_MAX)) return { ok: false, status: 400, erro: tr('manchete: texto', 'manchete: text') };
  const piece = await env.DB.prepare('SELECT status, versao, rodada, formato, pauta_id, conteudo_json, arte_r2_keys_json FROM pecas WHERE id = ? AND tenant_id = ?')
    .bind(pieceId, tenantId).first<{ status: string; versao: number; rodada: number; formato: 'post' | 'carrossel'; pauta_id: string; conteudo_json: string; arte_r2_keys_json: string | null }>();
  if (!piece) return { ok: false, status: 404, erro: tr('não encontrado', 'not found') };
  if (piece.status !== 'revisao') return { ok: false, status: 409, erro: tr(`peça em ${piece.status}, não em revisão`, `post is ${piece.status}, not in review`) };
  if ((piece.formato as string) === 'reels') return { ok: false, status: 400, erro: tr('o Reels não se edita: edite o carrossel e faça outro Reels', "a Reel can't be edited: edit the carousel and make another Reel") };
  if (a.versao !== piece.versao) return { ok: false, status: 409, erro: tr(`peça na versão ${piece.versao}, não na ${a.versao}: outra pessoa salvou antes`, `post is at version ${piece.versao}, not ${a.versao}: someone else saved first`) };

  const lead = await loadLead(env, tenantId, piece.pauta_id);
  const current = JSON.parse(piece.conteudo_json || '{}') as Draft;
  const recorded = new Set((current.cards ?? []).flatMap((c) => (c.imagem ? [c.imagem] : [])));
  const cards = await readCards(env, lead, tenantId, pieceId, a.cards, a.idioma, recorded);
  if (typeof cards === 'string') return { ok: false, status: 400, erro: cards };
  if (piece.formato === 'post' && (cards.length !== 1 || layoutOf(cards[0]) === 'convite')) return { ok: false, status: 400, erro: tr('post: um card só, sem convite', 'post: a single card, no invite card') };

  // The CTA changed: the caption's closing (which belongs to the CTA) changes with it.
  const { estilo: currentStyle, ...rest } = current;
  const style = a.estilo === undefined ? currentStyle : a.estilo;
  const caption = swapClosing(lead, String(current.legenda ?? ''), ctaDraft({ cards }), { de: currentStyle?.patrocinador?.nome, para: style?.patrocinador?.nome });
  const headline = typeof a.manchete === 'string' ? a.manchete.replace(/\s+/g, ' ').trim() : current.manchete;
  const created: Draft = { ...rest, manchete: headline, cards, legenda: caption, modelo: current.modelo ?? 'edicao', custoUsd: 0, ...(style ? { estilo: style } : {}) };
  let validation = validate(lead, created, { humano: true, formato: piece.formato });

  // Render only if the version passed: with an error, approval stays blocked and the earlier art stays until it is fixed.
  const previous = piece.arte_r2_keys_json ? (JSON.parse(piece.arte_r2_keys_json) as ArtRendered[]) : [];
  const version = ((await env.DB.prepare('SELECT COALESCE(MAX(versao), 0) AS v FROM peca_versoes WHERE peca_id = ? AND tenant_id = ?').bind(pieceId, tenantId).first<{ v: number }>())?.v ?? 0) + 1;
  let artwork: ArtRendered[] | null = null;
  if (validation.ok) {
    try {
      // Keys with the card hash: two edits competing for the same version never write to the same R2 object.
      artwork = await renderCards(env, { tenantId, pecaId: pieceId, versao: version, formato: piece.formato, rascunho: created, pauta: lead, anteriores: previous, chavesPorConteudo: true, ilustracaoR2: await currentIllustration(env, tenantId, pieceId, previous) }, launch);
    } catch (e) {
      if (!(e instanceof LayoutError)) throw e;
      // The text did not fit (layout QA is the final gate): it becomes an error on the card itself, like validation's.
      // Stored in the database: both languages go (`en`), and the screen chooses.
      const notFits = e.metricas.overlap || e.metricas.overflow.length;
      const withoutContrast = e.metricas.semContraste?.length;
      const reason = notFits
        ? 'O texto não cabe no card. Encurte o título ou as frases.'
        : withoutContrast
          ? 'O texto não se lê sobre esta cor (mínimo de 4,5:1). Troque as cores da marca ou a composição.'
          : 'O card não saiu certo na montagem (imagem ou fonte). Tente de novo ou troque a foto.';
      const reasonEn = notFits
        ? "The text doesn't fit the card. Shorten the title or the sentences."
        : withoutContrast
          ? "The text can't be read on this color (minimum 4.5:1). Change the brand colors or the composition."
          : "The card didn't come out right (image or font). Try again or change the photo.";
      validation = {
        ...validation, ok: false, erros: [...validation.erros, e.message.slice(0, 200)],
        porCard: Object.assign(Object.create(null), validation.porCard, { [e.cardId]: [...(validation.porCard?.[e.cardId] ?? []), reason] }),
        en: { ...validation.en, porCard: Object.assign(Object.create(null), validation.en?.porCard, { [e.cardId]: [...(validation.en?.porCard?.[e.cardId] ?? []), reasonEn] }) },
      };
    }
  }

  const normal = normalizeCards(cards);
  const old = new Map(previous.map((x) => [x.hash, x]));
  const reused = artwork ? artwork.filter((x) => x.hash && old.has(x.hash)).map((x) => x.id!) : [];
  const rendered = artwork ? normal.map((c) => c.id).filter((id) => !reused.includes(id)) : [];
  try {
    await env.DB.batch([
      // Conditioned on the version read: if another edit or rewrite came in midway, nothing is stored (the assertion aborts the batch).
      env.DB.prepare(`UPDATE pecas SET conteudo_json = ?, validacao_json = ?, versao = ?, arte_r2_keys_json = COALESCE(?, arte_r2_keys_json), updated_at = datetime('now')
                       WHERE id = ? AND tenant_id = ? AND status = 'revisao' AND versao = ?`)
        .bind(JSON.stringify(created), JSON.stringify(validation), version, artwork ? JSON.stringify(artwork) : null, pieceId, tenantId, piece.versao),
      env.DB.prepare(`SELECT json(CASE WHEN changes() = 1 THEN '1' ELSE '${CONFLICT_BRAND}' END)`),
      env.DB.prepare('INSERT INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor, modelo, custo_usd, motivo) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)')
        .bind(newId(), tenantId, pieceId, version, piece.rodada, JSON.stringify(created), actor, 'edicao'),
      env.DB.prepare('INSERT INTO eventos (tenant_id, tipo, ref_tipo, ref_id, payload_json) VALUES (?, ?, ?, ?, ?)')
        .bind(tenantId, 'peca.editada', 'peca', pieceId, JSON.stringify({ por: actor, de: piece.versao, versao: version, ok: validation.ok, renderizados: rendered, reaproveitados: reused })),
    ]);
  } catch (e) {
    if (String(e).includes('malformed JSON')) return { ok: false, status: 409, erro: tr('outra pessoa salvou este post antes; abra de novo', 'someone else saved this post first; open it again') };
    throw e;
  }
  return { ok: true, versao: version, validacao: validation, renderizados: rendered, reaproveitados: reused };
}

