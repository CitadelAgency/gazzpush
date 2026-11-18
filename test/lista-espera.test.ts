// Lista de espera: pública, sem conta. Não pode revelar quem já está nela, nem guardar o IP, nem encher por abuso.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { LIMITE_POR_HORA, lerCadastro } from '../src/lib/listaEspera';
import { PLANOS } from '../src/lib/planos';
import { PLANOS as TABELA } from '../src/lib/planosTabela';
import { req } from './helpers';

const IP = '203.0.113.7';
const cadastrar = (body: unknown, ip = IP, headers: Record<string, string> = {}, origin?: string) =>
  req('/api/lista-espera', { method: 'POST', body, origin, headers: { 'cf-connecting-ip': ip, ...headers } });
const linhas = () => env.DB.prepare('SELECT * FROM lista_espera ORDER BY email').all<Record<string, string | null>>().then((r) => r.results);

beforeEach(async () => { await env.DB.prepare('DELETE FROM lista_espera').run(); });

describe('POST /api/lista-espera', () => {
  it('guarda sem sessão, com e-mail limpo, e não guarda o IP', async () => {
    const r = await cadastrar({ email: '  Campo@EXAMPLE.TEST ', nome: ' Campo ', plano: 'pagina' }, IP, { 'x-idioma': 'en' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    const [l] = await linhas();
    expect(l).toMatchObject({ email: 'campo@example.test', nome: 'Campo', plano: 'pagina', idioma: 'en' });
    expect(JSON.stringify(l)).not.toContain(IP);
  });

  it('e-mail repetido: mesma resposta, sem trocar o primeiro cadastro', async () => {
    const a = await cadastrar({ email: 'a@example.test', plano: 'portal' });
    const b = await cadastrar({ email: 'A@example.test', plano: 'pagina' });
    expect([b.status, await b.json()]).toEqual([a.status, await a.json()]);
    expect(await linhas()).toHaveLength(1);
    expect((await linhas())[0].plano).toBe('portal');
  });

  it('nome e plano são opcionais; só plano pago se escolhe', async () => {
    await cadastrar({ email: 'a@example.test', nome: '', plano: '' });
    await cadastrar({ email: 'b@example.test', plano: 'cortesia' });
    await cadastrar({ email: 'c@example.test', plano: 'teste' });
    expect((await linhas()).map((l) => [l.nome, l.plano])).toEqual([[null, null], [null, null], [null, null]]);
  });

  it.each([['sem e-mail', {}], ['sem domínio', { email: 'a@b' }], ['com espaço', { email: 'a b@example.test' }], ['longo demais', { email: `${'a'.repeat(250)}@example.test` }], ['tipo errado', { email: 5 }], ['corpo que não é objeto', 'x']])('recusa %s', async (_, corpo) => {
    const r = await cadastrar(corpo);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ erro: 'Confira o e-mail: ele parece incompleto.' });
    expect(await linhas()).toHaveLength(0);
  });

  it('JSON quebrado não derruba a rota', async () => {
    const r = await req('/api/lista-espera', { cru: { corpo: '{', tipo: 'application/json' } });
    expect(r.status).toBe(400);
  });

  it('a mensagem de erro segue o idioma da tela', async () => {
    const r = await cadastrar({}, IP, { 'x-idioma': 'en' });
    expect(await r.json()).toEqual({ erro: 'Check the email: it looks incomplete.' });
  });

  it('isca preenchida: resposta de sempre, nada guardado', async () => {
    const r = await cadastrar({ email: 'robo@example.test', site: 'https://spam.example' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(await linhas()).toHaveLength(0);
  });

  it('outra origem não entra', async () => {
    const r = await cadastrar({ email: 'a@example.test' }, IP, {}, 'https://other.example');
    expect(r.status).toBe(403);
    expect(await linhas()).toHaveLength(0);
  });

  it('o limite é por IP, e o IP vizinho segue entrando', async () => {
    for (let i = 0; i < LIMITE_POR_HORA; i++) expect((await cadastrar({ email: `p${i}@example.test` })).status).toBe(200);
    expect((await cadastrar({ email: 'mais@example.test' })).status).toBe(429);
    expect((await cadastrar({ email: 'vizinho@example.test' }, '203.0.113.8')).status).toBe(200);
    expect(await linhas()).toHaveLength(LIMITE_POR_HORA + 1);
  });

  it('depois de uma hora, o limite libera', async () => {
    for (let i = 0; i < LIMITE_POR_HORA; i++) await cadastrar({ email: `p${i}@example.test` });
    await env.DB.prepare("UPDATE lista_espera SET created_at = datetime('now', '-61 minutes')").run();
    expect((await cadastrar({ email: 'depois@example.test' })).status).toBe(200);
  });
});

describe('tabela de preços', () => {
  it('planos.ts e a tabela da página pública são o mesmo objeto', () => {
    expect(PLANOS).toBe(TABELA);
  });

  it('nome longo é cortado, não recusado', () => {
    expect(lerCadastro({ email: 'a@example.test', nome: 'x'.repeat(200) })?.nome).toHaveLength(80);
  });
});
