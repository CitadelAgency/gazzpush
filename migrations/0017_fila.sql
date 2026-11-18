-- Revisão 2 da Matéria (03/11): a hora em que o arquivo (PDF ou áudio) entrou na fila. Separa o arquivo "lendo" que
-- espera a vez (entrou há pouco) do que ficou sem mensagem (entrou há mais de 10 minutos e ninguém pegou): só esse volta
-- para a fila quando a pessoa manda o mesmo arquivo de novo. É também a marca de quem pôs na fila: a fila recusou, só
-- esse pedido grava "falhou".
ALTER TABLE arquivos ADD COLUMN fila_em TEXT;
