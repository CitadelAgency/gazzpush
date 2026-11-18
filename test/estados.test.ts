import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { STATUS_PAUTA, STATUS_PECA, TransicaoInvalida, podeTransitar, transitar } from '../src/kernel/estados';
import { eventosDe, seedPauta, seedPeca, seedTenant, statusDe } from './helpers';

describe('tabela de transições', () => {
  it('peça segue o caminho rascunho → revisao → aprovada → publicada', () => {
    expect(podeTransitar('peca', 'rascunho', 'revisao')).toBe(true);
    expect(podeTransitar('peca', 'revisao', 'aprovada')).toBe(true);
    expect(podeTransitar('peca', 'revisao', 'rascunho')).toBe(true);   // reescrever
    expect(podeTransitar('peca', 'aprovada', 'publicada')).toBe(true);
  });

  it('rejeita atalhos e saída de estado terminal', () => {
    expect(podeTransitar('peca', 'rascunho', 'publicada')).toBe(false);
    expect(podeTransitar('peca', 'rascunho', 'aprovada')).toBe(false);
    expect(podeTransitar('peca', 'revisao', 'publicada')).toBe(false);
    for (const terminal of ['publicada', 'falhou', 'rejeitada'] as const) {
      for (const para of STATUS_PECA) expect(podeTransitar('peca', terminal, para)).toBe(false);
    }
    for (const para of STATUS_PAUTA) expect(podeTransitar('pauta', 'concluida', para)).toBe(false);
    expect(podeTransitar('pauta', 'em_producao', 'sugerida')).toBe(false);
  });
});

describe('transitar', () => {
  it('muda o status e grava o evento com quem decidiu, no mesmo batch', async () => {
    const t = await seedTenant();
    const { pautaId } = await seedPauta(t);
    const r = await transitar(env, { tipo: 'pauta', id: pautaId, tenantId: t, para: 'em_producao', por: 'user-1', dados: { x: 1 } });
    expect(r.mudou).toBe(true);
    expect(await statusDe('pautas', pautaId)).toBe('em_producao');
    expect(await eventosDe(pautaId)).toEqual([{ tipo: 'pauta.em_producao', chave: null, payload: { de: 'sugerida', para: 'em_producao', por: 'user-1', x: 1 } }]);
  });

  it('transição inválida lança e não escreve nada', async () => {
    const t = await seedTenant();
    const { pautaId } = await seedPauta(t, 'em_producao');
    const peca = await seedPeca(t, pautaId, { status: 'rascunho' });
    await expect(transitar(env, { tipo: 'peca', id: peca, tenantId: t, para: 'publicada', por: 'u' })).rejects.toBeInstanceOf(TransicaoInvalida);
    expect(await statusDe('pecas', peca)).toBe('rascunho');
    expect(await eventosDe(peca)).toEqual([]);
  });

  it('já no destino = no-op: nem evento nem batch (replay de step depois do commit)', async () => {
    const t = await seedTenant();
    const { pautaId } = await seedPauta(t, 'em_producao');
    const peca = await seedPeca(t, pautaId, { status: 'revisao' });
    const extra = env.DB.prepare("UPDATE pecas SET erro = 'não devia rodar' WHERE id = ?").bind(peca);
    const r = await transitar(env, { tipo: 'peca', id: peca, tenantId: t, para: 'revisao', por: 'sistema', batch: [extra] });
    expect(r.mudou).toBe(false);
    expect(await eventosDe(peca)).toEqual([]);
    expect((await env.DB.prepare('SELECT erro FROM pecas WHERE id = ?').bind(peca).first<{ erro: string | null }>())?.erro).toBeNull();
  });

  it('é atômico: statement extra que falha desfaz status e evento', async () => {
    const t = await seedTenant();
    const { pautaId } = await seedPauta(t);
    const quebra = env.DB.prepare('INSERT INTO tenants (id, slug, nome) VALUES (?, ?, ?)').bind(t, 'dup', 'dup');   // PK duplicada
    await expect(transitar(env, { tipo: 'pauta', id: pautaId, tenantId: t, para: 'em_producao', por: 'u', batch: [quebra] })).rejects.toThrow();
    expect(await statusDe('pautas', pautaId)).toBe('sugerida');
    expect(await eventosDe(pautaId)).toEqual([]);
  });

  it('perde a corrida quando o status muda entre a leitura e o batch: aborta tudo', async () => {
    const t = await seedTenant();
    const { pautaId } = await seedPauta(t, 'em_producao');
    const peca = await seedPeca(t, pautaId, { status: 'revisao' });
    // DB que, no primeiro batch, deixa outro "request" aprovar a peça antes do nosso batch rodar.
    let sabotou = false;
    const DB = new Proxy(env.DB, {
      get(alvo, prop) {
        if (prop === 'batch') return async (stmts: D1PreparedStatement[]) => {
          if (!sabotou) { sabotou = true; await alvo.prepare("UPDATE pecas SET status = 'aprovada' WHERE id = ?").bind(peca).run(); }
          return alvo.batch(stmts);
        };
        const v = Reflect.get(alvo, prop, alvo);
        return typeof v === 'function' ? v.bind(alvo) : v;
      },
    });
    const extra = env.DB.prepare("UPDATE pecas SET erro = 'não devia ficar' WHERE id = ?").bind(peca);
    const erro = await transitar({ ...env, DB }, { tipo: 'peca', id: peca, tenantId: t, para: 'rejeitada', por: 'u', batch: [extra] }).catch((e) => e);
    expect(erro).toBeInstanceOf(TransicaoInvalida);
    expect((erro as TransicaoInvalida).concorrente).toBe(true);
    expect(await statusDe('pecas', peca)).toBe('aprovada');
    expect(await eventosDe(peca)).toEqual([]);
    expect((await env.DB.prepare('SELECT erro FROM pecas WHERE id = ?').bind(peca).first<{ erro: string | null }>())?.erro).toBeNull();
  });

  it('não acha entidade de outro tenant', async () => {
    const a = await seedTenant(), b = await seedTenant();
    const { pautaId } = await seedPauta(b);
    const erro = await transitar(env, { tipo: 'pauta', id: pautaId, tenantId: a, para: 'aceita', por: 'u' }).catch((e) => e);
    expect(erro).toBeInstanceOf(TransicaoInvalida);
    expect((erro as TransicaoInvalida).de).toBeNull();
    expect(await statusDe('pautas', pautaId)).toBe('sugerida');
  });

  it('várias transições num batch; motivo vira pecas.erro em rejeitada', async () => {
    const t = await seedTenant();
    const { pautaId } = await seedPauta(t, 'em_producao');
    const peca = await seedPeca(t, pautaId, { status: 'revisao' });
    await transitar(env, [
      { tipo: 'peca', id: peca, tenantId: t, para: 'rejeitada', por: 'u', motivo: 'fora da linha' },
      { tipo: 'pauta', id: pautaId, tenantId: t, para: 'descartada', por: 'u' },
    ]);
    expect(await statusDe('pecas', peca)).toBe('rejeitada');
    expect(await statusDe('pautas', pautaId)).toBe('descartada');
    expect((await env.DB.prepare('SELECT erro FROM pecas WHERE id = ?').bind(peca).first<{ erro: string }>())?.erro).toBe('fora da linha');
  });
});
