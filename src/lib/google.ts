import type { Env } from '../env';
import { criarAuth } from '../shell/auth';

// Google Docs: ler o documento escolhido no Picker (Fase 1) e devolver as edições da mesa (Fase 2). Escopo
// `drive.file`, pedido só quando a pessoa conecta o Docs (vínculo da conta Google pelo Better Auth): o app só enxerga
// os arquivos que ela escolheu. O token mora na tabela `account` do Better Auth e só o Worker o usa; a tela recebe
// apenas o token de acesso de curta duração que o Picker exige.

export const ESCOPO_DOCS = 'https://www.googleapis.com/auth/drive.file';
const API_DOCS = 'https://docs.googleapis.com/v1/documents';

/** Com as quatro variáveis o Docs aparece na interface; sem qualquer uma, as rotas do Google respondem 404. */
export const googleConfigurado = (env: Env) =>
  Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_API_KEY && env.GOOGLE_PROJECT_NUMBER);

export type CodigoGoogle = 'sem_conta' | 'reconectar' | 'sem_acesso' | 'documento_invalido' | 'mudou_no_docs' | 'falhou';

/** Erro em linguagem de leigo, com a ação: "reconectar" e "sem_conta" levam a "Conectar de novo" na tela. */
export class ErroGoogle extends Error {
  /** `en`: a mesma mensagem em inglês (a API escolhe pelo idioma do pedido; `message` é o português). */
  constructor(readonly codigo: CodigoGoogle, message: string, readonly status: 400 | 404 | 409 | 502 = 409, readonly en?: string) {
    super(message);
  }
}

const RECONECTAR = 'O acesso ao Google Docs venceu. Conecte de novo em Veículo › Contas.';
const SEM_ACESSO = 'Este documento não está liberado para o Gazzpush. Escolha de novo pelo botão do Google Docs.';
const RECONECTAR_EN = 'Your Google Docs access expired. Connect again in Publication › Accounts.';
const SEM_ACESSO_EN = "This document isn't shared with Gazzpush. Choose it again with the Google Docs button.";
const DOC_INVALIDO = 'Documento inválido. Escolha de novo pelo botão do Google Docs.';
const DOC_INVALIDO_EN = 'Invalid document. Choose it again with the Google Docs button.';

/** Escopos como o Better Auth guarda (vírgula; o Google às vezes devolve com espaço). */
export const temEscopoDocs = (scope: string | null | undefined) => (scope ?? '').split(/[\s,]+/).includes(ESCOPO_DOCS);

/**
 * A conta Google da pessoa para o Docs: a mais recente com `drive.file`. Quem entra com um Google e conectou o Docs com
 * outro tem duas contas; a do login (sem o escopo) não esconde a do Docs. Sem nenhuma com o escopo, a mais recente.
 */
export async function contaGoogle(env: Env, userId: string) {
  const { results } = await env.DB.prepare(`SELECT id, scope FROM account WHERE "userId" = ? AND "providerId" = 'google' ORDER BY "updatedAt" DESC`)
    .bind(userId).all<{ id: string; scope: string | null }>();
  return results.find((a) => temEscopoDocs(a.scope)) ?? results[0] ?? null;
}

/** A pessoa já conectou o Docs (conta Google vinculada com `drive.file`)? */
export async function docsConectado(env: Env, userId: string) {
  return temEscopoDocs((await contaGoogle(env, userId))?.scope);
}

/** Token de acesso válido, renovado pelo Better Auth quando venceu. Sem renovação possível: reconectar. */
export async function tokenGoogle(env: Env, userId: string): Promise<{ accessToken: string; expiraEm: string | null }> {
  const conta = await contaGoogle(env, userId);
  if (!conta || !temEscopoDocs(conta.scope)) throw new ErroGoogle('sem_conta', 'Conecte o Google Docs em Veículo › Contas para escolher um documento.', 409, 'Connect Google Docs in Publication › Accounts to choose a document.');
  let t: { accessToken?: string; accessTokenExpiresAt?: Date | string };
  try {
    t = await criarAuth(env).api.getAccessToken({ body: { accountId: conta.id, userId } });
  } catch {
    throw new ErroGoogle('reconectar', RECONECTAR, 409, RECONECTAR_EN);
  }
  const expira = t.accessTokenExpiresAt ? new Date(t.accessTokenExpiresAt) : null;
  // Sem refresh token o Better Auth devolve o token velho: vencido, não serve.
  if (!t.accessToken || (expira && expira.getTime() <= Date.now())) throw new ErroGoogle('reconectar', RECONECTAR, 409, RECONECTAR_EN);
  return { accessToken: t.accessToken, expiraEm: expira?.toISOString() ?? null };
}

export const idDocValido = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(id);
export const urlDoDoc = (id: string) => `https://docs.google.com/document/d/${id}/edit`;

export interface ParagrafoDoc {
  texto: string;          // sem o \n final
  inicio: number;         // startIndex no Docs
  fim: number;            // endIndex no Docs (inclui o \n)
  estilo: string | null;  // NORMAL_TEXT, TITLE, HEADING_1…
  html: string;           // o parágrafo com negrito, itálico e links (para copiar com formatação)
  aba: string | null;     // tabId da aba do Docs (null: documento lido sem abas)
}
/** `fimAbas`: endIndex do fim do corpo de cada aba (chave: tabId, ou '' sem abas); a devolução precisa dele. */
export interface DocLido { id: string; titulo: string; revisao: string; paragrafos: ParagrafoDoc[]; fimAbas: Record<string, number> }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Corpo do documento (API do Docs) → parágrafos com texto, posição e estilo. Tabelas, sumário e quebras de seção não
 * entram (as sugestões e os comentários nem vêm nesta leitura). Parágrafo vazio fica de fora.
 */
export function paragrafosDoc(corpo: unknown, aba: string | null = null): ParagrafoDoc[] {
  const content = (corpo as { content?: unknown[] })?.content ?? [];
  const out: ParagrafoDoc[] = [];
  for (const el of content as Record<string, any>[]) {
    const p = el?.paragraph;
    if (!p) continue;
    let texto = '', html = '';
    for (const e of (p.elements ?? []) as Record<string, any>[]) {
      const run = e?.textRun;
      if (!run || typeof run.content !== 'string') continue;
      const c = run.content.replace(/\n$/, '').replace(/\u000b/g, '\n');
      texto += c;
      let h = esc(c);
      const st = run.textStyle ?? {};
      if (st.bold) h = `<b>${h}</b>`;
      if (st.italic) h = `<i>${h}</i>`;
      if (typeof st.link?.url === 'string' && /^https?:\/\//.test(st.link.url)) h = `<a href="${esc(st.link.url)}">${h}</a>`;
      html += h;
    }
    if (!texto.trim()) continue;
    out.push({ texto, inicio: Number(el.startIndex ?? 0), fim: Number(el.endIndex ?? 0), estilo: p.paragraphStyle?.namedStyleType ?? null, html, aba });
  }
  return out;
}

async function erroDaApi(res: Response): Promise<never> {
  await res.body?.cancel();
  if (res.status === 401) throw new ErroGoogle('reconectar', RECONECTAR, 409, RECONECTAR_EN);
  if (res.status === 403 || res.status === 404) throw new ErroGoogle('sem_acesso', SEM_ACESSO, 404, SEM_ACESSO_EN);
  throw new ErroGoogle('falhou', `O Google Docs não respondeu agora (${res.status}). Tente de novo em alguns minutos.`, 502, `Google Docs didn't respond (${res.status}). Try again in a few minutes.`);
}

/** Lê o documento pela API do Docs, com o token salvo da pessoa. */
export async function lerDocumento(env: Env, userId: string, docId: string): Promise<DocLido> {
  if (!idDocValido(docId)) throw new ErroGoogle('documento_invalido', DOC_INVALIDO, 400, DOC_INVALIDO_EN);
  const { accessToken } = await tokenGoogle(env, userId);
  // Sem as sugestões pendentes (o texto como está aceito; com elas, inserção e exclusão sugeridas viriam juntas) e com
  // todas as abas (sem includeTabsContent, só a primeira).
  const q = new URLSearchParams({ suggestionsViewMode: 'PREVIEW_WITHOUT_SUGGESTIONS', includeTabsContent: 'true' });
  const res = await fetch(`${API_DOCS}/${encodeURIComponent(docId)}?${q}`, {
    headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return erroDaApi(res);
  const doc = await res.json<{ documentId: string; title?: string; revisionId?: string; body?: unknown; tabs?: AbaDoc[] }>();
  const corpos: [string | null, unknown][] = doc.tabs?.length
    ? abas(doc.tabs).map((t) => [t.tabProperties?.tabId ?? null, t.documentTab?.body])
    : [[null, doc.body]];
  const fimAbas: Record<string, number> = {};
  for (const [aba, corpo] of corpos) {
    const ultimo = ((corpo as { content?: { endIndex?: number }[] })?.content ?? []).at(-1);
    fimAbas[aba ?? ''] = Number(ultimo?.endIndex ?? 1);
  }
  return {
    id: doc.documentId ?? docId, titulo: (doc.title ?? '').trim(), revisao: doc.revisionId ?? '', fimAbas,
    paragrafos: corpos.flatMap(([aba, corpo]) => paragrafosDoc(corpo, aba)),
  };
}

/**
 * Devolve ao Docs: um documents.batchUpdate com writeControl.requiredRevisionId igual à revisão lida. Se o documento
 * mudou depois (outra revisão), o Google recusa o lote inteiro e nada é escrito: ErroGoogle `mudou_no_docs`. Devolve a
 * revisão que o lote criou (null se o Google não disser).
 */
export async function atualizarDocumento(env: Env, userId: string, docId: string, revisao: string, pedidos: Record<string, unknown>[]): Promise<string | null> {
  if (!idDocValido(docId)) throw new ErroGoogle('documento_invalido', DOC_INVALIDO, 400, DOC_INVALIDO_EN);
  const { accessToken } = await tokenGoogle(env, userId);
  const res = await fetch(`${API_DOCS}/${encodeURIComponent(docId)}:batchUpdate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ requests: pedidos, writeControl: { requiredRevisionId: revisao } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.ok) {
    const r = await res.json<{ writeControl?: { requiredRevisionId?: string } }>().catch(() => null);
    return r?.writeControl?.requiredRevisionId ?? null;
  }
  if (res.status === 400 || res.status === 409) {
    const corpo = await res.text();
    if (/revision/i.test(corpo)) {
      throw new ErroGoogle('mudou_no_docs', 'O documento mudou no Google Docs depois que você trouxe o texto. Veja o que mudou lá antes de devolver.', 409, 'The document changed in Google Docs after you brought in the text. See what changed there before sending it back.');
    }
    throw new ErroGoogle('falhou', 'O Google Docs recusou a devolução. Tente de novo; se continuar, reimporte o texto.', 502, 'Google Docs refused the update. Try again; if it keeps happening, re-import the text.');
  }
  return erroDaApi(res);
}

interface AbaDoc { tabProperties?: { tabId?: string }; documentTab?: { body?: unknown }; childTabs?: AbaDoc[] }
/** Abas na ordem em que aparecem no Docs: cada uma seguida das suas subabas. */
const abas = (lista: AbaDoc[]): AbaDoc[] => lista.flatMap((t) => [t, ...abas(t.childTabs ?? [])]);

/** Texto do documento para a pauta e a mesa: os parágrafos, um por linha (título e corpo literais). */
export const textoDoDoc = (d: DocLido) => d.paragrafos.map((p) => p.texto).join('\n');
