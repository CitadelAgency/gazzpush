/**
 * Criação de instância de Workflow com id determinístico, depois do batch do D1 que gravou a execução.
 * Erro no create é ambíguo: a instância pode ter sido criada e só a resposta se perdeu. Por isso erro nunca vira
 * "falhou" aqui: se a instância existe, criou; se não, fica pendente e o reconciliador do cron tenta de novo.
 */
export async function criarInstancia<P>(wf: Workflow<P>, id: string, params: P): Promise<string | null> {
  try {
    await wf.create({ id, params });
    return null;
  } catch (e) {
    if ((await situacaoInstancia(wf, id)) === 'existe') return null;
    const erro = `workflow.create: ${String(e)}`.slice(0, 500);
    console.error(erro, id);
    return erro;
  }
}

/**
 * 'existe' | 'ausente' (o engine respondeu not found) | 'desconhecido' (a consulta falhou por outro motivo).
 * Só 'ausente' autoriza desistir de uma execução: consulta indisponível não prova que a instância não está rodando.
 */
export async function situacaoInstancia(wf: Workflow<unknown>, id: string): Promise<'existe' | 'ausente' | 'desconhecido'> {
  try {
    await (await wf.get(id)).status();
    return 'existe';
  } catch (e) {
    return /not[_ ]?found/i.test(String(e)) ? 'ausente' : 'desconhecido';
  }
}
