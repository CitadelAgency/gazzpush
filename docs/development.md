# Development

## Setup

```sh
npm ci
cp .dev.vars.example .dev.vars   # then fill PUBLIC_BASE_URL, BETTER_AUTH_SECRET, TOKEN_ENC_KEY
npm run types                    # generate worker-configuration.d.ts (gitignored)
npm run db:migrate:local
```

Run `npm run types` again whenever you change `wrangler.jsonc`.

## Running the app

The web app is served by the Worker from the same origin, so there is no dev proxy. Use two terminals:

```sh
npm run web:dev           # vite build --watch into web/dist
npm run dev -- --local    # wrangler dev on http://localhost:8787
```

Do not proxy Vite's dev server (5173) to the Worker (8787). Cookies, CSRF and signed media URLs all assume a single
origin.

Workers AI, Browser Rendering and Vectorize have no local emulation. Their bindings are marked `remote: true`, so in
development they call your Cloudflare account (`npx wrangler login`). Everything else (D1, R2, KV, Queues, Workflows)
runs locally in workerd.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | `wrangler dev` |
| `npm run web:dev` | Build the web app in watch mode |
| `npm run web:build` | Production build of the web app into `web/dist` |
| `npm run check` | Type-check the Worker, the tests and the web app |
| `npm test` | Run the Vitest suites inside workerd |
| `npm run e2e` | Run the Playwright end-to-end tests |
| `npm run types` | Generate `worker-configuration.d.ts` from `wrangler.jsonc` |
| `npm run db:migrate:local` | Apply migrations to the local D1 database |
| `npm run db:migrate` | Apply migrations to the remote D1 database |
| `npm run auth:schema` | Regenerate `migrations/0002_auth.sql` with the Better Auth CLI (only before a first deploy) |
| `npm run deploy` | `wrangler deploy` |

## Tests

```sh
npm run check
npm test
```

The unit and integration tests in `test/` run the real Worker (from `wrangler.jsonc`) inside workerd through
`@cloudflare/vitest-plugin`, with local D1, R2, KV, Queues and Workflows. Remote bindings are off, and every external
service (DeepSeek, Gemini, Anthropic, Kie, fal, Whisper, Wayback, the timestamp authority, DataJud, Stripe) is replaced
by a fake reached over `fetch`, configured in `vitest.config.ts`. The tests never touch the network or your Cloudflare
account.

They cover state transitions, auth and tenant isolation, Workflow replay and idempotency, queue ownership, and the
pure functions behind checking, arithmetic, deadlines and timestamps.

### End-to-end tests

```sh
npx playwright install chromium
npm run e2e
```

The Playwright suite in `web/e2e/` builds the web app, serves it with `vite preview` and checks the public waitlist
screen at desktop and mobile widths: layout overflow and WCAG 2.1 AA with axe. Set `E2E_ORIGEM` to run it against an already running server.

## Code conventions

- **Language of the code.** Functions, variables and comments are in English. Database tables, routes, stored values and
  the other contract names listed in [CONTRIBUTING](../CONTRIBUTING.md#code-style) keep their Portuguese names; look
  terms up in the [glossary](glossary.md). Docs, issues, pull requests and commit messages are in English.
- **Frozen card templates.** `src/templates/card.html` and `src/templates/cta.html` stay in Portuguese, comments
  included. `test/legacy-hash.test.ts` pins the hash of the HTML they render, so an edit would change the art of
  existing pieces. Do not edit them.
- **Every UI string in both languages**, written in place: `t("Aprovar", "Approve")` in the web app
  (`web/src/language.ts`) and `t(c, "Não encontrado.", "Not found.")` in the Worker (`src/shell/language.ts`). Never call
  `t()` at module top level: switching languages remounts screens, and a constant evaluated at import time would stay
  in the old language. Use a function or a getter.
- **Status changes only through `transition`** in `src/kernel/states.ts`.
- **No writes outside `step.do`** in Workflows, and every step idempotent.
- **Domain logic as pure functions** in `src/lib/`, tested directly. The HTTP layer in `src/shell/` stays thin.
- **Never fail silently.** A failed model call, fetch or job becomes a visible state with a reason.
- **Model output is never trusted.** Verify citations, passages and numbers in code before showing them.
- **Two TypeScript configs**: the Worker builds without DOM types, the web app with them.
- **Migrations are additive.** Add a new numbered file in `migrations/`; never edit one that has shipped.
- **Design changes go through [DESIGN.md](../DESIGN.md)** and the tokens in `web/src/styles/tokens.css`.

## Windows notes

- `wrangler dev` does not run containers on Windows. Use `REELS_URL_LOCAL` with a Docker container, as described in
  [self-hosting](self-hosting.md#running-the-container-in-development).
- On some Windows machines, workerd becomes unstable when many end-to-end specs run against one dev server. If that
  happens, run specs one at a time and restart the server between runs.
