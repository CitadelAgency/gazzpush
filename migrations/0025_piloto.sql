-- Piloto automático: aprovação sem pessoa para matéria do site do próprio veículo, desligado por padrão.
ALTER TABLE tenants ADD COLUMN piloto_ligado_em TEXT;
ALTER TABLE tenants ADD COLUMN piloto_ligado_por TEXT;
ALTER TABLE tenants ADD COLUMN piloto_por_dia INTEGER NOT NULL DEFAULT 6;
-- Próximo horário livre: reservado num UPDATE só, para duas peças prontas ao mesmo tempo não saírem juntas.
ALTER TABLE tenants ADD COLUMN piloto_vez_em TEXT;
