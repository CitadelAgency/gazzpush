-- Second-opinion provider per outlet: 'anthropic' (default, direct BYOK) or 'kie' (only when the outlet explicitly
-- chooses to route text, second opinion and illustration through one Kie.ai key).
ALTER TABLE tenants ADD COLUMN provedor_segunda TEXT NOT NULL DEFAULT 'anthropic';
