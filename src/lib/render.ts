import { launch } from '@cloudflare/playwright';
import type { Env } from '../env';
import type { Marca, Pauta } from './pauta';
import type { Rascunho } from './redacao';
import template from '../templates/card.html';
import templateConvite from '../templates/convite.html';
import { escolherCta, linkDoTexto } from './redacao';
import { marcaDaguaTag } from './marcaDagua';
import { ehConvite, normalizarCards, rotuloCard, type Card, type CardNormal, type Layout } from './cards';
import { coresDoPapel, marcaComCopia, type EstiloPeca } from './estilo';
import { conviteRico, corpoPorFrase, escapeHtml as escape, extrasDoCard, listaTag, preencherTemplate, varsDoCard, type BaseCard } from './cardHtml';
import { CATALOGO_FONTES, classeTitulo, parDe, pesosDoPar, type ParFontes } from './tipografia';
import { editoriaNoCard, localeConteudo, rotuloPublicidade, textosConteudo, type IdiomaConteudo } from './idiomaConteudo';
import { ALTURA_CARROSSEL, qaCard, type MetricasLayout } from './qaLayout';
import nunito from '../../assets/fonts/nunito-latin.woff2';
import quicksand from '../../assets/fonts/quicksand-latin.woff2';
import sourceSans from '../../assets/fonts/source-sans-3-latin.woff2';
import sourceSerif from '../../assets/fonts/source-serif-4-latin.woff2';
import inter from '../../assets/fonts/inter-latin.woff2';
import archivo from '../../assets/fonts/archivo-latin.woff2';

export interface RenderInput {
  tenantId: string;
  pecaId: string;
  versao: number;                 // entra na chave do R2: versões não se sobrescrevem
  formato: 'post' | 'carrossel';
  rascunho: Rascunho;
  pauta: Pauta;
  ilustracaoR2?: string;          // ilustração gerada para a peça (todos os cards), se houver
  /** Artes já renderizadas (versão anterior): card cujo HTML não mudou reaproveita as chaves, sem abrir o navegador. */
  anteriores?: ArteRenderizada[];
  /** Nome do arquivo com o hash do card (edição): tentativas que disputam a mesma versão não se sobrescrevem. */
  chavesPorConteudo?: boolean;
  /** `r916`: o card em 9:16 para o Reels (src/lib/reels.ts). Sem ele, 1080×1350. */
  quadro?: 'r916';
  /** Data de hoje para o card sem data de fato (ISO). O Reels congela a do pedido: o replay dá o mesmo HTML. */
  hoje?: string;
}

export type { MetricasLayout } from './qaLayout';

export interface ArteRenderizada {
  /** Papel antigo, ou o layout: o rótulo do card no pacote e na tela (peças antigas só têm este campo). */
  papel: string;
  id?: string;                    // id do card (cards.ts); ausente em peça antiga
  layout?: Layout;
  png: string;                    // chave R2
  jpg: string;                    // chave R2 (IG Graph exige JPEG)
  /** SHA-256 do HTML do card: igual na versão seguinte = a mesma imagem, reaproveitada. */
  hash?: string;
  /** Ilustração usada no card (a edição reaproveita a mesma). */
  arte?: string;
  metricas: MetricasLayout;
}

/** Card reprovado no QA de layout (texto não cabe, sobreposição): a edição mostra o motivo no próprio card. */
export class ErroLayout extends Error {
  name = 'ErroLayout';
  constructor(readonly cardId: string, readonly indice: number, readonly metricas: MetricasLayout, rotulo: string) {
    super(`layout reprovado no card ${indice + 1} (${rotulo}): ${JSON.stringify(metricas)}`);
  }
}

const FONTES: Record<string, ArrayBuffer> = {
  'nunito-latin.woff2': nunito, 'quicksand-latin.woff2': quicksand, 'source-sans-3-latin.woff2': sourceSans,
  'source-serif-4-latin.woff2': sourceSerif, 'inter-latin.woff2': inter, 'archivo-latin.woff2': archivo,
};
const b64Fontes = new Map<string, string>();
/** Base64 das duas fontes do par (memorizado: o mesmo arquivo serve a todos os cards). */
export function fontesDoPar(par: ParFontes) {
  const def = CATALOGO_FONTES[par];
  const de = (arq: string) => b64Fontes.get(arq) ?? (b64Fontes.set(arq, b64(FONTES[arq])), b64Fontes.get(arq)!);
  return { FONT_BODY: de(def.corpo.arquivo), FONT_DISPLAY: de(def.destaque.arquivo), ...pesosDoPar(par) };
}

function b64(bytes: ArrayBuffer | Uint8Array) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// data_fato vem só com o dia (AAAA-MM-DD): new Date() leria meia-noite UTC, que em São Paulo é o dia anterior.
export const formatarData = (iso: string | null | undefined, idioma?: IdiomaConteudo) =>
  iso
    ? new Intl.DateTimeFormat(localeConteudo(idioma), { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(
        new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00-03:00` : iso),
      )
    : '';

async function dataUri(env: Env, key: string | undefined | null, fallbackType: string) {
  if (!key) return null;
  const obj = await env.MEDIA.get(key);
  if (!obj) throw new Error(`asset ${key} não encontrado no R2`);
  return `data:${obj.httpMetadata?.contentType ?? fallbackType};base64,${b64(await obj.arrayBuffer())}`;
}

const nomeDaFonte = (f: { fonteNome: string | null; fonteUrl: string }) => f.fonteNome ?? new URL(f.fonteUrl).hostname;

/** A parte do card que não muda entre os cards da peça (marca, data, fonte, rodapé). Também vai para a prévia da edição. */
export function baseDoCard(pauta: Pauta, hoje = new Date()): BaseCard {
  const marca: Marca = pauta.marca;
  const fonte = pauta.fatos[0];
  const local = pauta.bairro ?? null;
  const resumo = pauta.tipoPost === 'resumo';
  // Resumo do dia: cada notícia tem a sua data; a do card é a de hoje.
  const dataFato = resumo ? null : pauta.fatos.map((f) => f.dataFato).find(Boolean) ?? null;
  const autoral = pauta.modo === 'autoral';
  const tx = textosConteudo(pauta.idioma);
  const editoria = editoriaNoCard(pauta.editoria, pauta.idioma);
  return {
    autoral, idioma: pauta.idioma ?? 'pt-BR', par: parDe(marca.fontes),
    cores: coresDoPapel({ fundo: marca.cores?.fundo ?? '#1f2a24', texto: marca.cores?.texto ?? '#fffcf6', acento: marca.cores?.acento ?? '#b3e9c2' }, pauta.estiloParams?.papelCores ?? 'normal'),
    marcaNome: marca.nome ?? '',
    editoria,
    eyebrowCapa: local ? `${editoria} · ${local}`.replace(/^ · /, '') : editoria,
    dataLabel: autoral ? '' : dataFato ? tx.ocorrencia : tx.publicacao,
    dataValor: autoral ? '' : formatarData(dataFato ?? hoje.toISOString(), pauta.idioma),
    fonteNome: autoral ? marca.assinatura ?? marca.nome ?? '' : resumo ? tx.variasFontes : nomeDaFonte(fonte),
    fonteUrl: autoral ? linkDoTexto(pauta) : fonte.fonteUrl,
    ...(resumo ? { fontesPorFato: Object.fromEntries(pauta.fatos.map((f) => [f.id, { nome: nomeDaFonte(f), url: f.fonteUrl }])) } : {}),
    fatosDoDocumento: Object.fromEntries(pauta.fatos.map((f) => [f.id, { nome: nomeDaFonte(f), url: f.fonteUrl, data: !autoral && f.dataFato ? formatarData(f.dataFato, pauta.idioma) : null }])),
    rotuloDataFato: tx.ocorrencia,
    ctaUrl: marca.ctaUrl ?? `https://${marca.dominio ?? 'instagram.com'}`,
    dominio: marca.dominio ?? marca.handle ?? '',
    ...(pauta.estiloParams ? { composicao: pauta.estiloParams.composicao, caixaTitulo: pauta.estiloParams.caixaTitulo } : {}),
    ...(pauta.patrocinador ? { patrocinio: { rotulo: rotuloPublicidade(pauta.idioma), oferecimento: tx.oferecimento, nome: pauta.patrocinador.nome, logo: null } } : {}),
    ...(pauta.tipoPost === 'publicidade' ? { publicidade: { rotulo: rotuloPublicidade(pauta.idioma), anunciante: pauta.anunciante ?? '' } } : {}),
  };
}

/** A pauta como a peça a vê: com modelo, a marca congelada nele e os parâmetros. Sem modelo, a de hoje. */
export const pautaDoEstilo = (pauta: Pauta, estilo?: EstiloPeca | null): Pauta =>
  estilo ? { ...pauta, marca: marcaComCopia(pauta.marca, estilo.marcaVisual), estiloParams: estilo.params, patrocinador: estilo.patrocinador } : pauta;

/**
 * Variáveis de texto e cor de um card (sem fontes, arte e logo, que o render monta à parte). Veículo `autoral`: o autor
 * é o dono do veículo, então o card não tem rótulo de data nem eyebrow de notícia ("O que aconteceu", "Contexto"; só a
 * editoria, quando há), e o rodapé assina com `marca.assinatura` ligada ao texto, no lugar de "Fonte: <site>".
 */
export const varsCard = (pauta: Pauta, card: Card, formato: 'post' | 'carrossel', hoje = new Date()) => varsDoCard(baseDoCard(pauta, hoje), card, formato);

export { listaTag, preencherTemplate };

/** O HTML de cada card, pronto para o navegador, e o hash dele (decide o que precisa renderizar de novo). */
export interface CardPreparado { card: CardNormal; indice: number; html: string; hash: string; arte: string | null }

export async function prepararCards(env: Env, input: Omit<RenderInput, 'anteriores'>): Promise<CardPreparado[]> {
  const { rascunho, formato } = input;
  const pauta = pautaDoEstilo(input.pauta, rascunho.estilo);
  const marca: Marca = pauta.marca;
  const cards = formato === 'post' ? normalizarCards(rascunho.cards).slice(0, 1) : normalizarCards(rascunho.cards);
  if (!cards.length) throw new Error('rascunho sem cards');

  const logo = await dataUri(env, marca.logoR2, 'image/svg+xml');
  const ilustracao = await dataUri(env, input.ilustracaoR2 ?? null, 'image/png');
  const artePadrao = ilustracao ?? (await dataUri(env, marca.arteR2, 'image/png'));
  const fontes = fontesDoPar(parDe(marca.fontes));
  const base = baseDoCard(pauta);
  const logoPatrocinio = await dataUri(env, pauta.patrocinador?.logoR2, 'image/png');
  const saida: CardPreparado[] = [];
  for (const [i, card] of cards.entries()) {
    // Foto própria (subida pelo editor); senão a ilustração do card, a da peça ou a arte padrão da marca.
    const foto = card.imagem ? await dataUri(env, card.imagem, 'image/png') : null;
    const doCard = !foto && card.ilustracao ? await dataUri(env, card.ilustracao, 'image/png') : null;
    const arte = foto ?? doCard ?? artePadrao;
    const vars: Record<string, string> = { ...fontes, ...varsCard(pauta, card, formato, input.hoje ? new Date(input.hoje) : undefined), ...(input.quadro ? { FORMAT_CLASS: input.quadro } : {}) };
    // Tags montadas fora do escape: imagem (ou fundo flat) e logo (ou nome).
    const raw: Record<string, string> = {
      ART_TAG: arte
        ? `<img class="art" src="${arte}" alt="${escape(foto ? textosConteudo(pauta.idioma).fotoDoVeiculo : rascunho.visualBrief?.primary ?? textosConteudo(pauta.idioma).ilustracao)}">`
        : '<div class="art art-flat" aria-hidden="true"></div>',
      BRAND_TAG: logo
        ? `<img class="brand-mark" src="${logo}" alt="${escape(marca.nome ?? '')}">`
        : `<span class="brand-name">${escape(marca.nome ?? marca.handle ?? '')}</span>`,
      LIST_TAG: listaTag(card),
      ...extrasDoCard(base.patrocinio ? { ...base, patrocinio: { ...base.patrocinio, logo: logoPatrocinio } } : base, card),
    };
    if (input.quadro && !ehConvite(card)) raw.BODY_TEXT = corpoPorFrase(card, vars.BODY_TEXT);
    // Convite rico: celular com direct de exemplo, destaques e botão, tudo da config do CTA (cardHtml.conviteRico).
    const cta = ehConvite(card) ? escolherCta(pauta, card.cta) : null;
    let tpl = template;
    if (cta?.telefone) {
      tpl = templateConvite;
      const rico = conviteRico({ ...cta, telefone: cta.telefone }, marca, parDe(marca.fontes), pauta.idioma);
      Object.assign(vars, rico.vars, { CTA_URL: cta.url ?? vars.CTA_URL });
      raw.MESSAGES = rico.mensagens;
    }
    // Marca d'água (logo ou @), fora do convite rico (o template dele não tem o lugar).
    raw.WATERMARK = marcaDaguaTag(marca.marcaDagua, { logo, handle: marca.handle, nome: marca.nome });
    const html = preencherTemplate(tpl, vars, raw);
    saida.push({ card, indice: i, html, hash: await sha256(`1080x1350\n${html}`), arte: foto ? null : input.ilustracaoR2 ?? null });
  }
  return saida;
}

async function sha256(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** O mínimo do Playwright que o render usa: os testes trocam por um navegador falso. */
export type AbrirNavegador = () => Promise<{ newPage: (o: { viewport: { width: number; height: number }; deviceScaleFactor: number }) => Promise<any>; close: () => Promise<void> }>;
/** Objeto para os testes trocarem (vi.spyOn): o Browser Rendering só existe remoto. */
export const navegador = { abrir: (env: Env): ReturnType<AbrirNavegador> => launch(env.BROWSER) as never };

/**
 * Porta de scripts/lib/social/render.mjs: HTML por card → screenshot 1080×1350 no Browser Rendering → R2.
 * Mantém o QA de layout (overflow, sobreposição, fontes, imagens) e a proibição de request externo. Com `anteriores`,
 * card de HTML igual (mesmo hash) reaproveita as chaves da versão anterior; sem nada a renderizar, nem abre o navegador.
 */
export async function renderizarCards(env: Env, input: RenderInput, abrir: AbrirNavegador = () => navegador.abrir(env)): Promise<ArteRenderizada[]> {
  const { tenantId, pecaId, versao } = input;
  const preparados = await prepararCards(env, input);
  const porHash = new Map((input.anteriores ?? []).filter((a) => a.hash).map((a) => [a.hash!, a]));
  const saida: (ArteRenderizada | null)[] = preparados.map((p) => {
    const velha = porHash.get(p.hash);
    return velha ? { ...velha, papel: rotuloCard(p.card), id: p.card.id, layout: p.card.layout } : null;
  });
  const faltam = preparados.filter((_, i) => !saida[i]);
  if (!faltam.length) return saida as ArteRenderizada[];

  const prefixo = `artes/${tenantId}/${pecaId}/v${versao}`;
  const browser = await abrir();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    const erros: string[] = [];
    const externos: string[] = [];
    page.on('pageerror', (e: Error) => erros.push(e.message));
    page.on('console', (m: { type(): string; text(): string }) => { if (m.type() === 'error') erros.push(m.text()); });
    await page.route(/^https?:\/\//, async (route: any) => { externos.push(route.request().url()); await route.abort(); });

    for (const p of faltam) {
      const { card, indice: i, html } = p;
      await page.setContent(html, { waitUntil: 'load' });
      const { metricas, ok } = await qaCard(page, { promo: ehConvite(card), altura: ALTURA_CARROSSEL });
      if (!ok) throw new ErroLayout(card.id, i, metricas, rotuloCard(card));

      const el = page.locator('.card');
      const png = await el.screenshot({ type: 'png' });
      const jpg = await el.screenshot({ type: 'jpeg', quality: 95 });
      // Nome com o id do card: na mesma versão, dois cards nunca disputam a chave (reordenar não sobrescreve).
      const base = `${prefixo}/${String(i + 1).padStart(2, '0')}-${rotuloCard(card)}${card.id === rotuloCard(card) ? '' : `-${card.id.replace(/[^a-z0-9-]/gi, '').slice(0, 24)}`}${input.chavesPorConteudo ? `-${p.hash.slice(0, 16)}` : ''}`;
      await Promise.all([
        env.MEDIA.put(`${base}.png`, png, { httpMetadata: { contentType: 'image/png' } }),
        env.MEDIA.put(`${base}.jpg`, jpg, { httpMetadata: { contentType: 'image/jpeg' } }),
      ]);
      saida[i] = { papel: rotuloCard(card), id: card.id, layout: card.layout, png: `${base}.png`, jpg: `${base}.jpg`, hash: p.hash, ...(p.arte ? { arte: p.arte } : {}), metricas };
    }

    if (erros.length || externos.length) throw new Error(`render com erros: ${JSON.stringify({ erros, externos })}`);
  } finally {
    await browser.close();
  }
  return saida as ArteRenderizada[];
}
