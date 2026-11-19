import { env, introspectWorkflow } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deepseekCost } from '../src/lib/deepseek';
import { loadLead } from '../src/lib/lead';
import { finishProduction, failProduction, currentRecordVersion, draftVersion, baseVersion } from '../src/workflows/production';
import { failPublication } from '../src/workflows/publishing';
import { reconcileExecutions } from '../src/workflows/reconcile';
import { startProduction } from '../src/workflows/production';
import { transition, startExecution } from '../src/kernel/states';
import { register, eventsOf, req, seedAccount, seedMember, seedLead, seedTenant, statusOf, type Session } from './helpers';

// Fake DeepSeek: counts calls and returns a draft that passes the validator (no numbers outside the facts).
let callsModel = 0;
let modelAnswer: () => object;
const DRAFT_OK = (factId: string) => ({
  manchete: 'Prefeitura interdita ponte da Avenida Santos Dumont',
  resumo: 'Ponte fecha para obras.',
  legenda: 'A prefeitura interdita a ponte da Avenida Santos Dumont para obras.',
  cards: [{ papel: 'capa', titulo: 'Ponte da Santos Dumont fecha para obras', frases: [{ texto: 'A prefeitura interdita a ponte para obras.', fatoId: factId }] }],
  visualBrief: { primary: 'ponte de concreto sobre canal ao entardecer', fatoIds: [factId] },
});
const USAGE = { prompt_tokens: 1000, completion_tokens: 500 };   // = US$ 0.00045 off-peak, double at peak
const callCost = () => deepseekCost({ entrada: 1000, saida: 500 });

beforeEach(() => {
  callsModel = 0;
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('deepseek')) {
      callsModel++;
      return Response.json({ choices: [{ message: { content: JSON.stringify(modelAnswer()) } }], usage: USAGE });
    }
    return original(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

const ARTWORK = (t: string, p: string, v: number) => [{ papel: 'capa', png: `artes/${t}/${p}/v${v}/01-capa.png`, jpg: `artes/${t}/${p}/v${v}/01-capa.jpg`, metricas: {} }];

/** Production instances created from here on: illustration and render mocked (Browser/AI are remote). */
async function interceptProduction(tenantId: string) {
  const intro = await introspectWorkflow(env.PRODUCAO_WORKFLOW);
  await intro.modifyAll(async (m) => {
    await m.disableRetryDelays();
    // null does not count as a mock in the introspector; an illustration already in R2 is the common case anyway.
    await m.mockStepResult({ name: 'ilustrar' }, { r2Key: `artes/${tenantId}/x/ilustracao-abc`, custoUsd: 0, promptHash: 'abc', reutilizada: true, provedor: 'kie' });
    await m.mockStepResult({ name: 'renderizar' }, ARTWORK(tenantId, 'x', 1));
  });
  return intro;
}

async function scenario() {
  const s = await register();
  const t = await seedTenant();
  await seedMember(t, s.userId, 'editor');
  const { pautaId: leadId, fatos: facts } = await seedLead(t);
  modelAnswer = () => DRAFT_OK(facts[0].id);
  return { s, t, pautaId: leadId, fatos: facts };
}

async function produce(s: Session, t: string, leadId: string) {
  const intro = await interceptProduction(t);
  try {
    const res = await req(`/api/t/${t}/pautas/${leadId}/produzir`, { cookie: s.cookie, body: { formato: 'post' } });
    expect(res.status).toBe(201);
    const { pecaId: pieceId, workflowId } = await res.json<{ pecaId: string; workflowId: string }>();
    const [inst] = await intro.get();
    await inst.waitForStatus('complete');
    return { pecaId: pieceId, workflowId };
  } finally {
    await intro.dispose();
  }
}

const line = <T>(sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).first<T>();

describe('production → review', () => {
  it('round 1 ends in review, with version, cost and a closed execution', async () => {
    const { s, t, pautaId: leadId } = await scenario();
    const { pecaId: pieceId, workflowId } = await produce(s, t, leadId);
    expect(workflowId).toBe(`${pieceId}-r1`);

    expect(await statusOf('pecas', pieceId)).toBe('revisao');
    expect(await statusOf('pautas', leadId)).toBe('em_producao');
    expect(callsModel).toBe(1);
    const piece = await line<{ versao: number; custo_usd: number; arte_r2_keys_json: string }>('SELECT versao, custo_usd, arte_r2_keys_json FROM pecas WHERE id = ?', pieceId);
    expect(piece?.versao).toBe(1);
    expect(piece?.custo_usd).toBeCloseTo(callCost(), 9);
    expect(JSON.parse(piece!.arte_r2_keys_json)).toHaveLength(1);
    const exec = await line<{ status: string; custo_usd: number; terminado_em: string | null }>('SELECT status, custo_usd, terminado_em FROM execucoes WHERE id = ?', workflowId);
    expect(exec).toMatchObject({ status: 'concluida' });
    expect(exec?.custo_usd).toBeCloseTo(callCost(), 9);
    expect(exec?.terminado_em).not.toBeNull();
    expect((await eventsOf(pieceId)).map((e) => [e.tipo, e.payload?.por])).toEqual([['peca.revisao', 'sistema']]);
    expect((await eventsOf(leadId)).map((e) => [e.tipo, e.payload?.por])).toEqual([['pauta.em_producao', s.userId]]);
  });

  it('with autopilot on, a site story leaves review on its own', async () => {
    const { s, t, pautaId: leadId } = await scenario();
    await seedAccount(t, 'simulada');
    vi.spyOn(env.PUBLICACAO_WORKFLOW, 'create').mockResolvedValue({ id: 'x' } as never);
    await env.DB.batch([
      env.DB.prepare("UPDATE pautas SET origem = 'site' WHERE id = ?").bind(leadId),
      env.DB.prepare("UPDATE tenants SET piloto_ligado_em = datetime('now'), piloto_ligado_por = ? WHERE id = ?").bind(s.userId, t),
    ]);
    const { pecaId: pieceId } = await produce(s, t, leadId);
    expect(await statusOf('pecas', pieceId)).toBe('aprovada');
    expect(await line('SELECT por FROM decisoes WHERE peca_id = ?', pieceId)).toEqual({ por: 'piloto' });
  });

  it("a lead already in production doesn't generate a second piece", async () => {
    const { s, t, pautaId: leadId } = await scenario();
    await produce(s, t, leadId);
    const res = await req(`/api/t/${t}/pautas/${leadId}/produzir`, { cookie: s.cookie, body: {} });
    expect(res.status).toBe(409);
    expect((await line<{ n: number }>('SELECT COUNT(*) AS n FROM pecas WHERE pauta_id = ?', leadId))?.n).toBe(1);
  });

  it('validator fails 3 drafts → piece failed, lead goes back to the queue, cost of the 3', async () => {
    const { s, t, pautaId: leadId, fatos: facts } = await scenario();
    modelAnswer = () => ({ ...DRAFT_OK(facts[0].id), manchete: 'Ponte fecha por 99 dias' });   // 99 is not in the facts
    const { pecaId: pieceId, workflowId } = await produce(s, t, leadId);
    expect(await statusOf('pecas', pieceId)).toBe('falhou');
    expect(await statusOf('pautas', leadId)).toBe('aceita');
    expect(callsModel).toBe(3);
    expect((await line<{ n: number }>('SELECT COUNT(*) AS n FROM peca_versoes WHERE peca_id = ?', pieceId))?.n).toBe(3);
    expect((await line<{ custo_usd: number }>('SELECT custo_usd FROM pecas WHERE id = ?', pieceId))?.custo_usd).toBeCloseTo(3 * callCost(), 9);
    expect(await line('SELECT status FROM execucoes WHERE id = ?', workflowId)).toEqual({ status: 'falhou' });
  });
  it('Fadell case: outlet with a number in its name ("Gazeta do Bairro 2"), report as post → passes on the 1st draft', async () => {
    const { s, t, pautaId: leadId, fatos: facts } = await scenario();
    // Without an @ in the brand, the generic CTA and the "Source:" line carry the outlet's name: "Follow Gazeta do Bairro
    // 2." The "2" is not in the facts and the model cannot remove what it did not write; before, it failed 3 times in 9 s.
    await env.DB.prepare("UPDATE tenants SET nome = ?, marca_json = ? WHERE id = ?").bind('Gazeta do Bairro 2', JSON.stringify({ nome: 'Gazeta do Bairro 2' }), t).run();
    await env.DB.prepare("UPDATE fontes SET nome = 'relato de Gazeta do Bairro 2' WHERE tenant_id = ?").bind(t).run();
    modelAnswer = () => DRAFT_OK(facts[0].id);
    const { pecaId: pieceId } = await produce(s, t, leadId);
    expect(await statusOf('pecas', pieceId)).toBe('revisao');
    expect(callsModel).toBe(1);
    const piece = await line<{ conteudo_json: string; validacao_json: string }>('SELECT conteudo_json, validacao_json FROM pecas WHERE id = ?', pieceId);
    expect(JSON.parse(piece!.validacao_json)).toEqual({ ok: true, erros: [], avisos: [] });
    const content = JSON.parse(piece!.conteudo_json);
    expect(content.legenda).toMatch(/\n\nSiga Gazeta do Bairro 2\.\n\nFonte: relato de Gazeta do Bairro 2$/);
    // The post has a sentence tied to a fact on the cover (the single image): no "0 sentences, 0 facts".
    expect(content.cards).toEqual([{ papel: 'capa', titulo: 'Ponte da Santos Dumont fecha para obras', frases: [{ texto: 'A prefeitura interdita a ponte para obras.', fatoId: facts[0].id }] }]);
  });

  it('post whose card has no sentence tied to a fact fails ("nenhuma frase com fonte"), and doesn\'t pass as "Validação ok"', async () => {
    const { s, t, pautaId: leadId, fatos: facts } = await scenario();
    modelAnswer = () => ({ ...DRAFT_OK(facts[0].id), cards: [{ papel: 'capa', titulo: 'Ponte da Santos Dumont fecha para obras', frases: [] }] });
    const { pecaId: pieceId } = await produce(s, t, leadId);
    expect(await statusOf('pecas', pieceId)).toBe('falhou');
    expect(callsModel).toBe(3);
    const v = JSON.parse((await line<{ validacao_json: string }>('SELECT validacao_json FROM pecas WHERE id = ?', pieceId))!.validacao_json);
    expect(v.erros).toEqual(['nenhuma frase com fonte: os cards precisam de frases presas a um fato']);
  });

  it('step that exhausts its retries (render) → piece failed, lead goes back to the queue, execution failed with the error', async () => {
    const { s, t, pautaId: leadId } = await scenario();
    const intro = await introspectWorkflow(env.PRODUCAO_WORKFLOW);
    try {
      await intro.modifyAll(async (m) => {
        await m.disableRetryDelays();
        await m.mockStepResult({ name: 'ilustrar' }, { r2Key: 'k', custoUsd: 0, promptHash: 'h', reutilizada: true, provedor: 'kie' });
        await m.mockStepError({ name: 'renderizar' }, new Error('browser indisponível'));
      });
      const res = await req(`/api/t/${t}/pautas/${leadId}/produzir`, { cookie: s.cookie, body: { formato: 'post' } });
      const { pecaId: pieceId, workflowId } = await res.json<{ pecaId: string; workflowId: string }>();
      const [inst] = await intro.get();
      await inst.waitForStatus('errored');
      expect(await statusOf('pecas', pieceId)).toBe('falhou');
      expect(await statusOf('pautas', leadId)).toBe('aceita');
      expect((await line<{ erro: string }>('SELECT erro FROM pecas WHERE id = ?', pieceId))?.erro).toContain('browser indisponível');
      expect(await line('SELECT status FROM execucoes WHERE id = ?', workflowId)).toEqual({ status: 'falhou' });
      expect((await eventsOf(pieceId)).map((e) => e.tipo)).toEqual(['peca.falhou']);
      // the lead can be produced again
      expect(await line('SELECT COUNT(*) AS n FROM pecas WHERE pauta_id = ?', leadId)).toEqual({ n: 1 });
    } finally {
      await intro.dispose();
    }
  });
});

describe('review', () => {
  it('rewrite creates round 2 with the instruction; versions keep numbering', async () => {
    const { s, t, pautaId: leadId } = await scenario();
    const { pecaId: pieceId } = await produce(s, t, leadId);
    const intro = await interceptProduction(t);
    try {
      const res = await req(`/api/t/${t}/pecas/${pieceId}/revisao`, { cookie: s.cookie, body: { decisao: 'reescrever', instrucao: 'mais curto' } });
      expect(res.status).toBe(202);
      expect(await res.json()).toMatchObject({ status: 'rascunho', rodada: 2, workflowId: `${pieceId}-r2` });
      const [inst] = await intro.get();
      await inst.waitForStatus('complete');
    } finally {
      await intro.dispose();
    }

    expect(await statusOf('pecas', pieceId)).toBe('revisao');
    expect(await line('SELECT versao, rodada FROM pecas WHERE id = ?', pieceId)).toEqual({ versao: 2, rodada: 2 });
    expect(await line('SELECT motivo FROM peca_versoes WHERE peca_id = ? AND versao = 2', pieceId)).toEqual({ motivo: 'mais curto' });
    expect(await line('SELECT decisao, versao, por FROM decisoes WHERE peca_id = ?', pieceId)).toEqual({ decisao: 'reescrever', versao: 1, por: s.userId });
    expect(callsModel).toBe(2);
    // replay without cache (instance restart): each round's base does not change with the versions already recorded in it
    expect(await baseVersion(env, t, pieceId, 1)).toBe(0);
    expect(await baseVersion(env, t, pieceId, 2)).toBe(1);
  });

  it("replay of the final step of a superseded round doesn't put the old art back in review", async () => {
    const { s, t, pautaId: leadId } = await scenario();
    const { pecaId: pieceId } = await produce(s, t, leadId);
    const artworkR1 = await line<{ arte_r2_keys_json: string }>('SELECT arte_r2_keys_json FROM pecas WHERE id = ?', pieceId);
    // The editor asks for a rewrite: the route's same batch (piece → draft, round 2, r2's workflow_id), without creating the instance.
    await transition(env, {
      tipo: 'peca', id: pieceId, tenantId: t, para: 'rascunho', por: s.userId,
      batch: [env.DB.prepare('UPDATE pecas SET rodada = 2, workflow_id = ? WHERE id = ?').bind(`${pieceId}-r2`, pieceId)],
    });
    const eventsBefore = (await eventsOf(pieceId)).length;

    // Round 1's 'revisao' step is replayed now (the commit had gone through, the step's completion had not).
    await finishProduction(env, { tenantId: t, pecaId: pieceId, rodada: 1 }, `${pieceId}-r1`, [{ papel: 'capa', png: 'velha.png', jpg: 'velha.jpg' }], 1);

    expect(await statusOf('pecas', pieceId)).toBe('rascunho');
    expect(await line('SELECT arte_r2_keys_json FROM pecas WHERE id = ?', pieceId)).toEqual(artworkR1);
    expect((await eventsOf(pieceId)).length).toBe(eventsBefore);
    expect(await line('SELECT workflow_id FROM pecas WHERE id = ?', pieceId)).toEqual({ workflow_id: `${pieceId}-r2` });
  });

  it('manual account: approving stops at aprovada; operator confirms with the URL → publicada, lead completed', async () => {
    const { s, t, pautaId: leadId } = await scenario();
    const accountId = await seedAccount(t, 'manual');
    const { pecaId: pieceId } = await produce(s, t, leadId);

    const ap = await req(`/api/t/${t}/pecas/${pieceId}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: accountId } });
    expect(ap.status).toBe(200);
    expect(await ap.json()).toEqual({ status: 'aprovada', modo: 'manual' });
    expect((await line<{ n: number }>("SELECT COUNT(*) AS n FROM execucoes WHERE ref_id = ? AND tipo = 'publicacao'", pieceId))?.n).toBe(0);
    // a second approval of the same piece: 409
    expect((await req(`/api/t/${t}/pecas/${pieceId}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: accountId } })).status).toBe(409);

    const pkg = await (await req(`/api/t/${t}/pecas/${pieceId}/pacote`, { cookie: s.cookie })).json<{ legenda: string; imagens: { jpg: string }[] }>();
    expect(pkg.legenda).toContain('Fonte: Prefeitura');
    expect(pkg.imagens[0].jpg).toMatch(/^http:\/\/localhost:8787\/media\/.+sig=/);

    const pub = await req(`/api/t/${t}/pecas/${pieceId}/publicada`, { cookie: s.cookie, body: { url: 'https://www.instagram.com/p/ABC123/' } });
    expect(pub.status).toBe(200);
    expect(await statusOf('pecas', pieceId)).toBe('publicada');
    expect(await statusOf('pautas', leadId)).toBe('concluida');
    expect(await line('SELECT modo, url, status FROM publicacoes WHERE peca_id = ?', pieceId)).toEqual({ modo: 'manual', url: 'https://www.instagram.com/p/ABC123/', status: 'publicada' });
    // every human decision event carries the session id
    const humans = (await eventsOf(pieceId)).filter((e) => e.payload?.por !== 'sistema');
    expect(humans.map((e) => e.tipo)).toEqual(['peca.aprovada', 'peca.publicada']);
    expect(humans.every((e) => e.payload.por === s.userId)).toBe(true);
  });

  it('simulated account + scheduling: PublicacaoWorkflow publishes and records the Graph API calls', async () => {
    const { s, t, pautaId: leadId } = await scenario();
    const accountId = await seedAccount(t, 'simulada');
    const { pecaId: pieceId } = await produce(s, t, leadId);

    const intro = await introspectWorkflow(env.PUBLICACAO_WORKFLOW);
    try {
      await intro.modifyAll(async (m) => { await m.disableSleeps(); await m.disableRetryDelays(); });
      const scheduleTo = new Date(Date.now() + 3600_000).toISOString();
      const ap = await req(`/api/t/${t}/pecas/${pieceId}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: accountId, agendarPara: scheduleTo } });
      expect(ap.status).toBe(202);
      expect(await ap.json()).toEqual({ status: 'agendada', modo: 'simulada', workflowId: `${pieceId}-pub-1` });
      const [inst] = await intro.get();
      await inst.waitForStatus('complete');
    } finally {
      await intro.dispose();
    }

    expect(await statusOf('pecas', pieceId)).toBe('publicada');
    expect(await statusOf('pautas', leadId)).toBe('concluida');
    const pub = await line<{ id: string; modo: string; external_id: string; status: string }>('SELECT id, modo, external_id, status FROM publicacoes WHERE peca_id = ?', pieceId);
    expect(pub).toMatchObject({ id: `${pieceId}-pub-1`, modo: 'simulada', status: 'publicada' });
    expect(pub?.external_id).toMatch(/^sim_media_/);
    expect(await line('SELECT status FROM execucoes WHERE id = ?', `${pieceId}-pub-1`)).toEqual({ status: 'concluida' });
    const types = (await eventsOf(pieceId)).map((e) => e.tipo);
    expect(types).toEqual(['peca.revisao', 'peca.agendada', 'peca.publicada', 'peca.publicacao_simulada']);
  });
});

describe('idempotency of drafting', () => {
  it("step re-run after recording: doesn't call the model again and doesn't add cost", async () => {
    const { t, pautaId: leadId } = await scenario();
    const pieceId = crypto.randomUUID();
    const executionId = `${pieceId}-r1`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO pecas (id, tenant_id, pauta_id, formato) VALUES (?, ?, ?, 'post')").bind(pieceId, t, leadId),
      env.DB.prepare("INSERT INTO execucoes (id, tenant_id, tipo, ref_tipo, ref_id, params_json) VALUES (?, ?, 'producao', 'peca', ?, '{}')").bind(executionId, t, pieceId),
    ]);
    const lead = await loadLead(env, t, leadId);
    const args = { tenantId: t, pecaId: pieceId, execucaoId: executionId, rodada: 1, versao: 1, pauta: lead, formato: 'post' as const };

    const r1 = await draftVersion(env, args);
    const r2 = await draftVersion(env, args);   // replay

    expect(callsModel).toBe(1);
    expect(r2).toEqual(r1);
    expect((await line<{ custo_usd: number }>('SELECT custo_usd FROM pecas WHERE id = ?', pieceId))?.custo_usd).toBeCloseTo(callCost(), 9);
    expect((await line<{ custo_usd: number }>('SELECT custo_usd FROM execucoes WHERE id = ?', executionId))?.custo_usd).toBeCloseTo(callCost(), 9);
    expect((await line<{ n: number }>('SELECT COUNT(*) AS n FROM peca_versoes WHERE peca_id = ?', pieceId))?.n).toBe(1);
  });
});

describe('reconciliation: request died between the batch and the create', () => {
  it('cron recreates the instance with the recorded params; a second pass does nothing', async () => {
    const { s, t, pautaId: leadId } = await scenario();
    const pieceId = crypto.randomUUID();
    const executionId = `${pieceId}-r1`;
    const params = { tenantId: t, pautaId: leadId, pecaId: pieceId, formato: 'post' as const, rodada: 1 };
    // The same batch as produce, without the create afterwards (the request "died").
    await transition(env, {
      tipo: 'pauta', id: leadId, tenantId: t, para: 'em_producao', por: s.userId,
      batch: [
        env.DB.prepare("INSERT INTO pecas (id, tenant_id, pauta_id, formato, rodada, workflow_id) VALUES (?, ?, ?, 'post', 1, ?)").bind(pieceId, t, leadId, executionId),
        startExecution(env, { id: executionId, tenantId: t, tipo: 'producao', refTipo: 'peca', refId: pieceId, params }),
      ],
    });
    // Too recent: it may still be a request in progress.
    expect(await reconcileExecutions(env)).toEqual({ recriadas: 0, falhas: 0 });
    await env.DB.prepare("UPDATE execucoes SET iniciado_em = datetime('now', '-10 minutes') WHERE id = ?").bind(executionId).run();

    const intro = await interceptProduction(t);
    try {
      expect(await reconcileExecutions(env)).toEqual({ recriadas: 1, falhas: 0 });
      const [inst] = await intro.get();
      await inst.waitForStatus('complete');
    } finally {
      await intro.dispose();
    }
    expect(await statusOf('pecas', pieceId)).toBe('revisao');
    expect(await line('SELECT status FROM execucoes WHERE id = ?', executionId)).toEqual({ status: 'concluida' });
    expect((await eventsOf(pieceId)).map((e) => e.tipo)).toEqual(['execucao.recriada', 'peca.revisao']);
    expect(await reconcileExecutions(env)).toEqual({ recriadas: 0, falhas: 0 });
  });
});

/** A production with a recorded batch and no create (what is left when the request dies). */
async function productionWithoutInstance(t: string, leadId: string, actor: string, behindMinutes = 0) {
  const pieceId = crypto.randomUUID();
  const executionId = `${pieceId}-r1`;
  const params = { tenantId: t, pautaId: leadId, pecaId: pieceId, formato: 'post' as const, rodada: 1 };
  await transition(env, {
    tipo: 'pauta', id: leadId, tenantId: t, para: 'em_producao', por: actor,
    batch: [
      env.DB.prepare("INSERT INTO pecas (id, tenant_id, pauta_id, formato, rodada, workflow_id) VALUES (?, ?, ?, 'post', 1, ?)").bind(pieceId, t, leadId, executionId),
      startExecution(env, { id: executionId, tenantId: t, tipo: 'producao', refTipo: 'peca', refId: pieceId, params }),
    ],
  });
  if (behindMinutes) await env.DB.prepare("UPDATE execucoes SET iniciado_em = datetime('now', ?) WHERE id = ?").bind(`-${behindMinutes} minutes`, executionId).run();
  return { pecaId: pieceId, execucaoId: executionId, params };
}

/** Env whose PRODUCAO_WORKFLOW fails on create; `existe` decides whether get() finds the instance. */
function envWithCreateBroken(exists: boolean) {
  const wf = {
    create: async () => { throw new Error('timeout de rede'); },
    get: async (id: string) => { if (!exists) throw new Error('instance.not_found'); return { id, status: async () => ({ status: 'running' }) }; },
  };
  return { ...env, PRODUCAO_WORKFLOW: wf as unknown as typeof env.PRODUCAO_WORKFLOW };
}

describe('ambiguous create', () => {
  it('create fails but the instance exists (lost response): counts as created, nothing becomes a failure', async () => {
    const { s, t, pautaId: leadId } = await scenario();
    const { pecaId: pieceId, params } = await productionWithoutInstance(t, leadId, s.userId);
    expect(await startProduction(envWithCreateBroken(true), params)).toBeNull();
    expect(await statusOf('pecas', pieceId)).toBe('rascunho');
  });

  it("create fails and the instance doesn't exist: stays pending (doesn't fail right away)", async () => {
    const { s, t, pautaId: leadId } = await scenario();
    const { pecaId: pieceId, execucaoId: executionId, params } = await productionWithoutInstance(t, leadId, s.userId);
    expect(await startProduction(envWithCreateBroken(false), params)).toMatch(/timeout de rede/);
    expect(await statusOf('pecas', pieceId)).toBe('rascunho');
    expect(await statusOf('pautas', leadId)).toBe('em_producao');
    expect(await line('SELECT status FROM execucoes WHERE id = ?', executionId)).toEqual({ status: 'rodando' });
  });

  it('reconciler gives up after 1 h without managing to create: piece failed, lead goes back to the queue', async () => {
    const { s, t, pautaId: leadId } = await scenario();
    const { pecaId: pieceId, execucaoId: executionId } = await productionWithoutInstance(t, leadId, s.userId, 61);
    expect(await reconcileExecutions(envWithCreateBroken(false))).toMatchObject({ falhas: 1 });
    expect(await statusOf('pecas', pieceId)).toBe('falhou');
    expect(await statusOf('pautas', leadId)).toBe('aceita');
    expect(await line('SELECT status FROM execucoes WHERE id = ?', executionId)).toEqual({ status: 'falhou' });
  });

  it("between 5 min and 1 h it just retries, it doesn't give up", async () => {
    const { s, t, pautaId: leadId } = await scenario();
    const { pecaId: pieceId } = await productionWithoutInstance(t, leadId, s.userId, 20);
    expect(await reconcileExecutions(envWithCreateBroken(false))).toMatchObject({ recriadas: 0, falhas: 0 });
    expect(await statusOf('pecas', pieceId)).toBe('rascunho');
  });
});

describe('paginated reconciliation', () => {
  it("publications sleeping until their schedule do not block a newer execution without an instance", async () => {
    // Runs other tests left open on purpose do not count here.
    await env.DB.prepare("UPDATE execucoes SET status = 'concluida' WHERE status = 'rodando'").run();
    const { s, t, pautaId: leadId } = await scenario();
    // 3 live publications (sleeping until 2030) older than everything; a page of 2 → must go past the 1st page.
    for (let i = 0; i < 3; i++) {
      const pieceId = crypto.randomUUID();
      const id = `${pieceId}-pub-1`;
      const params = { tenantId: t, pautaId: leadId, pecaId: pieceId, contaId: 'x', agendadoPara: '2030-01-01T00:00:00Z' };
      await env.DB.prepare("INSERT INTO pecas (id, tenant_id, pauta_id, formato, status) VALUES (?, ?, ?, 'post', 'agendada')").bind(pieceId, t, leadId).run();
      await startExecution(env, { id, tenantId: t, tipo: 'publicacao', refTipo: 'peca', refId: pieceId, params }).run();
      await env.DB.prepare("UPDATE execucoes SET iniciado_em = datetime('now', ?) WHERE id = ?").bind(`-${30 - i} minutes`, id).run();
      await env.PUBLICACAO_WORKFLOW.create({ id, params });
    }
    const { pecaId: pieceId } = await productionWithoutInstance(t, leadId, s.userId, 10);
    const intro = await interceptProduction(t);
    try {
      expect(await reconcileExecutions(env, 2)).toEqual({ recriadas: 1, falhas: 0 });
      const [inst] = await intro.get();
      await inst.waitForStatus('complete');
    } finally {
      await intro.dispose();
    }
    expect(await statusOf('pecas', pieceId)).toBe('revisao');
  });
});

describe("reconciliation doesn't give up without confirming absence", () => {
  it("query unavailable (not not-found) + create failing for over 1 h: doesn't mark failure", async () => {
    const { s, t, pautaId: leadId } = await scenario();
    const { pecaId: pieceId } = await productionWithoutInstance(t, leadId, s.userId, 90);
    const wf = {
      create: async () => { throw new Error('timeout de rede'); },
      get: async () => { throw new Error('upstream indisponível'); },
    };
    const r = await reconcileExecutions({ ...env, PRODUCAO_WORKFLOW: wf as unknown as typeof env.PRODUCAO_WORKFLOW });
    expect(r).toEqual({ recriadas: 0, falhas: 0 });
    expect(await statusOf('pecas', pieceId)).toBe('rascunho');
    await env.DB.prepare("UPDATE execucoes SET status = 'concluida' WHERE ref_id = ?").bind(pieceId).run();
  });

  it('a sweep that hits the page limit keeps the cursor, and the next round continues from there', async () => {
    await env.DB.prepare("UPDATE execucoes SET status = 'concluida' WHERE status = 'rodando'").run();
    await env.CONFIG.delete('reconciliar:cursor');
    const { s, t, pautaId: leadId } = await scenario();
    for (let i = 0; i < 3; i++) {
      const pieceId = crypto.randomUUID();
      const id = `${pieceId}-pub-1`;
      const params = { tenantId: t, pautaId: leadId, pecaId: pieceId, contaId: 'x', agendadoPara: '2030-01-01T00:00:00Z' };
      await env.DB.prepare("INSERT INTO pecas (id, tenant_id, pauta_id, formato, status) VALUES (?, ?, ?, 'post', 'agendada')").bind(pieceId, t, leadId).run();
      await startExecution(env, { id, tenantId: t, tipo: 'publicacao', refTipo: 'peca', refId: pieceId, params }).run();
      await env.DB.prepare("UPDATE execucoes SET iniciado_em = datetime('now', ?) WHERE id = ?").bind(`-${30 - i} minutes`, id).run();
      await env.PUBLICACAO_WORKFLOW.create({ id, params });
    }
    const { pecaId: pieceId } = await productionWithoutInstance(t, leadId, s.userId, 10);
    const intro = await interceptProduction(t);
    try {
      // 1 row per page, 2 pages per round: the 1st round sees only 2 live publications and stores where it stopped.
      expect(await reconcileExecutions(env, 1, 2)).toEqual({ recriadas: 0, falhas: 0 });
      expect(await env.CONFIG.get('reconciliar:cursor')).not.toBeNull();
      // The 2nd continues: the 3rd publication and the production without an instance.
      expect(await reconcileExecutions(env, 1, 2)).toEqual({ recriadas: 1, falhas: 0 });
      const [inst] = await intro.get();
      await inst.waitForStatus('complete');
    } finally {
      await intro.dispose();
    }
    expect(await statusOf('pecas', pieceId)).toBe('revisao');
    // The 3rd round reaches the end of the list and deletes the cursor.
    await reconcileExecutions(env, 1, 5);
    expect(await env.CONFIG.get('reconciliar:cursor')).toBeNull();
  });
});

describe('replay after review (execution fences)', () => {
  it("piece already approved: replay of the completion and a late production failure don't touch it", async () => {
    const { s, t, pautaId: leadId } = await scenario();
    const accountId = await seedAccount(t, 'manual');
    const { pecaId: pieceId, workflowId } = await produce(s, t, leadId);
    expect((await req(`/api/t/${t}/pecas/${pieceId}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: accountId } })).status).toBe(200);
    const eventsBefore = (await eventsOf(pieceId)).length;

    const content = await line('SELECT conteudo_json, versao FROM pecas WHERE id = ?', pieceId);
    await currentRecordVersion(env, { tenantId: t, pecaId: pieceId }, workflowId, { manchete: 'rascunho reprovado' } as never, { ok: false }, 1);
    await finishProduction(env, { tenantId: t, pecaId: pieceId, rodada: 1 }, workflowId, [], 1);
    await failProduction(env, { tenantId: t, pecaId: pieceId, pautaId: leadId }, workflowId, 'retries esgotados no replay');
    expect(await line('SELECT conteudo_json, versao FROM pecas WHERE id = ?', pieceId)).toEqual(content);

    expect(await statusOf('pecas', pieceId)).toBe('aprovada');
    expect(await statusOf('pautas', leadId)).toBe('em_producao');
    expect(await line('SELECT status FROM execucoes WHERE id = ?', workflowId)).toEqual({ status: 'concluida' });
    expect((await eventsOf(pieceId)).length).toBe(eventsBefore);
  });

  it("superseded round: recording the validation and the old round's failure don't touch the piece", async () => {
    const { s, t, pautaId: leadId } = await scenario();
    const { pecaId: pieceId } = await produce(s, t, leadId);
    await transition(env, {
      tipo: 'peca', id: pieceId, tenantId: t, para: 'rascunho', por: s.userId,
      batch: [env.DB.prepare('UPDATE pecas SET rodada = 2, workflow_id = ? WHERE id = ?').bind(`${pieceId}-r2`, pieceId)],
    });
    const before = await line('SELECT conteudo_json, versao FROM pecas WHERE id = ?', pieceId);

    await currentRecordVersion(env, { tenantId: t, pecaId: pieceId }, `${pieceId}-r1`, { manchete: 'velha' } as never, { ok: true }, 1);
    await failProduction(env, { tenantId: t, pecaId: pieceId, pautaId: leadId }, `${pieceId}-r1`, 'rodada antiga falhou');

    expect(await line('SELECT conteudo_json, versao FROM pecas WHERE id = ?', pieceId)).toEqual(before);
    expect(await statusOf('pecas', pieceId)).toBe('rascunho');
    expect(await statusOf('pautas', leadId)).toBe('em_producao');
  });

  it("publication already completed: a late failure doesn't mark the published piece as failed", async () => {
    const { s, t, pautaId: leadId } = await scenario();
    const accountId = await seedAccount(t, 'simulada');
    const { pecaId: pieceId } = await produce(s, t, leadId);
    const intro = await introspectWorkflow(env.PUBLICACAO_WORKFLOW);
    try {
      await intro.modifyAll(async (m) => { await m.disableRetryDelays(); });
      await req(`/api/t/${t}/pecas/${pieceId}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: accountId } });
      const [inst] = await intro.get();
      await inst.waitForStatus('complete');
    } finally {
      await intro.dispose();
    }
    await failPublication(env, { tenantId: t, pautaId: leadId, pecaId: pieceId, contaId: accountId }, `${pieceId}-pub-1`, 'replay');
    expect(await statusOf('pecas', pieceId)).toBe('publicada');
    expect(await line("SELECT COUNT(*) AS n FROM publicacoes WHERE peca_id = ? AND status = 'falhou'", pieceId)).toEqual({ n: 0 });
  });
});
