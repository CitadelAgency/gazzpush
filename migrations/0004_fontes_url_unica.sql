-- Uma fonte por URL em cada veículo: o POST /fontes passa a inserir com ON CONFLICT (dois pedidos ao mesmo tempo não
-- duplicam). Fontes manuais (relato) têm url NULL, e NULLs não colidem no SQLite.
CREATE UNIQUE INDEX fontes_tenant_url ON fontes (tenant_id, url);
