-- Scenario for web/e2e/ad.spec.ts: an advertising idea and an advertising post in review in the test outlet.
-- The cleanup in seeds/ad-cleanup-local.sql comes first, in the spec.
INSERT OR IGNORE INTO fontes (id, tenant_id, tipo, nome, url) VALUES ('portal-litoral:anuncio', 'portal-litoral', 'manual', 'briefing do anunciante', NULL);
INSERT INTO documentos (id, tenant_id, fonte_id, url, hash_texto, status) VALUES ('e2e-anuncio-doc', 'portal-litoral', 'portal-litoral:anuncio', 'anuncio:e2e-anuncio-doc', 'anuncio:e2e', 'triado');
INSERT INTO fatos (id, tenant_id, documento_id, tipo, texto, hash) VALUES
  ('e2e-anuncio-f1', 'portal-litoral', 'e2e-anuncio-doc', 'manchete', 'Promoção do Mercado Bom Preço no Guarujá', 'e2e-anuncio-1'),
  ('e2e-anuncio-f2', 'portal-litoral', 'e2e-anuncio-doc', 'trecho', 'O quilo do tomate sai por R$ 19,90 até sábado', 'e2e-anuncio-2');
INSERT INTO pautas (id, tenant_id, status, origem, titulo, fato_ids_json, documento_ids_json, score, tipo_post) VALUES
  ('e2e-anuncio-pauta', 'portal-litoral', 'em_producao', 'manual', 'Promoção do Mercado Bom Preço no Guarujá', '["e2e-anuncio-f1","e2e-anuncio-f2"]', '["e2e-anuncio-doc"]', 2000, 'publicidade'),
  ('e2e-anuncio-ideia', 'portal-litoral', 'sugerida', 'manual', 'Pizza em dobro na Pizzaria do Porto toda terça', '["e2e-anuncio-f1"]', '[]', 2000, 'publicidade');
INSERT INTO anuncios (id, tenant_id, pauta_id, anunciante, por) VALUES
  ('e2e-anuncio-a1', 'portal-litoral', 'e2e-anuncio-pauta', 'Mercado Bom Preço', 'e2e'),
  ('e2e-anuncio-a2', 'portal-litoral', 'e2e-anuncio-ideia', 'Pizzaria do Porto', 'e2e');
INSERT INTO pecas (id, tenant_id, pauta_id, formato, status, versao, rodada, conteudo_json, validacao_json, arte_r2_keys_json, workflow_id) VALUES
  ('e2e-anuncio-peca', 'portal-litoral', 'e2e-anuncio-pauta', 'post', 'revisao', 1, 1,
   '{"manchete":"Tomate por R$ 19,90 no Mercado Bom Preço","resumo":"","legenda":"Publicidade · Mercado Bom Preço\n\nO quilo do tomate sai por R$ 19,90 até sábado.\n\nSiga a página.\n\nPublicidade: Mercado Bom Preço","modelo":"ia","custoUsd":0,"cards":[{"papel":"capa","titulo":"Tomate por R$ 19,90 no Mercado Bom Preço","frases":[{"texto":"O quilo do tomate sai por R$ 19,90 até sábado.","fatoId":"e2e-anuncio-f2"}]}]}',
   '{"ok":true,"erros":[],"avisos":[]}',
   '[{"papel":"capa","id":"capa","layout":"capa","png":"artes/portal-litoral/e2e-anuncio-peca/capa.jpg","jpg":"artes/portal-litoral/e2e-anuncio-peca/capa.jpg","hash":"e2e","metricas":{}}]',
   'e2e-anuncio-peca-r1');
INSERT INTO peca_versoes (id, tenant_id, peca_id, versao, rodada, conteudo_json, autor) SELECT 'e2e-anuncio-v1', tenant_id, id, 1, 1, conteudo_json, 'ia' FROM pecas WHERE id = 'e2e-anuncio-peca';
