import type { ParamsEstilo, Patrocinador } from './estilo';
import type { Env } from '../env';
import type { ModoTenant } from '../kernel/estados';
import type { ParFontes } from './tipografia';
import { idiomaDoVeiculo, type IdiomaConteudo } from './idiomaConteudo';

export interface Fato {
  id: string;
  documentoId: string;
  tipo: string | null;
  texto: string;
  municipioIbge: string | null;
  bairro: string | null;
  dataFato: string | null;
  fonteUrl: string;
  fonteNome: string | null;
  /** Matéria (autoral): o trecho literal da evidência que sustenta a frase do autor (o texto do fato). */
  evidenciaTrecho?: string | null;
}

export interface Pauta {
  id: string;
  tenantId: string;
  titulo: string;
  resumo: string | null;
  editoria: string | null;
  municipioIbge: string | null;
  cidade: string | null;          // nome do município (tenant_areas), pra prompt e cards
  bairro: string | null;
  fatos: Fato[];
  marca: Marca;
  voz: Voz;
  modo?: ModoTenant;              // ausente = local. autoral: voz do autor no prompt, card de autor, legenda sem "Fonte:"
  idioma?: IdiomaConteudo;        // do veículo; ausente = português. Posts, cards, legenda e conferência nele
  fontesUrl?: string;             // Matéria: página de fontes pública; o convite vira o card "Como apuramos"
  tipoPost?: 'atualizacao' | 'errata' | 'publicidade' | 'resumo';   // Matéria viva: post de correção; Anúncio: post do anunciante
  anunciante?: string;            // só com tipoPost = 'publicidade'
  estiloParams?: ParamsEstilo;    // o modelo da peça (src/lib/estilo.ts), só no render e na prévia
  patrocinador?: Patrocinador;    // idem: a faixa que a peça congelou
}

// JSON dos campos tenants.marca_json / voz_json. Só primitivos: precisa ser Serializable pro Workflow.
export interface Marca {
  nome?: string;
  dominio?: string;
  handle?: string;
  ctaUrl?: string;
  logoR2?: string;                // chave no R2 (svg/png)
  cores?: { fundo?: string; texto?: string; acento?: string };
  arteR2?: string;                // arte padrão quando a peça não tem ilustração própria
  arteRefR2?: string;             // referência de técnica pro gerador de ilustração
  estiloArte?: string;            // frase de paleta/estilo no prompt; padrão derivado das cores
  ctas?: Cta[];                   // copy fixa do card de convite e do fim da legenda; rotação por peça
  marcaDagua?: { posicao: 'canto' | 'rodape' | 'nenhuma'; opacidade: number };   // logo ou @ semitransparente
  assinatura?: string;            // veículo autoral: quem assina o rodapé do card (no lugar de "Fonte:")
  fontes?: ParFontes;             // par de fontes do card (src/lib/tipografia.ts); ausente = padrão
}

// Convite: copy aprovada por quem cuida do veículo, nunca escrita pelo modelo.
// Com `telefone` o card usa o template rico (convite.html: celular com direct de exemplo, destaques, botão);
// sem ele, o card simples de card.html.
export interface Cta {
  titulo: string;                 // manchete do card de convite (≤ 60 caracteres cabe em 2 linhas)
  texto: string;                  // apoio, 1 frase
  legenda: string;                // linha que fecha a legenda do Instagram; `{link}` vira o link do texto da pauta
  url?: string;                   // link do rodapé; padrão = perfil
  acao?: string;                  // botão principal do rodapé ("Manda no direct")
  edicao?: string;                // selo no canto superior direito ("No direct", "No feed")
  destaques?: { titulo: string; itens: [string, string] };
  telefone?: {
    titulo: string;               // nome na cabeça do chat
    status: string;               // linha abaixo do nome
    rotulo?: string;              // etiqueta acima das mensagens; padrão "Exemplo"
    mensagens: { de: 'morador' | 'pagina'; texto: string }[];
  };
}

export interface Voz {
  tom?: string;
  exemplos?: string[];
  evitar?: string[];
}

export async function carregarPauta(env: Env, tenantId: string, pautaId: string): Promise<Pauta> {
  const row = await env.DB.prepare(
    `SELECT p.id, p.titulo, p.resumo, p.editoria, p.municipio_ibge, p.bairro, p.fato_ids_json, p.fontes_url, p.tipo_post, t.marca_json, t.voz_json, t.modo, t.idioma,
            (SELECT an.anunciante FROM anuncios an WHERE an.pauta_id = p.id AND an.tenant_id = p.tenant_id) AS anunciante,
            (SELECT a.municipio_nome FROM tenant_areas a WHERE a.tenant_id = p.tenant_id
               -- Ideia trazida à mão pode ser de fora da área: sem município identificado, não vale o do veículo.
               AND a.municipio_ibge = CASE WHEN p.origem = 'manual' THEN p.municipio_ibge ELSE COALESCE(p.municipio_ibge, t.municipio_ibge) END
             LIMIT 1) AS cidade
     FROM pautas p JOIN tenants t ON t.id = p.tenant_id WHERE p.id = ? AND p.tenant_id = ?`,
  ).bind(pautaId, tenantId).first<Record<string, string | null>>();
  if (!row) throw new Error(`pauta ${pautaId} não encontrada para ${tenantId}`);

  const fatoIds: string[] = JSON.parse(row.fato_ids_json ?? '[]');
  const fatos: Fato[] = [];
  if (fatoIds.length) {
    // A lista vai como um parâmetro só (json_each): o D1 aceita até 100 parâmetros por consulta, e a Matéria pode ter mais fatos.
    const { results } = await env.DB.prepare(
      `SELECT f.id, f.documento_id, f.tipo, f.texto, f.municipio_ibge, f.bairro, f.data_fato, f.evidencia_trecho, d.url, fo.nome
       FROM fatos f JOIN documentos d ON d.id = f.documento_id LEFT JOIN fontes fo ON fo.id = d.fonte_id
       WHERE f.id IN (SELECT value FROM json_each(?)) AND f.tenant_id = ?`,
    ).bind(JSON.stringify(fatoIds), tenantId).all<Record<string, string | null>>();
    for (const f of results) {
      fatos.push({
        id: f.id!, documentoId: f.documento_id!, tipo: f.tipo, texto: f.texto!, municipioIbge: f.municipio_ibge,
        bairro: f.bairro, dataFato: f.data_fato, fonteUrl: f.url!, fonteNome: f.nome, evidenciaTrecho: f.evidencia_trecho,
      });
    }
  }
  if (!fatos.length) throw new Error(`pauta ${pautaId} sem fatos; nada a redigir`);

  return {
    id: row.id!, tenantId, titulo: row.titulo!, resumo: row.resumo, editoria: row.editoria,
    municipioIbge: row.municipio_ibge, cidade: row.cidade, bairro: row.bairro, fatos,
    marca: JSON.parse(row.marca_json ?? '{}'), voz: JSON.parse(row.voz_json ?? '{}'), modo: (row.modo ?? 'local') as ModoTenant,
    idioma: idiomaDoVeiculo(row.idioma),
    ...(row.fontes_url ? { fontesUrl: row.fontes_url } : {}),
    ...(row.tipo_post === 'atualizacao' || row.tipo_post === 'errata' || row.tipo_post === 'resumo' ? { tipoPost: row.tipo_post } : {}),
    ...(row.tipo_post === 'publicidade' && row.anunciante ? { tipoPost: 'publicidade' as const, anunciante: row.anunciante } : {}),
  };
}
