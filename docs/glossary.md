# Glossary

Gazzpush was built in a Brazilian newsroom, and its source code keeps the Portuguese domain vocabulary: table names,
routes, functions and file names use the words reporters and editors use every day. The user interface ships in
Portuguese and English, and this glossary is the bridge between the two when you read the code.

Each entry gives the Portuguese term as it appears in code, the English term used in the docs and in the English
UI, and where to look.

## Newsroom and tenancy

| In code | In English | Notes |
|---|---|---|
| `veiculo`, `tenant` | outlet | A newsroom, publication or independent author. Every row belongs to one (`tenant_id`). Routes live under `/api/t/:tenantId/...`. |
| `membro`, `membros` | member | A user's role in an outlet: `admin`, `editor` or `reporter` (`PAPEIS` in `src/kernel/estados.ts`). Checked by `requireMembro` in `src/shell/tenancy.ts`. |
| `convite` | invite | Invitation to join an outlet (`src/shell/convites.ts`). |
| `modo` | outlet mode | `local` (filters by city and neighborhood), `tematico` (thematic: filters by topic) or `autoral` (author: an individual journalist's outlet, with the story desk). |
| `plano` | plan | Billing plan of an outlet (`src/lib/planos.ts`). Self-hosted installs default to `cortesia` (unlimited). |
| `chaves` | AI keys | Per-outlet provider keys, encrypted with `TOKEN_ENC_KEY` (`src/lib/provedores.ts`). |
| `uso`, `uso_modelo` | usage | One row per model call, with an estimated cost (`src/lib/uso.ts`). |

## Investigation (the story desk)

| In code | In English | Notes |
|---|---|---|
| `texto`, `textos` | text, story | A piece of journalism being written and verified. The UI section is **Texts**. |
| `materia` | story | The full record of a text: dossier, text, posts and follow-up (`src/lib/materia.ts`). |
| `mesa`, `mesa revisora` | story desk | The editor where each claim is checked against the dossier (`src/lib/mesa.ts`, `web/src/telas/Mesa.tsx`). |
| `dossie` | dossier | The evidence attached to a story: links, PDFs, recordings, replies, FOI responses. |
| `evidencia`, `evidencias` | evidence | One item of the dossier. `origem` says where it came from: `link`, `documento` (a PDF page), `resposta` (a reply) or `lai` (an FOI response). |
| `afirmacao`, `afirmacoes` | claim | A sentence of the text that asserts a fact, with its verification state. |
| `bloco`, `blocos` | block | A paragraph or heading of the editor document, with a stable id and a content hash. |
| `conferir`, `conferencia` | check, verification | Matching claims against evidence. The model points, the code verifies the literal passage. |
| `trecho` | passage | A literal excerpt. `trecho_fora` (HTTP 422) means the passage isn't in the source, letter by letter. |
| `apuracao`, `apuracoes` | reporting decision | What a person decided about a claim: pin a source, add a link, "I contacted the other side", "it's opinion", ignore. |
| `assinatura` | sign-off | An editor signing the publication checklist for one version, with what was still pending. |
| `manual de redacao` | style guide | Mechanical, outlet-specific rules (spelling, acronyms, numbers, titles). |
| `revisor` | blue-pencil reviewer | Fixed, code-generated questions in the margin of each paragraph (`src/lib/revisor.ts`). No model involved. |
| `bancada` | editor's bench | Writing and release helpers: interview quotes, versions, promotion text, second read (`web/src/materia/Bancada.tsx`). |
| `material`, `recorte` | source material, clipping | The source organizer next to the text: clippings, saved source text, a single search (`src/lib/material.ts`). |
| `acervo` | archive | The outlet's saved sources and clippings, reusable across stories. |
| `segunda opiniao` | second opinion | An independent check by a second model on risky paragraphs (`src/lib/segunda.ts`). |
| `auditoria` | audit | Flags per month, topic and person, to see whether verification weighs more heavily on one side (`src/lib/assistente.ts`). |

## Legal shield and follow-up

| In code | In English | Notes |
|---|---|---|
| `escudo` | legal shield | Right of reply, Wayback captures, versions, defense package, public sources page (`src/lib/escudo.ts`). |
| `outro lado`, `pedidos_outro_lado` | right of reply, other side | The request sent to anyone accused in a text, and their answer. |
| `pacote de defesa` | defense package | A zip with every version, source, decision and post, hashed and timestamped (RFC 3161). |
| `carimbo` | timestamp | RFC 3161 time-stamp token (`src/lib/carimbo.ts`). |
| `folha para o advogado` | sheet for the lawyer | A short PDF with only the risky sentences, their evidence and the right of reply. |
| `pagina de fontes` | sources page | The public "How we reported this" page served at `/fontes/:id`. |
| `documento`, `arquivo` | document, file | An uploaded PDF or audio file of the dossier. ("Ask the document": `src/lib/documento.ts`.) |
| `gravacao`, `gravacoes` | recording | Interview audio, transcribed with Whisper to check quotes (`src/lib/gravacao.ts`). |
| `aspas` | quotes | Quoted speech in the text, checked against sources and recordings. |
| `viva`, `materia viva` | living story | Alerts after publication: changed sources, people in new news, court movements, FOI deadlines (`src/lib/viva.ts`). |
| `alerta`, `alertas` | alert | Shown in the story's **After** tab. |
| `errata`, `atualizacao` | correction, update | Follow-up posts created from an alert. |
| `processo` | court case | A Brazilian case number (CNJ format), tracked through the DataJud API. |
| `LAI`, `pedidos_lai` | FOI request | Brazil's Access to Information Law (Lei 12.527/2011): request, deadline, appeal, complaint (`src/lib/lai.ts`). |
| `wayback` | Wayback capture | Archive.org snapshot of each dossier link (`src/lib/wayback.ts`). |

## Monitoring and production

| In code | In English | Notes |
|---|---|---|
| `fonte`, `fontes` | source | A monitored feed or site. (In the story desk, "source" also means a piece of evidence.) |
| `documento` (monitor) | document | An item fetched from a source: raw in R2, text and metadata in D1. |
| `triagem` | triage | Classifying a fetched item with a constrained JSON schema (`src/lib/triagem.ts`). |
| `spans` | spans | Extraction of passages, places and dates that exist literally in the text (`src/lib/spans.ts`). |
| `fato`, `fatos` | fact | A sourced statement a piece may use. Every sentence of a piece must point to one. |
| `pauta`, `pautas` | lead | A story idea with its facts. The UI section is **Ideas**. |
| `peca`, `pecas` | piece | A produced post (carousel, single image, Reels) with its versions. |
| `rodada` | round | One production attempt of a piece (at most three). |
| `redacao`, `redigir` | drafting | The model writes the piece from the facts only (`src/lib/redacao.ts`). |
| `validacao`, `validar` | validation | Deterministic checks before human review: sentence without a fact, number, date or place not in the source (`src/lib/validacao.ts`). |
| `revisao` | review | Human approval of a piece: approve, rewrite or reject. |
| `aprovar`, `postar`, `postados` | to approve, to post, posted | The UI sections **To approve**, **Ready to post** and **Posted**. |
| `publicacao`, `publicar` | publishing | Sending an approved piece to an account (`src/lib/publicar.ts`). |
| `conta`, `contas` | account | A social account the outlet publishes to. `modo` is `manual`, `real`, `intermediario` or `simulada` (`MODOS_CONTA`). |
| `card`, `capa`, `convite` | card, cover, call-to-action card | The slides of a carousel. |
| `estilo`, `modelo` | template | Per-outlet visual template: composition, colors, layouts (`src/lib/estilo.ts`). |
| `marca` | brand | Outlet name, logo, colors and fonts. |
| `ilustracao`, `ilustrar` | illustration | Generated artwork for a piece, never a third-party photo (`src/lib/ilustrar.ts`). |
| `patrocinio` | sponsorship | A labelled sponsor band on cards (`migrations/0020_patrocinios.sql`). |
| `anuncio` | advertiser post | A labelled paid post tied to the advertiser's briefing (`src/lib/anuncio.ts`). |
| `piloto` | autopilot | Automatic approval of pieces from the outlet's own site under strict conditions (`src/lib/piloto.ts`). |
| `resumo` | daily digest | A carousel with the day's top leads (`src/lib/resumo.ts`). |
| `kit`, `certidao` | takedown kit, publication certificate | What to do if the social account is suspended, and a timestamped record of each post (`src/lib/kit.ts`, `src/lib/certidao.ts`). |
| `raiox` | account X-ray | Reads an Instagram data export to find posts without image credit (`src/lib/raiox.ts`). |
| `reels` | Reels | The 9:16 animated version of a carousel, rendered in a container (`container/reels/`). |
| `narracao` | narration | The outlet owner's voice over a Reels, checked against the script (`src/lib/narracao.ts`). |
| `lista de espera` | waitlist | Public waitlist page of the hosted service (`src/lib/listaEspera.ts`). |

## Code layout words

| In code | In English |
|---|---|
| `casca` | app shell (layout, sidebar, command palette) |
| `telas` | screens |
| `kit` (web) | UI kit components |
| `estilo` (web) | design tokens and global CSS |
| `kernel/estados.ts` | state machine for pieces, leads and documents |
| `shell/` (Worker) | HTTP layer: routes, auth, tenancy |
| `lib/` (Worker) | domain logic, mostly pure functions |
| `workflows/` | Cloudflare Workflows (production, publishing) |
| `monitor/` | cron and queue consumer |
