// Google Docs na interface: conectar (vínculo da conta Google pelo Better Auth, com o escopo drive.file) e escolher um
// documento no Google Picker. O script do Picker só carrega quando alguém o abre. O token que o Picker exige vem do
// Worker (GET /api/google/token), dura pouco e não é guardado: nada do Google vai para localStorage.
import { api, cabecalhoIdioma, ErroApi, ler } from "../api";
import { t } from "../idioma";

/**
 * Vincula a conta Google com o escopo do Docs e volta para `volta`. `access_type=offline` + `prompt=consent`: o Google
 * entrega o refresh token, para o Worker renovar o acesso sem pedir de novo.
 */
export async function conectarGoogle(escopo: string, volta: string) {
  const r = await ler(fetch("/api/auth/link-social", {
    method: "POST", headers: { "content-type": "application/json", ...cabecalhoIdioma() },
    body: JSON.stringify({
      provider: "google", scopes: [escopo], callbackURL: volta, errorCallbackURL: volta,
      additionalParams: { access_type: "offline", prompt: "consent" },
    }),
  })) as { url?: string };
  if (!r.url) throw new ErroApi(502, t("O Google não respondeu agora. Tente de novo.", "Google didn't respond right now. Try again."));
  location.assign(r.url);
}

type Picker = Record<string, any>;
let carga: Promise<Picker> | null = null;

function carregarPicker(): Promise<Picker> {
  carga ??= new Promise<Picker>((ok, falha) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.async = true;
    s.onload = () => {
      const w = window as unknown as { gapi: { load: (m: string, o: { callback: () => void; onerror: () => void }) => void }; google: { picker: Picker } };
      w.gapi.load("picker", { callback: () => ok(w.google.picker), onerror: () => falha(new Error("picker")) });
    };
    s.onerror = () => falha(new Error("picker"));
    document.head.appendChild(s);
  }).catch((e) => { carga = null; throw e; });
  return carga;
}

/** Abre o Picker só com documentos do Google Docs. null = a pessoa cancelou. */
export async function escolherDoc(cfg: { apiKey: string; appId: string }): Promise<{ id: string; nome: string } | null> {
  const { accessToken } = await ler(api.google.token.$get());
  let g: Picker;
  try {
    g = await carregarPicker();
  } catch {
    throw new ErroApi(0, t("Não deu para abrir o Google Docs agora. Confira a internet e tente de novo.", "Couldn't open Google Docs right now. Check the internet and try again."));
  }
  return new Promise((ok) => {
    const vista = new g.DocsView(g.ViewId.DOCUMENTS).setMimeTypes("application/vnd.google-apps.document").setMode(g.DocsViewMode.LIST);
    new g.PickerBuilder()
      .addView(vista).setOAuthToken(accessToken).setDeveloperKey(cfg.apiKey).setAppId(cfg.appId).setLocale(t("pt-BR", "en"))
      .setTitle(t("Escolha o texto no Google Docs", "Pick the text in Google Docs"))
      .setCallback((d: { action: string; docs?: { id: string; name: string }[] }) => {
        if (d.action === g.Action.PICKED && d.docs?.[0]) ok({ id: d.docs[0].id, nome: d.docs[0].name });
        else if (d.action === g.Action.CANCEL) ok(null);
      })
      .build().setVisible(true);
  });
}
