# Distribution

Reporting that nobody sees does not hold anyone to account. Distribution turns verified facts into Instagram
carousels and Reels in the outlet's own visual identity, without third-party photos and without loosening the rule
that every sentence points to a fact. Proof cards put the evidence itself on screen: a literal passage from a document,
a side-by-side comparison, a timeline. This page covers how pieces look and are rendered; the flow that produces and
approves them is in [Newsroom pipeline](newsroom-pipeline.md).

Routes are relative to `/api/t/:tenantId`.

## Cards

A carousel is a sequence of cards rendered from HTML templates (`src/templates/card.html`, `src/templates/convite.html`)
by Browser Rendering (`src/lib/render.ts`). Templates and fonts are bundled with the Worker, so rendering makes no
external request.

Layouts (`LAYOUTS` in `src/lib/cards.ts`): `capa` (cover), `texto`, `citacao` (quote), `numero` (number), `lista`
(list), `documento`, `comparacao`, `linha_do_tempo` (timeline) and `convite` (call to action). Text limits per layout
are in `LIMITES`. A layout QA (`src/lib/qaLayout.ts`) measures every card (1080×1350 for carousels, 1080×1920 for Reels) for
overflow, overlap, fonts and images, and fails a card with the reason on the card itself.

### Proof cards

- **Document**: the document's name and a passage copied word for word from the fact, set in type. There is no image
  of the paper; source and date on the card come from the sentence's fact, and `validar` rejects a passage that is not
  literal. "Shorten to fit" is not offered, because a literal passage is not rewritten.
- **Comparison**: two sides. **Timeline**: 2 to 4 moments.
- In both, each sentence carries a mandatory label of up to 24 characters that goes through the same number and date
  checks as the text.

### Watermark

The outlet's logo, or its handle when there is no logo, semi-transparent (`src/lib/marcaDagua.ts`). The same HTML is
used by the renderer and the in-app preview.

## Templates and compositions

Up to six active templates per outlet (`MAX_ESTILOS`), under **Brand › Templates** (`/estilos`, `src/lib/estilos.ts`).
A template is a catalog choice, not free design: composition, title box, role of the three colors, illustration
technique, Reels pacing, and a suggested sequence of up to 6 layouts for the drafting model.

- **Compositions** (`COMPOSICOES` in `src/lib/estilo.ts`): `padrao`, `tarja`, `coluna`, `cartaz` (poster, no artwork)
  and `primeira-pagina` (front page). They apply to every layout except the call-to-action card. In the non-default
  compositions all text sits on flat color, so QA also measures contrast: below 4.5:1 (`CONTRASTE_MINIMO`) the card
  fails.
- **Choosing a template.** A piece picks its template by post type, then by words in the title and summary (up to 8),
  then by section, then the outlet default. With no template, the default look applies.
- **Frozen at birth.** A piece stores its template plus a copy of colors, fonts, logo, watermark and signature in
  `conteudo_json.estilo`. Changing the template or the brand later does not change it: review shows "Template changed"
  or "Brand changed" with **Apply**, which creates a new version through editing. Published pieces never change.
  Rewriting keeps the template. Archived templates keep applying to pieces already created with them.
- **Copy from another outlet** (`POST /estilos/copiar`): admin in both outlets; `404` if not a member of the source.
  Copies name, scope and parameters with a new id; sponsors are not copied and the copy never becomes the default.

## Illustration

Pieces use generated artwork in a print technique, never a third-party photo (`src/lib/ilustrar.ts`).

- **Techniques** (`TECNICAS`): `xilogravura` (woodcut), `reticula` (halftone, the default `TECNICA_PADRAO`),
  `nanquim` (ink) or `referencia` ("brand image only": follows the outlet's reference image without naming a
  technique; without a reference image it falls back to halftone).
- **Providers.** Image editing with Grok Imagine through **Kie** or **fal**, chosen per outlet under **AI keys**. They
  need a reference image: the outlet's brand reference, then `referencias/<tecnica>.png` in R2. Without either, Workers
  AI (`flux-1-schnell`) generates from a text description of the technique.
- **Image QA** (`qaImagem`) uses a vision model to reject unusable images.
- **Another illustration** (`POST /pecas/:id/cards/:cardId/ilustracao`): up to 3 per card (`MAX_ILUSTRACOES_CARD`). The
  scene comes from the card's text, or from the piece's scene on the cover. The chosen one is saved with "Save and
  check". At render time a photo beats the card's illustration, which beats the piece's. Call-to-action, document and
  poster cards show no illustration.
- **Cost.** Every image counts toward `pecas.custo_usd`, bounded by `MAX_CUSTO_PECA_USD`; when the next image would pass
  the ceiling, the piece falls back to the default art. Not counted as a post in plan limits.

### Photos from the phone

`POST /pecas/:id/fotos`: up to 2 MB per photo (`FOTO_MAX_BYTES`), JPEG, resized in the browser. A new photo requires
stating who took it and who owns the rights (`AUTOR_FOTO_MAX` 80 characters). Framing uses a catalog of focal points,
not free positioning.

## Reels

A Reels is the carousel animated in 9:16, without narration by default. The same card templates, with the `r916`
class, become a HyperFrames composition (`src/lib/reelsHtml.ts`), and the Reels container (`container/reels/`:
HyperFrames, headless Chrome and FFmpeg) returns a 1080×1920 MP4 stored in R2. In review, **Make Reels** opens the
Reels screen (`/t/:veiculo/p/:peca/reels`); the Reels becomes a new piece (format `reels`) that goes through
**To approve** and publishing like any other (`POST /pecas/:id/reels`).

- **No empty first frame.** The first frame already shows logo and title; only the cover's artwork animates in. The
  cover is saved as a JPEG in R2 and sent as `cover_url`; without it, `thumb_offset`.
- **Pacing** (`RITMO_REELS`): each card stays 2 s plus 0.35 s per word, between 2.5 and 7 s; the call-to-action card
  3.75 s; total between 7.5 and 60 s, scaled proportionally. Step multiplier (`PASSOS_REELS`): 0.8, 1 or 1.25. Motion
  (`MOVIMENTOS_REELS`): `manchete`, `folha`, `seco`. A template stores step and motion in `params.reels`, and the Reels
  screen can override them for one Reels. Longer Reels use proportionally more container time.

### Container requirements

1. **Workers Paid plan**: Containers do not run on the free plan.
2. **Docker on the deploying machine.** `npm run deploy` builds `container/reels/Dockerfile` and pushes it to
   Cloudflare's registry.
3. The first deploy creates the `ReelsContainer` Durable Object (migration `v1` in `wrangler.jsonc`) and the container
   application. Check with `npx wrangler containers list` and `npx wrangler containers images list`.
4. Instance `standard-3` (2 vCPU, 8 GiB), up to 3 at once (`max_instances`). Render time is recorded in the
   `peca.reels` event (`tempoMs`).

**Local development.** `wrangler dev` does not start containers on Windows, so `wrangler.jsonc` disables them in dev
(`dev.enable_containers: false`). Run the same container in Docker and point the Worker at it:

```sh
cd container/reels && docker build -t redacao-reels . && docker run --rm -d --name reels -p 127.0.0.1:8080:8080 --cpus 2 redacao-reels
# in .dev.vars: REELS_URL_LOCAL=http://localhost:8080   (then: npm run dev)
```

On Linux or WSL with Docker, `npx wrangler dev --enable-containers` starts the container through `ReelsContainer`,
without the variable. Without any of this, everything works except assembling the video; the Reels fails with the
reason on screen.

> The container installs GSAP, which ships under its own no-charge license (not an open-source license). It is not
> vendored in this repository; installing the container accepts GSAP's terms.

### Music library

The repository ships no music. The library is short and lives in the `redacao-media` R2 bucket, curated by the
operator, and applies to every outlet on the install (`src/lib/musica.ts`).

1. Only use tracks whose license allows **commercial use on social media** and does **not require credit** (Reels
   captions carry no music credit; a track with `"exigeCredito": true` is excluded). Keep the link to the track's
   license page. When in doubt, leave it out.
2. Upload the file (MP3 or M4A, around 3 MB at most) to `musica/<name>.mp3`:
   `npx wrangler r2 object put redacao-media/musica/morning-calm.mp3 --file morning-calm.mp3 --remote`
3. Write the manifest `musica/biblioteca.json` and upload it the same way
   (`npx wrangler r2 object put redacao-media/musica/biblioteca.json --file biblioteca.json --content-type application/json --remote`):

```json
{
  "faixas": [
    {
      "id": "morning-calm",
      "titulo": "Morning calm",
      "autor": "Author name",
      "licenca": "License name as shown on the site",
      "licencaUrl": "https://license-site/for-the-track",
      "arquivo": "musica/morning-calm.mp3",
      "usoComercial": true
    }
  ]
}
```

A track without `titulo`, `autor`, `licenca`, an `https://` `licencaUrl` or `"usoComercial": true` (your confirmation
that you read the license and it allows commercial social use), or with `arquivo` outside `musica/`, is not shown. The
Reels screen shows each track's license, and "No music" is always available (`GET /musicas`).

### Narration in the outlet's own voice

**With your voice** on the Reels screen (`src/lib/narracao.ts`, `src/lib/fala.ts`) shows the script (titles and card
sentences, without the call-to-action card) and records or accepts a file of up to 90 s (`MAX_NARRACAO_S`). Whisper
transcribes it and code compares speech with the script: a number or name missing or swapped becomes a warning with the
time to listen; numbers spoken as words count, in Portuguese and English. Each warning needs "The speech is right" or a
new recording (`POST /pecas/:id/narracao/:narracao/avisos/:indice`), and **Make the Reels** unlocks only when all are
decided. The transcript never appears on screen or in the video.

In the video, each card's timing comes from the alignment (or, without it, from word proportions); the caption is the
approved sentence, appearing when it is spoken, in the position the 9:16 QA already measured. The MP4 cache key includes
the voice's SHA-256.

## Sponsorships

**Brand › Sponsorships** (admin; `/patrocinios`): name (up to 60 characters), logo (PNG or SVG up to 512 KB, same
validation as the brand logo) and period. A template turns on the sponsor band. The band reads "Publicidade ·
Oferecimento" / "Advertisement · Sponsored by", written by code, separate from the text, in the place every composition
reserves for the advertising label. The caption gets a fixed last line, "Sponsored by: name", that only code writes and
`corpoDaLegenda` recognizes by exact name.

Sponsors that are expired, upcoming or archived do not appear. No band on the `policia` section
(`EDITORIAS_SEM_PATROCINIO`), advertising, corrections, updates, the call-to-action card, or `autoral` outlets. A piece
freezes its sponsor at creation; a Reels inherits it from its source piece.

## Advertiser posts

**New idea › Ad** (not in `autoral` mode). Advertiser name up to 80 characters (`ANUNCIANTE_MAX`), briefing up to 4,000.
Each sentence of the post is tied to the briefing, and a price that differs from the briefing fails validation (numbers
are compared whole, so `9,90` does not pass inside `19,90`). The advertising label is added by code: a badge on every
card and an opening and closing line in the caption, in both languages. Removing the label from the caption in manual
editing fails validation.

- **Approval link** (`POST /pecas/:id/anuncio/link`, public `/anuncio/:token`): valid for 7 days
  (`VALIDADE_LINK_DIAS`), only for the version it was created for; comment up to 1,000 characters. `GET` never
  decides, because messaging apps open links to build previews; only `POST` decides. The advertiser's answer shows in
  review but does not block **Approve**: the outlet decides what it publishes.
- **Receipt** (`GET /pecas/:id/comprovante`): PDF via Browser Rendering, only for published pieces; `?html=1` returns
  the same page. It is not an invoice.

`/anuncio/*` must be in `assets.run_worker_first` in `wrangler.jsonc` (it is).

## Brand import from a site

In the brand step of a new `local` or `tematico` outlet, "Already have a site? Paste the address"
(`POST /marca/puxar`, `src/lib/puxarMarca.ts`, `src/lib/leituraSite.ts`) opens the site in Browser Rendering and
suggests name, logo, colors and a font pair (`PARES_FONTES`: `padrao`, `jornal`, `grotesca`). Nothing is saved until
the person reviews and saves.

Safeguards: only `http`/`https` to public addresses (`urlSegura`); 20 s timeout; images, video and fonts are not loaded;
the logo is taken from the header or an element marked as logo, never from inside `<article>`; SVG logos go through
`sanitizarSvg`. JPEG and WebP are not accepted, because the brand takes PNG or SVG only. Up to 10 reads per outlet per
24 hours (`MAX_PUXADAS_DIA`, `429` beyond).

## Content language

The UI language is per person; the **content** language is per outlet (`tenants.idioma`, `pt-BR` or `en`), chosen at
creation and changed under **Brand**. It applies to what is produced afterwards: the drafting prompt, fixed card
texts ("Source:", date, section, "Follow"), the default call to action, the caption closing and validation (weekdays
and capitalized words that are not names). Fixed texts live in `src/lib/idiomaConteudo.ts`. Validation stores
plain-language reasons in both languages (`validacao.en`), and review shows them in the reviewer's UI language.

Known limits: triage is designed for Brazilian news, so an English outlet fits best in `autoral` or `tematico` mode; a
Title Case headline counts as names during validation, and the prompt asks for sentence case.

## Configuration

| Setting | Purpose |
|---|---|
| `KIE_API_KEY` or `FAL_KEY` | Illustration provider (server-wide, or per outlet under **AI keys**). Without one, Workers AI. |
| `MAX_CUSTO_PECA_USD` | Cost ceiling per piece. Default `0.25`. |
| `BROWSER` binding | Browser Rendering: cards, receipts, brand import. |
| `REELS` binding | Reels container (Durable Object `ReelsContainer`). |
| `REELS_URL_LOCAL` | Dev only: the Reels container running in Docker. |

Optional reference images for illustration:

```sh
npx wrangler r2 object put redacao-media/referencias/xilogravura.png --file=xilogravura.png --remote
npx wrangler r2 object put redacao-media/referencias/reticula.png --file=reticula.png --remote
npx wrangler r2 object put redacao-media/referencias/nanquim.png --file=nanquim.png --remote
```

Migrations: `0018_anuncios.sql`, `0019_estilos.sql`, `0020_patrocinios.sql`, `0024_narracoes.sql`.
