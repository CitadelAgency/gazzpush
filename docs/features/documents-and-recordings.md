# Documents and recordings

Investigations run on primary material: a 300-page audit report, a contract, a court record, a two-hour interview.
This part of the [story desk](story-desk.md) lets the journalist question a PDF and get only answers that cite a page
and a passage verified to exist there, and checks every quotation in the text against the recorded interview. The model
helps find things; code decides whether what it found is real. Routes are relative to `/api/t/:tenantId/textos` and
live in `src/shell/texts.ts`.

## Ask the document

Logic in `src/lib/document.ts`. UI: Dossier tab, **Documents**.

### Upload

`POST /:id/documentos` with the raw PDF as the body and the file name in the `x-nome` header (editors only).

- Up to 20 MB (`PDF_MAX_BYTES`) and 500 pages (`PAGES_MAX`). A body that does not start with `%PDF-` returns `422`.
- The same file again (same SHA-256) returns the existing one.
- The original is stored in R2 under `documentos/<outlet>/<id>.pdf` (`GET /:id/documentos/:arquivo/pdf` opens it), and
  reading is queued on the monitor queue (message `arquivo`).

### Reading and indexing

`processFile` extracts the text of every page with `unpdf` and stores it in `arquivo_paginas` and in the FTS5
index `arquivo_paginas_fts` (accent-insensitive). When the `DOCS_VETOR` binding is present, chunks of each page (about
1,000 characters, cut at sentence ends, with some overlap) are embedded with `@cf/baai/bge-m3` into the
`redacao-documentos` Vectorize index, one namespace per file. If indexing fails, search falls back to words only, with a
warning. An image-only PDF (a scan without a text layer) or a broken file is marked as unreadable, with the reason.

### Questions

`POST /:id/documentos/:arquivo/perguntas`:

1. **Hybrid retrieval.** Word search (FTS5) and, if enabled, meaning search (Vectorize) are merged by rank. On long
   pages, the chunk found by meaning is sent to the model even when it contains none of the question's words.
2. **Constrained answer.** The model answers in JSON with page and passage for each citation.
3. **Verification by code.** Each citation must be on a page that was sent, and the passage must appear on that page
   letter by letter (whitespace aside), with at least 8 characters. A citation that does not check out is discarded and
   counted. A quotation in the answer that is not on the page invalidates the whole answer.
4. **No answer without proof.** An answer is shown only with at least one verified citation. If the model says it
   found nothing, the screen says "I didn't find it in the document"; if it claims a find that no citation backs, the
   answer is discarded as invalid. A question that matches no page does not call the model. If the model is down:
   `502`, no answer.

Every question is stored in `perguntas` with a status (`QuestionStatus`): `respondida` (answered), `nao_encontrou`
(not found), `invalida` (invalid answer discarded) or `falhou` (failed).

### From passage to evidence

**Use as evidence** (`POST /:id/documentos/:arquivo/evidencia`): the passage is checked again on the page
(`422 trecho_fora`), and the whole page enters the dossier as evidence with `origem = 'documento'`, titled
`file.pdf, p. N`. The claim check then treats it like any other source. On the public sources page it appears by
document name, without a link.

### What the document contains

Extracted by code, with page numbers: people and institutions, companies (by legal suffix such as `Ltda`, `S/A`, `ME`,
`EPP`, `EIRELI`), amounts in reais and dates. UI: **What the document contains**.

### Cross-checking totals

When the text states a total, the app compares it with the total (or the sum of amounts) on a page of the document, at
the same order of magnitude. A mismatch becomes an arithmetic flag in the editor and a checklist item, for example:
"report.pdf, p. 2: the total is R$ 48 million; the text says R$ 40 million."

> Entity and amount extraction is tuned for Brazilian documents (reais, Brazilian date formats, Brazilian company
> suffixes).

## Recordings

Logic in `src/lib/recording.ts`. UI: Dossier tab, **Recordings**.

### Upload

`POST /:id/gravacoes` with the raw audio as the body and the name in `x-nome` (editors only).

- Up to 25 MB (`AUDIO_MAX_BYTES`); the Worker stops reading the body past the limit. Longer interviews go in parts, or
  use the in-app recorder below.
- The format is detected from the file header: MP3, M4A/MP4, WAV, OGG, FLAC, WebM, AAC. Anything else returns `422`.
- The same file again returns the existing one. The original is stored in R2 under `gravacoes/<outlet>/<id>.<ext>`
  (table `arquivos`, `tipo = 'audio'`), and transcription is queued (message `gravacao`).

### Transcription

`processRecording` uses Whisper on Workers AI (`@cf/openai/whisper-large-v3-turbo`) in the outlet's language, with a
silence filter. The transcript is stored as returned, segment by segment with per-word timings (`gravacao_trechos`). The
model does not summarize or correct anything. If Whisper is unavailable or the audio has no speech, the recording is
marked as not transcribable, with the reason. Uploading the same file again restarts a failed transcription.

### Quote check

For every quotation in the text that is not found in a dossier source, the code searches the finished transcripts:

- Matching is word by word, ignoring punctuation, case and accents (speech has none), with at least three words.
- A single quoted word is treated as emphasis and skipped, unless it reads as speech: punctuation inside the quotes
  (“Yes.”), after a colon, or next to a speech verb ("“Yes”, she replied").
- **Found**: a green mark, "matches the recording at mm:ss" (time of the first word), with the passage playable on the
  card. Not a pending item.
- **Not found**: stays "quote without source" (amber), a checklist item, and the explanation says it is not in the
  recordings either.
- While a recording is still queued, the quote stays open and says the transcript has not finished.

**Playback.** `GET /:id/gravacoes/:arquivo/audio` supports `Range`, so the browser jumps to the quote and stops at its
end. The full transcript with timings: `GET /:id/gravacoes/:arquivo/transcricao`. In the **Writing desk**, "Interview
quotes" searches the same transcripts and inserts speech into the text.

## In-app recorder

**Record** on the Dossier tab records the interview directly in the browser, showing elapsed time, microphone level and
"Saved up to mm:ss", which only advances when the server confirms.

- Audio is uploaded in 5-second chunks (`PER_SLICE_SECONDS`) inside 120-second segments (`PER_SEGMENT_SECONDS`)
  with 1 second of overlap (`OVERLAP_S`), so no word is lost at a seam. Bitrate: 48 kbps (`src/lib/segments.ts`,
  `web/src/recorder/`).
- A chunk without confirmation is kept in IndexedDB and uploaded when the network returns.
- Up to 3 hours per session (`SESSION_CAP_S`).
- Closing the tab loses nothing already uploaded: on return the screen offers to finish, and the 15-minute cron closes
  sessions idle for more than 2 hours.

Routes: `POST /:id/gravacoes/sessao`, `PUT /:id/gravacoes/sessao/:sessao/:segmento/:fatia`,
`POST /:id/gravacoes/sessao/:sessao/concluir`, `POST /:id/gravacoes/:arquivo/segmentos/:n/tentar`.

## Queue robustness

PDFs, audio and Wayback captures that exhaust their retries, or that the queue refused, are marked failed with the
reason; nothing stays "reading" forever. A duplicate delivery does not process twice: ownership of a file is recorded in
`arquivos.processando_em`, and only the current owner writes the result. The 15-minute cron closes files that have been
"reading" with no owner for more than 90 minutes (`encerrarArquivosParados`). Uploading the same file again re-queues a
file left behind.

## In the defense package

PDFs under `dossie/documentos/` with `documentos.json` (questions, answers, citations, discards); audio files and
`NN-name.transcricao.json` (segments, word timings, model) under `dossie/gravacoes/`. See
[Legal shield](legal-shield.md#defense-package).

## Configuration

| Setting | Purpose |
|---|---|
| `AI` binding | Whisper and embeddings (Workers AI). No extra secret. |
| `DOCS_VETOR` binding | Vectorize index `redacao-documentos` (1024 dimensions, cosine). Optional: without it, word search only. |
| `BUSCA_VETORIAL=desligada` | Forces word-only search. |

```sh
npx wrangler vectorize create redacao-documentos --dimensions=1024 --metric=cosine
```

Migrations: `0013_documentos.sql`, `0014_gravacoes.sql`, `0017_fila.sql`, `0023_gravacao_segmentos.sql`.
Dependency: `unpdf`.
