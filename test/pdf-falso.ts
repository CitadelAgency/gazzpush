// PDF mínimo de verdade (Helvetica, WinAnsi) para os testes de Worker e o e2e: uma lista de linhas por página. O
// pdf.js lê o texto dele como de qualquer PDF; acentos do português cabem no WinAnsi (Latin-1).
export function pdfFalso(paginas: string[][]): Uint8Array<ArrayBuffer> {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objs: string[] = [];
  const n = paginas.length;
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${paginas.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${n} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  paginas.forEach((linhas, i) => {
    const conteudo = `BT /F1 11 Tf 14 TL 50 780 Td ${linhas.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`;
  });
  let corpo = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = corpo.length;
    corpo += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = corpo.length;
  corpo += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  corpo += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Latin-1: um byte por caractere (o comprimento do stream e os offsets acima contam caracteres).
  const bytes = new Uint8Array(corpo.length);
  for (let i = 0; i < corpo.length; i++) bytes[i] = corpo.charCodeAt(i) & 0xff;
  return bytes;
}
