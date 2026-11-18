-- Aspas contra a gravação (Fase 6 da Matéria): o áudio da entrevista entra em `arquivos` (tipo 'audio'), a fila
-- transcreve com o Whisper do Workers AI e cada trecho fica com o tempo de cada palavra. Só colunas e tabela novas.

ALTER TABLE arquivos ADD COLUMN mime TEXT;          -- audio/mpeg, audio/mp4, ... (pelo começo do arquivo)
ALTER TABLE arquivos ADD COLUMN duracao REAL;       -- segundos, da transcrição

-- Trecho da transcrição como o Whisper devolveu (o texto não é corrigido); palavras_json: [{p, i, f}] em segundos.
CREATE TABLE gravacao_trechos (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  arquivo_id TEXT NOT NULL REFERENCES arquivos(id),
  n INTEGER NOT NULL,
  inicio REAL NOT NULL,
  fim REAL NOT NULL,
  texto TEXT NOT NULL,
  palavras_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (arquivo_id, n)
);
