// The blue-pencil reviewer: the question table and its priority, one note per paragraph, the note's cycle, the
// attribution in the sentence and the speech search. All by code: no test calls a model.
import { describe, expect, it } from 'vitest';
import { attributionInPassage } from '../src/lib/reporting';
import { findSpeech, openQuote, notesText, reconcileNotes, type ReviewerBrand, type Note, type NoteLive, type OptionsCycle } from '../src/lib/reviewer';

const brand = (state: string, passage = 'Uma frase qualquer.', extra: Partial<ReviewerBrand> = {}): ReviewerBrand => ({ id: `m-${state}-${passage.length}`, blocoId: 'b1', trecho: passage, estado: state, aberta: true, ...extra });
const risk = (r: string) => brand('risco', 'Uma frase qualquer.', { risco: r });
const question = (m: ReviewerBrand) => notesText([m])[0];

describe('question table', () => {
  const cases: [string, ReviewerBrand, string, string][] = [
    ['sem fonte', brand('sem_fonte', 'A obra atrasou.'), 'Quem disse isso?', 'Who said this?'],
    ['sem fonte com número', brand('sem_fonte', 'A obra custou R$ 40 milhões.'), 'Quem disse esse número?', 'Who gave this number?'],
    ['sem fonte atribuída', brand('sem_fonte', 'A obra custou R$ 40 milhões, segundo o Diário Oficial.'), 'Tem o link? Cole no Dossiê.', 'Got the link? Paste it in the Dossier.'],
    ['outro lado', risk('sem_outro_lado'), 'Você procurou o outro lado?', 'Did you reach the other side?'],
    ['acusação', risk('acusacao_sem_condenacao'), 'Há condenação ou fonte oficial?', 'Is there a conviction or official source?'],
    ['vítima ou menor', risk('vitima_ou_menor'), 'Precisa do nome aqui?', 'Does the name need to be here?'],
    ['conta', brand('conta'), 'Essa conta fecha?', 'Does this math add up?'],
    ['aspa', brand('aspa'), 'Essa fala está em alguma fonte?', 'Is this quote in any source?'],
    ['manual', brand('manual'), 'O manual pede outra forma aqui.', 'The style guide asks for another form.'],
  ];
  it.each(cases)('%s', (_n, m, pt, en) => {
    expect(question(m)).toMatchObject({ pt, en, blocoId: 'b1', marcaId: m.id });
  });

  it('number in the excerpt, in English too', () => {
    expect(question(brand('sem_fonte', 'The project cost $40 million.')).en).toBe('Who gave this number?');
    expect(question(brand('sem_fonte', 'The project cost $40 million, according to the report.')).en).toBe('Got the link? Paste it in the Dossier.');
  });

  it("only an open mark asks a question; with evidence, recording and resolved, it does not", () => {
    for (const e of ['com_evidencia', 'gravacao', 'resolvida']) expect(notesText([brand(e)])).toEqual([]);
    expect(notesText([brand('sem_fonte', 'A obra atrasou.', { aberta: false })])).toEqual([]);
    expect(notesText([brand('com_evidencia', 'A obra atrasou.', { aberta: true })])).toEqual([]);
    expect(notesText([brand('risco', 'A obra atrasou.', { risco: 'outro' })])).toEqual([]);
  });
});

describe('priority and one note per paragraph', () => {
  const order = [risk('vitima_ou_menor'), risk('acusacao_sem_condenacao'), risk('sem_outro_lado'), brand('conta'), brand('aspa'), brand('sem_fonte', 'A obra atrasou.'), brand('manual')];

  it('the most serious wins, whatever the order in the text', () => {
    for (let i = 0; i < order.length; i++) {
      const notes = notesText([...order.slice(i)].reverse());
      expect(notes).toHaveLength(1);
      expect(notes[0].pt).toBe(question(order[i]).pt);
    }
  });

  it("on a tie, the paragraph's first mark", () => {
    const a = brand('sem_fonte', 'Primeira frase.', { id: 'a' }), b = brand('sem_fonte', 'Segunda frase tem 12.', { id: 'b' });
    expect(notesText([a, b]).map((n) => n.marcaId)).toEqual(['a']);
  });

  it('each paragraph has its own', () => {
    const notes = notesText([brand('conta'), brand('aspa', 'Outra.', { blocoId: 'b2' }), brand('manual', 'Mais.', { blocoId: 'b2' })]);
    expect(notes.map((n) => [n.blocoId, n.chave])).toEqual([['b1', 'conta'], ['b2', 'aspa']]);
  });
});

describe('attributionInPassage', () => {
  it.each([
    'Segundo o Diário Oficial, foram 12 contratos.', 'Foram 12 contratos, segundo a prefeitura.', 'De acordo com a Câmara, foram 12.', 'Conforme o relatório, foram 12.',
    'O prefeito disse que foram 12.', 'A secretaria afirmou que foram 12.', 'Foram 12, informou a Câmara.', 'O relatório aponta 12 contratos.',
    'There were 12 contracts, according to the council.', 'The mayor said there were 12.', 'The agency reported 12 contracts.', 'She told the council there were 12.',
  ])('attributed: %s', (f) => expect(attributionInPassage(f)).toBe(true));

  it.each([
    'A Câmara renovou 12 contratos.', 'O segundo turno teve 12 candidatos.', 'Ficou em segundo lugar.', 'No segundo semestre, foram 12.', 'A obra terminou conforme previsto.',
    'Disseminou 12 boatos.', 'The council renewed 12 contracts.', 'The saidou market opened.', 'Reporters arrived.',
  ])('without attribution: %s', (f) => expect(attributionInPassage(f)).toBe(false));
});

describe("the note's cycle", () => {
  const n = (key: Note['chave'], blockId = 'b1'): Note => ({ blocoId: blockId, marcaId: `m-${key}`, chave: key, pt: key, en: key });
  const live = (key: Note['chave'], phase: NoteLive['fase'] = 'pronta', blockId = 'b1'): NoteLive => ({ ...n(key, blockId), fase: phase });
  const op = (o: Partial<OptionsCycle> = {}): OptionsCycle => ({ existem: new Set(['b1', 'b2']), espera: new Set(), cursor: null, sessao: true, animar: true, ...o });
  const phases = (l: NoteLive[]) => l.map((v) => `${v.chave}:${v.fase}`);

  it('on opening the text, everything ready, no animation', () => {
    expect(phases(reconcileNotes([], [n('conta')], op({ sessao: false, animar: false, cursor: 'b1' })))).toEqual(['conta:pronta']);
  });
  it("a new note appears, except in the cursor's paragraph", () => {
    expect(phases(reconcileNotes([], [n('conta')], op()))).toEqual(['conta:nasce']);
    expect(reconcileNotes([], [n('conta')], op({ cursor: 'b1' }))).toEqual([]);
    expect(phases(reconcileNotes([], [n('conta')], op({ cursor: 'b2' })))).toEqual(['conta:nasce']);
  });
  it('while the paragraph is rechecked, the note stays, even without a mark', () => {
    expect(phases(reconcileNotes([live('sem_fonte_numero')], [], op({ espera: new Set(['b1']) })))).toEqual(['sem_fonte_numero:pronta']);
  });
  it("a check that fails keeps the note and doesn't create another", () => {
    expect(reconcileNotes([], [n('conta')], op({ espera: new Set(['b1']) }))).toEqual([]);
  });
  it('same question stays, with the new mark', () => {
    const r = reconcileNotes([{ ...live('sem_fonte'), marcaId: 'velha' }], [{ ...n('sem_fonte'), marcaId: 'nova' }], op());
    expect(r).toEqual([{ ...n('sem_fonte'), marcaId: 'nova', fase: 'pronta' }]);
  });
  it('different question: the old one is struck out and the new one is drawn', () => {
    expect(phases(reconcileNotes([live('sem_fonte_numero')], [n('sem_fonte_atribuida')], op()))).toEqual(['sem_fonte_numero:risca', 'sem_fonte_atribuida:nasce']);
  });
  it('with the cursor in the paragraph, the old one is struck out and the new one waits for it to leave', () => {
    const struck = reconcileNotes([live('sem_fonte_numero')], [n('sem_fonte_atribuida')], op({ cursor: 'b1' }));
    expect(phases(struck)).toEqual(['sem_fonte_numero:risca']);
    expect(phases(reconcileNotes(struck, [n('sem_fonte_atribuida')], op()))).toEqual(['sem_fonte_numero:risca', 'sem_fonte_atribuida:nasce']);
  });
  it('without a question, the note is struck out and leaves', () => {
    expect(phases(reconcileNotes([live('conta')], [], op()))).toEqual(['conta:risca']);
  });
  it('without movement, nothing is struck out: swapped directly', () => {
    expect(phases(reconcileNotes([live('conta')], [], op({ animar: false })))).toEqual([]);
    expect(phases(reconcileNotes([live('conta')], [n('aspa')], op({ animar: false })))).toEqual(['aspa:pronta']);
    expect(phases(reconcileNotes([live('conta', 'risca')], [], op({ animar: false })))).toEqual([]);
  });
  it('a deleted paragraph takes its note with it, without strike-through', () => {
    expect(reconcileNotes([live('conta', 'pronta', 'b9')], [], op())).toEqual([]);
  });
  it("the struck-out one doesn't repeat on each change", () => {
    const r = reconcileNotes([live('conta')], [], op());
    expect(phases(reconcileNotes(r, [], op()))).toEqual(['conta:risca']);
  });
});

describe('openQuote', () => {
  it('finds the open quote and what came after', () => {
    expect(openQuote('Ele disse: “Olha, eu nunca')).toEqual({ inicio: 11, digitado: 'Olha, eu nunca', fecha: '”' });
    expect(openQuote('Ele disse: "Olha, eu')?.fecha).toBe('"');
    expect(openQuote('Ele disse: «Olha')?.fecha).toBe('»');
  });
  it("a closed quote doesn't count; the next open one does", () => {
    expect(openQuote('Ele disse: “Olha” e saiu')).toBeNull();
    expect(openQuote('Ele disse: "Olha" e saiu')).toBeNull();
    expect(openQuote('“Um” e “dois')?.digitado).toBe('dois');
    expect(openQuote('Sem aspa nenhuma')).toBeNull();
  });
});

describe('findSpeech', () => {
  const pt = { gravacao: 'g1', nome: 'entrevista.wav', inicio: 72.4, texto: 'Olha, eu nunca recebi um centavo das empresas de ônibus. Isso é mentira.' };
  const en = { gravacao: 'g2', nome: 'interview.wav', inicio: 12, texto: 'Look, I never took a single cent from the bus companies.' };

  it('finds without accents or case, and returns the rest literally', () => {
    expect(findSpeech('olha EU nunca', [pt])).toEqual({ trecho: pt, resto: ' recebi um centavo das empresas de ônibus. Isso é mentira.' });
    expect(findSpeech('das empresas de onibus', [pt])?.resto).toBe('. Isso é mentira.');
    expect(findSpeech('i never took', [en])?.resto).toBe(' a single cent from the bus companies.');
  });
  it('accepts the last word half-typed, and the rest starts in the middle of it', () => {
    expect(findSpeech('Olha, eu nun', [pt])?.resto).toBe('ca recebi um centavo das empresas de ônibus. Isso é mentira.');
    expect(findSpeech('empresas de oni', [pt])?.resto).toBe('bus. Isso é mentira.');
    expect(findSpeech('I never to', [en])?.resto).toBe('ok a single cent from the bus companies.');
  });
  it("a word already finished doesn't count as half", () => {
    expect(findSpeech('Olha, eu nun ', [pt])).toBeNull();
    expect(findSpeech('Olha, eu nunca ', [pt])?.resto).toBe('recebi um centavo das empresas de ônibus. Isso é mentira.');
  });
  it("punctuation the person already typed isn't repeated", () => {
    expect(findSpeech('empresas de ônibus.', [pt])?.resto).toBe('Isso é mentira.');
  });
  it('fewer than 3 words: nothing', () => {
    expect(findSpeech('Olha, eu', [pt])).toBeNull();
    expect(findSpeech('I never', [en])).toBeNull();
    expect(findSpeech('', [pt])).toBeNull();
  });
  it('no match: nothing', () => {
    expect(findSpeech('Olha, eu sempre', [pt])).toBeNull();
    expect(findSpeech('nobody said this', [en])).toBeNull();
    expect(findSpeech('Olha, eu nunca', [])).toBeNull();
  });
  it('speech already complete: nothing to offer', () => {
    expect(findSpeech('Isso é mentira', [pt])).toBeNull();
    expect(findSpeech('Isso é mentira.', [pt])).toBeNull();
  });
  it('the first recording that has the sequence', () => {
    expect(findSpeech('from the bus', [pt, en])?.trecho.gravacao).toBe('g2');
  });
});
