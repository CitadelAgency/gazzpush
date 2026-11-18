-- Reels com a voz do dono. Tabela própria porque `arquivos.texto_id` é NOT NULL, e peça de veículo local não tem texto.
CREATE TABLE narracoes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  peca_id TEXT NOT NULL REFERENCES pecas(id),
  versao INTEGER NOT NULL,                   -- a versão do carrossel cujo roteiro foi lido
  r2 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  mime TEXT NOT NULL,
  duracao REAL,
  palavras_json TEXT NOT NULL DEFAULT '[]',
  avisos_json TEXT NOT NULL DEFAULT '[]',
  estado TEXT NOT NULL DEFAULT 'lendo',      -- lendo | pronto | falhou
  erro TEXT,
  por TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_narracoes_peca ON narracoes (tenant_id, peca_id, created_at);
