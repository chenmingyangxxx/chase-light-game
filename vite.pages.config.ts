import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const pagesBase = "/chase-light-game";

function rewritePublicAssetUrls(): Plugin {
  return {
    name: "rewrite-public-asset-urls-for-github-pages",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]app[\\/](game\.tsx|globals\.css)$/.test(id)) {
        return null;
      }

      return {
        code: code.replaceAll("/assets/", `${pagesBase}/assets/`),
        map: null,
      };
    },
  };
}

export default defineConfig({
  root: resolve(projectRoot, "pages-src"),
  base: `${pagesBase}/`,
  publicDir: resolve(projectRoot, "public"),
  plugins: [rewritePublicAssetUrls(), react()],
  build: {
    outDir: resolve(projectRoot, "pages-dist"),
    emptyOutDir: true,
  },
});
