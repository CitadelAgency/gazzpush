// Routes: React Router in library mode, one screen per JS chunk (lazy). The URL holds the outlet and the section.
import type { ComponentType } from "react";
import { createBrowserRouter, redirect } from "react-router";
import { Home } from "./screens/Home";

const view = (load: () => Promise<{ default: ComponentType }>) => async () => ({ Component: (await load()).default });

export const router = createBrowserRouter([
  { path: "/", Component: Home },
  { path: "/lista-de-espera", lazy: view(() => import("./screens/Waitlist")) },
  { path: "/entrar", lazy: view(() => import("./screens/SignIn")) },
  { path: "/novo", lazy: view(() => import("./screens/NewOutlet")) },
  { path: "/admin/uso", lazy: view(() => import("./screens/Usage")) },
  {
    path: "/t/:veiculo",
    lazy: view(() => import("./shell/Shell")),
    children: [
      { index: true, lazy: view(() => import("./screens/Ideas")) },
      { path: "p/:peca", lazy: view(() => import("./screens/Piece")) },
      { path: "p/:peca/reels", lazy: view(() => import("./screens/Reels")) },
      { path: "aprovar", lazy: view(() => import("./screens/Approve")) },
      { path: "postar", lazy: view(() => import("./screens/Post")) },
      { path: "postados", lazy: view(() => import("./screens/Posted")) },
      { path: "veiculo", lazy: view(() => import("./screens/Outlet")) },
      // Review desk (author outlet).
      { path: "textos", lazy: view(() => import("./screens/Texts")) },
      { path: "textos/:id", lazy: view(() => import("./screens/Desk")) },
      // The old + New address: today it is the sheet over Ideas.
      { path: "nova", loader: ({ params }) => redirect(`/t/${params.veiculo}?nova=link`) },
    ],
  },
  { path: "*", lazy: view(() => import("./screens/NotFound")) },
]);
