// What the outlet screen's tabs share: the loading skeleton, an action's failure message and the outlet's API client.
import { api, ApiError } from "../../api";
import { t as tr } from "../../language";

export const t = api.t[":tenantId"];

export const Load = ({ oque: what }: { oque: string }) => (
  <div aria-busy="true" className="grid max-w-[520px] gap-4">
    <p role="status" className="sr-only">{tr(`Carregando ${what}`, `Loading ${what}`)}</p>
    <div className="esqueleto h-12" /><div className="esqueleto h-12 w-[70%]" /><div className="esqueleto h-24" />
  </div>
);

export const actionMessage = (e: unknown, what: string) =>
  e instanceof ApiError && e.status === 0
    ? tr(`Não deu para ${what}: sem conexão. Tente de novo.`, `Couldn't ${what}: no connection. Try again.`)
    : tr(`Não deu para ${what} agora. Tente de novo.`, `Couldn't ${what} right now. Try again.`);
