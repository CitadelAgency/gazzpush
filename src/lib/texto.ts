import type { Env } from '../env';
import { chamarDeepseek } from './deepseek';
import { chamarGemini } from './gemini';
import { chavesDoVeiculo, erroSemChaveTexto } from './provedores';
import type { ProvedorTexto } from './provedoresTabela';
import { PROVEDORES } from './provedoresTabela';
import type { OndeUso } from './uso';

/**
 * Uma chamada de texto em modo JSON (redação, conferência, gancho, ajuste, escrita, pergunta ao documento) no provedor do
 * veículo: DeepSeek ou Gemini, com a chave do veículo ou a do servidor. Os dois devolvem o mesmo JSON, e quem chama confere por
 * código do mesmo jeito. Sem chave nenhuma: o erro da porta (402, como o limite do plano).
 */
export async function chamarTexto(env: Env, onde: OndeUso, system: string, user: string, temperature = 0) {
  const chave = (onde.chaves ?? await chavesDoVeiculo(env, onde.tenantId)).texto;
  if (!chave) throw erroSemChaveTexto();
  const r = chave.provedor === 'gemini'
    ? await chamarGemini(env, onde, chave, system, user, temperature)
    : await chamarDeepseek(env, onde, chave, system, user, temperature);
  return { ...r, provedor: chave.provedor as ProvedorTexto, modelo: PROVEDORES[chave.provedor].modelo as string };
}
