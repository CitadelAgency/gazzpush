import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router/dom";
import { ErroApi } from "./api";
import { roteador } from "./rotas";
import { useIdioma } from "./idioma";
import "./estilo/tokens.css";
import "./estilo/prova.css";
import "./kit/lapis.css";
import "./estilo/rodada4.css";
import { instalarDicas } from "./dica";
import { instalarMovimento } from "./movimento";
import "./mesa";   // aplica a aparência escolhida (papel ou à noite) antes de desenhar

instalarMovimento();
instalarDicas();

const consultas = new QueryClient({
  defaultOptions: {
    // Erro 4xx não melhora repetindo; rede e 5xx tentam mais uma vez.
    queries: { retry: (n, e) => n < 1 && !(e instanceof ErroApi && e.status >= 400 && e.status < 500) },
  },
});

// Trocar o idioma remonta as telas (o texto sai de `t(...)` na hora de desenhar); a URL e o cache das consultas ficam.
function App() {
  const idioma = useIdioma();
  return <RouterProvider key={idioma} router={roteador} />;
}

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <QueryClientProvider client={consultas}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
