// ZIP sem compressão (método "store"): as imagens já são JPEG, comprimir de novo não ganha nada. Puro, sem DOM, para
// o "Baixar as imagens" do computador (onde não há compartilhar com arquivos) e para testar no vitest do Worker.

const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(dados: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = TABELA[(c ^ dados[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Data e hora no formato do DOS (o do cabeçalho do ZIP), em horário local. */
function dataDos(d: Date) {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dia: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function zipar(arquivos: { nome: string; dados: Uint8Array }[], quando = new Date()): Uint8Array {
  const utf8 = new TextEncoder();
  const { hora, dia } = dataDos(quando);
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let deslocamento = 0;
  for (const a of arquivos) {
    const nome = utf8.encode(a.nome);
    const crc = crc32(a.dados);
    const local = new Uint8Array(30 + nome.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);              // nome em UTF-8
    l.setUint16(8, 0, true);                   // store
    l.setUint16(10, hora, true);
    l.setUint16(12, dia, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, a.dados.length, true);
    l.setUint32(22, a.dados.length, true);
    l.setUint16(26, nome.length, true);
    local.set(nome, 30);

    const central = new Uint8Array(46 + nome.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, hora, true);
    c.setUint16(14, dia, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, a.dados.length, true);
    c.setUint32(24, a.dados.length, true);
    c.setUint16(28, nome.length, true);
    c.setUint32(42, deslocamento, true);
    central.set(nome, 46);

    locais.push(local, a.dados);
    centrais.push(central);
    deslocamento += local.length + a.dados.length;
  }
  const tamanhoCentral = centrais.reduce((n, x) => n + x.length, 0);
  const fim = new Uint8Array(22);
  const f = new DataView(fim.buffer);
  f.setUint32(0, 0x06054b50, true);
  f.setUint16(8, arquivos.length, true);
  f.setUint16(10, arquivos.length, true);
  f.setUint32(12, tamanhoCentral, true);
  f.setUint32(16, deslocamento, true);

  const saida = new Uint8Array(deslocamento + tamanhoCentral + fim.length);
  let i = 0;
  for (const parte of [...locais, ...centrais, fim]) { saida.set(parte, i); i += parte.length; }
  return saida;
}
