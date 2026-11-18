import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import type { Env } from '../env';

/**
 * Carimbo de tempo RFC 3161: o hash SHA-256 dos dados vai a uma autoridade de carimbo (TSA), que devolve um token
 * assinado com a hora dela. Qualquer pessoa confere depois, sem o app: `openssl ts -verify` com o certificado da TSA
 * (README, "Pacote de defesa"). Padrão: FreeTSA (gratuita, sem chave); `TSA_URL` troca (o e2e usa uma TSA falsa).
 */
export const TSA_PADRAO = 'https://freetsa.org/tsr';
export const urlTsa = (env: Env) => env.TSA_URL || TSA_PADRAO;

/**
 * A raiz confiável da FreeTSA (https://freetsa.org/files/cacert.pem, "Free TSA Root CA", válida até 2041; SHA-256
 * A6:37:9E:7C:EC:C0:5F:AA:3C:BF:07:60:13:D7:45:E3:27:BB:BA:A3:8C:0B:9A:F2:24:69:D4:70:1D:18:AA:BC). Outra autoridade
 * em TSA_URL pede a raiz dela em TSA_RAIZ (PEM ou DER em base64); sem ela, o carimbo não é aceito.
 */
const RAIZ_FREETSA = [
  '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',
  'OCXsxBxJpbmLGBx9ow6ZerlUxzws2AWv2pk=',
].join('');

export class ErroCarimbo extends Error {}

const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/** A raiz em que o certificado da TSA tem de encadear: TSA_RAIZ, ou a da FreeTSA quando a autoridade é a padrão. */
export function raizTsa(env: Env): pkijs.Certificate | null {
  const texto = env.TSA_RAIZ || (urlTsa(env) === TSA_PADRAO ? RAIZ_FREETSA : null);
  if (!texto) return null;
  const b64 = texto.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  return pkijs.Certificate.fromBER(buf(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
}

/** Pede o carimbo dos `dados`. Devolve a resposta da TSA (DER) e a hora dela; confere antes de devolver. */
export async function pedirCarimbo(env: Env, dados: Uint8Array): Promise<{ tsr: Uint8Array; em: string; tsa: string }> {
  const tsa = urlTsa(env);
  const raiz = raizTsa(env);
  if (!raiz) throw new ErroCarimbo('a autoridade de carimbo configurada não tem raiz confiável (TSA_RAIZ)');
  const nonce = crypto.getRandomValues(new Uint8Array(8));
  nonce[0] = (nonce[0] & 0x7f) | 0x01;   // inteiro positivo e sem zero à esquerda (DER mínimo)
  const pedido = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: await pkijs.MessageImprint.create('SHA-256', buf(dados)),
    certReq: true,
    nonce: new asn1js.Integer({ valueHex: buf(nonce) }),
  });
  let res: Response;
  try {
    res = await fetch(tsa, { method: 'POST', headers: { 'content-type': 'application/timestamp-query' }, body: pedido.toSchema().toBER(), signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new ErroCarimbo(`a autoridade de carimbo não respondeu (${String(e).slice(0, 120)})`);
  }
  if (!res.ok) throw new ErroCarimbo(`a autoridade de carimbo respondeu ${res.status}`);
  const tsr = new Uint8Array(await res.arrayBuffer());
  const v = await verificarCarimbo(tsr, dados, raiz, nonce);
  if (!v.ok) throw new ErroCarimbo(`o carimbo voltou sem conferir: ${v.motivo}`);
  return { tsr, em: v.em!, tsa };
}

const hex = (u: ArrayBuffer | Uint8Array) => [...new Uint8Array(u)].map((x) => x.toString(16).padStart(2, '0')).join('').replace(/^(00)+/, '');

/**
 * Confere o carimbo: a TSA concedeu; o hash carimbado é o destes dados; a assinatura bate com o certificado do token;
 * esse certificado encadeia na `raiz` confiável e é de carimbo de tempo (uso "timeStamping"); e o nonce é o do pedido
 * (resposta velha ou de outro pedido não passa). É o que o `openssl ts -verify -CAfile` faz.
 */
export async function verificarCarimbo(tsr: Uint8Array, dados: Uint8Array, raiz: pkijs.Certificate, nonce?: Uint8Array): Promise<{ ok: boolean; em?: string; motivo?: string }> {
  let resp: pkijs.TimeStampResp;
  try {
    resp = pkijs.TimeStampResp.fromBER(buf(tsr));
  } catch {
    return { ok: false, motivo: 'resposta ilegível' };
  }
  if (resp.status.status !== pkijs.PKIStatus.granted && resp.status.status !== pkijs.PKIStatus.grantedWithMods) return { ok: false, motivo: `recusado (status ${resp.status.status})` };
  if (!resp.timeStampToken) return { ok: false, motivo: 'sem token' };
  try {
    const sd = new pkijs.SignedData({ schema: resp.timeStampToken.content });
    const conteudo = sd.encapContentInfo.eContent;
    if (!conteudo) return { ok: false, motivo: 'token sem TSTInfo' };
    const info = pkijs.TSTInfo.fromBER(conteudo.getValue());
    if (nonce && (!info.nonce || hex(info.nonce.valueBlock.valueHexView) !== hex(nonce))) return { ok: false, motivo: 'o nonce não é o do pedido' };
    // extendedMode: o PKI.js devolve o certificado que assinou, ache ele pelo emissor e série ou pelo identificador
    // da chave (as duas formas do signerIdentifier, RFC 5652 §5.3).
    const r = await sd.verify({ signer: 0, data: buf(dados), trustedCerts: [raiz], checkChain: true, checkDate: info.genTime, extendedMode: true })
      .catch((e: unknown) => String((e as Error)?.message ?? e).slice(0, 120));
    if (typeof r === 'string' || !r.signatureVerified || !r.signerCertificate) {
      return { ok: false, motivo: `assinatura, hash ou cadeia até a raiz não conferem${typeof r === 'string' ? ` (${r})` : r.message ? ` (${r.message.slice(0, 120)})` : ''}` };
    }
    // RFC 3161 §2.3: o certificado da autoridade tem o uso estendido timeStamping, e só ele, numa extensão crítica.
    const ext = r.signerCertificate.extensions?.find((x) => x.extnID === '2.5.29.37');
    const eku = ext?.parsedValue as pkijs.ExtKeyUsage | undefined;
    if (!ext?.critical || !eku?.keyPurposes.includes('1.3.6.1.5.5.7.3.8')) return { ok: false, motivo: 'o certificado não é de carimbo de tempo (uso timeStamping em extensão crítica)' };
    return { ok: true, em: info.genTime.toISOString() };
  } catch (e) {
    return { ok: false, motivo: `não conferiu (${String(e).slice(0, 120)})` };
  }
}
