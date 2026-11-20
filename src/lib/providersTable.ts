// The AI providers an outlet can pay for with its own key, with nothing server-side: the AI keys tab imports from here.
// Model id, price, server variable and the link to get a key live only here: switching models is changing one line.
// `afiliado`: an affiliate link, when there is a programme; with it, the screen uses this link and says "affiliate link"
// next to it.

/** What the provider does in the app. Text, second opinion and image can each be set per outlet (including one-key Kie.ai). */
export type FunctionAi = 'texto' | 'segunda' | 'imagem';

export const PROVIDERS = {
  // US$ per million tokens. New input, cache reads (DeepSeek charges less for a repeated prefix) and output.
  deepseek: {
    nome: 'DeepSeek', funcao: 'texto', variavel: 'DEEPSEEK_API_KEY',
    link: 'https://platform.deepseek.com/api_keys', afiliado: null,
    // deepseek-flash off-peak (api-docs.deepseek.com/quick_start/pricing, 11/11/2026); peak doubles it (deepseekCost).
    modelo: 'deepseek-flash', preco: { entrada: 0.15, cacheLido: 0.003, saida: 0.6 },
  },
  // Gemini 3.5 Flash-Lite: the stable model in DeepSeek's price range (aistudio.google.com/docs/pricing, 17/11/2026).
  // Output includes reasoning tokens.
  gemini: {
    nome: 'Gemini', funcao: 'texto', variavel: 'GEMINI_API_KEY',
    link: 'https://aistudio.google.com/apikey', afiliado: null,
    modelo: 'gemini-3.5-flash-lite', preco: { entrada: 0.3, cacheLido: 0.03, saida: 2.5 },
  },
  // Second opinion. `SEGUNDA_MODELO` swaps the model; the price comes from PRICES_CLAUDE.
  anthropic: {
    nome: 'Anthropic (Claude)', funcao: 'segunda', variavel: 'ANTHROPIC_API_KEY',
    link: 'https://console.anthropic.com/settings/keys', afiliado: null,
    modelo: 'claude-opus-5-5', preco: null,
  },
  // Kie.ai: Grok image-edit by default, and optionally text (Gemini Flash) + second opinion (Claude) when the outlet
  // explicitly chooses Kie for everything. The credit reserve is the typical cost of one image.
  kie: {
    nome: 'Kie', funcao: 'imagem', variavel: 'KIE_API_KEY',
    link: 'https://kie.ai/api-key', afiliado: 'https://kie.ai?ref=6bb5696952ed37a98d23e2af63cbc03c',
    modelo: 'grok-imagine-image-2-0/image-edit', preco: { creditoUsd: 0.005, imagemUsd: 0.02 },
  },
  // The same Grok Imagine edit, on fal (fal.ai/models/xai/grok-imagine-image/edit: US$ 0.022 per image, 17/11/2026).
  fal: {
    nome: 'fal', funcao: 'imagem', variavel: 'FAL_KEY',
    link: 'https://fal.ai/dashboard/keys', afiliado: null,
    modelo: 'xai/grok-imagine-image/edit', preco: { imagemUsd: 0.022 },
  },
} as const satisfies Record<string, { nome: string; funcao: FunctionAi; variavel: string; link: string; afiliado: string | null; modelo: string; preco: unknown }>;

/** Text model used when an outlet explicitly opts into Kie.ai for text (OpenAI-compatible Gemini Flash route on Kie). */
export const KIE_TEXT = {
  modelo: 'gemini-3-8-flash',
  rota: 'gemini-3-8-flash-openai',
  preco: { entrada: 0.3, cacheLido: 0.03, saida: 2.5 },
} as const;

export type Provider = keyof typeof PROVIDERS;
export const PROVIDERS_IDS = Object.keys(PROVIDERS) as Provider[];
export const PROVIDERS_TEXT_BYOK = ['deepseek', 'gemini'] as const satisfies readonly Provider[];
export const PROVIDERS_TEXT = ['deepseek', 'gemini', 'kie'] as const satisfies readonly Provider[];
export const PROVIDERS_SECOND = ['anthropic', 'kie'] as const satisfies readonly Provider[];
export const PROVIDERS_IMAGE = ['kie', 'fal'] as const satisfies readonly Provider[];
export type ProviderText = (typeof PROVIDERS_TEXT)[number];
export type ProviderSecond = (typeof PROVIDERS_SECOND)[number];
export type ProviderImage = (typeof PROVIDERS_IMAGE)[number];

export const isProvider = (v: unknown): v is Provider => typeof v === 'string' && Object.hasOwn(PROVIDERS, v);
export const textModelName = (p: ProviderText) => (p === 'kie' ? KIE_TEXT.modelo : PROVIDERS[p].modelo);

/** Claude, US$ per million tokens: input, output, cache read, cache write (5 min). */
export const PRICES_CLAUDE: Record<string, [number, number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
};

/** The link the screen shows for getting the key: the affiliate one when it exists. */
export const fromKeyLink = (p: Provider) => {
  const { link, afiliado: affiliate } = PROVIDERS[p] as { link: string; afiliado: string | null };
  return { url: affiliate ?? link, afiliado: !!affiliate };
};
