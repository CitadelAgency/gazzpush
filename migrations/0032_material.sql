-- Material ao lado (o organizador de fontes do editor): os recortes de cada texto. Recorte de fonte é o trecho literal do
-- texto guardado dela (evidência, página de PDF, transcrição), conferido por código ao guardar; anotação (`origem` nota) é o
-- texto da pessoa. Com `acervo` = 1, o recorte aparece no acervo do veículo, para qualquer texto trazer. Só tabela nova;
-- enums em código (src/lib/material.ts), sem CHECK. "Já está no texto" não é coluna: a tela compara com o texto salvo.

CREATE TABLE recortes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  texto_id TEXT NOT NULL REFERENCES textos(id),   -- o texto em que foi guardado
  origem TEXT NOT NULL,                           -- OrigemRecorte: evidencia | documento | gravacao | nota
  -- Sem REFERENCES: a evidência sai do dossiê (removerEvidencia apaga a linha) e o recorte fica, com o retrato da fonte.
  evidencia_id TEXT,                              -- origem evidencia
  arquivo_id TEXT,                                -- origem documento ou gravacao
  pagina INTEGER,                                 -- documento
  inicio REAL,                                    -- gravacao: segundo em que o trecho começa
  trecho TEXT NOT NULL,                           -- literal da fonte, com os espaços juntos; na anotação, o texto da pessoa
  nota TEXT,                                      -- anotação da pessoa sobre o recorte
  fonte_nome TEXT,                                -- retrato do nome e do endereço da fonte, para o acervo mostrar a origem
  fonte_url TEXT,
  acervo INTEGER NOT NULL DEFAULT 0,
  ordem REAL NOT NULL,                            -- ordem manual (subir e descer renumeram de 1 em diante)
  por TEXT NOT NULL REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX recortes_texto ON recortes (tenant_id, texto_id, ordem);
CREATE INDEX recortes_acervo ON recortes (tenant_id, created_at) WHERE acervo = 1;
-- O mesmo recorte duas vezes no mesmo texto (o clique repetido, trazer do acervo de novo) é o de antes.
CREATE UNIQUE INDEX recortes_unico ON recortes (texto_id, origem, IFNULL(evidencia_id, ''), IFNULL(arquivo_id, ''), IFNULL(pagina, -1), trecho);
