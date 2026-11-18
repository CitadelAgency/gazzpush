-- Resumo do dia: liga por veículo, na aba Fontes. O cron das 18h de Brasília só olha quem ligou.
ALTER TABLE tenants ADD COLUMN resumo_ligado INTEGER NOT NULL DEFAULT 0;
