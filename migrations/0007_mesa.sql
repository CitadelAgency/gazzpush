-- Mesa revisora (veículo autoral): o texto do jornalista com cada afirmação conferida contra o dossiê de evidências.
-- A IA confere, não escreve: nada aqui guarda texto sugerido pelo modelo, só marca, explicação e o trecho da evidência.
-- Enums em código (src/lib/mesa.ts), sem CHECK.

-- Texto do jornalista, importado do Google Docs ou colado. O corpo é a lista de parágrafos; `versao` sobe a cada
-- salvamento (409 se outra pessoa salvou antes). Do Docs: o documento, a revisão lida (devolver usa
-- writeControl.requiredRevisionId) e, em docs_json, os parágrafos como estavam lá (posição e formatação), para
-- devolver só o que mudou e mostrar o que mudou no Docs se ele recusar.
CREATE TABLE textos (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  titulo TEXT NOT NULL,
  paragrafos_json TEXT NOT NULL,             -- ["parágrafo", ...]
  origem TEXT NOT NULL,                      -- OrigemTexto: docs | colado
  docs_id TEXT,
  docs_revisao TEXT,
  docs_json TEXT,                            -- {fimCorpo, paragrafos: [{texto, inicio, fim, estilo, html}]}
  autor TEXT NOT NULL REFERENCES "user"(id), -- quem trouxe o texto
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  conferido_versao INTEGER,                  -- versão do corpo que a última conferência viu
  conferido_em TEXT,
  conferencia_erro TEXT,                     -- a última conferência falhou (modelo fora): a tela diz e oferece de novo
  pauta_id TEXT,                             -- última pauta criada a partir do texto (Mandar para o Instagram)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX textos_tenant ON textos (tenant_id, updated_at);

-- Dossiê do texto: cada link que a pessoa acrescentou, com o texto salvo no R2 e o hash. O cron diário relê a página
-- (textos dos últimos 90 dias): hash diferente grava `mudou_em` e um evento; a mesa e a lista avisam em âmbar.
CREATE TABLE evidencias (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),
  url TEXT NOT NULL,
  titulo TEXT,
  r2_texto TEXT NOT NULL,                    -- texto extraído quando foi acrescentada (é contra ele que a mesa confere)
  hash TEXT NOT NULL,                        -- sha256 desse texto
  via_navegador INTEGER NOT NULL DEFAULT 0,
  conferida_em TEXT NOT NULL DEFAULT (datetime('now')),   -- última leitura da página (acréscimo ou cron)
  hash_atual TEXT,                           -- hash da última leitura do cron
  mudou_em TEXT,                             -- a página mudou depois de salva (hash_atual ≠ hash)
  falhas INTEGER NOT NULL DEFAULT 0,         -- leituras do cron que não responderam, seguidas
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (texto_id, url)
);
CREATE INDEX evidencias_tenant ON evidencias (tenant_id, texto_id);
CREATE INDEX evidencias_cron ON evidencias (conferida_em);

-- Afirmações da última conferência: posição no corpo (parágrafo + caracteres), estado, categoria do risco, a evidência
-- e o trecho literal dela que sustenta (só vale se existir no texto salvo da evidência), explicação curta.
CREATE TABLE afirmacoes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),
  versao INTEGER NOT NULL,                   -- versão do texto conferida
  paragrafo INTEGER NOT NULL,
  inicio INTEGER NOT NULL,
  fim INTEGER NOT NULL,
  trecho TEXT NOT NULL,                      -- a afirmação, literal do parágrafo
  estado TEXT NOT NULL,                      -- EstadoAfirmacao: com_evidencia | sem_fonte | risco
  risco TEXT,                                -- CategoriaRisco: acusacao_sem_condenacao | vitima_ou_menor | sem_outro_lado
  evidencia_id TEXT REFERENCES evidencias(id),
  evidencia_trecho TEXT,
  explicacao TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX afirmacoes_texto ON afirmacoes (texto_id, paragrafo, inicio);
