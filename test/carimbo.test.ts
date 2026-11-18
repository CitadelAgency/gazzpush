import { env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { pedirCarimbo, raizTsa, verificarCarimbo, ErroCarimbo, TSA_PADRAO } from '../src/lib/carimbo';
import { cadeiaDeTeste, carimbar, type Cadeia } from './tsa-falsa';

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
let cadeia: Cadeia;
const e = { ...env, TSA_URL: 'https://tsa.example/tsr' } as unknown as Env;
beforeAll(async () => {
  cadeia = await cadeiaDeTeste();
  e.TSA_RAIZ = btoa(String.fromCharCode(...new Uint8Array(cadeia.raiz.toSchema().toBER(false))));
});
const tsaQueResponde = (o: Partial<Parameters<typeof carimbar>[2]> = {}) =>
  (async (_u: RequestInfo | URL, init?: RequestInit) => new Response(await carimbar(new Uint8Array(init!.body as ArrayBuffer), new Date(), { cadeia, ...o }))) as typeof fetch;

describe('carimbo de tempo RFC 3161', () => {
  it('carimba, confere e recusa dados trocados', async () => {
    globalThis.fetch = tsaQueResponde();
    const dados = new TextEncoder().encode('manifesto');
    const c = await pedirCarimbo(e, dados);
    expect(c.tsa).toBe('https://tsa.example/tsr');
    expect(Date.now() - Date.parse(c.em)).toBeLessThan(60_000);
    const raiz = raizTsa(e)!;
    expect((await verificarCarimbo(c.tsr, dados, raiz)).ok).toBe(true);
    const outro = await verificarCarimbo(c.tsr, new TextEncoder().encode('manifesto trocado'), raiz);
    expect(outro.ok).toBe(false);
    const estragado = c.tsr.slice(); estragado[estragado.length - 10] ^= 0xff;
    expect((await verificarCarimbo(estragado, dados, raiz)).ok).toBe(false);
  });
  it('autoridade fora da raiz confiável (certificado autoassinado qualquer): recusado, com o motivo', async () => {
    globalThis.fetch = tsaQueResponde({ desconhecida: true });
    await expect(pedirCarimbo(e, new TextEncoder().encode('manifesto'))).rejects.toThrow(/cadeia até a raiz/);
  });
  it('resposta sem o nonce do pedido (resposta velha ou de outro pedido): recusada', async () => {
    globalThis.fetch = tsaQueResponde({ semNonce: true });
    await expect(pedirCarimbo(e, new TextEncoder().encode('manifesto'))).rejects.toThrow(/nonce/);
  });
  it('outra autoridade sem TSA_RAIZ: não pede o carimbo e diz por quê; a FreeTSA tem a raiz no código', async () => {
    let chamou = false;
    globalThis.fetch = (async () => { chamou = true; return new Response('x'); }) as typeof fetch;
    await expect(pedirCarimbo({ ...e, TSA_RAIZ: undefined } as Env, new Uint8Array([1]))).rejects.toThrow(/TSA_RAIZ/);
    expect(chamou).toBe(false);
    const freetsa = raizTsa({ ...env, TSA_URL: undefined, TSA_RAIZ: undefined } as unknown as Env);
    expect(freetsa?.subject.typesAndValues.map((t) => t.value.valueBlock.value)).toContain('Root CA');
    expect(TSA_PADRAO).toBe('https://freetsa.org/tsr');
  });
  it('TSA fora do ar: erro com motivo, nunca silêncio', async () => {
    globalThis.fetch = (async () => new Response('fora', { status: 503 })) as typeof fetch;
    await expect(pedirCarimbo(e, new Uint8Array([1]))).rejects.toThrow(ErroCarimbo);
  });
});

// ── revisão 2 (Codex, 03/11): o assinante pelo identificador da chave; o uso timeStamping em extensão crítica ────────

describe('revisão: certificado da autoridade', () => {
  const comCadeia = (c: Cadeia) => ({ ...e, TSA_RAIZ: btoa(String.fromCharCode(...new Uint8Array(c.raiz.toSchema().toBER(false)))) }) as unknown as Env;

  it('autoridade que identifica o assinante pela chave (RFC 5652 §5.3): o carimbo vale', async () => {
    const c = await cadeiaDeTeste();
    globalThis.fetch = tsaQueResponde({ cadeia: c, porChave: true });
    const r = await pedirCarimbo(comCadeia(c), new TextEncoder().encode('manifesto'));
    expect(r.tsr.length).toBeGreaterThan(100);
  });

  it('certificado com o uso timeStamping fora de extensão crítica (RFC 3161 §2.3): recusado, com o motivo', async () => {
    const c = await cadeiaDeTeste({ ekuCritica: false });
    globalThis.fetch = tsaQueResponde({ cadeia: c });
    await expect(pedirCarimbo(comCadeia(c), new TextEncoder().encode('manifesto'))).rejects.toThrow(/extensão crítica/);
  });
});
