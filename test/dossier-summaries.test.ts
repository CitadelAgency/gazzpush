// The closed row of each Dossier part must state the deadline and the alert (DESIGN.md §9): without that, they stay hidden.
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { Object.assign(globalThis, { location: { origin: 'http://localhost', pathname: '/', search: '' } }); });  // the web reads `location` on load

import { summaryDocuments } from '../web/src/story/Documents';
import { summaryPackage } from '../web/src/story/Shield';
import { summaryLai } from '../web/src/story/Living';

type State = Parameters<typeof summaryLai>[0];
const lai = (request: Record<string, unknown>) => ({ lai: { pedidos: [{ estado: 'protocolado', prazoRecursoPassou: false, podeRecorrer: false, recorrerAte: null, respostaEm: null, diasRestantes: null, proximaInstanciaFora: false, regraLocal: false, ...request }], candidatas: [] } }) as unknown as State;

describe('summaryLai', () => {
  it("denial on appeal warns of the next instance's deadline", () => {
    expect(summaryLai(lai({ proximaInstanciaFora: true }))).toMatchObject({ tom: 'aviso', texto: expect.stringContaining('10 dias da ciência') });
  });

  it('local rule: warns that the next instance is outside the app', () => {
    expect(summaryLai(lai({ proximaInstanciaFora: true, regraLocal: true }))).toMatchObject({ tom: 'aviso', texto: expect.stringContaining('fora do app') });
  });

  it('the plural of the deadline follows the number', () => {
    expect(summaryLai(lai({ diasRestantes: 1 })).texto).toContain('falta 1 dia para o prazo');
    expect(summaryLai(lai({ diasRestantes: 3 })).texto).toContain('faltam 3 dias para o prazo');
    expect(summaryLai(lai({ diasRestantes: 0 })).texto).toContain('o prazo vence hoje');
  });
});

describe('summaryDocuments', () => {
  const doc = (state: string) => ({ estado: state });
  it('the plural of "sendo lido" follows the number', () => {
    const e = (n: number) => ({ documentos: Array.from({ length: n }, () => doc('lendo')) }) as unknown as Parameters<typeof summaryDocuments>[0];
    expect(summaryDocuments(e(1), null).texto).toContain('1 sendo lido ');
    expect(summaryDocuments(e(2), null).texto).toContain('2 sendo lidos');
  });
});

describe('summaryPackage', () => {
  it("complete doesn't change the line; incomplete says what's missing", () => {
    expect(summaryPackage({ carimbo: '2026-11-06', fora: 0 })).toBeNull();
    expect(summaryPackage({ carimbo: null, fora: 2 })).toEqual({ tom: 'aviso', texto: 'baixado sem carimbo de tempo · 2 arquivos fora' });
    expect(summaryPackage({ carimbo: '2026-11-06', fora: 1 })).toEqual({ tom: 'aviso', texto: '1 arquivo fora' });
  });
});
