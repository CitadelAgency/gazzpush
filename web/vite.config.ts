import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// SPA servida como `assets` do Worker (wrangler.jsonc). Dev: `npm run web:dev` (build --watch) + `npm run dev`,
// mesma origem em localhost:8787. Nunca proxy 5173→8787: cookie e CSRF por Origin quebram.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true, assetsInlineLimit: 0, reportCompressedSize: true },
});
