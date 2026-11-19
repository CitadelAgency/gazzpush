# Living stories

Publishing is not the end of an investigation. Sources get edited or deleted, the people in the story make news again,
court cases move, and public bodies owe answers on a legal deadline. A living story keeps watching after publication
and turns each change into an alert, with a clear next step: update the text, publish an update or a correction, or
file the next appeal. Logic in `src/lib/living.ts` (alerts and court cases) and `src/lib/lai.ts` (FOI requests); routes
relative to `/api/t/:tenantId/textos`. Part of the [story desk](story-desk.md), available to `autoral` outlets.

> **Brazil-specific.** Court-case tracking (DataJud, CNJ case numbers) and FOI requests (Lei de Acesso à Informação,
> Fala.BR, federal decrees and holidays) implement Brazilian law and public APIs. Source-change and people alerts work
> anywhere.

## Alerts

Alerts appear in the story's **After** tab (table `alertas`), one per fact, never repeated. The **Texts** list shows how
many open alerts each story has.

| Alert | Trigger |
|---|---|
| **Source changed** | The daily dossier monitor re-reads each piece of evidence and its hash changed. |
| **Source unavailable** | A piece of evidence has not responded for 3 attempts in a row. |
| **Person in the news** | A person cited in one of the outlet's stories (a name of two words or more) appears in a new item from the outlet's monitored sources, after triage. |
| **Court case moved** | A case number cited in the text has a new movement in DataJud. |
| **FOI deadline** | An FOI request is 3 days from its deadline, or past it. |

The daily cron (`0 9 * * *` UTC, 06:00 in Brasília) re-reads dossiers, queues court-case checks and recomputes FOI
deadlines, one queue message per text, so deadline alerts appear without anyone opening the story.

### Acting on an alert

Editors only.

- **I updated the text** or **Ignore**: recorded with who and when (`POST /:id/alertas/:alerta/resolver`).
- **Update post** or **Correction post** (`POST /:id/alertas/:alerta/post`): the person writes what changed, 20 to 600
  characters, in their own words; it becomes their statement. A new single-image post is produced with "Atualização:"
  or "Errata:" ("Update:" / "Correction:" for English outlets) in the headline, on the cover and in the caption, added
  by code (`pautas.tipo_post`, `POST_TYPES`). The earlier post is not touched: Instagram does not let you replace the
  image of a published post. The text itself only changes when the person edits it.

If production of the post could not start, the alert goes back to open and the leftover lead is discarded; trying again
creates the post.

## Court cases (DataJud)

A case number cited in the text, in the CNJ unified format (`NNNNNNN-DD.AAAA.J.TR.OOOO`, check digits verified), is
tracked through the CNJ public API:

```
POST https://api-publica.datajud.cnj.jus.br/api_publica_<court>/_search
Authorization: APIKey <key>
```

The court alias is derived from the `J.TR` segment of the number: state courts (TJs), federal regional courts (TRFs),
labor courts (TRTs), electoral courts (TREs), STJ, TST, TSE, STM and state military courts. The Supreme Court (STF) is
not in DataJud. One query per case per day; the first stores the latest movement, and any newer movement becomes an
alert.

> **Terms of use.** DataJud's terms speak of use "for legal, non-commercial and authorized purposes"
> (https://datajud-wiki.cnj.jus.br/api-publica/termo-uso). Tracking is therefore **off until the operator sets the key**,
> after deciding that their use fits those terms.

## FOI requests (Brazil)

Under Brazil's Access to Information Law (Lei 12.527/2011), anyone can request information from a public body without
giving a reason. UI: Dossier tab, **FOI requests (LAI)**.

### Candidates and drafting

An unsourced sentence that cites a public body (Prefeitura, Câmara, Secretaria, Ministério, Tribunal and similar,
detected by code) becomes a candidate. The app drafts the request in Portuguese with its legal basis: Constitution art.
5, XXXIII; Law 12.527/2011, no reason required (art. 10 §3), 20 days extendable by 10 (art. 11 §§1–2), the non-secret
part must be released (art. 7 §2). The sentence is checked letter by letter against the paragraph (`422 trecho_fora`).
Levels (`LEVELS`): `federal`, `estadual`, `municipal`. Route: `POST /:id/lai`.

### Filing

Fala.BR has an API, but it serves the agencies' ombudsman offices, with credentials issued by the CGU, and does not
file citizen requests (https://wiki.cgu.gov.br/index.php?title=Fala.BR_-_API_Faq). So the request is ready to copy and
paste into the portal (Fala.BR for the federal executive, the state or city e-SIC), and **the app never logs into a
government portal**. Afterwards the person records the protocol number and date.

### Deadlines

Counted in calendar days from the filing date (`DAYS_DEADLINE` 20, `EXTENSION_DAYS` 10, `APPEAL_DAYS` 10).

- A deadline that falls on a Saturday, Sunday, national holiday or Good Friday moves to the next business day. For
  federal bodies it also skips the federal optional days (Carnival Monday and Tuesday, Corpus Christi).
- State and city holidays, and optional days decreed for a specific year, are not known to the app; the screen asks
  the person to confirm.
- The person's own deadlines (appeals) never skip optional days, so nobody loses a deadline to a day that does not
  count.

### Next steps

Route: `POST /:id/lai/:pedido/:acao`, with `acao` one of `protocolo`, `prorrogacao`, `resposta`, `recurso`.

| Situation | What the app offers |
|---|---|
| The agency extended | Record the extension date; the deadline moves by 10 days. |
| Reply received | The reply enters the dossier as an official source (`evidencias.origem = 'lai'`) and stays while the request exists. |
| Reply does not meet the request | The **appeal** (Law 12.527 art. 15): within 10 days of notice, to the authority above. Only recorded with a date up to the last day (`422 fora_do_prazo`). |
| Federal body did not reply | The **complaint** (Decree 7.724/2012 art. 22): to the monitoring authority, within 10 days, counted after 30 days from the request. The button only opens when the window opens (`409 cedo`); after it closes, the screen says the deadline ended. |
| Denied again | The next level is the person's to file, and the screen names it: an appeal denied goes to the agency's highest authority (Decree 7.724/2012 art. 21, sole paragraph) and then to the CGU (art. 23); a complaint without result goes directly to the CGU (art. 23). States and cities have their own rules for omissions; the app drafts the appeal and warns. |

Replies to appeals and complaints also enter the dossier.

## In the defense package

`lai/pedidos.json` (with appeals, their replies and the resulting evidence) and `depois/alertas.json`. See
[Legal shield](legal-shield.md#defense-package).

## Configuration

```sh
# Only after deciding your use fits DataJud's (non-commercial) terms. The key is the public one from the CNJ wiki:
# https://datajud-wiki.cnj.jus.br/api-publica/acesso (the CNJ may rotate it).
npx wrangler secret put DATAJUD_API_KEY
```

Migrations: `0015_viva.sql` (tables `alertas`, `processos`, `pedidos_lai`; column `pautas.tipo_post`),
`0016_revisao.sql` (appeal columns on `pedidos_lai`).
