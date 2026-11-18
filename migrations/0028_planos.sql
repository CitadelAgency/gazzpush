-- Preço por veículo. Veículo novo começa em `teste`; todos os que já existem viram `cortesia`, para nada parar no deploy.
-- `assinaturas_plano`, e não `assinaturas`: esse nome já é da assinatura da matéria (0011).
ALTER TABLE tenants ADD COLUMN plano TEXT NOT NULL DEFAULT 'teste';
UPDATE tenants SET plano = 'cortesia';

CREATE TABLE assinaturas_plano (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  plano TEXT NOT NULL,
  status TEXT NOT NULL,
  stripe_customer TEXT,
  stripe_subscription TEXT,
  periodo_fim TEXT,
  atraso_desde TEXT,                         -- primeira cobrança falha em aberto; limpa quando volta a `active`
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_assinaturas_plano_stripe ON assinaturas_plano (stripe_subscription);

CREATE TABLE uso (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  mes TEXT NOT NULL,                         -- AAAA-MM em Brasília
  posts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, mes)
);

CREATE TABLE stripe_eventos (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
