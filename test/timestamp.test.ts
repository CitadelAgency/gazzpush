import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { requestTimestamp, rootTsa, verifyTimestamp, TimestampError, DEFAULT_TSA } from '../src/lib/timestamp';
import { FAKE_ROOT, testChain, timestamp, type Chain } from './fake-tsa';

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
const e = { ...env, TSA_URL: 'https://tsa.example/tsr', TSA_RAIZ: FAKE_ROOT } as unknown as Env;
const tsaThatAnswers = (o: Parameters<typeof timestamp>[2] = {}) =>
  (async (_u: RequestInfo | URL, init?: RequestInit) => new Response(await timestamp(new Uint8Array(init!.body as ArrayBuffer), new Date(), o))) as typeof fetch;

describe('RFC 3161 timestamp', () => {
  it('stamps, verifies, and refuses swapped data', async () => {
    globalThis.fetch = tsaThatAnswers();
    const data = new TextEncoder().encode('manifesto');
    const c = await requestTimestamp(e, data);
    expect(c.tsa).toBe('https://tsa.example/tsr');
    expect(Date.now() - Date.parse(c.em)).toBeLessThan(60_000);
    const root = rootTsa(e)!;
    expect((await verifyTimestamp(c.tsr, data, root)).ok).toBe(true);
    const other = await verifyTimestamp(c.tsr, new TextEncoder().encode('manifesto trocado'), root);
    expect(other.ok).toBe(false);
    const broken = c.tsr.slice(); broken[broken.length - 10] ^= 0xff;
    expect((await verifyTimestamp(broken, data, root)).ok).toBe(false);
  });
  it('authority outside the trusted root (any self-signed certificate): refused, with the reason', async () => {
    globalThis.fetch = tsaThatAnswers({ desconhecida: true });
    await expect(requestTimestamp(e, new TextEncoder().encode('manifesto'))).rejects.toThrow(/cadeia até a raiz/);
  });
  it("response without the request's nonce (old response or from another request): refused", async () => {
    globalThis.fetch = tsaThatAnswers({ semNonce: true });
    await expect(requestTimestamp(e, new TextEncoder().encode('manifesto'))).rejects.toThrow(/nonce/);
  });
  it("another authority without TSA_RAIZ: doesn't request the timestamp and says why; FreeTSA has the root in code", async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response('x'); }) as typeof fetch;
    await expect(requestTimestamp({ ...e, TSA_RAIZ: undefined } as Env, new Uint8Array([1]))).rejects.toThrow(/TSA_RAIZ/);
    expect(called).toBe(false);
    const freetsa = rootTsa({ ...env, TSA_URL: undefined, TSA_RAIZ: undefined } as unknown as Env);
    expect(freetsa?.subject.typesAndValues.map((t) => t.value.valueBlock.value)).toContain('Root CA');
    expect(DEFAULT_TSA).toBe('https://freetsa.org/tsr');
  });
  it('TSA down: error with a reason, never silence', async () => {
    globalThis.fetch = (async () => new Response('fora', { status: 503 })) as typeof fetch;
    await expect(requestTimestamp(e, new Uint8Array([1]))).rejects.toThrow(TimestampError);
  });
});

// ── review 2 (Codex, 03/11): the signer by key identifier; timeStamping usage in a critical extension ────────

describe('review: authority certificate', () => {
  const withChain = (c: Chain) => ({ ...e, TSA_RAIZ: btoa(String.fromCharCode(...new Uint8Array(c.raiz.toSchema().toBER(false)))) }) as unknown as Env;

  it('authority that identifies the signer by key (RFC 5652 §5.3): the timestamp is valid', async () => {
    const c = await testChain();
    globalThis.fetch = tsaThatAnswers({ cadeia: c, porChave: true });
    const r = await requestTimestamp(withChain(c), new TextEncoder().encode('manifesto'));
    expect(r.tsr.length).toBeGreaterThan(100);
  });

  it('certificate with the timeStamping use outside a critical extension (RFC 3161 §2.3): refused, with the reason', async () => {
    const c = await testChain({ ekuCritica: false });
    globalThis.fetch = tsaThatAnswers({ cadeia: c });
    await expect(requestTimestamp(withChain(c), new TextEncoder().encode('manifesto'))).rejects.toThrow(/extensão crítica/);
  });
});
