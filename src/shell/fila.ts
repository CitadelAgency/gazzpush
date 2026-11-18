/**
 * Fila da UI (Ideias e andamento da produção). Só leitura de D1: nada aqui consulta o Workflow, para o polling de
 * 2 s ficar barato.
 */

export const ETAPAS = ['redigir', 'validar', 'ilustrar', 'renderizar'] as const;
export type Etapa = (typeof ETAPAS)[number];

/**
 * Em que etapa está uma peça em `rascunho`, deduzido do que o ProducaoWorkflow já gravou:
 * - nenhuma versão desta rodada → redigindo (tentativa 1);
 * - versão nova ainda não exibida (`pecas.versao` atrás da última) → validando;
 * - versão exibida reprovada → redigindo de novo (próxima tentativa);
 * - aprovada sem evento de ilustração da versão → ilustrando; com ele → renderizando.
 */
export function etapaProducao(a: {
  versaoExibida: number;
  versoesDaRodada: number[];
  validacaoOk: boolean | null;
  ilustrou: boolean;
  /** Reels: não redige nem ilustra; conferido, está montando o vídeo. */
  reels?: boolean;
}): { etapa: Etapa; tentativa: number } {
  const n = a.versoesDaRodada.length;
  if (!n) return { etapa: a.reels ? 'validar' : 'redigir', tentativa: 1 };
  const ultima = Math.max(...a.versoesDaRodada);
  if (a.versaoExibida < ultima) return { etapa: 'validar', tentativa: n };
  if (a.reels) return { etapa: a.validacaoOk === null ? 'validar' : 'renderizar', tentativa: 1 };
  if (a.validacaoOk !== true) return { etapa: 'redigir', tentativa: n + 1 };
  return { etapa: a.ilustrou ? 'renderizar' : 'ilustrar', tentativa: n };
}

/** `?status=a,b` → lista validada contra o enum, ou null se algum valor não pertence. */
export function listaDeStatus<T extends string>(q: string | undefined, validos: readonly T[], padrao: readonly T[]): T[] | null {
  if (!q) return [...padrao];
  const lista = [...new Set(q.split(',').map((s) => s.trim()).filter(Boolean))];
  if (!lista.length || lista.length > validos.length) return null;
  return lista.every((s) => (validos as readonly string[]).includes(s)) ? (lista as T[]) : null;
}

/** `?desde=` em milissegundos → data no formato das colunas do D1 ("AAAA-MM-DD HH:MM:SS", UTC). Inválido → null. */
export function desdeSql(q: string | undefined): string | null {
  const ms = Number(q);
  if (!q || !Number.isFinite(ms) || ms <= 0 || ms > 8.64e15) return null;
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/** Cursor de Postados: "<created_at>|<id>" da última publicação da página anterior. Inválido → null. */
export function cursorPublicacoes(q: string | undefined): { em: string; id: string } | null {
  const m = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\|([\w-]{1,80})$/.exec(q ?? '');
  return m ? { em: m[1], id: m[2] } : null;
}
