// Google Docs in the interface: connect (Google account link through Better Auth, with the drive.file scope) and choose
// a document in the Google Picker. The Picker script only loads when someone opens it. The token the Picker requires
// comes from the Worker (GET /api/google/token), is short-lived and not stored: nothing from Google goes to localStorage.
import { api, headerLanguage, ApiError, read } from "../api";
import { t } from "../language";

/**
 * Links the Google account with the Docs scope and returns to `volta`. `access_type=offline` + `prompt=consent`: Google
 * hands over the refresh token, so the Worker can renew access without asking again.
 */
export async function connectGoogle(scope: string, back: string) {
  const r = await read(fetch("/api/auth/link-social", {
    method: "POST", headers: { "content-type": "application/json", ...headerLanguage() },
    body: JSON.stringify({
      provider: "google", scopes: [scope], callbackURL: back, errorCallbackURL: back,
      additionalParams: { access_type: "offline", prompt: "consent" },
    }),
  })) as { url?: string };
  if (!r.url) throw new ApiError(502, t("O Google não respondeu agora. Tente de novo.", "Google didn't respond right now. Try again."));
  location.assign(r.url);
}

type Picker = Record<string, any>;
let load: Promise<Picker> | null = null;

function loadPicker(): Promise<Picker> {
  load ??= new Promise<Picker>((ok, failure) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.async = true;
    s.onload = () => {
      const w = window as unknown as { gapi: { load: (m: string, o: { callback: () => void; onerror: () => void }) => void }; google: { picker: Picker } };
      w.gapi.load("picker", { callback: () => ok(w.google.picker), onerror: () => failure(new Error("picker")) });
    };
    s.onerror = () => failure(new Error("picker"));
    document.head.appendChild(s);
  }).catch((e) => { load = null; throw e; });
  return load;
}

/** Opens the Picker with Google Docs documents only. null = the person cancelled. */
export async function chooseDoc(cfg: { apiKey: string; appId: string }): Promise<{ id: string; nome: string } | null> {
  const { accessToken } = await read(api.google.token.$get());
  let g: Picker;
  try {
    g = await loadPicker();
  } catch {
    throw new ApiError(0, t("Não deu para abrir o Google Docs agora. Confira a internet e tente de novo.", "Couldn't open Google Docs right now. Check the internet and try again."));
  }
  return new Promise((ok) => {
    const view = new g.DocsView(g.ViewId.DOCUMENTS).setMimeTypes("application/vnd.google-apps.document").setMode(g.DocsViewMode.LIST);
    new g.PickerBuilder()
      .addView(view).setOAuthToken(accessToken).setDeveloperKey(cfg.apiKey).setAppId(cfg.appId).setLocale(t("pt-BR", "en"))
      .setTitle(t("Escolha o texto no Google Docs", "Pick the text in Google Docs"))
      .setCallback((d: { action: string; docs?: { id: string; name: string }[] }) => {
        if (d.action === g.Action.PICKED && d.docs?.[0]) ok({ id: d.docs[0].id, nome: d.docs[0].name });
        else if (d.action === g.Action.CANCEL) ok(null);
      })
      .build().setVisible(true);
  });
}
