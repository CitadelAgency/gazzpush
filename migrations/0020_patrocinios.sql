-- Cota de patrocínio na arte: o patrocinador e o período. O modelo liga a faixa em estilos.params.patrocinio.
CREATE TABLE patrocinios (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  nome TEXT NOT NULL,
  logo_r2 TEXT,
  inicio TEXT NOT NULL,                      -- AAAA-MM-DD, vale o dia inteiro
  fim TEXT NOT NULL,                         -- AAAA-MM-DD, vale o dia inteiro
  por TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  arquivado_em TEXT
);
CREATE INDEX idx_patrocinios_tenant ON patrocinios (tenant_id, arquivado_em);
