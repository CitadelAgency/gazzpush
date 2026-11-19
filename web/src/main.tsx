import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router/dom";
import { ApiError } from "./api";
import { router } from "./routes";
import { useLanguage } from "./language";
import "./styles/tokens.css";
import "./styles/proof.css";
import "./kit/pencil.css";
import "./styles/desk.css";
import { installTips } from "./tooltip";
import { installMotion } from "./motion";
import "./theme";   // applies the chosen appearance (paper or night) before drawing

installMotion();
installTips();

const queries = new QueryClient({
  defaultOptions: {
    // A 4xx error does not improve by repeating; network and 5xx errors try once more.
    queries: { retry: (n, e) => n < 1 && !(e instanceof ApiError && e.status >= 400 && e.status < 500) },
  },
});

// Switching language remounts the screens (the text comes from `t(...)` at draw time); the URL and the query cache stay.
function App() {
  const language = useLanguage();
  return <RouterProvider key={language} router={router} />;
}

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
