-- Post do anunciante (Fase 1): quem é o anunciante de uma pauta de publicidade e o link que ele usa para aprovar a arte.
-- A pauta usa tipo_post = 'publicidade'. Do token, só o SHA-256 fica no banco. O link é preso à versão da peça.
CREATE TABLE anuncios (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  pauta_id TEXT NOT NULL UNIQUE REFERENCES pautas(id),
  anunciante TEXT NOT NULL,
  por TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE anuncio_aprovacoes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  peca_id TEXT NOT NULL REFERENCES pecas(id),
  versao INTEGER NOT NULL,
  token_sha256 TEXT NOT NULL UNIQUE,
  expira_em TEXT NOT NULL,
  decisao TEXT,                              -- aprovar | ajuste
  comentario TEXT,
  decidido_em TEXT,
  por TEXT NOT NULL,                         -- quem gerou o link
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_anuncio_aprovacoes_peca ON anuncio_aprovacoes (tenant_id, peca_id, created_at);
