import type { Env } from '../env';
import type { Cta, Pauta } from './pauta';
import { DESCRICAO_LAYOUT, LAYOUTS_DE_CONTEUDO, LIMITES, MAX_CARDS, ehConvite, ehLayoutDeConteudo, type Card, type LayoutConteudo } from './cards';
import type { EstiloPeca } from './estilo';
import { rotuloPublicidade, textosConteudo, type IdiomaConteudo } from './idiomaConteudo';
import { chamarTexto } from './texto';

export type { Card, Frase } from './cards';

export interface Rascunho {
  manchete: string;
  resumo: string;
  legenda: string;
  cards: Card[];
  visualBrief?: { primary: string; context?: string; fatoIds: string[] };
  modelo: string;
  custoUsd: number;
  /** Reels: o carrossel de origem e a faixa da biblioteca de música (src/lib/musica.ts). */
  origem?: { pecaId: string; versao: number; capa?: { png: string; jpg: string }; ilustracao?: string | null; em?: string };
  /** Modelo do veículo com a parte visual da marca congelada (src/lib/estilo.ts). Ausente: o visual de hoje. */
  estilo?: EstiloPeca;
  musica?: string | null;
  /** Reels com voz: a fala usada (tabela narracoes). */
  narracao?: string | null;
}

/** Marcador da legenda do convite que vira o link do texto da pauta (veículo autoral). */
export const MARCADOR_LINK = '{link}';

/**
 * Convite padrão do veículo autoral, criado com ele (editável na aba Marca). Sem número: a marca recusa convite com
 * dígito (a checagem de fatos recusaria o post), então nome de publicação com número fica de fora do texto.
 */
export function ctaAutoral(publicacao: string, idioma?: IdiomaConteudo): Cta {
  const nome = publicacao.replace(/\s+/g, ' ').trim();
  return { ...textosConteudo(idioma).ctaAutoral(nome && !/\d/.test(nome) && nome.length <= 160 ? nome : null) };
}

/** Link que a chamada leva para o leitor: o do post publicado (fonte http); sem ele (rascunho do Docs), o do veículo. */
export function linkDoTexto(pauta: Pauta): string {
  // Fato da Matéria (`afirmacao`) tem como fonte a evidência, não o texto do autor: não é o link do texto.
  return pauta.fatos.filter((f) => f.tipo !== 'afirmacao').map((f) => f.fonteUrl).find((u) => /^https?:\/\//.test(u)) ?? pauta.marca.ctaUrl ?? '';
}

/**
 * Rotação determinística: mesma pauta → mesmo CTA (reescrita não troca o convite). Sem config → convite genérico do
 * perfil. `indice`: o convite que o editor escolheu na Revisão (índice em marca.ctas); fora da lista, vale a rotação.
 */
export function escolherCta(pauta: Pauta, indice?: number | null): Cta {
  // Matéria com a página de fontes publicada e o card pedido: o último card é "Como apuramos", com o link dela.
  if (pauta.fontesUrl && pauta.modo === 'autoral') return textosConteudo(pauta.idioma).ctaFontes(pauta.fontesUrl);
  const ctas = pauta.marca.ctas?.filter((c) => c.titulo && c.texto && c.legenda) ?? [];
  if (!ctas.length && pauta.modo === 'autoral') return ctaAutoral(pauta.marca.nome ?? '', pauta.idioma);
  if (!ctas.length) {
    const tx = textosConteudo(pauta.idioma);
    return { ...tx.ctaPadrao(pauta.marca.handle ?? pauta.marca.nome ?? tx.aPagina) };
  }
  const escolhido = Number.isInteger(indice) ? pauta.marca.ctas?.[indice!] : undefined;
  if (escolhido && ctas.includes(escolhido)) return escolhido;
  let h = 0;
  for (const ch of pauta.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ctas[h % ctas.length];
}

/** O convite escolhido num rascunho: o `cta` do card de convite, se o editor escolheu. */
export const ctaDoRascunho = (r: { cards?: Card[] }) => r.cards?.find((c) => ehConvite(c))?.cta ?? null;

/**
 * Card de convite do sistema (copy do dono), para a edição: título e texto vêm sempre da marca, nunca do editor.
 * `cta` só fica gravado quando o editor escolheu um convite da lista.
 */
export function cardConvite(pauta: Pauta, indice: number | null, id: string): Card {
  const cta = escolherCta(pauta, indice);
  return { id, layout: 'convite', titulo: cta.titulo, frases: [{ texto: cta.texto, fatoId: null }], ...(ctaValido(pauta, indice) ? { cta: indice } : {}) };
}

/** Índice válido de convite da marca (o editor só escolhe entre os que existem). */
export const ctaValido = (pauta: Pauta, indice: unknown): indice is number =>
  Number.isInteger(indice) && !!pauta.marca.ctas?.[indice as number] && escolherCta(pauta, indice as number) === pauta.marca.ctas[indice as number];

/** A primeira linha da legenda de publicidade, posta por código. `validar` reprova a legenda sem ela. */
export const aberturaPublicidade = (pauta: Pauta) => `${rotuloPublicidade(pauta.idioma)} · ${pauta.anunciante ?? ''}`;

/**
 * O que o sistema cola no fim da legenda, depois do texto do modelo: o fecho do convite e a fonte real dos fatos
 * (nunca o que o modelo inventar, "apuração policial"). Determinístico por pauta: o validador tira este trecho antes
 * de conferir números e dias, porque o nome do veículo ou da fonte pode ter número e o modelo
 * não tem como corrigir o que não escreveu.
 */
export function fechoLegenda(pauta: Pauta, indiceCta?: number | null): string {
  const cta = escolherCta(pauta, indiceCta);
  // Autoral: o autor é o dono do veículo; a chamada para o texto completo já leva o link, sem a linha "Fonte:".
  if (pauta.modo === 'autoral') return `

${cta.legenda.replaceAll(MARCADOR_LINK, linkDoTexto(pauta)).trim()}`;
  // Publicidade: no lugar da fonte, de quem é o anúncio.
  if (pauta.tipoPost === 'publicidade') return `\n\n${cta.legenda}\n\n${rotuloPublicidade(pauta.idioma)}: ${pauta.anunciante ?? ''}`;
  const fontesReais = [...new Set(pauta.fatos.map((f) => f.fonteNome ?? new URL(f.fonteUrl).hostname))];
  return `\n\n${cta.legenda}\n\n${textosConteudo(pauta.idioma).fonte}: ${fontesReais.join(', ')}`;
}

/** A linha fixa do patrocinador, a última da legenda. Só o código escreve, e só com o nome exato ela é reconhecida. */
export const linhaOferecimento = (pauta: Pauta, nome: string) => `\n\n${textosConteudo(pauta.idioma).oferecimento}: ${nome}`;

/**
 * O que é do modelo (ou do editor) na legenda: sem o fecho do sistema. O fecho pode ser de qualquer convite da marca, ou
 * de um convite que a marca já trocou (a peça foi gerada antes): aí o parágrafo "Fonte: …" e o convite antes dele saem.
 * `fecho`: se havia fecho reconhecível.
 */
export function corpoDaLegenda(pauta: Pauta, inteira: string, patrocinador?: string | null): { corpo: string; fecho: boolean } {
  const linha = patrocinador ? linhaOferecimento(pauta, patrocinador) : null;
  const legenda = linha && inteira.endsWith(linha) ? inteira.slice(0, -linha.length) : inteira;
  const indices = [null, ...Array.from({ length: pauta.marca.ctas?.length ?? 0 }, (_, i) => i)];
  for (const i of indices) {
    const f = fechoLegenda(pauta, i);
    if (legenda.endsWith(f)) return { corpo: legenda.slice(0, -f.length), fecho: true };
  }
  const partes = legenda.split('\n\n');
  const rotuloFecho = pauta.tipoPost === 'publicidade' ? rotuloPublicidade(pauta.idioma) : textosConteudo(pauta.idioma).fonte;
  if (pauta.modo !== 'autoral' && partes.length >= 3 && partes[partes.length - 1].startsWith(`${rotuloFecho}: `)) {
    return { corpo: partes.slice(0, -2).join('\n\n'), fecho: true };
  }
  return { corpo: legenda, fecho: false };
}

/** A legenda com o fecho de outro convite (o editor trocou o convite do último card). Sem fecho reconhecível, fica. */
export function trocarFecho(pauta: Pauta, legenda: string, para: number | null, patrocinador: { de?: string | null; para?: string | null } = {}): string {
  const { corpo, fecho } = corpoDaLegenda(pauta, legenda, patrocinador.de);
  return `${corpo}${fecho ? fechoLegenda(pauta, para) : ''}${patrocinador.para ? linhaOferecimento(pauta, patrocinador.para) : ''}`;
}

/**
 * DeepSeek via AI Gateway (JSON mode):
 * manchete, resumo, legenda, cards e visualBrief, cada frase presa a um fatoId.
 * TODO: exemplos de voz do tenant.
 */
export async function redigir(env: Env, input: { pauta: Pauta; formato: 'post' | 'carrossel'; instrucao?: string; sequencia?: LayoutConteudo[] }): Promise<Rascunho> {
  const { pauta, formato, instrucao, sequencia } = input;
  // DeepSeek ou Gemini (src/lib/texto.ts), via AI Gateway quando configurado; direto na API em dev; o modelo falso no e2e.

  const resumoDoDia = pauta.tipoPost === 'resumo';
  const linhaFato = (f: Pauta['fatos'][number]) => `- [${f.id}] ${f.texto}${f.tipo === 'opiniao' && pauta.modo === 'autoral' ? ' (opinião do autor, sem fonte externa: atribua ao autor, nunca como fato apurado)' : ''}${f.bairro ? ` (bairro: ${f.bairro})` : ''}${f.dataFato ? ` (data: ${f.dataFato})` : ''}`;
  // Resumo do dia: os fatos por notícia, para cada card ficar com uma só.
  const fatos = resumoDoDia
    ? [...new Set(pauta.fatos.map((f) => f.documentoId))].map((doc, i) => `Notícia ${i + 1}:\n${pauta.fatos.filter((f) => f.documentoId === doc).map(linhaFato).join('\n')}`).join('\n\n')
    : pauta.fatos.map(linhaFato).join('\n');
  const autoral = pauta.modo === 'autoral';
  const correcao = pauta.tipoPost === 'atualizacao' || pauta.tipoPost === 'errata' ? pauta.tipoPost : null;
  // Veículo em inglês: tudo o que vai para o leitor em inglês, mesmo com fatos em outra língua (citação só com fato em inglês).
  const escrevaEm = pauta.idioma === 'en'
    ? 'Escreva em inglês (English): manchete, resumo, legenda e cards, mesmo que os fatos estejam em outra língua. Layout citacao só com fato já escrito em inglês. Manchete e títulos em sentence case: maiúscula só na primeira palavra e nos nomes próprios (a conferência lê palavra com maiúscula como nome).'
    : 'Escreva em português do Brasil.';
  const exemplos = (pauta.voz.exemplos ?? []).filter((e) => typeof e === 'string' && e.trim()).slice(0, 3);
  const cabeca = autoral
    ? [
        `Você escreve a página do próprio autor no Instagram, a partir de um texto que ele escreveu. ${escrevaEm}`,
        'Mantenha o jeito dele: se o texto original é em primeira pessoa, escreva em primeira pessoa; tom e vocabulário são os dele.',
        'Escreva as ideias-chave do texto como o autor apresentaria o próprio argumento, não como manchete de portal de notícias.',
        'Use SOMENTE os fatos listados (trechos literais do texto do autor). Cada frase deve citar o id do fato que a sustenta.',
        'Não invente nomes, números, datas, locais, causas ou consequências que não estejam nos trechos.',
        'A ordem dos cards conta o argumento: a capa traz a ideia central; os seguintes desenvolvem a ideia principal e o argumento ou a consequência que o autor defende.',
        ...(exemplos.length
          ? [`Exemplos de como o autor abre os textos dele (só para o tom; não são fatos e não podem ser citados):\n${exemplos.map((e) => `- ${e}`).join('\n')}`]
          : []),
        pauta.voz.tom ? `Tom do autor: ${pauta.voz.tom}` : '',
        pauta.voz.evitar?.length ? `Evite: ${pauta.voz.evitar.join('; ')}` : '',
      ]
    : [
        `Você é redator de uma página de notícias local. ${escrevaEm}`,
        'Use SOMENTE os fatos listados. Cada frase deve citar o id do fato que a sustenta.',
        'Não invente nomes, números, datas, locais, causas ou consequências. Sem adjetivos de opinião.',
      ];
  const system = [
    ...cabeca,
    'Responda em JSON com: manchete, resumo, legenda, cards[{layout, titulo, frases[{texto, fatoId, rotulo?}]}], visualBrief{primary, context, fatoIds}. rotulo só em comparacao e linha_do_tempo.',
    ...(resumoDoDia ? ['Este post é o resumo do dia: capa e depois um card por notícia, na ordem dada, com layout texto. Cada card usa fatos de uma notícia só. Não misture duas notícias no mesmo card.'] : []),
    formato === 'post'
      ? 'cards deve ter exatamente 1 item (layout capa): é a única imagem do post, com a manchete e 1 ou 2 frases presas a fatos, no máximo 200 caracteres somados.'
      : `cards deve ter de 3 a 6 itens, o primeiro com layout capa. Para cada um dos outros, o layout que melhor serve ao conteúdo: ${LAYOUTS_DE_CONTEUDO.map((l) => DESCRICAO_LAYOUT[l]).join('; ')}. citacao só para fala literal que está nos fatos; numero só para número que está nos fatos. NÃO escreva card de convite; o sistema acrescenta.${sequencia?.length ? ` Sequência sugerida depois da capa: ${sequencia.join(', ')}. Troque um layout só se o conteúdo não servir a ele.` : ''}`,
    `Cada card é uma imagem 1080×1350 com pouco espaço. titulo = manchete curta e própria daquele card (NUNCA o nome do layout): ${LAYOUTS_DE_CONTEUDO.map((l) => `${l} ≤ ${LIMITES[l].titulo}`).join(', ')} caracteres.`,
    formato === 'post'
      ? 'capa: titulo e frases (cada frase com o fatoId que a sustenta).'
      : 'capa: frases vazia (só manchete). texto: 1 ou 2 frases, no máximo 240 caracteres somados. Toda frase, de qualquer layout, com o fatoId que a sustenta.',
    'visualBrief.primary: descrição afirmativa de UMA cena ilustrável só com lugar, objetos e condição (ex.: "pátio de contêineres ao entardecer, portão aberto"). Nunca cite pessoas, placas, cartazes, papéis, letreiros, armas ou texto. Só o que os fatos sustentam. visualBrief.fatoIds: ids dos fatos que a cena usa.',
    autoral
      ? 'manchete ≤ 90 caracteres. legenda: texto pro Instagram na voz do autor, pode ser mais longo, com as ideias do texto. NÃO escreva link nem "Fonte:" na legenda; o sistema acrescenta a chamada para o texto completo.'
      : 'manchete ≤ 90 caracteres. legenda: texto completo pro Instagram, pode ser mais longo, com os fatos. NÃO escreva "Fonte:" na legenda; o sistema acrescenta a fonte real.',
    correcao
      ? `Este post é ${pauta.tipoPost === 'errata' ? 'uma ERRATA' : 'uma ATUALIZAÇÃO'} de um texto já publicado ("${pauta.titulo}"): diga só o que mudou ou o que foi corrigido, com o fato listado, sem repetir a matéria. O sistema põe o rótulo na manchete.`
      : '',
    pauta.tipoPost === 'publicidade'
      ? `Este post é PUBLICIDADE de ${pauta.anunciante}, não notícia: nunca o chame de notícia, reportagem ou matéria. Use só o que o briefing diz, com preço e data exatamente como estão nos fatos. Não escreva o rótulo de publicidade: o sistema põe.`
      : '',
    instrucao ? `Instrução do editor: ${instrucao}` : '',
  ].filter(Boolean).join('\n');
  const user = `Pauta: ${pauta.titulo}\n${pauta.resumo ?? ''}\nEditoria: ${pauta.editoria ?? 'cidade'}\nFatos:\n${fatos}`;

  // O uso fica registrado antes de ler a resposta: fora do formato, a chamada já foi paga.
  const { json, custoUsd, modelo } = await chamarTexto(env, { tenantId: pauta.tenantId, funcao: 'post' }, system, user, 0.3);
  const parsed = json as Omit<Rascunho, 'modelo' | 'custoUsd'>;

  // Convite e fecho da legenda são copy do dono (marca.ctas), com rotação por pauta. O modelo nunca escreve CTA.
  const cta = escolherCta(pauta);
  // A marca "afirmação minha" é só de quem escreve à mão (Revisão): o que vier do modelo com ela perde a marca.
  const doModelo = (Array.isArray(parsed.cards) ? parsed.cards : []).map(limparDoModelo);
  if (formato === 'carrossel') {
    parsed.cards = doModelo.filter((c) => !ehConvite(c)).slice(0, MAX_CARDS - 1);
    parsed.cards.push({ papel: 'convite', titulo: cta.titulo, frases: [{ texto: cta.texto, fatoId: null }] });
  } else {
    // Post: uma imagem só. O primeiro card é a capa, qualquer que seja o layout que o modelo escreveu.
    parsed.cards = doModelo.slice(0, 1).map(({ layout: _l, ...c }) => ({ ...c, papel: 'capa' as const }));
  }
  // Post de correção: o rótulo vai na manchete, na capa e no começo da legenda por código (o modelo pode esquecer).
  if (correcao) {
    const rotulo = textosConteudo(pauta.idioma).rotuloCorrecao(correcao);
    const com = (s: unknown) => { const x = String(s ?? '').trim(); return x.toLowerCase().startsWith(rotulo.toLowerCase()) ? x : `${rotulo}: ${x}`; };
    parsed.manchete = com(parsed.manchete);
    if (parsed.cards[0]) parsed.cards[0] = { ...parsed.cards[0], titulo: com(parsed.cards[0].titulo) };
    parsed.legenda = com(parsed.legenda);
  }
  parsed.legenda = `${String(parsed.legenda ?? '').replace(/\s*(?:Fonte|Source):[^\n]*$/i, '').trim()}${fechoLegenda(pauta)}`;
  if (pauta.tipoPost === 'publicidade') parsed.legenda = `${aberturaPublicidade(pauta)}\n\n${parsed.legenda}`;

  return { ...parsed, modelo, custoUsd };
}

/**
 * Card como o modelo devolveu → card do sistema. O papel antigo, se veio, fica e vale como sempre; senão o layout
 * (fora do conjunto, vira texto). Frase só com texto e fatoId: sem a marca de autor. Sem id (`idDe` deriva na leitura).
 */
function limparDoModelo(c: Card): Card {
  const frases = (Array.isArray(c?.frases) ? c.frases : []).map((f) => ({ texto: String(f?.texto ?? ''), fatoId: f?.fatoId ?? null, ...(typeof f?.rotulo === 'string' && f.rotulo.trim() ? { rotulo: f.rotulo.trim() } : {}) }));
  const titulo = String(c?.titulo ?? '');
  return c?.papel ? { papel: c.papel, titulo, frases } : { layout: ehLayoutDeConteudo(c?.layout) ? c.layout : 'texto', titulo, frases };
}
