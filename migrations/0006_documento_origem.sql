-- Documento importado de um lugar que muda depois (Google Docs): de onde veio e a revisão lida na importação. A URL
-- não vai para o card (é rascunho privado); serve para abrir o original e, na mesa, para devolver sem sobrescrever.
ALTER TABLE documentos ADD COLUMN origem_url TEXT;
ALTER TABLE documentos ADD COLUMN origem_revisao TEXT;
