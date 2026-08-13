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
    social: { github: site.repository, discord: site.discord },
    repository: {
      url: site.repository,
      branch: "main",
      contentDirectory: "docs/content",
    },
    feedback: { enabled: true },
    landing: {
      eyebrow: { en: "Open-source operations · built in public" },
      title: { en: "Start correct. Ship with confidence." },
      description: {
        en: "Lupinum OSS provides one practical handbook, tested repository starters, and a thin Codex skill for secure open-source work.",
      },
      primary: { label: { en: "Read the handbook" }, to: { en: "/docs" } },
      secondary: { label: { en: "View on GitHub" }, to: { en: site.repository } },
      install: { command: "node starters/library/setup.mjs --help" },
      features: [
        {
          title: { en: "One operating standard" },
          description: { en: "Use the same maintainer commands, release controls, writing rules, and support paths in every project." },
          icon: "lucide:book-check",
        },
        {
          title: { en: "Tested starting points" },
          description: { en: "Start a library, package monorepo, or deployed app with the required files and workflows already present." },
          icon: "lucide:blocks",
        },
        {
          title: { en: "Secure npm releases" },
          description: { en: "Build once, certify the exact tarball, and publish it with npm trusted publishing and provenance." },
          icon: "lucide:shield-check",
        },
        {
          title: { en: "Agent-readable operations" },
          description: { en: "Keep architecture and maintenance instructions in each repository so a future agent can work safely." },
          icon: "lucide:bot",
        },
      ],
      cta: {
        title: { en: "Create the next repository from a known-good path." },
        secondary: { label: { en: "Choose a repository profile" }, to: { en: "/docs/get-started/choose-a-profile" } },
      },
    },
  },
};
