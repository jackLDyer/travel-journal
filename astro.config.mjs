import { defineConfig } from "astro/config";

export default defineConfig({
  vite: {
    assetsInclude: ["**/*.heic", "**/*.HEIC"],
  },
});
