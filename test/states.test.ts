import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { LEAD_STATUS, PIECE_STATUS, InvalidTransition, canTransition, transition } from '../src/kernel/states';
import { eventsOf, seedLead, seedPiece, seedTenant, statusOf } from './helpers';

describe('transition table', () => {
  it('piece follows the path rascunho → revisao → aprovada → publicada', () => {
    expect(canTransition('peca', 'rascunho', 'revisao')).toBe(true);
    expect(canTransition('peca', 'revisao', 'aprovada')).toBe(true);
    expect(canTransition('peca', 'revisao', 'rascunho')).toBe(true);   // reescrever
    expect(canTransition('peca', 'aprovada', 'publicada')).toBe(true);
  });

  it('rejects shortcuts and exits from a terminal state', () => {
    expect(canTransition('peca', 'rascunho', 'publicada')).toBe(false);
    expect(canTransition('peca', 'rascunho', 'aprovada')).toBe(false);
    expect(canTransition('peca', 'revisao', 'publicada')).toBe(false);
    for (const terminal of ['publicada', 'falhou', 'rejeitada'] as const) {
      for (const to of PIECE_STATUS) expect(canTransition('peca', terminal, to)).toBe(false);
    }
    for (const to of LEAD_STATUS) expect(canTransition('pauta', 'concluida', to)).toBe(false);
    expect(canTransition('pauta', 'em_producao', 'sugerida')).toBe(false);
  });
});

describe('transition', () => {
  it('changes the status and records the event with who decided, in the same batch', async () => {
    const t = await seedTenant();
    const { pautaId: leadId } = await seedLead(t);
    const r = await transition(env, { tipo: 'pauta', id: leadId, tenantId: t, para: 'em_producao', por: 'user-1', dados: { x: 1 } });
    expect(r.mudou).toBe(true);
    expect(await statusOf('pautas', leadId)).toBe('em_producao');
    expect(await eventsOf(leadId)).toEqual([{ tipo: 'pauta.em_producao', chave: null, payload: { de: 'sugerida', para: 'em_producao', por: 'user-1', x: 1 } }]);
  });

  it('invalid transition throws and writes nothing', async () => {
    const t = await seedTenant();
    const { pautaId: leadId } = await seedLead(t, 'em_producao');
    const piece = await seedPiece(t, leadId, { status: 'rascunho' });
    await expect(transition(env, { tipo: 'peca', id: piece, tenantId: t, para: 'publicada', por: 'u' })).rejects.toBeInstanceOf(InvalidTransition);
    expect(await statusOf('pecas', piece)).toBe('rascunho');
    expect(await eventsOf(piece)).toEqual([]);
  });

  it('already at the target = no-op: no event or batch (step replay after commit)', async () => {
    const t = await seedTenant();
    const { pautaId: leadId } = await seedLead(t, 'em_producao');
    const piece = await seedPiece(t, leadId, { status: 'revisao' });
    const extra = env.DB.prepare("UPDATE pecas SET erro = 'não devia rodar' WHERE id = ?").bind(piece);
    const r = await transition(env, { tipo: 'peca', id: piece, tenantId: t, para: 'revisao', por: 'sistema', batch: [extra] });
    expect(r.mudou).toBe(false);
    expect(await eventsOf(piece)).toEqual([]);
    expect((await env.DB.prepare('SELECT erro FROM pecas WHERE id = ?').bind(piece).first<{ erro: string | null }>())?.erro).toBeNull();
  });

  it('is atomic: an extra statement that fails undoes the status and the event', async () => {
    const t = await seedTenant();
    const { pautaId: leadId } = await seedLead(t);
    const breakValue = env.DB.prepare('INSERT INTO tenants (id, slug, nome) VALUES (?, ?, ?)').bind(t, 'dup', 'dup');   // PK duplicada
    await expect(transition(env, { tipo: 'pauta', id: leadId, tenantId: t, para: 'em_producao', por: 'u', batch: [breakValue] })).rejects.toThrow();
    expect(await statusOf('pautas', leadId)).toBe('sugerida');
    expect(await eventsOf(leadId)).toEqual([]);
  });

  it('loses the race when the status changes between the read and the batch: aborts everything', async () => {
    const t = await seedTenant();
    const { pautaId: leadId } = await seedLead(t, 'em_producao');
    const piece = await seedPiece(t, leadId, { status: 'revisao' });
    // A DB that, on the first batch, lets another "request" approve the piece before our batch runs.
    let sabotaged = false;
    const DB = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === 'batch') return async (stmts: D1PreparedStatement[]) => {
          if (!sabotaged) { sabotaged = true; await target.prepare("UPDATE pecas SET status = 'aprovada' WHERE id = ?").bind(piece).run(); }
          return target.batch(stmts);
        };
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const extra = env.DB.prepare("UPDATE pecas SET erro = 'não devia ficar' WHERE id = ?").bind(piece);
    const error = await transition({ ...env, DB }, { tipo: 'peca', id: piece, tenantId: t, para: 'rejeitada', por: 'u', batch: [extra] }).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidTransition);
    expect((error as InvalidTransition).concorrente).toBe(true);
    expect(await statusOf('pecas', piece)).toBe('aprovada');
    expect(await eventsOf(piece)).toEqual([]);
    expect((await env.DB.prepare('SELECT erro FROM pecas WHERE id = ?').bind(piece).first<{ erro: string | null }>())?.erro).toBeNull();
  });

  it("doesn't find an entity from another tenant", async () => {
    const a = await seedTenant(), b = await seedTenant();
    const { pautaId: leadId } = await seedLead(b);
    const error = await transition(env, { tipo: 'pauta', id: leadId, tenantId: a, para: 'aceita', por: 'u' }).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidTransition);
    expect((error as InvalidTransition).de).toBeNull();
    expect(await statusOf('pautas', leadId)).toBe('sugerida');
  });

  it('several transitions in one batch; the reason becomes pecas.erro when rejected', async () => {
    const t = await seedTenant();
    const { pautaId: leadId } = await seedLead(t, 'em_producao');
    const piece = await seedPiece(t, leadId, { status: 'revisao' });
    await transition(env, [
      { tipo: 'peca', id: piece, tenantId: t, para: 'rejeitada', por: 'u', motivo: 'fora da linha' },
      { tipo: 'pauta', id: leadId, tenantId: t, para: 'descartada', por: 'u' },
    ]);
    expect(await statusOf('pecas', piece)).toBe('rejeitada');
    expect(await statusOf('pautas', leadId)).toBe('descartada');
    expect((await env.DB.prepare('SELECT erro FROM pecas WHERE id = ?').bind(piece).first<{ erro: string }>())?.erro).toBe('fora da linha');
  });
});
