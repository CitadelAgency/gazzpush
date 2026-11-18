// Idioma do conteúdo do veículo (tenants.idioma): posts, cards, legenda e conferência. Português do Brasil ou inglês,
// escolhido pelo admin ao criar o veículo ou na Marca. É diferente do idioma das telas, que é de cada pessoa
// (src/shell/idioma.ts). Puro: o render, a validação e a prévia da web usam os mesmos textos.

export type IdiomaConteudo = 'pt-BR' | 'en';
export const IDIOMAS_CONTEUDO: readonly IdiomaConteudo[] = ['pt-BR', 'en'];
export const ehIdiomaConteudo = (v: unknown): v is IdiomaConteudo => v === 'pt-BR' || v === 'en';
/** Ausente ou desconhecido: português (todo veículo antigo). */
export const idiomaDoVeiculo = (v: unknown): IdiomaConteudo => (v === 'en' ? 'en' : 'pt-BR');

/** Textos fixos que o sistema imprime no card e fecha a legenda. */
export const TEXTOS_CONTEUDO = {
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
    rotuloManchete: 'Título da publicação',
    rotuloIdeia: 'Ideia central',
    rotuloFonte: 'Nome da fonte',
    fotoDoVeiculo: 'Foto do veículo',
    ilustracao: 'Ilustração editorial',
    relatoDe: (quem: string) => `relato de ${quem}`,
    printDeNoticia: 'print de notícia',
    publicidade: 'Publicidade',
    oferecimento: 'Oferecimento',
    resumoDoDia: 'Resumo do dia',
    variasFontes: 'várias fontes',
    briefingAnunciante: 'briefing do anunciante',
    ctaPadrao: (handle: string) => ({ titulo: 'Seu bairro, com fonte.', texto: `Siga ${handle} pra receber as notícias de perto.`, legenda: `Siga ${handle}.` }),
    aPagina: 'a página',
    ctaAutoral: (nome: string | null) => ({
      titulo: 'Leia o texto completo',
      texto: nome ? `O texto inteiro está em ${nome}.` : 'O texto inteiro está no Substack.',
      legenda: 'Texto completo: {link}',
    }),
    // Card final da Matéria com a página de fontes publicada (src/lib/escudo.ts): copy do sistema, nunca do modelo.
    // Post de correção da Matéria viva (src/lib/viva.ts): o rótulo que o sistema põe na manchete.
    rotuloCorrecao: (tipo: 'atualizacao' | 'errata') => (tipo === 'errata' ? 'Errata' : 'Atualização'),
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
    rotuloManchete: 'Publication headline',
    rotuloIdeia: 'Central idea',
    rotuloFonte: 'Source name',
    fotoDoVeiculo: 'Publication photo',
    ilustracao: 'Editorial illustration',
    relatoDe: (quem: string) => `report from ${quem}`,
    printDeNoticia: 'news screenshot',
    publicidade: 'Advertisement',
    oferecimento: 'Sponsored by',
    resumoDoDia: 'Daily roundup',
    variasFontes: 'several sources',
    briefingAnunciante: 'advertiser brief',
    ctaPadrao: (handle: string) => ({ titulo: 'Your neighborhood, with sources.', texto: `Follow ${handle} for the news up close.`, legenda: `Follow ${handle}.` }),
    aPagina: 'the page',
    ctaAutoral: (nome: string | null) => ({
      titulo: 'Read the full piece',
      texto: nome ? `The full piece is on ${nome}.` : 'The full piece is on Substack.',
      legenda: 'Full piece: {link}',
    }),
    rotuloCorrecao: (tipo: 'atualizacao' | 'errata') => (tipo === 'errata' ? 'Correction' : 'Update'),
    ctaFontes: (url: string) => ({
      titulo: 'How we reported this',
      texto: `The source of every sentence in this post, with the passage and the link: ${url.replace(/^https?:\/\//, '')}`,
      legenda: `How we reported this (the source of every sentence): ${url}

Full piece: {link}`,
      url,
    }),
  },
} as const;

export const textosConteudo = (idioma: IdiomaConteudo | undefined) => TEXTOS_CONTEUDO[idioma === 'en' ? 'en' : 'pt-BR'];

/** O rótulo de publicidade: sempre por código, no selo do card, no rodapé e na legenda. */
export const rotuloPublicidade = (idioma: IdiomaConteudo | undefined) => textosConteudo(idioma).publicidade;

/** Editoria impressa no card em inglês. Em português o card imprime o código, como sempre imprimiu. */
const EDITORIA_EN: Record<string, string> = {
  cidade: 'City', policia: 'Police', transito: 'Traffic', saude: 'Health', educacao: 'Education', politica: 'Politics',
  economia: 'Economy', esporte: 'Sports', cultura: 'Culture', clima: 'Weather', entretenimento: 'Entertainment',
  tecnologia: 'Technology', outro: 'Other',
};
export const editoriaNoCard = (editoria: string | null | undefined, idioma: IdiomaConteudo | undefined) =>
  !editoria ? '' : idioma === 'en' ? EDITORIA_EN[editoria] ?? editoria : editoria;

/** Locale da data impressa no card. */
export const localeConteudo = (idioma: IdiomaConteudo | undefined) => (idioma === 'en' ? 'en-US' : 'pt-BR');
