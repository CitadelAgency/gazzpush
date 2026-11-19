import type { ParamsStyle, Sponsor } from './style';
import type { Env } from '../env';
import type { TenantMode } from '../kernel/states';
import type { SourcesPair } from './typography';
import { fromOutletLanguage, type ContentLanguage } from './contentLanguage';

export interface Fact {
  id: string;
  documentoId: string;
  tipo: string | null;
  texto: string;
  municipioIbge: string | null;
  bairro: string | null;
  dataFato: string | null;
  fonteUrl: string;
  fonteNome: string | null;
  /** Story (author outlet): the literal evidence passage that supports the author's sentence (the fact's text). */
  evidenciaTrecho?: string | null;
}

export interface Lead {
  id: string;
  tenantId: string;
  titulo: string;
  resumo: string | null;
  editoria: string | null;
  municipioIbge: string | null;
  cidade: string | null;          // municipality name (tenant_areas), for the prompt and the cards
  bairro: string | null;
  fatos: Fact[];
  marca: Brand;
  voz: Voice;
  modo?: TenantMode;              // missing = local. autoral: author's voice in the prompt, author card, caption without "Source:"
  idioma?: ContentLanguage;        // the outlet's; missing = Portuguese. Posts, cards, caption and check are in it
  fontesUrl?: string;             // Story: public sources page; the CTA becomes the "How we reported this" card
  tipoPost?: 'atualizacao' | 'errata' | 'publicidade' | 'resumo';   // Living story: correction post; Ad: advertiser post
  anunciante?: string;            // only with tipoPost = 'publicidade'
  estiloParams?: ParamsStyle;    // the piece's template (src/lib/style.ts), only in the render and preview
  patrocinador?: Sponsor;    // likewise: the strip the piece froze
}

// JSON of the tenants.marca_json / voz_json fields. Primitives only: it must be Serializable for the Workflow.
export interface Brand {
  nome?: string;
  dominio?: string;
  handle?: string;
  ctaUrl?: string;
  logoR2?: string;                // key in R2 (svg/png)
  cores?: { fundo?: string; texto?: string; acento?: string };
  arteR2?: string;                // default art when the piece has no illustration of its own
  arteRefR2?: string;             // technique reference for the illustration generator
  estiloArte?: string;            // palette/style phrase in the prompt; the default is derived from the colours
  ctas?: Cta[];                   // fixed copy for the CTA card and the end of the caption; rotated per piece
  marcaDagua?: { posicao: 'canto' | 'rodape' | 'nenhuma'; opacidade: number };   // semi-transparent logo or @
  assinatura?: string;            // author outlet: who signs the card footer (in place of "Source:")
  fontes?: SourcesPair;             // card font pair (src/lib/typography.ts); missing = default
}

// Call-to-action copy is approved by the outlet, never written by the model.
// With `telefone` the card uses the rich template (cta.html: a phone with a sample DM, highlights, button);
// without it, the simple card from card.html.
export interface Cta {
  titulo: string;                 // CTA card headline (≤ 60 characters fits in 2 lines)
  texto: string;                  // support, 1 sentence
  legenda: string;                // line that closes the Instagram caption; `{link}` becomes the link from the lead's text
  url?: string;                   // footer link; default = profile
  acao?: string;                  // main footer button ("Send a DM")
  edicao?: string;                // badge in the top-right corner ("No direct", "No feed")
  destaques?: { titulo: string; itens: [string, string] };
  telefone?: {
    titulo: string;               // name at the top of the chat
    status: string;               // line below the name
    rotulo?: string;              // tag above the messages; default "Exemplo"
    mensagens: { de: 'morador' | 'pagina'; texto: string }[];
  };
}

export interface Voice {
  tom?: string;
  exemplos?: string[];
  evitar?: string[];
}

export async function loadLead(env: Env, tenantId: string, leadId: string): Promise<Lead> {
  const row = await env.DB.prepare(
    `SELECT p.id, p.titulo, p.resumo, p.editoria, p.municipio_ibge, p.bairro, p.fato_ids_json, p.fontes_url, p.tipo_post, t.marca_json, t.voz_json, t.modo, t.idioma,
            (SELECT an.anunciante FROM anuncios an WHERE an.pauta_id = p.id AND an.tenant_id = p.tenant_id) AS anunciante,
            (SELECT a.municipio_nome FROM tenant_areas a WHERE a.tenant_id = p.tenant_id
               -- An idea brought in by hand can come from outside the area: with no municipality identified, the outlet's city does not apply.
               AND a.municipio_ibge = CASE WHEN p.origem = 'manual' THEN p.municipio_ibge ELSE COALESCE(p.municipio_ibge, t.municipio_ibge) END
             LIMIT 1) AS cidade
     FROM pautas p JOIN tenants t ON t.id = p.tenant_id WHERE p.id = ? AND p.tenant_id = ?`,
  ).bind(leadId, tenantId).first<Record<string, string | null>>();
  if (!row) throw new Error(`lead ${leadId} not found for ${tenantId}`);

  const factIds: string[] = JSON.parse(row.fato_ids_json ?? '[]');
  const facts: Fact[] = [];
  if (factIds.length) {
    // The list goes as a single parameter (json_each): D1 accepts up to 100 parameters per query, and a Story can have more facts.
    const { results } = await env.DB.prepare(
      `SELECT f.id, f.documento_id, f.tipo, f.texto, f.municipio_ibge, f.bairro, f.data_fato, f.evidencia_trecho, d.url, fo.nome
       FROM fatos f JOIN documentos d ON d.id = f.documento_id LEFT JOIN fontes fo ON fo.id = d.fonte_id
       WHERE f.id IN (SELECT value FROM json_each(?)) AND f.tenant_id = ?`,
    ).bind(JSON.stringify(factIds), tenantId).all<Record<string, string | null>>();
    for (const f of results) {
      facts.push({
        id: f.id!, documentoId: f.documento_id!, tipo: f.tipo, texto: f.texto!, municipioIbge: f.municipio_ibge,
        bairro: f.bairro, dataFato: f.data_fato, fonteUrl: f.url!, fonteNome: f.nome, evidenciaTrecho: f.evidencia_trecho,
      });
    }
  }
  if (!facts.length) throw new Error(`lead ${leadId} has no facts; nothing to draft`);

  return {
    id: row.id!, tenantId, titulo: row.titulo!, resumo: row.resumo, editoria: row.editoria,
    municipioIbge: row.municipio_ibge, cidade: row.cidade, bairro: row.bairro, fatos: facts,
    marca: JSON.parse(row.marca_json ?? '{}'), voz: JSON.parse(row.voz_json ?? '{}'), modo: (row.modo ?? 'local') as TenantMode,
    idioma: fromOutletLanguage(row.idioma),
    ...(row.fontes_url ? { fontesUrl: row.fontes_url } : {}),
    ...(row.tipo_post === 'atualizacao' || row.tipo_post === 'errata' || row.tipo_post === 'resumo' ? { tipoPost: row.tipo_post } : {}),
    ...(row.tipo_post === 'publicidade' && row.anunciante ? { tipoPost: 'publicidade' as const, anunciante: row.anunciante } : {}),
  };
}
