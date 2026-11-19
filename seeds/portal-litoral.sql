-- The in-house network's tenant: Portal Litoral. Usage: wrangler d1 execute redacao-db --local --file seeds/portal-litoral.sql
-- Handle, colours, CTAs and logo are a proposal; the UPDATE at the end syncs marca_json when the seed runs again.
INSERT OR IGNORE INTO tenants (id, slug, nome, modo, temas_json, uf, municipio_ibge, marca_json, voz_json) VALUES (
  'portal-litoral', 'portal-litoral', 'Portal Litoral', 'local', '[]', 'SP', '3518701', '{}',
  '{"tom":"direto, local, sem sensacionalismo; fala com o morador, não com a imprensa","exemplos":[],"evitar":["clickbait","adjetivos de opinião","emoji em excesso"]}'
);

UPDATE tenants SET marca_json = json('{
  "nome": "Portal Litoral",
  "handle": "@portal.litoral",
  "dominio": "instagram.com/portal.litoral",
  "cores": {"fundo": "#101828", "texto": "#fffcf6", "acento": "#ff8a3d"},
  "arteRefR2": "marcas/portal-litoral/referencia.png",
  "ctas": [
    {"titulo": "Seu bairro, com fonte.", "texto": "Notícia de Guarujá checada contra a fonte original, todo dia.", "legenda": "Siga @portal.litoral pra receber as notícias do seu bairro.",
     "acao": "Siga @portal.litoral", "edicao": "No feed",
     "destaques": {"titulo": "O que você recebe", "itens": ["Toda notícia com a fonte no rodapé", "Só Guarujá, bairro por bairro"]},
     "telefone": {"titulo": "Portal Litoral", "status": "Página · responde no direct", "rotulo": "Exemplo de direct",
       "mensagens": [{"de": "morador", "texto": "Tá sem luz na Enseada desde as 14h, alguém sabe?"}, {"de": "pagina", "texto": "Recebido! Confirmando com a concessionária. Publicamos assim que tiver fonte."}]}},
    {"titulo": "Viu algo no seu bairro?", "texto": "Manda no direct. A gente apura e publica com a fonte.", "legenda": "Viu algo no seu bairro? Manda no direct.",
     "acao": "Manda no direct", "edicao": "No direct",
     "destaques": {"titulo": "Como funciona", "itens": ["Você manda foto ou relato", "A gente apura e publica com a fonte"]},
     "telefone": {"titulo": "Portal Litoral", "status": "Página · responde no direct", "rotulo": "Exemplo de direct",
       "mensagens": [{"de": "morador", "texto": "Alagou a Av. Puglisi agora, carro parado na pista."}, {"de": "pagina", "texto": "Valeu! Já estamos checando com a Defesa Civil."}]}},
    {"titulo": "Compartilhe com o vizinho.", "texto": "Quem mora perto precisa saber primeiro.", "legenda": "Compartilha com quem mora perto.",
     "acao": "Compartilhe este post", "edicao": "Pra rua toda",
     "destaques": {"titulo": "Por quê", "itens": ["Quem mora perto precisa saber primeiro", "Fonte em todo post"]},
     "telefone": {"titulo": "Portal Litoral", "status": "Página · responde no direct", "rotulo": "Exemplo de direct",
       "mensagens": [{"de": "morador", "texto": "Posso mandar esse post pro grupo da rua?"}, {"de": "pagina", "texto": "Pode! Vai com a fonte junto, é pra isso que ela está lá."}]}}
  ]
}') WHERE id = 'portal-litoral';

INSERT OR IGNORE INTO tenant_areas (tenant_id, municipio_ibge, municipio_nome, bairro) VALUES
  ('portal-litoral', '3518701', 'Guarujá', NULL);

INSERT OR IGNORE INTO fontes (id, tenant_id, tipo, nome, url, editoria, intervalo_min) VALUES
  ('f-bng-prefeitura', 'portal-litoral', 'rss', 'Prefeitura de Guarujá', 'https://www.guaruja.sp.gov.br/feed/', 'cidade', 30),
  ('f-bng-g1-santos', 'portal-litoral', 'rss', 'G1 Santos e Região', 'https://g1.globo.com/rss/g1/sp/santos-regiao/', NULL, 30);

-- Instagram accounts. Publisher priority: real > intermediario > manual > simulada.
--   manual   = default without a Meta app: an approved piece becomes "ready", the operator publishes from the phone and confirms with the URL.
--   simulada = Graph API test without sending (stores the calls in events). Mark it 'removida' to fall back to manual.
-- When there is a Meta app: POST /api/tenants/portal-litoral/contas {externalId, token, modo:"real"}.
INSERT OR IGNORE INTO contas_sociais (id, tenant_id, rede, external_id, nome, status, modo) VALUES
  ('c-bng-ig-manual', 'portal-litoral', 'instagram', NULL, '@portal.litoral (manual, celular)', 'ativa', 'manual'),
  ('c-bng-ig-simulada', 'portal-litoral', 'instagram', NULL, '@portal.litoral (simulada)', 'ativa', 'simulada');

-- Phase 10: the seed comes in as a courtesy plan.
UPDATE tenants SET plano = 'cortesia' WHERE id IN (SELECT id FROM tenants WHERE slug = 'portal-litoral');
