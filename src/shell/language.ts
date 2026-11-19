// Language of the messages the API returns to the screen: the client sends `x-idioma` (pt-BR or en) on every request.
// Without the header, Portuguese. The text stays in place, as a pair: `t(c, 'Não encontrado.', 'Not found.')`.
import type { Context } from 'hono';

export type Language = 'pt-BR' | 'en';
export const isLanguage = (v: unknown): v is Language => v === 'pt-BR' || v === 'en';

export const language = (c: Pick<Context, 'req'>): Language => (c.req.header('x-idioma') === 'en' ? 'en' : 'pt-BR');

/** The text in the requester's language. */
export const t = <T>(c: Pick<Context, 'req'>, pt: T, en: T): T => (language(c) === 'en' ? en : pt);
