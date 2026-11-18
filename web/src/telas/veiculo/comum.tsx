// O que as abas da tela do veículo dividem: o esqueleto de carga, a mensagem de falha de uma ação e o cliente da API do veículo.
import { api, ErroApi } from "../../api";
import { t as tr } from "../../idioma";

export const t = api.t[":tenantId"];

export const Carga = ({ oque }: { oque: string }) => (
  <div aria-busy="true" className="grid max-w-[520px] gap-4">
    <p role="status" className="sr-only">{tr(`Carregando ${oque}`, `Loading ${oque}`)}</p>
    <div className="esqueleto h-12" /><div className="esqueleto h-12 w-[70%]" /><div className="esqueleto h-24" />
  </div>
);

export const mensagemAcao = (e: unknown, oque: string) =>
  e instanceof ErroApi && e.status === 0
    ? tr(`Não deu para ${oque}: sem conexão. Tente de novo.`, `Couldn't ${oque}: no connection. Try again.`)
    : tr(`Não deu para ${oque} agora. Tente de novo.`, `Couldn't ${oque} right now. Try again.`);
