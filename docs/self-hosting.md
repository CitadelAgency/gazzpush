# Self-hosting

This guide deploys Gazzpush to your own Cloudflare account. The result is a private newsroom instance that you
control: your data stays in your account's D1 database and R2 bucket, and model calls go to the providers whose keys
you configure.

The repository ships in self-hosted mode (`INSTALACAO_PROPRIA=1` in `wrangler.jsonc`). There is no billing, new outlets
get the unlimited `cortesia` plan, and each outlet can bring its own AI keys.

## Before you start

You need:

- **A Cloudflare account.** The Workers Paid plan (US$ 5/month) is required for Containers (Reels) and for sending
  email to arbitrary recipients, and recommended for production: free-plan limits on CPU time and Browser Rendering
  are tight for a working newsroom.
- **Node.js 24** and npm.
- **Docker**, running on the machine you deploy from, if you want Reels. `wrangler deploy` builds the container image
  from `container/reels/Dockerfile` and pushes it to Cloudflare's registry.
- **AI model keys**: either bring your own separate keys (DeepSeek or Gemini for text, plus optional Anthropic for
  second opinion and Kie or fal for illustration) or opt into a single **[Kie.ai](https://kie.ai?ref=6bb5696952ed37a98d23e2af63cbc03c)**
  key *(affiliate link)* for text, second opinion and illustrations. Keys can be configured per outlet under
  **Publication › AI keys**.

## 1. Get the code

```sh
git clone https://github.com/CitadelAgency/gazzpush.git
cd gazzpush
npm ci
npx wrangler login
```

## 2. Create the Cloudflare resources

The names below match `wrangler.jsonc`. If you choose different names, update the file.

```sh
npx wrangler d1 create redacao-db
npx wrangler kv namespace create CONFIG
npx wrangler r2 bucket create redacao-media
npx wrangler queues create redacao-monitor
npx wrangler queues create redacao-monitor-dlq
npx wrangler vectorize create redacao-dedupe --dimensions=1024 --metric=cosine
npx wrangler vectorize create redacao-documentos --dimensions=1024 --metric=cosine
```

Copy the D1 `database_id` and the KV namespace `id` from the output into `wrangler.jsonc`, replacing
`<D1_DATABASE_ID>` and `<KV_NAMESPACE_ID>`.

Optionally, create an [AI Gateway](https://developers.cloudflare.com/ai-gateway/) in the dashboard. It gives you logs,
caching and rate limits for every model call.

## 3. Choose the public address

By default the Worker is served at `https://redacao.<your-subdomain>.workers.dev`. To use your own domain, uncomment
the `routes` and `workers_dev` lines at the top of `wrangler.jsonc` and set your hostname.

Cookies and CSRF protection are bound to the origin in `PUBLIC_BASE_URL`, so serve the app from one host only.

## 4. Set the secrets

```sh
npx wrangler secret put PUBLIC_BASE_URL       # e.g. https://news.example.org (HTTPS, final origin)
npx wrangler secret put BETTER_AUTH_SECRET    # 32+ random characters
npx wrangler secret put TOKEN_ENC_KEY         # a different random value; back it up
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put AI_GATEWAY_ID         # gateway name, or skip to call providers directly
npx wrangler secret put DEEPSEEK_API_KEY      # or GEMINI_API_KEY; optional if outlets bring their own
```

Generate random values with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

> **Back up `TOKEN_ENC_KEY`.** It encrypts social tokens and per-outlet AI keys. If you lose it, those credentials
> cannot be decrypted and must be entered again.

A server-level provider key is shared by every outlet that has not added its own. If each outlet should pay for its
own usage, leave the server keys empty. All other variables are optional; see [configuration](configuration.md).

## 5. Build, migrate and deploy

```sh
npm run web:build     # build the React app into web/dist
npm run db:migrate    # apply migrations/ to the remote D1 database
npm run deploy        # wrangler deploy: Worker, assets, Workflows, cron, container
```

Check `https://<your-host>/health`, which should return `{"ok":true}`. Then open the app, create the first account
and set up your first outlet.

To restrict the admin endpoints (`/api/admin/*`, including token usage), copy your user id from the database and set
`ADMIN_USER_IDS`:

```sh
npx wrangler d1 execute redacao-db --remote --command "SELECT id, email FROM user"
npx wrangler secret put ADMIN_USER_IDS
```

## 6. Optional features

| Feature | What to set up | Guide |
|---|---|---|
| Right-of-reply email | Email Service sender domain, `send_email` binding, `EMAIL_REMETENTE`, Email Routing rule for replies | [Legal shield](features/legal-shield.md) |
| Higher Wayback limits | `WAYBACK_ACCESS_KEY`, `WAYBACK_SECRET` | [Legal shield](features/legal-shield.md) |
| Another timestamp authority | `TSA_URL`, `TSA_RAIZ` | [Configuration](configuration.md#legal-shield) |
| Second opinion | `ANTHROPIC_API_KEY` | [Story desk](features/story-desk.md) |
| Court-case tracking (Brazil) | `DATAJUD_API_KEY`, after reviewing DataJud's terms | [Living stories](features/living-stories.md) |
| Google sign-in and Docs import | Google Cloud OAuth client and Picker key | [Integrations](integrations.md#google-docs) |
| Reels music library | Licensed tracks and a manifest in R2 | [Distribution](features/distribution.md) |
| Illustration reference images | `referencias/<technique>.png` in R2 | [Distribution](features/distribution.md) |

## Reels container

Reels are rendered by a Cloudflare Container running HyperFrames (Apache-2.0), headless
Chrome and FFmpeg (`container/reels/`), behind the `ReelsContainer` Durable Object.

- The first `npm run deploy` creates the Durable Object (migration `v1` in `wrangler.jsonc`) and the container
  application. Check them with `npx wrangler containers list` and `npx wrangler containers images list`.
- The instance type is `standard-3` (2 vCPU, 8 GiB), with at most 3 instances. Instances sleep shortly after the last
  render.
- Without the container, everything works except rendering video: a Reels request fails with the reason on screen.

The container image installs [GSAP](https://gsap.com/), which is distributed under its own no-charge license, not an
open-source license. It is downloaded at build time and is not part of this repository.

### Running the container in development

`wrangler dev` does not start containers on Windows, so `wrangler.jsonc` disables them in development
(`dev.enable_containers: false`). Run the container in Docker and point the Worker at it:

```sh
cd container/reels
docker build -t gazzpush-reels .
docker run --rm -d --name reels -p 127.0.0.1:8080:8080 --cpus 2 gazzpush-reels
# then add to .dev.vars: REELS_URL_LOCAL=http://localhost:8080
```

On Linux or WSL with Docker, `npx wrangler dev --enable-containers` starts the container through the `ReelsContainer`
class, without the variable.

## Upgrading

```sh
git pull
npm ci
npm run web:build
npm run db:migrate
npm run deploy
```

Migrations are additive and applied in order. Read [CHANGELOG.md](../CHANGELOG.md) before upgrading across releases.

## Costs

You pay Cloudflare for your usage and each AI provider for the tokens you send. The app records an estimated cost for
every model call (`uso_modelo`), and caps spending per piece with `MAX_CUSTO_PECA_USD` (default US$ 0.25). Workers AI
calls (Whisper, triage, embeddings) are billed by Cloudflare and are not included in that estimate.
