// Fase E: o que a tela de revisão consome. Contas para escolher na aprovação, fatos e pauta na peça completa, versão
// esperada na decisão. Inclui IDOR e papéis.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { cadastrar, req, seedConta, seedMembro, seedPauta, seedPeca, seedTenant, statusDe } from './helpers';

async function membro(papel: 'admin' | 'editor' | 'reporter' = 'editor') {
  const s = await cadastrar();
  const t = await seedTenant();
  await seedMembro(t, s.userId, papel);
  return { s, t };
}

describe('GET contas', () => {
  it('só as ativas do veículo, na ordem da conta padrão, sem token', async () => {
    const { s, t } = await membro('reporter');
    const simulada = await seedConta(t, 'simulada');
    const manual = await seedConta(t, 'manual');
    const removida = await seedConta(t, 'manual');
    await env.DB.prepare("UPDATE contas_sociais SET status = 'removida', token_enc = 'segredo' WHERE id = ?").bind(removida).run();
    await env.DB.prepare("UPDATE contas_sociais SET token_enc = 'segredo', provedor_ref = 'ref' WHERE id = ?").bind(manual).run();

    const res = await req(`/api/t/${t}/contas`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    const { contas } = await res.json<{ contas: Record<string, unknown>[] }>();
    expect(contas.map((c) => c.id)).toEqual([manual, simulada]);
    expect(contas[0]).toEqual({ id: manual, rede: 'instagram', modo: 'manual', nome: 'conta teste', external_id: null, status: 'ativa', provedor: null });
    expect(JSON.stringify(contas)).not.toContain('segredo');
  });

  it('IDOR: contas de outro veículo → 404', async () => {
    const { s } = await membro();
    const outro = await seedTenant();
    await seedConta(outro);
    expect((await req(`/api/t/${outro}/contas`, { cookie: s.cookie })).status).toBe(404);
  });
});

describe('GET pecas/:id: pauta e fatos', () => {
  it('fatos da pauta na ordem dela, com fonte e link do documento', async () => {
    const { s, t } = await membro('reporter');
    const { pautaId, fatos } = await seedPauta(t, 'em_producao');
    await env.DB.prepare("UPDATE pautas SET editoria = 'cidade', bairro = 'Centro' WHERE id = ?").bind(pautaId).run();
    const peca = await seedPeca(t, pautaId);

    const res = await req(`/api/t/${t}/pecas/${peca}`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    const corpo = await res.json<{ pauta: unknown; fatos: unknown[] }>();
    expect(corpo.pauta).toEqual({ titulo: 'Título da pauta', editoria: 'cidade', bairro: 'Centro', tipo_post: null, origem: 'monitor' });
    expect(corpo.fatos).toEqual(fatos.map((f) => ({ id: f.id, tipo: f.tipo, texto: f.texto, url: 'https://source.example/noticia', fonte: 'Fonte', evidencia: null, fonteTitulo: null, print: null })));
  });

  it('fato de outro veículo citado na pauta não aparece', async () => {
    const { s, t } = await membro();
    const outro = await seedTenant();
    const { fatos: alheios } = await seedPauta(outro);
    const { pautaId, fatos } = await seedPauta(t, 'em_producao');
    await env.DB.prepare('UPDATE pautas SET fato_ids_json = ? WHERE id = ?').bind(JSON.stringify([alheios[0].id, fatos[1].id]), pautaId).run();
    const peca = await seedPeca(t, pautaId);

    const corpo = await (await req(`/api/t/${t}/pecas/${peca}`, { cookie: s.cookie })).json<{ fatos: { id: string }[] }>();
    expect(corpo.fatos.map((f) => f.id)).toEqual([fatos[1].id]);
  });
});

describe('POST revisao com versão esperada', () => {
  it('versão diferente da exibida → 409 e nada muda; a mesma versão decide', async () => {
    const { s, t } = await membro('editor');
    const { pautaId } = await seedPauta(t, 'em_producao');
    const conta = await seedConta(t, 'manual');
    const peca = await seedPeca(t, pautaId, { versao: 2 });

    const velha = await req(`/api/t/${t}/pecas/${peca}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: conta, versao: 1 } });
    expect(velha.status).toBe(409);
    expect(await statusDe('pecas', peca)).toBe('revisao');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM decisoes WHERE peca_id = ?').bind(peca).first<{ n: number }>())?.n).toBe(0);

    expect((await req(`/api/t/${t}/pecas/${peca}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: conta, versao: 'dois' } })).status).toBe(400);

    const certa = await req(`/api/t/${t}/pecas/${peca}/revisao`, { cookie: s.cookie, body: { decisao: 'aprovar', contaId: conta, versao: 2 } });
    expect(certa.status).toBe(200);
    expect(await certa.json()).toEqual({ status: 'aprovada', modo: 'manual' });
  });

  it('sem versão segue aceitando (clientes antigos, curl)', async () => {
    const { s, t } = await membro('editor');
    const { pautaId } = await seedPauta(t, 'em_producao');
    const peca = await seedPeca(t, pautaId);
    const res = await req(`/api/t/${t}/pecas/${peca}/revisao`, { cookie: s.cookie, body: { decisao: 'rejeitar', motivo: 'velha' } });
    expect(res.status).toBe(200);
    expect(await statusDe('pecas', peca)).toBe('rejeitada');
    expect(await statusDe('pautas', pautaId)).toBe('descartada');
  });
});
