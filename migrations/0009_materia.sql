-- A Matéria (veículo autoral): o registro de `textos` com abas Dossiê · Texto · Posts · Depois. O carrossel herda as
-- evidências: "Mandar para o Instagram" monta a pauta com fatos vindos das afirmações conferidas, não do texto inteiro.

-- Ligação texto ↔ pautas (todas, não só a última): a aba Posts lista as peças das pautas do texto. `texto_versao`: a
-- versão do texto que virou a pauta (mandar de novo a mesma versão devolve a pauta ativa).
ALTER TABLE pautas ADD COLUMN texto_id TEXT;
ALTER TABLE pautas ADD COLUMN texto_versao INTEGER;
CREATE INDEX pautas_texto ON pautas (tenant_id, texto_id);
-- A última pauta de cada texto (textos.pauta_id) já era uma ligação: entra na coluna nova, sem mexer em mais nada.
UPDATE pautas SET texto_id = (SELECT t.id FROM textos t WHERE t.pauta_id = pautas.id AND t.tenant_id = pautas.tenant_id)
 WHERE texto_id IS NULL AND EXISTS (SELECT 1 FROM textos t WHERE t.pauta_id = pautas.id AND t.tenant_id = pautas.tenant_id);

-- Fato vindo de uma afirmação da Matéria: o texto do fato é a frase do autor (literal do corpo), o documento é a
-- evidência (URL dela) e aqui fica o trecho literal da evidência que a sustenta, para a Revisão mostrar por frase.
ALTER TABLE fatos ADD COLUMN evidencia_id TEXT;
ALTER TABLE fatos ADD COLUMN evidencia_trecho TEXT;
