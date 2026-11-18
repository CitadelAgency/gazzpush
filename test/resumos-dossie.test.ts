// A linha fechada de cada parte do Dossiê precisa dizer o prazo e o alerta (DESIGN.md §9): sem isso, eles ficam escondidos.
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { Object.assign(globalThis, { location: { origin: 'http://localhost', pathname: '/', search: '' } }); });  // a web lê `location` ao carregar

import { resumoDocumentos } from '../web/src/materia/Documentos';
import { resumoPacote } from '../web/src/materia/Escudo';
import { resumoLai } from '../web/src/materia/Viva';

type Estado = Parameters<typeof resumoLai>[0];
const lai = (pedido: Record<string, unknown>) => ({ lai: { pedidos: [{ estado: 'protocolado', prazoRecursoPassou: false, podeRecorrer: false, recorrerAte: null, respostaEm: null, diasRestantes: null, proximaInstanciaFora: false, regraLocal: false, ...pedido }], candidatas: [] } }) as unknown as Estado;

describe('resumoLai', () => {
  it('negativa no recurso avisa o prazo da próxima instância', () => {
    expect(resumoLai(lai({ proximaInstanciaFora: true }))).toMatchObject({ tom: 'aviso', texto: expect.stringContaining('10 dias da ciência') });
  });

  it('regra local: avisa que a próxima instância é fora do app', () => {
    expect(resumoLai(lai({ proximaInstanciaFora: true, regraLocal: true }))).toMatchObject({ tom: 'aviso', texto: expect.stringContaining('fora do app') });
  });

  it('o plural do prazo acompanha o número', () => {
    expect(resumoLai(lai({ diasRestantes: 1 })).texto).toContain('falta 1 dia para o prazo');
    expect(resumoLai(lai({ diasRestantes: 3 })).texto).toContain('faltam 3 dias para o prazo');
    expect(resumoLai(lai({ diasRestantes: 0 })).texto).toContain('o prazo vence hoje');
  });
});

describe('resumoDocumentos', () => {
  const doc = (estado: string) => ({ estado });
  it('o plural de "sendo lido" acompanha o número', () => {
    const e = (n: number) => ({ documentos: Array.from({ length: n }, () => doc('lendo')) }) as unknown as Parameters<typeof resumoDocumentos>[0];
    expect(resumoDocumentos(e(1), null).texto).toContain('1 sendo lido ');
    expect(resumoDocumentos(e(2), null).texto).toContain('2 sendo lidos');
  });
});

describe('resumoPacote', () => {
  it('completo não muda a linha; incompleto diz o que faltou', () => {
    expect(resumoPacote({ carimbo: '2026-11-06', fora: 0 })).toBeNull();
    expect(resumoPacote({ carimbo: null, fora: 2 })).toEqual({ tom: 'aviso', texto: 'baixado sem carimbo de tempo · 2 arquivos fora' });
    expect(resumoPacote({ carimbo: '2026-11-06', fora: 1 })).toEqual({ tom: 'aviso', texto: '1 arquivo fora' });
  });
});
