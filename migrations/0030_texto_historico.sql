-- Histórico do editor: o documento como estava antes de um salvamento, no máximo um a cada 10 minutos (e sempre antes de
-- restaurar). Sem chave estrangeira: é cópia de conveniência, e não pode travar nada que apague um texto.
CREATE TABLE textos_historico (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  texto_id TEXT NOT NULL,
  versao INTEGER NOT NULL,
  titulo TEXT NOT NULL,
  doc_json TEXT NOT NULL,
  por TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_textos_historico ON textos_historico (texto_id, created_at);
