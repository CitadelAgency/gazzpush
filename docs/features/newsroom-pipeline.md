# Newsroom pipeline

The pipeline turns monitored sources into reviewed social posts without letting a model invent a fact. Items are
fetched from the outlet's sources, triaged with a constrained schema, broken into facts that exist literally in the
source, deduplicated, and offered as leads. A lead becomes a piece only when someone asks for it, and every sentence of
that piece must point to a fact. Deterministic validation runs before any human sees it, and a human approves before
anything is published. For an investigative outlet this is the distribution channel for work verified on the
[story desk](story-desk.md); for a local or thematic outlet it is the daily news flow.

Routes are relative to `/api/t/:tenantId`.

## Outlet modes

Each outlet has a `modo` that decides what is monitored and how leads are filtered.

| Mode | For | Behavior |
|---|---|---|
| `local` | Local news pages and portals | Filters by area: a city (from the IBGE list) is required, a neighborhood is optional (`/areas`). |
| `tematico` | Thematic outlets (entertainment, tech, ...) | Filters by topic and ignores geography. |
| `autoral` | Individual journalists and authors | Created from a Substack URL (`src/lib/autoral.ts`). Every text from the author's feed becomes a lead, drafting follows the author's voice, cards are signed with their name, and the **Texts** section (story desk) is enabled. |

> Triage of news items is designed for Brazilian news (IBGE cities). An English-language outlet fits best in `autoral`
> or `tematico` mode.

## From source to lead

```
cron */15 → due sources → Queue → fetch + parse RSS → documents (D1) + raw (R2)
          → extract text → triage (constrained schema) → facts with spans → dedupe → lead
```

- **Monitor.** Every 15 minutes, due sources are queued (`src/monitor/scheduled.ts`, `src/monitor/consumer.ts`). Sites
  that block plain `fetch` (WAF `403`/`429`) can be read through Browser Rendering (`src/lib/navegador.ts`); it is
  slower and costlier, so it is a fallback, not the default.
- **Triage** (`src/lib/triagem.ts`) uses an open model on Workers AI with a JSON schema. If the model ignores the schema,
  validation fails and the queue retries.
- **Spans** (`src/lib/spans.ts`). The schema is restricted *before* decoding: the model can only choose passage ids,
  city and neighborhood names and dates that exist literally in the text.
- **Dedupe** (`src/lib/dedupe.ts`). Besides the exact hash, a semantic check with `bge-m3` embeddings (index
  `redacao-dedupe`, one namespace per outlet) drops an item whose nearest neighbor (cosine ≥ 0.92, `LIMIAR_SEMANTICO`)
  is a triaged document or live lead from the last 3 days. Any AI or Vectorize failure is logged as `dedupe.falha` and
  triage continues without this step.
- **Leads** appear in **Ideas**.

### Manual intake: New idea

**New idea** (`src/lib/nova.ts`) lets the operator bring a story: a link, a short written account, or a screenshot. It
becomes a `manual` lead at the top of Ideas through the same path as the monitor (article → spans → triage → facts),
without the area filter. Idempotent by content hash. With Google Docs connected, a document can be brought in the same
way.

### The outlet's own site

On the **Sources** tab, "This is the outlet's site" (admin, not in `autoral` mode). Stories published on the site after
the mark become leads with `origem = 'site'`: no area filter, the full body as facts, no semantic dedupe, and production
starts immediately as a carousel so they reach **To approve**. Items already in the feed before the mark are skipped
(`fontes.propria_desde`); items without a date follow the normal path.

Ceiling: `MAX_AUTO_DIA`, 30 pieces per day (Brasília time). Beyond that, the lead stays in Ideas marked "from your site".
Each piece is still bounded by `MAX_CUSTO_PECA_USD`; with 30 pieces a day, that is the cost that multiplies.

### Daily digest

On the **Sources** tab, "Daily digest at 18:00" (admin); in Ideas, "Summarize the day" (editor) calls the same
function (`src/lib/resumo.ts`, `POST /resumo`, `PATCH /resumo`). The top 5 leads by `score` from the last 24 hours (news
only) become a carousel with a cover and one card per story. With fewer than 3, no digest is produced and the button
says so. The lead id derives from outlet and day, so a day never produces two digests. Each card shows its own source
and today's date; a card that mixes two stories fails validation. The digest uses the outlet's default art, with no
illustration. Cron `0 21 * * *` (18:00 Brasília, fixed for all outlets).

## Production

`POST /pautas/:id/produzir` starts a `ProducaoWorkflow` (instance `<piece>-r<round>`, `src/workflows/producao.ts`):

1. **Draft** (`src/lib/redacao.ts`): the model writes the piece from the facts only. Idempotent per version.
2. **Validate** (`src/lib/validacao.ts`): deterministic checks. A sentence without a fact, or a number, date or place
   that is not in the source, fails. Up to 3 drafts per round (`MAX_TENTATIVAS`); the 2nd and 3rd exist only if
   validation fails. Failure reasons are written in plain language, per card, in both UI languages.
3. **Illustrate** and **render** the cards (see [Distribution](distribution.md)).
4. The piece arrives in **To approve**.

Piece, lead and document states change only through `transitar` in `src/kernel/estados.ts`: a transition table, a
conditional `UPDATE`, an event and side effects in the same `DB.batch`.

A light status endpoint (`GET /pecas/:id/status`, D1 only) is polled: every 2 s while producing, 15–30 s in review,
stopping at a final state.

## Review

`POST /pecas/:id/revisao` with `aprovar`, `reescrever` or `rejeitar`. The decision is written to `decisoes` and the
transition happens in one batch. The decision's author comes from the authenticated user, never from the body. The
request carries the expected `versao`; a stale version returns `409`.

- **Rewrite** starts the next round of `ProducaoWorkflow`, with the editor's instruction. At most 3 rounds per piece
  (`MAX_RODADAS`): the first plus up to two rewrites.
- **Other headlines** (`POST /pecas/:id/ganchos`): three alternative angles from the model; only those that pass
  `validar` are returned. Cost is added to `pecas.custo_usd`.
- **Shorten to fit** (`POST /pecas/:id/ajuste`): per sentence, and on the title when a card fails with "doesn't fit".
  Two shorter versions generated only from that sentence's fact; each is validated on a copy and against `LIMITES`, and
  any that invents or does not shorten is dropped. Nothing is saved until "Save and check". Not offered for the
  call-to-action card, quotes, documents or sentences marked as the author's.
- **Approve and go to the next**: on pieces from the outlet's site, with a clean check and a single account.

## Publishing

| Approved with | Result |
|---|---|
| A `manual` account | The piece is approved; the operator posts from their phone and records the URL (`POST /pecas/:id/publicada {url}`). |
| Any other account | `PublicacaoWorkflow` (instance `<piece>-pub-<n>`, `src/workflows/publicacao.ts`): waits until the scheduled time, publishes, records in `publicacoes`. |

Account modes (`MODOS_CONTA`): `manual`, `real`, `intermediario`, `simulada`. Media under `/media/*` requires a session
and outlet membership; a short-lived signed route is created at publish time only for the Instagram API to download the
file.

### Autopilot

On the **Sources** tab, "Autopilot" (admin only, off by default; `PATCH /piloto`, `src/lib/piloto.ts`). Without an
account that can post on its own the control is disabled and the screen says what is missing. After review, the
`piloto` step approves a piece only if **all** of these hold:

- autopilot is on; first round; lead with `origem = 'site'`; no special `tipoPost`;
- validation with no error and no warning;
- default account in `real`, `intermediario` or `simulada` mode;
- fewer than `piloto_por_dia` (default 6) approvals in the last 24 hours.

Otherwise the piece stays in **To approve**, with the reason in the `peca.piloto_barrou` event. Posts are spaced by at
least `INTERVALO_PILOTO_MIN` (60 minutes); the slot is reserved in `tenants.piloto_vez_em` with a single `UPDATE`, so
two pieces ready at once do not go out together. The decision is recorded with `por = 'piloto'` and who turned it on;
**Posted** shows "Approved by autopilot".

## Plans and quotas

Plans are configurable in `PLANOS` (`src/lib/planosTabela.ts`); the gate is `produzirPauta`. On a self-hosted install
(`INSTALACAO_PROPRIA=1`, set in this repository's `wrangler.jsonc`) new outlets start on `cortesia`, with no limit and
no billing.

When billing is enabled, new outlets start on `teste` (production blocked until subscription), and paid plans have a
monthly post limit counted in Brasília calendar months. New posts and carousels count; rewrites, Reels, corrections and
re-running a failed production do not. Other headlines, shorten-to-fit and new illustrations are not posts: their cost
counts toward the piece's cost ceiling. At the limit the route answers `402` in both languages; the site queue, the
digest cron and the author onboarding leave the lead in Ideas and record `uso.limite`. Anything already produced can
still be approved and published. Quota and counting happen in the transition batch, so two simultaneous requests cannot
exceed the limit. See [Configuration](../configuration.md) for Stripe.

## Configuration

| Setting | Purpose |
|---|---|
| `MAX_CUSTO_PECA_USD` | Cost ceiling per piece (text + images). Default `0.25`. |
| `DEDUPE` binding | Vectorize index `redacao-dedupe` (1024 dimensions, cosine). |
| `INSTALACAO_PROPRIA` | `1`: self-hosted, no billing, new outlets on `cortesia`. |

Migrations: `0021_fonte_propria.sql`, `0022_resumo.sql`, `0025_piloto.sql`, `0028_planos.sql`.
