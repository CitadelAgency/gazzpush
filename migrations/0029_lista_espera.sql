-- Lista de espera pública. Um e-mail, uma linha: cadastrar de novo não muda nada.
-- `ip_hash`: HMAC do IP, só para limitar abuso; o IP em si não fica guardado.
CREATE TABLE lista_espera (
  email TEXT PRIMARY KEY,
  nome TEXT,
  plano TEXT CHECK (plano IN ('pagina', 'portal')),
  idioma TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lista_espera_ip ON lista_espera (ip_hash, created_at);
