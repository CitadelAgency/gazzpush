-- Pergunte ao documento (Fase 5 da Matéria): PDF no R2, texto por página, busca por palavra (FTS5) e por sentido
-- (Vectorize, índice redacao-documentos), perguntas com resposta citada e conferida por código. Só tabelas novas.

-- Arquivo do dossiê (PDF agora; o áudio da Fase 6 usa a mesma tabela). Lido na fila: lendo → pronto | falhou.
CREATE TABLE arquivos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),
  tipo TEXT NOT NULL,                        -- pdf
  nome TEXT NOT NULL,
  r2 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'lendo',      -- lendo | pronto | falhou
  erro TEXT,
  paginas INTEGER,
  vetor TEXT,                                -- indexado | desligado | falhou: a busca por sentido (sem ela, só por palavra)
  entidades_json TEXT,                       -- pessoas, empresas, CNPJs, valores e datas, com as páginas (por código)
  totais_json TEXT,                          -- total ou soma de valores por página, para cruzar com o texto
  por TEXT NOT NULL REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (texto_id, sha256)
);
CREATE INDEX arquivos_texto ON arquivos (tenant_id, texto_id, created_at);

-- Texto de cada página, como o PDF tem (é contra ele que a citação é conferida).
CREATE TABLE arquivo_paginas (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  arquivo_id TEXT NOT NULL REFERENCES arquivos(id),
  pagina INTEGER NOT NULL,
  texto TEXT NOT NULL,
  PRIMARY KEY (arquivo_id, pagina)
);

-- Busca por palavra (sem acento, sem caixa). As colunas de id só filtram.
CREATE VIRTUAL TABLE arquivo_paginas_fts USING fts5(texto, arquivo_id UNINDEXED, tenant_id UNINDEXED, pagina UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');

-- Cada pergunta: a resposta, as citações que conferiram (página e trecho literal) e as que o código descartou.
CREATE TABLE perguntas (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),
  arquivo_id TEXT NOT NULL REFERENCES arquivos(id),
  pergunta TEXT NOT NULL,
  resposta TEXT,                             -- nula quando não achou
  citacoes_json TEXT NOT NULL DEFAULT '[]',
  descartadas_json TEXT NOT NULL DEFAULT '[]',
  encontrou INTEGER NOT NULL DEFAULT 0,
  busca TEXT NOT NULL,                       -- palavra | palavra+sentido
  custo_usd REAL NOT NULL DEFAULT 0,
  por TEXT NOT NULL REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX perguntas_arquivo ON perguntas (tenant_id, arquivo_id, created_at);
