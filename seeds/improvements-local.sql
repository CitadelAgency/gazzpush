-- Local D1 only ("Product improvements" batch, 2026-11-01): state for the screenshots and the improvements.spec.ts e2e.
-- npx wrangler d1 execute redacao-db --local --file seeds/improvements-local.sql
-- Idempotent (INSERT OR IGNORE / UPDATE).

-- 1. A source that blocks fetch (simulated 403) read by the browser on the last collection, with 2 documents collected.
INSERT OR IGNORE INTO fontes (id, tenant_id, tipo, nome, url, ativo, intervalo_min, ultimo_fetch_at, falhas, via_navegador)
VALUES ('f-bng-atribuna', 'portal-litoral', 'rss', 'A Tribuna', 'https://www.atribuna.com.br/feed/', 1, 30, datetime('now', '-10 minutes'), 0, 1);
INSERT OR IGNORE INTO documentos (id, tenant_id, fonte_id, url, hash_texto, titulo, status)
VALUES ('d-atribuna-1', 'portal-litoral', 'f-bng-atribuna', 'https://www.atribuna.com.br/cidades/guaruja/exemplo-1', 'url:melhora-atribuna-1', 'Exemplo lido pelo navegador 1', 'descartado'),
       ('d-atribuna-2', 'portal-litoral', 'f-bng-atribuna', 'https://www.atribuna.com.br/cidades/guaruja/exemplo-2', 'url:melhora-atribuna-2', 'Exemplo lido pelo navegador 2', 'descartado');

-- 4. A second Portal Litoral city (Santos) and an idea from Santos, for the city filter in Ideas.
INSERT INTO tenant_areas (tenant_id, municipio_ibge, municipio_nome, bairro)
  SELECT 'portal-litoral', '3548500', 'Santos', NULL
   WHERE NOT EXISTS (SELECT 1 FROM tenant_areas WHERE tenant_id = 'portal-litoral' AND municipio_ibge = '3548500');
INSERT OR IGNORE INTO documentos (id, tenant_id, fonte_id, url, hash_texto, titulo, status, triagem)
VALUES ('d-melhora-santos', 'portal-litoral', 'f-bng-g1-santos', 'https://g1.globo.com/sp/santos-regiao/noticia/exemplo-melhora-santos.ghtml',
        'url:melhora-santos', 'Ponte dos Barreiros terá interdição parcial à noite em Santos', 'triado', 'noticia');
INSERT OR IGNORE INTO fatos (id, tenant_id, documento_id, tipo, texto, hash, municipio_ibge)
VALUES ('fa-melhora-santos-1', 'portal-litoral', 'd-melhora-santos', 'manchete', 'Ponte dos Barreiros terá interdição parcial à noite em Santos', 'melhora-santos-1', '3548500'),
       ('fa-melhora-santos-2', 'portal-litoral', 'd-melhora-santos', 'local_evento', 'A interdição parcial vale das 22h às 5h, em Santos, durante as obras de manutenção.', 'melhora-santos-2', '3548500');
INSERT OR IGNORE INTO pautas (id, tenant_id, status, origem, titulo, resumo, editoria, municipio_ibge, fato_ids_json, documento_ids_json, score)
VALUES ('p-melhora-santos', 'portal-litoral', 'sugerida', 'monitor', 'Ponte dos Barreiros terá interdição parcial à noite em Santos',
        'A interdição parcial vale das 22h às 5h, em Santos, durante as obras de manutenção.', 'transito', '3548500',
        '["fa-melhora-santos-1","fa-melhora-santos-2"]', '["d-melhora-santos"]', 40);
