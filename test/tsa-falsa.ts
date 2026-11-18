// Autoridade de carimbo efêmera para os testes de verificação RFC 3161.
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';

const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const EC = { name: 'ECDSA', namedCurve: 'P-256' } as const;

type Chaves = { cert: pkijs.Certificate; privada: CryptoKey };
let outra: Promise<Chaves> | null = null;

/** Uma TSA com o mesmo nome, mas certificado e chave gerados na hora: não encadeia na raiz confiável. */
const gerada = async (): Promise<Chaves> => {
  const par = await crypto.subtle.generateKey(EC, true, ['sign', 'verify']) as CryptoKeyPair;
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 2 });
  const nome = new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: 'TSA falsa de teste' }) });
  cert.issuer.typesAndValues.push(nome);
  cert.subject.typesAndValues.push(nome);
  cert.notBefore.value = new Date(Date.now() - 86_400_000);
  cert.notAfter.value = new Date(Date.now() + 365 * 86_400_000);
  cert.extensions = [new pkijs.Extension({
    extnID: '2.5.29.37', critical: true,
    extnValue: new pkijs.ExtKeyUsage({ keyPurposes: ['1.3.6.1.5.5.7.3.8'] }).toSchema().toBER(false),
    parsedValue: new pkijs.ExtKeyUsage({ keyPurposes: ['1.3.6.1.5.5.7.3.8'] }),
  })];
  await cert.subjectPublicKeyInfo.importKey(par.publicKey);
  await cert.sign(par.privateKey, 'SHA-256');
  return { cert, privada: par.privateKey };
};

/** Uma raiz e uma TSA geradas na hora (para variar o certificado: EKU sem a marca de crítica). */
export interface Cadeia { raiz: pkijs.Certificate; tsa: Chaves }
const nomeCn = (cn: string) => new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: cn }) });
export async function cadeiaDeTeste(o: { ekuCritica?: boolean } = {}): Promise<Cadeia> {
  const [pr, pt] = await Promise.all([crypto.subtle.generateKey(EC, true, ['sign', 'verify']), crypto.subtle.generateKey(EC, true, ['sign', 'verify'])]) as CryptoKeyPair[];
  const cert = async (serial: number, sujeito: string, emissor: string, publica: CryptoKey, assina: CryptoKey, extensoes: pkijs.Extension[]) => {
    const c = new pkijs.Certificate();
    c.version = 2;
    c.serialNumber = new asn1js.Integer({ value: serial });
    c.issuer.typesAndValues.push(nomeCn(emissor));
    c.subject.typesAndValues.push(nomeCn(sujeito));
    c.notBefore.value = new Date(Date.now() - 86_400_000);
    c.notAfter.value = new Date(Date.now() + 365 * 86_400_000);
    c.extensions = extensoes;
    await c.subjectPublicKeyInfo.importKey(publica);
    await c.sign(assina, 'SHA-256');
    return c;
  };
  const bc = new pkijs.BasicConstraints({ cA: true });
  const raiz = await cert(1, 'Raiz gerada', 'Raiz gerada', pr.publicKey, pr.privateKey, [
    new pkijs.Extension({ extnID: '2.5.29.19', critical: true, extnValue: bc.toSchema().toBER(false), parsedValue: bc }),
  ]);
  const eku = new pkijs.ExtKeyUsage({ keyPurposes: ['1.3.6.1.5.5.7.3.8'] });
  const tsa = await cert(2, 'TSA gerada', 'Raiz gerada', pt.publicKey, pr.privateKey, [
    new pkijs.Extension({ extnID: '2.5.29.37', critical: o.ekuCritica ?? true, extnValue: eku.toSchema().toBER(false), parsedValue: eku }),
  ]);
  return { raiz, tsa: { cert: tsa, privada: pt.privateKey } };
}

/**
 * Responde a um TimeStampReq (DER) com um TimeStampResp assinado. `hora`: genTime (padrão: agora). `desconhecida`:
 * assina com a TSA fora da raiz; `semNonce`: devolve o token sem o nonce do pedido; `cadeia`: assina com a TSA dessa
 * cadeia; `porChave`: o assinante vai pelo identificador da chave (SHA-1 da chave pública), não por emissor e série.
 */
export async function carimbar(pedidoDer: Uint8Array, hora = new Date(), o: { desconhecida?: boolean; semNonce?: boolean; cadeia: Cadeia; porChave?: boolean }): Promise<Uint8Array<ArrayBuffer>> {
  const { cert, privada } = o.desconhecida ? await (outra ??= gerada()) : o.cadeia.tsa;
  const sid = o.porChave
    ? new asn1js.Primitive({ idBlock: { tagClass: 3, tagNumber: 0 }, valueHex: await crypto.subtle.digest('SHA-1', buf(new Uint8Array(cert.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView))) })
    : new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber });
  const pedido = pkijs.TimeStampReq.fromBER(buf(pedidoDer));
  const info = new pkijs.TSTInfo({
    version: 1,
    policy: '1.2.3.4.1',
    messageImprint: pedido.messageImprint,
    serialNumber: new asn1js.Integer({ valueHex: buf(crypto.getRandomValues(new Uint8Array(8))) }),
    genTime: hora,
    ...(pedido.nonce && !o.semNonce ? { nonce: pedido.nonce } : {}),
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
  await sd.sign(privada, 0, 'SHA-256');
  const resp = new pkijs.TimeStampResp({
    status: new pkijs.PKIStatusInfo({ status: pkijs.PKIStatus.granted }),
    timeStampToken: new pkijs.ContentInfo({ contentType: pkijs.ContentInfo.SIGNED_DATA, content: sd.toSchema(true) }),
  });
  return new Uint8Array(resp.toSchema().toBER(false));
}
