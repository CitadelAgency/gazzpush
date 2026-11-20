# Configuration

Gazzpush reads its configuration from Worker bindings (declared in `wrangler.jsonc`) and environment variables. In
local development, variables come from `.dev.vars` (copy `.dev.vars.example`). In production, set non-secret
variables in `wrangler.jsonc` under `vars` and secrets with:

```sh
npx wrangler secret put NAME
```

The source of truth is the `Env` interface in [`src/env.ts`](../src/env.ts). After you change `wrangler.jsonc`,
regenerate the binding types with `npm run types`.

Most features are optional and degrade gracefully: without the variable, the feature is hidden or falls back, and the
UI says so. Nothing else stops working.

## Required

| Variable | Description |
|---|---|
| `PUBLIC_BASE_URL` | Public origin of the app, for example `https://news.example.org` or `http://localhost:8787`. Used as the auth base URL, for cookies and CSRF, and for signed media URLs that Instagram downloads. Serve the app from this single host. |
| `BETTER_AUTH_SECRET` | At least 32 random characters. Signs session cookies. |
| `TOKEN_ENC_KEY` | Random key that encrypts social tokens and per-outlet AI keys. Keep a copy: without it, stored credentials cannot be decrypted after a reinstall. |
| `CF_ACCOUNT_ID` | Your Cloudflare account id. Used to build AI Gateway URLs. |
| `AI_GATEWAY_ID` | Name of an [AI Gateway](https://developers.cloudflare.com/ai-gateway/) in your account. When set, calls to DeepSeek, Gemini, Anthropic and fal go through it (logs, caching, rate limits). Leave it empty to call providers directly. |

Generate random secrets with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## Installation mode

| Variable | Description |
|---|---|
| `INSTALACAO_PROPRIA` | `"1"` for a self-hosted install (the default in this repository's `wrangler.jsonc`). New outlets start on the unlimited `cortesia` plan, there is no billing, and `/` without a session goes to sign-in instead of the waitlist. |
| `MAX_CUSTO_PECA_USD` | Spending cap per piece for text and images, in US dollars. Default `0.25`. |
| `ADMIN_USER_IDS` | Comma-separated `user.id` values allowed to use `/api/admin/*`, including the token usage panel. Use ids, not emails: sign-up does not verify email addresses. |

## AI providers

Each outlet can bring its own keys under **Publication › AI keys**, stored encrypted with `TOKEN_ENC_KEY`. Outlets can
choose between **separate keys (BYOK)** — DeepSeek or Gemini for text, Anthropic for second opinion, Kie or fal for
illustrations — or **one key for everything via [Kie.ai](https://kie.ai?ref=6bb5696952ed37a98d23e2af63cbc03c)** *(affiliate
link)*, which routes text (Gemini Flash), second opinion (Claude) and illustrations (Grok Imagine) through a single
`KIE_API_KEY`. Kie.ai is strictly opt-in for text and second opinion: nothing switches unless the admin explicitly
chooses it.

A server key is a fallback for outlets without their own; when you set one, every outlet that has no key of its own
spends from your account. Leave server keys empty if each outlet should pay for its own usage. Providers, model ids and
prices are defined in one place: [`src/lib/providersTable.ts`](../src/lib/providersTable.ts).

| Variable | Role | Without it |
|---|---|---|
| `DEEPSEEK_API_KEY` | Text: drafting, claim checking, document Q&A | Use Gemini, opt into Kie.ai, or add an outlet key |
| `GEMINI_API_KEY` | Text, as an alternative to DeepSeek | Use DeepSeek, opt into Kie.ai, or add an outlet key |
| `ANTHROPIC_API_KEY` | Second opinion on risky paragraphs and topic routing in the story desk | Checking runs with one opinion (unless the outlet opts into Kie.ai), and the UI says so |
| `SEGUNDA_MODELO` | Model for the second opinion. Default `claude-opus-5-5`; `claude-haiku-5-5` is much cheaper | Default model |
| `KIE_API_KEY` | Illustration through Kie (and optionally text + second opinion when the outlet explicitly opts in under **AI keys**) | Illustrations come from Workers AI (FLUX schnell), with the style described in text |
| `FAL_KEY` | Illustration through fal, as an alternative to Kie | As above |

Workers AI (`AI` binding) handles triage, Whisper transcription, embeddings and vision. It has no key: usage is billed
to your Cloudflare account.

## Optional bindings

| Binding | Description |
|---|---|
| `DOCS_VETOR` | Vectorize index `redacao-documentos` for semantic search in PDFs. Without it, *Ask the document* uses keyword search only. |
| `EMAIL` | Cloudflare Email Service binding (`"send_email": [{ "name": "EMAIL" }]` in `wrangler.jsonc`) for sending right-of-reply requests. Without it, requests are copied and sent by the reporter. |
| `REELS` | Durable Object in front of the Reels container. Required to render Reels in production. |

| Variable | Description |
|---|---|
| `BUSCA_VETORIAL` | Set to `desligada` to force keyword-only document search, even with `DOCS_VETOR`. |
| `REELS_URL_LOCAL` | Development only: base URL of a Reels container started with `docker run`, for example `http://localhost:8080`. See [self-hosting](self-hosting.md#reels-container). |

## Legal shield

| Variable | Description |
|---|---|
| `EMAIL_REMETENTE` | Sender address on a domain verified in Cloudflare Email Service. Replies return to `outro-lado+<token>@<that domain>`; route them to the Worker with an Email Routing catch-all rule. |
| `WAYBACK_ACCESS_KEY`, `WAYBACK_SECRET` | Internet Archive S3 keys from <https://archive.org/account/s3.php>. Enables the authenticated Save Page Now API with higher limits. Without them, the public endpoint is used. |
| `TSA_URL` | RFC 3161 time-stamping authority. Default: FreeTSA (`https://freetsa.org/tsr`). |
| `TSA_RAIZ` | Trusted root certificate of the authority in `TSA_URL`, DER or PEM in base64. Required when `TSA_URL` is set; the FreeTSA root ships in the code. Without a trusted root, the app does not timestamp. |

## Brazil-specific

| Variable | Description |
|---|---|
| `DATAJUD_API_KEY` | Public API key of the CNJ's DataJud, published in the [DataJud wiki](https://datajud-wiki.cnj.jus.br/api-publica/acesso). Enables tracking of court cases cited in stories. DataJud's [terms of use](https://datajud-wiki.cnj.jus.br/api-publica/termo-uso) restrict use to legal, non-commercial and authorized purposes: review them before enabling it. |

## Sign-in and Google

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Enables *Sign in with Google*. Redirect URI: `<PUBLIC_BASE_URL>/api/auth/callback/google`. Without them, only email and password. |
| `GOOGLE_API_KEY`, `GOOGLE_PROJECT_NUMBER` | With the two above, enables Google Docs import through the Google Picker. See [integrations](integrations.md#google-docs). |

## Billing

Only relevant if you run Gazzpush as a paid service (`INSTALACAO_PROPRIA` unset). Plans and quotas are defined in
[`src/lib/plansTable.ts`](../src/lib/plansTable.ts). See [integrations](integrations.md#stripe).

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret key. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the webhook at `<PUBLIC_BASE_URL>/stripe/webhook`. |
| `STRIPE_PRECO_PAGINA`, `STRIPE_PRECO_PORTAL` | Stripe `price_...` ids of the two paid plans. The plan is always derived from the price, never from the client. |

## Test-only overrides

These point the Worker at fakes in tests and end-to-end runs. Do not set them in production.

`DEEPSEEK_URL`, `GEMINI_URL`, `SEGUNDA_URL`, `KIE_URL`, `FAL_URL`, `WHISPER_URL`, `WAYBACK_URL`, `DATAJUD_URL`,
`STRIPE_URL`.
