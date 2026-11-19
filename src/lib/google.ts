import type { Env } from '../env';
import { createAuth } from '../shell/auth';

// Google Docs: reads the document chosen in the Picker (Phase 1) and sends the desk's edits back (Phase 2). The
// `drive.file` scope, requested only when the person connects Docs (Google account link through Better Auth): the app
// only sees the files they chose. The token lives in Better Auth's `account` table and only the Worker uses it; the
// screen only receives the short-lived access token the Picker requires.

export const SCOPE_DOCS = 'https://www.googleapis.com/auth/drive.file';
const API_DOCS = 'https://docs.googleapis.com/v1/documents';

/** With all four variables Docs appears in the interface; without any one of them, the Google routes answer 404. */
export const googleConfigured = (env: Env) =>
  Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_API_KEY && env.GOOGLE_PROJECT_NUMBER);

export type CodeGoogle = 'sem_conta' | 'reconectar' | 'sem_acesso' | 'documento_invalido' | 'mudou_no_docs' | 'falhou';

/** An error in plain language, with the action: "reconectar" and "sem_conta" lead to "Connect again" on screen. */
export class GoogleError extends Error {
  /** `en`: the same message in English (the API picks by the request's language; `message` is the Portuguese one). */
  constructor(readonly codigo: CodeGoogle, message: string, readonly status: 400 | 404 | 409 | 502 = 409, readonly en?: string) {
    super(message);
  }
}

const RECONNECT = 'O acesso ao Google Docs venceu. Conecte de novo em Veículo › Contas.';
const WITHOUT_ACCESS = 'Este documento não está liberado para o Gazzpush. Escolha de novo pelo botão do Google Docs.';
const RECONNECT_EN = 'Your Google Docs access expired. Connect again in Publication › Accounts.';
const WITHOUT_ACCESS_EN = "This document isn't shared with Gazzpush. Choose it again with the Google Docs button.";
const INVALID_DOC = 'Documento inválido. Escolha de novo pelo botão do Google Docs.';
const DOC_INVALID_EN = 'Invalid document. Choose it again with the Google Docs button.';

/** Scopes as Better Auth stores them (comma-separated; Google sometimes returns them space-separated). */
export const hasScopeDocs = (scope: string | null | undefined) => (scope ?? '').split(/[\s,]+/).includes(SCOPE_DOCS);

/**
 * The person's Google account for Docs: the most recent one with `drive.file`. Someone who signs in with one Google
 * account and connected Docs with another has two accounts; the sign-in one (without the scope) does not hide the Docs
 * one. With none having the scope, the most recent.
 */
export async function googleAccount(env: Env, userId: string) {
  const { results } = await env.DB.prepare(`SELECT id, scope FROM account WHERE "userId" = ? AND "providerId" = 'google' ORDER BY "updatedAt" DESC`)
    .bind(userId).all<{ id: string; scope: string | null }>();
  return results.find((a) => hasScopeDocs(a.scope)) ?? results[0] ?? null;
}

/** Has the person already connected Docs (a Google account linked with `drive.file`)? */
export async function docsConnected(env: Env, userId: string) {
  return hasScopeDocs((await googleAccount(env, userId))?.scope);
}

/** A valid access token, renewed by Better Auth when it expired. If it cannot be renewed: reconnect. */
export async function tokenGoogle(env: Env, userId: string): Promise<{ accessToken: string; expiraEm: string | null }> {
  const account = await googleAccount(env, userId);
  if (!account || !hasScopeDocs(account.scope)) throw new GoogleError('sem_conta', 'Conecte o Google Docs em Veículo › Contas para escolher um documento.', 409, 'Connect Google Docs in Publication › Accounts to choose a document.');
  let t: { accessToken?: string; accessTokenExpiresAt?: Date | string };
  try {
    t = await createAuth(env).api.getAccessToken({ body: { accountId: account.id, userId } });
  } catch {
    throw new GoogleError('reconectar', RECONNECT, 409, RECONNECT_EN);
  }
  const expires = t.accessTokenExpiresAt ? new Date(t.accessTokenExpiresAt) : null;
  // Without a refresh token Better Auth returns the old token: expired, it is useless.
  if (!t.accessToken || (expires && expires.getTime() <= Date.now())) throw new GoogleError('reconectar', RECONNECT, 409, RECONNECT_EN);
  return { accessToken: t.accessToken, expiraEm: expires?.toISOString() ?? null };
}

export const docValidId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(id);
export const fromDocUrl = (id: string) => `https://docs.google.com/document/d/${id}/edit`;

export interface ParagraphDoc {
  texto: string;          // without the trailing \n
  inicio: number;         // startIndex in Docs
  fim: number;            // endIndex in Docs (includes the \n)
  estilo: string | null;  // NORMAL_TEXT, TITLE, HEADING_1…
  html: string;           // the paragraph with bold, italic and links (to copy with formatting)
  aba: string | null;     // tabId of the Docs tab (null: document read without tabs)
}
/** `fimAbas`: endIndex of the end of each tab's body (key: tabId, or '' without tabs); sending back needs it. */
export interface DocRead { id: string; titulo: string; revisao: string; paragrafos: ParagraphDoc[]; fimAbas: Record<string, number> }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Document body (Docs API) → paragraphs with text, position and style. Tables, table of contents and section breaks
 * are left out (suggestions and comments do not even come in this read). Empty paragraphs are left out.
 */
export function paragraphsDoc(body: unknown, tab: string | null = null): ParagraphDoc[] {
  const content = (body as { content?: unknown[] })?.content ?? [];
  const out: ParagraphDoc[] = [];
  for (const el of content as Record<string, any>[]) {
    const p = el?.paragraph;
    if (!p) continue;
    let text = '', html = '';
    for (const e of (p.elements ?? []) as Record<string, any>[]) {
      const run = e?.textRun;
      if (!run || typeof run.content !== 'string') continue;
      const c = run.content.replace(/\n$/, '').replace(/\u000b/g, '\n');
      text += c;
      let h = esc(c);
      const st = run.textStyle ?? {};
      if (st.bold) h = `<b>${h}</b>`;
      if (st.italic) h = `<i>${h}</i>`;
      if (typeof st.link?.url === 'string' && /^https?:\/\//.test(st.link.url)) h = `<a href="${esc(st.link.url)}">${h}</a>`;
      html += h;
    }
    if (!text.trim()) continue;
    out.push({ texto: text, inicio: Number(el.startIndex ?? 0), fim: Number(el.endIndex ?? 0), estilo: p.paragraphStyle?.namedStyleType ?? null, html, aba: tab });
  }
  return out;
}

async function fromApiError(res: Response): Promise<never> {
  await res.body?.cancel();
  if (res.status === 401) throw new GoogleError('reconectar', RECONNECT, 409, RECONNECT_EN);
  if (res.status === 403 || res.status === 404) throw new GoogleError('sem_acesso', WITHOUT_ACCESS, 404, WITHOUT_ACCESS_EN);
  throw new GoogleError('falhou', `O Google Docs não respondeu agora (${res.status}). Tente de novo em alguns minutos.`, 502, `Google Docs didn't respond (${res.status}). Try again in a few minutes.`);
}

/** Reads the document through the Docs API, with the person's saved token. */
export async function readDocument(env: Env, userId: string, docId: string): Promise<DocRead> {
  if (!docValidId(docId)) throw new GoogleError('documento_invalido', INVALID_DOC, 400, DOC_INVALID_EN);
  const { accessToken } = await tokenGoogle(env, userId);
  // Without pending suggestions (the text as accepted; with them, suggested insertions and deletions would come along)
  // and with all tabs (without includeTabsContent, only the first).
  const q = new URLSearchParams({ suggestionsViewMode: 'PREVIEW_WITHOUT_SUGGESTIONS', includeTabsContent: 'true' });
  const res = await fetch(`${API_DOCS}/${encodeURIComponent(docId)}?${q}`, {
    headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return fromApiError(res);
  const doc = await res.json<{ documentId: string; title?: string; revisionId?: string; body?: unknown; tabs?: TabDoc[] }>();
  const bodies: [string | null, unknown][] = doc.tabs?.length
    ? tabs(doc.tabs).map((t) => [t.tabProperties?.tabId ?? null, t.documentTab?.body])
    : [[null, doc.body]];
  const tabsEnd: Record<string, number> = {};
  for (const [tab, body] of bodies) {
    const last = ((body as { content?: { endIndex?: number }[] })?.content ?? []).at(-1);
    tabsEnd[tab ?? ''] = Number(last?.endIndex ?? 1);
  }
  return {
    id: doc.documentId ?? docId, titulo: (doc.title ?? '').trim(), revisao: doc.revisionId ?? '', fimAbas: tabsEnd,
    paragrafos: bodies.flatMap(([tab, body]) => paragraphsDoc(body, tab)),
  };
}

/**
 * Sends back to Docs: one documents.batchUpdate with writeControl.requiredRevisionId equal to the revision read. If the
 * document changed since (another revision), Google rejects the whole batch and nothing is written: GoogleError
 * `mudou_no_docs`. Returns the revision the batch created (null if Google does not say).
 */
export async function updateDocument(env: Env, userId: string, docId: string, review: string, requests: Record<string, unknown>[]): Promise<string | null> {
  if (!docValidId(docId)) throw new GoogleError('documento_invalido', INVALID_DOC, 400, DOC_INVALID_EN);
  const { accessToken } = await tokenGoogle(env, userId);
  const res = await fetch(`${API_DOCS}/${encodeURIComponent(docId)}:batchUpdate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ requests: requests, writeControl: { requiredRevisionId: review } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.ok) {
    const r = await res.json<{ writeControl?: { requiredRevisionId?: string } }>().catch(() => null);
    return r?.writeControl?.requiredRevisionId ?? null;
  }
  if (res.status === 400 || res.status === 409) {
    const body = await res.text();
    if (/revision/i.test(body)) {
      throw new GoogleError('mudou_no_docs', 'O documento mudou no Google Docs depois que você trouxe o texto. Veja o que mudou lá antes de devolver.', 409, 'The document changed in Google Docs after you brought in the text. See what changed there before sending it back.');
    }
    throw new GoogleError('falhou', 'O Google Docs recusou a devolução. Tente de novo; se continuar, reimporte o texto.', 502, 'Google Docs refused the update. Try again; if it keeps happening, re-import the text.');
  }
  return fromApiError(res);
}

interface TabDoc { tabProperties?: { tabId?: string }; documentTab?: { body?: unknown }; childTabs?: TabDoc[] }
/** Tabs in the order they appear in Docs: each followed by its subtabs. */
const tabs = (list: TabDoc[]): TabDoc[] => list.flatMap((t) => [t, ...tabs(t.childTabs ?? [])]);

/** The document's text for the lead and the desk: the paragraphs, one per line (title and body verbatim). */
export const fromDocText = (d: DocRead) => d.paragrafos.map((p) => p.texto).join('\n');
