// Rotas: React Router em modo biblioteca, uma tela por pedaço de JS (lazy). A URL guarda veículo e seção.
import type { ComponentType } from "react";
import { createBrowserRouter, redirect } from "react-router";
import { Inicio } from "./telas/Inicio";

const tela = (carregar: () => Promise<{ default: ComponentType }>) => async () => ({ Component: (await carregar()).default });

export const roteador = createBrowserRouter([
  { path: "/", Component: Inicio },
  { path: "/lista-de-espera", lazy: tela(() => import("./telas/ListaEspera")) },
  { path: "/entrar", lazy: tela(() => import("./telas/Entrar")) },
  { path: "/novo", lazy: tela(() => import("./telas/NovoVeiculo")) },
  { path: "/admin/uso", lazy: tela(() => import("./telas/Uso")) },
  {
    path: "/t/:veiculo",
    lazy: tela(() => import("./casca/Casca")),
    children: [
      { index: true, lazy: tela(() => import("./telas/Ideias")) },
      { path: "p/:peca", lazy: tela(() => import("./telas/Peca")) },
      { path: "p/:peca/reels", lazy: tela(() => import("./telas/Reels")) },
      { path: "aprovar", lazy: tela(() => import("./telas/Aprovar")) },
      { path: "postar", lazy: tela(() => import("./telas/Postar")) },
      { path: "postados", lazy: tela(() => import("./telas/Postados")) },
      { path: "veiculo", lazy: tela(() => import("./telas/Veiculo")) },
      // Mesa revisora (veículo de autor).
      { path: "textos", lazy: tela(() => import("./telas/Textos")) },
      { path: "textos/:id", lazy: tela(() => import("./telas/Mesa")) },
      // Endereço antigo da + Nova: hoje é a folha por cima das Ideias.
      { path: "nova", loader: ({ params }) => redirect(`/t/${params.veiculo}?nova=link`) },
    ],
  },
  { path: "*", lazy: tela(() => import("./telas/NaoEncontrada")) },
]);
