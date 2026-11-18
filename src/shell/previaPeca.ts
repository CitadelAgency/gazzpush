// O que a edição do carrossel na Revisão precisa para montar a prévia de cada card no navegador com o mesmo template
// do render: a parte fixa do card (baseDoCard), logo, ilustração e fotos com URL assinada (1 h), a marca d'água e os
// convites da marca para escolher. Sem chaves do R2 de marca nem copy fora dos convites.
import type { Env } from '../env';
import { assinarMedia } from '../lib/crypto';
import { prefixoIlustracoes } from '../lib/ilustrar';
import { carregarPauta } from '../lib/pauta';
import { escolherCta } from '../lib/redacao';
import type { EstiloPeca } from '../lib/estilo';
import { baseDoCard, pautaDoEstilo, type ArteRenderizada } from '../lib/render';
import { ilustracaoAtual } from './edicao';
import type { Card } from '../lib/cards';

export async function previaDaPeca(env: Env, tenantId: string, peca: { id: string; pauta_id: string }, cards: Card[], artes: ArteRenderizada[], estilo?: EstiloPeca) {
  const carregada = await carregarPauta(env, tenantId, peca.pauta_id).catch(() => null);
  if (!carregada) return null;
  const pauta = pautaDoEstilo(carregada, estilo);
  const marca = pauta.marca;
  // A ilustração que a versão atual usou (a mesma que a edição vai usar), ou a arte padrão da marca.
  const arteKey = (await ilustracaoAtual(env, tenantId, peca.id, artes)) ?? marca.arteR2 ?? null;
  const prefixo = prefixoIlustracoes(tenantId, peca.id);
  const fotos = [...new Set(cards.flatMap((c) => [c.imagem, c.ilustracao]).filter((k): k is string => typeof k === 'string' && (k.startsWith(`fotos/${tenantId}/${peca.id}/`) || k.startsWith(prefixo))))];
  const padrao = escolherCta(pauta);
  const base = baseDoCard(pauta);
  const logoPatrocinio = pauta.patrocinador?.logoR2 ? await assinarMedia(env, pauta.patrocinador.logoR2, 3600) : null;
  return {
    base: base.patrocinio ? { ...base, patrocinio: { ...base.patrocinio, logo: logoPatrocinio } } : base,
    modo: pauta.modo ?? 'local',
    nome: marca.nome ?? '', handle: marca.handle ?? '',
    logo: marca.logoR2 ? await assinarMedia(env, marca.logoR2, 3600) : null,
    arte: arteKey ? await assinarMedia(env, arteKey, 3600) : null,
    marcaDagua: marca.marcaDagua ?? null,
    imagens: Object.fromEntries(await Promise.all(fotos.map(async (k) => [k, await assinarMedia(env, k, 3600)] as const))),
    // Os convites que o editor pode escolher para o último card (índice em marca.ctas); `padrao` é o da rotação.
    // Convite rico (celular de exemplo): a configuração dele, para a prévia sair no template convite.html como no render.
    convites: (marca.ctas ?? []).map((c, indice) => ({
      indice, titulo: c.titulo, texto: c.texto,
      rico: c.telefone ? { titulo: c.titulo, texto: c.texto, url: c.url, acao: c.acao, edicao: c.edicao, destaques: c.destaques, telefone: c.telefone } : null,
    })).filter((c) => c.titulo && c.texto),
    convitePadrao: (marca.ctas ?? []).indexOf(padrao),
    conviteGenerico: { titulo: padrao.titulo, texto: padrao.texto },
  };
}
