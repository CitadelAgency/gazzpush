import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';

export const ORIGIN = 'http://localhost:8787';
const uid = () => crypto.randomUUID();

export async function seedTenant(outletName = 'Veículo') {
  const id = uid();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, municipio_ibge, marca_json, plano) VALUES (?, ?, ?, 'local', '3518701', ?, 'cortesia')")
      .bind(id, `t-${id.slice(0, 8)}`, outletName, JSON.stringify({ nome: outletName, handle: '@teste' })),
    env.DB.prepare("INSERT INTO tenant_areas (tenant_id, municipio_ibge, municipio_nome, bairro) VALUES (?, '3518701', 'Guarujá', NULL)").bind(id),
  ]);
  return id;
}

export async function seedMember(tenantId: string, userId: string, role: 'admin' | 'editor' | 'reporter' = 'admin') {
  await env.DB.prepare('INSERT INTO membros (id, tenant_id, user_id, papel) VALUES (?, ?, ?, ?)').bind(uid(), tenantId, userId, role).run();
}

/** A lead with 2 facts from a document real enough for the drafter and the validator. */
export async function seedLead(tenantId: string, status = 'sugerida') {
  const sourceId = uid(), docId = uid(), leadId = uid();
  const facts = [
    { id: uid(), tipo: 'manchete', texto: 'Prefeitura interdita ponte da Avenida Santos Dumont para obras' },
    { id: uid(), tipo: 'data', texto: 'A interdição começa na segunda-feira, 2 de novembro, e dura 15 dias' },
  ];
  await env.DB.batch([
    // A unique URL per source: (tenant_id, url) has been unique since migration 0004.
    env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome, url) VALUES (?, ?, 'rss', 'Prefeitura', ?)").bind(sourceId, tenantId, `https://exemplo.gov.br/feed/${sourceId}`),
    env.DB.prepare("INSERT INTO documentos (id, tenant_id, fonte_id, url, hash_texto, status) VALUES (?, ?, ?, 'https://exemplo.gov.br/noticia', ?, 'triado')").bind(docId, tenantId, sourceId, uid()),
    ...facts.map((f) => env.DB.prepare('INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash) VALUES (?, ?, ?, ?, ?, ?)').bind(f.id, tenantId, docId, f.tipo, f.texto, uid())),
    env.DB.prepare("INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json) VALUES (?, ?, ?, 'monitor', 'Ponte interditada', ?, ?)")
      .bind(leadId, tenantId, status, JSON.stringify(facts.map((f) => f.id)), JSON.stringify([docId])),
  ]);
  return { pautaId: leadId, fatos: facts };
}

export async function seedPiece(tenantId: string, leadId: string, o: { status?: string; versao?: number; artes?: boolean; contaId?: string } = {}) {
  const id = uid();
  const artwork = o.artes === false ? null : JSON.stringify([{ papel: 'capa', png: `artes/${tenantId}/${id}/v1/01-capa.png`, jpg: `artes/${tenantId}/${id}/v1/01-capa.jpg` }]);
  await env.DB.prepare(`INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, conteudo_json, arte_r2_keys_json, workflow_id, conta_id)
                        VALUES (?, ?, ?, 'post', ?, ?, ?, ?, ?, ?)`)
    .bind(id, tenantId, leadId, o.status ?? 'revisao', o.versao ?? 1, JSON.stringify({ manchete: 'M', legenda: 'Legenda de teste', cards: [] }), artwork, `${id}-r1`, o.contaId ?? null).run();
  return id;
}

export async function seedAccount(tenantId: string, mode: 'manual' | 'simulada' | 'real' | 'intermediario' = 'manual') {
  const id = uid();
  await env.DB.prepare("INSERT INTO contas_sociais (id, tenant_id, rede, nome, modo) VALUES (?, ?, 'instagram', 'conta teste', ?)").bind(id, tenantId, mode).run();
  return id;
}

export async function eventsOf(refId: string) {
  const { results } = await env.DB.prepare('SELECT tipo, payload_json, chave FROM eventos WHERE ref_id = ? ORDER BY id').bind(refId).all<{ tipo: string; payload_json: string | null; chave: string | null }>();
  return results.map((e) => ({ tipo: e.tipo, chave: e.chave, payload: e.payload_json ? JSON.parse(e.payload_json) : null }));
}

export const statusOf = async (table: 'pecas' | 'pautas' | 'documentos', id: string) =>
  (await env.DB.prepare(`SELECT status FROM ${table} WHERE id = ?`).bind(id).first<{ status: string }>())?.status;

// ── HTTP on the real Worker ──────────────────────────────────────────────────────────────────────────────────────────

export interface Session { cookie: string; userId: string; email: string }

export async function req(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null; cru?: { tipo: string; corpo: BodyInit }; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'content-type': init.cru?.tipo ?? 'application/json', ...init.headers };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  return (exports as { default: { fetch: (r: Request) => Promise<Response> } }).default.fetch(new Request(`${ORIGIN}${path}`, {
    method: init.method ?? (init.body === undefined && !init.cru ? 'GET' : 'POST'), headers,
    body: init.cru ? init.cru.corpo : init.body === undefined ? undefined : JSON.stringify(init.body),
  }));
}

/** Open sign-up by email/password; returns the session cookie (autoSignIn). */
export async function register(personName = 'Pessoa', email = `${uid().slice(0, 12)}@teste.dev`): Promise<Session> {
  const res = await req('/api/auth/sign-up/email', { body: { email, password: 'senha-forte-123', name: personName } });
  if (res.status !== 200) throw new Error(`sign-up ${res.status}: ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { user } = await res.json<{ user: { id: string } }>();
  return { cookie, userId: user.id, email };
}
