# Design system

This is the single source of truth for Gazzpush's interface. Any change to the look, layout or motion of the app
starts here. Code comments cite it by section (`DESIGN.md §5`), so section numbers are stable: add new material
inside an existing section or as a new section at the end, never renumber.

Gazzpush is an investigative journalism toolkit: a story desk where every claim is checked against a dossier, with
publishing as the distribution layer. The interface speaks the language of the people who use it every day,
reporters and editors who review copy, so its vocabulary comes from the newsroom and the print shop (proofs, crop
marks, stamps, the editor's blue pencil), not from a generic UI theme.

Terminology follows [`docs/glossary.md`](docs/glossary.md). Token and class names stay in Portuguese; the code around
them is in English. The tables give their meaning.

| Where | What |
|---|---|
| `web/src/styles/tokens.css` | Tokens (`@theme`), base styles, buttons, fields, banners, night mode |
| `web/src/styles/proof.css` | Proof-desk vocabulary (§8) |
| `web/src/styles/desk.css` | Sheet-on-the-desk layout, sidebar, folio, motion (§12) |
| `web/src/kit/pencil.css`, `web/src/kit/Pencil.tsx`, `web/src/kit/strokes.ts` | Blue-pencil strokes (§4) |
| `web/src/kit/Proof.tsx` | Proof card, empty desk, skeleton, art transitions |
| `web/src/kit/Parts.tsx` | Progressive disclosure (§9) |
| `web/src/motion.ts`, `web/src/tooltip.ts`, `web/src/kit/artTransition.ts` | Motion, tooltips, view transitions |

## 1. Direction: Blue pencil

The screen is a **copy editor's desk**. People receive leads, produce pieces, check them and approve them; the UI
looks like the material they handle: clean paper, graphite, and the **editor's blue pencil** marking what to do next.

- **Paper, graphite, blue only for action.** Everything is neutral except the next thing to do.
- **The product is the post.** A piece is shown as a **print proof on the desk** (large cover, crop marks, wait
  ruler, status stamp, layered paper shadows, paper grain), never as a 32 px thumbnail. See §8.
- **Texture is paper, not paint.** No watercolor, stains, dry brush, multiply-blended art or frosted glass. Piece
  illustrations appear only where they are the product (carousel, proof).
- **A work tool, not a website.** Dense enough to work in all day (§12), one part at a time (§9).

## 2. Tokens

All tokens live in `web/src/styles/tokens.css` under `@theme`. Tailwind's default palette, fonts, radii, shadows and
breakpoints are reset (`--color-*: initial` and so on): only tokens with a meaning exist.

**Product mark.** The Lombada signature identifies Gazzpush on the splash, sign-in and outlet-creation screens. Inside
the app it sits at the foot of the sidebar on desktop and in the account menu on mobile. It is ink blue on paper and
ivory in night mode. The symbol alone is the favicon and the installed-app icon.

### Color

| Token | Day | Meaning |
|---|---|---|
| `--color-papel` | `#F7F9FA` | Paper: page background |
| `--color-papel-2` | `#EAEEF1` | Second paper: selectors, tone bands, selected rows |
| `--color-papel-3` | `#E0E5E9` | One step below `papel-2`: field and band on hover |
| `--color-mesa` | `#E7ECEF` | The desk: sidebar and the frame around the sheet (§12) |
| `--color-aperto` | `#C8CDD1` | Pressed sidebar row, one tone below hover |
| `--color-branco` | `#FFFFFF` | White sheet: long-form reading surfaces, cards |
| `--color-texto` / `--color-texto-forte` | `#2A2D33` / `#15171B` | Body text / headings, active tab, counters, graphite marks |
| `--color-apoio` | `#5A5E66` | Supporting text: metadata, labels |
| `--color-fio` / `--color-fio-forte` | `rgb(21 23 27 / .11)` / `.22` | Rules: separation instead of borders |
| `--color-tinta` | `#0B5CC4` | Blue pencil. **Action only**: links, Produce, Approve, the hand-drawn mark, active sidebar section, counters of what waits for you |
| `--color-tinta-forte` | `#0A53B2` | Blue-pencil block on hover |
| `--color-tinta-clara` | `#E4EEFB` | Light ink: active section background, secondary action, text selection |
| `--color-sobre-tinta` | `#FFFFFF` | Text on ink (darkens at night, when ink lightens) |
| `--color-verde` on `--color-verde-claro` | `#17663F` on `#E0F0E6` | **Only** a passed check / supported claim |
| `--color-ambar` on `--color-ambar-claro` | `#6E4A00` on `#F8EDCF` | **Only** warnings (source unavailable, claim without source) |
| `--color-terracota` on `--color-terracota-claro` | `#A23E1C` on `#F9E2D7` | **Only** errors, rejection, legal risk |
| `--color-realce-arte` / `--color-sobre-realce` | `#9BE3B9` / `#0E2A1B` | Sentence highlight drawn over artwork (always dark underneath) |

Measured contrast, AA for small text in every case: text 13.1:1, supporting 6.2:1 (5.6:1 on `papel-2`), ink 6.0:1,
white on ink 6.3:1, green 5.9:1, amber 6.8:1, terracotta 6.1:1.

### Surface, shape and motion

| Token | Value | Use |
|---|---|---|
| `--textura-papel` | 32 px grid at `rgb(11 92 196 / .03)` over fine grain | Page texture. The grid is never stronger than 3%; the grain has no color or direction and never counts in contrast. Long-form reading (`.folha-doc`) is plain white, without texture. |
| `--radius-card` / `--radius-faixa` / `--radius-btn` / `--radius-full` | 4 / 6 / 8 / 999 px | Small corners, no outlines |
| `--shadow-fio` | 1 px rule | Hairline under bars |
| `--shadow-curta` | ring + contact + long soft shadow | Card at rest |
| `--shadow-eleva` | stronger | Lifted card: hover, focus, chosen, menus, sheets, decision sheet |
| `--shadow-prova` | strongest | The piece's artwork, which is the product |
| `--shadow-folha` | | The sheet on the desk (§12) |
| `--ease-saida` | `cubic-bezier(.2, .8, .2, 1)` | Entrances |
| `--ease-mola` | short spring (`linear()`) | Things that answer a touch |
| `--ease-gaveta` | `cubic-bezier(.32, .72, 0, 1)` | Things that travel or slide |
| `--breakpoint-sm` / `-lg` / `-xl` | 600 / 1024 / 1180 px | `lg`: 256 px sidebar. `xl`: two columns with a 420 px side column (Review, Publish) |

Every elevation is three layers: a 1 px ring (the rule), a contact shadow and a long soft shadow.

## 3. Typography

| Family | Weights | Use |
|---|---|---|
| **Atkinson Hyperlegible Next** (`--font-sans`) | 400, 500, 600, 700 | Everything: headlines, screen titles, body. 500 and 600 are the step between text and bold (row labels, small buttons, list headlines). |
| **Fragment Mono** (`--font-mono`) | 400 | Short metadata only: section, source, time, counts, margin numbers. Normal case; uppercase only in section labels. |

- `.manchete` (headline): 700, `letter-spacing: -.015em`, `line-height: 1.15`.
- `.titulo-tela` (screen title) and outlet name: 700, `letter-spacing: -.03em`. Screen title is 34 px on desktop, 32
  px on mobile.
- `.mono`: 12 px, `letter-spacing: .01em`. Section labels: 11.5 px mono, `letter-spacing: .08em`, uppercase.
- **Slashless zero.** Only the digit 0 comes from `zero-<weight>.woff2` (about 0.6 KB each, derived from Atkinson
  Hyperlegible Next), loaded after the full faces with `unicode-range: U+30`. The mono face keeps its slashed zero.
- Latin subset, `font-display: swap`, self-hosted in `web/src/styles/fonts/` with their OFL licenses.

## 4. The hand-drawn mark (one per screen)

The blue pencil is the gesture of the whole direction, and it appears **once per screen, on the next action**:

| Screen | Mark |
|---|---|
| Ideas, To approve | Pencil loop around "Review the next one" (or around "Produce" when nothing waits for review). Other actions are underlined text. |
| Review | Hand-drawn check on Approve (white on blue pencil). |
| Story desk | Pencil loop on "Send to Instagram". While a reviewer note is open, the note is the next action and the loop goes away until it is resolved. |
| Publish | Loop on the current step of the posting script (§12). |
| Not found | Loop on "Go to the start". |

- **Exception: the editor.** Reviewer notes (§10) are underlined in pencil and may appear several times on screen,
  because each one is a request for action.
- Claim marks in the text are **never** pencil (§5), and pencil never marks state.
- The validation check is drawn in pencil too, but **green**: validation is green, blue is only action.
- Strokes are generated SVG with graphite grain: `volta` (loop), `visto` (check) and `sublinhado` (underline) in
  `web/src/kit/strokes.ts`, rendered by `web/src/kit/Pencil.tsx`. The loop draws itself on entry (dash offset, 300 ms,
  `--lapis-dur`); everything is instant with `prefers-reduced-motion`.
- The margin mark of the sidebar (§8) is a position indicator, not the hand-drawn mark.

## 5. App shell

### Navigation

- **Plain-language sections:** Ideas · To approve · Ready to post · Posted. Author outlets (`modo = 'autoral'`) add
  **Texts**. One name per screen: the title is the label of the menu item that opened it; the outlet name appears only
  in the switcher and the mobile top bar.
- **Mobile (< 1024 px):** top bar (outlet square, avatar) and bottom navigation (Ideas · Approve · **+** · Post ·
  Posted). **+** opens the "New" sheet (link, text, screenshot, Docs). Texts and outlet settings live in the avatar menu.
- **Desktop (≥ 1024 px):** 256 px sidebar (§12): outlet switcher; "New idea" beside **Go to…** (⌘K); the workflow
  group, active section in `--color-tinta-clara` with the margin mark (§8); one status card; the **Outlet** group;
  the account at the foot.
- **Counters are for change, never totals.** Ink counters only on what waits for you (To approve, Ready to post);
  Ideas shows "n new"; reporters see no counters.
- **Status card**, one at a time: **Getting started**, **In production** (oldest piece, its step, four ticks) or
  **Today** (seven bars for the week, and what waits since when). Rhythm and waiting time, never accumulated totals.
- **Labels:** groups outside the main navigation carry an uppercase mono label; the main navigation has none.

### Outlet settings (`/t/:veiculo/veiculo`)

- Tabs in the URL, one at a time; non-admins read "Only the admin can change this". Borderless fields with a rule
  underneath, lists in paper cards, **one blue-pencil block per form**, status in mono ("you post from your phone",
  "collection stopped: too many failures in a row").
- **Brand** sections (`?secao=`) are master–detail from 1280 px (list, fields, live card preview) and an accordion
  below, with one "Save the brand" pinned to the foot. Call-to-action cards carry no number or weekday, because fact
  checking would reject them. Card font pairs (Nunito + Quicksand, Source Serif + Source Sans, Archivo + Inter) belong
  to the outlet.
- **Sources** and **Accounts** open with their action row ("Add an RSS feed", "Connect an account") and the list.
- **Plan** is a reading column (usage as text with a thin bar, warning at 80%, comparison as a ruled list, no
  "recommended" badge). An outlet without a plan can't produce, check, transcribe or collect, and every screen shows a
  pinned amber banner.

### Story desk (author outlets)

- **Texts:** the line "The check points things out; it doesn't rewrite", **New text** (blank sheet, focus on the title), **Paste or bring
  from Google Docs** (`?novo=colar`) and the list "On the desk" with the last check counts in mono and an amber band
  when a source changed or alerts are open.
- **Story tabs:** **Dossier · Text · Posts · After** (`?aba=`), with mono counts on Dossier and After.
- **The document sheet** (`.folha-doc`): plain white, 680 px column, `line-height: 1.75`, formatting bar pinned to the
  top of the sheet (active option in `papel-2` and bold, never blue). Tiptap, loaded only on this route; one mode, no
  edit/read toggle. A mono line says "saved at 23:20", "saving…" or "unsaved changes"; a pinned footer shows words,
  reading time and the check counter.
- **Desktop panel** (300 px, from 1180 px), one part at a time in `?painel=`: **Marks** (with People), **Dossier**
  (with the sources page) and **Tools** (the editor's bench). Below 1180 px marks open in a bottom sheet. **Focus**
  (`?foco=1`) hides sidebar and panel.
- **Concurrent edit:** if someone else saved first, an error band offers "Reload the new version"; typed text stays.

### Claim marks

Marks are a decoration layer over the text (editor decorations, never part of the document); they follow typing.

| State | Treatment | Icon |
|---|---|---|
| With evidence | 1 px green rule, no background | check |
| Without source | light amber background, 2 px amber rule | question mark |
| Legal risk | light terracotta background, 2 px terracotta rule | triangle |
| Uncertain, check it (two opinions disagree) | same as risk, with text label | triangle |
| Resolved (a person decided) | 1 px `fio-forte` rule, no background | — |
| Math doesn't add up (code) | as risk | "different" sign |
| Quote without source (code) | as without source | quote marks |
| Matches the recording | as with evidence | sound wave |
| Style guide (code) | 1 px ink rule, no background | book |

- Always an icon before and the state name for screen readers; never wavy underlines, never pencil. The selected mark
  gets a graphite outline. Above the text, mono counts ("1 with evidence · 1 without source · 1 legal risk").
- **Mark card** (in the Marks panel): state in bold, category in supporting text, the sentence in two lines; the
  selected one expands to the explanation, the evidence with its passage on light green, the number of opinions in
  mono ("two opinions: DeepSeek and Claude") and the actions as flat secondary buttons: Pin source · Add link · I
  contacted the other side · It's opinion · Ignore. Each opens a short form inside the card; once decided, the card
  shows in mono what was done, by whom and when, with Undo.
- Clicking a mark selects its card; clicking a card scrolls to the sentence; **F8 / Shift+F8** jump between open marks.
  On mobile, tapping a mark only selects it (focus stays in the text) and the counter offers "see the mark".
- **@ citation:** a mono token `[evidence title]` on `papel-2`, not link-colored. The @ menu and the editor's ⌘K
  palette are paper cards with the active option in `papel-2` (never blue). Pasting a lone link shows a short band
  "Add to the dossier?".
- **People and institutions** below the panel: name in bold, mentions in mono, "accused · other side contacted" or
  "no other side" in terracotta.
- **Publication checklist:** opened from "checklist: 2 pending" (mono) or from a blocked Send to Instagram; one row per
  pending item linking to the sentence, and "Sign the publication" (secondary). Signed: "Publication signed by" who and
  when, in mono.

### Dossier, Posts and After tabs

- **Dossier** is built from parts (§9): Dossier, Documents, Recordings, FOI requests, Other side, Defense package. A
  part with an error or warning moves up and opens (error, warning, rest); FOI warns at 5 days or less, and a risky
  sentence without a right-of-reply request counts as a warning. An empty part is one row with its action.
- **Cards, not tables.** Each evidence, PDF, recording, request or alert is a white or paper card: name in bold,
  status and dates in mono, failures in a terracotta band, warnings in amber, success in green mono. Evidence without
  a link (replies, FOI responses, PDF pages) is labelled in mono instead of linked.
- **Every model answer shows its proof.** Ask the document prints "model answer, bound to the citations below
  (checked in the document)", each citation as "p. N" with the passage on light green and "Use as evidence". Without
  a valid citation, only "I didn't find it in the document." plus, in mono, how many passages were discarded.
  Quote checks say "matches the recording at 01:13 · name" (green) or "not found in recordings or dossier" (amber).
- **Wayback status** is one mono line per link ("Wayback copy · today, 10:11 · see the copy", "the Wayback didn't
  save (HTTP 429) · Try again").
- **Forms open inline** in `papel-2`, prefilled where the app has a template (right-of-reply request, FOI request,
  appeal, complaint). Each next step of a request is a secondary button. "Send by e-mail" exists only when the Email
  Service is configured.
- **Recording in the app:** time in 24 px mono, "Saved up to mm:ss", a level bar with no state color, "Stop and
  finish" in ink; problems (no confirmation for 15 s, microphone cut, 20 s of silence, app in background) show in an
  error band with a short sound and vibration.
- **Posts:** a paper card per piece ("carousel · to approve · 2 h ago · from version 1 of the text"). Send to
  Instagram with an open risk shows a terracotta band listing the risky sentences.
- **After:** alerts grouped in mono sections (Sources that changed, People and court cases, FOI deadlines), each with
  "Open the text", "I updated the text", "Update post", "Correction post" and "Ignore". Handled alerts turn `papel-2`
  with who and when.
- **Public sources page** (`/fontes/:id`): a 680 px reading column on `papel`, without the app shell; sentences with
  source numbers and the passage on light green, author opinion in its own section, sources with Wayback copies. No
  brand color.

### Pieces

- **Card layouts** (`src/lib/cards.ts`, `src/templates/card.html`): Cover, Text, Quote, Big number, List, and the proof
  layouts Document, Comparison and Timeline; 2 to 10 cards, the last always the call-to-action card. **Print
  compositions** (`src/lib/style.ts`): Band, Column, Poster and Front page, only with the three brand colors, no
  gradients.
- **Edit the cards** (`?editar=1`): card list, live preview from the render template, fields for the open card
  (`?card=`), each sentence with "Bound to" its fact and source, and a pinned blue-pencil "Save and check". A flagged
  card opens on arrival and Approve stays disabled with the reason in terracotta.
- **Reels:** 9:16 cards (class `r916`) in a horizontal strip; adjustments as parts (`?ajuste=`): Voice, Pace, Motion,
  Music. Numbers never count up; the first card opens complete. Safe areas: header 200 px from top, text 420 px from
  bottom and 150 px from right, footer 300 px from bottom.
- **Advertising** is always labelled by code: a stamp in Ideas and Posted, an amber panel in Review until the
  advertiser approves on `/anuncio/:token` (Worker HTML, no shell).

## 6. Rules

1. An app, not a website: one part at a time, detail on demand (§9).
2. Returning users see what changed ("since your last visit", counters of change, never totals).
3. Motion has a purpose and always honors `prefers-reduced-motion`.
4. No outlines plus rounded corners: separate with tone, rules and short shadows.
5. A color has one meaning (§2). Blue pencil never marks state: a reviewer note is blue because it asks for an action,
   and the stroke that crosses it out says the request is over, not that the sentence is good.
6. **One hand-drawn mark per screen** (§4). Exception: reviewer notes, one per paragraph (§10).
7. Every screen points to the next action.
8. A loading failure never becomes a fact: "Didn't load · try again"; "1 source unavailable", never "source is down".
9. Look at a screenshot before shipping a screen.
10. Every screen in Portuguese and English: paired strings in place, `t(pt, en)` (`web/src/language.ts`). Portuguese
    first; English short, in sentence case, with the same tone. Post content (cards, caption, call-to-action, card
    preview) follows the **outlet's** language, not the viewer's. Never call `t()` at module top level.
11. Post art appears as a proof (large, with a paper shadow), not as a 32 px icon; thumbnails only where they identify
    something that isn't being checked.
12. Single-key shortcuts only work outside text fields, without Ctrl/Alt/⌘, and they **open**; the button decides.
    A shortcut the editor owns (⌘K) belongs to the editor when focus is in it.
13. Texture is paper, not brush: the grain has no color or direction and never counts in contrast. Long-form reading
    surfaces are plain white.

## 7. Dialogs, transitions and open questions

- **Screen transitions** use View Transitions on the content area only; the shell never moves, and focus moves to the
  content on navigation (§12 has the current timings).
- **Dialogs** are native `<dialog>` elements (`.folha` in `tokens.css`): on mobile a paper strip that rises from the
  bottom; on desktop at the top, centered; dimmed backdrop, no outline. Submission is a blue-pencil block.
- **Pieces from a screenshot** show an amber band in Review ("text read by a model") linking to the image.
- **Visual tests:** screenshots that involve blur or glass effects require Playwright's `channel: "chromium"`.
- Not yet designed, because the API doesn't provide the data (never fake it): undo after deciding or posting, check
  status per proof in lists, "2 sources cover this" and per-city counts in Ideas, plan usage in the sidebar.

## 8. Proof desk

The print-shop vocabulary. Classes in `web/src/styles/proof.css`; components in `web/src/kit/Proof.tsx`; command
palette in `web/src/shell/Palette.tsx`.

| Element | Class | Rule |
|---|---|---|
| Desk | `.mesa` | Grid of proofs, `auto-fill`, 232 px minimum (four columns at 1440 px, two on mobile). To approve, Ready to post, Posted. |
| Proof | `.prova` (`ProofPost`) | 4:5 cover with `--shadow-prova`, queue number, mono caption, 18 px headline, wait ruler, action pinned to the foot. One link whose accessible name ends with the action. Hover/focus: rises 5 px, rotates −0.35°, `--shadow-eleva`. Carousels show a second sheet behind. |
| Wait ruler | `.regua` | 24 divisions; the graphite part is this proof's wait relative to the oldest. `aria-hidden`: the wait is written beside it. |
| Crop marks | `.corte` | Four corners outside the art, on hover and always on the next action. Decoration only. |
| Stamp | `.carimbo` | Status in mono uppercase, 1.5 px border, −2°, graphite (neither action nor validation): "Posted", "Simulated". |
| Rail | `.trilho`, `.trilho-curto` | Pieces in progress as a snapping horizontal row; a piece being made is a blank hatched proof. |
| Lead sheet | `.pauta` | A suggested lead on white paper: number, caption, headline, summary, actions under a rule. |
| Stage | `.palco` | `papel-2` drawing table with a 14 px dot grid, from 1024 px, for Review and Publish. |
| Proof strips | `.tira` | 44 px covers of each card, current one raised; counter and arrows on the line above. |
| Margin mark | `.marca-margem` | 3 px ink stroke beside the open sidebar section; slides between sections via `view-transition-name`. Not the §4 mark. |
| List entrance | `.entra` | Rises 10 px, staggered; only new items animate. Skeletons shimmer, never blink. |
| Buttons, fields | `.btn-tinta`, `.entrada` | The blue-pencil block has body and sinks 1 px when pressed; fields lighten to white on focus. |

- **Prefetch** (`web/src/warmup.ts`): 90 ms after hovering or focusing a proof, its piece enters the cache, so Review
  opens without a skeleton.
- **Single-key shortcuts** (`freeShortcut` in `web/src/common.tsx`). Review: **A** Approve, **E** Rewrite, **X** Reject
  (they open the step, never decide), **J / K** next and previous, **← →** cards. Global: **N** New idea, **?** shortcut
  sheet. Only with focus in the content area, no modifiers, outside text fields, with no dialog or menu open (WCAG
  2.1.4).
- **Command palette** (⌘K / Ctrl K): native dialog with a combobox. Go to any section, open a piece by title, switch
  outlet or language, sign out. Accent- and case-insensitive; a live region announces the result count; no results
  shows "Nothing matches that." On a story's desk, ⌘K belongs to the editor.
- **Width:** Review and Publish use two columns (art + 420 px) only from 1180 px (`xl`).
- **Waitlist and sign-in** share `web/src/kit/PromiseCard.tsx`. Plan options come from `src/lib/plansTable.ts`, the
  billing table, so no number is duplicated. A repeated e-mail gets the same answer: the page never reveals who is on
  the list.

## 9. Parts: detail on demand

Long screens are split into parts without changing their look or removing features (`web/src/kit/Parts.tsx`).
Budget in the initial state: up to 1400 px tall on desktop and 2000 px on mobile, with the main action visible at
1440 × 900 and 390 × 844. Lists of real data are exempt.

- **`Partes`:** master–detail from 1280 px (fixed 260 px list with name and summary, selected in `papel-2` and bold,
  never blue); accordion below (one open, others as ≥ 56 px rows with their summary).
- **`Part`:** a single collapsible row. `fixa` keeps it open on click; `manter={false}` unmounts it when closed.
- **Summary:** one line of mono with what's in effect or a count. Never a closed part without one. State lives in
  `aria-expanded`.
- **Alerts never hide:** `tom` (`aviso`, `erro`) shows the full summary, `padrao` opens the alerting part on arrival
  and `alertFirst` orders error, warning, rest. A part never closes under the user's hand when its alert resolves;
  a `role="alert"` in a hidden panel always opens it. The part holding the screen's action comes first.
- **Invalid field:** saving opens the field's group and focuses the field.
- **In the URL:** `usePart(param, padrao)` with `replace` and `preventScrollReset`; `nenhuma` means "all closed".
  Parameters: `parte`, `grupo`, `modelo`, `previa`, `texto`, `pedir`, `card`, `ferramenta`, `ideias`, `ajuste`,
  `letra`, `dossie`, `lai`. Unknown values fall back to the default.
- **Opened stays alive:** panels mount on first open and are then only `hidden`, so nothing typed or recorded is lost
  when switching parts or crossing 1280 px.
- **Accessibility:** real buttons and headings (`h2`–`h5`), `aria-controls`, a named region; closing a part above
  scrolls the clicked row back into view.
- **Pinned bar:** the main action of long forms sticks to the foot on `papel`, above the mobile navigation
  (`bottom-[calc(66px+env(safe-area-inset-bottom))]`).
- **Avoid:** wizards where one screen is enough, modals for reference material, tooltips as the only place for
  information, inner scrolling, shrinking text to fit. In previews the art shrinks; `?previa=grande` restores it.

## 10. The blue-pencil reviewer

An experienced editor reading over the shoulder, without chat and without a separate mode. Rules in
`src/lib/reviewer.ts` (pure functions); browser behavior in `web/src/story/Reviewer.tsx`.

- **Questions are fixed and generated by code**, never by a model: free, no hallucination, identical for anyone cited,
  exactly testable. The only automatic insertion is a literal transcript quote, on request.
- **One note per paragraph**, for an open mark, by priority: victim or minor, accusation, other side, math, quote,
  without source, style guide. "Who said this?", "Who said this number?", "Do you have the link? Paste it in the
  Dossier."
- **Timing:** a note appears when the cursor leaves the paragraph, never while writing it. A paragraph without a valid
  check keeps its previous note: a check that didn't run is neither a note nor its absence. Same question, it stays;
  different question, the old one is struck through and the new one drawn; no question, it is struck through and
  leaves.
- **Where:** from 1180 px the Marks panel is the margin, each card at the height of its paragraph; below 1180 px and in
  focus mode, a widget under the paragraph, outside the document.
- **Look:** product font in action blue, revealed in 300 ms with the kit's `sublinhado` stroke; the strike-through is
  the same stroke at mid-height. No handwriting font.
- **Sources light up:** a new dossier link re-checks only paragraphs with an open `sem_fonte`; supported sentences
  turn light green one by one as results stream in.
- **Quote from the recording:** after an opening quote mark and three words, an offer in the style of the @ menu; Tab
  inserts the rest literally, Esc dismisses. Tab is captured only while the offer is visible.
- **"Ready to publish" stamp** (`.carimbo-prova`, graphite): words present, nothing checking or pending, no open mark,
  checklist clear. An editor's sign-off accepts pending items but doesn't earn the stamp.
- **Switch:** "Notes" in the formatting bar, stored in the browser (`redacao:revisor`). Off removes notes and quote
  offers; checking, marks and stamp remain.
- **Never:** chat bubbles, avatars, mascots, AI sparkles, confetti, sound, gradients, letter-by-letter typing,
  suggested sentences or rewrites.

## 11. Token usage panel

An internal panel at `/admin/uso`, only for user ids listed in `ADMIN_USER_IDS`; for everyone else the route doesn't
exist. Entry in the account menu. One row per model call in `uso_modelo` (`src/lib/usage.ts`). Workers AI doesn't
report tokens and is left out, and the screen says so. The screen polls every 3 s; on failure the last numbers stay
visible with their age. No charts: exact numbers matter here. Journalists never see tokens.

## 12. Sheet on the desk: layout, motion, night mode

Structure and motion for a dense work tool. Where this section differs from §§2–8, this section wins.
Code: `web/src/styles/desk.css`, `web/src/shell/Folio.tsx`, `web/src/motion.ts`, `web/src/tooltip.ts`.

### Layout

- **The sheet on the desk** (desktop): sidebar and frame are the desk (`--color-mesa`); content is a sheet of paper on
  top, with 8 px of desk around it, 10 px corners and a paper shadow. The page still scrolls as a whole (no inner
  scrolling): the shape comes from `.moldura`, a fixed hollow rectangle that paints the desk outside. `--topo` and
  `--pe` say how much the shell pins at the top and bottom; every screen-level `sticky` adds one of them. The scrollbar
  gutter is always reserved (`scrollbar-gutter: stable`) so the sheet never shifts sideways between short and long
  screens.
- **Sidebar:** 34 px rows with 18 px icons; fits at 1440 × 900 without inner scrolling. "New idea" has the N key;
  "Go to…" is a field with the shortcut visible. The Outlet group collapses (choice kept in the browser; it stays open
  while one of its tabs is open), and its Sources row shows collection status ("collected 08:37", "1 unavailable" in
  amber). In-production steps are graphite (progress isn't action), with a spinning registration cross. Order:
  sections, status card, Outlet group, account.
- **Folio:** the line pinned at the top of the sheet, like the head of a newspaper page. Left: where you are (the
  screen name appears once the title scrolls away; a piece or text puts the way back there with `InFolio`). Right: what
  is happening ("2 producing", "1 source unavailable" in amber), date and place; screens can replace it with
  `InFolioDir` (e.g. the queue pager). On mobile the folio exists only when there is a way back.
- **Screen title:** 34 px on desktop with 12 px under the 44 px folio; 32 px on mobile.
- **Registration cross:** the "working" signal instead of a spinner, from the same print vocabulary.
- **Tooltip** (`data-dica`, `data-tecla`): name and shortcut of icon-only buttons. The first waits 450 ms; once one is
  visible, neighbors open instantly. Never the only place for information (§9): the button has a label.

### Screens

- **Ideas:** "Now" on top (the next action with its cover, crop marks and pencil loop, beside the short queue); ideas
  below as a list and, from 1180 px, the **lead sheet** of the selected idea (`?ideia=`) with its facts, format and a
  pinned Produce / Discard. Keys there: J/K and arrows move, 1 and 2 switch format, P focuses Produce, X opens discard.
- **To approve:** "4 waiting for you · the oldest for 3 days" and a Desk | List switch (`?vista=lista`); the list is a
  table that collapses into a mono line on mobile. Non-next proofs carry "Review" with an arrow (`.acao-seta`).
- **Review in three columns** (from 1180 px): visible queue, stage, check column. **Sentences and sources**: each
  sentence with its source and, on hover, focus or tap, the supporting passage; where the sentence was measured in the
  render template it gets a box on the art (`.chamada`). Without a reliable measurement, no box: never a guessed
  position.
- **Decision bar** (`.barra-decisao`), pinned on desktop and mobile: the chosen step opens inside it, one decision at a
  time; preset reasons are chips. The "Approved" stamp strikes for 400 ms only when Approve came from the pointer.
- **Publish (manual accounts)** is a numbered script: send or download the images, copy the caption, post, report the
  link. Done steps collapse (screen state only). From 1180 px, the desk plus `PanelPublish` for the piece in `?post=`.
- **Posted** opens with the rhythm band (`.ritmo`): seven days of bars and today / week / ready counts, real posts
  only.
- **Art travel:** `takeArt` on click and `artThatBack` on render (`web/src/kit/Proof.tsx`) give only the clicked
  proof the transition name.

### Motion

- **Keyboard-born actions don't animate:** palette (always opens ready), single-key shortcuts, Enter. `<html>` carries
  `data-tecla` while the last action came from the keyboard, and CSS drops screen transitions, list entrance, sheets,
  menus and the stamp. Reviewer notes (§10) still draw: they respond to the text, not the shortcut.
- **With the pointer:** the old screen leaves in 90 ms and the new one enters from 70 ms (almost no overlap); proof art
  travels between desk and stage in 300 ms (`web/src/kit/artTransition.ts`); list entrance 260 ms with a 30 ms stagger; margin
  mark 220 ms; pencil loop draws in 300 ms. Never `ease-in`.
- **Press:** every button shrinks slightly when pressed (`scale`, added to the blue-pencil block's sink); list rows
  (`data-linha`) don't shrink, they darken a tone.
- Hover only where there is a pointer (`@media (hover: hover)`), so highlights don't stick after a tap.
- **Reduced motion is not zero motion:** color and opacity still signal; anything that moves, rotates or grows stops.

### Night mode

- Chosen in the account menu (Appearance: Paper · At night), stored in the browser (`web/src/theme.ts`). Never turns on
  by itself, not even from the system theme: the identity is paper.
- `data-mesa="noite"` on `<html>` swaps the tokens: the desk darkens, the sheet becomes light graphite, ink lightens
  (`#7FB2FF`) and the text on it darkens (`--color-sobre-tinta`). State colors keep their meaning with night values
  (green `#6CC797`, amber `#E8BD55`, terracotta `#F29373`). Post art never changes. Hand-coded graphite in CSS (crop
  marks, stamp, hatching, stage dots) derives from `--color-texto-forte`.

## 13. Source material panel

The reporter's folder, open next to the proof: sources, PDFs, recordings and clippings, read without leaving the
text. Component `web/src/story/Material.tsx`, placed by `web/src/story/StoryText.tsx`; shared rules in
`src/lib/clipping.ts`. The panel neither checks nor writes: it keeps literal passages and inserts them where the cursor
is, with the citation resolved.

- **Where:** from 1180 to 1535 px, a 360 px column left of the sheet, replacing the right panel; from 1536 px, three
  columns (Material 360, sheet, panel 300). The column is `sticky` and scrolls on its own. Below 1180 px, a bottom
  sheet. Material and focus mode exclude each other; `html[data-sem-lateral]` hides the shell sidebar in both.
- **Entry points:** the **Material** button (`aria-pressed`), "Open the material" and "Search the material" in ⌘K,
  "Read alongside" on each dossier source. URL: `material=aberto`, `fonte=<tipo>:<id>`, `material-parte`.
- **The cursor stays put:** insert buttons don't take focus (`onMouseDown` with `preventDefault`) and ProseMirror keeps
  the selection on blur. If the cursor was never placed, the passage goes to the end.
- **One search** across clippings, sources, PDFs and recordings, accent-insensitive, grouped by type and source; old
  results fade while new ones load.
- **Five parts** (§9): Clippings, Sources, Documents, Recordings, Outlet archive.
- **A clipping is a strip of paper:** the passage in quotes, origin in mono, the note with a left rule. **Insert** is
  the only filled button; then Cite only, Open in source, Annotate, Keep in archive, Remove. A clipping whose source
  left the dossier stays in amber, insertable but not citable. Speech under three words can't be inserted.
- **Reader:** one paragraph (PDF page, recording segment) at a time with "Save clipping" and "Insert"; a selection
  wins over the whole paragraph. Passages that support a claim show in `verde-claro`.
- **Outlet archive:** "Bring" copies a saved source or clipping without reading or transcribing again.
- **Cost:** typing never re-renders the panel: it is `memo`, gets stable actions through a `useRef` bridge and renders
  once per save.
- **Never:** modals on desktop, drawers over the text, pencil color (the pencil belongs to the reviewer), AI
  summaries, rewritten passages, drag-and-drop into the text, icons without labels.
