// HTML da composição do Reels, compartilhado pelo renderizador e pelo Worker.
/** Quanto cada card fica na tela: 2 s, mais 0,35 s por palavra, entre 2,5 e 7 s. O convite é copy curta e fixa. */
export const RITMO_REELS = { base: 2, porPalavra: 0.35, minCard: 2.5, maxCard: 7, convite: 3.75, minTotal: 7.5, maxTotal: 60 } as const;
export const PASSOS_REELS = [0.8, 1, 1.25] as const;
export type PassoReels = (typeof PASSOS_REELS)[number];
/** `seco`: corte direto. `manchete`: título, depois as frases, uma a uma. `folha`: o card seguinte entra deslizando. */
export const MOVIMENTOS_REELS = ['manchete', 'folha', 'seco'] as const;
export type MovimentoReels = (typeof MOVIMENTOS_REELS)[number];
export interface RitmoReels { passo: PassoReels; movimento: MovimentoReels }
export const RITMO_PADRAO: RitmoReels = { passo: 1, movimento: 'manchete' };
/** O card que sai fica embaixo enquanto o seguinte desliza por cima. */
const FOLHA_S = 0.5;

const ms = (n: number) => Math.round(n * 1000) / 1000;
const palavras = (s: string) => s.split(/\s+/).filter(Boolean).length;
export const totalReels = (tempos: number[]) => ms(tempos.reduce((a, b) => a + b, 0));

/** Os segundos de cada card, pelo texto que aparece nele. O total fica entre 7,5 e 60 s, com ajuste proporcional. */
export function temposReels(cards: { layout?: string; titulo?: string; frases?: { texto: string; rotulo?: string }[] }[], passo: number = RITMO_PADRAO.passo): number[] {
  const { base, porPalavra, minCard, maxCard, convite, minTotal, maxTotal } = RITMO_REELS;
  const brutos = cards.map((c) => {
    if (c.layout === 'convite') return convite;
    // A capa do carrossel mostra só o título.
    const texto = c.layout === 'capa' ? c.titulo ?? '' : [c.titulo ?? '', ...(c.frases ?? []).flatMap((f) => [f.rotulo ?? '', f.texto])].join(' ');
    return Math.min(maxCard, Math.max(minCard, (base + porPalavra * palavras(texto)) * passo));
  });
  const soma = brutos.reduce((a, b) => a + b, 0);
  if (!soma) return [];
  const alvo = Math.min(maxTotal, Math.max(minTotal, soma));
  const tempos = brutos.map((b) => ms((b * alvo) / soma));
  // O arredondamento não pode tirar o total da faixa.
  tempos[tempos.length - 1] = ms(tempos[tempos.length - 1] + ms(alvo) - totalReels(tempos));
  return tempos;
}

const pegar = (html: string, re: RegExp) => (html.match(re) ?? [])[1] ?? '';

/**
 * Prefixa cada regra do CSS de um card com o id da cena: os templates usam seletores globais (`:root`, `header`,
 * `.card`) e, na composição, cada card é uma cena dentro da mesma página. `.r916 X` vira `#cena X` (a regra 9:16 vem
 * depois da de 4:5 no template e ganha pela ordem). As `@font-face` saem à parte (as mesmas em todos os cards).
 */
export function escoparCss(css: string, id: string) {
  let fontes = '';
  const regras: string[] = [];
  for (const bloco of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const i = bloco.indexOf('{');
    if (i < 0) continue;
    const sel = bloco.slice(0, i).trim();
    const corpo = bloco.slice(i + 1);
    if (!sel) continue;
    if (sel.startsWith('@font-face')) { fontes += `${sel}{${corpo}}\n`; continue; }
    const novo = sel.split(',').map((s) => {
      s = s.trim();
      if (s === ':root' || s === 'body' || s === 'html') return `#${id}`;
      if (s === '*') return `#${id} *`;
      return `#${id} ${s.replace(/^html(\.[\w-]+)*\s+/, '').replace(/^\.r916\s+/, '')}`;
    }).join(', ');
    regras.push(`${novo}{${corpo}}`);
  }
  return { fontes, css: regras.join('\n') };
}

/** Marca que a frase e o item ganham no quadro 9:16, para entrar um a um. */
export const CLASSE_FRASE = 'frase-rl';

/** A entrada do card `i`. Número nunca "conta": valor intermediário não está na fonte, então nada mexe em texto. */
function entradaDoCard(id: string, html: string, ini: number, cada: number, movimento: MovimentoReels, i: number, fala?: number[]): string[] {
  const anim = [`tl.fromTo('#${id} .art', { scale: 1.08 }, { scale: 1, duration: ${cada}, ease: 'none' }, ${ini});`];
  if (i === 0) return anim;
  // Com voz, a frase é a legenda: o texto aprovado entra na hora em que é dito, na área que o QA 9:16 já mediu.
  const legenda = (fala ?? []).map((t, k) => `tl.fromTo('#${id} .${CLASSE_FRASE}:nth-of-type(${k + 1}), #${id} .story-list li:nth-child(${k + 1})', { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power1.out' }, ${ms(t)});`);
  if (movimento === 'seco') return [...anim, ...legenda];
  if (movimento === 'folha') return [...anim, `tl.fromTo('#${id}', { xPercent: 100 }, { xPercent: 0, duration: ${FOLHA_S}, ease: 'power2.out' }, ${ini});`, ...legenda];
  anim.push(`tl.fromTo('#${id} header', { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power1.out' }, ${ms(ini + 0.05)});`);
  const frases = html.split(`class="${CLASSE_FRASE}"`).length - 1;
  const itens = html.includes('story-list') ? (html.match(/<li>/g) ?? []).length : 0;
  const n = frases + itens;
  if (fala?.length) return [...anim, `tl.fromTo('#${id} .location, #${id} h1', { y: 48, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }, ${ms(ini + 0.15)});`, ...legenda];
  if (!n) return [...anim, `tl.fromTo('#${id} .story', { y: 48, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }, ${ms(ini + 0.15)});`];
  // Todas na tela até 60% do tempo do card: o resto é para ler.
  const passo = ms(Math.min(0.9, Math.max(0.25, (cada * 0.6 - 0.75) / n)));
  const alvo = frases ? `#${id} .${CLASSE_FRASE}` : `#${id} .story-list li`;
  anim.push(
    `tl.fromTo('#${id} .location, #${id} h1', { y: 48, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }, ${ms(ini + 0.15)});`,
    `tl.fromTo('${alvo}', { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power1.out', stagger: ${passo} }, ${ms(ini + 0.75)});`,
  );
  return anim;
}

/**
 * A composição HyperFrames (contrato da skill hyperframes-core): raiz com `data-composition-id`, cada card um `.clip`
 * com `data-start`/`data-duration`, um timeline GSAP pausado em `window.__timelines["reels"]`. A arte aproxima devagar
 * nos três movimentos. O primeiro card fica inteiro desde o frame 0 (só a arte anda): quem abre o Reels lê a manchete
 * antes de qualquer animação. Nada de relógio, aleatório ou rede. `tempos`: os segundos de cada card. `musica`: nome do
 * arquivo que o Container grava ao lado. Na `folha` o clipe anterior dura mais um pouco, em outra trilha (clipes da
 * mesma trilha não se sobrepõem), e a ordem no DOM deixa o card novo por cima. `voz`: o arquivo da fala e o momento de
 * cada frase, por card; a voz toca com volume 1, e a música, se houver, fica em 0,15.
 */
export function composicaoReels(o: { cards: string[]; tempos: number[]; movimento: MovimentoReels; musica?: string | null; voz?: { arquivo: string; duracao: number; frases: number[][] } | null; gsap?: string; idioma?: 'pt-BR' | 'en' }): string {
  const duracao = totalReels(o.tempos);
  let fontes = '';
  let ini = 0;
  const estilos: string[] = [];
  const cenas: string[] = [];
  const anim: string[] = [];
  o.cards.forEach((html, i) => {
    const id = `c${i + 1}`;
    const { fontes: f, css } = escoparCss(pegar(html, /<style>([\s\S]*?)<\/style>/), id);
    if (!fontes) fontes = f;
    estilos.push(css);
    const artigo = pegar(html, /(<article[\s\S]*<\/article>)/);
    const cada = o.tempos[i];
    const sobra = o.movimento === 'folha' && i < o.cards.length - 1 ? FOLHA_S : 0;
    cenas.push(`<div id="${id}" class="clip cena" data-start="${ini}" data-duration="${ms(cada + sobra)}" data-track-index="${o.movimento === 'folha' ? i % 2 : 0}">${artigo}</div>`);
    anim.push(...entradaDoCard(id, html, ini, cada, o.movimento, i, o.voz?.frases[i]));
    ini = ms(ini + cada);
  });
  const audio = [
    o.musica ? `<audio id="musica" src="${o.musica}" data-start="0" data-duration="${duracao}" data-volume="${o.voz ? 0.15 : 0.5}"></audio>` : '',
    o.voz ? `<audio id="voz" src="${o.voz.arquivo}" data-start="0" data-duration="${o.voz.duracao}" data-volume="1"></audio>` : '',
  ].filter(Boolean).join('\n');
  return `<!doctype html>
<html lang="${o.idioma ?? 'pt-BR'}" class="export r916">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1080, height=1920">
<script src="${o.gsap ?? 'gsap.min.js'}"></script>
<style>
${fontes}
body { margin: 0; background: #000; }
#root { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; }
.cena { position: absolute; inset: 0; }
${estilos.join('\n')}
</style>
</head>
<body>
<div id="root" data-composition-id="reels" data-start="0" data-width="1080" data-height="1920" data-duration="${duracao}">
${cenas.join('\n')}
${audio}
</div>
<script>
const tl = gsap.timeline({ paused: true });
${anim.join('\n')}
window.__timelines["reels"] = tl;
</script>
</body>
</html>`;
}
