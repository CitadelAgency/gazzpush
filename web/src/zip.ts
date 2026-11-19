// Uncompressed ZIP ("store" method): the images are already JPEG, compressing again gains nothing. Pure, no DOM, for the
// desktop's "Download the images" (where there is no share-with-files) and for testing in the Worker's vitest.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Date and time in DOS format (the ZIP header's), in local time. */
function datesOf(d: Date) {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dia: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function zipFiles(files: { nome: string; dados: Uint8Array }[], when = new Date()): Uint8Array {
  const utf8 = new TextEncoder();
  const { hora: hour, dia: day } = datesOf(when);
  const localEntries: Uint8Array[] = [];
  const centralDirs: Uint8Array[] = [];
  let offset = 0;
  for (const a of files) {
    const name = utf8.encode(a.nome);
    const crc = crc32(a.dados);
    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);              // name in UTF-8
    l.setUint16(8, 0, true);                   // store
    l.setUint16(10, hour, true);
    l.setUint16(12, day, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, a.dados.length, true);
    l.setUint32(22, a.dados.length, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, hour, true);
    c.setUint16(14, day, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, a.dados.length, true);
    c.setUint32(24, a.dados.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);

    localEntries.push(local, a.dados);
    centralDirs.push(central);
    offset += local.length + a.dados.length;
  }
  const centralSize = centralDirs.reduce((n, x) => n + x.length, 0);
  const end = new Uint8Array(22);
  const f = new DataView(end.buffer);
  f.setUint32(0, 0x06054b50, true);
  f.setUint16(8, files.length, true);
  f.setUint16(10, files.length, true);
  f.setUint32(12, centralSize, true);
  f.setUint32(16, offset, true);

  const output = new Uint8Array(offset + centralSize + end.length);
  let i = 0;
  for (const part of [...localEntries, ...centralDirs, end]) { output.set(part, i); i += part.length; }
  return output;
}
