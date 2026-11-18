// Material ao lado (o organizador de fontes do editor): o que o Worker e a tela precisam fazer igual. A checagem literal
// do recorte, os parágrafos do leitor, a busca sem acento e sem caixa e o "já está no texto". Funções puras, sem
// dependência de Worker nem de DOM (a tela importa daqui, como de doc.ts e revisor.ts).

export const TRECHO_MIN = 3;
/** O recorte de PDF vira evidência pela rota que já existe (`trechoParaEvidencia`), que pede 8 caracteres. */
export const TRECHO_MIN_DOCUMENTO = 8;
export const TRECHO_MAX = 2000;
export const NOTA_MAX = 500;
export const RECORTES_POR_TEXTO = 200;

/**
 * A normalização dos dois lados: todo espaço em branco (quebra de linha, tabulação, espaço não separável) vira um espaço,
 * sem espaço nas pontas. É a mesma de `aspasDoBloco` (apuracao.ts) e de `registrarApuracao`: o recorte que passa aqui é
 * achado pela conferência das aspas quando entra no texto, e nada mais é tolerado (nem acento, nem caixa, nem aspas).
 */
export const juntarEspacos = (s: string) => s.replace(/\s+/g, ' ').trim();

/** O trecho está, letra por letra, no texto guardado da fonte (só o espaço em branco pode diferir). */
export function trechoNaFonte(fonte: string, trecho: string): boolean {
  const t = juntarEspacos(trecho);
  return t.length >= TRECHO_MIN && juntarEspacos(fonte).includes(t);
}

/** Acima disso, o parágrafo do leitor é cortado em fim de frase (a página lida pelo Readability vem numa linha só). */
const PARAGRAFO_MAX = 900;

/**
 * O texto guardado da fonte em parágrafos, para o leitor ao lado: as linhas em branco separam; o parágrafo longo demais
 * é cortado em fim de frase. Cada parágrafo sai com os espaços juntos, e é um pedaço do texto guardado: a seleção feita
 * dentro dele passa em `trechoNaFonte`. O índice do parágrafo é o mesmo na busca e no leitor.
 */
export function paragrafosDaFonte(texto: string): string[] {
  const out: string[] = [];
  for (const bloco of texto.split(/\n\s*\n/)) {
    const p = juntarEspacos(bloco);
    if (!p) continue;
    if (p.length <= PARAGRAFO_MAX) { out.push(p); continue; }
    let atual = '';
    for (const frase of p.split(/(?<=[.!?…])\s+/)) {
      if (atual && atual.length + frase.length + 1 > PARAGRAFO_MAX) { out.push(atual); atual = ''; }
      atual = atual ? `${atual} ${frase}` : frase;
      // Frase sem ponto por milhares de caracteres (tabela, lista colada): corta onde der.
      while (atual.length > PARAGRAFO_MAX * 2) { out.push(atual.slice(0, PARAGRAFO_MAX)); atual = atual.slice(PARAGRAFO_MAX); }
    }
    if (atual) out.push(atual);
  }
  return out;
}

/** O trecho já está no texto salvo (os parágrafos de `paragrafos_json`)? Sai do texto salvo, não do documento vivo. */
export function noTexto(trecho: string, paragrafos: string[]): boolean {
  const t = juntarEspacos(trecho);
  return !!t && juntarEspacos(paragrafos.join(' ')).includes(t);
}

// ── busca ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Sem acento e em minúsculas, unidade por unidade do UTF-16 (o mesmo comprimento: as posições achadas valem no texto
 * original, e a tela marca o achado com `<mark>` no lugar certo).
 */
export function dobrar(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // Metade de um par substituto (emoji): fica como está, para não mudar o comprimento.
    if (c >= 0xd800 && c <= 0xdfff) { out += s[i]; continue; }
    out += (s[i].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() || s[i])[0];
  }
  return out;
}

export const BUSCA_MIN = 2;
export const BUSCA_MAX = 100;

/** As palavras procuradas: sem acento, sem caixa, de 2 letras ou mais, até 8. */
export const termosDaBusca = (q: string) => [...new Set(dobrar(juntarEspacos(q)).split(' ').filter((t) => t.length >= BUSCA_MIN))].slice(0, 8);

export interface Achado { trecho: string; marcas: [number, number][] }

const RAIO = 90;

/**
 * Todas as palavras procuradas estão no texto? Devolve o pedaço em volta da primeira que aparece (cortado em espaço),
 * com as posições de cada palavra achada dentro dele. Sem todas: null.
 */
export function acharNoTexto(texto: string, termos: string[]): Achado | null {
  if (!termos.length) return null;
  const plano = dobrar(texto);
  const primeiras = termos.map((t) => plano.indexOf(t));
  if (primeiras.some((i) => i < 0)) return null;
  const centro = Math.min(...primeiras);
  let de = Math.max(0, centro - RAIO);
  let ate = Math.min(texto.length, centro + RAIO * 2);
  if (de > 0) { const e = texto.indexOf(' ', de); if (e >= 0 && e < centro) de = e + 1; }
  if (ate < texto.length) { const e = texto.lastIndexOf(' ', ate); if (e > centro) ate = e; }
  const pedaco = plano.slice(de, ate);
  const marcas: [number, number][] = [];
  for (const t of termos) {
    for (let i = pedaco.indexOf(t); i >= 0; i = pedaco.indexOf(t, i + t.length)) marcas.push([i, i + t.length]);
  }
  // Marcas que se cruzam ("lic" e "licitação") viram uma.
  marcas.sort((a, b) => a[0] - b[0]);
  const juntas = marcas.reduce<[number, number][]>((js, m) => {
    const u = js.at(-1);
    if (u && m[0] <= u[1]) u[1] = Math.max(u[1], m[1]); else js.push([m[0], m[1]]);
    return js;
  }, []);
  const prefixo = de > 0 ? '…' : '', sufixo = ate < texto.length ? '…' : '';
  return { trecho: `${prefixo}${texto.slice(de, ate)}${sufixo}`, marcas: juntas.map(([i, f]) => [i + prefixo.length, f + prefixo.length]) };
}
