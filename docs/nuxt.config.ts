import site from "./site.json" with { type: "json" };

export default defineNuxtConfig({
  extends: ["@lupinum/ginko-docs"],
  site: { defaultLocale: "en-US", url: site.url },
  i18n: {
    baseUrl: site.url,
    locales: [{ code: "en", language: "en-US", name: "English" }],
  },
  fonts: {
    families: [
      { name: "Public Sans", provider: "local" },
      { name: "JetBrains Mono", provider: "none" },
    ],
    providers: {
      adobe: false,
      bunny: false,
      fontshare: false,
      fontsource: false,
      google: false,
      googleicons: false,
      npm: false,
    },
  },
});
