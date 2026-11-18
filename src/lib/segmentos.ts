// As contas da gravação em segmentos, puras: o Worker e o gravador da tela usam as mesmas.
// Medido em 05/11 pelo envio de gravação: WebM de 48 kbps transcreve até 24,9 MB, com falha intermitente perto disso. 120 s
// dão cerca de 720 KB e 25 s de fila, e uma falha perde dois minutos, não a entrevista.
export const SEGUNDOS_POR_SEGMENTO = 120;
/** Dois recorders juntos na virada: nenhuma palavra cai na emenda. */
export const SOBREPOSICAO_S = 1;
export const SEGUNDOS_POR_FATIA = 5;
export const TETO_SESSAO_S = 3 * 3600;
export const FATIA_MAX_BYTES = 256 * 1024;
export const MAX_SEGMENTOS = Math.ceil(TETO_SESSAO_S / SEGUNDOS_POR_SEGMENTO);
/** Quantas fatias tem um segmento inteiro. O último tem as que deu tempo de gravar. */
export const FATIAS_POR_SEGMENTO = Math.ceil((SEGUNDOS_POR_SEGMENTO + SOBREPOSICAO_S) / SEGUNDOS_POR_FATIA);

export const inicioDoSegmento = (n: number) => n * SEGUNDOS_POR_SEGMENTO;
/** O segmento que toca o segundo `t`: a mesma emenda do corte de palavras. */
export const segmentoDoTempo = (t: number) => Math.max(0, Math.floor((t - SOBREPOSICAO_S / 2) / SEGUNDOS_POR_SEGMENTO));

/** O que este segmento conta: cada palavra da sobreposição fica de um lado só da emenda. */
export function janelaDoSegmento(n: number, ultimo: number) {
  const emenda = (i: number) => inicioDoSegmento(i) + SOBREPOSICAO_S / 2;
  return { de: n === 0 ? 0 : emenda(n), ate: n === ultimo ? Infinity : emenda(n + 1) };
}

export interface Palavra { p: string; i: number; f: number }
export interface TrechoTempo { inicio: number; fim: number; texto: string; palavras: Palavra[] }
const dois = (n: number) => Math.round(n * 100) / 100;

/** Trechos do Whisper em tempo absoluto, sem as palavras da sobreposição que o outro segmento conta. */
export function deslocarTrechos(
  segmentos: { start: number; end: number; text: string; words?: { word: string; start: number; end: number }[] }[],
  inicio: number, janela: { de: number; ate: number },
): TrechoTempo[] {
  const dentro = (t: number) => t >= janela.de && t < janela.ate;
  const saida: TrechoTempo[] = [];
  for (const s of segmentos) {
    const texto = s.text.trim().normalize('NFC');
    const todas = (s.words ?? []).map((w) => ({ p: w.word, i: dois(w.start + inicio), f: dois(w.end + inicio) }));
    if (!todas.length) {
      if (dentro(s.start + inicio)) saida.push({ inicio: dois(s.start + inicio), fim: dois(s.end + inicio), texto, palavras: [] });
      continue;
    }
    const palavras = todas.filter((w) => dentro(w.i));
    if (!palavras.length) continue;
    saida.push({
      inicio: palavras[0].i, fim: palavras.at(-1)!.f, palavras,
      texto: palavras.length === todas.length ? texto : palavras.map((w) => w.p.trim()).join(' ').normalize('NFC'),
    });
  }
  return saida;
}

export interface Falta { de: number; ate: number }

/**
 * Os trechos que não chegaram, pelo número das fatias. O que falta só na sobreposição não é perda: o vizinho tem.
 * `ultimoSegmento`: o fim dele é desconhecido, então só conta buraco antes da última fatia que chegou.
 */
export function faltasDoSegmento(n: number, fatias: number[], ultimoSegmento: boolean): Falta[] {
  const tem = new Set(fatias);
  const total = ultimoSegmento ? Math.max(-1, ...fatias) + 1 : FATIAS_POR_SEGMENTO;
  const faltas: Falta[] = [];
  for (let f = 0; f < total; f++) {
    if (tem.has(f) || f * SEGUNDOS_POR_FATIA >= SEGUNDOS_POR_SEGMENTO) continue;
    const de = inicioDoSegmento(n) + f * SEGUNDOS_POR_FATIA;
    const ate = inicioDoSegmento(n) + Math.min((f + 1) * SEGUNDOS_POR_FATIA, SEGUNDOS_POR_SEGMENTO);
    const antes = faltas.at(-1);
    if (antes?.ate === de) antes.ate = ate;
    else faltas.push({ de, ate });
  }
  return faltas;
}

/** Até onde a gravação está salva sem buraco: "Salvo até mm:ss" só anda com a confirmação do servidor. */
export function salvoAte(confirmadas: ReadonlySet<string>, s = SEGUNDOS_POR_SEGMENTO, fatia = SEGUNDOS_POR_FATIA) {
  let tempo = 0;
  for (let n = 0; ; n++) {
    for (let f = 0; f * fatia < s; f++) {
      if (!confirmadas.has(`${n}/${f}`)) return tempo;
      tempo = n * s + Math.min((f + 1) * fatia, s);
    }
  }
}
