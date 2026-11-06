import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Front end only. The API runs under `npm run dev:api` (wrangler) and is proxied.
export default defineConfig({
  plugins: [react()],
  root: "src/web",
  build: { outDir: "../../dist/client", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:8787" } },
});
