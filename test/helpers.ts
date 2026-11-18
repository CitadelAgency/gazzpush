import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';

export const ORIGEM = 'http://localhost:8787';
const uid = () => crypto.randomUUID();

export async function seedTenant(nome = 'Veículo') {
  const id = uid();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO tenants (id, slug, nome, modo, municipio_ibge, marca_json, plano) VALUES (?, ?, ?, 'local', '3518701', ?, 'cortesia')")
      .bind(id, `t-${id.slice(0, 8)}`, nome, JSON.stringify({ nome, handle: '@teste' })),
    env.DB.prepare("INSERT INTO tenant_areas (tenant_id, municipio_ibge, municipio_nome, bairro) VALUES (?, '3518701', 'Guarujá', NULL)").bind(id),
  ]);
  return id;
}

export async function seedMembro(tenantId: string, userId: string, papel: 'admin' | 'editor' | 'reporter' = 'admin') {
  await env.DB.prepare('INSERT INTO membros (id, tenant_id, user_id, papel) VALUES (?, ?, ?, ?)').bind(uid(), tenantId, userId, papel).run();
}

/** Pauta com 2 fatos de um documento real o bastante pro redator e o validador. */
export async function seedPauta(tenantId: string, status = 'sugerida') {
  const fonteId = uid(), docId = uid(), pautaId = uid();
  const fatos = [
    { id: uid(), tipo: 'manchete', texto: 'Primeiro trecho do documento' },
    { id: uid(), tipo: 'data', texto: 'Segundo trecho do documento' },
  ];
  await env.DB.batch([
    // URL única por fonte: (tenant_id, url) é único desde a migration 0004.
    env.DB.prepare("INSERT INTO fontes (id, tenant_id, tipo, nome, url) VALUES (?, ?, 'rss', 'Fonte', ?)").bind(fonteId, tenantId, `https://source.example/feed/${fonteId}`),
    env.DB.prepare("INSERT INTO documentos (id, tenant_id, fonte_id, url, hash_texto, status) VALUES (?, ?, ?, 'https://source.example/noticia', ?, 'triado')").bind(docId, tenantId, fonteId, uid()),
    ...fatos.map((f) => env.DB.prepare('INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash) VALUES (?, ?, ?, ?, ?, ?)').bind(f.id, tenantId, docId, f.tipo, f.texto, uid())),
    env.DB.prepare("INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json) VALUES (?, ?, ?, 'monitor', 'Título da pauta', ?, ?)")
      .bind(pautaId, tenantId, status, JSON.stringify(fatos.map((f) => f.id)), JSON.stringify([docId])),
  ]);
  return { pautaId, fatos };
}

export async function seedPeca(tenantId: string, pautaId: string, o: { status?: string; versao?: number; artes?: boolean; contaId?: string } = {}) {
  const id = uid();
  const artes = o.artes === false ? null : JSON.stringify([{ papel: 'capa', png: `artes/${tenantId}/${id}/v1/01-capa.png`, jpg: `artes/${tenantId}/${id}/v1/01-capa.jpg` }]);
  await env.DB.prepare(`INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, conteudo_json, arte_r2_keys_json, workflow_id, conta_id)
                        VALUES (?, ?, ?, 'post', ?, ?, ?, ?, ?, ?)`)
    .bind(id, tenantId, pautaId, o.status ?? 'revisao', o.versao ?? 1, JSON.stringify({ manchete: 'M', legenda: 'Legenda de teste', cards: [] }), artes, `${id}-r1`, o.contaId ?? null).run();
  return id;
}

export async function seedConta(tenantId: string, modo: 'manual' | 'simulada' | 'real' | 'intermediario' = 'manual') {
  const id = uid();
  await env.DB.prepare("INSERT INTO contas_sociais (id, tenant_id, rede, nome, modo) VALUES (?, ?, 'instagram', 'conta teste', ?)").bind(id, tenantId, modo).run();
  return id;
}

export async function eventosDe(refId: string) {
  const { results } = await env.DB.prepare('SELECT tipo, payload_json, chave FROM eventos WHERE ref_id = ? ORDER BY id').bind(refId).all<{ tipo: string; payload_json: string | null; chave: string | null }>();
  return results.map((e) => ({ tipo: e.tipo, chave: e.chave, payload: e.payload_json ? JSON.parse(e.payload_json) : null }));
}

export const statusDe = async (tabela: 'pecas' | 'pautas' | 'documentos', id: string) =>
  (await env.DB.prepare(`SELECT status FROM ${tabela} WHERE id = ?`).bind(id).first<{ status: string }>())?.status;

// ── HTTP no Worker real ──────────────────────────────────────────────────────────────────────────────────────────

export interface Sessao { cookie: string; userId: string; email: string; password: string }

export async function req(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null; cru?: { tipo: string; corpo: BodyInit }; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'content-type': init.cru?.tipo ?? 'application/json', ...init.headers };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin !== null) headers.origin = init.origin ?? ORIGEM;
  return (exports as { default: { fetch: (r: Request) => Promise<Response> } }).default.fetch(new Request(`${ORIGEM}${path}`, {
    method: init.method ?? (init.body === undefined && !init.cru ? 'GET' : 'POST'), headers,
    body: init.cru ? init.cru.corpo : init.body === undefined ? undefined : JSON.stringify(init.body),
  }));
}

/** Cadastro aberto por e-mail/senha; devolve o cookie de sessão (autoSignIn). */
export async function cadastrar(nome = 'Pessoa', email = `${uid().slice(0, 12)}@example.test`): Promise<Sessao> {
  const password = crypto.randomUUID();
  const res = await req('/api/auth/sign-up/email', { body: { email, password, name: nome } });
  if (res.status !== 200) throw new Error(`sign-up ${res.status}: ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { user } = await res.json<{ user: { id: string } }>();
  return { cookie, userId: user.id, email, password };
}
