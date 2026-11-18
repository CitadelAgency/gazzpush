-- Raio-X dos posts antigos (uma miniatura por post, nada do arquivo inteiro) e a página pública do veículo.
CREATE TABLE raiox_lotes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  por TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX raiox_lotes_tenant ON raiox_lotes (tenant_id, created_at);

CREATE TABLE raiox_itens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  lote_id TEXT NOT NULL REFERENCES raiox_lotes(id),
  data TEXT,
  legenda TEXT,
  r2_miniatura TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendente',   -- pendente | limpo | marcado | ilegivel
  motivos_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX raiox_itens_lote ON raiox_itens (tenant_id, lote_id, estado, data);

ALTER TABLE tenants ADD COLUMN pagina_publica_em TEXT;
