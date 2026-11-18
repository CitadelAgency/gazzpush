-- Matéria viva e LAI (Fase 7): alertas na aba Depois, post de Atualização ou Errata, processos acompanhados no
-- DataJud e pedidos de acesso à informação com prazo e recurso. Só tabelas e coluna novas.

-- Alerta de uma matéria: fonte que mudou ou saiu do ar, pessoa em notícia nova, processo com movimento, prazo de LAI.
-- A chave não repete (o mesmo fato não vira dois alertas).
CREATE TABLE alertas (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),
  tipo TEXT NOT NULL,                        -- fonte_mudou | fonte_fora | pessoa | processo | lai_vence | lai_vencido
  chave TEXT NOT NULL,
  titulo TEXT NOT NULL,
  detalhe_json TEXT NOT NULL DEFAULT '{}',
  estado TEXT NOT NULL DEFAULT 'aberto',     -- aberto | resolvido | ignorado
  acao TEXT,                                 -- texto_atualizado | ignorado | post_atualizacao | post_errata
  nota TEXT,                                 -- o que a pessoa escreveu para o post de Atualização ou Errata
  pauta_id TEXT REFERENCES pautas(id),
  peca_id TEXT REFERENCES pecas(id),
  resolvido_por TEXT REFERENCES "user"(id),
  resolvido_em TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (texto_id, chave)
);
CREATE INDEX alertas_texto ON alertas (tenant_id, texto_id, estado, created_at);

-- Post de correção: o rótulo vai na manchete por código (Atualização | Errata).
ALTER TABLE pautas ADD COLUMN tipo_post TEXT;      -- atualizacao | errata

-- Processo judicial citado no texto (número CNJ), acompanhado no DataJud: o último movimento visto.
CREATE TABLE processos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),
  numero TEXT NOT NULL,                      -- só dígitos (20)
  tribunal TEXT,                             -- alias do DataJud (tjsp, trf1...); nulo quando o número não tem tribunal conhecido
  ultimo_movimento TEXT,
  ultimo_movimento_em TEXT,
  consultado_em TEXT,
  erro TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (texto_id, numero)
);

-- Pedido de LAI (Lei nº 12.527/2011): a frase sem fonte, o órgão, o pedido, o protocolo e o andamento.
CREATE TABLE pedidos_lai (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),
  bloco_id TEXT NOT NULL,
  trecho TEXT NOT NULL,
  orgao TEXT NOT NULL,
  esfera TEXT NOT NULL,                      -- federal | estadual | municipal
  pedido TEXT NOT NULL,
  protocolo TEXT,
  protocolado_em TEXT,                       -- AAAA-MM-DD (a pessoa informa; o prazo conta daqui)
  prorrogado_em TEXT,
  resposta_em TEXT,
  atendeu INTEGER,                           -- 1 atendeu, 0 não atendeu (abre o recurso)
  resposta_evidencia_id TEXT REFERENCES evidencias(id),
  recurso_em TEXT,
  recurso_texto TEXT,
  por TEXT NOT NULL REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX pedidos_lai_texto ON pedidos_lai (tenant_id, texto_id, created_at);
