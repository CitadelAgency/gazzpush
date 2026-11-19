// The price table with nothing server-side: the public waitlist page imports from here. `plans.ts` re-exports it.

/** The task owner's proposal, easy to change. Prices in reais; the amount actually charged is the Stripe `price`. */
// `teste` is the outlet without a subscription: the name stays because it is stored in the database, but nothing is free
// (owner's decision, 06/11).
export const PLANS = {
  teste: { precoReais: 0, limite: 0, periodo: 'total' },
  pagina: { precoReais: 99, limite: 60, periodo: 'mes' },
  portal: { precoReais: 210, limite: 150, periodo: 'mes' },
  cortesia: { precoReais: 0, limite: null, periodo: 'mes' },
} as const satisfies Record<string, { precoReais: number; limite: number | null; periodo: 'mes' | 'total' }>;
export type Plan = keyof typeof PLANS;

export const PLANS_PAID = ['pagina', 'portal'] as const;
export type PaidPlan = (typeof PLANS_PAID)[number];
