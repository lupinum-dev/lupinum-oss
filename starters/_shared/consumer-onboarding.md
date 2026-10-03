## Agent setup

`{{CONSUMER_PACKAGE}}` ships its documentation inside the package for coding
agents such as Claude Code, Codex and Cursor. The pages match the installed
version, so an agent does not follow the website for a different version.

To set it up, give your coding agent this task:

```text
Set up {{CONSUMER_PACKAGE}} for coding agents as described under "Agent setup" in its README.
```

### Steps for the agent

1. Find `node_modules/{{CONSUMER_PACKAGE}}/dist/agent/AGENTS.md`. Look in the
   directory of the project that depends on `{{CONSUMER_PACKAGE}}` first, then
   in its parent directories up to the repository root (workspaces can hoist
   packages). Read it; it lists the documentation pages.
2. Add the section below to the project's agent instructions: `AGENTS.md`, or
   `CLAUDE.md` if the project has only that file. If it has neither, create
   `AGENTS.md`. Write the path relative to the repository root, through
   `node_modules/{{CONSUMER_PACKAGE}}` (for example
   `apps/web/node_modules/{{CONSUMER_PACKAGE}}/...` in a workspace). Never write
   a resolved path such as `node_modules/.pnpm/...`: it contains the version and
   breaks after an upgrade. If a section for `{{CONSUMER_PACKAGE}}` already
   exists, leave it as it is.

   ```md
   ## {{CONSUMER_PACKAGE}}

   Before you change code that uses {{CONSUMER_PACKAGE}}, read
   `node_modules/{{CONSUMER_PACKAGE}}/dist/agent/AGENTS.md` and the pages it
   lists. They document the installed version; prefer them over the website.
   ```

3. Do not copy the documentation into the project and do not install a skill.
   The section points into the installed package, so it stays correct after
   every upgrade or downgrade.

If the file does not exist, the installed version has no packaged
documentation. Read the package README and its TypeScript types instead.
