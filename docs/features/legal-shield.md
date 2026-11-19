# Legal shield

Investigative work gets challenged: by the people it names, by their lawyers, sometimes in court. The legal shield
keeps the record that answers those challenges: that the other side was asked to respond and when, what each source
said at the time it was used, which version of the text was published, and who approved it. Everything here is records
and code; no model is involved. Logic lives in `src/lib/shield.ts`; routes in `src/shell/texts.ts` (relative to
`/api/t/:tenantId/textos`). It is part of the [story desk](story-desk.md), so it is available to `autoral` outlets.

## Right of reply

**Ask the other side** (Dossier tab; `POST /:id/pedidos`): recipient, email, deadline, subject and the request. The
request starts from a fixed template in the outlet's language, quoting the risky sentence you selected; the person
can edit it. The sentence must be in the paragraph letter by letter (`422 trecho_fora`).

The request goes out in one of two ways (`MEANS_REQUEST`):

| Method | How it works |
|---|---|
| `email` | Sent by the app through Cloudflare Email Service. The recorded time is the server's. Replies go to `outro-lado+<token>@<sender domain>`. |
| `copiado` | The person copies the request, sends it themselves and records when and how. That time is theirs; the app also records when it was registered. |

A request that went out about a risky sentence records "other side contacted" on that sentence. An email that failed
keeps the reason on screen and offers the copy button. A deadline that passes with no reply is shown on the request
("Deadline passed with no reply. Say so in the text.").

### Replies

A reply becomes evidence in the dossier (`evidencias.origem = 'resposta'`, primary source, no link, no Wayback
capture, outside the daily source monitor). It arrives in one of two ways:

- **By email**, through the Worker's `email` handler (`receiveEmail`). An unknown token is rejected.
- **Pasted by hand**: `POST /:id/pedidos/:pedido/resposta`.

If the paragraph that held the right of reply changes or is removed, the related accusations go back to "to be
checked".

## Wayback captures

Every link added to the dossier is queued for an Internet Archive capture (queue message `wayback`,
`src/lib/wayback.ts`).

- **Without keys**, the app uses the public `GET https://web.archive.org/save/<url>`, which returns the capture address.
- **With `WAYBACK_ACCESS_KEY` and `WAYBACK_SECRET`** (S3-style keys from https://archive.org/account/s3.php), it uses
  the Save Page Now 2 API, with job status and higher limits.

A slow capture goes back to the queue a minute later, up to the queue's last delivery (`ATTEMPTS_QUEUE`, 4). After
that, or if the queue rejected the message, the capture is marked failed with the reason and offers **Try again**
(`POST /:id/evidencias/:evidencia/wayback`).

## Text versions

A snapshot of the text (`texto_versoes`, `src/lib/versions.ts`) is taken at each check, each sign-off, each send to
Instagram, each sources-page publication and each defense package.

## Defense package

**Download the defense package** (Dossier tab; `GET /:id/pacote`, editors only) builds a zip:

| Path | Contents |
|---|---|
| `texto/` | `atual.json`, `atual.txt` and every version under `texto/versoes/`. |
| `dossie/` | The stored text of each source, the Wayback copy when there is one, right-of-reply answers, and `evidencias.json` with hashes and dates. PDFs under `dossie/documentos/` (with `documentos.json`: questions, answers, citations, discards). Recordings and their `*.transcricao.json` under `dossie/gravacoes/`. |
| `apuracao/` | `marcas.json`, `decisoes.json` (who and when), `assinaturas.json`, `checklist.json`. |
| `outro-lado/pedidos.json` | Right-of-reply requests and answers. |
| `lai/pedidos.json` | FOI requests, appeals and replies. See [Living stories](living-stories.md#foi-requests-brazil). |
| `depois/alertas.json` | Follow-up alerts. |
| `posts/` | Each approved post: version, who approved and when, the artwork (JPG sent to Instagram and PNG), the Reels MP4 and the publication. |
| `pagina-de-fontes.json` | The public sources page, if any. |
| `manifesto.json` | SHA-256 of every file in the package. |
| `manifesto.json.tsr` | RFC 3161 timestamp of the manifest. |
| `LEIA-ME.txt` | Human-readable explanation and verification steps. |

The zip is built in the Worker's memory (128 MB). Binary files (PDFs, audio, artwork, Wayback copies) share a budget of
40 MB per package (`BUDGET_PACKAGE`). Anything that does not fit, or is missing from storage, is left out and listed
under `foraDoPacote` in the manifest (with the SHA-256 recorded at upload) and in `LEIA-ME.txt`; the screen reports how
many through the `x-pacote-fora` header. If the timestamp authority is down, the package is still produced without the
`.tsr`, and both `LEIA-ME.txt` and the screen say why. Each package is recorded in `pacotes_defesa`, and its timestamp is
also stored in R2 under `pacotes/`.

### Timestamps

`src/lib/timestamp.ts` (PKI.js) requests an RFC 3161 timestamp from FreeTSA (`https://freetsa.org/tsr`, free, no key)
by default. Set `TSA_URL` to use another authority (for example `http://timestamp.digicert.com`); `TSA_RAIZ`, the
authority's root certificate in base64 DER, is then **required**: without a trusted root the app does not timestamp.
The FreeTSA root ships in the code.

Before adding a token to the package the app verifies it: the hash is the manifest's, the nonce matches the request,
the signature is valid, and the certificate chain reaches the trusted root, valid at the time of the timestamp and
with `timeStamping` as a critical extended key usage (RFC 3161 §2.3).

### Verifying a package without the app

```sh
curl -O https://freetsa.org/files/tsa.crt -O https://freetsa.org/files/cacert.pem
openssl ts -verify -data manifesto.json -in manifesto.json.tsr -CAfile cacert.pem -untrusted tsa.crt   # "Verification: OK"
openssl ts -reply -in manifesto.json.tsr -text                                                         # the authority's time
sha256sum dossie/01-*.txt   # each file must match its hash in manifesto.json
```

Change a file and its hash no longer matches the manifest. Change the manifest and the timestamp no longer verifies.

## Sheet for the lawyer

**Sheet for the lawyer** (`GET /:id/folha`) downloads a short PDF with only the sentences that carry a risk mark: the
risk type, the evidence (literal passage and link, checked against the stored source) and the right of reply (who,
date, answer). It carries the version, date and SHA-256 of the content. The model's note is not included, no sentence
is rewritten and nothing is suggested. If the current version has not been checked, the sheet says to check it first;
if there is no risk, the sheet says so.

## Public sources page: "How we reported this"

**Publish the sources page** (`POST`/`DELETE /:id/pagina-fontes`) creates a public page served by the Worker at
`/fontes/:id`, without a session. It can only be published by an editor, from the checked version, with the same
checklist as Instagram (`409` if something is pending without a sign-off).

It is a frozen snapshot: each sourced sentence with the literal passage from its source, the author's opinion marked as
opinion, and the list of sources with link and Wayback copy. Documents appear by name, without a link. Left out:
unsourced or risky sentences, check explanations, right-of-reply requests and answers, team names and internal ids.
Publishing again takes the previous page down; the address is random.

**Final card.** With the page live, "Send to Instagram" can replace the standard call-to-action card with a card that
links to the sources page, and the caption closes with it (`chooseCta`, `pautas.fontes_url`).

## Configuration

All optional. Without them, right-of-reply requests are copied, Wayback uses the public endpoint and timestamps use
FreeTSA.

```sh
# Outgoing email (Cloudflare Email Service). Sending to any recipient requires Workers Paid and the domain set up in
# Email Service. In wrangler.jsonc: "send_email": [{ "name": "EMAIL" }]
npx wrangler secret put EMAIL_REMETENTE      # sender address on a domain verified in Email Service
# Replies: Email Routing on the same domain with a catch-all (or outro-lado+*) rule pointing to this Worker.
npx wrangler secret put WAYBACK_ACCESS_KEY   # archive.org S3 keys (Save Page Now with higher limits)
npx wrangler secret put WAYBACK_SECRET
npx wrangler secret put TSA_URL              # another RFC 3161 authority (default FreeTSA)
npx wrangler secret put TSA_RAIZ             # required with TSA_URL: the authority's root certificate, DER in base64
#   e.g.: openssl x509 -in root.pem -outform DER | base64 -w0
```

Migration: `0012_escudo.sql` (tables `pedidos_outro_lado`, `texto_versoes`, `paginas_fontes`, `pacotes_defesa`).
Dependencies: `pkijs`, `asn1js`, `fflate`, `postal-mime`.
