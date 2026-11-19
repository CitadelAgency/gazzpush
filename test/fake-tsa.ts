// A fake TSA (RFC 3161) for the Worker tests and the e2e server (web/e2e/fake-model.ts), built like a real one: a test
// root (CA) signs the TSA's certificate (EC P-256, "timeStamping" usage), and the TSA signs the token with WebCrypto.
// Its timestamp verifies through the app's own code (src/lib/timestamp.ts), with the root in TSA_RAIZ (RAIZ_FALSA). The
// keys are test-only: they sign nothing outside here. `desconhecida`: a TSA with a certificate generated on the spot
// (outside the trusted root), for the test that refuses a timestamp from an unknown authority.
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';

const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The test root (DER in base64): the tests' trusted root (TSA_RAIZ). */
export const FAKE_ROOT = 'MIIBTDCB9KADAgECAgEBMAoGCCqGSM49BAMCMB4xHDAaBgNVBAMME1JhaXogZmFsc2EgZGUgdGVzdGUwHhcNMjYwMTAxMDAwMDAwWhcNNDUxMjMxMDAwMDAwWjAeMRwwGgYDVQQDDBNSYWl6IGZhbHNhIGRlIHRlc3RlMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEJagPnp3GDe5TXpwnNDZ2O08Qv94U667YG0VCDGprH+rVjsrHiAAoS5J3/uHiTYbvZYpKykU38MIS98X+QtFQDaMjMCEwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDRwAwRAIgN8fKTtImXr9nOiO2xEsI9UjI5AdqLt0DirQJLQRhVLECICdJ/bkSPcy3+5AQNNKwaXAlZc4cF2tj3ok5lcPX/S0L';
/** The test TSA's certificate, signed by the root, and its key (PKCS #8). */
const FAKE_TSA = 'MIIBQjCB6qADAgECAgECMAoGCCqGSM49BAMCMB4xHDAaBgNVBAMME1JhaXogZmFsc2EgZGUgdGVzdGUwHhcNMjYwMTAxMDAwMDAwWhcNNDUxMjMxMDAwMDAwWjAdMRswGQYDVQQDDBJUU0EgZmFsc2EgZGUgdGVzdGUwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASyF6Cb3LVCuZXQ5B7/dAqfJi2czfO1slDFadKW/D0BtsOQmlRybYkaLgKPXDJgEbhadPUUzLomdFb+0L4uxBn7oxowGDAWBgNVHSUBAf8EDDAKBggrBgEFBQcDCDAKBggqhkjOPQQDAgNHADBEAiB/ynddobnGygE0euAt/3m6wdTz4UoWmroRY22Aip5CywIgPWEDguNePj6CI00pW9W0+kPJsgs4WDomv/GA4SVpHl4=';
const FAKE_KEY = 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgF8Rw4Agc1M69/WH1nVlRnPvVLh65pqCRIoTMc+K2KoShRANCAASyF6Cb3LVCuZXQ5B7/dAqfJi2czfO1slDFadKW/D0BtsOQmlRybYkaLgKPXDJgEbhadPUUzLomdFb+0L4uxBn7';
const EC = { name: 'ECDSA', namedCurve: 'P-256' } as const;

type Keys = { cert: pkijs.Certificate; privada: CryptoKey };
let fixed: Promise<Keys> | null = null;
let other: Promise<Keys> | null = null;

const fromRoot = async (): Promise<Keys> => ({
  cert: pkijs.Certificate.fromBER(buf(b64(FAKE_TSA))),
  privada: await crypto.subtle.importKey('pkcs8', buf(b64(FAKE_KEY)), EC, false, ['sign']),
});

/** A TSA with the same name, but a certificate and key generated on the spot: it does not chain to the trusted root. */
const generated = async (): Promise<Keys> => {
  const pair = await crypto.subtle.generateKey(EC, true, ['sign', 'verify']) as CryptoKeyPair;
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 2 });
  const name = new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: 'TSA falsa de teste' }) });
  cert.issuer.typesAndValues.push(name);
  cert.subject.typesAndValues.push(name);
  cert.notBefore.value = new Date(Date.now() - 86_400_000);
  cert.notAfter.value = new Date(Date.now() + 365 * 86_400_000);
  cert.extensions = [new pkijs.Extension({
    extnID: '2.5.29.37', critical: true,
    extnValue: new pkijs.ExtKeyUsage({ keyPurposes: ['1.3.6.1.5.5.7.3.8'] }).toSchema().toBER(false),
    parsedValue: new pkijs.ExtKeyUsage({ keyPurposes: ['1.3.6.1.5.5.7.3.8'] }),
  })];
  await cert.subjectPublicKeyInfo.importKey(pair.publicKey);
  await cert.sign(pair.privateKey, 'SHA-256');
  return { cert, privada: pair.privateKey };
};

/** A root and a TSA generated on the spot (to vary the certificate: an EKU without the critical flag). */
export interface Chain { raiz: pkijs.Certificate; tsa: Keys }
const cnName = (cn: string) => new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: cn }) });
export async function testChain(o: { ekuCritica?: boolean } = {}): Promise<Chain> {
  const [pr, pt] = await Promise.all([crypto.subtle.generateKey(EC, true, ['sign', 'verify']), crypto.subtle.generateKey(EC, true, ['sign', 'verify'])]) as CryptoKeyPair[];
  const cert = async (serial: number, subject: string, issuer: string, publicValue: CryptoKey, signs: CryptoKey, extensions: pkijs.Extension[]) => {
    const c = new pkijs.Certificate();
    c.version = 2;
    c.serialNumber = new asn1js.Integer({ value: serial });
    c.issuer.typesAndValues.push(cnName(issuer));
    c.subject.typesAndValues.push(cnName(subject));
    c.notBefore.value = new Date(Date.now() - 86_400_000);
    c.notAfter.value = new Date(Date.now() + 365 * 86_400_000);
    c.extensions = extensions;
    await c.subjectPublicKeyInfo.importKey(publicValue);
    await c.sign(signs, 'SHA-256');
    return c;
  };
  const bc = new pkijs.BasicConstraints({ cA: true });
  const root = await cert(1, 'Raiz gerada', 'Raiz gerada', pr.publicKey, pr.privateKey, [
    new pkijs.Extension({ extnID: '2.5.29.19', critical: true, extnValue: bc.toSchema().toBER(false), parsedValue: bc }),
  ]);
  const eku = new pkijs.ExtKeyUsage({ keyPurposes: ['1.3.6.1.5.5.7.3.8'] });
  const tsa = await cert(2, 'TSA gerada', 'Raiz gerada', pt.publicKey, pr.privateKey, [
    new pkijs.Extension({ extnID: '2.5.29.37', critical: o.ekuCritica ?? true, extnValue: eku.toSchema().toBER(false), parsedValue: eku }),
  ]);
  return { raiz: root, tsa: { cert: tsa, privada: pt.privateKey } };
}

/**
 * Answers a TimeStampReq (DER) with a signed TimeStampResp. `hora`: genTime (default: now). `desconhecida`: signs with
 * the TSA outside the root; `semNonce`: returns the token without the request's nonce; `cadeia`: signs with that chain's
 * TSA; `porChave`: the signer goes by key identifier (SHA-1 of the public key), not by issuer and serial.
 */
export async function timestamp(derRequest: Uint8Array, hour = new Date(), o: { desconhecida?: boolean; semNonce?: boolean; cadeia?: Chain; porChave?: boolean } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const { cert, privada: isPrivate } = o.cadeia ? o.cadeia.tsa : await (o.desconhecida ? (other ??= generated()) : (fixed ??= fromRoot()));
  const sid = o.porChave
    ? new asn1js.Primitive({ idBlock: { tagClass: 3, tagNumber: 0 }, valueHex: await crypto.subtle.digest('SHA-1', buf(new Uint8Array(cert.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView))) })
    : new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber });
  const request = pkijs.TimeStampReq.fromBER(buf(derRequest));
  const info = new pkijs.TSTInfo({
    version: 1,
    policy: '1.2.3.4.1',
    messageImprint: request.messageImprint,
    serialNumber: new asn1js.Integer({ valueHex: buf(crypto.getRandomValues(new Uint8Array(8))) }),
    genTime: hour,
    ...(request.nonce && !o.semNonce ? { nonce: request.nonce } : {}),
  });
  const sd = new pkijs.SignedData({
    version: 3,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: '1.2.840.113549.1.9.16.1.4',
      eContent: new asn1js.OctetString({ valueHex: info.toSchema().toBER(false) }),
    }),
    signerInfos: [new pkijs.SignerInfo({ version: o.porChave ? 3 : 1, sid })],
    certificates: [cert],
  });
  await sd.sign(isPrivate, 0, 'SHA-256');
  const resp = new pkijs.TimeStampResp({
    status: new pkijs.PKIStatusInfo({ status: pkijs.PKIStatus.granted }),
    timeStampToken: new pkijs.ContentInfo({ contentType: pkijs.ContentInfo.SIGNED_DATA, content: sd.toSchema(true) }),
  });
  return new Uint8Array(resp.toSchema().toBER(false));
}
