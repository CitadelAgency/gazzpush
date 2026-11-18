-- Revisão das sete fases da Matéria (03/11). Só colunas e um índice novos.

-- A pauta da Matéria é a da versão do texto E do estado da apuração (frases com fonte, a evidência e o trecho de cada
-- uma, as "afirmações minhas"). Tirar uma evidência, ignorar uma frase ou marcar opinião muda a chave: o próximo envio
-- monta outra pauta. O índice impede duas pautas ativas iguais (dois cliques ao mesmo tempo).
ALTER TABLE pautas ADD COLUMN materia_chave TEXT;
CREATE UNIQUE INDEX pautas_materia_chave ON pautas (tenant_id, texto_id, materia_chave)
  WHERE materia_chave IS NOT NULL AND status IN ('sugerida', 'aceita', 'em_producao');

-- Leitura de PDF e transcrição pela fila: quem pegou o arquivo e quando (entrega duplicada não lê o mesmo arquivo duas
-- vezes; quem chegou atrasado não sobrescreve o resultado).
ALTER TABLE arquivos ADD COLUMN processando_em TEXT;

-- Pergunta ao documento: respondida | nao_encontrou | invalida (o modelo citou o que não está na página) | falhou (o
-- modelo não respondeu). `aviso`: a busca por sentido falhou e só a busca por palavra rodou.
ALTER TABLE perguntas ADD COLUMN situacao TEXT;
ALTER TABLE perguntas ADD COLUMN aviso TEXT;

-- LAI: a resposta ao recurso (ou à reclamação) é outra resposta, com a data, se atendeu e a evidência própria.
ALTER TABLE pedidos_lai ADD COLUMN recurso_tipo TEXT;            -- recurso | reclamacao
ALTER TABLE pedidos_lai ADD COLUMN recurso_resposta_em TEXT;
ALTER TABLE pedidos_lai ADD COLUMN recurso_atendeu INTEGER;
ALTER TABLE pedidos_lai ADD COLUMN recurso_evidencia_id TEXT REFERENCES evidencias(id);
