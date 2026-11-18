-- Consumo dos modelos, uma linha por chamada: tokens e custo por veículo e por função, para o painel interno do dono.
-- Sem chave estrangeira de propósito: o registro de custo sobrevive ao veículo apagado, e uma linha de custo nunca trava o produto.
CREATE TABLE uso_modelo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  funcao TEXT NOT NULL,
  modelo TEXT NOT NULL,
  entrada INTEGER NOT NULL DEFAULT 0,
  saida INTEGER NOT NULL DEFAULT 0,
  cache_lido INTEGER NOT NULL DEFAULT 0,
  cache_escrito INTEGER NOT NULL DEFAULT 0,
  custo_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_uso_modelo_data ON uso_modelo (created_at);
