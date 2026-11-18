// Os provedores de IA que o veículo pode pagar com a própria chave, sem nada de servidor: a aba Chaves de IA importa daqui.
// Id do modelo, preço, variável do servidor e link para pegar a chave ficam só aqui: trocar de modelo é mudar uma linha.
// `afiliado`: link de afiliado, quando houver programa; com ele, a tela usa este link e diz "link de afiliado" ao lado.
// Nenhum dos cinco tem programa confirmado (17/11/2026), então todos começam sem.

/** O que o provedor faz no app. Texto e imagem têm dois provedores à escolha do veículo; a segunda opinião, um. */
export type FuncaoIa = 'texto' | 'segunda' | 'imagem';

export const PROVEDORES = {
  // US$ por milhão de tokens. Entrada nova, leitura de cache (o DeepSeek cobra menos pelo prefixo repetido) e saída.
  deepseek: {
    nome: 'DeepSeek', funcao: 'texto', variavel: 'DEEPSEEK_API_KEY',
    link: 'https://platform.deepseek.com/api_keys', afiliado: null,
    modelo: 'deepseek-chat', preco: { entrada: 0.27, cacheLido: 0.07, saida: 1.1 },
  },
  // Gemini 3.5 Flash-Lite: o estável da faixa de preço do DeepSeek (aistudio.google.com/docs/pricing, 17/11/2026). A saída
  // inclui os tokens de raciocínio.
  gemini: {
    nome: 'Gemini', funcao: 'texto', variavel: 'GEMINI_API_KEY',
    link: 'https://aistudio.google.com/apikey', afiliado: null,
    modelo: 'gemini-3.5-flash-lite', preco: { entrada: 0.3, cacheLido: 0.03, saida: 2.5 },
  },
  // Segunda opinião. `SEGUNDA_MODELO` troca o modelo; o preço vem de PRECOS_CLAUDE.
  anthropic: {
    nome: 'Anthropic (Claude)', funcao: 'segunda', variavel: 'ANTHROPIC_API_KEY',
    link: 'https://console.anthropic.com/settings/keys', afiliado: null,
    modelo: 'claude-opus-5-5', preco: null,
  },
  // Grok image-edit pela Kie: o custo vem em créditos; a reserva é o custo típico de uma imagem, usado no teto da peça e
  // quando a Kie não informa os créditos.
  kie: {
    nome: 'Kie', funcao: 'imagem', variavel: 'KIE_API_KEY',
    link: 'https://kie.ai/api-key', afiliado: null,
    modelo: 'grok-imagine-image-2-0/image-edit', preco: { creditoUsd: 0.005, imagemUsd: 0.02 },
  },
  // O mesmo Grok Imagine edit, no fal (fal.ai/models/xai/grok-imagine-image/edit: US$ 0,022 por imagem, 17/11/2026).
  fal: {
    nome: 'fal', funcao: 'imagem', variavel: 'FAL_KEY',
    link: 'https://fal.ai/dashboard/keys', afiliado: null,
    modelo: 'xai/grok-imagine-image/edit', preco: { imagemUsd: 0.022 },
  },
} as const satisfies Record<string, { nome: string; funcao: FuncaoIa; variavel: string; link: string; afiliado: string | null; modelo: string; preco: unknown }>;

export type Provedor = keyof typeof PROVEDORES;
export const IDS_PROVEDORES = Object.keys(PROVEDORES) as Provedor[];
export const PROVEDORES_TEXTO = ['deepseek', 'gemini'] as const satisfies readonly Provedor[];
export const PROVEDORES_IMAGEM = ['kie', 'fal'] as const satisfies readonly Provedor[];
export type ProvedorTexto = (typeof PROVEDORES_TEXTO)[number];
export type ProvedorImagem = (typeof PROVEDORES_IMAGEM)[number];

export const ehProvedor = (v: unknown): v is Provedor => typeof v === 'string' && Object.hasOwn(PROVEDORES, v);

/** Claude, US$ por milhão de tokens: entrada, saída, leitura de cache, escrita de cache (5 min). */
export const PRECOS_CLAUDE: Record<string, [number, number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
};

/** O link que a tela mostra para pegar a chave: o de afiliado quando existe. */
export const linkDaChave = (p: Provedor) => {
  const { link, afiliado } = PROVEDORES[p] as { link: string; afiliado: string | null };
  return { url: afiliado ?? link, afiliado: !!afiliado };
};
