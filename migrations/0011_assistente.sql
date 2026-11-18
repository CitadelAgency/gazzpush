-- Assistente no editor da Matéria (Fase 3). Tudo aqui registra apuração; nada guarda texto escrito por modelo.

-- Ações do cartão de uma marca. Presas ao bloco e ao trecho literal da afirmação: sobrevivem à reconferência do bloco
-- enquanto a frase existir. tipo: fonte (a pessoa prende a frase a uma evidência, com o trecho literal dela; vale mais
-- que a avaliação do modelo) | outro_lado (quem, quando, por qual meio) | opiniao (vira "afirmação minha" e sai da
-- conferência) | ignorar. Desfazer não apaga: grava quem e quando (o painel de auditoria lê as ignoradas).
CREATE TABLE apuracoes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),
  bloco_id TEXT NOT NULL,
  trecho TEXT NOT NULL,
  tipo TEXT NOT NULL,
  evidencia_id TEXT REFERENCES evidencias(id),
  evidencia_trecho TEXT,
  outro_lado_quem TEXT,
  outro_lado_quando TEXT,                    -- data (AAAA-MM-DD) em que a pessoa procurou
  outro_lado_meio TEXT,                      -- email | telefone | mensagem | pessoalmente | oficio | outro
  por TEXT NOT NULL REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  desfeita_em TEXT,
  desfeita_por TEXT REFERENCES "user"(id)
);
CREATE INDEX apuracoes_texto ON apuracoes (tenant_id, texto_id);

-- Tipo da fonte, que dá a força da evidência (nunca uma lista de veículos por linha política): oficial | primaria |
-- materia | anonima. NULL: a tela sugere pelo endereço (gov.br, jus.br… = oficial) e a pessoa confirma.
ALTER TABLE evidencias ADD COLUMN tipo_fonte TEXT;

-- Segunda opinião de outro fornecedor: as duas discordaram sobre o risco → "incerto, confira".
ALTER TABLE afirmacoes ADD COLUMN incerto INTEGER NOT NULL DEFAULT 0;
-- Quem conferiu o bloco: deepseek | anthropic (desvio por tema) | deepseek+anthropic (segunda opinião).
ALTER TABLE blocos ADD COLUMN fornecedor TEXT;

-- Manual de redação do veículo: regras mecânicas que só apontam (aplicar com um clique depende de decisão do dono).
-- tipo: sigla | grafia | numero | cargo | linguagem. `procurar` é a forma a evitar; `preferir`, a do manual.
CREATE TABLE manual_regras (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  tipo TEXT NOT NULL,
  procurar TEXT NOT NULL,
  preferir TEXT,
  nota TEXT,
  por TEXT NOT NULL REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, procurar)
);

-- Checklist de publicação que trava: com pendência (risco aberto, aspa não conferida, parágrafo não conferido, conta
-- que não fecha), a Matéria só sai com a assinatura do editor, registrada com a versão e o que estava pendente.
CREATE TABLE assinaturas (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),
  versao INTEGER NOT NULL,
  por TEXT NOT NULL REFERENCES "user"(id),
  pendencias_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX assinaturas_texto ON assinaturas (tenant_id, texto_id, versao);

-- Histórico das marcas para o painel de auditoria (as afirmações são substituídas a cada conferência): estado, tema e
-- pessoas citadas de cada marca, quando saiu.
CREATE TABLE marcas_historico (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),
  bloco_id TEXT NOT NULL,
  estado TEXT NOT NULL,
  risco TEXT,
  incerto INTEGER NOT NULL DEFAULT 0,
  trecho TEXT NOT NULL,
  temas_json TEXT NOT NULL DEFAULT '[]',
  pessoas_json TEXT NOT NULL DEFAULT '[]',
  fornecedor TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX marcas_historico_tenant ON marcas_historico (tenant_id, created_at);
