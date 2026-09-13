## Use a coding agent

Copy this task prompt into your application agent:

```text
Use the installed {{CONSUMER_PACKAGE}} package to implement my requested feature.
Read the application's instructions first. Resolve {{CONSUMER_PACKAGE}}/agent-docs
from this application directory and read the relevant local pages.
Preserve the existing AGENTS.md. If it has no equivalent guidance, append
one short note to resolve installed package docs before integration work
and after dependency changes. Do not install a consumer skill.
Check the completed feature using this project's normal commands.
```

The installed documentation matches the package version. If an older version
has no documentation export, use its README, types and matching release docs.
