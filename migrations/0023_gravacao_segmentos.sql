-- Gravar no app: a sessão recebe as fatias enquanto a pessoa grava. `arquivos` só ganha a linha no concluir, com o prefixo em
-- `r2`, e cada segmento (arquivo decodificável sozinho) é transcrito por uma mensagem de fila.
CREATE TABLE gravacao_sessoes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),
  por TEXT NOT NULL,
  mime TEXT NOT NULL,
  ext TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'gravando',   -- gravando | concluindo | concluida | vazia
  arquivo_id TEXT REFERENCES arquivos(id),
  ultima_em TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_gravacao_sessoes_texto ON gravacao_sessoes (tenant_id, texto_id, estado);
CREATE INDEX idx_gravacao_sessoes_paradas ON gravacao_sessoes (estado, ultima_em);

CREATE TABLE gravacao_segmentos (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  arquivo_id TEXT NOT NULL REFERENCES arquivos(id),
  n INTEGER NOT NULL,
  r2 TEXT,                                   -- o segmento montado; antes disso, as fatias ficam em <prefixo>/<n>/<fatia>
  inicio REAL NOT NULL,                      -- segundos desde o começo da gravação
  bytes INTEGER,
  sha256 TEXT,
  estado TEXT NOT NULL DEFAULT 'fila',       -- fila | lendo | pronto | falhou
  erro TEXT,
  faltas_json TEXT NOT NULL DEFAULT '[]',    -- trechos que não chegaram: [{de, ate}], em segundos
  processando_em TEXT,
  PRIMARY KEY (arquivo_id, n)
);
