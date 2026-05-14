import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://jackLDyer.github.io",
  base: "/travel-journal",
  vite: {
    assetsInclude: ["**/*.heic", "**/*.HEIC"],
  },
});
