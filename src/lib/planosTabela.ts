// A tabela de preços sem nada de servidor: a página pública da lista de espera importa daqui. `planos.ts` reexporta.

/** Proposta do dono da tarefa, fácil de trocar. Preço em reais; o valor cobrado de verdade é o `price` da Stripe. */
// `teste` é o veículo sem assinatura: o nome fica porque está no banco, mas não há nada grátis (decisão do dono, 06/11).
export const PLANOS = {
  teste: { precoReais: 0, limite: 0, periodo: 'total' },
  pagina: { precoReais: 99, limite: 60, periodo: 'mes' },
  portal: { precoReais: 210, limite: 150, periodo: 'mes' },
  cortesia: { precoReais: 0, limite: null, periodo: 'mes' },
} as const satisfies Record<string, { precoReais: number; limite: number | null; periodo: 'mes' | 'total' }>;
export type Plano = keyof typeof PLANOS;

export const PLANOS_PAGOS = ['pagina', 'portal'] as const;
export type PlanoPago = (typeof PLANOS_PAGOS)[number];
