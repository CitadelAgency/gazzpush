// O revisor de lápis azul (DESIGN.md §10): a pergunta de um editor experiente na margem de cada parágrafo. As perguntas são
// fixas, por código, e nunca vêm do modelo: sem custo, sem alucinação e iguais para qualquer pessoa citada. Daqui saem também o
// ciclo da nota (fica, se risca, nasce) e a busca da fala nas transcrições, que a web usa enquanto a pessoa digita. Funções
// puras, sem dependência de Worker.
import { atribuicaoNoTrecho } from './apuracao';

export interface MarcaRevisor { id: string; blocoId: string; trecho: string; estado: string; risco?: string | null; aberta: boolean }

export type ChaveNota = 'vitima_ou_menor' | 'acusacao_sem_condenacao' | 'sem_outro_lado' | 'conta' | 'aspa' | 'sem_fonte' | 'sem_fonte_numero' | 'sem_fonte_atribuida' | 'manual';

const PERGUNTAS: Record<ChaveNota, { pt: string; en: string }> = {
  sem_fonte: { pt: 'Quem disse isso?', en: 'Who said this?' },
  sem_fonte_numero: { pt: 'Quem disse esse número?', en: 'Who gave this number?' },
  sem_fonte_atribuida: { pt: 'Tem o link? Cole no Dossiê.', en: 'Got the link? Paste it in the Dossier.' },
  sem_outro_lado: { pt: 'Você procurou o outro lado?', en: 'Did you reach the other side?' },
  acusacao_sem_condenacao: { pt: 'Há condenação ou fonte oficial?', en: 'Is there a conviction or official source?' },
  vitima_ou_menor: { pt: 'Precisa do nome aqui?', en: 'Does the name need to be here?' },
  conta: { pt: 'Essa conta fecha?', en: 'Does this math add up?' },
  aspa: { pt: 'Essa fala está em alguma fonte?', en: 'Is this quote in any source?' },
  manual: { pt: 'O manual pede outra forma aqui.', en: 'The style guide asks for another form.' },
};

// Do mais grave ao mais leve: o parágrafo mostra só a primeira pergunta desta ordem.
const PRIORIDADE: ChaveNota[] = ['vitima_ou_menor', 'acusacao_sem_condenacao', 'sem_outro_lado', 'conta', 'aspa', 'sem_fonte_atribuida', 'sem_fonte_numero', 'sem_fonte', 'manual'];
const peso = (c: ChaveNota) => (c.startsWith('sem_fonte') ? PRIORIDADE.indexOf('sem_fonte') : PRIORIDADE.indexOf(c));

export interface Nota { blocoId: string; marcaId: string; chave: ChaveNota; pt: string; en: string }

/** A pergunta de uma marca. Só marca aberta pergunta; o que já tem fonte, gravação ou decisão da pessoa, não. */
function chaveDaMarca(m: MarcaRevisor): ChaveNota | null {
  if (!m.aberta) return null;
  if (m.estado === 'risco') return m.risco === 'vitima_ou_menor' || m.risco === 'acusacao_sem_condenacao' || m.risco === 'sem_outro_lado' ? m.risco : null;
  if (m.estado === 'conta' || m.estado === 'aspa' || m.estado === 'manual') return m.estado;
  if (m.estado !== 'sem_fonte') return null;
  // Frase atribuída sem link continua sem fonte: a pergunta muda, porque agora falta só o documento.
  if (atribuicaoNoTrecho(m.trecho)) return 'sem_fonte_atribuida';
  return /\d/.test(m.trecho) ? 'sem_fonte_numero' : 'sem_fonte';
}

/** No máximo uma nota por parágrafo: a mais grave; no empate, a da primeira marca. */
export function notasDoTexto(marcas: MarcaRevisor[]): Nota[] {
  const porBloco = new Map<string, Nota>();
  for (const m of marcas) {
    const chave = chaveDaMarca(m);
    if (!chave) continue;
    const atual = porBloco.get(m.blocoId);
    if (!atual || peso(chave) < peso(atual.chave)) porBloco.set(m.blocoId, { blocoId: m.blocoId, marcaId: m.id, chave, ...PERGUNTAS[chave] });
  }
  return [...porBloco.values()];
}

// ── o ciclo da nota ─────────────────────────────────────────────────────────────────────────────────────────────

export type FaseNota = 'pronta' | 'nasce' | 'risca';
export type NotaViva = Nota & { fase: FaseNota };

export interface OpcoesCiclo {
  /** Blocos com texto: nota de bloco apagado sai sem cerimônia. */
  existem: Set<string>;
  /** Blocos sem conferência válida agora (mexidos, conferindo, com falha): a nota de antes fica como está. */
  espera: Set<string>;
  /** O parágrafo em que a pessoa escreve não recebe nota nova. */
  cursor: string | null;
  /** Falso na abertura do texto: tudo entra pronto, inclusive no parágrafo do cursor. */
  sessao: boolean;
  /** Falso com `prefers-reduced-motion`: a nota que sairia riscada sai direto, e a nova entra pronta. */
  animar: boolean;
}

/** O que a margem mostra depois de uma mudança: `alvo` é o que as marcas pedem agora, `vivas` o que já está na tela. */
export function reconciliarNotas(vivas: NotaViva[], alvo: Nota[], o: OpcoesCiclo): NotaViva[] {
  const pedida = new Map(alvo.map((n) => [n.blocoId, n]));
  const ficam = new Set<string>();
  const saida: NotaViva[] = [];
  for (const v of vivas) {
    if (!o.existem.has(v.blocoId)) continue;
    if (v.fase === 'risca') { if (o.animar) saida.push(v); continue; }
    if (o.espera.has(v.blocoId)) { saida.push(v); ficam.add(v.blocoId); continue; }
    const n = pedida.get(v.blocoId);
    if (n?.chave === v.chave) { saida.push({ ...n, fase: v.fase }); ficam.add(v.blocoId); }
    else if (o.animar && !saida.some((x) => x.fase === 'risca' && x.blocoId === v.blocoId && x.chave === v.chave)) saida.push({ ...v, fase: 'risca' });
  }
  for (const n of alvo) {
    if (ficam.has(n.blocoId) || o.espera.has(n.blocoId) || !o.existem.has(n.blocoId)) continue;
    if (o.sessao && o.cursor === n.blocoId) continue;
    saida.push({ ...n, fase: o.sessao && o.animar ? 'nasce' : 'pronta' });
  }
  return saida;
}

// ── a fala da gravação ──────────────────────────────────────────────────────────────────────────────────────────

const normal = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const PALAVRA = /[\p{L}\p{M}\p{N}]+/gu;

export interface AspaAberta { inicio: number; digitado: string; fecha: string }

/** A aspa aberta antes do cursor, com o que veio depois dela. Aspa já fechada não conta. */
export function aspaAberta(antes: string): AspaAberta | null {
  let inicio = -1, fecha = '';
  for (let i = 0; i < antes.length; i++) {
    const c = antes[i];
    if (c === '“') { inicio = i; fecha = '”'; }
    else if (c === '«') { inicio = i; fecha = '»'; }
    else if (c === '”' || c === '»') inicio = -1;
    else if (c === '"') {
      if (inicio >= 0 && fecha === '"') inicio = -1;
      else if (inicio < 0) { inicio = i; fecha = '"'; }
    }
  }
  return inicio < 0 ? null : { inicio, digitado: antes.slice(inicio + 1), fecha };
}

export interface TrechoFala { gravacao: string; nome: string; inicio: number; texto: string }
export interface FalaAchada { trecho: TrechoFala; resto: string }

/** Onde parar dentro da palavra literal, depois de `n` letras sem acento: "ônibus" com 3 letras para em "ôni|bus". */
function corteNaPalavra(palavra: string, n: number) {
  let lidas = 0, pos = 0;
  for (const c of palavra) {
    if (lidas >= n) break;
    lidas += normal(c).length;
    pos += c.length;
  }
  return pos;
}

/**
 * Procura o que foi digitado depois da aspa, palavra por palavra, sem acento e sem caixa. A última palavra pode estar pela
 * metade, a não ser que a pessoa já tenha passado dela. Devolve a fala e o resto literal dela, que é o único texto que a
 * tela insere. Menos de 3 palavras, ou a fala já inteira: nada.
 */
export function acharFala(digitado: string, trechos: TrechoFala[]): FalaAchada | null {
  const q = normal(digitado).match(PALAVRA) ?? [];
  if (q.length < 3) return null;
  const pelaMetade = /[\p{L}\p{M}\p{N}]$/u.test(digitado);
  const ultima = q[q.length - 1];
  for (const trecho of trechos) {
    const achadas = [...trecho.texto.matchAll(PALAVRA)];
    const ws = achadas.map((m) => normal(m[0]));
    for (let i = 0; i + q.length <= ws.length; i++) {
      let k = 0;
      while (k < q.length - 1 && ws[i + k] === q[k]) k++;
      if (k < q.length - 1) continue;
      const alvo = ws[i + k];
      if (!(alvo === ultima || (pelaMetade && alvo.startsWith(ultima)))) continue;
      const m = achadas[i + k];
      let resto = trecho.texto.slice(m.index + (alvo === ultima ? m[0].length : corteNaPalavra(m[0], ultima.length))).trimEnd();
      if (/\s$/.test(digitado)) resto = resto.trimStart();
      else if (!pelaMetade && resto[0] === digitado.at(-1)) resto = resto.slice(1).trimStart();
      if (!/[\p{L}\p{N}]/u.test(resto)) return null;
      return { trecho, resto };
    }
  }
  return null;
}
