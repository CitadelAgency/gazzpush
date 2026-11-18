# Story desk

The story desk is where a journalist writes a story and proves it. Every claim in the text is checked against a
dossier of evidence: a language model points at the passage that might support the claim, and deterministic code
confirms that the passage exists, letter by letter, in the stored copy of the source. Nothing in this flow rewrites the
journalist's words. The result is a text where every sentence either has a source, is marked as the author's opinion,
or is visibly flagged before publication.

> **Availability.** The story desk (the **Texts** section, `/t/:veiculo/textos`) is enabled for outlets in `autoral`
> mode. For `local` and `tematico` outlets the text routes answer `404` (`src/shell/textos.ts`) and the section is
> hidden in the app shell (`web/src/casca/Casca.tsx`).

All routes below are relative to `/api/t/:tenantId/textos`.

## The story record

A story (`textos`, `src/lib/materia.ts`) opens on the desk at `/t/:veiculo/textos/:id` with four tabs, selected by
`?aba=`:

| Tab | What it holds |
|---|---|
| **Dossier** | The evidence and what each item supports: links, PDFs, recordings, right-of-reply answers, FOI responses. |
| **Text** | The editor and the claim-by-claim check. |
| **Posts** | Every piece produced from the story, linked through `pautas.texto_id`. |
| **After** | Follow-up alerts after publication. See [Living stories](living-stories.md). |

A text can come from Google Docs, be pasted, or be written in the app (`ORIGENS_TEXTO`: `docs`, `colado`,
`escrito`). Limits: 100,000 characters (`TEXTO_MAX`) and 2,000 paragraphs (`PARAGRAFOS_MAX`).

## Editor

- **Tiptap (ProseMirror)**, loaded only on the desk route. Allowed formatting: paragraph, heading, bold, italic, link and
  blockquote. The server strips everything else (`limparDoc`, `src/lib/doc.ts`). A quote inside a quote, or a list,
  is saved as a paragraph so no text is lost.
- The document is stored in `textos.doc_json` with a **stable id per block**. `paragrafos_json` is derived from it for
  Google Docs, Substack and Instagram.
- **Autosave**: `PUT /:id` with `{doc, versao, titulo}` after 1.5 s without typing or when leaving an edited paragraph.
  If someone else saved first, the API answers `409` and the screen offers to reload, keeping what you typed on screen.

## Claim-by-claim check

`POST /:id/conferir` runs the check (`conferirBlocos` in `src/lib/mesa.ts`).

- **Per block, by hash.** Each block stores the hash of its text (table `blocos`). Only blocks whose hash changed go
  to the model. Up to 4 calls run in parallel (`PARALELO`), each with the dossier and the full text as a shared prefix
  (cheaper with providers that cache prompt prefixes) and the block at the end.
- **Rounds.** At most 150 blocks per request (`LOTE_CONFERENCIA`); the screen requests the next round on its own.
- **Result per claim** (`ESTADOS_AFIRMACAO`): `com_evidencia` (supported), `sem_fonte` (no source) or `risco` (legal
  risk). Risk categories (`CATEGORIAS_RISCO`): `acusacao_sem_condenacao` (accusation without conviction),
  `vitima_ou_menor` (victim or minor exposed), `sem_outro_lado` (no right of reply). When several apply, the mark keeps
  the most serious one.
- **Never silent.** If the model is down, refuses, or returns invalid output, the block stays **not checked** with the
  reason shown in the panel. A result is only saved if the block still has the same text.
- **Streaming.** With `accept: application/x-ndjson` the endpoint returns one line per finished block and a final line
  with the full state. Without that header it returns a single JSON body at the end.

## Reporting decisions

Each flagged claim has actions (`POST /:id/apuracoes`; undo with `DELETE /:id/apuracoes/:apuracao`). Every decision
is stored with who made it and when, and is tied to the paragraph and the literal passage, so it survives a new check.

| Action | Effect |
|---|---|
| **Pin source** | Choose a piece of evidence and paste the passage. The code confirms it is in the stored text of that evidence; otherwise `422 trecho_fora`. |
| **Add link** | Adds the link to the dossier and checks again. |
| **I contacted the other side** | Who, when and how. Only for accusation and right-of-reply risks; a date in the future returns `400`. It does not close a mark that also exposes a victim or minor. |
| **It's opinion** | The sentence becomes the author's opinion: it leaves the check and, in a carousel, appears as opinion, never as "supported". |
| **Ignore** | Recorded, with who and when, and listed in the audit. |

Removing a piece of evidence from the dossier undoes any "pinned source" that relied on it, again recording who and
when.

## Checks done by code, not by the model

These run without any model call (`src/lib/apuracao.ts`, `src/lib/assistente.ts`):

- **Arithmetic.** Percentage change ("from X to Y, up Z%"), part of a whole ("12 of 40, 30%") and sums, in Portuguese
  and English, with the rounding tolerance implied by the written figure. A wrong figure is flagged with the correct
  one ("From 10,000,000 to 15,000,000 is a 50% increase, not 40%."). The author corrects it.
- **Quotes.** A quoted passage that is not in the dossier is flagged. Recordings can clear it: see
  [Documents and recordings](documents-and-recordings.md#quote-check).
- **Evidence strength** by source type (`PATCH /:id/evidencias/:evidencia {tipoFonte}`, `TIPOS_FONTE`): `oficial`
  (official document, strong), `primaria` (primary source, medium), `materia` (another news story, medium), `anonima`
  (anonymous source, weak). The address suggests a type (government and court domains, official gazettes) and the
  person confirms. Strength never depends on the political leaning of a publisher.
- **Source independence.** Warnings when every sentence rests on a single source, or when two sources cite each other
  or repeat the same passage.
- **People and institutions** cited in the text: where they appear, different spellings of the same name, who is
  accused and whether the other side was contacted.
- **Style guide** (`GET`/`POST /manual`, `DELETE /manual/:regra`; UI: **Style guide**): mechanical, outlet-specific
  rules (spelling, acronyms, numbers, titles, language) that only flag, never rewrite.

## Blue-pencil reviewer

The question an experienced editor would write in the margin of each paragraph (`src/lib/revisor.ts`,
`web/src/materia/Revisor.tsx`). The questions are fixed in code and never come from a model, so they cost nothing,
cannot hallucinate and are the same for anyone cited.

- At most **one note per paragraph**: the most serious open mark, in this order: victim or minor ("Does the name need
  to be here?"), accusation without conviction ("Is there a conviction or official source?"), no right of reply ("Did
  you reach the other side?"), arithmetic ("Does this math add up?"), quote ("Is this quote in any source?"), then
  missing sources ("Got the link? Paste it in the Dossier.", "Who gave this number?", "Who said this?") and style
  guide rules.
- A note appears, is crossed out when the mark is resolved, and never appears in the paragraph you are typing in. With
  `prefers-reduced-motion` notes appear and leave without animation.
- The reviewer can be switched off.

## Writing desk

The **Writing desk** (`web/src/materia/Bancada.tsx`) groups helpers for writing and releasing the story, one panel open
at a time (`?ferramenta=`). Nothing a model produces here enters the document automatically.

| Panel | What it does |
|---|---|
| **Interview quotes** | Search the transcripts of the story's recordings and insert a passage of speech into the text. |
| **Sponsor** | Insert a sponsorship note from the outlet's sponsorships, at the person's request. |
| **Promote** | Suggests three email subjects and a WhatsApp message (`POST /:id/divulgacao`, `src/lib/escrita.ts`). A suggestion containing a number that is not in the text is discarded. The person copies what they want. |
| **Second read** | Up to six notes from a model acting as an editor: opening, unanswered question, what could go, clarity (`POST /:id/segunda-leitura`). Each points to a passage; the person decides. |
| **Versions** | Shows earlier versions of the text and restores one (`GET /:id/historico`, `GET /:id/historico/:retrato`). The current text is kept and can come back. |

## Source material

**Material** is the source organizer next to the text (`src/lib/material.ts`, `src/lib/recorte.ts`,
`web/src/materia/Material.tsx`). On desktop it is a column to the left of the page; on mobile, a bottom sheet. No
model is involved.

- **Clippings** (`GET`/`POST /:id/recortes`, `PATCH`/`DELETE /:id/recortes/:recorte`): a literal passage from a source
  (evidence, document page or recording) or a note of your own (`ORIGENS_RECORTE`). The server checks the passage is
  literally in the source. Up to 200 clippings per text, passages up to 2,000 characters, notes up to 500.
- **Reader**: the stored text of each source, readable next to the draft (`GET /:id/evidencias/:evidencia/texto`,
  `GET /:id/documentos/:arquivo/paginas`).
- **One search** across every source of the text (`GET /:id/material/busca`), accent- and case-insensitive.
- **Insert** puts the passage in the text as it is, with a citation note when the source is citable. **Save** and
  **Insert** keep the selection in the source and the cursor in the text where they were.
- **Archive** (`GET /acervo`, `POST /:id/acervo/trazer`): the outlet's saved sources and clippings from other stories,
  brought in without fetching, reading or transcribing again (`TIPOS_TRAZER`: `link`, `documento`, `gravacao`,
  `recorte`).

## Editor shortcuts

- **`@` citations.** Typing `@` opens "Cite from the dossier"; the citation is a `nota` node that points to the
  evidence.
- **Paste a bare link**: it is pasted in the text and the editor offers to add it to the dossier.
- **Ctrl/⌘K**: command palette (check this paragraph, jump to the next open mark, unsourced claim or risk, cite, add a
  link to the dossier, checklist, people).

## Publication checklist and sign-off

"Send to Instagram" (`POST /:id/instagram`) and publishing the sources page are blocked with `409 checklist` while any
of these remain: open or uncertain risk, unchecked paragraph, quote not found in the dossier or recordings, wrong
arithmetic.

An editor can **sign off** (`POST /:id/assinar {versao}`): the record keeps who signed, when, and what was pending.
A sign-off is valid only for that version and for the pending items the editor saw. A new version, a new pending item
on the same version (for example, a source removed from the dossier) or a risk re-checked with a different type
requires a new sign-off. `409` if the version changed.

## From story to carousel

`POST /:id/instagram` turns the checked version into a lead. The lead is not the whole text: each `com_evidencia` claim
becomes an `afirmacao` fact whose text is the author's sentence, whose source is the evidence URL and whose
`fatos.evidencia_trecho` stores the literal passage. Sentences without a source do not become facts.

| Response | Meaning |
|---|---|
| `409 nao_conferido` | The version has not been checked. |
| `409 risco_aberto` | Open legal risk; the list is in `pendencias`. |
| `422 sem_fatos` | No claim with evidence. |

The same version sent again returns the active lead. The key is the text version plus the state of the reporting
decisions (`pautas.materia_chave`), so changing a decision on the same version produces a new lead, and two
simultaneous requests produce one. In review, a story post shows **where each sentence came from**: per card sentence,
the evidence passage and its link. The caption's call to action links to the author's text, never to an evidence URL.

## Second opinion and topic routing

With an Anthropic key (server `ANTHROPIC_API_KEY` or the outlet's own key), `src/lib/segunda.ts` adds two safeguards:

1. A paragraph with a risk, or with accusation vocabulary, is also checked by Claude. If the two opinions disagree the
   mark becomes **uncertain, check it**, which counts as an open risk in the checklist.
2. Texts on topics that some models are known to soften (Taiwan, Xinjiang, Tibet, Tiananmen, the Chinese government and
   related terms, `TEMA_SENSIVEL` in `src/lib/apuracao.ts`) are checked entirely by Claude.

The card says how many opinions there were. Without the key, the screen says the mark had a single opinion. If the
second opinion is unavailable, the paragraph is checked with a warning; a refusal leaves it **not checked** with the
reason.

## Audit

`GET /auditoria` (UI: **Audit**): over the last six months, flags per month, per topic and per person cited, and every
ignored flag with who ignored it. Use it to see whether verification weighs more heavily on one side.

## Configuration

| Setting | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` or `GEMINI_API_KEY` | Text model for the check. An outlet can use its own key under **AI keys**. |
| `ANTHROPIC_API_KEY` | Optional. Enables the second opinion and topic routing. |
| `SEGUNDA_MODELO` | Optional. Model for the second opinion (default `claude-opus-5-5`; `claude-haiku-5-5` is cheaper). |

Migrations: `0007_mesa.sql`, `0009_materia.sql`, `0010_editor.sql`, `0011_assistente.sql`, `0016_revisao.sql`,
`0030_texto_historico.sql`, `0032_material.sql`.
