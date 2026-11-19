/**
 * Creates a Workflow instance with a deterministic id, after the D1 batch that stored the run.
 * An error on create is ambiguous: the instance may have been created and only the response was lost. So an error never
 * becomes "falhou" here: if the instance exists, it was created; if not, it stays pending and the cron's reconciler
 * tries again.
 */
export async function createInstance<P>(wf: Workflow<P>, id: string, params: P): Promise<string | null> {
  try {
    await wf.create({ id, params });
    return null;
  } catch (e) {
    if ((await instanceStatus(wf, id)) === 'existe') return null;
    const error = `workflow.create: ${String(e)}`.slice(0, 500);
    console.error(error, id);
    return error;
  }
}

/**
 * 'existe' | 'ausente' (the engine answered not found) | 'desconhecido' (the lookup failed for another reason).
 * Only 'ausente' allows giving up on a run: an unavailable lookup does not prove the instance is not running.
 */
export async function instanceStatus(wf: Workflow<unknown>, id: string): Promise<'existe' | 'ausente' | 'desconhecido'> {
  try {
    await (await wf.get(id)).status();
    return 'existe';
  } catch (e) {
    return /not[_ ]?found/i.test(String(e)) ? 'ausente' : 'desconhecido';
  }
}
