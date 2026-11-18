# Integrations

All integrations are optional. Without their variables, the related options are hidden or the routes return `404`,
and the rest of the app is unaffected.

## Google Docs

Reporters can import a Google Doc into the story desk and re-import it after edits. The app requests the
`drive.file` scope, so it only sees the documents the user picks in the Google Picker, and it asks for that scope only
when the user clicks **Connect Google Docs**. Sign in with Google itself only requests email and profile.

1. **Project.** In the [Google Cloud Console](https://console.cloud.google.com/), create or choose a project and note
   its **project number** (Dashboard › Project info).
2. **APIs.** Under APIs & Services › Library, enable the **Google Docs API** and the **Google Picker API**.
3. **OAuth consent screen.** Type **External**. Add your app name, a support email, your domain and links to your
   privacy policy and terms. Add the scopes `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid` and
   `https://www.googleapis.com/auth/drive.file`. In testing mode, only listed test users can connect. Publishing the
   app with `drive.file`, a non-restricted scope, requires only brand and domain verification.
4. **OAuth client.** Credentials › Create credentials › OAuth client ID › Web application.
   - Authorized JavaScript origins: `<PUBLIC_BASE_URL>` (and `http://localhost:8787` for development).
   - Authorized redirect URIs: `<PUBLIC_BASE_URL>/api/auth/callback/google` (and
     `http://localhost:8787/api/auth/callback/google`).
5. **API key for the Picker.** Credentials › Create credentials › API key. Restrict it to HTTP referrers
   `<PUBLIC_BASE_URL>/*` (and `http://localhost:8787/*`) and to the Google Picker API only.
6. **Variables.** Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_API_KEY` (step 5) and
   `GOOGLE_PROJECT_NUMBER` (step 1), in `.dev.vars` locally or with `npx wrangler secret put` in production.
7. **Check.** In the app, open **Outlet › Accounts** and click **Connect Google Docs**. After you accept, the block
   shows *connected*, and the Docs tab of **New idea** opens the Picker.

With only `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, you get Google sign-in without Docs import.

## Instagram

Outlets connect Instagram accounts under **Outlet › Accounts**. Approved pieces are published through the Instagram
Graph API: images and Reels are fetched by Instagram from short-lived signed URLs on your `PUBLIC_BASE_URL`, so that
origin must be publicly reachable over HTTPS. Account tokens are stored encrypted with `TOKEN_ENC_KEY`.

An outlet can also use a **manual** account: pieces are approved, someone posts them from a phone, and records the
post URL in the app.

## Email (right of reply)

Right-of-reply requests can be sent from the app through
[Cloudflare Email Service](https://developers.cloudflare.com/email-service/), so the send time is recorded by the
server.

1. Add your sender domain to Email Service. Sending to arbitrary recipients requires the Workers Paid plan.
2. Add the binding to `wrangler.jsonc`: `"send_email": [{ "name": "EMAIL" }]`.
3. Set `EMAIL_REMETENTE` to a sender address on that domain.
4. For replies, create an Email Routing rule on the same domain that sends `outro-lado+*` (or a catch-all) to this
   Worker. Replies are matched by the token in the address, and unknown tokens are rejected.

Without this setup, the request is copied and sent by the reporter, who records when and how it was sent.

## Stripe

Only for operators who run Gazzpush as a paid service. Leave `INSTALACAO_PROPRIA` unset, so new outlets start on the
`teste` plan and must subscribe before producing. Plans, prices and quotas are defined in `src/lib/planosTabela.ts`;
the amount actually charged is the Stripe price.

1. In Stripe, create a product with two monthly prices and enable the Customer Portal.
2. Create a webhook at `<PUBLIC_BASE_URL>/stripe/webhook` for `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted` and `invoice.payment_failed`.
3. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRECO_PAGINA` and `STRIPE_PRECO_PORTAL` (the two `price_...`
   ids).

Without the four variables, the **Plan** tab says billing is not configured, while plan limits still apply.

## DataJud (Brazil)

Court cases cited in stories (CNJ number format) can be followed through the CNJ's public DataJud API. Set
`DATAJUD_API_KEY` to the public key published in the
[DataJud wiki](https://datajud-wiki.cnj.jus.br/api-publica/acesso). DataJud's
[terms of use](https://datajud-wiki.cnj.jus.br/api-publica/termo-uso) restrict use to legal, non-commercial and
authorized purposes; decide whether your use fits before enabling it. Details in
[living stories](features/living-stories.md).

## Internet Archive and timestamping

Wayback captures and RFC 3161 timestamps work without configuration, using the public Save Page Now endpoint and
FreeTSA. See [configuration](configuration.md#legal-shield) to use authenticated Wayback keys or another timestamp
authority.
