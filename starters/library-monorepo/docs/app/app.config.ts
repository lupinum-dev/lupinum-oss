export default defineAppConfig({
  ginkoDocs: {
    site: {
      url: 'https://{{DOMAIN}}',
      name: { en: '{{TITLE}}' },
      description: { en: '{{DESCRIPTION}}' },
      logo: { light: '/icon.svg', dark: '/icon.svg' },
      legalLinks: [
        { label: { en: 'Legal notice' }, to: 'https://lupinum.com/impressum' },
        { label: { en: 'Privacy' }, to: 'https://lupinum.com/datenschutz' },
      ],
    },
    social: { github: 'https://github.com/{{REPOSITORY}}', discord: 'https://discord.gg/RPH6SeA36N' },
    repository: { url: 'https://github.com/{{REPOSITORY}}', branch: 'main', contentDirectory: 'docs/content' },
    analytics: { plausible: { scriptId: '{{PLAUSIBLE_ID}}' } },
    feedback: { enabled: true },
    landing: {
      title: { en: '{{TITLE}}' },
      description: { en: '{{DESCRIPTION}}' },
      primary: { label: { en: 'Get started' }, to: { en: '/docs' } },
      secondary: { label: { en: 'View on GitHub' }, to: { en: 'https://github.com/{{REPOSITORY}}' } },
      install: { command: 'pnpm add {{PACKAGE_2}}' },
    },
  },
})
