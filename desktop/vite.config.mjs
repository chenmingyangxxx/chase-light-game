import { fileURLToPath } from "node:url";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(desktopDir, "..");

export default defineConfig({
  root: desktopDir,
  base: "./",
  publicDir: path.join(projectDir, "public"),
  plugins: [react()],
  build: {
    outDir: path.join(projectDir, "desktop-dist"),
    emptyOutDir: true,
    target: "chrome138",
    assetsInlineLimit: 0,
    sourcemap: false,
  },
});
