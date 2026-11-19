# Account resilience

Outlets that publish uncomfortable reporting lose social accounts: mass reports, copyright claims, sudden
deactivations. When that happens, the outlet needs proof of what it published and when, a plan for the next days, and a
way for its audience to keep finding it. This page covers publication certificates, the takedown kit, the account
X-ray, and the backup channels. The takedown kit lives in the outlet screen under **If the account goes down**. Routes
are relative to `/api/t/:tenantId`.

## Publication certificates

Every piece actually published gets a certificate (`src/lib/certificate.ts`). `recordPublication` and
`POST /pecas/:id/publicada` queue a `{ tipo: 'certidao' }` message; publishing never waits for it. Pieces published to a
`simulada` (simulated) account get none.

The certificate is issued at publication time on purpose: a timestamp taken after the account goes down proves nothing
about when the post went out.

**Manifest contents:** the sources (URL, SHA-256 and capture date), the SHA-256 of each piece of artwork, the visual
brief and illustration model, who approved (or the autopilot and who turned it on), and the publication. Per card, the
origin of its art: a photo with author and type, a generated illustration with its model, or no art. Photos saved before
the author field existed appear as "not recorded"; a certificate already issued never changes.

**Timestamp:** RFC 3161 over the manifest, from the same authority as the [defense package](legal-shield.md#timestamps).
If the authority is down the message goes back to the queue; once retries are exhausted, the failure shows in
**Posted**.

**Generate certificate** (`POST /pecas/:id/certidao`) covers failures and older posts; in that case the document says
the timestamp is later than the publication.

**Download** (`GET /pecas/:id/certidao`): one zip per piece with `certidao.pdf`, `manifesto.json`, `carimbo.tsr` and
`LEIA-ME.txt`, including the `openssl ts -verify` steps.

## Takedown kit

**If the account goes down** (`GET /kit`, `src/lib/kit.ts`): fixed scripts and text templates, no AI, in Portuguese and
English.

- **What to do now**: the steps for the first hours.
- **Open case** (`POST /kit/casos`, `DELETE /kit/casos/:id`): type (`CASE_TYPES`: `desativada` deactivated,
  `direito_autoral` copyright, `cobranca` billing, `outro` other), a note of up to 500 characters, and the days counted.
  The deadline comes from the notice the person received: the app does not know Meta's deadlines.
- **Three fixed templates** to copy. They are not legal advice; fill in the bracketed fields and adapt them.
- **This month's certificates.**

## Account X-ray

The X-ray reviews an outlet's old posts for third-party material that could trigger a copyright claim
(`src/lib/xray.ts`, `src/lib/xrayQueue.ts`).

1. The person requests their data export from Instagram ("Download your information") in JSON and selects the zip on
   the kit tab.
2. The **browser** reads the zip in streaming, in two passes: first only the JSON files, then only the media. It looks
   for any JSON object with `uri` and `creation_timestamp`, resolves `uri` from the zip root and repairs mis-encoded
   accents. **Private messages are not read.**
3. Each image becomes a JPEG of up to 512 px; a video becomes one frame. Only that thumbnail and the caption are
   uploaded, up to 2,000 items per batch (`MAX_ITEMS_BATCH`). One X-ray per outlet at a time (`POST /raiox`,
   `POST /raiox/:lote/itens`, `DELETE /raiox/:lote`).
4. The `raiox` queue runs `@cf/meta/llama-3.2-11b-vision-instruct` to detect a third-party watermark, a TV, newspaper or
   agency logo, or a photo credit written on the image; code also looks for credits in the caption.

The app never deletes anything and never suggests deleting. Estimated cost: approximately 9 Workers AI neurons per
image (about US$ 0.0001), so a 2,000-item batch is around US$ 0.20 before Workers AI's daily free allocation.

## Backup channels

- **Send to the channel** in **Ready to post**: shares the post to a WhatsApp channel without any API. On mobile it
  uses the system share sheet; on desktop it copies the caption and downloads the files.
- **Public outlet page** at `/v/:slug` (`src/lib/outletPage.ts`): off by default, turned on by an admin in the kit
  (`PATCH /pagina-publica`). It lists posts actually published (never simulated ones), 30 per page, with advertising
  labelled, and nothing internal: only art, caption and link.
- **Download the month** (`GET /kit/mes`, `src/lib/monthArchive.ts`): a zip built in streaming with each post's art,
  caption, link and certificate (`manifesto.json` and `carimbo.tsr`, without the PDF, to avoid opening a browser per
  post). JPEG and MP4 are stored without recompression.

## Configuration

No secrets. Uses the `AI`, `BROWSER` and `MONITOR_QUEUE` bindings and the timestamp settings of the
[legal shield](legal-shield.md#configuration). `/v/*` is in `assets.run_worker_first` in `wrangler.jsonc`.

Migrations: `0026_kit.sql`, `0027_raiox.sql`.
