-- Removes the seeds/ad-local.sql scenario: its idea, at 2000 points, would sit at the top of Ideas in the other specs.
DELETE FROM anuncio_aprovacoes WHERE peca_id = 'e2e-anuncio-peca';
DELETE FROM publicacoes WHERE peca_id = 'e2e-anuncio-peca';
DELETE FROM decisoes WHERE peca_id = 'e2e-anuncio-peca';
DELETE FROM eventos WHERE ref_id = 'e2e-anuncio-peca';
DELETE FROM peca_versoes WHERE peca_id = 'e2e-anuncio-peca';
DELETE FROM pecas WHERE id = 'e2e-anuncio-peca';
DELETE FROM anuncios WHERE pauta_id IN ('e2e-anuncio-pauta', 'e2e-anuncio-ideia');
DELETE FROM pautas WHERE id IN ('e2e-anuncio-pauta', 'e2e-anuncio-ideia');
DELETE FROM fatos WHERE documento_id = 'e2e-anuncio-doc';
DELETE FROM documentos WHERE id = 'e2e-anuncio-doc';
