-- Chaves de IA por veículo (aba Chaves de IA): a chave cifrada com TOKEN_ENC_KEY (cifrarToken, como o token do Instagram), os 4
-- últimos caracteres para a tela, e quem e quando salvou. A chave em claro nunca volta ao navegador. Sem a chave do veículo, vale
-- a do servidor (as variáveis de sempre); sem nenhuma, a função fica desligada. Provedores em código (src/lib/provedoresTabela.ts).
CREATE TABLE chaves_ia (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  provedor TEXT NOT NULL,          -- deepseek | gemini | anthropic | kie | fal
  chave_enc TEXT NOT NULL,
  final TEXT NOT NULL,             -- os 4 últimos caracteres
  salva_por TEXT,                  -- user.id de quem colou
  salva_em TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, provedor)
);

-- A escolha do veículo para texto (redação, conferência, gancho, ajuste, escrita, pergunta ao documento) e para ilustração.
ALTER TABLE tenants ADD COLUMN provedor_texto TEXT NOT NULL DEFAULT 'deepseek';
ALTER TABLE tenants ADD COLUMN provedor_imagem TEXT NOT NULL DEFAULT 'kie';

-- De quem era a chave da chamada: o painel /admin/uso separa o custo que o veículo pagou com a chave dele.
ALTER TABLE uso_modelo ADD COLUMN chave TEXT NOT NULL DEFAULT 'servidor';   -- servidor | veiculo
