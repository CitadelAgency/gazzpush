// What to do when the account goes down: a fixed playbook and text templates, no AI, in pt-BR and English. Pure: the
// screen uses it directly. Meta's deadline is not a number here: the person copies the one from the notice they got.
import type { ContentLanguage as Idioma } from './contentLanguage';

export const CASE_TYPES = ['desativada', 'direito_autoral', 'cobranca', 'outro'] as const;
export type CaseType = (typeof CASE_TYPES)[number];
export const NOTE_CASE_MAX = 500;

export interface KitStep { titulo: string; texto: string }
export interface KitModel { id: string; titulo: string; texto: string }

const WARNING_PT = 'Este modelo não é orientação jurídica. Preencha os campos entre colchetes e ajuste ao seu caso.';
const WARNING_EN = 'This template is not legal advice. Fill in the fields in brackets and adjust it to your case.';

export function scriptKit(language: Idioma): KitStep[] {
  if (language === 'en') {
    return [
      { titulo: 'Save the notice', texto: 'Take a screenshot of the notice with the date and copy the deadline it gives. Register the case below: the app counts the days.' },
      { titulo: 'Ask for a review', texto: 'Use the link in the notice. For a copyright report in the United States, Meta\'s form has to be opened through the link received in the account.' },
      { titulo: 'Gather the proof', texto: 'Download the certificates from this month below. Each one shows sources, approval and publication, with a timestamp from when the post went out.' },
      { titulo: 'Keep publishing', texto: 'The reserve channels in this kit keep your audience informed while the account is down.' },
      { titulo: 'What people have reported', texto: 'One person says a complaint at consumidor.gov.br brought the account back a week later. Another won a lawsuit, with compensation, after a year. A news page owner hired a lawyer and got a hearing scheduled. These are reports, not a promise of results.' },
    ];
  }
  return [
    { titulo: 'Guarde o aviso', texto: 'Tire um print do aviso com a data e copie o prazo que ele dá. Registre o caso aqui embaixo: o app conta os dias.' },
    { titulo: 'Peça a revisão', texto: 'Use o link do próprio aviso. Para denúncia de direito autoral nos Estados Unidos, o formulário da Meta precisa ser aberto pelo link recebido na conta.' },
    { titulo: 'Junte a prova', texto: 'Baixe as certidões do mês aqui embaixo. Cada uma mostra fontes, aprovação e publicação, com carimbo de tempo de quando o post saiu.' },
    { titulo: 'Continue publicando', texto: 'Os canais de reserva deste kit mantêm o público informado enquanto a conta está fora.' },
    { titulo: 'O que já funcionou em relatos', texto: 'Uma pessoa conta que uma reclamação no consumidor.gov.br recuperou a conta uma semana depois. Outra ganhou uma ação, com indenização, depois de um ano. Um dono de página de notícias contratou advogado e conseguiu audiência marcada. São relatos, não promessa de resultado.' },
  ];
}

export function modelsKit(language: Idioma): KitModel[] {
  if (language === 'en') {
    return [
      {
        id: 'revisao', titulo: 'Review request to Meta',
        texto: `${WARNING_EN}\n\nHello,\n\nI am the person responsible for the account [@account], of the outlet [outlet name]. On [date], the account was [disabled / restricted], with the notice: "[copy the notice]".\n\nI request a review of this decision. The account publishes local journalism, and each post has its sources, approval and publication date recorded in the attached certificates.\n\nThe post cited in the notice is [link or description]. [Explain, in your own words, why it does not break the rule cited.]\n\nI ask that you tell me which content or rule led to the decision, and that the account be restored.\n\n[Name]\n[Role]\n[Contact]`,
      },
      {
        id: 'titularidade', titulo: 'Request for proof of ownership',
        texto: `${WARNING_EN}\n\nHello, [name or company],\n\nOn [date], the account [@account] received a [report / charge] from you about [describe the content], reference [number in the notice].\n\nSo that I can look into it, please send:\n\n1. Proof that you own the rights to this content, or are authorized to represent the owner.\n2. The exact link to the post concerned.\n3. The date and place where the original was first published.\n4. The legal basis for the amount charged, if there is one.\n\nUntil I receive this, I will not treat the charge as acknowledged.\n\n[Name]\n[Contact]`,
      },
      {
        id: 'consumidor', titulo: 'Complaint at consumidor.gov.br',
        texto: `${WARNING_EN}\n\nCompany: Meta (Facebook / Instagram)\n\nWhat happened: on [date], my account [@account] was [disabled / restricted], with the notice "[copy the notice]". The account is used for [describe the activity]. I asked for a review on [date] through [channel], and [describe the answer, or say there was none].\n\nImpact: [describe the loss, such as sponsorship contracts or income in the period].\n\nWhat I ask: that the account be restored, or that I be told exactly which content and rule led to the decision.`,
      },
    ];
  }
  return [
    {
      id: 'revisao', titulo: 'Pedido de revisão à Meta',
      texto: `${WARNING_PT}\n\nOlá,\n\nSou responsável pela conta [@conta], do veículo [nome do veículo]. Em [data], a conta foi [desativada / restringida], com o aviso: "[copie o aviso]".\n\nPeço a revisão dessa decisão. A conta publica jornalismo local, e cada post tem fontes, aprovação e data de publicação registradas nas certidões em anexo.\n\nO post citado no aviso é [link ou descrição]. [Explique, com as suas palavras, por que ele não fere a regra citada.]\n\nPeço que informem qual conteúdo ou regra motivou a decisão, e que a conta seja restabelecida.\n\n[Nome]\n[Função]\n[Contato]`,
    },
    {
      id: 'titularidade', titulo: 'Pedido de prova de titularidade',
      texto: `${WARNING_PT}\n\nOlá, [nome ou empresa],\n\nEm [data], a conta [@conta] recebeu de vocês uma [denúncia / cobrança] sobre [descreva o conteúdo], referência [número do aviso].\n\nPara que eu possa analisar, peço que enviem:\n\n1. A prova de que são titulares dos direitos desse conteúdo, ou de que estão autorizados a representar quem é.\n2. O link exato do post questionado.\n3. A data e o lugar da primeira publicação do original.\n4. O fundamento do valor cobrado, se houver.\n\nAté receber esses dados, não considero a cobrança reconhecida.\n\n[Nome]\n[Contato]`,
    },
    {
      id: 'consumidor', titulo: 'Reclamação no consumidor.gov.br',
      texto: `${WARNING_PT}\n\nEmpresa: Meta (Facebook / Instagram)\n\nO que aconteceu: em [data], a minha conta [@conta] foi [desativada / restringida], com o aviso "[copie o aviso]". A conta é usada para [descreva a atividade]. Pedi revisão em [data], por [canal], e [descreva a resposta, ou diga que não houve].\n\nPrejuízo: [descreva a perda, como contratos de patrocínio ou renda no período].\n\nO que peço: que a conta seja restabelecida, ou que me informem exatamente qual conteúdo e qual regra motivaram a decisão.`,
    },
  ];
}

/** Days until the deadline: negative means it has passed. Dates as `YYYY-MM-DD`. */
export function untilDays(deadline: string, today: string): number {
  return Math.round((Date.parse(`${deadline.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}
