-- Fonte que barra o fetch (403/429) é lida pelo Browser Rendering. 1 = a última coleta boa precisou do navegador
-- (a tela do veículo diz "lida pelo navegador"); 0 = fetch comum.
ALTER TABLE fontes ADD COLUMN via_navegador INTEGER NOT NULL DEFAULT 0;
