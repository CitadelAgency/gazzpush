// The Reels composition HTML (HyperFrames), pure and without imports: the Worker (src/lib/reels.ts) and the spike script
// (scripts/spike-reels.mjs, on plain Node) build the same composition.
/** How long each card stays on screen: 2 s, plus 0.35 s per word, between 2.5 and 7 s. The CTA is short, fixed copy. */
export const REELS_PACE = { base: 2, porPalavra: 0.35, minCard: 2.5, maxCard: 7, convite: 3.75, minTotal: 7.5, maxTotal: 60 } as const;
export const STEPS_REELS = [0.8, 1, 1.25] as const;
export type ReelsStep = (typeof STEPS_REELS)[number];
/** `seco`: straight cut. `manchete`: title, then the sentences, one by one. `folha`: the next card slides in. */
export const MOTIONS_REELS = ['manchete', 'folha', 'seco'] as const;
export type MotionReels = (typeof MOTIONS_REELS)[number];
export interface ReelsPace { passo: ReelsStep; movimento: MotionReels }
export const DEFAULT_PACE: ReelsPace = { passo: 1, movimento: 'manchete' };
/** The outgoing card stays underneath while the next one slides over it. */
const SHEET_S = 0.5;

const ms = (n: number) => Math.round(n * 1000) / 1000;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
export const totalReels = (times: number[]) => ms(times.reduce((a, b) => a + b, 0));

/** Each card's seconds, from the text shown on it. The total stays between 7.5 and 60 s, scaled proportionally. */
export function timesReels(cards: { layout?: string; titulo?: string; frases?: { texto: string; rotulo?: string }[] }[], step: number = DEFAULT_PACE.passo): number[] {
  const { base, porPalavra: perWord, minCard, maxCard, convite: invite, minTotal, maxTotal } = REELS_PACE;
  const raw = cards.map((c) => {
    if (c.layout === 'convite') return invite;
    // The carousel cover only shows its title.
    const text = c.layout === 'capa' ? c.titulo ?? '' : [c.titulo ?? '', ...(c.frases ?? []).flatMap((f) => [f.rotulo ?? '', f.texto])].join(' ');
    return Math.min(maxCard, Math.max(minCard, (base + perWord * words(text)) * step));
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  if (!sum) return [];
  const target = Math.min(maxTotal, Math.max(minTotal, sum));
  const times = raw.map((b) => ms((b * target) / sum));
  // Rounding must not take the total out of range.
  times[times.length - 1] = ms(times[times.length - 1] + ms(target) - totalReels(times));
  return times;
}

const take = (html: string, re: RegExp) => (html.match(re) ?? [])[1] ?? '';

/**
 * Prefixes each CSS rule of a card with the scene id: the templates use global selectors (`:root`, `header`, `.card`)
 * and, in the composition, each card is a scene on the same page. `.r916 X` becomes `#scene X` (the 9:16 rule comes after
 * the 4:5 one in the template and wins by order). The `@font-face` rules go separately (the same on every card).
 */
export function scopeCss(css: string, id: string) {
  let sources = '';
  const rules: string[] = [];
  for (const block of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const i = block.indexOf('{');
    if (i < 0) continue;
    const sel = block.slice(0, i).trim();
    const body = block.slice(i + 1);
    if (!sel) continue;
    if (sel.startsWith('@font-face')) { sources += `${sel}{${body}}\n`; continue; }
    const created = sel.split(',').map((s) => {
      s = s.trim();
      if (s === ':root' || s === 'body' || s === 'html') return `#${id}`;
      if (s === '*') return `#${id} *`;
      return `#${id} ${s.replace(/^html(\.[\w-]+)*\s+/, '').replace(/^\.r916\s+/, '')}`;
    }).join(', ');
    rules.push(`${created}{${body}}`);
  }
  return { fontes: sources, css: rules.join('\n') };
}

/** The tag sentences and items get in the 9:16 frame, so they enter one by one. */
export const SENTENCE_CLASS = 'frase-rl';

/** Card `i`'s entrance. Numbers never "count up": an intermediate value is not in the source, so no text moves. */
function inputCard(id: string, html: string, ini: number, each: number, motion: MotionReels, i: number, speech?: number[]): string[] {
  const anim = [`tl.fromTo('#${id} .art', { scale: 1.08 }, { scale: 1, duration: ${each}, ease: 'none' }, ${ini});`];
  if (i === 0) return anim;
  // With voice, the sentence is the subtitle: the approved text enters when it is spoken, in the area the 9:16 QA already measured.
  const caption = (speech ?? []).map((t, k) => `tl.fromTo('#${id} .${SENTENCE_CLASS}:nth-of-type(${k + 1}), #${id} .story-list li:nth-child(${k + 1})', { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power1.out' }, ${ms(t)});`);
  if (motion === 'seco') return [...anim, ...caption];
  if (motion === 'folha') return [...anim, `tl.fromTo('#${id}', { xPercent: 100 }, { xPercent: 0, duration: ${SHEET_S}, ease: 'power2.out' }, ${ini});`, ...caption];
  anim.push(`tl.fromTo('#${id} header', { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power1.out' }, ${ms(ini + 0.05)});`);
  const sentences = html.split(`class="${SENTENCE_CLASS}"`).length - 1;
  const items = html.includes('story-list') ? (html.match(/<li>/g) ?? []).length : 0;
  const n = sentences + items;
  if (speech?.length) return [...anim, `tl.fromTo('#${id} .location, #${id} h1', { y: 48, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }, ${ms(ini + 0.15)});`, ...caption];
  if (!n) return [...anim, `tl.fromTo('#${id} .story', { y: 48, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }, ${ms(ini + 0.15)});`];
  // All on screen by 60% of the card's time: the rest is for reading.
  const step = ms(Math.min(0.9, Math.max(0.25, (each * 0.6 - 0.75) / n)));
  const target = sentences ? `#${id} .${SENTENCE_CLASS}` : `#${id} .story-list li`;
  anim.push(
    `tl.fromTo('#${id} .location, #${id} h1', { y: 48, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }, ${ms(ini + 0.15)});`,
    `tl.fromTo('${target}', { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power1.out', stagger: ${step} }, ${ms(ini + 0.75)});`,
  );
  return anim;
}

/**
 * The HyperFrames composition (hyperframes-core skill contract): a root with `data-composition-id`, each card a `.clip`
 * with `data-start`/`data-duration`, a paused GSAP timeline at `window.__timelines["reels"]`. The art zooms in slowly in
 * all three motions. The first card is whole from frame 0 (only the art moves): whoever opens the Reels reads the
 * headline before any animation. No clocks, randomness or network. `tempos`: each card's seconds. `musica`: name of the
 * file the Container writes next to it. In `folha` the previous clip lasts a little longer, on another track (clips on
 * the same track do not overlap), and DOM order puts the new card on top. `voz`: the speech file and each sentence's
 * moment, per card; the voice plays at volume 1, and the music, if any, at 0.15.
 */
export function compositionReels(o: { cards: string[]; tempos: number[]; movimento: MotionReels; musica?: string | null; voz?: { arquivo: string; duracao: number; frases: number[][] } | null; gsap?: string; idioma?: 'pt-BR' | 'en' }): string {
  const duration = totalReels(o.tempos);
  let sources = '';
  let ini = 0;
  const styles: string[] = [];
  const scenes: string[] = [];
  const anim: string[] = [];
  o.cards.forEach((html, i) => {
    const id = `c${i + 1}`;
    const { fontes: f, css } = scopeCss(take(html, /<style>([\s\S]*?)<\/style>/), id);
    if (!sources) sources = f;
    styles.push(css);
    const article = take(html, /(<article[\s\S]*<\/article>)/);
    const each = o.tempos[i];
    const leftover = o.movimento === 'folha' && i < o.cards.length - 1 ? SHEET_S : 0;
    scenes.push(`<div id="${id}" class="clip cena" data-start="${ini}" data-duration="${ms(each + leftover)}" data-track-index="${o.movimento === 'folha' ? i % 2 : 0}">${article}</div>`);
    anim.push(...inputCard(id, html, ini, each, o.movimento, i, o.voz?.frases[i]));
    ini = ms(ini + each);
  });
  const audio = [
    o.musica ? `<audio id="musica" src="${o.musica}" data-start="0" data-duration="${duration}" data-volume="${o.voz ? 0.15 : 0.5}"></audio>` : '',
    o.voz ? `<audio id="voz" src="${o.voz.arquivo}" data-start="0" data-duration="${o.voz.duracao}" data-volume="1"></audio>` : '',
  ].filter(Boolean).join('\n');
  return `<!doctype html>
<html lang="${o.idioma ?? 'pt-BR'}" class="export r916">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1080, height=1920">
<script src="${o.gsap ?? 'gsap.min.js'}"></script>
<style>
${sources}
body { margin: 0; background: #000; }
#root { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; }
.cena { position: absolute; inset: 0; }
${styles.join('\n')}
</style>
</head>
<body>
<div id="root" data-composition-id="reels" data-start="0" data-width="1080" data-height="1920" data-duration="${duration}">
${scenes.join('\n')}
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
