-- Editor da Matéria (Tiptap/ProseMirror) e conferência por bloco.
-- O documento do editor (parágrafo, intertítulo, citação, negrito, itálico, link), com um id estável por bloco.
-- `paragrafos_json` continua, derivado dele, para a conferência antiga, o Docs, o Substack e o Instagram. Texto antigo
-- sem documento abre convertido na leitura (ids p0, p1…), sem reescrever o banco.
ALTER TABLE textos ADD COLUMN doc_json TEXT;

-- A afirmação se prende ao bloco (e à posição dentro dele), não mais ao índice do parágrafo. Antigas: NULL (o índice
-- do parágrafo acha o bloco p<n> do texto convertido).
ALTER TABLE afirmacoes ADD COLUMN bloco_id TEXT;
CREATE INDEX afirmacoes_bloco ON afirmacoes (texto_id, bloco_id);

-- Estado da conferência de cada bloco: o hash do texto que foi (ou vai ser) conferido. Só o bloco com hash novo é
-- conferido de novo. estado: pendente | conferido | nao_conferido (modelo fora, recusa ou resposta inválida: a tela
-- diz, nunca some calado). `opinioes`: 1 (um modelo) ou 2 (segunda opinião de outro fornecedor, Fase 3).
CREATE TABLE blocos (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),
  bloco_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendente',
  erro TEXT,
  opinioes INTEGER NOT NULL DEFAULT 1,
  conferido_em TEXT,
  PRIMARY KEY (texto_id, bloco_id)
);
CREATE INDEX blocos_tenant ON blocos (tenant_id, texto_id);
