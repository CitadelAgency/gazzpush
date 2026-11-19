// Outlet picker and account menu (Radix DropdownMenu: keyboard, focus and screen reader ready), in the Blue pencil's
// paper: no outline, a short shadow, the highlighted item in tone. Non-modal and without a Portal: the menu stays inside
// the bar/sidebar region (landmark) and the rest of the screen does not disappear for the screen reader.
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { signOut } from "../api";
import { isLanguage, language, t } from "../language";
import GazzpushBrand from "../kit/GazzpushMark";
import { isDesk, chooseDesk, useDesk } from "../theme";
import { chooseLanguage, localOf, type Outlet } from "../session";
import { IconRight, IconArrow, IconSwap } from "./icons";
import type { CtxShell } from "./context";
import { role as nomePapel, outletParts } from "./context";

/** The brand square: the outlet's logo or its initial in blue pencil. */
export function Brand({ veiculo: outlet, className = "size-9 text-[17px]" }: { veiculo: Pick<Outlet, "nome" | "logo">; className?: string }) {
  return outlet.logo ? (
    <img src={outlet.logo} alt="" className={`${className} flex-none rounded-faixa bg-branco object-contain p-0.5 shadow-fio`} />
  ) : (
    <span aria-hidden="true" className={`${className} grid flex-none place-items-center rounded-faixa bg-tinta font-bold text-sobre-tinta`}>
      {initial(outlet.nome)}
    </span>
  );
}

export function SelectorOutlet({ veiculo: outlet, veiculos: outlets, lateral: sidebar }: { veiculo: Outlet; veiculos: Outlet[]; lateral?: boolean }) {
  const navigate = useNavigate();
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        className={sidebar
          ? "flex w-full cursor-pointer items-center gap-2.5 rounded-btn py-1.5 pr-2 pl-1.5 text-left transition-[background-color,scale] duration-150 hover:bg-papel-3 data-[state=open]:bg-papel-3"
          : "mr-auto flex min-w-0 cursor-pointer items-center gap-1 rounded-btn px-1.5 py-2.5"}
      >
        {sidebar && <Brand veiculo={outlet} className="size-[30px] text-[15px]" />}
        <span className="min-w-0 flex-1">
          <b className={`block text-texto-forte ${sidebar ? "truncate text-[14.5px] leading-tight tracking-[-.01em]" : "truncate text-[16px]"}`}>{outlet.nome}</b>
          {sidebar && <span className="mono block truncate text-[11px] tracking-normal text-apoio">{outlet.handle ?? localOf(outlet)}</span>}
          <span className="sr-only">{t(", trocar de veículo", ", switch publication")}</span>
        </span>
        {sidebar ? <IconSwap className="size-4 flex-none text-apoio" /> : <IconArrow className="size-4 flex-none text-apoio" />}
      </Menu.Trigger>
      <Menu.Content align="start" sideOffset={6} className="menu">
        <Menu.Label className="mono px-3 pt-2 pb-1 text-apoio">{t("Seus veículos", "Your publications")}</Menu.Label>
        <Menu.RadioGroup value={outlet.slug} onValueChange={(slug) => navigate(`/t/${slug}`)}>
          {outlets.map((v) => (
            <Menu.RadioItem key={v.id} value={v.slug} className="menu-item">
              <Brand veiculo={v} className="size-7 text-[13px]" />
              <span className="grid min-w-0">
                <span className="truncate font-bold text-texto-forte">{v.nome}</span>
                <span className="mono truncate text-apoio">{v.handle ?? localOf(v)}</span>
              </span>
              <Menu.ItemIndicator className="ml-auto"><IconRight className="size-[18px]" /></Menu.ItemIndicator>
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
        <Menu.Separator className="mx-2 my-1 h-px bg-fio" />
        <Menu.Item className="menu-item text-tinta" onSelect={() => navigate("/novo")}>{t("Criar outro veículo", "Create another publication")}</Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

export function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Only clears and goes to sign-in after the server confirmed: on failure, the session stays valid.
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      qc.clear();
      navigate("/entrar", { replace: true });
    },
  });
}

/** Screen language, in the account menu. Each option in its own language; the choice is stored on the account. */
function SelectorLanguage() {
  return (
    <>
      <Menu.Label className="mono px-3 pt-1 pb-1 text-apoio">{t("Idioma", "Language")}</Menu.Label>
      <Menu.RadioGroup value={language()} onValueChange={(v) => { if (isLanguage(v)) void chooseLanguage(v, true); }}>
        <Menu.RadioItem value="pt-BR" lang="pt-BR" className="menu-item">
          Português<Menu.ItemIndicator className="ml-auto"><IconRight className="size-[18px]" /></Menu.ItemIndicator>
        </Menu.RadioItem>
        <Menu.RadioItem value="en" lang="en" className="menu-item">
          English<Menu.ItemIndicator className="ml-auto"><IconRight className="size-[18px]" /></Menu.ItemIndicator>
        </Menu.RadioItem>
      </Menu.RadioGroup>
    </>
  );
}

/** Screen appearance, in the account menu: paper (the default) or night. It stays in this browser (web/src/theme.ts). */
function SelectorDesk() {
  const desk = useDesk();
  return (
    <>
      <Menu.Label className="mono px-3 pt-1 pb-1 text-apoio">{t("Aparência", "Appearance")}</Menu.Label>
      <Menu.RadioGroup value={desk} onValueChange={(v) => { if (isDesk(v)) chooseDesk(v); }}>
        <Menu.RadioItem value="papel" className="menu-item">
          {t("Papel", "Paper")}<Menu.ItemIndicator className="ml-auto"><IconRight className="size-[18px]" /></Menu.ItemIndicator>
        </Menu.RadioItem>
        <Menu.RadioItem value="noite" className="menu-item">
          {t("À noite", "At night")}<Menu.ItemIndicator className="ml-auto"><IconRight className="size-[18px]" /></Menu.ItemIndicator>
        </Menu.RadioItem>
      </Menu.RadioGroup>
    </>
  );
}

export const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

/**
 * Account: an avatar in the bar (mobile) or the whole row at the bottom of the sidebar (desktop, with name and role in
 * the outlet). The menu has name, email and sign out; on mobile (`partes`), also the outlet's parts (Brand, Accounts,
 * Sources, Team), which on desktop sit in the sidebar's Outlet group.
 */
export function MenuAccount({ me, onSair: onSignOut, papel: role, partes: parts, textos: texts, onAtalhos: onShortcuts }: { me: CtxShell["me"]; onSair: () => void; papel?: string; partes?: boolean; textos?: boolean; onAtalhos?: () => void }) {
  const sidebar = role !== undefined;
  const navigate = useNavigate();
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        // In the sidebar the name and role are visible: the label is the text (with the prefix only for screen readers), so the
        // accessible name contains what is read (axe label-content-name-mismatch). In the bar, only the initial shows.
        aria-label={sidebar ? undefined : `${t("Conta", "Account")}: ${me.user.name}`}
        className={sidebar
          ? "flex w-full cursor-pointer items-center gap-2.5 rounded-btn py-1.5 pr-2 pl-1.5 text-left transition-[background-color,scale] duration-150 hover:bg-papel-3 data-[state=open]:bg-papel-3"
          : "grid size-11 flex-none cursor-pointer place-items-center rounded-full font-bold text-texto-forte"}
      >
        {sidebar ? (
          <>
            <span aria-hidden="true" className="grid size-[30px] flex-none place-items-center rounded-full bg-branco text-[13px] font-bold text-texto-forte shadow-curta">
              {initial(me.user.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="sr-only">{t("Conta: ", "Account: ")}</span>
              <b className="block truncate text-[14px] leading-tight text-texto-forte">{me.user.name}</b>
              <span className="mono block text-[11px] text-apoio">{nomePapel(role)}</span>
            </span>
            <IconSwap className="size-4 flex-none text-apoio" />
          </>
        ) : (
          // The same scale as the brand square (32 px); the touch area stays at 44.
          <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-papel-2 text-[15px]">{initial(me.user.name)}</span>
        )}
      </Menu.Trigger>
      <Menu.Content align={sidebar ? "start" : "end"} side={sidebar ? "top" : "bottom"} sideOffset={6} className="menu max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto">
        <Menu.Label className="grid px-3 py-2">
          {/* Decorative here: an image is not an allowed child of role="menu" (axe aria-required-children). */}
          {!sidebar && <span aria-hidden="true"><GazzpushBrand className="mb-2 w-32" /></span>}
          <b className="text-texto-forte">{me.user.name}</b>
          <span className="mono text-apoio">{me.user.email}</span>
        </Menu.Label>
        <Menu.Separator className="mx-2 my-1 h-px bg-fio" />
        {/* Author outlet, on mobile: the review desk (on desktop, the sidebar's first section). */}
        {texts && (
          <>
            <Menu.Item className="menu-item" onSelect={() => navigate("textos")}>{t("Textos", "Texts")}</Menu.Item>
            <Menu.Separator className="mx-2 my-1 h-px bg-fio" />
          </>
        )}
        {parts && (
          <>
            <Menu.Label className="mono px-3 pt-1 pb-1 text-apoio">{t("Veículo", "Publication")}</Menu.Label>
            {outletParts().map((p) => (
              <Menu.Item key={p.aba} className="menu-item" onSelect={() => navigate(`veiculo?aba=${p.aba}`)}>{p.rotulo}</Menu.Item>
            ))}
            <Menu.Separator className="mx-2 my-1 h-px bg-fio" />
          </>
        )}
        {me.adminPlataforma && <Menu.Item className="menu-item" onSelect={() => navigate("/admin/uso")}>{t("Consumo de tokens", "Token usage")}</Menu.Item>}
        <SelectorLanguage />
        <Menu.Separator className="mx-2 my-1 h-px bg-fio" />
        <SelectorDesk />
        {/* Only in the desktop sidebar: there is no keyboard on mobile. */}
        {onShortcuts && (
          <>
            <Menu.Separator className="mx-2 my-1 h-px bg-fio" />
            <Menu.Item className="menu-item" onSelect={onShortcuts}>{t("Atalhos do teclado", "Keyboard shortcuts")}<span aria-hidden="true" className="kbd ml-auto">?</span></Menu.Item>
          </>
        )}
        <Menu.Separator className="mx-2 my-1 h-px bg-fio" />
        <Menu.Item className="menu-item" onSelect={onSignOut}>{t("Sair", "Sign out")}</Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
