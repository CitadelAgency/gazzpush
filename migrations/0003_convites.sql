-- Convites de equipe (tela do veículo, aba Equipe): e-mail que ainda não tem conta. Quem já tem conta vira membro
-- na hora, sem passar por aqui. Ao criar a conta (hook do Better Auth), os convites do e-mail viram membros.
CREATE TABLE convites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,                       -- em minúsculas
  papel TEXT NOT NULL,                       -- Papel: editor | reporter (admin se promove à mão)
  criado_por TEXT NOT NULL REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  aceito_em TEXT,
  UNIQUE (tenant_id, email)
);
CREATE INDEX convites_email ON convites (email, aceito_em);
