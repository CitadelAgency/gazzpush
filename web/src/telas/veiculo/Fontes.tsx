// Aba Fontes da tela do veículo, em partes (DESIGN.md §9): as fontes, adicionar um feed, a Cobertura, o Resumo do dia e o
// Piloto automático. A aba inteira carrega só quando abre: fora do orçamento da Marca.
import { lazy, Suspense, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { corpoJson, ErroApi, ler } from "../../api";
import { FalhaCarga } from "../../comum";
import { chaves, hora, proximaColeta, quando, rotuloArea, useAreas, useFontesTodas, type Fonte } from "../../fila";
import { t as tr } from "../../idioma";
import { alertaPrimeiro, Partes, useParte, type ItemParte } from "../../kit/Partes";
import type { Municipio } from "../../novo/municipios";
import type { Veiculo as Veic } from "../../sessao";
import { Carga, mensagemAcao, t } from "./comum";
import { Piloto, resumoPiloto } from "./Piloto";

// O campo de município só serve à Cobertura: carrega quando ela aparece.
const CampoMunicipio = lazy(() => import("../../novo/CampoMunicipio").then((m) => ({ default: m.CampoMunicipio })));

export default function Fontes({ veiculo, admin }: { veiculo: Veic; admin: boolean }) {
  const qc = useQueryClient();
  const fontes = useFontesTodas(veiculo.id);
  const local = veiculo.modo === "local";
  const areas = useAreas(veiculo.id, local);
  const [, abrirParte] = useParte("parte", null);
  const [nome, setNome] = useState("");
  const [url, setUrl] = useState("");
  const recarregar = () => qc.invalidateQueries({ queryKey: chaves.fontes(veiculo.id) });
  const adicionar = useMutation({
    mutationFn: () => ler(t.fontes.$post({ param: { tenantId: veiculo.id } }, corpoJson({ nome, url }))),
    // A fonte nova aparece onde a pessoa vai conferir: na lista, com a data da próxima coleta.
    onSuccess: () => { setNome(""); setUrl(""); recarregar(); abrirParte("fontes"); },
  });
  const alternar = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) => ler(t.fontes[":id"].$patch({ param: { tenantId: veiculo.id, id } }, corpoJson({ ativo }))),
    onSuccess: recarregar,
  });
  const resumo = useMutation({
    mutationFn: (ligado: boolean) => ler(t.resumo.$patch({ param: { tenantId: veiculo.id } }, corpoJson({ ligado }))),
    onSuccess: recarregar,
  });
  const marcar = useMutation({
    mutationFn: ({ id, propria }: { id: string; propria: boolean }) => ler(t.fontes[":id"].$patch({ param: { tenantId: veiculo.id, id } }, corpoJson({ propria }))),
    onSuccess: recarregar,
  });
  if (fontes.isPending) return <Carga oque={tr("as fontes", "the sources")} />;
  if (fontes.isError) return <FalhaCarga oque={tr("as fontes", "the sources")} tentar={() => fontes.refetch()} />;
  const lista = fontes.data.fontes;
  // Fonte nova nunca foi coletada: entra no primeiro cron a partir de agora.
  const proxima = proximaColeta([{ coletadaEm: null, intervaloMin: 30, coletavel: true }]);
  const erroAdicionar = (e: unknown) => {
    if (e instanceof ErroApi && e.status === 400) return e.message.startsWith("url")
      ? tr("Esse endereço não parece o de um feed. Cole o endereço completo, começando com https.", "That address doesn't look like a feed. Paste the full address, starting with https.")
      : tr("Dê um nome à fonte (2 a 80 letras).", "Give the source a name (2 to 80 characters).");
    return mensagemAcao(e, tr("adicionar a fonte", "add the source"));
  };
  const autoral = veiculo.modo === "autoral";
  const indisponiveis = lista.filter((x) => x.ativo && !x.ok).length;
  const contagem = !lista.length ? tr("nenhuma fonte", "no sources") : lista.length === 1 ? tr("1 fonte", "1 source") : tr(`${lista.length} fontes`, `${lista.length} sources`);
  const cidades = areas.data?.areas;
  const piloto = resumoPiloto(fontes.data.piloto);
  const itens: ItemParte[] = [
    {
      id: "fontes", rotulo: tr("De onde vêm as ideias", "Where ideas come from"),
      resumo: indisponiveis ? tr(`${contagem} · ${indisponiveis === 1 ? "1 indisponível" : `${indisponiveis} indisponíveis`}`, `${contagem} · ${indisponiveis} unavailable`) : contagem,
      tom: indisponiveis ? "aviso" : undefined,
      conteudo: (
        <>
          <p className="m-0 max-w-[52ch] text-apoio">{tr("Cada fonte é lida no seu intervalo; o que é novo vira ideia nas Ideias. Pausada, ela fica guardada sem ser lida.", "Each source is read at its own interval; anything new becomes an idea in Ideas. When paused, it stays saved but isn't read.")}</p>
          {adicionar.isSuccess && (
            <p role="status" className="m-0 text-[15px] text-verde">
              {adicionar.data.existia ? tr("Essa fonte já estava na lista.", "That source was already on the list.")
                : tr(`Fonte adicionada. Entra na próxima coleta${proxima ? `, ${hora(proxima.toISOString())}` : ""}.`,
                  `Source added. It joins the next fetch${proxima ? `, ${hora(proxima.toISOString())}` : ""}.`)}
            </p>
          )}
          {lista.length ? (
            <ul className="m-0 grid list-none gap-2 p-0">
              {lista.map((f) => <ItemFonte key={f.id} f={f} admin={admin} ocupado={alternar.isPending && alternar.variables?.id === f.id}
                alternar={(ativo) => alternar.mutate({ id: f.id, ativo })} propria={!autoral} marcarPropria={(propria) => marcar.mutate({ id: f.id, propria })} />)}
            </ul>
          ) : (
            <p className="m-0 text-[17px] text-texto-forte">{tr("Nenhuma fonte ainda.", "No sources yet.")}{admin ? "" : tr(" Peça ao admin.", " Ask the admin.")}</p>
          )}
          {alternar.isError && <p role="alert" className="faixa-erro m-0">{mensagemAcao(alternar.error, tr("mudar a fonte", "change the source"))}</p>}
          {marcar.isError && <p role="alert" className="faixa-erro m-0">{mensagemAcao(marcar.error, tr("marcar a fonte", "mark the source"))}</p>}
          {lista.some((f) => f.propria) && <p className="ajuda m-0 max-w-[52ch]">{tr("Matéria nova do site do veículo vira post em Para aprovar, sem passar por Ideias, até 30 por dia. O que já estava no site não vira post.", "New stories from the outlet's site become posts in To approve, skipping Ideas, up to 30 a day. What was already on the site doesn't become a post.")}</p>}
        </>
      ),
    },
    ...(admin ? [{
      id: "adicionar", rotulo: tr("Adicionar um feed RSS", "Add an RSS feed"), resumo: tr("RSS ou Atom", "RSS or Atom"),
      conteudo: (
        <form onSubmit={(e) => { e.preventDefault(); adicionar.mutate(); }} aria-label={tr("Adicionar um feed RSS", "Add an RSS feed")} className="grid gap-4">
          <label className="campo">
            <span>{tr("Nome", "Name")}</span>
            <input className="entrada" value={nome} onChange={(e) => setNome(e.target.value)} placeholder={tr("Nome da fonte", "Source name")} required minLength={2} maxLength={80}
              autoComplete="off" autoCapitalize="words" enterKeyHint="next" />
          </label>
          <label className="campo">
            <span>{tr("Endereço do feed", "Feed address")}</span>
            <input className="entrada" type="url" value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="https://" required
              inputMode="url" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" aria-describedby="feed-ajuda" />
            <span id="feed-ajuda" className="ajuda">{tr("O endereço RSS ou Atom do site. A mesma fonte duas vezes não duplica.", "The site's RSS or Atom address. Adding the same source twice doesn't duplicate it.")}</span>
          </label>
          {adicionar.isError && <p role="alert" className="faixa-erro m-0">{erroAdicionar(adicionar.error)}</p>}
          <button type="submit" className="btn-tinta justify-self-start" disabled={adicionar.isPending}>{adicionar.isPending ? tr("Adicionando…", "Adding…") : tr("Adicionar fonte", "Add source")}</button>
        </form>
      ),
    }] : []),
    ...(local ? [{
      id: "cobertura", rotulo: tr("Cobertura", "Coverage"),
      resumo: areas.isError ? tr("não carregou", "didn't load") : !cidades ? "…" : cidades.length === 1 ? cidades[0]!.nome : tr(`${cidades.length} cidades`, `${cidades.length} cities`),
      tom: areas.isError ? "erro" as const : undefined,
      conteudo: <Cobertura veiculo={veiculo} admin={admin} />,
    }] : []),
    ...(!autoral ? [{
      id: "resumo", rotulo: tr("Resumo do dia", "Daily roundup"),
      resumo: fontes.data.resumoLigado ? tr("ligado · às 18h", "on · at 6 p.m.") : tr("desligado", "off"),
      conteudo: (
        <>
          <label className={`flex min-h-11 items-center gap-2 ${admin ? "cursor-pointer" : ""}`}>
            <input type="checkbox" checked={fontes.data.resumoLigado} disabled={!admin || resumo.isPending} onChange={(e) => resumo.mutate(e.target.checked)} className="size-[18px] accent-texto-forte" />
            <span className="grid"><b className="text-texto-forte">{tr("Resumo do dia às 18h", "Daily roundup at 6 p.m.")}</b><span className="ajuda">{tr("As melhores notícias das últimas 24 horas num carrossel, em Para aprovar. Precisa de pelo menos 3.", "The best stories of the last 24 hours in a carousel, in To approve. It needs at least 3.")}</span></span>
          </label>
          {resumo.isError && <p role="alert" className="faixa-erro m-0">{mensagemAcao(resumo.error, tr("mudar o resumo", "change the roundup"))}</p>}
        </>
      ),
    }] : []),
    ...(admin && !autoral ? [{
      id: "piloto", rotulo: tr("Piloto automático", "Autopilot"), resumo: piloto.texto, tom: piloto.tom,
      conteudo: <Piloto tenantId={veiculo.id} {...fontes.data.piloto} />,
    }] : []),
  ];
  // Adicionar vem primeiro para a ação ficar à vista mesmo com a lista aberta. Sem nenhuma fonte, a parte aberta é ela;
  // com alerta, a parte dele.
  const ordem = [...itens.filter((i) => i.id === "adicionar"), ...alertaPrimeiro(itens.filter((i) => i.id !== "adicionar"))];
  const padrao = ordem.find((i) => i.tom)?.id ?? (admin && !lista.length ? "adicionar" : "fontes");
  return (
    <div className="max-w-[640px] min-[1280px]:max-w-[940px]">
      <Partes itens={ordem} padrao={padrao} rotulo={tr("Partes das fontes", "Parts of the sources")} />
    </div>
  );
}

// Cobertura (só veículo local): as cidades cuja notícia a triagem aceita. Admin acrescenta e tira (a última fica).
function Cobertura({ veiculo, admin }: { veiculo: Veic; admin: boolean }) {
  const qc = useQueryClient();
  const areas = useAreas(veiculo.id);
  const [municipio, setMunicipio] = useState<Municipio | null>(null);
  const [campo, setCampo] = useState(0);   // muda a key do campo para limpá-lo depois de acrescentar
  const recarregar = () => Promise.all([qc.invalidateQueries({ queryKey: chaves.areas(veiculo.id) }), qc.invalidateQueries({ queryKey: chaves.pautas(veiculo.id) })]);
  const acrescentar = useMutation({
    mutationFn: (m: Municipio) => ler(t.areas.$post({ param: { tenantId: veiculo.id } }, corpoJson({ municipioIbge: m.ibge, municipioNome: m.nome }))),
    onSuccess: () => { setMunicipio(null); setCampo((n) => n + 1); recarregar(); },
  });
  const tirar = useMutation({
    mutationFn: (ibge: string) => ler(t.areas[":ibge"].$delete({ param: { tenantId: veiculo.id, ibge } })),
    // Tirar o município principal muda a cidade do veículo na casca (`/api/me`).
    onSuccess: () => Promise.all([recarregar(), qc.invalidateQueries({ queryKey: ["me"] })]),
  });
  if (areas.isPending) return <Carga oque={tr("a cobertura", "the coverage")} />;
  if (areas.isError) return <FalhaCarga oque={tr("a cobertura", "the coverage")} tentar={() => areas.refetch()} />;
  const lista = areas.data.areas;
  const erroTirar = (e: unknown) => (e instanceof ErroApi && e.status === 409
    ? tr("A última cidade não sai: o veículo precisa cobrir pelo menos uma.", "The last city can't be removed: the publication needs to cover at least one.")
    : mensagemAcao(e, tr("tirar a cidade", "remove the city")));
  return (
    <div className="grid gap-4">
      <p className="m-0 max-w-[52ch] text-apoio">{tr("As cidades deste veículo. Só notícia delas vira ideia; com mais de uma, as Ideias mostram a cidade e filtram por ela.", "This publication's cities. Only news from them becomes an idea; with more than one, Ideas shows the city and lets you filter by it.")}</p>
      <ul aria-label={tr("Cidades cobertas", "Covered cities")} className="m-0 flex list-none flex-wrap gap-2 p-0">
        {lista.map((a) => (
          <li key={a.ibge} className="flex items-center gap-1 rounded-btn bg-papel py-1.5 pr-1.5 pl-3 shadow-curta">
            <span className="text-texto-forte">{rotuloArea(a)}</span>
            {admin && lista.length > 1 && (
              <button type="button" onClick={() => tirar.mutate(a.ibge)} disabled={tirar.isPending && tirar.variables === a.ibge} className="btn-sec -my-1.5 px-2 text-[14px] text-apoio">
                {tr("Tirar", "Remove")}<span className="sr-only"> {a.nome}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {tirar.isError && <p role="alert" className="faixa-erro m-0">{erroTirar(tirar.error)}</p>}
      {admin && (
        <form onSubmit={(e) => { e.preventDefault(); if (municipio) acrescentar.mutate(municipio); }} className="grid gap-3">
          <Suspense fallback={<div aria-hidden="true" className="esqueleto h-12" />}>
            <CampoMunicipio key={campo} valor={municipio} onMudar={setMunicipio} rotulo={tr("Acrescentar uma cidade", "Add a city")} ajuda={tr("Notícia desta cidade também passa a virar ideia.", "News from this city will also become ideas.")} />
          </Suspense>
          {acrescentar.isError && <p role="alert" className="faixa-erro m-0">{mensagemAcao(acrescentar.error, tr("acrescentar a cidade", "add the city"))}</p>}
          {acrescentar.isSuccess && !municipio && (
            <p role="status" className="m-0 text-[15px] text-verde">{acrescentar.data.existia ? tr("Essa cidade já estava na cobertura.", "That city was already covered.") : tr(`${acrescentar.data.nome} entrou na cobertura.`, `${acrescentar.data.nome} is now covered.`)}</p>
          )}
          <button type="submit" className="btn-sec justify-self-start bg-papel-2" disabled={!municipio || acrescentar.isPending}>
            {acrescentar.isPending ? tr("Acrescentando…", "Adding…") : tr("Acrescentar cidade", "Add city")}
          </button>
        </form>
      )}
    </div>
  );
}

function ItemFonte({ f, admin, ocupado, alternar, propria, marcarPropria }: { f: Fonte; admin: boolean; ocupado: boolean; alternar: (ativo: boolean) => void; propria: boolean; marcarPropria: (v: boolean) => void }) {
  const ultima = f.coletadaEm ? tr(` · última tentativa ${quando(f.coletadaEm)}`, ` · last attempt ${quando(f.coletadaEm)}`) : "";
  const estado = !f.ativo ? tr("pausada", "paused")
    : f.ok ? (f.coletadaEm
      ? tr(`coleta ${hora(f.coletadaEm)}${f.viaNavegador ? " · lida pelo navegador" : ""}`, `fetched ${hora(f.coletadaEm)}${f.viaNavegador ? " · read through the browser" : ""}`)
      : tr("aguardando a primeira coleta", "waiting for the first fetch"))
    : !f.coletavel ? tr(`coleta parada: muitas falhas seguidas${ultima}`, `fetching stopped: too many failures in a row${ultima}`)
    : tr(`indisponível${ultima}`, `unavailable${ultima}`);
  // Cor só onde há exceção: a falha fica em âmbar; o normal (coletando, pausada, esperando) não leva cor.
  const falha = f.ativo && !f.ok;
  return (
    <li className="grid grid-cols-[10px_1fr_auto] items-start gap-x-3 rounded-btn bg-papel p-3 shadow-curta">
      <span aria-hidden="true" className={`mt-[7px] size-2 rounded-full ${falha ? "bg-ambar" : ""}`} />
      <span className="grid min-w-0 gap-0.5">
        <b className={f.ativo ? "text-texto-forte" : "text-apoio"}>{f.nome}</b>
        <span className={`mono ${f.ativo && !f.ok ? "text-ambar" : "text-apoio"}`}>
          {estado}{f.coletavel && tr(` · a cada ${f.intervaloMin} min`, ` · every ${f.intervaloMin} min`)}
        </span>
        {f.url && <span className="mono truncate text-apoio" title={f.url}>{f.url}</span>}
        {propria && (
          <label className={`mt-1 flex min-h-11 items-center gap-2 ${admin ? "cursor-pointer" : ""}`}>
            <input type="checkbox" checked={f.propria} disabled={!admin} onChange={(e) => marcarPropria(e.target.checked)} className="size-[18px] accent-texto-forte" />
            {tr("Este é o site do veículo", "This is the outlet's site")}<span className="sr-only"> {f.nome}</span>
          </label>
        )}
      </span>
      {admin && (
        // Retomar vale para pausada e para parada por falhas (ativa, não coletável): as duas mandam ativo=true, que zera as falhas.
        <button type="button" onClick={() => alternar(!(f.ativo && f.coletavel))} disabled={ocupado} className="btn-sec -mt-1.5 -mr-2 text-[15px]">
          {ocupado ? "…" : f.ativo && f.coletavel ? tr("Pausar", "Pause") : tr("Retomar", "Resume")}<span className="sr-only"> {f.nome}</span>
        </button>
      )}
    </li>
  );
}
