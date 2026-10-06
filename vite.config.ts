import { defineConfig } from "vite";

export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages serves the site at https://<user>.github.io/kopi-run/
  base: command === "build" || isPreview ? "/kopi-run/" : "/",
}));
