// The outlet screen's Sources tab, in parts (DESIGN.md §9): the sources, add a feed, Coverage, the Daily digest and
// Autopilot. The whole tab loads only when opened: outside the Brand budget.
import { lazy, Suspense, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { bodyJson, ApiError, read } from "../../api";
import { FailureLoad } from "../../common";
import { keys, hour, nextCollection, when, areaLabel, useAreas, useSourcesAll, type Source } from "../../queue";
import { t as tr } from "../../language";
import { alertFirst, Parts, usePart, type ItemPart } from "../../kit/Parts";
import type { Municipality } from "../../onboarding/municipalities";
import type { Outlet as Veic } from "../../session";
import { Load, actionMessage, t } from "./common";
import { Autopilot, summaryAutopilot } from "./Autopilot";

// The municipality field only serves Coverage: it loads when Coverage appears.
const MunicipalityField = lazy(() => import("../../onboarding/MunicipalityField").then((m) => ({ default: m.MunicipalityInput })));

export default function Sources({ veiculo: outlet, admin }: { veiculo: Veic; admin: boolean }) {
  const qc = useQueryClient();
  const sources = useSourcesAll(outlet.id);
  const local = outlet.modo === "local";
  const areas = useAreas(outlet.id, local);
  const [, openPart] = usePart("parte", null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const reload = () => qc.invalidateQueries({ queryKey: keys.fontes(outlet.id) });
  const add = useMutation({
    mutationFn: () => read(t.fontes.$post({ param: { tenantId: outlet.id } }, bodyJson({ nome: name, url }))),
    // The new source appears where the person will check: in the list, with the next collection's date.
    onSuccess: () => { setName(""); setUrl(""); reload(); openPart("fontes"); },
  });
  const toggle = useMutation({
    mutationFn: ({ id, ativo: active }: { id: string; ativo: boolean }) => read(t.fontes[":id"].$patch({ param: { tenantId: outlet.id, id } }, bodyJson({ ativo: active }))),
    onSuccess: reload,
  });
  const summary = useMutation({
    mutationFn: (on: boolean) => read(t.resumo.$patch({ param: { tenantId: outlet.id } }, bodyJson({ ligado: on }))),
    onSuccess: reload,
  });
  const mark = useMutation({
    mutationFn: ({ id, propria: own }: { id: string; propria: boolean }) => read(t.fontes[":id"].$patch({ param: { tenantId: outlet.id, id } }, bodyJson({ propria: own }))),
    onSuccess: reload,
  });
  if (sources.isPending) return <Load oque={tr("as fontes", "the sources")} />;
  if (sources.isError) return <FailureLoad oque={tr("as fontes", "the sources")} tentar={() => sources.refetch()} />;
  const list = sources.data.fontes;
  // A new source was never collected: it goes into the first cron from now on.
  const next = nextCollection([{ coletadaEm: null, intervaloMin: 30, coletavel: true }]);
  const addError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 400) return e.message.startsWith("url")
      ? tr("Esse endereço não parece o de um feed. Cole o endereço completo, começando com https.", "That address doesn't look like a feed. Paste the full address, starting with https.")
      : tr("Dê um nome à fonte (2 a 80 letras).", "Give the source a name (2 to 80 characters).");
    return actionMessage(e, tr("adicionar a fonte", "add the source"));
  };
  const author = outlet.modo === "autoral";
  const unavailable = list.filter((x) => x.ativo && !x.ok).length;
  const count = !list.length ? tr("nenhuma fonte", "no sources") : list.length === 1 ? tr("1 fonte", "1 source") : tr(`${list.length} fontes`, `${list.length} sources`);
  const cities = areas.data?.areas;
  const autopilot = summaryAutopilot(sources.data.piloto);
  const items: ItemPart[] = [
    {
      id: "fontes", rotulo: tr("De onde vêm as ideias", "Where ideas come from"),
      resumo: unavailable ? tr(`${count} · ${unavailable === 1 ? "1 indisponível" : `${unavailable} indisponíveis`}`, `${count} · ${unavailable} unavailable`) : count,
      tom: unavailable ? "aviso" : undefined,
      conteudo: (
        <>
          <p className="m-0 max-w-[52ch] text-apoio">{tr("Cada fonte é lida no seu intervalo; o que é novo vira ideia nas Ideias. Pausada, ela fica guardada sem ser lida.", "Each source is read at its own interval; anything new becomes an idea in Ideas. When paused, it stays saved but isn't read.")}</p>
          {add.isSuccess && (
            <p role="status" className="m-0 text-[15px] text-verde">
              {add.data.existia ? tr("Essa fonte já estava na lista.", "That source was already on the list.")
                : tr(`Fonte adicionada. Entra na próxima coleta${next ? `, ${hour(next.toISOString())}` : ""}.`,
                  `Source added. It joins the next fetch${next ? `, ${hour(next.toISOString())}` : ""}.`)}
            </p>
          )}
          {list.length ? (
            <ul className="m-0 grid list-none gap-2 p-0">
              {list.map((f) => <ItemSource key={f.id} f={f} admin={admin} ocupado={toggle.isPending && toggle.variables?.id === f.id}
                alternar={(active) => toggle.mutate({ id: f.id, ativo: active })} propria={!author} marcarPropria={(own) => mark.mutate({ id: f.id, propria: own })} />)}
            </ul>
          ) : (
            <p className="m-0 text-[17px] text-texto-forte">{tr("Nenhuma fonte ainda.", "No sources yet.")}{admin ? "" : tr(" Peça ao admin.", " Ask the admin.")}</p>
          )}
          {toggle.isError && <p role="alert" className="faixa-erro m-0">{actionMessage(toggle.error, tr("mudar a fonte", "change the source"))}</p>}
          {mark.isError && <p role="alert" className="faixa-erro m-0">{actionMessage(mark.error, tr("marcar a fonte", "mark the source"))}</p>}
          {list.some((f) => f.propria) && <p className="ajuda m-0 max-w-[52ch]">{tr("Matéria nova do site do veículo vira post em Para aprovar, sem passar por Ideias, até 30 por dia. O que já estava no site não vira post.", "New stories from the outlet's site become posts in To approve, skipping Ideas, up to 30 a day. What was already on the site doesn't become a post.")}</p>}
        </>
      ),
    },
    ...(admin ? [{
      id: "adicionar", rotulo: tr("Adicionar um feed RSS", "Add an RSS feed"), resumo: tr("RSS ou Atom", "RSS or Atom"),
      conteudo: (
        <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} aria-label={tr("Adicionar um feed RSS", "Add an RSS feed")} className="grid gap-4">
          <label className="campo">
            <span>{tr("Nome", "Name")}</span>
            <input className="entrada" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("Ex.: Prefeitura", "E.g. City Hall")} required minLength={2} maxLength={80}
              autoComplete="off" autoCapitalize="words" enterKeyHint="next" />
          </label>
          <label className="campo">
            <span>{tr("Endereço do feed", "Feed address")}</span>
            <input className="entrada" type="url" value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="https://site.gov.br/feed/" required
              inputMode="url" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" aria-describedby="feed-ajuda" />
            <span id="feed-ajuda" className="ajuda">{tr("O endereço RSS ou Atom do site. A mesma fonte duas vezes não duplica.", "The site's RSS or Atom address. Adding the same source twice doesn't duplicate it.")}</span>
          </label>
          {add.isError && <p role="alert" className="faixa-erro m-0">{addError(add.error)}</p>}
          <button type="submit" className="btn-tinta justify-self-start" disabled={add.isPending}>{add.isPending ? tr("Adicionando…", "Adding…") : tr("Adicionar fonte", "Add source")}</button>
        </form>
      ),
    }] : []),
    ...(local ? [{
      id: "cobertura", rotulo: tr("Cobertura", "Coverage"),
      resumo: areas.isError ? tr("não carregou", "didn't load") : !cities ? "…" : cities.length === 1 ? cities[0]!.nome : tr(`${cities.length} cidades`, `${cities.length} cities`),
      tom: areas.isError ? "erro" as const : undefined,
      conteudo: <Coverage veiculo={outlet} admin={admin} />,
    }] : []),
    ...(!author ? [{
      id: "resumo", rotulo: tr("Resumo do dia", "Daily roundup"),
      resumo: sources.data.resumoLigado ? tr("ligado · às 18h", "on · at 6 p.m.") : tr("desligado", "off"),
      conteudo: (
        <>
          <label className={`flex min-h-11 items-center gap-2 ${admin ? "cursor-pointer" : ""}`}>
            <input type="checkbox" checked={sources.data.resumoLigado} disabled={!admin || summary.isPending} onChange={(e) => summary.mutate(e.target.checked)} className="size-[18px] accent-texto-forte" />
            <span className="grid"><b className="text-texto-forte">{tr("Resumo do dia às 18h", "Daily roundup at 6 p.m.")}</b><span className="ajuda">{tr("As melhores notícias das últimas 24 horas num carrossel, em Para aprovar. Precisa de pelo menos 3.", "The best stories of the last 24 hours in a carousel, in To approve. It needs at least 3.")}</span></span>
          </label>
          {summary.isError && <p role="alert" className="faixa-erro m-0">{actionMessage(summary.error, tr("mudar o resumo", "change the roundup"))}</p>}
        </>
      ),
    }] : []),
    ...(admin && !author ? [{
      id: "piloto", rotulo: tr("Piloto automático", "Autopilot"), resumo: autopilot.texto, tom: autopilot.tom,
      conteudo: <Autopilot tenantId={outlet.id} {...sources.data.piloto} />,
    }] : []),
  ];
  // Add comes first so the action stays in view even with the list open. Without any source, the open part is Add;
  // with an alert, the alert's part.
  const order = [...items.filter((i) => i.id === "adicionar"), ...alertFirst(items.filter((i) => i.id !== "adicionar"))];
  const fallback = order.find((i) => i.tom)?.id ?? (admin && !list.length ? "adicionar" : "fontes");
  return (
    <div className="max-w-[640px] min-[1280px]:max-w-[940px]">
      <Parts itens={order} padrao={fallback} rotulo={tr("Partes das fontes", "Parts of the sources")} />
    </div>
  );
}

// Coverage (local outlet only): the cities whose news triage accepts. Admins add and remove them (the last one stays).
function Coverage({ veiculo: outlet, admin }: { veiculo: Veic; admin: boolean }) {
  const qc = useQueryClient();
  const areas = useAreas(outlet.id);
  const [municipality, setMunicipality] = useState<Municipality | null>(null);
  const [field, setField] = useState(0);   // changes the field's key to clear it after adding
  const reload = () => Promise.all([qc.invalidateQueries({ queryKey: keys.areas(outlet.id) }), qc.invalidateQueries({ queryKey: keys.pautas(outlet.id) })]);
  const add = useMutation({
    mutationFn: (m: Municipality) => read(t.areas.$post({ param: { tenantId: outlet.id } }, bodyJson({ municipioIbge: m.ibge, municipioNome: m.nome }))),
    onSuccess: () => { setMunicipality(null); setField((n) => n + 1); reload(); },
  });
  const remove = useMutation({
    mutationFn: (ibge: string) => read(t.areas[":ibge"].$delete({ param: { tenantId: outlet.id, ibge } })),
    // Removing the main municipality changes the outlet's city in the shell (`/api/me`).
    onSuccess: () => Promise.all([reload(), qc.invalidateQueries({ queryKey: ["me"] })]),
  });
  if (areas.isPending) return <Load oque={tr("a cobertura", "the coverage")} />;
  if (areas.isError) return <FailureLoad oque={tr("a cobertura", "the coverage")} tentar={() => areas.refetch()} />;
  const list = areas.data.areas;
  const removeError = (e: unknown) => (e instanceof ApiError && e.status === 409
    ? tr("A última cidade não sai: o veículo precisa cobrir pelo menos uma.", "The last city can't be removed: the publication needs to cover at least one.")
    : actionMessage(e, tr("tirar a cidade", "remove the city")));
  return (
    <div className="grid gap-4">
      <p className="m-0 max-w-[52ch] text-apoio">{tr("As cidades deste veículo. Só notícia delas vira ideia; com mais de uma, as Ideias mostram a cidade e filtram por ela.", "This publication's cities. Only news from them becomes an idea; with more than one, Ideas shows the city and lets you filter by it.")}</p>
      <ul aria-label={tr("Cidades cobertas", "Covered cities")} className="m-0 flex list-none flex-wrap gap-2 p-0">
        {list.map((a) => (
          <li key={a.ibge} className="flex items-center gap-1 rounded-btn bg-papel py-1.5 pr-1.5 pl-3 shadow-curta">
            <span className="text-texto-forte">{areaLabel(a)}</span>
            {admin && list.length > 1 && (
              <button type="button" onClick={() => remove.mutate(a.ibge)} disabled={remove.isPending && remove.variables === a.ibge} className="btn-sec -my-1.5 px-2 text-[14px] text-apoio">
                {tr("Tirar", "Remove")}<span className="sr-only"> {a.nome}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {remove.isError && <p role="alert" className="faixa-erro m-0">{removeError(remove.error)}</p>}
      {admin && (
        <form onSubmit={(e) => { e.preventDefault(); if (municipality) add.mutate(municipality); }} className="grid gap-3">
          <Suspense fallback={<div aria-hidden="true" className="esqueleto h-12" />}>
            <MunicipalityField key={field} valor={municipality} onMudar={setMunicipality} rotulo={tr("Acrescentar uma cidade", "Add a city")} ajuda={tr("Notícia desta cidade também passa a virar ideia.", "News from this city will also become ideas.")} />
          </Suspense>
          {add.isError && <p role="alert" className="faixa-erro m-0">{actionMessage(add.error, tr("acrescentar a cidade", "add the city"))}</p>}
          {add.isSuccess && !municipality && (
            <p role="status" className="m-0 text-[15px] text-verde">{add.data.existia ? tr("Essa cidade já estava na cobertura.", "That city was already covered.") : tr(`${add.data.nome} entrou na cobertura.`, `${add.data.nome} is now covered.`)}</p>
          )}
          <button type="submit" className="btn-sec justify-self-start bg-papel-2" disabled={!municipality || add.isPending}>
            {add.isPending ? tr("Acrescentando…", "Adding…") : tr("Acrescentar cidade", "Add city")}
          </button>
        </form>
      )}
    </div>
  );
}

function ItemSource({ f, admin, ocupado: busy, alternar: toggle, propria: own, marcarPropria: ownMark }: { f: Source; admin: boolean; ocupado: boolean; alternar: (active: boolean) => void; propria: boolean; marcarPropria: (v: boolean) => void }) {
  const last = f.coletadaEm ? tr(` · última tentativa ${when(f.coletadaEm)}`, ` · last attempt ${when(f.coletadaEm)}`) : "";
  const state = !f.ativo ? tr("pausada", "paused")
    : f.ok ? (f.coletadaEm
      ? tr(`coleta ${hour(f.coletadaEm)}${f.viaNavegador ? " · lida pelo navegador" : ""}`, `fetched ${hour(f.coletadaEm)}${f.viaNavegador ? " · read through the browser" : ""}`)
      : tr("aguardando a primeira coleta", "waiting for the first fetch"))
    : !f.coletavel ? tr(`coleta parada: muitas falhas seguidas${last}`, `fetching stopped: too many failures in a row${last}`)
    : tr(`indisponível${last}`, `unavailable${last}`);
  // Colour only where there is an exception: a failure shows in amber; the normal states (collecting, paused, waiting) get no colour.
  const failure = f.ativo && !f.ok;
  return (
    <li className="grid grid-cols-[10px_1fr_auto] items-start gap-x-3 rounded-btn bg-papel p-3 shadow-curta">
      <span aria-hidden="true" className={`mt-[7px] size-2 rounded-full ${failure ? "bg-ambar" : ""}`} />
      <span className="grid min-w-0 gap-0.5">
        <b className={f.ativo ? "text-texto-forte" : "text-apoio"}>{f.nome}</b>
        <span className={`mono ${f.ativo && !f.ok ? "text-ambar" : "text-apoio"}`}>
          {state}{f.coletavel && tr(` · a cada ${f.intervaloMin} min`, ` · every ${f.intervaloMin} min`)}
        </span>
        {f.url && <span className="mono truncate text-apoio" title={f.url}>{f.url}</span>}
        {own && (
          <label className={`mt-1 flex min-h-11 items-center gap-2 ${admin ? "cursor-pointer" : ""}`}>
            <input type="checkbox" checked={f.propria} disabled={!admin} onChange={(e) => ownMark(e.target.checked)} className="size-[18px] accent-texto-forte" />
            {tr("Este é o site do veículo", "This is the outlet's site")}<span className="sr-only"> {f.nome}</span>
          </label>
        )}
      </span>
      {admin && (
        // Resume applies to paused and to stopped by failures (active, not collectable): both send ativo=true, which resets the failures.
        <button type="button" onClick={() => toggle(!(f.ativo && f.coletavel))} disabled={busy} className="btn-sec -mt-1.5 -mr-2 text-[15px]">
          {busy ? "…" : f.ativo && f.coletavel ? tr("Pausar", "Pause") : tr("Retomar", "Resume")}<span className="sr-only"> {f.nome}</span>
        </button>
      )}
    </li>
  );
}
