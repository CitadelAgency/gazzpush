import type { ReelsPace } from './lib/reelsHtml';
import type { Format } from './kernel/states';

// Worker bindings. Regenerate worker-configuration.d.ts with `npm run types` when wrangler.jsonc changes.
export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  CONFIG: KVNamespace;
  MONITOR_QUEUE: Queue<MonitorMessage>;
  PRODUCAO_WORKFLOW: Workflow<ProductionParams>;
  PUBLICACAO_WORKFLOW: Workflow<PublicationParams>;
  REELS: DurableObjectNamespace<import('./reelsContainer').ReelsContainer>;   // Reels container (Phase 4)
  AI: Ai;
  BROWSER: BrowserRun;
  DEDUPE: VectorizeIndex;
  DOCS_VETOR?: VectorizeIndex;   // ask the document: redacao-documentos index (bge-m3, 1024, cosine), one namespace per file
  METRICS: AnalyticsEngineDataset;

  // Secrets (.dev.vars locally, `wrangler secret put` in production)
  PUBLIC_BASE_URL: string;        // the Worker's public origin: auth baseURL, signed media URLs (Instagram downloads from here)
  REELS_URL_LOCAL?: string;       // dev only: the Reels Container under `docker run` (http://localhost:8080), in place of the binding
  STRIPE_SECRET_KEY?: string;     // billing: with all four, the Plan tab subscribes and manages; without them, it says billing is not configured
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRECO_PAGINA?: string;   // price id of each plan: the plan comes from there, never from the client
  STRIPE_PRECO_PORTAL?: string;
  STRIPE_URL?: string;            // tests only: the API base (e2e uses a fake Stripe)
  BETTER_AUTH_SECRET: string;     // ≥ 32 random characters; signs session cookies
  GOOGLE_CLIENT_ID?: string;      // Google sign-in; without it, email/password only
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_API_KEY?: string;        // Google Picker (the project's API key, restricted to the domain); with all 4, Docs appears
  GOOGLE_PROJECT_NUMBER?: string; // Google Picker: the project number in Google Cloud (appId)
  ADMIN_USER_IDS?: string;        // user.id (comma-separated) with access to /api/admin/*. Ids, not emails: sign-up is open and does not verify email
  CF_ACCOUNT_ID: string;
  AI_GATEWAY_ID: string;
  DEEPSEEK_API_KEY?: string;      // text (drafting, check...); the outlet can use its own, in the AI keys tab
  DEEPSEEK_URL?: string;          // local tests only: the chat/completions address (e2e uses a fake model)
  BUSCA_VETORIAL?: string;        // 'desligada': ask the document by word only (e2e; without spending the remote index)
  WHISPER_URL?: string;           // tests only: swaps Workers AI Whisper for a fake server with the same response
  DATAJUD_API_KEY?: string;       // DataJud public key (CNJ wiki); without it, the text's court cases are not tracked
  DATAJUD_URL?: string;           // tests only: the DataJud API base
  TSA_URL?: string;               // RFC 3161 timestamping authority (default FreeTSA; e2e uses a fake one)
  TSA_RAIZ?: string;              // trusted root of the TSA_URL authority (PEM, or DER in base64); FreeTSA's ships in the code
  WAYBACK_URL?: string;           // local tests only: Wayback Machine base (default https://web.archive.org)
  WAYBACK_ACCESS_KEY?: string;    // optional: archive.org S3 key (Save Page Now with a higher limit)
  WAYBACK_SECRET?: string;
  EMAIL?: SendEmail;              // Cloudflare Email Service (send_email binding); without it, the other-side request is copied
  EMAIL_REMETENTE?: string;       // sender address (domain registered in Email Service); replies come back to outro-lado+token@ that domain
  ANTHROPIC_API_KEY?: string;     // second opinion and topic bias in the check (src/lib/secondOpinion.ts); without it, a single opinion
  SEGUNDA_MODELO?: string;        // second-opinion model (default claude-opus-5-5; claude-haiku-5-5 costs ~40× less)
  SEGUNDA_URL?: string;           // local tests only: Anthropic API base (e2e uses a fake model)
  XAI_API_KEY?: string;
  KIE_API_KEY?: string;           // illustration (Grok image-edit through Kie); without it the piece goes out with a flat background
  KIE_URL?: string;               // tests only: Kie API base (tasks and balance)
  // Server keys for the providers an outlet can choose (src/lib/providersTable.ts). They apply when the outlet did not
  // paste its own in the AI keys tab; with neither, the feature is off.
  GEMINI_API_KEY?: string;        // text through Gemini (Google AI Studio), the outlet's choice in place of DeepSeek
  GEMINI_URL?: string;            // tests only: Gemini API base (e2e uses a fake model)
  FAL_KEY?: string;               // illustration through fal (the same Grok Imagine edit), the outlet's choice in place of Kie
  FAL_URL?: string;               // tests only: fal base (generating and checking the key; e2e uses a fake)
  INSTALACAO_PROPRIA?: string;    // '1': self-hosted install without billing. A new outlet is born on cortesia, and "/" without a session goes to /entrar
  MAX_CUSTO_PECA_USD?: string;    // cap per piece (text + image); default 0.25
  TOKEN_ENC_KEY: string;
}

export type MonitorMessage =
  | { tipo: 'fonte'; tenantId: string; fonteId: string }
  | { tipo: 'documento'; tenantId: string; documentoId: string }
  // Daily digest (src/lib/digest.ts, 18:00 Brasília cron).
  | { tipo: 'resumo'; tenantId: string; dia: string }
  // A newly created author outlet: the feed's most recent texts become leads and go into production (src/lib/author.ts).
  | { tipo: 'autoral'; tenantId: string; por: string; urls: string[]; tentativa?: number }
  // Review desk: re-reads a dossier evidence page and flags whether it changed (src/lib/desk.ts, daily cron).
  | { tipo: 'evidencia'; tenantId: string; evidenciaId: string }
  // A copy of the evidence on the Wayback Machine (src/lib/wayback.ts); a slow capture goes back to the queue.
  | { tipo: 'wayback'; tenantId: string; evidenciaId: string }
  // Dossier PDF: reads the pages, indexes them and extracts entities and totals (src/lib/document.ts).
  | { tipo: 'arquivo'; tenantId: string; arquivoId: string }
  // Interview audio: transcribes with Whisper (src/lib/recording.ts).
  | { tipo: 'gravacao'; tenantId: string; arquivoId: string }
  // Recording in the app: one segment of the recording (src/lib/recordingSession.ts).
  | { tipo: 'segmento'; tenantId: string; arquivoId: string; n: number }
  // Reels with the owner's voice (src/lib/narration.ts).
  | { tipo: 'narracao'; tenantId: string; narracaoId: string }
  // A lawsuit cited in a story: checks DataJud and alerts on new movement (src/lib/living.ts).
  | { tipo: 'processo'; tenantId: string; processoId: string }
  // A story's LAI deadlines (daily cron, one message per text): overdue or 3 days out becomes an alert (src/lib/living.ts).
  | { tipo: 'lai'; tenantId: string; textoId: string }
  // Certificate for the published post: never holds up publishing.
  | { tipo: 'certidao'; tenantId: string; pecaId: string }
  // X-ray: the vision model reads one thumbnail.
  | { tipo: 'raiox'; tenantId: string; itemId: string };

/** One production round. Instance: `${pecaId}-r${rodada}`. Ends with the piece in review (or failed). */
export interface ProductionParams {
  tenantId: string;
  pautaId: string;
  pecaId: string;
  formato: Format;
  rodada: number;
  instrucao?: string;             // rewrite requested by the editor in review
  ritmo?: ReelsPace;             // Reels: pace and movement of the request
  narracao?: string | null;       // Reels: the checked take; the Workflow reads the row
  /** Reels: the source carousel (the version that was on screen) and the music library track, if any. */
  origem?: {
    pecaId: string; versao: number;
    capa: { png: string; jpg: string };   // frozen at request time: editing afterwards does not change the Reels art
    ilustracao: string | null;
    em: string;                           // ISO of the request (date for a card without a fact date)
  };
  musica?: string | null;
}

/** Automatic publishing of an approved piece. Instance: `${pecaId}-pub-${n}`. */
export interface PublicationParams {
  tenantId: string;
  pautaId: string;
  pecaId: string;
  contaId: string;
  agendadoPara?: string;          // ISO; without it, publishes now
}
