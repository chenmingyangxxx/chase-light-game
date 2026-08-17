import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(projectRoot, "pages-src"),
  base: "/",
  publicDir: resolve(projectRoot, "public"),
  plugins: [react()],
  build: {
    outDir: resolve(projectRoot, "cloudflare-pages-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        game: resolve(projectRoot, "pages-src/index.html"),
        admin: resolve(projectRoot, "pages-src/admin/index.html"),
      },
    },
  },
});
