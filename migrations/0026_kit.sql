-- Kit para quando a conta cai: certidão de cada post publicado, emitida na publicação, e o caso aberto.
CREATE TABLE certidoes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  peca_id TEXT NOT NULL REFERENCES pecas(id),
  versao INTEGER NOT NULL,
  sha256 TEXT,                               -- do manifesto
  r2_manifesto TEXT,
  r2_carimbo TEXT,
  carimbo_em TEXT,
  tsa TEXT,
  erro TEXT,                                 -- a falha fica à vista até alguém gerar de novo
  na_publicacao INTEGER NOT NULL DEFAULT 1,  -- 0: gerada depois, e o documento diz isso
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (peca_id, versao)
);
CREATE INDEX certidoes_tenant ON certidoes (tenant_id, created_at);

CREATE TABLE kit_casos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  tipo TEXT NOT NULL,
  aberto_em TEXT NOT NULL,                   -- quando a conta caiu, dito pela pessoa
  prazo_em TEXT,                             -- copiado do aviso: o prazo da Meta não é número fixo no app
  nota TEXT,
  por TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX kit_casos_tenant ON kit_casos (tenant_id, created_at);
