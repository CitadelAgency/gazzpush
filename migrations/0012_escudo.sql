-- Escudo jurídico e página de fontes (Fase 4 da Matéria). Só tabelas e colunas novas: texto e peça antigos abrem igual.
-- Enums em código (src/lib/escudo.ts), sem CHECK.

-- Pedido de outro lado: sai por e-mail (Cloudflare Email Service) com a hora do servidor, ou é copiado pela pessoa,
-- que diz quando mandou (`enviado_em` dela; `created_at` é a hora em que o app registrou). A resposta, quando chega
-- (e-mail de volta para o endereço com o `token`, ou colada à mão), vira evidência do dossiê (`evidencias.origem`).
CREATE TABLE pedidos_outro_lado (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),
  bloco_id TEXT,                             -- a frase de que trata (parágrafo e trecho literal), se veio de uma marca
  trecho TEXT,
  para_nome TEXT NOT NULL,
  para_email TEXT,
  assunto TEXT NOT NULL,
  corpo TEXT NOT NULL,
  prazo TEXT NOT NULL,                       -- ISO; até quando o pedido espera resposta
  meio TEXT NOT NULL,                        -- MeioPedido: email (o app mandou) | copiado (a pessoa mandou por fora)
  canal TEXT,                                -- copiado: por onde a pessoa mandou (MEIOS_OUTRO_LADO)
  enviado_em TEXT,                           -- e-mail: hora do servidor no envio; copiado: a hora que a pessoa disse
  message_id TEXT,                           -- id do Email Service
  erro TEXT,                                 -- o envio falhou (o pedido fica, com o motivo, e pode ser copiado)
  token TEXT NOT NULL UNIQUE,                -- endereço de resposta: outro-lado+<token>@<domínio do remetente>
  por TEXT NOT NULL REFERENCES "user"(id),
  resposta_em TEXT,
  resposta_evidencia_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX pedidos_texto ON pedidos_outro_lado (tenant_id, texto_id, created_at);

-- Evidência que não é link (a resposta do outro lado): não entra no monitor diário nem no Wayback.
ALTER TABLE evidencias ADD COLUMN origem TEXT NOT NULL DEFAULT 'link';   -- link | resposta
-- Cópia no Wayback Machine (Save Page Now): pendente → salvo (url e hora da captura) ou falhou (motivo à vista).
ALTER TABLE evidencias ADD COLUMN wayback_estado TEXT;
ALTER TABLE evidencias ADD COLUMN wayback_url TEXT;
ALTER TABLE evidencias ADD COLUMN wayback_em TEXT;
ALTER TABLE evidencias ADD COLUMN wayback_job TEXT;
ALTER TABLE evidencias ADD COLUMN wayback_erro TEXT;

-- Retrato do texto nas horas que importam (conferência, assinatura, Instagram, página de fontes): o pacote de defesa
-- leva as versões. Uma linha por versão; a primeira vez que a versão aparece é a que fica.
CREATE TABLE texto_versoes (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),
  versao INTEGER NOT NULL,
  titulo TEXT NOT NULL,
  paragrafos_json TEXT NOT NULL,
  motivo TEXT NOT NULL,                      -- conferencia | assinatura | instagram | pagina_fontes | pacote
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (texto_id, versao)
);

-- Página de fontes pública ("Como apuramos"): retrato congelado no momento em que o editor publica. O id é o endereço
-- público (aleatório). Publicar de novo tira a anterior do ar.
CREATE TABLE paginas_fontes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),
  versao INTEGER NOT NULL,
  conteudo_json TEXT NOT NULL,
  por TEXT NOT NULL REFERENCES "user"(id),
  retirada_em TEXT,
  retirada_por TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX paginas_texto ON paginas_fontes (tenant_id, texto_id, created_at);

-- Pacote de defesa gerado: quem, quando, o hash do manifesto e o carimbo de tempo (RFC 3161) guardado no R2.
CREATE TABLE pacotes_defesa (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),
  versao INTEGER NOT NULL,
  manifesto_sha256 TEXT NOT NULL,
  carimbo_r2 TEXT,                           -- resposta da TSA (DER); nula se a TSA não respondeu
  carimbo_em TEXT,                           -- genTime da TSA
  carimbo_erro TEXT,
  por TEXT NOT NULL REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX pacotes_texto ON pacotes_defesa (tenant_id, texto_id, created_at);

-- Card final "Como apuramos" no carrossel: o endereço da página de fontes no convite (src/lib/redacao.ts, escolherCta).
ALTER TABLE pautas ADD COLUMN fontes_url TEXT;
