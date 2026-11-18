-- Redação: schema inicial (squash de 0001–0004 antes do primeiro deploy; daqui em diante, só migração nova).
-- Multi-tenant: tenant_id em toda tabela de domínio. Auth (user/session/account/verification) em 0002_auth.sql.
-- Enums ficam em código (src/kernel/estados.ts). CHECK só pra invariante estrutural: adicionar um status ou formato
-- não pode exigir recriar tabela com FK.

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  modo TEXT NOT NULL DEFAULT 'local',        -- ModoTenant: local (triagem por área) | tematico (por temas)
  temas_json TEXT NOT NULL DEFAULT '[]',     -- editorias/temas que o monitor aceita
  uf TEXT,
  municipio_ibge TEXT,                       -- município principal (modo local)
  marca_json TEXT NOT NULL DEFAULT '{}',     -- logo, cores, fontes, CTAs, referência de ilustração
  voz_json TEXT NOT NULL DEFAULT '{}',       -- exemplos de posts, tom
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Área coberta: município obrigatório, bairro opcional (NULL = município inteiro).
CREATE TABLE tenant_areas (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  municipio_ibge TEXT NOT NULL,
  municipio_nome TEXT,                       -- vira enum de cidade na triagem
  bairro TEXT,
  PRIMARY KEY (tenant_id, municipio_ibge, bairro)
);

-- Pessoa × veículo × papel. user_id aponta pra tabela "user" do Better Auth (0002).
CREATE TABLE membros (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  papel TEXT NOT NULL,                       -- Papel: admin | editor | reporter
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX membros_user ON membros (user_id);

CREATE TABLE fontes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  tipo TEXT NOT NULL,                        -- TipoFonte: rss | html | oficial | manual
  nome TEXT NOT NULL,
  url TEXT,
  editoria TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  intervalo_min INTEGER NOT NULL DEFAULT 30 CHECK (intervalo_min > 0),
  ultimo_fetch_at TEXT,
  etag TEXT,
  last_modified TEXT,
  falhas INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX fontes_due ON fontes (ativo, ultimo_fetch_at);

-- Documento = uma página/matéria capturada. Bruto e texto vão pro R2; aqui só metadado.
CREATE TABLE documentos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  fonte_id TEXT REFERENCES fontes(id),
  url TEXT NOT NULL,
  url_canonica TEXT,
  hash_texto TEXT NOT NULL,                  -- sha256 do texto extraído; dedupe exato
  titulo TEXT,
  publicado_em TEXT,                         -- data da fonte
  capturado_em TEXT NOT NULL DEFAULT (datetime('now')),
  r2_bruto TEXT,
  r2_texto TEXT,
  status TEXT NOT NULL DEFAULT 'novo',       -- StatusDocumento (só transitar() escreve)
  triagem TEXT,                              -- Triagem: noticia | pista | boato | balanco | fora_area | duplicado
  triagem_json TEXT,
  UNIQUE (tenant_id, hash_texto)
);
CREATE INDEX documentos_status ON documentos (tenant_id, status);

-- Fato = afirmação literal com span no texto do documento. Cada frase da peça aponta pra um fato.
CREATE TABLE fatos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  documento_id TEXT NOT NULL REFERENCES documentos(id),
  tipo TEXT,                                 -- manchete, data, local_evento...
  texto TEXT NOT NULL,
  span_inicio INTEGER,
  span_fim INTEGER,
  hash TEXT NOT NULL,
  municipio_ibge TEXT,
  bairro TEXT,
  lat REAL,
  lon REAL,
  geo_metodo TEXT,                           -- geojson, texto, fonte, nenhum
  data_fato TEXT,
  confianca REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX fatos_doc ON fatos (documento_id);

CREATE TABLE pautas (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  status TEXT NOT NULL DEFAULT 'sugerida',   -- StatusPauta (só transitar() escreve)
  origem TEXT NOT NULL,                      -- monitor | manual | whatsapp
  titulo TEXT NOT NULL,
  resumo TEXT,
  editoria TEXT,
  municipio_ibge TEXT,
  bairro TEXT,
  fato_ids_json TEXT NOT NULL DEFAULT '[]',
  documento_ids_json TEXT NOT NULL DEFAULT '[]',
  score REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX pautas_fila ON pautas (tenant_id, status, score);

CREATE TABLE pecas (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  pauta_id TEXT NOT NULL REFERENCES pautas(id),
  formato TEXT NOT NULL,                     -- Formato: post | carrossel (stories, x, materia depois)
  status TEXT NOT NULL DEFAULT 'rascunho',   -- StatusPeca (só transitar() escreve)
  rodada INTEGER NOT NULL DEFAULT 1 CHECK (rodada >= 1),   -- rodada de produção (1 + reescritas pedidas na revisão)
  versao INTEGER NOT NULL DEFAULT 0 CHECK (versao >= 0),   -- versão em peca_versoes exibida agora (0 = nenhuma)
  conteudo_json TEXT NOT NULL DEFAULT '{}',  -- manchete, resumo, legenda, cards[], frases[{texto, fatoId}]
  validacao_json TEXT,
  arte_r2_keys_json TEXT,
  workflow_id TEXT,                          -- instância de ProducaoWorkflow da rodada atual
  conta_id TEXT,                             -- conta escolhida na aprovação
  agendado_para TEXT,
  erro TEXT,                                 -- motivo do último estado terminal sem sucesso (falhou, rejeitada)
  custo_usd REAL NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX pecas_fila ON pecas (tenant_id, status, updated_at);
CREATE INDEX pecas_pauta ON pecas (pauta_id);

-- Uma linha por chamada ao modelo de redação. UNIQUE(peca_id, versao) é a chave de idempotência do step redigir.
CREATE TABLE peca_versoes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  peca_id TEXT NOT NULL REFERENCES pecas(id),
  versao INTEGER NOT NULL CHECK (versao >= 1),
  rodada INTEGER NOT NULL,
  conteudo_json TEXT NOT NULL,
  autor TEXT NOT NULL,                       -- 'ia' ou user_id
  modelo TEXT,
  custo_usd REAL NOT NULL DEFAULT 0,
  motivo TEXT,                               -- instrução que gerou a versão (editor ou validador)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (peca_id, versao)
);

-- Revisão humana é registro, não evento em voo. Uma decisão por (peça, versão, tipo).
CREATE TABLE decisoes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  peca_id TEXT NOT NULL REFERENCES pecas(id),
  versao INTEGER NOT NULL,
  decisao TEXT NOT NULL,                     -- Decisao: aprovar | reescrever | rejeitar
  por TEXT NOT NULL,                         -- user.id da sessão
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (peca_id, versao, decisao)
);
CREATE INDEX decisoes_tenant ON decisoes (tenant_id, created_at);

CREATE TABLE contas_sociais (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  rede TEXT NOT NULL,                        -- instagram | x | whatsapp | wordpress
  modo TEXT NOT NULL DEFAULT 'manual',       -- ModoConta: manual | real | intermediario | simulada
  external_id TEXT,
  nome TEXT,
  token_enc TEXT,                            -- AES-GCM (crypto.ts)
  token_expira_em TEXT,
  provedor TEXT,                             -- modo intermediario: ayrshare | postpeer | zernio ...
  provedor_ref TEXT,                         -- id do perfil no intermediário
  status TEXT NOT NULL DEFAULT 'ativa',      -- ativa | reconectar | removida
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX contas_tenant ON contas_sociais (tenant_id, rede, status);

-- Uma peça publicada (ou tentada) num canal. Peça 1:N.
CREATE TABLE publicacoes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  peca_id TEXT NOT NULL REFERENCES pecas(id),
  conta_id TEXT,
  rede TEXT NOT NULL,
  modo TEXT NOT NULL,                        -- modo da conta no momento da publicação
  external_id TEXT,
  url TEXT,
  publicado_em TEXT,
  status TEXT NOT NULL,                      -- publicada | falhou
  erro TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX publicacoes_peca ON publicacoes (peca_id);
CREATE INDEX publicacoes_tenant ON publicacoes (tenant_id, created_at);

-- Uma instância de Workflow. id = id da instância (determinístico: <peca>-r<n>, <peca>-pub-<n>).
CREATE TABLE execucoes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  tipo TEXT NOT NULL,                        -- producao | publicacao
  ref_tipo TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  params_json TEXT NOT NULL,                 -- params do create: o reconciliador recria a instância se o request morreu antes
  status TEXT NOT NULL DEFAULT 'rodando',    -- rodando | concluida | falhou
  custo_usd REAL NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  erro TEXT,
  iniciado_em TEXT NOT NULL DEFAULT (datetime('now')),
  terminado_em TEXT
);
CREATE INDEX execucoes_ref ON execucoes (ref_tipo, ref_id);
CREATE INDEX execucoes_abertas ON execucoes (status, iniciado_em, id);
CREATE INDEX execucoes_tenant ON execucoes (tenant_id, iniciado_em);

-- Log de tudo que acontece. Cursor de polling = (tenant_id, id). chave = idempotência de efeito replayado.
CREATE TABLE eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT,
  tipo TEXT NOT NULL,
  ref_tipo TEXT,
  ref_id TEXT,
  payload_json TEXT,
  chave TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX eventos_cursor ON eventos (tenant_id, id);
CREATE INDEX eventos_ref ON eventos (ref_tipo, ref_id);
CREATE UNIQUE INDEX eventos_chave ON eventos (chave) WHERE chave IS NOT NULL;
