// A fala contra o roteiro, por código e puro: número por extenso conta, em pt e en. A transcrição erra número e nome com
// frequência, então o que sai daqui é aviso para ouvir, nunca reprovação. Texto da transcrição não sai daqui: só o tempo.
import { layoutDe, normalizarCards, type Card } from './cards';
import type { Palavra } from './segmentos';

export type IdiomaFala = 'pt-BR' | 'en';
/** Uma unidade do roteiro: o título (`frase` null) ou uma frase de um card. */
export interface ParteRoteiro { card: number; frase: number | null; texto: string }
export interface AvisoFala { tipo: 'numero' | 'nome' | 'fora'; motivo: 'ausente' | 'trocado' | 'extra'; esperado: string | null; inicio: number; decisao?: 'fala_certa' | null }

/** O roteiro: títulos e frases dos cards. A capa só tem o título na tela, e o convite fica de fora. */
export function roteiroDoReels(cards: Card[] | undefined): ParteRoteiro[] {
  const partes: ParteRoteiro[] = [];
  normalizarCards(cards).forEach((c, card) => {
    const layout = layoutDe(c);
    if (layout === 'convite') return;
    if (c.titulo?.trim()) partes.push({ card, frase: null, texto: c.titulo });
    if (layout !== 'capa') (c.frases ?? []).forEach((f, frase) => { if (f.texto.trim()) partes.push({ card, frase, texto: f.rotulo ? `${f.rotulo}: ${f.texto}` : f.texto }); });
  });
  return partes;
}

const SIMPLES_PT: Record<string, number> = {
  zero: 0, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15,
  dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500,
  seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};
const SIMPLES_EN: Record<string, number> = {
  zero: 0, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
/** "um" sozinho é artigo: só conta dentro de um número ("vinte e um"). */
const UM = new Set(['um', 'uma', 'one']);
const MIL = new Set(['mil', 'thousand']);
const LIGA = new Set(['e', 'and']);
const VIRGULA = new Set(['virgula', 'ponto', 'point']);

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const digitos = (s: string) => (/^\d+(?:[.,]\d{3})+$/.test(s) ? s.replace(/[.,]/g, '') : s.replace(',', '.'));

interface Cru { w: string; bruto: string; i?: number; f?: number; parte?: number; maiuscula: boolean; comeco: boolean }
export interface Token { w: string; bruto: string; i?: number; f?: number; parte?: number; num: boolean; nome: boolean }

function crus(texto: string, base: Omit<Cru, 'w' | 'bruto' | 'maiuscula' | 'comeco'>, antes: { fim: boolean }): Cru[] {
  const out: Cru[] = [];
  for (const m of texto.matchAll(/\d+(?:[.,]\d+)*|\p{L}[\p{L}\p{M}'’-]*|[.!?:]/gu)) {
    if (/^[.!?:]$/.test(m[0])) { antes.fim = true; continue; }
    out.push({ ...base, w: /^\d/.test(m[0]) ? digitos(m[0]) : semAcento(m[0]), bruto: m[0], maiuscula: /^\p{Lu}/u.test(m[0]), comeco: antes.fim });
    antes.fim = false;
  }
  return out;
}

/** Junta os números por extenso num token só, com o valor em algarismos. */
function juntarNumeros(c: Cru[]): Token[] {
  const simples = { ...SIMPLES_PT, ...SIMPLES_EN };
  const out: Token[] = [];
  const palavra = (x: Cru): Token => ({ w: x.w, bruto: x.bruto, i: x.i, f: x.f, parte: x.parte, num: /^\d/.test(x.w), nome: x.maiuscula && !x.comeco && !/^\d/.test(x.w) && x.w.length > 2 });
  for (let i = 0; i < c.length;) {
    const ehNum = (w: string) => w in simples || MIL.has(w) || w === 'hundred';
    if (!ehNum(c[i].w) && !(UM.has(c[i].w) && c[i + 1] && MIL.has(c[i + 1].w))) { out.push(palavra(c[i])); i++; continue; }
    let total = 0;
    let acc = 0;
    let k = i;
    for (;;) {
      const w = c[k]?.w;
      if (w === undefined) break;
      if (MIL.has(w)) { total += (acc || 1) * 1000; acc = 0; k++; }
      else if (w === 'hundred') { acc = (acc || 1) * 100; k++; }
      else if (w in simples) { acc += simples[w]; k++; }
      else if (UM.has(w) && k > i) { acc += 1; k++; }
      else if (LIGA.has(w) && c[k + 1] && (c[k + 1].w in simples || UM.has(c[k + 1].w))) k++;
      else break;
    }
    const fim = c[k - 1];
    out.push({ w: String(total + acc), bruto: c.slice(i, k).map((x) => x.bruto).join(' '), i: c[i].i, f: fim.f, parte: c[i].parte, num: true, nome: false });
    i = k;
  }
  // "dois vírgula cinco" é 2.5, e vale o mesmo que o algarismo.
  for (let i = 1; i < out.length - 1; i++) {
    if (VIRGULA.has(out[i].w) && out[i - 1].num && out[i + 1].num) {
      out.splice(i - 1, 3, { ...out[i - 1], w: `${out[i - 1].w}.${out[i + 1].w}`, f: out[i + 1].f, bruto: `${out[i - 1].bruto} ${out[i].bruto} ${out[i + 1].bruto}` });
    }
  }
  return out;
}

export function tokensDoRoteiro(partes: ParteRoteiro[]): Token[] {
  return partes.flatMap((p, parte) => juntarNumeros(crus(p.texto, { parte }, { fim: true })));
}

export function tokensDaFala(palavras: Palavra[]): Token[] {
  const antes = { fim: false };
  return juntarNumeros(palavras.flatMap((w) => crus(w.p, { i: w.i, f: w.f }, antes)));
}

/** A maior sequência em comum: quais tokens do roteiro foram ouvidos, e onde. */
export function alinhar(a: Token[], b: Token[]): number[] {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i].w === b[j].w ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const par = new Array<number>(n).fill(-1);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i].w === b[j].w) { par[i] = j; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return par;
}

/** Trecho longo fora do roteiro também é aviso: pode ser conversa que entrou na gravação. */
const FORA_MINIMO = 6;

export function compararNarracao(partes: ParteRoteiro[], palavras: Palavra[]): AvisoFala[] {
  const a = tokensDoRoteiro(partes);
  const b = tokensDaFala(palavras);
  const par = alinhar(a, b);
  const avisos: AvisoFala[] = [];
  a.forEach((t, i) => {
    if (par[i] >= 0 || !(t.num || t.nome)) return;
    const antes = par.slice(0, i).filter((x) => x >= 0).at(-1) ?? -1;
    const depois = par.slice(i + 1).find((x) => x >= 0) ?? b.length;
    const vao = b.slice(antes + 1, depois);
    const trocado = t.num ? vao.some((x) => x.num) : vao.length > 0;
    const inicio = vao[0]?.i ?? b[antes]?.f ?? 0;
    avisos.push({ tipo: t.num ? 'numero' : 'nome', motivo: trocado ? 'trocado' : 'ausente', esperado: t.bruto, inicio, decisao: null });
  });
  const ouvidos = new Set(par);
  for (let j = 0; j < b.length;) {
    if (ouvidos.has(j)) { j++; continue; }
    let k = j;
    while (k < b.length && !ouvidos.has(k)) k++;
    if (k - j >= FORA_MINIMO) avisos.push({ tipo: 'fora', motivo: 'extra', esperado: null, inicio: b[j].i ?? 0, decisao: null });
    j = k;
  }
  return avisos.sort((x, y) => x.inicio - y.inicio);
}

const ms = (n: number) => Math.round(n * 1000) / 1000;
const MIN_CARD_S = 0.5;

/**
 * Início de cada parte: o da primeira palavra alinhada. Parte sem alinhamento cai entre as vizinhas, na proporção das
 * palavras. Sem alinhamento nenhum, tudo fica proporcional às palavras.
 */
export function iniciosDasPartes(partes: ParteRoteiro[], palavras: Palavra[], duracao: number): number[] {
  const a = tokensDoRoteiro(partes);
  const b = tokensDaFala(palavras);
  const par = alinhar(a, b);
  const pesos = partes.map((_, p) => Math.max(1, a.filter((t) => t.parte === p).length));
  const achados = partes.map((_, p) => {
    const i = a.findIndex((t, k) => t.parte === p && par[k] >= 0);
    return i >= 0 ? b[par[i]].i ?? null : null;
  });
  const fixos: { p: number; t: number }[] = [{ p: 0, t: 0 }];
  achados.forEach((t, p) => { if (t !== null && p > 0 && t >= fixos.at(-1)!.t) fixos.push({ p, t }); });
  fixos.push({ p: partes.length, t: duracao });
  const inicios = new Array<number>(partes.length).fill(0);
  for (let f = 0; f + 1 < fixos.length; f++) {
    const { p: de, t: tDe } = fixos[f];
    const { p: ate, t: tAte } = fixos[f + 1];
    const soma = pesos.slice(de, ate).reduce((x, y) => x + y, 0);
    let acum = 0;
    for (let p = de; p < ate; p++) {
      inicios[p] = ms(tDe + ((tAte - tDe) * acum) / soma);
      acum += pesos[p];
    }
  }
  return inicios;
}

/** O tempo de cada card e o momento de cada frase, com a voz. `convite`: depois da voz, com o tempo dele. */
export function temposDaNarracao(partes: ParteRoteiro[], palavras: Palavra[], duracao: number, totalCards: number, convite: number) {
  const inicios = iniciosDasPartes(partes, palavras, duracao);
  const cards = [...new Set(partes.map((p) => p.card))];
  const comecos = cards.map((c, j) => (j === 0 ? 0 : inicios[partes.findIndex((p) => p.card === c)]));
  for (let j = 1; j < comecos.length; j++) comecos[j] = Math.max(comecos[j], comecos[j - 1] + MIN_CARD_S);
  if (comecos.at(-1)! > duracao - MIN_CARD_S) comecos.forEach((_, j) => { comecos[j] = ms((duracao * j) / comecos.length); });
  const tempos = new Array<number>(totalCards).fill(0);
  const frases: number[][] = Array.from({ length: totalCards }, () => []);
  cards.forEach((c, j) => { tempos[c] = ms((comecos[j + 1] ?? duracao) - comecos[j]); });
  partes.forEach((p, k) => { if (p.frase !== null) frases[p.card][p.frase] = inicios[k]; });
  for (let c = 0; c < totalCards; c++) if (!tempos[c]) tempos[c] = convite;
  return { tempos, frases };
}
