// Idioma das mensagens que a API devolve à tela: o cliente manda `x-idioma` (pt-BR ou en) em todo pedido. Sem o
// cabeçalho, português. O texto fica no próprio lugar, em par: `t(c, 'Não encontrado.', 'Not found.')`.
import type { Context } from 'hono';

export type Idioma = 'pt-BR' | 'en';
export const ehIdioma = (v: unknown): v is Idioma => v === 'pt-BR' || v === 'en';

export const idiomaDe = (c: Pick<Context, 'req'>): Idioma => (c.req.header('x-idioma') === 'en' ? 'en' : 'pt-BR');

/** O texto no idioma de quem pediu. */
export const t = <T>(c: Pick<Context, 'req'>, pt: T, en: T): T => (idiomaDe(c) === 'en' ? en : pt);
