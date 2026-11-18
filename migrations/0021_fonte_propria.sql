-- Site do portal vira fila: a data em que a fonte foi marcada como o site do veículo. Data e não booleano, para o feed
-- com dezenas de itens antigos não virar dezenas de peças.
ALTER TABLE fontes ADD COLUMN propria_desde TEXT;
