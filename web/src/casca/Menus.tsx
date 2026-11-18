// Seletor de veículo e menu da conta (Radix DropdownMenu: teclado, foco e leitor de tela prontos), no papel do
// Lápis azul: sem contorno, sombra curta, item realçado em tom. Não modal e sem Portal: o menu fica dentro da
// região da barra/lateral (landmark) e o resto da tela não some para o leitor de tela.
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { sair } from "../api";
import { ehIdioma, idioma, t } from "../idioma";
import MarcaGazzpush from "../kit/MarcaGazzpush";
import { ehMesa, escolherMesa, useMesa } from "../mesa";
import { escolherIdioma, localDe, type Veiculo } from "../sessao";
import { IconeCerto, IconeSeta, IconeTroca } from "./icones";
import type { CtxCasca } from "./contexto";
import { papel as nomePapel, partesVeiculo } from "./contexto";

/** Quadrado da marca: o logo do veículo ou a inicial em lápis azul. */
export function Marca({ veiculo, className = "size-9 text-[17px]" }: { veiculo: Pick<Veiculo, "nome" | "logo">; className?: string }) {
  return veiculo.logo ? (
    <img src={veiculo.logo} alt="" className={`${className} flex-none rounded-faixa bg-branco object-contain p-0.5 shadow-fio`} />
  ) : (
    <span aria-hidden="true" className={`${className} grid flex-none place-items-center rounded-faixa bg-tinta font-bold text-sobre-tinta`}>
      {inicial(veiculo.nome)}
    </span>
  );
}

export function SeletorVeiculo({ veiculo, veiculos, lateral }: { veiculo: Veiculo; veiculos: Veiculo[]; lateral?: boolean }) {
  const navegar = useNavigate();
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        className={lateral
          ? "flex w-full cursor-pointer items-center gap-2.5 rounded-btn py-1.5 pr-2 pl-1.5 text-left transition-[background-color,scale] duration-150 hover:bg-papel-3 data-[state=open]:bg-papel-3"
          : "mr-auto flex min-w-0 cursor-pointer items-center gap-1 rounded-btn px-1.5 py-2.5"}
      >
        {lateral && <Marca veiculo={veiculo} className="size-[30px] text-[15px]" />}
        <span className="min-w-0 flex-1">
          <b className={`block text-texto-forte ${lateral ? "truncate text-[14.5px] leading-tight tracking-[-.01em]" : "truncate text-[16px]"}`}>{veiculo.nome}</b>
          {lateral && <span className="mono block truncate text-[11px] tracking-normal text-apoio">{veiculo.handle ?? localDe(veiculo)}</span>}
          <span className="sr-only">{t(", trocar de veículo", ", switch publication")}</span>
        </span>
        {lateral ? <IconeTroca className="size-4 flex-none text-apoio" /> : <IconeSeta className="size-4 flex-none text-apoio" />}
      </Menu.Trigger>
      <Menu.Content align="start" sideOffset={6} className="menu">
        <Menu.Label className="mono px-3 pt-2 pb-1 text-apoio">{t("Seus veículos", "Your publications")}</Menu.Label>
        <Menu.RadioGroup value={veiculo.slug} onValueChange={(slug) => navegar(`/t/${slug}`)}>
          {veiculos.map((v) => (
            <Menu.RadioItem key={v.id} value={v.slug} className="menu-item">
              <Marca veiculo={v} className="size-7 text-[13px]" />
              <span className="grid min-w-0">
                <span className="truncate font-bold text-texto-forte">{v.nome}</span>
                <span className="mono truncate text-apoio">{v.handle ?? localDe(v)}</span>
              </span>
              <Menu.ItemIndicator className="ml-auto"><IconeCerto className="size-[18px]" /></Menu.ItemIndicator>
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
        <Menu.Separator className="mx-2 my-1 h-px bg-fio" />
        <Menu.Item className="menu-item text-tinta" onSelect={() => navegar("/novo")}>{t("Criar outro veículo", "Create another publication")}</Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

export function useSair() {
  const qc = useQueryClient();
  const navegar = useNavigate();
  // Só limpa e vai para o login depois que o servidor confirmou: com falha, a sessão continua valendo.
  return useMutation({
    mutationFn: sair,
    onSuccess: () => {
      qc.clear();
      navegar("/entrar", { replace: true });
    },
  });
}

/** Idioma das telas, no menu da conta. Cada opção no próprio idioma; a escolha fica guardada na conta. */
function SeletorIdioma() {
  return (
    <>
      <Menu.Label className="mono px-3 pt-1 pb-1 text-apoio">{t("Idioma", "Language")}</Menu.Label>
      <Menu.RadioGroup value={idioma()} onValueChange={(v) => { if (ehIdioma(v)) void escolherIdioma(v, true); }}>
        <Menu.RadioItem value="pt-BR" lang="pt-BR" className="menu-item">
          Português<Menu.ItemIndicator className="ml-auto"><IconeCerto className="size-[18px]" /></Menu.ItemIndicator>
        </Menu.RadioItem>
        <Menu.RadioItem value="en" lang="en" className="menu-item">
          English<Menu.ItemIndicator className="ml-auto"><IconeCerto className="size-[18px]" /></Menu.ItemIndicator>
        </Menu.RadioItem>
      </Menu.RadioGroup>
    </>
  );
}

/** Aparência das telas, no menu da conta: papel (o padrão) ou à noite. Fica neste navegador (web/src/mesa.ts). */
function SeletorMesa() {
  const mesa = useMesa();
  return (
    <>
      <Menu.Label className="mono px-3 pt-1 pb-1 text-apoio">{t("Aparência", "Appearance")}</Menu.Label>
      <Menu.RadioGroup value={mesa} onValueChange={(v) => { if (ehMesa(v)) escolherMesa(v); }}>
        <Menu.RadioItem value="papel" className="menu-item">
          {t("Papel", "Paper")}<Menu.ItemIndicator className="ml-auto"><IconeCerto className="size-[18px]" /></Menu.ItemIndicator>
        </Menu.RadioItem>
        <Menu.RadioItem value="noite" className="menu-item">
          {t("À noite", "At night")}<Menu.ItemIndicator className="ml-auto"><IconeCerto className="size-[18px]" /></Menu.ItemIndicator>
        </Menu.RadioItem>
      </Menu.RadioGroup>
    </>
  );
}

export const inicial = (nome: string) => (nome.trim()[0] ?? "?").toUpperCase();

/**
 * Conta: avatar na barra (celular) ou a linha inteira no pé da lateral (computador, com nome e papel no veículo).
 * O menu tem nome, e-mail e sair; no celular (`partes`), também as partes do veículo (Marca, Contas, Fontes, Equipe),
 * que no computador ficam no grupo Veículo da lateral.
 */
export function MenuConta({ me, onSair, papel, partes, textos, onAtalhos }: { me: CtxCasca["me"]; onSair: () => void; papel?: string; partes?: boolean; textos?: boolean; onAtalhos?: () => void }) {
  const lateral = papel !== undefined;
  const navegar = useNavigate();
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        // Na lateral o nome e o papel estão à vista: o rótulo é o texto (com o prefixo só para leitor de tela), para o
        // nome acessível conter o que se lê (axe label-content-name-mismatch). Na barra, só a inicial aparece.
        aria-label={lateral ? undefined : `${t("Conta", "Account")}: ${me.user.name}`}
        className={lateral
          ? "flex w-full cursor-pointer items-center gap-2.5 rounded-btn py-1.5 pr-2 pl-1.5 text-left transition-[background-color,scale] duration-150 hover:bg-papel-3 data-[state=open]:bg-papel-3"
          : "grid size-11 flex-none cursor-pointer place-items-center rounded-full font-bold text-texto-forte"}
      >
        {lateral ? (
          <>
            <span aria-hidden="true" className="grid size-[30px] flex-none place-items-center rounded-full bg-branco text-[13px] font-bold text-texto-forte shadow-curta">
              {inicial(me.user.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="sr-only">{t("Conta: ", "Account: ")}</span>
              <b className="block truncate text-[14px] leading-tight text-texto-forte">{me.user.name}</b>
              <span className="mono block text-[11px] text-apoio">{nomePapel(papel)}</span>
            </span>
            <IconeTroca className="size-4 flex-none text-apoio" />
          </>
        ) : (
          // Mesma escala do quadrado da marca (32 px); a área de toque continua em 44.
          <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-papel-2 text-[15px]">{inicial(me.user.name)}</span>
        )}
      </Menu.Trigger>
      <Menu.Content align={lateral ? "start" : "end"} side={lateral ? "top" : "bottom"} sideOffset={6} className="menu max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto">
        <Menu.Label className="grid px-3 py-2">
          {!lateral && <MarcaGazzpush className="mb-2 w-32" />}
          <b className="text-texto-forte">{me.user.name}</b>
          <span className="mono text-apoio">{me.user.email}</span>
        </Menu.Label>
        <Menu.Separator className="mx-2 my-1 h-px bg-fio" />
        {/* Veículo de autor, no celular: a mesa revisora (no computador, primeira seção da lateral). */}
        {textos && (
          <>
            <Menu.Item className="menu-item" onSelect={() => navegar("textos")}>{t("Textos", "Texts")}</Menu.Item>
            <Menu.Separator className="mx-2 my-1 h-px bg-fio" />
          </>
        )}
        {partes && (
          <>
            <Menu.Label className="mono px-3 pt-1 pb-1 text-apoio">{t("Veículo", "Publication")}</Menu.Label>
            {partesVeiculo().map((p) => (
              <Menu.Item key={p.aba} className="menu-item" onSelect={() => navegar(`veiculo?aba=${p.aba}`)}>{p.rotulo}</Menu.Item>
            ))}
            <Menu.Separator className="mx-2 my-1 h-px bg-fio" />
          </>
        )}
        {me.adminPlataforma && <Menu.Item className="menu-item" onSelect={() => navegar("/admin/uso")}>{t("Consumo de tokens", "Token usage")}</Menu.Item>}
        <SeletorIdioma />
        <Menu.Separator className="mx-2 my-1 h-px bg-fio" />
        <SeletorMesa />
        {/* Só na lateral do computador: no celular não há teclado. */}
        {onAtalhos && (
          <>
            <Menu.Separator className="mx-2 my-1 h-px bg-fio" />
            <Menu.Item className="menu-item" onSelect={onAtalhos}>{t("Atalhos do teclado", "Keyboard shortcuts")}<span aria-hidden="true" className="kbd ml-auto">?</span></Menu.Item>
          </>
        )}
        <Menu.Separator className="mx-2 my-1 h-px bg-fio" />
        <Menu.Item className="menu-item" onSelect={onSair}>{t("Sair", "Sign out")}</Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
