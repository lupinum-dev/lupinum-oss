import site from "../site.json" with { type: "json" };

export default {
  ginkoDocs: {
    site: {
      url: site.url,
      name: { en: site.name },
      description: { en: site.description },
      logo: { light: "/logo.svg", dark: "/logo-dark.svg" },
      docsSidebarSwitcher: "tabs",
      legalLinks: [
        { label: { en: "Legal notice" }, to: "https://lupinum.com/impressum" },
        { label: { en: "Privacy" }, to: "https://lupinum.com/datenschutz" },
      ],
    },
    nav: { links: "auto", socialIcons: true },
    social: { github: site.repository, discord: site.discord },
    repository: {
      url: site.repository,
      branch: "main",
      contentDirectory: "docs/content",
    },
    analytics: { plausible: { scriptId: "5fyE8fD6AUwglXv86unjX" } },
    feedback: { enabled: true },
    landing: {
      eyebrow: { en: "Open-source operations · built in public" },
      title: { en: "Lazy maintenance. Real security." },
      description: {
        en: "The standard behind Lupinum libraries: a seven-page handbook, repository starters, a read-only audit and a thin agent skill.",
      },
      primary: { label: { en: "Read the handbook" }, to: { en: "/docs/overview" } },
      secondary: { label: { en: "View on GitHub" }, to: { en: site.repository } },
      install: { command: "pnpm audit:repos lupinum-dev/<repository>" },
      features: [
        {
          title: { en: "Two-click releases" },
          description: { en: "Merge the Version packages pull request, approve the publish. Changesets and CI do the rest." },
          icon: "lucide:rocket",
        },
        {
          title: { en: "No tokens to steal" },
          description: { en: "npm trusted publishing with provenance, from a protected environment, without installing anything." },
          icon: "lucide:shield-check",
        },
        {
          title: { en: "Quarantined dependencies" },
          description: { en: "New versions wait 24 hours and install scripts need an allowlist. Built into pnpm and Renovate." },
          icon: "lucide:timer",
        },
        {
          title: { en: "Lean by rule" },
          description: { en: "A check exists only if it guards user-facing behavior or a real attack path. The audit flags the rest." },
          icon: "lucide:scissors",
        },
      ],
      cta: {
        title: { en: "Set up the next repository in an afternoon." },
        secondary: { label: { en: "Set up a repository" }, to: { en: "/docs/set-up-a-repository" } },
      },
    },
  },
};
