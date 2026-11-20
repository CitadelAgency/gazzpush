import type { Env } from '../env';
import { callDeepseek } from './deepseek';
import { callGemini } from './gemini';
import { callKieText } from './kieText';
import { fromOutletKeys, withoutKeyTextError } from './providers';
import { textModelName, type ProviderText } from './providersTable';
import type { WhereUsage } from './usage';

/**
 * One JSON-mode text call (drafting, check, hook, adjustment, writing, asking a document) on the outlet's provider:
 * DeepSeek, Gemini, or Kie.ai (when explicitly opted in), with the outlet's key or the server's. All return the same
 * JSON, and the caller checks it by code the same way. With no key at all: the door error (402, like the plan limit).
 */
export async function callText(env: Env, where: WhereUsage, system: string, user: string, temperature = 0) {
  const key = (where.chaves ?? await fromOutletKeys(env, where.tenantId)).texto;
  if (!key) throw withoutKeyTextError();
  const r = key.provedor === 'gemini'
    ? await callGemini(env, where, key, system, user, temperature)
    : key.provedor === 'kie'
      ? await callKieText(env, where, key, system, user, temperature)
      : await callDeepseek(env, where, key, system, user, temperature);
  return { ...r, provedor: key.provedor as ProviderText, modelo: textModelName(key.provedor) };
}
