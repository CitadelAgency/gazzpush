import type { Pauta } from './pauta';
import { aberturaPublicidade, corpoDaLegenda, type Rascunho } from './redacao';
import type { IdiomaConteudo } from './idiomaConteudo';
import { COM_ROTULO, LIMITES, LITERAIS, MAX_CARDS, ROTULO_MAX, MIN_CARDS, NOME_LAYOUT, NOME_LAYOUT_EN, ehConvite, layoutDe, normalizarCards, rotuloCard, type Card, type Frase } from './cards';

export interface Validacao {
  ok: boolean;
  erros: string[];
  avisos: string[];
  /** Por card (id de `normalizarCards`): o motivo em linguagem de leigo, para a Revisão mostrar no próprio card. */
  porCard?: Record<string, string[]>;
  /** O que não é de um card (manchete, legenda, a peça inteira), também em linguagem de leigo. */
  geral?: string[];
  /** As mesmas mensagens de `porCard` e `geral` em inglês, para quem usa as telas em inglês (validação antiga não tem). */
  en?: { porCard?: Record<string, string[]>; geral?: string[] };
}

export interface OpcoesValidacao {
  /** Versão escrita por uma pessoa (edição na Revisão). Só nela vale a frase marcada "afirmação minha". */
  humano?: boolean;
  /** Carrossel: confere a quantidade de cards (2 a 10) e o convite no fim. Só a edição manda; a IA tem o limite no código. */
  formato?: 'post' | 'carrossel';
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const RE_DIAS = /\b(domingo|segunda|terça|quarta|quinta|sexta|sábado)(?:-feira)?\b/g;
const RE_NUM = /\b\d+(?:[.,]\d+)?\b/g;
// Veículo em inglês: os mesmos dias, em inglês.
const DIAS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const RE_DIAS_EN = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g;

/** Minúsculas sem acento: comparar nome de pessoa ou lugar sem depender de caixa e acentuação. */
const plano = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Para conferir citação: sem aspas, sem pontuação das pontas e com espaços simples (caixa e acento contam como iguais). */
const literal = (s: string) => plano(s).replace(/["“”«»'‘’]/g, '').replace(/\s+/g, ' ').trim().replace(/^[\s.,;:!?—–-]+|[\s.,;:!?—–-]+$/g, '');

// Palavras que aparecem com maiúscula no meio da frase sem serem nome próprio.
const NAO_NOME = new Set(['eu', 'o', 'a', 'os', 'as', 'um', 'uma', 'e', 'é', 'de', 'da', 'do', 'em', 'no', 'na', 'que', 'se', 'mas', 'para', 'pra', 'por']);
// Em inglês, também dias e meses (sempre com maiúscula) e as palavras curtas que um título com maiúsculas carrega.
// Título com Todas As Palavras Maiúsculas ainda conta como nome: o prompt pede só a primeira palavra e os nomes.
const NAO_NOME_EN = new Set([
  'i', 'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'as', 'is', 'are', 'was', 'were',
  'it', 'its', 'this', 'that', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they', 'his', 'her', 'their', 'im', 'ive', 'id', 'ill',
  ...DIAS_EN, 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
]);

/**
 * Nomes próprios do texto: palavra com inicial maiúscula que não abre frase (abrir frase pede maiúscula de qualquer
 * jeito), e siglas. Trecho todo em caixa alta é ênfase, não nome, e fica de fora.
 */
export function nomesProprios(texto: string, idioma?: IdiomaConteudo): string[] {
  const naoNome = idioma === 'en' ? NAO_NOME_EN : NAO_NOME;
  const nomes: string[] = [];
  for (const trecho of texto.split(/[.!?:;\n"“”«»()—–]+|\s-\s/)) {
    const palavras = trecho.match(/[\p{L}][\p{L}\p{M}'’-]*/gu) ?? [];
    const letras = palavras.join('');
    if (letras.length > 3 && letras === letras.toUpperCase()) continue;
    palavras.forEach((p, i) => {
      if (i === 0 || p.length < 2 || !/^\p{Lu}/u.test(p) || naoNome.has(plano(p).replace(/['’]/g, ''))) return;
      nomes.push(p.replace(/['’]s$/, ''));
    });
  }
  return [...new Set(nomes)];
}

/**
 * Checagens determinísticas, sem IA. Estilo JornAI: o que dá pra provar em código, prova-se em código.
 * - toda frase de card factual aponta pra um fatoId existente, e há pelo menos uma (post sem frase presa a fato não
 *   cumpre a promessa "cada frase presa à fonte"); a exceção é a "afirmação minha" do autor, em versão humana
 * - números citados existem em algum fato (só no texto do modelo: o fecho da legenda e o convite são do sistema)
 * - dia da semana citado bate com data_fato
 * - nomes próprios dos cards e da manchete aparecem nos fatos
 * - limites de título e corpo de cada layout
 * - bairro citado é o da pauta/fatos
 */
export function validar(pauta: Pauta, r: Rascunho, o: OpcoesValidacao = {}): Validacao {
  const erros: string[] = [];
  const avisos: string[] = [];
  // Cada motivo de leigo nos dois idiomas da tela: a pessoa que revisa pode usar o app em inglês.
  const porCard: Record<string, string[]> = Object.create(null);
  const porCardEn: Record<string, string[]> = Object.create(null);
  const noCard = (id: string, motivo: string, en: string) => { (porCard[id] ??= []).push(motivo); (porCardEn[id] ??= []).push(en); };
  const geral: [string, string][] = [];
  const noGeral = (motivo: string, en: string) => { geral.push([motivo, en]); };
  const fatoIds = new Set(pauta.fatos.map((f) => f.id));
  // Resumo do dia: cada card mostra uma fonte, então só pode falar de uma notícia.
  if (pauta.tipoPost === 'resumo') {
    const documentoDe = new Map(pauta.fatos.map((f) => [f.id, f.documentoId]));
    for (const card of normalizarCards(r.cards ?? [])) {
      const documentos = new Set((card.frases ?? []).flatMap((f) => (f.fatoId && documentoDe.has(f.fatoId) ? [documentoDe.get(f.fatoId)] : [])));
      if (documentos.size > 1) {
        erros.push(`card com duas notícias (${rotuloCard(card)})`);
        noCard(card.id, 'Este card mistura fatos de duas notícias. Deixe só uma: cada card do resumo mostra uma fonte.', 'This card mixes facts from two stories. Keep one: each roundup card shows a single source.');
      }
    }
  }
  const textoFatos = pauta.fatos.map((f) => f.texto).join(' \n ');
  const autoral = pauta.modo === 'autoral';
  const ingles = pauta.idioma === 'en';
  const dias = ingles ? DIAS_EN : DIAS;
  const reDias = ingles ? RE_DIAS_EN : RE_DIAS;

  const cards = normalizarCards(r.cards);
  const factuais = cards.filter((c) => !ehConvite(c));
  // A frase do autor ("afirmação minha"): ele é a fonte. Fora do autoral, ou numa versão da IA, não vale.
  const doAutor = (f: Frase) => !!f.autor && autoral && !!o.humano;
  let presas = 0;
  for (const card of factuais) {
    for (const frase of card.frases) {
      if (frase.autor && !doAutor(frase)) {
        erros.push(`afirmação do autor fora de lugar (${rotuloCard(card)}): "${frase.texto.slice(0, 60)}"`);
        noCard(card.id, autoral
          ? `"${frase.texto.slice(0, 60)}" está marcada como afirmação sua, mas esta versão não foi escrita por uma pessoa. Prenda a frase a um fato.`
          : `"${frase.texto.slice(0, 60)}" está marcada como afirmação do autor, o que só vale em veículo de autor. Prenda a frase a um fato.`,
          autoral
          ? `"${frase.texto.slice(0, 60)}" is marked as your own claim, but this version wasn't written by a person. Link the sentence to a fact.`
          : `"${frase.texto.slice(0, 60)}" is marked as the author's claim, which only counts in an author publication. Link the sentence to a fact.`);
        continue;
      }
      if (doAutor(frase)) { presas++; continue; }
      if (!frase.fatoId) {
        erros.push(`frase sem fato (${rotuloCard(card)}): "${frase.texto.slice(0, 60)}"`);
        noCard(card.id, `"${frase.texto.slice(0, 60)}" não está presa a nenhum fato da fonte. Escolha o fato que sustenta a frase${autoral ? ' ou marque como afirmação sua' : ''}.`,
          `"${frase.texto.slice(0, 60)}" isn't linked to any fact from the source. Pick the fact that backs the sentence${autoral ? ' or mark it as your own claim' : ''}.`);
        continue;
      }
      if (!fatoIds.has(frase.fatoId)) {
        erros.push(`fatoId inexistente ${frase.fatoId} (${rotuloCard(card)})`);
        noCard(card.id, `"${frase.texto.slice(0, 60)}" aponta para um fato que não está nesta pauta. Escolha outro fato.`,
          `"${frase.texto.slice(0, 60)}" points to a fact that isn't in this idea. Pick another fact.`);
        continue;
      }
      // Citação é fala de alguém: o trecho entre aspas tem de estar, palavra por palavra, no fato que ela cita.
      if (LITERAIS.includes(layoutDe(card))) {
        const fato = pauta.fatos.find((f) => f.id === frase.fatoId)!;
        if (!literal(fato.texto).includes(literal(frase.texto))) {
          erros.push(`citação não literal (${rotuloCard(card)})`);
          noCard(card.id, 'A citação precisa ser o trecho exato do fato, palavra por palavra. Copie a frase do fato ou use o layout Texto.',
            'The quote must be the exact passage from the fact, word for word. Copy the sentence from the fact or use the Text layout.');
        }
      }
      presas++;
    }
  }
  if (!presas) {
    erros.push('nenhuma frase com fonte: os cards precisam de frases presas a um fato');
    noGeral('Nenhuma frase dos cards está presa a um fato da fonte. Prenda pelo menos uma.', 'No sentence in the cards is linked to a fact from the source. Link at least one.');
  }

  // Só o que o modelo (ou o editor) escreveu: o fecho da legenda (convite e "Fonte:") e o card de convite são do sistema.
  const publicidade = pauta.tipoPost === 'publicidade';
  const corpoLegenda = corpoDaLegenda(pauta, String(r.legenda ?? ''), r.estilo?.patrocinador?.nome).corpo;
  const abertura = publicidade ? aberturaPublicidade(pauta) : '';
  // A abertura é do sistema (o nome do anunciante pode ter número). Sem ela, a legenda deixou de dizer que é publicidade.
  if (publicidade && !corpoLegenda.startsWith(abertura)) {
    erros.push('legenda de publicidade sem o rótulo');
    noGeral(`A legenda precisa começar com "${abertura}". Volte o rótulo.`, `The caption must start with "${abertura}". Put the label back.`);
  }
  const legendaModelo = publicidade && corpoLegenda.startsWith(abertura) ? corpoLegenda.slice(abertura.length) : corpoLegenda;
  // Em publicidade o número é preço: compara como token inteiro, porque `includes` aceita 19,9 dentro de 19,90.
  const tokensFatos = new Set(textoFatos.match(RE_NUM) ?? []);
  const numeroNosFatos = (n: string) => (publicidade ? tokensFatos.has(n) : textoFatos.includes(n));
  // Texto conferido de cada card: título e frases, menos as afirmações do autor (ele responde por elas).
  const textoCard = (c: Card) => [c.titulo, ...c.frases.filter((f) => !doAutor(f)).flatMap((f) => [f.rotulo ?? '', f.texto])].join(' \n ');
  const textoPeca = [r.manchete, r.resumo, legendaModelo, ...factuais.map(textoCard)].join(' ');

  for (const num of textoPeca.match(RE_NUM) ?? []) {
    if (!numeroNosFatos(num)) erros.push(`número ${num} não aparece nos fatos`);
  }
  const textoFora = [r.manchete, r.resumo, legendaModelo].join(' \n ');
  for (const num of new Set(textoFora.match(RE_NUM) ?? [])) {
    if (!numeroNosFatos(num)) noGeral(`O número ${num} da manchete ou da legenda não aparece em nenhum fato da fonte.`, `The number ${num} in the headline or caption doesn't appear in any fact from the source.`);
  }

  const datas = pauta.fatos.map((f) => f.dataFato).filter(Boolean) as string[];
  const esperados = new Set(datas.map((d) => dias[new Date(`${d}T12:00:00-03:00`).getDay()]));
  const diaErrado = (dia: string) => datas.length > 0 && !esperados.has(dia.replace('-feira', ''));
  for (const dia of textoPeca.toLowerCase().match(reDias) ?? []) {
    if (diaErrado(dia)) erros.push(`dia "${dia}" não bate com data dos fatos (${[...esperados].join(', ')})`);
  }
  for (const dia of new Set(textoFora.toLowerCase().match(reDias) ?? [])) {
    if (diaErrado(dia)) noGeral(`"${dia}", na manchete ou na legenda, não bate com a data dos fatos (foi ${[...esperados].join(' ou ')}).`, `"${dia}", in the headline or caption, doesn't match the date of the facts (it was ${[...esperados].join(' or ')}).`);
  }

  // Nomes: o que aparece nos fatos, e os nomes que são do próprio veículo, da área e do autor.
  const conhecidos = plano([textoFatos, pauta.marca.nome, pauta.marca.handle, pauta.marca.assinatura, pauta.cidade, pauta.bairro, pauta.anunciante].filter(Boolean).join(' \n '));
  const nomeConhecido = (n: string) => new RegExp(`(^|[^\\p{L}])${plano(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(conhecidos);
  const nomesFora = (t: string) => nomesProprios(t, pauta.idioma).filter((n) => !nomeConhecido(n));
  for (const n of nomesFora(r.manchete ?? '')) {
    erros.push(`nome "${n}" não aparece nos fatos`);
    noGeral(`"${n}", na manchete, não aparece em nenhum fato da fonte.`, `"${n}", in the headline, doesn't appear in any fact from the source.`);
  }

  // Por card: números, dias e nomes, com o motivo no próprio card.
  for (const card of factuais) {
    const t = textoCard(card);
    for (const num of new Set(t.match(RE_NUM) ?? [])) if (!numeroNosFatos(num)) noCard(card.id, `O número ${num} não aparece em nenhum fato da fonte.`, `The number ${num} doesn't appear in any fact from the source.`);
    for (const dia of new Set(t.toLowerCase().match(reDias) ?? [])) {
      if (diaErrado(dia)) noCard(card.id, `"${dia}" não bate com a data dos fatos (foi ${[...esperados].join(' ou ')}).`, `"${dia}" doesn't match the date of the facts (it was ${[...esperados].join(' or ')}).`);
    }
    for (const n of nomesFora(t)) {
      erros.push(`nome "${n}" não aparece nos fatos (${rotuloCard(card)})`);
      noCard(card.id, `"${n}" não aparece em nenhum fato da fonte. Tire o nome ou prenda a frase a um fato que o cite.`, `"${n}" doesn't appear in any fact from the source. Remove the name or link the sentence to a fact that mentions it.`);
    }
  }

  const bairros = new Set(pauta.fatos.map((f) => f.bairro).filter(Boolean).concat(pauta.bairro ? [pauta.bairro] : []) as string[]);
  if (bairros.size && pauta.bairro && !textoPeca.includes(pauta.bairro)) avisos.push(`bairro da pauta (${pauta.bairro}) não citado`);

  if (!r.manchete?.trim()) { erros.push('manchete vazia'); noGeral('A peça está sem manchete.', 'The post has no headline.'); }
  if ((r.manchete ?? '').length > 90) { erros.push(`manchete longa (${r.manchete.length} > 90)`); noGeral(`A manchete tem ${r.manchete.length} caracteres; cabem 90.`, `The headline has ${r.manchete.length} characters; 90 fit.`); }

  // Limites do template 1080×1350, por layout. Fora disso o render reprova; melhor reprovar aqui e reescrever.
  const PAPEIS = new Set(['capa', 'o_que_aconteceu', 'contexto', 'convite']);
  for (const card of cards) {
    const lim = LIMITES[layoutDe(card)];
    const nome = rotuloCard(card);
    const titulo = card.titulo ?? '';
    const corpo = card.frases.map((f) => f.texto).join(' ');
    const n = card.frases.length;
    if (!titulo.trim()) { erros.push(`card ${nome} sem título`); noCard(card.id, 'O card está sem título.', 'The card has no title.'); }
    if (PAPEIS.has(titulo.trim().toLowerCase().replace(/ /g, '_')) || /^(o que aconteceu|contexto|convite|capa)$/i.test(titulo.trim())) {
      erros.push(`card ${nome}: título é o nome do papel, não uma manchete`);
      noCard(card.id, 'O título é o nome do tipo de card. Escreva uma manchete para ele.', 'The title is the name of the card type. Write a headline for it.');
    }
    for (const f of card.frases) {
      const rotulo = f.rotulo ?? '';
      if (COM_ROTULO.includes(layoutDe(card)) && !rotulo.trim()) {
        erros.push(`card ${nome}: frase sem rótulo`);
        noCard(card.id, `"${f.texto.slice(0, 60)}" está sem rótulo. ${layoutDe(card) === 'linha_do_tempo' ? 'Escreva a data.' : 'Escreva o lado comparado.'}`, `"${f.texto.slice(0, 60)}" has no label. ${layoutDe(card) === 'linha_do_tempo' ? 'Write the date.' : 'Write the side being compared.'}`);
      }
      if (rotulo.length > ROTULO_MAX) {
        erros.push(`card ${nome}: rótulo longo (${rotulo.length})`);
        noCard(card.id, `O rótulo "${rotulo.slice(0, 40)}" tem ${rotulo.length} caracteres; cabem ${ROTULO_MAX}.`, `The label "${rotulo.slice(0, 40)}" has ${rotulo.length} characters; ${ROTULO_MAX} fit.`);
      }
    }
    if (titulo.length > lim.titulo) {
      erros.push(`card ${nome}: título longo (${titulo.length})`);
      noCard(card.id, `O título tem ${titulo.length} caracteres; neste layout cabem ${lim.titulo}.`, `The title has ${titulo.length} characters; this layout fits ${lim.titulo}.`);
    }
    // O prompt pede ≤ 240; aqui a folga vai a 280 porque o QA de layout do render é o gate real. 251 cabia e custou 2 reescritas.
    // Vale para a capa também: no post ela leva as frases (no carrossel vem vazia e passa).
    if (corpo.length > lim.corpo) {
      erros.push(`card ${nome}: corpo longo (${corpo.length} > ${lim.corpo})`);
      noCard(card.id, `O texto do card tem ${corpo.length} caracteres; neste layout cabem ${lim.corpo}.`, `The card text has ${corpo.length} characters; this layout fits ${lim.corpo}.`);
    }
    if (n > lim.frasesMax) {
      erros.push(`card ${nome}: mais de ${lim.frasesMax} frase${lim.frasesMax > 1 ? 's' : ''}`);
      noCard(card.id, `${NOME_LAYOUT[layoutDe(card)]} leva no máximo ${lim.frasesMax} frase${lim.frasesMax > 1 ? 's' : ''}; este card tem ${n}.`,
        `${NOME_LAYOUT_EN[layoutDe(card)]} takes at most ${lim.frasesMax} sentence${lim.frasesMax > 1 ? 's' : ''}; this card has ${n}.`);
    }
    if (n < lim.frasesMin) {
      erros.push(`card ${nome}: menos de ${lim.frasesMin} frase${lim.frasesMin > 1 ? 's' : ''}`);
      noCard(card.id, `${NOME_LAYOUT[layoutDe(card)]} precisa de ${lim.frasesMin === 1 ? '1 frase' : `pelo menos ${lim.frasesMin} frases`}.`,
        `${NOME_LAYOUT_EN[layoutDe(card)]} needs ${lim.frasesMin === 1 ? '1 sentence' : `at least ${lim.frasesMin} sentences`}.`);
    }
    if (lim.frase) for (const f of card.frases) {
      if (f.texto.length > lim.frase) noCard(card.id, `Um item da lista tem ${f.texto.length} caracteres; cabem ${lim.frase}.`, `A list item has ${f.texto.length} characters; ${lim.frase} fit.`);
    }
    if (card.frases.some((f) => !f.texto.trim())) { erros.push(`card ${nome}: frase vazia`); noCard(card.id, 'Há uma frase vazia. Escreva ou tire.', 'There is an empty sentence. Write it or remove it.'); }
  }

  if (o.formato === 'carrossel') {
    if (cards.length < MIN_CARDS || cards.length > MAX_CARDS) {
      erros.push(`carrossel com ${cards.length} cards (de ${MIN_CARDS} a ${MAX_CARDS})`);
      noGeral(`O carrossel tem ${cards.length} cards; vão de ${MIN_CARDS} a ${MAX_CARDS}, contando o convite.`, `The carousel has ${cards.length} cards; it takes ${MIN_CARDS} to ${MAX_CARDS}, counting the invite card.`);
    }
    if (!cards.length || !ehConvite(cards[cards.length - 1]) || cards.filter((c) => ehConvite(c)).length !== 1) {
      erros.push('o convite é o último card, e só um');
      noGeral('O convite é o último card, e só um.', 'The invite card is the last card, and there is only one.');
    }
  }

  // Erro de card que só a contagem por card pegou (item de lista longo) também reprova.
  const algumCard = Object.keys(porCard).length > 0;
  if (algumCard && !erros.length) erros.push('há card com problema');
  // Erro sem motivo de leigo em lugar nenhum (não deveria haver): a tela ainda diz que há o que corrigir.
  if (erros.length && !algumCard && !geral.length) noGeral('A conferência apontou um problema fora dos cards. Peça para reescrever.', 'The check found a problem outside the cards. Ask for a rewrite.');
  const unicos = geral.filter(([pt], i) => geral.findIndex(([p]) => p === pt) === i);
  const en = { ...(algumCard ? { porCard: porCardEn } : {}), ...(unicos.length ? { geral: unicos.map(([, e]) => e) } : {}) };
  return {
    ok: erros.length === 0, erros, avisos,
    ...(algumCard ? { porCard } : {}), ...(unicos.length ? { geral: unicos.map(([pt]) => pt) } : {}),
    ...(algumCard || unicos.length ? { en } : {}),
  };
}
