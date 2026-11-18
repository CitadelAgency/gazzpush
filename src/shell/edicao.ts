// Edição do carrossel na Revisão (Fase 3): o editor muda texto, ordem, quantidade, layout, foto e qual convite entra.
// Salvar cria versão nova em peca_versoes (autor = quem salvou), revalida (números, datas, dias, nomes) e, se passou,
// renderiza só os cards cujo HTML mudou. Não gasta rodada de Reescrever. Versão esperada: outra pessoa salvou antes → 409.
import type { Env } from '../env';
import { novoId } from '../lib/db';
import type { EstiloPeca } from '../lib/estilo';
import { congelarParaPeca, listarEstilos } from '../lib/estilos';
import { prefixoIlustracoes } from '../lib/ilustrar';
import { carregarPauta, type Pauta } from '../lib/pauta';
import { cardConvite, ctaDoRascunho, ctaValido, trocarFecho, type Rascunho } from '../lib/redacao';
import { validar, type Validacao } from '../lib/validacao';
import { ErroLayout, renderizarCards, type AbrirNavegador, type ArteRenderizada } from '../lib/render';
import { AUTOR_FOTO_MAX, MAX_CARDS, TIPOS_ORIGEM_FOTO, ehFoco, ehLayout, layoutDe, normalizarCards, type Card, type Foco, type FotoOrigem, type Frase, type PapelAntigo, type TipoOrigemFoto } from '../lib/cards';
import type { Idioma } from './idioma';

export const ID_CARD = /^[A-Za-z0-9_-]{1,40}$/;
const TEXTO_MAX = 600;

/** Prefixo das fotos próprias de uma peça no R2: o card só aceita foto subida para esta peça deste veículo. */
export const prefixoFotos = (tenantId: string, pecaId: string) => `fotos/${tenantId}/${pecaId}/`;

export type ResultadoEdicao =
  | { ok: true; versao: number; validacao: Validacao; renderizados: string[]; reaproveitados: string[] }
  | { ok: false; status: 400 | 404 | 409; erro: string };

/**
 * Lê e limpa os cards do pedido. O convite vem só com id e qual convite: título e texto são da marca. `gravadas`: as fotos
 * da versão atual. Foto nova exige dizer quem fez; a que já estava na peça antes de a origem existir continua valendo.
 */
export async function lerCards(env: Env, pauta: Pauta, tenantId: string, pecaId: string, corpo: unknown, idioma: Idioma = 'pt-BR', gravadas: ReadonlySet<string> = new Set()): Promise<Card[] | string> {
  const tr = (pt: string, en: string) => (idioma === 'en' ? en : pt);
  if (!Array.isArray(corpo) || !corpo.length || corpo.length > MAX_CARDS) return tr(`cards: de 1 a ${MAX_CARDS}`, `cards: 1 to ${MAX_CARDS}`);
  const ids = new Set<string>();
  const cards: Card[] = [];
  for (const [i, bruto] of corpo.entries()) {
    const c = bruto as Record<string, unknown>;
    if (!c || typeof c !== 'object') return tr(`cards[${i}]: objeto`, `cards[${i}]: object`);
    // Nome de propriedade de objeto (__proto__, constructor…) não serve de id: o id vira chave de mapa na validação.
    if (typeof c.id !== 'string' || !ID_CARD.test(c.id) || ids.has(c.id) || c.id in Object.prototype) return tr(`cards[${i}].id: único, letras, números, - ou _`, `cards[${i}].id: unique, letters, numbers, - or _`);
    ids.add(c.id);
    if (!ehLayout(c.layout)) return tr(`cards[${i}].layout inválido`, `cards[${i}].layout is invalid`);
    if (c.layout === 'convite') {
      if (c.cta !== undefined && c.cta !== null && !ctaValido(pauta, c.cta)) return tr(`cards[${i}].cta: escolha um dos convites da marca`, `cards[${i}].cta: choose one of the brand's invite cards`);
      cards.push(cardConvite(pauta, (c.cta as number | null | undefined) ?? null, c.id));
      continue;
    }
    if (typeof c.titulo !== 'string' || c.titulo.length > TEXTO_MAX) return tr(`cards[${i}].titulo: texto`, `cards[${i}].titulo: text`);
    if (!Array.isArray(c.frases) || c.frases.length > 6) return tr(`cards[${i}].frases: lista`, `cards[${i}].frases: list`);
    const frases: Frase[] = [];
    for (const [j, f] of (c.frases as Record<string, unknown>[]).entries()) {
      if (!f || typeof f.texto !== 'string' || f.texto.length > TEXTO_MAX) return tr(`cards[${i}].frases[${j}].texto: texto`, `cards[${i}].frases[${j}].texto: text`);
      if (f.fatoId !== null && f.fatoId !== undefined && typeof f.fatoId !== 'string') return tr(`cards[${i}].frases[${j}].fatoId: id do fato ou null`, `cards[${i}].frases[${j}].fatoId: fact id or null`);
      // A marca do autor é guardada como veio; a validação decide se vale (só autoral, só versão humana).
      if (f.rotulo !== undefined && typeof f.rotulo !== 'string') return tr(`cards[${i}].frases[${j}].rotulo: texto`, `cards[${i}].frases[${j}].rotulo: text`);
      const rotulo = typeof f.rotulo === 'string' ? f.rotulo.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
      frases.push({ texto: f.texto.replace(/\s+/g, ' ').trim(), fatoId: (f.fatoId as string | null | undefined) ?? null, ...(f.autor === true ? { autor: true } : {}), ...(rotulo ? { rotulo } : {}) });
    }
    let imagem: string | undefined;
    if (c.imagem !== undefined && c.imagem !== null && c.imagem !== '') {
      if (typeof c.imagem !== 'string' || !c.imagem.startsWith(prefixoFotos(tenantId, pecaId)) || c.imagem.includes('..')) return tr(`cards[${i}].imagem: foto subida para esta peça`, `cards[${i}].imagem: a photo uploaded for this post`);
      if (!(await env.MEDIA.head(c.imagem))) return tr(`cards[${i}].imagem: foto não encontrada`, `cards[${i}].imagem: photo not found`);
      imagem = c.imagem;
    }
    let ilustracao: string | undefined;
    if (c.ilustracao !== undefined && c.ilustracao !== null && c.ilustracao !== '') {
      if (typeof c.ilustracao !== 'string' || !c.ilustracao.startsWith(prefixoIlustracoes(tenantId, pecaId)) || c.ilustracao.includes('..')) return tr(`cards[${i}].ilustracao: ilustração gerada para esta peça`, `cards[${i}].ilustracao: an illustration made for this post`);
      if (!(await env.MEDIA.head(c.ilustracao))) return tr(`cards[${i}].ilustracao: não encontrada`, `cards[${i}].ilustracao: not found`);
      ilustracao = c.ilustracao;
    }
    let foco: Foco | undefined;
    let fotoOrigem: FotoOrigem | undefined;
    if (imagem) {
      if (c.foco !== undefined && c.foco !== null && !ehFoco(c.foco)) return tr(`cards[${i}].foco inválido`, `cards[${i}].foco is invalid`);
      foco = (c.foco as Foco | null | undefined) ?? undefined;
      const o = c.fotoOrigem as { autor?: unknown; tipo?: unknown } | null | undefined;
      if (o !== undefined && o !== null) {
        const autor = typeof o.autor === 'string' ? o.autor.replace(/\s+/g, ' ').trim() : '';
        if (!autor || autor.length > AUTOR_FOTO_MAX) return tr(`cards[${i}].fotoOrigem.autor: até ${AUTOR_FOTO_MAX} caracteres`, `cards[${i}].fotoOrigem.autor: up to ${AUTOR_FOTO_MAX} characters`);
        if (!(TIPOS_ORIGEM_FOTO as readonly unknown[]).includes(o.tipo)) return tr(`cards[${i}].fotoOrigem.tipo inválido`, `cards[${i}].fotoOrigem.tipo is invalid`);
        fotoOrigem = { autor, tipo: o.tipo as TipoOrigemFoto };
      } else if (!gravadas.has(imagem)) return tr(`Card ${i + 1}: diga quem fez a foto`, `Card ${i + 1}: say who took the photo`);
    }
    // O papel antigo fica enquanto o layout for o mesmo: o card não mexido sai igual (e reaproveita a arte). A capa
    // antiga escondia as frases no carrossel; com frase escrita pelo editor, ela deixa de ser a capa antiga e mostra.
    const papel = typeof c.papel === 'string' && ['capa', 'o_que_aconteceu', 'contexto'].includes(c.papel) && layoutDe({ papel: c.papel as PapelAntigo }) === c.layout
      && !(c.papel === 'capa' && frases.length) ? (c.papel as PapelAntigo) : undefined;
    cards.push({ id: c.id, ...(papel ? { papel } : {}), layout: c.layout, titulo: c.titulo.replace(/\s+/g, ' ').trim(), frases, ...(imagem ? { imagem } : {}), ...(ilustracao ? { ilustracao } : {}), ...(foco ? { foco } : {}), ...(fotoOrigem ? { fotoOrigem } : {}) });
  }
  return cards;
}

/**
 * A ilustração que a versão atual usou (os cards editados sem foto própria continuam com ela). Artes já montadas por
 * este código guardam a ilustração usada (ou nenhuma, quando caiu no fundo da marca). Peça antiga: a ilustração da
 * última versão escrita pela IA, só se ela não falhou nessa versão.
 */
export async function ilustracaoAtual(env: Env, tenantId: string, pecaId: string, artes: ArteRenderizada[]): Promise<string | undefined> {
  if (artes.some((a) => a.hash)) return artes.find((a) => a.arte)?.arte;
  const r = await env.DB.prepare(
    `SELECT e.tipo, json_extract(e.payload_json, '$.r2Key') AS k FROM eventos e
      WHERE e.tenant_id = ? AND e.ref_tipo = 'peca' AND e.ref_id = ? AND e.tipo IN ('peca.ilustracao', 'peca.ilustracao_falhou')
        AND json_extract(e.payload_json, '$.versao') = (SELECT MAX(versao) FROM peca_versoes WHERE peca_id = e.ref_id AND tenant_id = e.tenant_id AND autor = 'ia')
      ORDER BY e.id DESC LIMIT 1`,
  ).bind(tenantId, pecaId).first<{ tipo: string; k: string | null }>();
  return r?.tipo === 'peca.ilustracao' ? r.k ?? undefined : undefined;
}

const MARCA_CONFLITO = 'edicao_conflito';

/** Troca o modelo da peça pelo caminho da edição: versão nova, render do que mudou, 409 em versão velha. `null`: sem modelo. */
export async function aplicarEstilo(env: Env, a: { tenantId: string; pecaId: string; por: string; versao: unknown; estiloId: unknown; idioma?: Idioma }, abrir?: AbrirNavegador): Promise<ResultadoEdicao> {
  const tr = (pt: string, en: string) => (a.idioma === 'en' ? en : pt);
  if (a.estiloId !== null && typeof a.estiloId !== 'string') return { ok: false, status: 400, erro: tr('estiloId: id do modelo ou null', 'estiloId: template id or null') };
  const peca = await env.DB.prepare('SELECT pauta_id, conteudo_json FROM pecas WHERE id = ? AND tenant_id = ?').bind(a.pecaId, a.tenantId).first<{ pauta_id: string; conteudo_json: string | null }>();
  if (!peca) return { ok: false, status: 404, erro: tr('não encontrado', 'not found') };
  const pauta = await carregarPauta(env, a.tenantId, peca.pauta_id);
  const escolhido = a.estiloId === null ? null : (await listarEstilos(env, a.tenantId)).find((e) => e.id === a.estiloId);
  if (escolhido === undefined) return { ok: false, status: 404, erro: tr('modelo não encontrado', 'template not found') };
  const cards = normalizarCards((JSON.parse(peca.conteudo_json || '{}') as Rascunho).cards ?? []);
  return editarCards(env, { ...a, cards, estilo: escolhido && await congelarParaPeca(env, a.tenantId, escolhido, pauta) }, abrir);
}

/** `idioma`: o das mensagens de erro devolvidas à tela (padrão, português). */
export async function editarCards(env: Env, a: { tenantId: string; pecaId: string; por: string; versao: unknown; cards: unknown; manchete?: unknown; idioma?: Idioma; estilo?: EstiloPeca | null }, abrir?: AbrirNavegador): Promise<ResultadoEdicao> {
  const { tenantId, pecaId, por } = a;
  const tr = (pt: string, en: string) => (a.idioma === 'en' ? en : pt);
  if (!Number.isInteger(a.versao)) return { ok: false, status: 400, erro: tr('versao: inteiro (a versão que está na tela)', 'versao: integer (the version on screen)') };
  if (a.manchete !== undefined && a.manchete !== null && (typeof a.manchete !== 'string' || !a.manchete.trim() || a.manchete.length > TEXTO_MAX)) return { ok: false, status: 400, erro: tr('manchete: texto', 'manchete: text') };
  const peca = await env.DB.prepare('SELECT status, versao, rodada, formato, pauta_id, conteudo_json, arte_r2_keys_json FROM pecas WHERE id = ? AND tenant_id = ?')
    .bind(pecaId, tenantId).first<{ status: string; versao: number; rodada: number; formato: 'post' | 'carrossel'; pauta_id: string; conteudo_json: string; arte_r2_keys_json: string | null }>();
  if (!peca) return { ok: false, status: 404, erro: tr('não encontrado', 'not found') };
  if (peca.status !== 'revisao') return { ok: false, status: 409, erro: tr(`peça em ${peca.status}, não em revisão`, `post is ${peca.status}, not in review`) };
  if ((peca.formato as string) === 'reels') return { ok: false, status: 400, erro: tr('o Reels não se edita: edite o carrossel e faça outro Reels', "a Reel can't be edited: edit the carousel and make another Reel") };
  if (a.versao !== peca.versao) return { ok: false, status: 409, erro: tr(`peça na versão ${peca.versao}, não na ${a.versao}: outra pessoa salvou antes`, `post is at version ${peca.versao}, not ${a.versao}: someone else saved first`) };

  const pauta = await carregarPauta(env, tenantId, peca.pauta_id);
  const atual = JSON.parse(peca.conteudo_json || '{}') as Rascunho;
  const gravadas = new Set((atual.cards ?? []).flatMap((c) => (c.imagem ? [c.imagem] : [])));
  const cards = await lerCards(env, pauta, tenantId, pecaId, a.cards, a.idioma, gravadas);
  if (typeof cards === 'string') return { ok: false, status: 400, erro: cards };
  if (peca.formato === 'post' && (cards.length !== 1 || layoutDe(cards[0]) === 'convite')) return { ok: false, status: 400, erro: tr('post: um card só, sem convite', 'post: a single card, no invite card') };

  // Trocou o convite: o fecho da legenda (que é do convite) troca junto.
  const { estilo: estiloAtual, ...resto } = atual;
  const estilo = a.estilo === undefined ? estiloAtual : a.estilo;
  const legenda = trocarFecho(pauta, String(atual.legenda ?? ''), ctaDoRascunho({ cards }), { de: estiloAtual?.patrocinador?.nome, para: estilo?.patrocinador?.nome });
  const manchete = typeof a.manchete === 'string' ? a.manchete.replace(/\s+/g, ' ').trim() : atual.manchete;
  const novo: Rascunho = { ...resto, manchete, cards, legenda, modelo: atual.modelo ?? 'edicao', custoUsd: 0, ...(estilo ? { estilo } : {}) };
  let validacao = validar(pauta, novo, { humano: true, formato: peca.formato });

  // Render só se a versão passou: com erro a aprovação fica bloqueada e a arte de antes fica até corrigirem.
  const anteriores = peca.arte_r2_keys_json ? (JSON.parse(peca.arte_r2_keys_json) as ArteRenderizada[]) : [];
  const versao = ((await env.DB.prepare('SELECT COALESCE(MAX(versao), 0) AS v FROM peca_versoes WHERE peca_id = ? AND tenant_id = ?').bind(pecaId, tenantId).first<{ v: number }>())?.v ?? 0) + 1;
  let artes: ArteRenderizada[] | null = null;
  if (validacao.ok) {
    try {
      // Chaves com o hash do card: duas edições que disputam a mesma versão nunca escrevem no mesmo objeto do R2.
      artes = await renderizarCards(env, { tenantId, pecaId, versao, formato: peca.formato, rascunho: novo, pauta, anteriores, chavesPorConteudo: true, ilustracaoR2: await ilustracaoAtual(env, tenantId, pecaId, anteriores) }, abrir);
    } catch (e) {
      if (!(e instanceof ErroLayout)) throw e;
      // O texto não coube (o QA de layout é o gate final): vira erro no próprio card, como os da validação.
      // Gravado no banco: vão os dois idiomas (`en`), e a tela escolhe.
      const naoCabe = e.metricas.overlap || e.metricas.overflow.length;
      const semContraste = e.metricas.semContraste?.length;
      const motivo = naoCabe
        ? 'O texto não cabe no card. Encurte o título ou as frases.'
        : semContraste
          ? 'O texto não se lê sobre esta cor (mínimo de 4,5:1). Troque as cores da marca ou a composição.'
          : 'O card não saiu certo na montagem (imagem ou fonte). Tente de novo ou troque a foto.';
      const motivoEn = naoCabe
        ? "The text doesn't fit the card. Shorten the title or the sentences."
        : semContraste
          ? "The text can't be read on this color (minimum 4.5:1). Change the brand colors or the composition."
          : "The card didn't come out right (image or font). Try again or change the photo.";
      validacao = {
        ...validacao, ok: false, erros: [...validacao.erros, e.message.slice(0, 200)],
        porCard: Object.assign(Object.create(null), validacao.porCard, { [e.cardId]: [...(validacao.porCard?.[e.cardId] ?? []), motivo] }),
        en: { ...validacao.en, porCard: Object.assign(Object.create(null), validacao.en?.porCard, { [e.cardId]: [...(validacao.en?.porCard?.[e.cardId] ?? []), motivoEn] }) },
      };
    }
  }

  const normais = normalizarCards(cards);
  const velhas = new Map(anteriores.map((x) => [x.hash, x]));
  const reaproveitados = artes ? artes.filter((x) => x.hash && velhas.has(x.hash)).map((x) => x.id!) : [];
  const renderizados = artes ? normais.map((c) => c.id).filter((id) => !reaproveitados.includes(id)) : [];
  try {
    await env.DB.batch([
      // Condicionado à versão lida: se outra edição ou reescrita entrou no meio, nada é gravado (asserção aborta o batch).
      env.DB.prepare(`UPDATE pecas SET conteudo_json = ?, validacao_json = ?, versao = ?, arte_r2_keys_json = COALESCE(?, arte_r2_keys_json), updated_at = datetime('now')
                       WHERE id = ? AND tenant_id = ? AND status = 'revisao' AND versao = ?`)
        .bind(JSON.stringify(novo), JSON.stringify(validacao), versao, artes ? JSON.stringify(artes) : null, pecaId, tenantId, peca.versao),
      env.DB.prepare(`SELECT json(CASE WHEN changes() = 1 THEN '1' ELSE '${MARCA_CONFLITO}' END)`),
      env.DB.prepare('INSERT INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor, modelo, custo_usd, motivo) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)')
        .bind(novoId(), tenantId, pecaId, versao, peca.rodada, JSON.stringify(novo), por, 'edicao'),
      env.DB.prepare('INSERT INTO eventos (tenant_id, tipo, ref_tipo, ref_id, payload_json) VALUES (?, ?, ?, ?, ?)')
        .bind(tenantId, 'peca.editada', 'peca', pecaId, JSON.stringify({ por, de: peca.versao, versao, ok: validacao.ok, renderizados, reaproveitados })),
    ]);
  } catch (e) {
    if (String(e).includes('malformed JSON')) return { ok: false, status: 409, erro: tr('outra pessoa salvou este post antes; abra de novo', 'someone else saved this post first; open it again') };
    throw e;
  }
  return { ok: true, versao, validacao, renderizados, reaproveitados };
}

