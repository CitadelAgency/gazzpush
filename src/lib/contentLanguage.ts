// Language of the outlet's content (tenants.idioma): posts, cards, caption and check. Brazilian Portuguese or English,
// chosen by the admin when creating the outlet or in Brand. It differs from the screens' language, which belongs to
// each person (src/shell/language.ts). Pure: the render, the validation and the web preview use the same texts.

export type ContentLanguage = 'pt-BR' | 'en';
export const LANGUAGES_CONTENT: readonly ContentLanguage[] = ['pt-BR', 'en'];
export const isLanguageContent = (v: unknown): v is ContentLanguage => v === 'pt-BR' || v === 'en';
/** Missing or unknown: Portuguese (every older outlet). */
export const fromOutletLanguage = (v: unknown): ContentLanguage => (v === 'en' ? 'en' : 'pt-BR');

/** Fixed texts the system prints on the card and closes the caption with. */
export const TEXTS_CONTENT = {
  'pt-BR': {
    fonte: 'Fonte',
    ocorrencia: 'Ocorrência',
    publicacao: 'Publicação',
    siga: 'Siga',
    oQueAconteceu: 'O que aconteceu',
    contexto: 'Contexto',
    exemplo: 'Exemplo',
    noDirect: 'No direct',
    comoFunciona: 'Como funciona',
    linkNoPerfil: 'Link no perfil',
    pagina: 'Página',
    morador: 'Morador',
    respondeNoDirect: 'responde no direct',
    conversaExemplo: ['Oi! Vi uma coisa aqui no bairro, posso mandar?', 'Pode mandar. A gente confere antes de postar.'],
    mancheteExemplo: 'Manchete de exemplo: assim fica uma peça do seu veículo',
    ideiaExemplo: 'A ideia central do seu texto, como você a apresentaria',
    fonteExemplo: 'fonte de exemplo',
    fotoDoVeiculo: 'Foto do veículo',
    ilustracao: 'Ilustração editorial',
    relatoDe: (who: string) => `relato de ${who}`,
    printDeNoticia: 'print de notícia',
    publicidade: 'Publicidade',
    oferecimento: 'Oferecimento',
    resumoDoDia: 'Resumo do dia',
    variasFontes: 'várias fontes',
    briefingAnunciante: 'briefing do anunciante',
    ctaPadrao: (handle: string) => ({ titulo: 'Seu bairro, com fonte.', texto: `Siga ${handle} pra receber as notícias de perto.`, legenda: `Siga ${handle}.` }),
    aPagina: 'a página',
    ctaAutoral: (name: string | null) => ({
      titulo: 'Leia o texto completo',
      texto: name ? `O texto inteiro está em ${name}.` : 'O texto inteiro está no Substack.',
      legenda: 'Texto completo: {link}',
    }),
    // Final card of the Story with the published sources page (src/lib/shield.ts): system copy, never the model's.
    // Correction post for a living story (src/lib/living.ts): the label the system puts on the headline.
    rotuloCorrecao: (type: 'atualizacao' | 'errata') => (type === 'errata' ? 'Errata' : 'Atualização'),
    ctaFontes: (url: string) => ({
      titulo: 'Como apuramos',
      texto: `A fonte de cada frase deste post, com o trecho e o link: ${url.replace(/^https?:\/\//, '')}`,
      legenda: `Como apuramos (a fonte de cada frase): ${url}

Texto completo: {link}`,
      url,
    }),
  },
  en: {
    fonte: 'Source',
    ocorrencia: 'Event',
    publicacao: 'Published',
    siga: 'Follow',
    oQueAconteceu: 'What happened',
    contexto: 'Context',
    exemplo: 'Example',
    noDirect: 'In your DMs',
    comoFunciona: 'How it works',
    linkNoPerfil: 'Link in bio',
    pagina: 'Page',
    morador: 'Reader',
    respondeNoDirect: 'replies in DMs',
    conversaExemplo: ['Hi! I saw something here in the neighborhood, can I send it?', 'Send it. We check before posting.'],
    mancheteExemplo: 'Sample headline: this is how a post from your publication looks',
    ideiaExemplo: 'The central idea of your piece, the way you would put it',
    fonteExemplo: 'sample source',
    fotoDoVeiculo: 'Publication photo',
    ilustracao: 'Editorial illustration',
    relatoDe: (who: string) => `report from ${who}`,
    printDeNoticia: 'news screenshot',
    publicidade: 'Advertisement',
    oferecimento: 'Sponsored by',
    resumoDoDia: 'Daily roundup',
    variasFontes: 'several sources',
    briefingAnunciante: 'advertiser brief',
    ctaPadrao: (handle: string) => ({ titulo: 'Your neighborhood, with sources.', texto: `Follow ${handle} for the news up close.`, legenda: `Follow ${handle}.` }),
    aPagina: 'the page',
    ctaAutoral: (name: string | null) => ({
      titulo: 'Read the full piece',
      texto: name ? `The full piece is on ${name}.` : 'The full piece is on Substack.',
      legenda: 'Full piece: {link}',
    }),
    rotuloCorrecao: (type: 'atualizacao' | 'errata') => (type === 'errata' ? 'Correction' : 'Update'),
    ctaFontes: (url: string) => ({
      titulo: 'How we reported this',
      texto: `The source of every sentence in this post, with the passage and the link: ${url.replace(/^https?:\/\//, '')}`,
      legenda: `How we reported this (the source of every sentence): ${url}

Full piece: {link}`,
      url,
    }),
  },
} as const;

export const textsContent = (language: ContentLanguage | undefined) => TEXTS_CONTENT[language === 'en' ? 'en' : 'pt-BR'];

/** The advertising label: always set by code, on the card badge, the footer and the caption. */
export const advertisingLabel = (language: ContentLanguage | undefined) => textsContent(language).publicidade;

/** Desk name printed on the card in English. In Portuguese the card prints the code, as it always has. */
const DESK_EN: Record<string, string> = {
  cidade: 'City', policia: 'Police', transito: 'Traffic', saude: 'Health', educacao: 'Education', politica: 'Politics',
  economia: 'Economy', esporte: 'Sports', cultura: 'Culture', clima: 'Weather', entretenimento: 'Entertainment',
  tecnologia: 'Technology', outro: 'Other',
};
export const deskInCard = (desk: string | null | undefined, language: ContentLanguage | undefined) =>
  !desk ? '' : language === 'en' ? DESK_EN[desk] ?? desk : desk;

/** Locale of the date printed on the card. */
export const localeContent = (language: ContentLanguage | undefined) => (language === 'en' ? 'en-US' : 'pt-BR');
