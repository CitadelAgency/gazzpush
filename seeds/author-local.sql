-- Local D1 only (author mode, 2026-11-02): the author outlet "Cartas da Orla" as it looks after being created from the
-- Substack URL (fictional feed autora.substack.example), with the 3 most recent texts in Ideas (on real creation they
-- go straight into production; here they stay suggested, so the e2e does not call the model). The e2e
-- web/e2e/author.spec.ts simulates the creation response (the `wrangler dev` Worker cannot reach a fake feed) and lands
-- on this outlet. Idempotent (INSERT OR IGNORE). Requires the design@redacao.dev account (README, "Local testing").
-- npx wrangler d1 execute redacao-db --local --file seeds/author-local.sql

INSERT OR IGNORE INTO tenants (id, slug, nome, modo, marca_json, voz_json)
VALUES ('cartas-da-orla', 'cartas-da-orla', 'Cartas da Orla', 'autoral',
  '{"nome":"Cartas da Orla","dominio":"autora.substack.example","ctaUrl":"https://autora.substack.example","assinatura":"Ana Ribeiro","cores":{"fundo":"#123b5c","texto":"#fffcf6"},"ctas":[{"titulo":"Leia o texto completo","texto":"O texto inteiro está em Cartas da Orla.","legenda":"Texto completo: {link}"}]}',
  '{"exemplos":["Eu passei a semana inteira lendo os relatórios da Câmara sobre o transporte."]}');
INSERT OR IGNORE INTO membros (id, tenant_id, user_id, papel)
  SELECT 'm-cartas-design', 'cartas-da-orla', id, 'admin' FROM "user" WHERE email = 'design@redacao.dev';
INSERT OR IGNORE INTO fontes (id, tenant_id, tipo, nome, url, ativo, intervalo_min, ultimo_fetch_at, falhas)
VALUES ('f-cartas-feed', 'cartas-da-orla', 'rss', 'Cartas da Orla', 'https://autora.substack.example/feed', 1, 30, datetime('now', '-5 minutes'), 0);

INSERT OR IGNORE INTO documentos (id, tenant_id, fonte_id, url, hash_texto, titulo, status, triagem)
VALUES ('d-cartas-1', 'cartas-da-orla', NULL, 'https://autora.substack.example/p/contratos-sem-concorrencia', 'link:cartas-1', 'Contratos sem concorrência são a rotina do transporte', 'triado', 'autoral'),
       ('d-cartas-2', 'cartas-da-orla', NULL, 'https://autora.substack.example/p/a-orla-que-ninguem-ve', 'link:cartas-2', 'A orla que ninguém vê de manhã cedo', 'triado', 'autoral'),
       ('d-cartas-3', 'cartas-da-orla', NULL, 'https://autora.substack.example/p/carta-a-quem-chega', 'link:cartas-3', 'Carta a quem chega na cidade em novembro', 'triado', 'autoral');
INSERT OR IGNORE INTO fatos (id, tenant_id, documento_id, tipo, texto, hash)
VALUES ('fa-cartas-1a', 'cartas-da-orla', 'd-cartas-1', 'manchete', 'Contratos sem concorrência são a rotina do transporte', 'cartas-1a'),
       ('fa-cartas-1b', 'cartas-da-orla', 'd-cartas-1', 'trecho', 'O que encontrei não é escândalo, é rotina: contratos renovados sem concorrência, ano após ano.', 'cartas-1b'),
       ('fa-cartas-2a', 'cartas-da-orla', 'd-cartas-2', 'manchete', 'A orla que ninguém vê de manhã cedo', 'cartas-2a'),
       ('fa-cartas-2b', 'cartas-da-orla', 'd-cartas-2', 'trecho', 'Antes das sete, a orla é dos pescadores e de quem varre a areia.', 'cartas-2b'),
       ('fa-cartas-3a', 'cartas-da-orla', 'd-cartas-3', 'manchete', 'Carta a quem chega na cidade em novembro', 'cartas-3a'),
       ('fa-cartas-3b', 'cartas-da-orla', 'd-cartas-3', 'trecho', 'Novembro é o mês em que a cidade ainda é dos moradores.', 'cartas-3b');
INSERT OR IGNORE INTO pautas (id, tenant_id, status, origem, titulo, resumo, editoria, fato_ids_json, documento_ids_json, score)
VALUES ('p-cartas-1', 'cartas-da-orla', 'sugerida', 'manual', 'Contratos sem concorrência são a rotina do transporte',
        'O que encontrei não é escândalo, é rotina: contratos renovados sem concorrência, ano após ano.', 'politica', '["fa-cartas-1a","fa-cartas-1b"]', '["d-cartas-1"]', 1017.62),
       ('p-cartas-2', 'cartas-da-orla', 'sugerida', 'manual', 'A orla que ninguém vê de manhã cedo',
        'Antes das sete, a orla é dos pescadores e de quem varre a areia.', 'cidade', '["fa-cartas-2a","fa-cartas-2b"]', '["d-cartas-2"]', 1017.61),
       ('p-cartas-3', 'cartas-da-orla', 'sugerida', 'manual', 'Carta a quem chega na cidade em novembro',
        'Novembro é o mês em que a cidade ainda é dos moradores.', 'cultura', '["fa-cartas-3a","fa-cartas-3b"]', '["d-cartas-3"]', 1017.60);

-- Phase 10: the seed comes in as a courtesy plan.
UPDATE tenants SET plano = 'cortesia' WHERE slug = 'cartas-da-orla';
