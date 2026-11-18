-- Modelos do veículo: como a peça se apresenta. Só catálogo em params_json (composição, caixa, papel das cores, sequência);
-- nenhum hex, fonte ou texto. Até seis ativos por veículo, regra na aplicação. Arquivado sai da escolha, e peça que já
-- nasceu com ele continua com a cópia em conteudo_json.
CREATE TABLE estilos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  nome TEXT NOT NULL,
  vale_para_json TEXT NOT NULL DEFAULT '{}',
  params_json TEXT NOT NULL DEFAULT '{}',
  versao INTEGER NOT NULL DEFAULT 1,
  padrao INTEGER NOT NULL DEFAULT 0,
  arquivado_em TEXT,
  por TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, nome)
);
CREATE INDEX idx_estilos_tenant ON estilos (tenant_id, arquivado_em);
