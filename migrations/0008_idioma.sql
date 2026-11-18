-- Idioma: português do Brasil ou inglês.
-- Da pessoa (telas): null = ainda não escolheu, e a tela segue o navegador.
ALTER TABLE "user" ADD COLUMN idioma TEXT CHECK (idioma IN ('pt-BR', 'en'));
-- Do veículo (conteúdo: posts, cards, legenda e conferência). Todo veículo existente é em português.
ALTER TABLE tenants ADD COLUMN idioma TEXT NOT NULL DEFAULT 'pt-BR' CHECK (idioma IN ('pt-BR', 'en'));
