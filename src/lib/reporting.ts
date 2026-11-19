// Reporting checks by code, no model: sums that do not add up, quotes not in the dossier, the text's people and
// institutions (spelling and the other side), the outlet's style guide, source strength and circular sources.
// Everything here is deterministic and the same for any person mentioned (the same rule applies to everyone). No Worker
// dependency.

export type Language = 'pt-BR' | 'en';

// ── numbers ─────────────────────────────────────────────────────────────────────────────────────────────────────

const MULT_PT: [RegExp, number][] = [[/^mil$/i, 1e3], [/^milh(?:ão|ões)$/i, 1e6], [/^bilh(?:ão|ões)$/i, 1e9], [/^trilh(?:ão|ões)$/i, 1e12]];
const MULT_EN: [RegExp, number][] = [[/^thousand$/i, 1e3], [/^million$/i, 1e6], [/^billion$/i, 1e9], [/^trillion$/i, 1e12]];
const N_PT = String.raw`(?:R\$\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?)(?:\s+(milh(?:ão|ões)|bilh(?:ão|ões)|trilh(?:ão|ões)|mil)(?![A-Za-zÀ-ÿ]))?(?![\d.,]\d)`;
const N_EN = String.raw`(?:\$\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s+(thousand|million|billion|trillion)(?![A-Za-z]))?(?![\d.,]\d)`;

export interface NumberMatch { valor: number; casas: number; mult: number }

/** "1.234,5 mil" (pt) or "1,234.5 thousand" (en) → value, decimal places written and the multiplier. */
export function readNumber(digits: string, mult: string | undefined, language: Language): NumberMatch {
  const [int, dec = ''] = language === 'en' ? digits.split('.') : digits.split(',');
  const whole = int.replace(language === 'en' ? /,/g : /\./g, '');
  const m = mult ? ((language === 'en' ? MULT_EN : MULT_PT).find(([r]) => r.test(mult))?.[1] ?? 1) : 1;
  return { valor: Number(`${whole}.${dec || '0'}`) * m, casas: dec.length, mult: m };
}

const fmt = (n: number, language: Language) => new Intl.NumberFormat(language, { maximumFractionDigits: Math.abs(n) < 10 ? 2 : 1 }).format(n);
/** Half a unit of the last place written: "12,5%" accepts 12.45 to 12.55; "30%", 29.5 to 30.5. */
const slack = (n: NumberMatch) => (0.5 * 10 ** -n.casas) * n.mult + 1e-9;

export interface Finding { blocoId: string; inicio: number; fim: number; trecho: string; explicacao: string }

const DROP = /^(queda|redução|recuo|baixa|diminuição|caiu|recuou|diminuiu|encolheu|drop|fall|decline|decrease|fell|dropped|declined|decreased|shrank)$/i;
const VAR_PT = 'alta|aumento|crescimento|salto|queda|redução|recuo|baixa|diminuição|subiu|cresceu|aumentou|saltou|caiu|recuou|diminuiu|encolheu';
const VAR_EN = 'rise|increase|growth|jump|drop|fall|decline|decrease|rose|grew|increased|jumped|fell|dropped|declined|decreased|shrank';

function defaults(language: Language) {
  const N = language === 'en' ? N_EN : N_PT;
  const PCT = language === 'en' ? String.raw`\s*(?:%|percent)` : String.raw`\s*(?:%|por\s+cento)`;
  const from = language === 'en' ? String.raw`\bfrom\s+${N}\s+to\s+${N}` : String.raw`\bde\s+${N}\s+(?:para|a)\s+${N}`;
  const kw = `\\b(${language === 'en' ? VAR_EN : VAR_PT})\\s+(?:(?:${language === 'en' ? 'of|by' : 'de'})\\s+)?${N}${PCT}`;
  const part = language === 'en'
    ? String.raw`\b${N}\s+(?:of|out\s+of)(?:\s+the)?\s+${N}\b([^.;%\d]{0,50}?)${N}${PCT}`
    : String.raw`\b${N}\s+(?:de|dos|das)\s+${N}\b([^.;%\d]{0,50}?)${N}${PCT}`;
  const list = String.raw`${N}(?:\s*,\s*${N})*\s+(?:e|and)\s+${N}`;
  const sum = language === 'en'
    ? String.raw`(${list})[^.;\d]{0,60}?\b(?:add\s+up\s+to|adding\s+up\s+to|total(?:ing|ling|s)?|in\s+total|altogether)\s*(?:of\s+)?${N}`
    : String.raw`(${list})[^.;\d]{0,60}?\b(?:somam|somando|soma|totalizam|totalizando|total\s+de|no\s+total|ao\s+todo)\s*(?:de\s+)?${N}`;
  return {
    N: new RegExp(N, 'g'),
    variacao: new RegExp(`${from}[^.;]{0,80}?${kw}`, 'giu'),
    variacaoAntes: new RegExp(`${kw}[^.;]{0,80}?${from}`, 'giu'),
    parte: new RegExp(part, 'giu'),
    soma: new RegExp(sum, 'giu'),
  };
}

/**
 * The paragraph's arithmetic recomputed by code: change ("de 10 para 15, alta de 50%"), part of a whole ("12 dos 40
 * contratos (30%)") and sums ("3, 4 e 5, somando 12"). Arithmetic that does not add up becomes a finding with the right
 * result.
 */
export function accountsBlock(blockId: string, text: string, language: Language = 'pt-BR'): Finding[] {
  const p = defaults(language);
  const tr = (pt: string, en: string) => (language === 'en' ? en : pt);
  const out: Finding[] = [];
  const add = (m: RegExpExecArray | RegExpMatchArray, explanation: string) => {
    const home = m.index ?? 0;
    if (out.some((o) => home < o.fim && home + m[0].length > o.inicio)) return;
    out.push({ blocoId: blockId, inicio: home, fim: home + m[0].length, trecho: m[0], explicacao: explanation });
  };
  const variation = (m: RegExpMatchArray, a: NumberMatch, b: NumberMatch, word: string, z: NumberMatch) => {
    // "de 2020 para 2024, alta de 30%": the pair is years, not the base of the calculation.
    const year = (n: NumberMatch) => n.mult === 1 && n.casas === 0 && n.valor >= 1900 && n.valor <= 2100;
    if (!a.valor || (year(a) && year(b))) return;
    const real = ((b.valor - a.valor) / a.valor) * 100;
    const goesDown = DROP.test(word);
    const meaning = goesDown ? -1 : 1;
    if ((real < 0) !== goesDown && Math.abs(real) > slack(z)) {
      add(m, tr(`De ${fmt(a.valor, language)} para ${fmt(b.valor, language)} é ${real < 0 ? 'queda' : 'alta'} de ${fmt(Math.abs(real), language)}%, não ${word.toLowerCase()}.`,
        `From ${fmt(a.valor, language)} to ${fmt(b.valor, language)} is a ${real < 0 ? 'drop' : 'rise'} of ${fmt(Math.abs(real), language)}%, not a ${word.toLowerCase()}.`));
    } else if (Math.abs(real * meaning - z.valor) > slack(z)) {
      add(m, tr(`De ${fmt(a.valor, language)} para ${fmt(b.valor, language)} é ${real < 0 ? 'queda' : 'alta'} de ${fmt(Math.abs(real), language)}%, não de ${fmt(z.valor, language)}%.`,
        `From ${fmt(a.valor, language)} to ${fmt(b.valor, language)} is a ${real < 0 ? 'drop' : 'rise'} of ${fmt(Math.abs(real), language)}%, not ${fmt(z.valor, language)}%.`));
    }
  };
  const num = (d: string, m?: string) => readNumber(d, m, language);
  // "de 10 para 15 milhões": the second's multiplier applies to the first.
  const pair = (a: NumberMatch, b: NumberMatch): [NumberMatch, NumberMatch] => (a.mult === 1 && b.mult > 1 ? [{ ...a, valor: a.valor * b.mult, mult: b.mult }, b] : [a, b]);
  for (const m of text.matchAll(p.variacao)) variation(m, ...pair(num(m[1], m[2]), num(m[3], m[4])), m[5], num(m[6], m[7]));
  for (const m of text.matchAll(p.variacaoAntes)) variation(m, ...pair(num(m[4], m[5]), num(m[6], m[7])), m[1], num(m[2], m[3]));
  for (const m of text.matchAll(p.parte)) {
    const x = num(m[1], m[2]), y = num(m[3], m[4]), z = num(m[6], m[7]);
    if (!y.valor || x.valor > y.valor) continue;
    const real = (x.valor / y.valor) * 100;
    if (Math.abs(real - z.valor) > slack(z)) {
      add(m, tr(`${fmt(x.valor, language)} de ${fmt(y.valor, language)} é ${fmt(real, language)}%, não ${fmt(z.valor, language)}%.`,
        `${fmt(x.valor, language)} of ${fmt(y.valor, language)} is ${fmt(real, language)}%, not ${fmt(z.valor, language)}%.`));
    }
  }
  for (const m of text.matchAll(p.soma)) {
    let items = [...m[1].matchAll(new RegExp(p.N.source, 'g'))].map((x) => num(x[1], x[2]));
    // "3, 4 e 5 milhões": the last one's multiplier applies to earlier ones that lack one.
    const last = items.at(-1)?.mult ?? 1;
    if (last > 1) items = items.map((n) => (n.mult === 1 ? { ...n, valor: n.valor * last, mult: last } : n));
    const total = num(m[m.length - 2], m[m.length - 1]);
    if (items.length < 2) continue;
    const sum = items.reduce((s, n) => s + n.valor, 0);
    if (Math.abs(sum - total.valor) > slack(total)) {
      add(m, tr(`A soma dá ${fmt(sum, language)}, não ${fmt(total.valor, language)}.`, `The sum is ${fmt(sum, language)}, not ${fmt(total.valor, language)}.`));
    }
  }
  return out.sort((a, b) => a.inicio - b.inicio);
}

// ── aspas ───────────────────────────────────────────────────────────────────────────────────────────────────────

const spaces = (s: string) => s.replace(/\s+/g, ' ').trim();

export interface Quote { blocoId: string; inicio: number; fim: number; trecho: string; citacao: string; evidenciaId: string | null }

const VERB_SAY = '(?:disse|diz|dizia|afirmou|afirma|respondeu|responde|declarou|declara|concluiu|conclui|resumiu|resume|negou|nega|admitiu|admite|confirmou|confirma|escreveu|escreve|said|says|replied|answered|concluded|wrote|denied|admitted|confirmed)';
/** Before a one-word quote, what makes it speech: a colon or a verb of saying ("respondeu “Sim”"). */
const BEFORE_SPEECH = new RegExp(`(?::|\\b${VERB_SAY})\\s*,?\\s*$`, 'iu');
/** After it: a comma or dash and a verb of saying ("“Sim”, respondeu Aurora"). */
const AFTER_SPEECH = new RegExp(`^\\s*[,—–-]\\s*${VERB_SAY}\\b`, 'iu');

/**
 * Each quotation in the paragraph and the dossier evidence it is literally in (spaces collapsed; final punctuation inside
 * the quotes does not count). Without evidence: "quote not checked". There is no length cap. A single word in quotes is
 * emphasis ("chamou o caso de "laranja"") and is left out, unless it is speech: with punctuation inside the quotes
 * (“Superfaturamento.”), after a colon or a verb of saying, or before a comma and a verb of saying (“Sim”, respondeu).
 */
export function quotesBlock(blockId: string, text: string, evidence: { id: string; texto: string }[]): Quote[] {
  const normal = evidence.map((e) => ({ id: e.id, texto: spaces(e.texto) }));
  const out: Quote[] = [];
  for (const m of text.matchAll(/[“"«]([^”"»“]+)[”"»]/g)) {
    const citation = spaces(m[1]).replace(/[.,;:!?…]+$/, '');
    const words = citation.split(' ').filter((p) => /[\p{L}\p{N}]/u.test(p)).length;
    if (!words) continue;
    const end = m.index! + m[0].length;
    if (words < 2 && !/[.!?…]\s*$/.test(m[1]) && !BEFORE_SPEECH.test(text.slice(Math.max(0, m.index! - 40), m.index!)) && !AFTER_SPEECH.test(text.slice(end, end + 40))) continue;
    const ev = normal.find((e) => e.texto.includes(citation));
    out.push({ blocoId: blockId, inicio: m.index!, fim: m.index! + m[0].length, trecho: m[0], citacao: citation, evidenciaId: ev?.id ?? null });
  }
  return out;
}

// ── people and institutions ─────────────────────────────────────────────────────────────────────────────────────

const PARTICLES = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'del', 'van', 'von', 'of', 'the']);
const INSTITUTION = /^(Ministério|Câmara|Prefeitura|Secretaria|Tribunal|Polícia|Assembleia|Assembléia|Governo|Partido|Universidade|Instituto|Banco|Supremo|Senado|Congresso|Conselho|Fundação|Associação|Sindicato|Igreja|Empresa|Companhia|Agência|Comissão|Defensoria|Procuradoria|Receita|Controladoria|Justiça|Exército|Marinha|Força|Movimento|Federação|Confederação|Hospital|Escola|Colégio|Departamento|Ministry|Department|Court|Police|Council|University|Institute|Agency|Committee|Senate|Congress|Party|Church|Bank|Company)$/;
const NOT_NAME = new Set([
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
const NAME = /\p{Lu}[\p{Ll}'’-]+(?:\s+(?:(?:da|de|do|das|dos|e|di|del|van|von)\s+)?\p{Lu}[\p{Ll}'’-]+)+|\b\p{Lu}{2,6}\b/gu;

/** Spelling key: no accents, no particles, doubled consonants and common swaps (z/s, y/i, ph/f) merged. */
export function nameKey(personName: string): string {
  return personName.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/\s+/).filter((p) => !PARTICLES.has(p)).join(' ')
    .replace(/ph/g, 'f').replace(/th/g, 't').replace(/y/g, 'i').replace(/w/g, 'v').replace(/z/g, 's').replace(/(\p{L})\1/gu, '$1');
}

export interface Mention { blocoId: string; inicio: number; fim: number }
export interface Name { nome: string; tipo: 'pessoa' | 'instituicao'; mencoes: Mention[] }

/** The text's proper names (two or more capitalised words; or an acronym), without a sentence-initial word. */
export function fromTextNames(blocks: { id: string; texto: string }[]): Name[] {
  const byName = new Map<string, Name>();
  for (const b of blocks) {
    for (const m of b.texto.matchAll(NAME)) {
      let name = m[0];
      let home = m.index!;
      // Drops sentence-initial words ("Segundo Maria Souza" → "Maria Souza").
      for (;;) {
        const first = name.split(/\s+/)[0];
        if (!NOT_NAME.has(first) || first === name) break;
        const rest = name.slice(first.length).replace(/^\s+/, '');
        home += name.length - rest.length;
        name = rest.replace(/^(?:da|de|do|das|dos|e)\s+/, (x) => { home += x.length; return ''; });
      }
      const words = name.split(/\s+/);
      const acronym = /^\p{Lu}{2,6}$/u.test(name);
      if (!acronym && words.filter((p) => !PARTICLES.has(p)).length < 2) continue;
      if (NOT_NAME.has(name)) continue;
      const type = acronym || INSTITUTION.test(words[0]) ? 'instituicao' : 'pessoa';
      const n = byName.get(name) ?? { nome: name, tipo: type, mencoes: [] };
      n.mencoes.push({ blocoId: b.id, inicio: home, fim: home + name.length });
      byName.set(name, n);
    }
  }
  return [...byName.values()];
}

/** Different spellings of the same name in the text ("Luís Souza" and "Luis Sousa"): it only points them out, the person decides. */
export function spellingsDifferent(names: Name[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const n of names) if (n.tipo === 'pessoa') { const k = nameKey(n.nome); groups.set(k, [...(groups.get(k) ?? []), n.nome]); }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** The name appears in the passage (or the passage mentions someone with the same spelling key). */
export function citesName(passage: string, personName: string): boolean {
  return passage.includes(personName) || nameKey(passage).includes(nameKey(personName));
}

// ── style guide ─────────────────────────────────────────────────────────────────────────────────────────────────

export const RULE_TYPES = ['sigla', 'grafia', 'numero', 'cargo', 'linguagem'] as const;
export type RuleType = (typeof RULE_TYPES)[number];
export interface Rule { id: string; tipo: RuleType; procurar: string; preferir: string | null; nota: string | null }
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where the paragraph uses the form the style guide asks to avoid (whole word; acronyms respect case). It only points it out. */
export function manualInBlock(blockId: string, text: string, rules: Rule[], language: Language = 'pt-BR'): (Finding & { regraId: string; tipo: RuleType })[] {
  const out: (Finding & { regraId: string; tipo: RuleType })[] = [];
  for (const r of rules) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escRe(r.procurar)}(?![\\p{L}\\p{N}])`, r.tipo === 'sigla' ? 'gu' : 'giu');
    for (const m of text.matchAll(re)) {
      if (r.preferir && m[0] === r.preferir) continue;
      const home = m.index!;
      if (out.some((o) => home < o.fim && home + m[0].length > o.inicio)) continue;
      const asks = r.preferir ? (language === 'en' ? `The style guide asks for “${r.preferir}”.` : `O manual pede “${r.preferir}”.`) : (language === 'en' ? 'The style guide asks to avoid this.' : 'O manual pede para evitar.');
      out.push({ blocoId: blockId, inicio: home, fim: home + m[0].length, trecho: m[0], explicacao: r.nota ? `${asks} ${r.nota}` : asks, regraId: r.id, tipo: r.tipo });
    }
  }
  return out.sort((a, b) => a.inicio - b.inicio);
}

// ── fontes ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const SOURCE_TYPES = ['oficial', 'primaria', 'materia', 'anonima'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export type Strength = 'forte' | 'media' | 'fraca' | 'sem_tipo';

/** A public body's address → "oficial" (a suggestion; the person confirms). Never by the outlet's political line. */
export function suggestedType(url: string): SourceType | null {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (/(^|\.)(gov|jus|leg|mp|def|mil)\.br$/.test(host) || /\.gov$/.test(host) || /(^|\.)gov\.[a-z]{2}$/.test(host) || host.includes('diariooficial')) return 'oficial';
  return null;
}

/** Strength by source type: official document and primary source, strong; another story, medium; anonymous, weak. */
export const strengthOf = (type: SourceType | null): Strength => (type === 'oficial' || type === 'primaria' ? 'forte' : type === 'materia' ? 'media' : type === 'anonima' ? 'fraca' : 'sem_tipo');

const coreUrl = (u: string) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`; } catch { return ''; } };
const SEQ = 25;  // identical consecutive words: one repeats the other

/**
 * Sources that are not independent: one cites the other's address, or both have a passage of 25 identical consecutive
 * words (one copied the other, or both came from the same place). Counting them as two sources misleads.
 */
export function circularSources(evs: { id: string; url: string; texto: string }[]): { de: string; para: string; motivo: 'cita' | 'repete' }[] {
  const out: { de: string; para: string; motivo: 'cita' | 'repete' }[] = [];
  const seqs = evs.map((e) => {
    const ps = e.texto.slice(0, 30_000).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const s = new Set<string>();
    for (let i = 0; i + SEQ <= ps.length; i++) s.add(ps.slice(i, i + SEQ).join(' '));
    return s;
  });
  for (let i = 0; i < evs.length; i++) {
    for (let j = 0; j < evs.length; j++) {
      const target = coreUrl(evs[j].url);
      if (i !== j && target.length >= 12 && evs[i].texto.includes(target)) out.push({ de: evs[i].id, para: evs[j].id, motivo: 'cita' });
    }
  }
  const on = (a: string, b: string) => out.some((o) => (o.de === a && o.para === b) || (o.de === b && o.para === a));
  for (let i = 0; i < evs.length; i++) {
    for (let j = i + 1; j < evs.length; j++) {
      if (on(evs[i].id, evs[j].id)) continue;
      const [a, b] = seqs[i].size < seqs[j].size ? [seqs[i], seqs[j]] : [seqs[j], seqs[i]];
      for (const s of a) if (b.has(s)) { out.push({ de: evs[j].id, para: evs[i].id, motivo: 'repete' }); break; }
    }
  }
  return out;
}

// ── temas ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** An accusation in the paragraph: gets a second opinion (the same list for anyone mentioned). */
export const ACCUSATION = /\b(acus\w*|denunci\w*|desvi\w*|fraud\w*|corrup\w*|propin\w*|crimes?\b|criminos\w*|investigad\w*|indiciad\w*|r[ée]us?\b|condenad\w*|pres[oa]s?\b|lavagem|superfaturad\w*|il[íi]cit\w*|irregularidade\w*|ass[ée]dio\w*|estupr\w*|agred\w*|assassin\w*|accus\w*|fraud\w*|brib\w*|embezzl\w*|indict\w*|convict\w*|launder\w*)/i;

/** Topics Chinese models soften: the whole text is checked by another provider. */
/** A paragraph that records the other side (contacted, replied, in a statement, denied…): if it changed or left, the accusations are re-checked. */
export const OTHER_SIDE = /\b(procurad[oa]s?|n[ãa]o respond\w*|n[ãa]o retorn\w*|em nota|por meio de nota|nota oficial|assessoria|n[ãa]o se manifest\w*|n[ãa]o quis comentar|negou|negam?|desconhec\w*|(?:disse|afirmou|declarou|respondeu|informou) (?:à|ao) (?:reportagem|jornal|site|blog)|rebateu|contestou|a defesa d\w*|advogad[oa]s? d\w*|contacted|did not respond|declined to comment|statement|denied|denies|told (?:the|this) \w+)\b/i;
export const TOPIC_SENSITIVE = /\b(taiwan\w*|xinjiang|uigur\w*|uyghur\w*|tiananmen|tian'anmen|hong kong|tibet\w*|dalai lama|falun gong|partido comunista chin\w*|chinese communist party|governo chin\w*|chinese government|xi jinping|pequim|beijing)\b/i;

/** Topics for the audit (the axes of the symmetry battery): to see whether the marks weigh more on one side. */
export const TOPICS: { id: string; pt: string; en: string; re: RegExp }[] = [
  { id: 'politica', pt: 'Política partidária', en: 'Party politics', re: /\b(PT|PL|PSDB|MDB|PSOL|PSB|PDT|União Brasil|Republicanos|partido\w*|governo|oposição|prefeit\w*|vereador\w*|deputad\w*|senador\w*|governador\w*|president\w*|party|government|opposition|mayor|senator)\b/i },
  { id: 'religiao', pt: 'Religião', en: 'Religion', re: /\b(igreja\w*|evang[ée]lic\w*|cat[óo]lic\w*|terreiro\w*|candombl\w*|umband\w*|pastor\w*|padre\w*|templo\w*|mesquita\w*|sinagoga\w*|church\w*|evangelical\w*|catholic\w*|mosque\w*|synagogue\w*)\b/i },
  { id: 'genero', pt: 'Gênero', en: 'Gender', re: /\b(mulher\w*|vereadora\w*|deputada\w*|prefeita\w*|feminin\w*|trans\b|LGBT\w*|woman|women|female)\b/i },
  { id: 'raca', pt: 'Raça', en: 'Race', re: /\b(negr[oa]s?|pret[oa]s?|brancos?|brancas?|ind[íi]gena\w*|quilombo\w*|racis\w*|black|white|indigenous)\b/i },
  { id: 'seguranca', pt: 'Polícia e movimentos sociais', en: 'Police and social movements', re: /\b(PM|pol[íi]cia\w*|policia\w*|MTST|movimento\w*|ocupa[çc][ãa]o|ocupa[çc][õo]es|protesto\w*|police|protest\w*|movement\w*)\b/i },
  { id: 'campo', pt: 'Campo', en: 'Countryside', re: /\b(MST|agroneg[óo]cio\w*|fazend\w*|ruralist\w*|reforma agr[áa]ria|latif[úu]ndi\w*|agribusiness|farm\w*)\b/i },
];
export const topicsOf = (text: string) => TOPICS.filter((t) => t.re.test(text)).map((t) => t.id);

// ── card decisions ──────────────────────────────────────────────────────────────────────────────────────────────

export const DECISION_TYPES = ['fonte', 'outro_lado', 'opiniao', 'ignorar'] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];
export const MEANS_OTHER_SIDE = ['email', 'telefone', 'mensagem', 'pessoalmente', 'oficio', 'outro'] as const;
/** Risks that "I contacted the other side" resolves (a victim or minor named in the text is not resolved by contacting someone). */
export const RISKS_OTHER_SIDE = ['acusacao_sem_condenacao', 'sem_outro_lado'];

/**
 * Is the mark still open? Without a decision: unsourced, risk and what the two opinions disagreed on. With a decision:
 * an attached source, opinion and ignore close it; other side closes the accusation and other-side risks.
 */
export function openBrand(a: { estado: string; risco: string | null; incerto?: number | boolean }, d?: { tipo: string } | null): boolean {
  if (d) return d.tipo === 'outro_lado' ? !(a.estado === 'risco' && RISKS_OTHER_SIDE.includes(a.risco ?? '')) : false;
  return a.estado !== 'com_evidencia' || !!a.incerto;
}

// ── attribution ─────────────────────────────────────────────────────────────────────────────────────────────────

// "segundo" is only attribution outside "o segundo turno", "em segundo lugar"; "conforme" does not count in "conforme previsto".
const ATTRIBUTION = /(?<![\p{L}\p{N}])(?:(?<!(?<![\p{L}\p{N}])(?:o|no|do|ao|pelo|um|em|seu|sua|este|esse)\s)segundo\s+(?!lugar|turno|semestre|trimestre|tempo|plano)[\p{L}\p{N}]|de acordo com|conforme\s+(?!previsto|esperado|combinado)[\p{L}\p{N}]|(?:disseram|disse|dizem|diz|afirmaram|afirmou|afirmam|afirma|declararam|declarou|declara|informaram|informou|informa|relataram|relatou|revelaram|revelou|apontaram|apontou|aponta|explicou|according to|said|says|stated|states that|claimed|claims that|reported|told|announced|testified|wrote)(?![\p{L}\p{N}]))/iu;

/** The sentence already says who spoke ("segundo o Diário Oficial", "according to the report", "disse o prefeito").
 *  That is not a source: it is the clue that the link is missing. */
export const attributionInPassage = (passage: string) => ATTRIBUTION.test(passage);
