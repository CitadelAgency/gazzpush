import type { RitmoReels } from './lib/reelsHtml';
import type { Formato } from './kernel/estados';

// Bindings do Worker. Regerar worker-configuration.d.ts com `npm run types` quando o wrangler.jsonc mudar.
export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  CONFIG: KVNamespace;
  MONITOR_QUEUE: Queue<MonitorMessage>;
  PRODUCAO_WORKFLOW: Workflow<ProducaoParams>;
  PUBLICACAO_WORKFLOW: Workflow<PublicacaoParams>;
  REELS: DurableObjectNamespace<import('./reelsContainer').ReelsContainer>;   // Container do Reels (Fase 4)
  AI: Ai;
  BROWSER: BrowserRun;
  DEDUPE: VectorizeIndex;
  DOCS_VETOR?: VectorizeIndex;   // pergunte ao documento: índice redacao-documentos (bge-m3, 1024, cosseno), um namespace por arquivo
  METRICS: AnalyticsEngineDataset;

  // Secrets (.dev.vars local, `wrangler secret put` em produção)
  PUBLIC_BASE_URL: string;
  REELS_URL_LOCAL?: string;       // só dev: o Container do Reels no `docker run` (http://localhost:8080), no lugar do binding        // origem pública do Worker: baseURL do auth, URLs assinadas de mídia (Instagram baixa daqui)
  STRIPE_SECRET_KEY?: string;     // cobrança: com as quatro, a aba Plano assina e gerencia; sem elas, diz que não está configurada
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRECO_PAGINA?: string;   // id do price de cada plano: é daí que o plano vem, nunca do cliente
  STRIPE_PRECO_PORTAL?: string;
  STRIPE_URL?: string;            // só teste: a base da API (o e2e usa uma Stripe falsa)
  BETTER_AUTH_SECRET: string;     // ≥ 32 caracteres aleatórios; assina cookies de sessão
  GOOGLE_CLIENT_ID?: string;      // login Google; sem ele, só e-mail/senha
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_API_KEY?: string;        // Google Picker (chave de API do projeto, restrita ao domínio); com as 4, o Docs aparece
  GOOGLE_PROJECT_NUMBER?: string; // Google Picker: número do projeto no Google Cloud (appId)
  ADMIN_USER_IDS?: string;        // user.id (vírgula) com acesso a /api/admin/*. Id, não e-mail: cadastro é aberto e não verifica e-mail
  CF_ACCOUNT_ID: string;
  AI_GATEWAY_ID: string;
  DEEPSEEK_API_KEY?: string;      // texto (redação, conferência...); o veículo pode usar a dele, na aba Chaves de IA
  DEEPSEEK_URL?: string;          // só teste local: o endereço do chat/completions (o e2e usa um modelo falso)
  BUSCA_VETORIAL?: string;
  WHISPER_URL?: string;
  DATAJUD_API_KEY?: string;       // chave pública do DataJud (wiki do CNJ); sem ela, os processos do texto não são acompanhados
  DATAJUD_URL?: string;           // só teste: base da API do DataJud           // só teste: troca o Whisper do Workers AI por um servidor falso com a mesma resposta        // 'desligada': pergunte ao documento só por palavra (o e2e; sem gastar o índice remoto)
  TSA_URL?: string;               // autoridade de carimbo de tempo RFC 3161 (padrão FreeTSA; o e2e usa uma falsa)
  TSA_RAIZ?: string;              // raiz confiável da TSA de TSA_URL (PEM ou DER em base64); a da FreeTSA vem no código
  WAYBACK_URL?: string;           // só teste local: base do Wayback Machine (padrão https://web.archive.org)
  WAYBACK_ACCESS_KEY?: string;    // opcional: chave S3 do archive.org (Save Page Now com limite maior)
  WAYBACK_SECRET?: string;
  EMAIL?: SendEmail;              // Cloudflare Email Service (binding send_email); sem ele, o pedido de outro lado é copiado
  EMAIL_REMETENTE?: string;       // endereço de quem envia (domínio cadastrado no Email Service); a resposta volta para outro-lado+token@ esse domínio
  ANTHROPIC_API_KEY?: string;     // segunda opinião e desvio por tema na conferência (src/lib/segunda.ts); sem ela, uma opinião só
  SEGUNDA_MODELO?: string;        // modelo da segunda opinião (padrão claude-opus-5-5; claude-haiku-5-5 custa ~40× menos)
  SEGUNDA_URL?: string;           // só teste local: base da API da Anthropic (o e2e usa um modelo falso)
  XAI_API_KEY?: string;
  KIE_API_KEY?: string;           // ilustração (Grok image-edit via Kie); sem ela a peça sai com fundo flat
  KIE_URL?: string;               // só teste: base da API da Kie (tarefas e saldo)
  // Chaves do servidor dos provedores que o veículo pode escolher (src/lib/provedoresTabela.ts). Valem quando o veículo não
  // colou a dele na aba Chaves de IA; sem nenhuma das duas, a função fica desligada.
  GEMINI_API_KEY?: string;        // texto pelo Gemini (Google AI Studio), à escolha do veículo no lugar do DeepSeek
  GEMINI_URL?: string;            // só teste: base da API do Gemini (o e2e usa um modelo falso)
  FAL_KEY?: string;               // ilustração pelo fal (o mesmo Grok Imagine edit), à escolha do veículo no lugar da Kie
  FAL_URL?: string;               // só teste: base do fal (gerar e conferir a chave; o e2e usa um falso)
  INSTALACAO_PROPRIA?: string;    // '1': instalação própria sem cobrança. Veículo novo nasce em cortesia, a "/" sem sessão vai a /entrar
  MAX_CUSTO_PECA_USD?: string;    // teto por peça (texto + imagem); padrão 0.25
  TOKEN_ENC_KEY: string;
}

export type MonitorMessage =
  | { tipo: 'fonte'; tenantId: string; fonteId: string }
  | { tipo: 'documento'; tenantId: string; documentoId: string }
  // Resumo do dia (src/lib/resumo.ts, cron das 18h de Brasília).
  | { tipo: 'resumo'; tenantId: string; dia: string }
  // Veículo autoral recém-criado: os textos mais recentes do feed viram pautas e entram em produção (src/lib/autoral.ts).
  | { tipo: 'autoral'; tenantId: string; por: string; urls: string[]; tentativa?: number }
  // Mesa revisora: relê a página de uma evidência do dossiê e marca se mudou (src/lib/mesa.ts, cron diário).
  | { tipo: 'evidencia'; tenantId: string; evidenciaId: string }
  // Cópia da evidência no Wayback Machine (src/lib/wayback.ts); captura que demora volta para a fila.
  | { tipo: 'wayback'; tenantId: string; evidenciaId: string }
  // PDF do dossiê: lê as páginas, indexa e tira entidades e totais (src/lib/documento.ts).
  | { tipo: 'arquivo'; tenantId: string; arquivoId: string }
  // Áudio de entrevista: transcreve com o Whisper (src/lib/gravacao.ts).
  | { tipo: 'gravacao'; tenantId: string; arquivoId: string }
  // Gravar no app: um segmento da gravação (src/lib/gravacaoSessao.ts).
  | { tipo: 'segmento'; tenantId: string; arquivoId: string; n: number }
  // Reels com a voz do dono (src/lib/narracao.ts).
  | { tipo: 'narracao'; tenantId: string; narracaoId: string }
  // Processo citado numa matéria: consulta o DataJud e alerta movimento novo (src/lib/viva.ts).
  | { tipo: 'processo'; tenantId: string; processoId: string }
  // Prazos de LAI de uma matéria (cron diário, uma mensagem por texto): vencido ou a 3 dias vira alerta (src/lib/viva.ts).
  | { tipo: 'lai'; tenantId: string; textoId: string }
  // Certidão do post publicado: nunca segura a publicação.
  | { tipo: 'certidao'; tenantId: string; pecaId: string }
  // Raio-X: o modelo de visão lê uma miniatura.
  | { tipo: 'raiox'; tenantId: string; itemId: string };

/** Uma rodada de produção. Instância: `${pecaId}-r${rodada}`. Termina com a peça em revisão (ou falhou). */
export interface ProducaoParams {
  tenantId: string;
  pautaId: string;
  pecaId: string;
  formato: Formato;
  rodada: number;
  instrucao?: string;             // reescrita pedida pelo editor na revisão
  ritmo?: RitmoReels;             // Reels: passo e movimento do pedido
  narracao?: string | null;       // Reels: a fala conferida; o Workflow lê a linha
  /** Reels: o carrossel de origem (a versão que estava na tela) e a faixa da biblioteca de música, se houver. */
  origem?: {
    pecaId: string; versao: number;
    capa: { png: string; jpg: string };   // congeladas no pedido: edição depois dele não troca a arte do Reels
    ilustracao: string | null;
    em: string;                           // ISO do pedido (data do card sem data de fato)
  };
  musica?: string | null;
}

/** Publicação automática de uma peça aprovada. Instância: `${pecaId}-pub-${n}`. */
export interface PublicacaoParams {
  tenantId: string;
  pautaId: string;
  pecaId: string;
  contaId: string;
  agendadoPara?: string;          // ISO; sem ele publica já
}
