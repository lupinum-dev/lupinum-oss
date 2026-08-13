import { defineGinkoDocsConfig } from "@lupinum/ginko-docs/content";
import site from "./site.json" with { type: "json" };

export default defineGinkoDocsConfig({
  site: {
    name: site.name,
    description: site.description,
    url: site.url,
  },
  locales: ["en"],
  blog: false,
});
