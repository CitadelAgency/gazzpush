import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// SPA served as the Worker's `assets` (wrangler.jsonc). Dev: `npm run web:dev` (build --watch) + `npm run dev`,
// same origin on localhost:8787. Never proxy 5173→8787: cookies and CSRF by Origin break.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true, assetsInlineLimit: 0, reportCompressedSize: true },
});
