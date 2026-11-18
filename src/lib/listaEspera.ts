// Lista de espera pública: sem conta e sem sessão. A resposta é a mesma para e-mail novo e repetido, para a página não
// dizer quem já está na lista.
import type { Env } from '../env';
import { resumir } from './crypto';
import { PLANOS_PAGOS, type PlanoPago } from './planosTabela';

/** Por IP, por hora. Folgado porque operadora de celular põe muita gente atrás do mesmo IP. */
export const LIMITE_POR_HORA = 20;

export type Cadastro = { email: string; nome: string | null; plano: PlanoPago | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `null` quando o e-mail não presta. Nome e plano são opcionais: valor estranho neles vira vazio, sem barrar o cadastro. */
export function lerCadastro(corpo: unknown): Cadastro | null {
  const { email, nome, plano } = (corpo ?? {}) as Record<string, unknown>;
  const limpo = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (limpo.length > 254 || !EMAIL.test(limpo)) return null;
  return {
    email: limpo,
    nome: (typeof nome === 'string' && nome.trim().slice(0, 80)) || null,
    plano: PLANOS_PAGOS.find((p) => p === plano) ?? null,
  };
}

/** Falso quando o IP passou do limite. */
export async function entrarNaLista(env: Env, c: Cadastro, idioma: string, ip: string) {
  const ipHash = await resumir(env, 'lista-espera-ip', ip);
  const recentes = await env.DB.prepare("SELECT COUNT(*) AS n FROM lista_espera WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')")
    .bind(ipHash).first<number>('n');
  if ((recentes ?? 0) >= LIMITE_POR_HORA) return false;
  await env.DB.prepare('INSERT INTO lista_espera (email, nome, plano, idioma, ip_hash) VALUES (?, ?, ?, ?, ?) ON CONFLICT (email) DO NOTHING')
    .bind(c.email, c.nome, c.plano, idioma, ipHash).run();
  return true;
}
