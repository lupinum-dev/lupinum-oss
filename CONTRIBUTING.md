# Contributing

This repository sets the standard for several libraries, so a small mistake spreads. Open an issue before a
larger change and keep each pull request to one outcome.

```bash
pnpm install
pnpm verify
```

A change to the standard updates the handbook, the starters and the audit together and adds an entry to
`DECISIONS.md`. New checks or scripts must guard behavior users rely on or a real attack path; see
[Adding tooling](https://oss.lupinum.com/docs/adding-tooling).
