// Apuração por código, sem modelo: contas que não fecham, aspas que não estão no dossiê, pessoas e instituições do
// texto (grafia e outro lado), o manual de redação do veículo, a força das fontes e as fontes circulares. Tudo aqui é
// determinístico e igual para qualquer pessoa citada (a mesma regra vale para todo mundo). Sem dependência de Worker.

export type Idioma = 'pt-BR' | 'en';

// ── números ─────────────────────────────────────────────────────────────────────────────────────────────────────

const MULT_PT: [RegExp, number][] = [[/^mil$/i, 1e3], [/^milh(?:ão|ões)$/i, 1e6], [/^bilh(?:ão|ões)$/i, 1e9], [/^trilh(?:ão|ões)$/i, 1e12]];
const MULT_EN: [RegExp, number][] = [[/^thousand$/i, 1e3], [/^million$/i, 1e6], [/^billion$/i, 1e9], [/^trillion$/i, 1e12]];
const N_PT = String.raw`(?:R\$\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?)(?:\s+(milh(?:ão|ões)|bilh(?:ão|ões)|trilh(?:ão|ões)|mil)(?![A-Za-zÀ-ÿ]))?(?![\d.,]\d)`;
const N_EN = String.raw`(?:\$\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s+(thousand|million|billion|trillion)(?![A-Za-z]))?(?![\d.,]\d)`;

export interface Numero { valor: number; casas: number; mult: number }

/** "1.234,5 mil" (pt) ou "1,234.5 thousand" (en) → valor, casas decimais escritas e o multiplicador. */
export function lerNumero(digitos: string, mult: string | undefined, idioma: Idioma): Numero {
  const [int, dec = ''] = idioma === 'en' ? digitos.split('.') : digitos.split(',');
  const inteiro = int.replace(idioma === 'en' ? /,/g : /\./g, '');
  const m = mult ? ((idioma === 'en' ? MULT_EN : MULT_PT).find(([r]) => r.test(mult))?.[1] ?? 1) : 1;
  return { valor: Number(`${inteiro}.${dec || '0'}`) * m, casas: dec.length, mult: m };
}

const fmt = (n: number, idioma: Idioma) => new Intl.NumberFormat(idioma, { maximumFractionDigits: Math.abs(n) < 10 ? 2 : 1 }).format(n);
/** Meia unidade da última casa escrita: "12,5%" aceita 12,45 a 12,55; "30%", de 29,5 a 30,5. */
const folga = (n: Numero) => (0.5 * 10 ** -n.casas) * n.mult + 1e-9;

export interface Apontamento { blocoId: string; inicio: number; fim: number; trecho: string; explicacao: string }

const QUEDA = /^(queda|redução|recuo|baixa|diminuição|caiu|recuou|diminuiu|encolheu|drop|fall|decline|decrease|fell|dropped|declined|decreased|shrank)$/i;
const VAR_PT = 'alta|aumento|crescimento|salto|queda|redução|recuo|baixa|diminuição|subiu|cresceu|aumentou|saltou|caiu|recuou|diminuiu|encolheu';
const VAR_EN = 'rise|increase|growth|jump|drop|fall|decline|decrease|rose|grew|increased|jumped|fell|dropped|declined|decreased|shrank';

function padroes(idioma: Idioma) {
  const N = idioma === 'en' ? N_EN : N_PT;
  const PCT = idioma === 'en' ? String.raw`\s*(?:%|percent)` : String.raw`\s*(?:%|por\s+cento)`;
  const de = idioma === 'en' ? String.raw`\bfrom\s+${N}\s+to\s+${N}` : String.raw`\bde\s+${N}\s+(?:para|a)\s+${N}`;
  const kw = `\\b(${idioma === 'en' ? VAR_EN : VAR_PT})\\s+(?:(?:${idioma === 'en' ? 'of|by' : 'de'})\\s+)?${N}${PCT}`;
  const parte = idioma === 'en'
    ? String.raw`\b${N}\s+(?:of|out\s+of)(?:\s+the)?\s+${N}\b([^.;%\d]{0,50}?)${N}${PCT}`
    : String.raw`\b${N}\s+(?:de|dos|das)\s+${N}\b([^.;%\d]{0,50}?)${N}${PCT}`;
  const lista = String.raw`${N}(?:\s*,\s*${N})*\s+(?:e|and)\s+${N}`;
  const soma = idioma === 'en'
    ? String.raw`(${lista})[^.;\d]{0,60}?\b(?:add\s+up\s+to|adding\s+up\s+to|total(?:ing|ling|s)?|in\s+total|altogether)\s*(?:of\s+)?${N}`
    : String.raw`(${lista})[^.;\d]{0,60}?\b(?:somam|somando|soma|totalizam|totalizando|total\s+de|no\s+total|ao\s+todo)\s*(?:de\s+)?${N}`;
  return {
    N: new RegExp(N, 'g'),
    variacao: new RegExp(`${de}[^.;]{0,80}?${kw}`, 'giu'),
    variacaoAntes: new RegExp(`${kw}[^.;]{0,80}?${de}`, 'giu'),
    parte: new RegExp(parte, 'giu'),
    soma: new RegExp(soma, 'giu'),
  };
}

/**
 * Contas do parágrafo recalculadas por código: variação ("de 10 para 15, alta de 50%"), parte do todo ("12 dos 40
 * contratos (30%)") e soma ("3, 4 e 5, somando 12"). Conta que não fecha vira apontamento com a conta certa.
 */
export function contasDoBloco(blocoId: string, texto: string, idioma: Idioma = 'pt-BR'): Apontamento[] {
  const p = padroes(idioma);
  const tr = (pt: string, en: string) => (idioma === 'en' ? en : pt);
  const out: Apontamento[] = [];
  const add = (m: RegExpExecArray | RegExpMatchArray, explicacao: string) => {
    const inicio = m.index ?? 0;
    if (out.some((o) => inicio < o.fim && inicio + m[0].length > o.inicio)) return;
    out.push({ blocoId, inicio, fim: inicio + m[0].length, trecho: m[0], explicacao });
  };
  const variacao = (m: RegExpMatchArray, a: Numero, b: Numero, palavra: string, z: Numero) => {
    // "de 2020 para 2024, alta de 30%": o par é de anos, não a base da conta.
    const ano = (n: Numero) => n.mult === 1 && n.casas === 0 && n.valor >= 1900 && n.valor <= 2100;
    if (!a.valor || (ano(a) && ano(b))) return;
    const real = ((b.valor - a.valor) / a.valor) * 100;
    const desce = QUEDA.test(palavra);
    const sentido = desce ? -1 : 1;
    if ((real < 0) !== desce && Math.abs(real) > folga(z)) {
      add(m, tr(`De ${fmt(a.valor, idioma)} para ${fmt(b.valor, idioma)} é ${real < 0 ? 'queda' : 'alta'} de ${fmt(Math.abs(real), idioma)}%, não ${palavra.toLowerCase()}.`,
        `From ${fmt(a.valor, idioma)} to ${fmt(b.valor, idioma)} is a ${real < 0 ? 'drop' : 'rise'} of ${fmt(Math.abs(real), idioma)}%, not a ${palavra.toLowerCase()}.`));
    } else if (Math.abs(real * sentido - z.valor) > folga(z)) {
      add(m, tr(`De ${fmt(a.valor, idioma)} para ${fmt(b.valor, idioma)} é ${real < 0 ? 'queda' : 'alta'} de ${fmt(Math.abs(real), idioma)}%, não de ${fmt(z.valor, idioma)}%.`,
        `From ${fmt(a.valor, idioma)} to ${fmt(b.valor, idioma)} is a ${real < 0 ? 'drop' : 'rise'} of ${fmt(Math.abs(real), idioma)}%, not ${fmt(z.valor, idioma)}%.`));
    }
  };
  const num = (d: string, m?: string) => lerNumero(d, m, idioma);
  // "de 10 para 15 milhões": o multiplicador do segundo vale para o primeiro.
  const par = (a: Numero, b: Numero): [Numero, Numero] => (a.mult === 1 && b.mult > 1 ? [{ ...a, valor: a.valor * b.mult, mult: b.mult }, b] : [a, b]);
  for (const m of texto.matchAll(p.variacao)) variacao(m, ...par(num(m[1], m[2]), num(m[3], m[4])), m[5], num(m[6], m[7]));
  for (const m of texto.matchAll(p.variacaoAntes)) variacao(m, ...par(num(m[4], m[5]), num(m[6], m[7])), m[1], num(m[2], m[3]));
  for (const m of texto.matchAll(p.parte)) {
    const x = num(m[1], m[2]), y = num(m[3], m[4]), z = num(m[6], m[7]);
    if (!y.valor || x.valor > y.valor) continue;
    const real = (x.valor / y.valor) * 100;
    if (Math.abs(real - z.valor) > folga(z)) {
      add(m, tr(`${fmt(x.valor, idioma)} de ${fmt(y.valor, idioma)} é ${fmt(real, idioma)}%, não ${fmt(z.valor, idioma)}%.`,
        `${fmt(x.valor, idioma)} of ${fmt(y.valor, idioma)} is ${fmt(real, idioma)}%, not ${fmt(z.valor, idioma)}%.`));
    }
  }
  for (const m of texto.matchAll(p.soma)) {
    let itens = [...m[1].matchAll(new RegExp(p.N.source, 'g'))].map((x) => num(x[1], x[2]));
    // "3, 4 e 5 milhões": o multiplicador do último vale para os de antes que não têm.
    const ult = itens.at(-1)?.mult ?? 1;
    if (ult > 1) itens = itens.map((n) => (n.mult === 1 ? { ...n, valor: n.valor * ult, mult: ult } : n));
    const total = num(m[m.length - 2], m[m.length - 1]);
    if (itens.length < 2) continue;
    const soma = itens.reduce((s, n) => s + n.valor, 0);
    if (Math.abs(soma - total.valor) > folga(total)) {
      add(m, tr(`A soma dá ${fmt(soma, idioma)}, não ${fmt(total.valor, idioma)}.`, `The sum is ${fmt(soma, idioma)}, not ${fmt(total.valor, idioma)}.`));
    }
  }
  return out.sort((a, b) => a.inicio - b.inicio);
}

// ── aspas ───────────────────────────────────────────────────────────────────────────────────────────────────────

const espacos = (s: string) => s.replace(/\s+/g, ' ').trim();

export interface Aspa { blocoId: string; inicio: number; fim: number; trecho: string; citacao: string; evidenciaId: string | null }

const VERBO_DE_DIZER = '(?:disse|diz|dizia|afirmou|afirma|respondeu|responde|declarou|declara|concluiu|conclui|resumiu|resume|negou|nega|admitiu|admite|confirmou|confirma|escreveu|escreve|said|says|replied|answered|concluded|wrote|denied|admitted|confirmed)';
/** Antes da aspa de uma palavra só, o que a faz fala: dois-pontos ou verbo de dizer ("respondeu “Sim”"). */
const ANTES_DA_FALA = new RegExp(`(?::|\\b${VERBO_DE_DIZER})\\s*,?\\s*$`, 'iu');
/** Depois dela: vírgula ou travessão e verbo de dizer ("“Sim”, respondeu Aurora"). */
const DEPOIS_DA_FALA = new RegExp(`^\\s*[,—–-]\\s*${VERBO_DE_DIZER}\\b`, 'iu');

/**
 * Cada citação entre aspas do parágrafo e a evidência do dossiê em que ela está literalmente (espaços juntos; a
 * pontuação final de dentro das aspas não conta). Sem evidência: "aspa não conferida". Não há teto de tamanho. A
 * palavra solta entre aspas é destaque ("chamou o caso de "laranja"") e fica de fora, a não ser que seja fala: com a
 * pontuação dentro das aspas (“Superfaturamento.”), depois de dois-pontos ou de verbo de dizer, ou antes de vírgula
 * e verbo de dizer (“Sim”, respondeu).
 */
export function aspasDoBloco(blocoId: string, texto: string, evidencias: { id: string; texto: string }[]): Aspa[] {
  const normais = evidencias.map((e) => ({ id: e.id, texto: espacos(e.texto) }));
  const out: Aspa[] = [];
  for (const m of texto.matchAll(/[“"«]([^”"»“]+)[”"»]/g)) {
    const citacao = espacos(m[1]).replace(/[.,;:!?…]+$/, '');
    const palavras = citacao.split(' ').filter((p) => /[\p{L}\p{N}]/u.test(p)).length;
    if (!palavras) continue;
    const fim = m.index! + m[0].length;
    if (palavras < 2 && !/[.!?…]\s*$/.test(m[1]) && !ANTES_DA_FALA.test(texto.slice(Math.max(0, m.index! - 40), m.index!)) && !DEPOIS_DA_FALA.test(texto.slice(fim, fim + 40))) continue;
    const ev = normais.find((e) => e.texto.includes(citacao));
    out.push({ blocoId, inicio: m.index!, fim: m.index! + m[0].length, trecho: m[0], citacao, evidenciaId: ev?.id ?? null });
  }
  return out;
}

// ── pessoas e instituições ──────────────────────────────────────────────────────────────────────────────────────

const PARTICULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'del', 'van', 'von', 'of', 'the']);
const INSTITUICAO = /^(Ministério|Câmara|Prefeitura|Secretaria|Tribunal|Polícia|Assembleia|Assembléia|Governo|Partido|Universidade|Instituto|Banco|Supremo|Senado|Congresso|Conselho|Fundação|Associação|Sindicato|Igreja|Empresa|Companhia|Agência|Comissão|Defensoria|Procuradoria|Receita|Controladoria|Justiça|Exército|Marinha|Força|Movimento|Federação|Confederação|Hospital|Escola|Colégio|Departamento|Ministry|Department|Court|Police|Council|University|Institute|Agency|Committee|Senate|Congress|Party|Church|Bank|Company)$/;
const NAO_NOME = new Set([
  'Segundo', 'Para', 'Em', 'No', 'Na', 'Nos', 'Nas', 'Com', 'Sem', 'Após', 'Depois', 'Antes', 'Ontem', 'Hoje', 'Amanhã', 'Desde', 'Mas', 'Porém', 'Quando',
  'Como', 'Já', 'Ainda', 'Também', 'Isso', 'Essa', 'Esse', 'Este', 'Esta', 'Aquele', 'Aquela', 'De', 'Do', 'Da', 'Dos', 'Das', 'Por', 'Pela', 'Pelo', 'Pelas',
  'Pelos', 'Ao', 'Aos', 'Os', 'As', 'Um', 'Uma', 'Uns', 'Umas', 'Se', 'Até', 'Entre', 'Sobre', 'Durante', 'Enquanto', 'Mesmo', 'Outro', 'Outra', 'Cada',
  'Todo', 'Toda', 'Todos', 'Todas', 'Nenhum', 'Nenhuma', 'Procurado', 'Procurada', 'Procurados', 'Procuradas', 'Questionado', 'Questionada', 'Disse',
  'Afirmou', 'Diz', 'Conforme', 'Pois', 'Então', 'Assim', 'Nesse', 'Neste', 'Nessa', 'Nesta', 'Dessa', 'Desse', 'Deste', 'Desta', 'Na', 'Seu', 'Sua',
  'According', 'In', 'On', 'At', 'For', 'With', 'Without', 'After', 'Before', 'Yesterday', 'Today', 'But', 'When', 'This', 'That', 'The', 'A', 'An', 'By',
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro', 'Segunda', 'Terça',
  'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
]);
const NOME = /\p{Lu}[\p{Ll}'’-]+(?:\s+(?:(?:da|de|do|das|dos|e|di|del|van|von)\s+)?\p{Lu}[\p{Ll}'’-]+)+|\b\p{Lu}{2,6}\b/gu;

/** Chave de grafia: sem acento, sem partícula, consoantes dobradas e trocas comuns (z/s, y/i, ph/f) juntas. */
export function chaveNome(nome: string): string {
  return nome.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/\s+/).filter((p) => !PARTICULAS.has(p)).join(' ')
    .replace(/ph/g, 'f').replace(/th/g, 't').replace(/y/g, 'i').replace(/w/g, 'v').replace(/z/g, 's').replace(/(\p{L})\1/gu, '$1');
}

export interface Mencao { blocoId: string; inicio: number; fim: number }
export interface Nome { nome: string; tipo: 'pessoa' | 'instituicao'; mencoes: Mencao[] }

/** Nomes próprios do texto (duas palavras com maiúscula ou mais; ou sigla), sem a palavra de começo de frase. */
export function nomesDoTexto(blocos: { id: string; texto: string }[]): Nome[] {
  const porNome = new Map<string, Nome>();
  for (const b of blocos) {
    for (const m of b.texto.matchAll(NOME)) {
      let nome = m[0];
      let inicio = m.index!;
      // Tira palavras de começo de frase.
      for (;;) {
        const primeira = nome.split(/\s+/)[0];
        if (!NAO_NOME.has(primeira) || primeira === nome) break;
        const resto = nome.slice(primeira.length).replace(/^\s+/, '');
        inicio += nome.length - resto.length;
        nome = resto.replace(/^(?:da|de|do|das|dos|e)\s+/, (x) => { inicio += x.length; return ''; });
      }
      const palavras = nome.split(/\s+/);
      const sigla = /^\p{Lu}{2,6}$/u.test(nome);
      if (!sigla && palavras.filter((p) => !PARTICULAS.has(p)).length < 2) continue;
      if (NAO_NOME.has(nome)) continue;
      const tipo = sigla || INSTITUICAO.test(palavras[0]) ? 'instituicao' : 'pessoa';
      const n = porNome.get(nome) ?? { nome, tipo, mencoes: [] };
      n.mencoes.push({ blocoId: b.id, inicio, fim: inicio + nome.length });
      porNome.set(nome, n);
    }
  }
  return [...porNome.values()];
}

/** Grafias diferentes do mesmo nome no texto: só aponta, a pessoa decide. */
export function grafiasDiferentes(nomes: Nome[]): string[][] {
  const grupos = new Map<string, string[]>();
  for (const n of nomes) if (n.tipo === 'pessoa') { const k = chaveNome(n.nome); grupos.set(k, [...(grupos.get(k) ?? []), n.nome]); }
  return [...grupos.values()].filter((g) => g.length > 1);
}

/** O nome aparece no trecho (ou o trecho cita alguém com a mesma chave de grafia). */
export function citaNome(trecho: string, nome: string): boolean {
  return trecho.includes(nome) || chaveNome(trecho).includes(chaveNome(nome));
}

// ── manual de redação ───────────────────────────────────────────────────────────────────────────────────────────

export const TIPOS_REGRA = ['sigla', 'grafia', 'numero', 'cargo', 'linguagem'] as const;
export type TipoRegra = (typeof TIPOS_REGRA)[number];
export interface Regra { id: string; tipo: TipoRegra; procurar: string; preferir: string | null; nota: string | null }
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Onde o parágrafo usa a forma que o manual pede para evitar (palavra inteira; sigla respeita maiúsculas). Só aponta. */
export function manualNoBloco(blocoId: string, texto: string, regras: Regra[], idioma: Idioma = 'pt-BR'): (Apontamento & { regraId: string; tipo: TipoRegra })[] {
  const out: (Apontamento & { regraId: string; tipo: TipoRegra })[] = [];
  for (const r of regras) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escRe(r.procurar)}(?![\\p{L}\\p{N}])`, r.tipo === 'sigla' ? 'gu' : 'giu');
    for (const m of texto.matchAll(re)) {
      if (r.preferir && m[0] === r.preferir) continue;
      const inicio = m.index!;
      if (out.some((o) => inicio < o.fim && inicio + m[0].length > o.inicio)) continue;
      const pede = r.preferir ? (idioma === 'en' ? `The style guide asks for “${r.preferir}”.` : `O manual pede “${r.preferir}”.`) : (idioma === 'en' ? 'The style guide asks to avoid this.' : 'O manual pede para evitar.');
      out.push({ blocoId, inicio, fim: inicio + m[0].length, trecho: m[0], explicacao: r.nota ? `${pede} ${r.nota}` : pede, regraId: r.id, tipo: r.tipo });
    }
  }
  return out.sort((a, b) => a.inicio - b.inicio);
}

// ── fontes ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const TIPOS_FONTE = ['oficial', 'primaria', 'materia', 'anonima'] as const;
export type TipoFonte = (typeof TIPOS_FONTE)[number];
export type Forca = 'forte' | 'media' | 'fraca' | 'sem_tipo';

/** Endereço de órgão público → "oficial" (sugestão; a pessoa confirma). Nunca por linha política do veículo. */
export function tipoSugerido(url: string): TipoFonte | null {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (/(^|\.)(gov|jus|leg|mp|def|mil)\.br$/.test(host) || /\.gov$/.test(host) || /(^|\.)gov\.[a-z]{2}$/.test(host) || host.includes('diariooficial')) return 'oficial';
  return null;
}

/** Força pelo tipo da fonte: documento oficial e fonte primária, forte; outra matéria, média; anônima, fraca. */
export const forcaDe = (tipo: TipoFonte | null): Forca => (tipo === 'oficial' || tipo === 'primaria' ? 'forte' : tipo === 'materia' ? 'media' : tipo === 'anonima' ? 'fraca' : 'sem_tipo');

const nucleoUrl = (u: string) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`; } catch { return ''; } };
const SEQ = 25;  // palavras seguidas iguais: uma repete a outra

/**
 * Fontes que não são independentes: uma cita o endereço da outra, ou as duas têm um trecho de 25 palavras seguidas
 * iguais (uma copiou a outra, ou as duas vieram do mesmo lugar). Contar as duas como duas fontes engana.
 */
export function fontesCirculares(evs: { id: string; url: string; texto: string }[]): { de: string; para: string; motivo: 'cita' | 'repete' }[] {
  const out: { de: string; para: string; motivo: 'cita' | 'repete' }[] = [];
  const seqs = evs.map((e) => {
    const ps = e.texto.slice(0, 30_000).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const s = new Set<string>();
    for (let i = 0; i + SEQ <= ps.length; i++) s.add(ps.slice(i, i + SEQ).join(' '));
    return s;
  });
  for (let i = 0; i < evs.length; i++) {
    for (let j = 0; j < evs.length; j++) {
      const alvo = nucleoUrl(evs[j].url);
      if (i !== j && alvo.length >= 12 && evs[i].texto.includes(alvo)) out.push({ de: evs[i].id, para: evs[j].id, motivo: 'cita' });
    }
  }
  const ligadas = (a: string, b: string) => out.some((o) => (o.de === a && o.para === b) || (o.de === b && o.para === a));
  for (let i = 0; i < evs.length; i++) {
    for (let j = i + 1; j < evs.length; j++) {
      if (ligadas(evs[i].id, evs[j].id)) continue;
      const [a, b] = seqs[i].size < seqs[j].size ? [seqs[i], seqs[j]] : [seqs[j], seqs[i]];
      for (const s of a) if (b.has(s)) { out.push({ de: evs[j].id, para: evs[i].id, motivo: 'repete' }); break; }
    }
  }
  return out;
}

// ── temas ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Acusação no parágrafo: ganha segunda opinião (a mesma lista para qualquer citado). */
export const ACUSACAO = /\b(acus\w*|denunci\w*|desvi\w*|fraud\w*|corrup\w*|propin\w*|crimes?\b|criminos\w*|investigad\w*|indiciad\w*|r[ée]us?\b|condenad\w*|pres[oa]s?\b|lavagem|superfaturad\w*|il[íi]cit\w*|irregularidade\w*|ass[ée]dio\w*|estupr\w*|agred\w*|assassin\w*|accus\w*|fraud\w*|brib\w*|embezzl\w*|indict\w*|convict\w*|launder\w*)/i;

/** Assuntos que modelos chineses suavizam: o texto inteiro é conferido por outro fornecedor. */
/** Parágrafo que registra o outro lado (procurado, respondeu, em nota, negou…): mudou ou saiu, as acusações são reconferidas. */
export const OUTRO_LADO = /\b(procurad[oa]s?|n[ãa]o respond\w*|n[ãa]o retorn\w*|em nota|por meio de nota|nota oficial|assessoria|n[ãa]o se manifest\w*|n[ãa]o quis comentar|negou|negam?|desconhec\w*|(?:disse|afirmou|declarou|respondeu|informou) (?:à|ao) (?:reportagem|jornal|site|blog)|rebateu|contestou|a defesa d\w*|advogad[oa]s? d\w*|contacted|did not respond|declined to comment|statement|denied|denies|told (?:the|this) \w+)\b/i;
export const TEMA_SENSIVEL = /\b(taiwan\w*|xinjiang|uigur\w*|uyghur\w*|tiananmen|tian'anmen|hong kong|tibet\w*|dalai lama|falun gong|partido comunista chin\w*|chinese communist party|governo chin\w*|chinese government|xi jinping|pequim|beijing)\b/i;

/** Temas para a auditoria (os eixos da bateria de simetria): ver se as marcas pesam mais para um lado. */
export const TEMAS: { id: string; pt: string; en: string; re: RegExp }[] = [
  { id: 'politica', pt: 'Política partidária', en: 'Party politics', re: /\b(PT|PL|PSDB|MDB|PSOL|PSB|PDT|União Brasil|Republicanos|partido\w*|governo|oposição|prefeit\w*|vereador\w*|deputad\w*|senador\w*|governador\w*|president\w*|party|government|opposition|mayor|senator)\b/i },
  { id: 'religiao', pt: 'Religião', en: 'Religion', re: /\b(igreja\w*|evang[ée]lic\w*|cat[óo]lic\w*|terreiro\w*|candombl\w*|umband\w*|pastor\w*|padre\w*|templo\w*|mesquita\w*|sinagoga\w*|church\w*|evangelical\w*|catholic\w*|mosque\w*|synagogue\w*)\b/i },
  { id: 'genero', pt: 'Gênero', en: 'Gender', re: /\b(mulher\w*|vereadora\w*|deputada\w*|prefeita\w*|feminin\w*|trans\b|LGBT\w*|woman|women|female)\b/i },
  { id: 'raca', pt: 'Raça', en: 'Race', re: /\b(negr[oa]s?|pret[oa]s?|brancos?|brancas?|ind[íi]gena\w*|quilombo\w*|racis\w*|black|white|indigenous)\b/i },
  { id: 'seguranca', pt: 'Polícia e movimentos sociais', en: 'Police and social movements', re: /\b(PM|pol[íi]cia\w*|policia\w*|MTST|movimento\w*|ocupa[çc][ãa]o|ocupa[çc][õo]es|protesto\w*|police|protest\w*|movement\w*)\b/i },
  { id: 'campo', pt: 'Campo', en: 'Countryside', re: /\b(MST|agroneg[óo]cio\w*|fazend\w*|ruralist\w*|reforma agr[áa]ria|latif[úu]ndi\w*|agribusiness|farm\w*)\b/i },
];
export const temasDe = (texto: string) => TEMAS.filter((t) => t.re.test(texto)).map((t) => t.id);

// ── decisões do cartão ──────────────────────────────────────────────────────────────────────────────────────────

export const TIPOS_DECISAO = ['fonte', 'outro_lado', 'opiniao', 'ignorar'] as const;
export type TipoDecisao = (typeof TIPOS_DECISAO)[number];
export const MEIOS_OUTRO_LADO = ['email', 'telefone', 'mensagem', 'pessoalmente', 'oficio', 'outro'] as const;
/** Riscos que "Procurei o outro lado" resolve (a vítima ou o menor citado pelo nome não se resolve procurando alguém). */
export const RISCOS_OUTRO_LADO = ['acusacao_sem_condenacao', 'sem_outro_lado'];

/**
 * A marca continua aberta? Sem decisão: sem fonte, risco e o que as duas opiniões discordaram. Com decisão: fonte presa,
 * opinião e ignorar fecham; outro lado fecha os riscos de acusação e de outro lado.
 */
export function marcaAberta(a: { estado: string; risco: string | null; incerto?: number | boolean }, d?: { tipo: string } | null): boolean {
  if (d) return d.tipo === 'outro_lado' ? !(a.estado === 'risco' && RISCOS_OUTRO_LADO.includes(a.risco ?? '')) : false;
  return a.estado !== 'com_evidencia' || !!a.incerto;
}

// ── atribuição ──────────────────────────────────────────────────────────────────────────────────────────────────

// "segundo" só é atribuição fora de "o segundo turno", "em segundo lugar"; "conforme" não conta em "conforme previsto".
const ATRIBUICAO = /(?<![\p{L}\p{N}])(?:(?<!(?<![\p{L}\p{N}])(?:o|no|do|ao|pelo|um|em|seu|sua|este|esse)\s)segundo\s+(?!lugar|turno|semestre|trimestre|tempo|plano)[\p{L}\p{N}]|de acordo com|conforme\s+(?!previsto|esperado|combinado)[\p{L}\p{N}]|(?:disseram|disse|dizem|diz|afirmaram|afirmou|afirmam|afirma|declararam|declarou|declara|informaram|informou|informa|relataram|relatou|revelaram|revelou|apontaram|apontou|aponta|explicou|according to|said|says|stated|states that|claimed|claims that|reported|told|announced|testified|wrote)(?![\p{L}\p{N}]))/iu;

/** A frase já diz quem falou ("segundo o Diário Oficial", "according to the report", "disse o prefeito"). Isso não é fonte: é a pista de que falta o link. */
export const atribuicaoNoTrecho = (trecho: string) => ATRIBUICAO.test(trecho);
