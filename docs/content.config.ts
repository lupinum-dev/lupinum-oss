import { defineGinkoDocsConfig } from "@lupinum/ginko-docs/content";
import site from "./site.json" with { type: "json" };

export default defineGinkoDocsConfig({
  site: {
    name: site.name,
    description: site.description,
    whenToUse:
      "Use this site to create, operate, and release Lupinum open-source repositories.",
  },
  locales: ["en"],
  blog: false,
});
