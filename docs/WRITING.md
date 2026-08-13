# Writing documentation

Lupinum public documentation uses Lupinum Controlled English. This profile is
based on ASD-STE100 Simplified Technical English. It does not claim formal
ASD-STE100 certification.

## Write for the reader

- Start with the result or required action.
- Use short sentences and active voice.
- Put one main instruction in each sentence.
- Use the imperative form for procedures.
- Use one term for one concept.
- Define technical terms before you use them.
- Put a warning before the action that causes the risk.
- Use sentence-case headings.
- Use American English spelling.
- Explain the reason when a rule is not self-evident.

Do not use filler such as `simply`, `just`, `obviously`, `easy`, `seamless`,
or `powerful`. Do not use jokes, idioms, or emoji as navigation labels.

## Use the approved terms

- **Repository**: one Git repository.
- **Workspace**: a repository that contains more than one package or app.
- **Package**: an npm package that consumers install.
- **Documentation app**: the deployable Nuxt app in `docs/`.
- **Release candidate**: the exact tarball that passed all release checks.
- **Certified tarball**: a release candidate whose name, version, files, and
  hashes match the release manifest.
- **Bootstrap release**: the first interactive publication of a new npm
  package before trusted publishing can be configured.
- **Trusted publisher**: npm configuration that permits one GitHub Actions
  workflow to publish with OpenID Connect (OIDC).
- **Provenance**: a signed record that connects a package to its source and
  build workflow.
- **Dependency quarantine**: the minimum time before a newly released
  dependency can enter a lockfile.
- **External control**: required state in GitHub, npm, Vercel, Plausible, DNS,
  or another service that is not stored in the repository.

Do not use `artifact`, `tarball`, `package`, and `release` as interchangeable
terms.

## Structure each page

- Put `title` and `description` in frontmatter.
- Do not add a body-level level-one heading.
- Organize pages under get started, standards, procedures, checklists, or
  troubleshooting.
- Label each code fence with its language.
- Add a file path above a code example when the location matters.
- Show one concept in each example.
- End with a specific section. Do not add a generic `Summary`, `Conclusion`,
  `Related`, or `Next steps` section.

## Keep responsibilities separate

The handbook explains fleet-wide policy. A repository's `AGENTS.md` explains
its architecture and invariant checks. `MAINTAINING.md` explains its daily
procedures. `CONTRIBUTING.md` explains the external contribution process.
`SECURITY.md` explains private vulnerability reporting.

Do not copy complete handbook pages into a repository or Codex skill. A
generated repository must still contain enough local information to operate
without this site.

## Exclusions

Do not rewrite legal text, license text, code identifiers, command output,
quotations, changelog entries, or generated reports to satisfy this writing
profile.
