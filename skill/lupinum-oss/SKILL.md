---
name: lupinum-oss
description: Operate Lupinum open-source repositories from the public Lupinum OSS handbook and tested starters. Use when Codex must create a Lupinum library, monorepo, or app; audit an existing repository against the standard; configure safe GitHub repository settings; prepare a release or hotfix; diagnose CI, npm trusted-publishing, dependency-quarantine, Vercel, Plausible, or documentation failures; or record remaining human launch gates.
---

# Lupinum OSS

Use this skill as an operator, not as a second policy source. Read current policy from the public handbook and exact commands from the target repository.

The canonical public handbook is `https://oss.lupinum.com`. Use its matching `lupinum-dev/lupinum-oss` checkout for starter files and offline policy reads.

## Establish sources of truth

1. Locate the `lupinum-dev/lupinum-oss` checkout. When this skill is inside that checkout, resolve the repository root two directories above this file. Otherwise, use a user-provided checkout or fetch the current public repository into a temporary directory from `https://github.com/lupinum-dev/lupinum-oss`.
2. Read the checkout's root `AGENTS.md` completely.
3. Read the handbook index and only the procedure, standard, checklist, and troubleshooting pages relevant to the request.
4. In an existing target repository, read its `AGENTS.md` and `MAINTAINING.md` completely before acting. Read `docs/WRITING.md` before changing public prose.
5. Treat repository-local instructions as binding for that repository. When they conflict with the current handbook, preserve higher-priority instructions and report the drift instead of silently choosing a third path.

Do not copy detailed handbook policy into generated explanations or this skill. Link to the canonical page and summarize only what the current task needs.

## Classify the operation

- **Create**: select and materialize a tested starter, customize it, verify it, configure permitted external settings, and open one launch issue for human gates.
- **Audit**: inspect a repository and external settings, run objective checks, and report evidence. Do not mutate a review-only target.
- **Fleet audit or rollout**: read the explicit library inventory, audit every
  target before mutation, and apply shared policy through focused pull requests.
- **Prepare a release or hotfix**: follow the repository's `MAINTAINING.md` and the current handbook procedure. Certify one immutable artifact and preserve protected publication boundaries.
- **Diagnose**: gather the failed job, exact logs, repository state, external configuration, and registry state before proposing a fix.

Keep the user's requested scope. Do not turn an audit into a migration or a release preparation into publication without authorization.

## Create a repository

1. Confirm whether the product is:
   - one publishable package: use `starters/library`;
   - several packages released together: use `starters/library-monorepo`;
   - a deployed product with no npm package: use `starters/app`.
2. Inspect the destination. Stop before overwriting any existing file that the user did not explicitly authorize replacing.
3. Copy the selected starter as ordinary repository-owned files. Do not add a runtime dependency on the handbook repository or a central release service.
4. Replace every starter placeholder from an explicit inventory. Search again for unresolved placeholders, sample domains, sample package names, and sample analytics IDs.
5. Customize product facts only: names, scope, description, package inventory, domain, icon, analytics identifier, supported runtimes, and framework-specific examples. Preserve the starter's operational contract unless a real requirement demands a reviewed change.
6. Initialize the repository and install dependencies through its declared package manager. Respect the dependency quarantine. Never add a broad or silent exception to make setup green.
7. Run the starter's documented verification commands, including `pnpm verify`. Run release certification when the repository publishes packages.
8. Create the GitHub repository and configure safe settings only when the user authorized repository setup. Use current handbook commands or APIs; do not rely on remembered GitHub defaults.
9. Open one issue titled `Launch checklist` that contains only unresolved human gates. Link each item to the relevant handbook procedure.

If none of the three profiles fits, explain the missing requirement before inventing another starter.

## Configure GitHub safely

Read the handbook's GitHub and launch procedures first. Then inspect current state before changing it.

- Prefer narrow `gh api`, `gh repo`, `gh pr`, `gh run`, and environment operations.
- Apply branch or ruleset protection, required checks, minimal workflow permissions, and the protected `npm` environment only as documented by the current handbook.
- Confirm workflow filenames and package inventories from committed files before configuring npm trusted publishers.
- Leave identity-owned or provider-owned controls in the launch issue, including npm browser confirmation, protected deployment approval, organization-level settings, DNS ownership, Vercel ownership, and Plausible account configuration.
- Read back each setting after mutation. Report unverified settings as unverified.

A failed `gh auth status` in a restricted sandbox is not proof that GitHub authentication expired. Retry the read-only check with elevated access and use elevated `gh auth status -h github.com` plus `gh api user` as authoritative. Ask for a login only after an elevated command returns an actual authentication error. Never copy a GitHub token into an environment variable, file, repository, or secret to bypass Keychain access.

## Audit a repository

1. Update remote references and record the checked branch and commit without discarding local work.
2. Inventory public packages, documentation apps, workflow files, release manifests, README files, and canonical domains.
3. Run the repository's own standard checker and normal verification gate. Inspect what each command actually covers before using its success as broad evidence.
4. Compare committed state with the relevant handbook checklists. Inspect live GitHub, npm, Vercel, Plausible, and production-site state when the user requests a complete operational audit and access is available.
5. Classify each item as proven, failed, unverified, or human-only. Give the exact evidence and the smallest corrective action.
6. Separate release blockers from cleanup. Do not equate many commits, deployments, or early patch versions with poor quality.

## Audit or roll out the library fleet

1. Read `fleet/libraries.json` from the current Lupinum OSS checkout. Do not add
   repositories discovered by guessing, and never include customer applications.
2. Run `pnpm fleet:audit`. Treat it as a GitHub read-only audit; inspect failures
   before proposing mutations.
3. For every mapped Vercel project, use the authenticated Vercel connection to
   read the Git repository, Root Directory, source-files setting, production
   branch, build machine selection, and on-demand concurrency. Do not introduce
   a team-wide Vercel token into Lupinum OSS or CI for this audit.
4. Report every control as proven, failed, unverified, or human-only. Secret
   existence is provable; its value, team scope, and expiry are not proved by a
   GitHub secret name.
5. For a rollout, change the handbook and canonical asset first. Run
   `pnpm shared:sync` and `pnpm verify`, then use the canary only when live
   deployment behavior changed.
6. Open one focused pull request per drifting repository. Preserve its local
   build command, package layout, and Vercel ignore boundary. Read back external
   settings after mutation and rerun the audit after merge.

Do not silently rewrite the fleet, require `Vercel Preview`, enable automatic
library branch previews, or apply library settings to customer applications.

## Prepare a release or hotfix

1. Read the local release procedure and current handbook release page.
2. Confirm a clean working tree, protected source branch, intended version, changelog section, dist-tag, package inventory, and trusted-publisher workflow identity.
3. Run the documented release certification. Build each tarball once in the unprivileged certification context.
4. Record the source commit, filenames, package versions, checksums, and CI artifact identity.
5. Publish only the downloaded, verified artifacts through the protected workflow. Do not rebuild in the publish job and do not run package scripts there.
6. Verify registry versions, dist-tags, integrity, provenance when applicable, Git tags, and GitHub releases.
7. Follow the handbook's explicit first-package bootstrap ceremony only when the package does not yet exist and the user authorizes that irreversible publication.

For a normal or recovery release, derive the state from current evidence and
report the handbook's Lazy Maintainer release card. Give exactly one safe next
action. Do not ask the maintainer to provide a version, package list, tag,
dist-tag, or artifact run ID when the retained manifest and trusted CI event can
provide it.

Use `next` for prereleases and `latest` for stable releases unless the repository's current written policy deliberately says otherwise. A hotfix to Lupinum-owned code does not require waiting 24 hours unless it introduces a fresh external dependency.

Never add `NPM_TOKEN`, publish an uncertified local rebuild, silently bypass dependency quarantine, invent a manual tag path, or weaken required checks to make a release pass.

## Diagnose failures

Start from the first actionable failure, not the final cascade.

1. Capture the exact run, job, commit, workflow file, environment, artifact, package version, and error text.
2. Determine whether the failure belongs to repository code, dependency quarantine, CI action resolution, artifact transfer, npm trust identity, registry state, Vercel configuration, analytics integration, or an external outage.
3. Read the matching handbook troubleshooting page and inspect live state where possible.
4. Test the smallest safe hypothesis. Preserve required security gates.
5. After a fix, rerun the narrow failed check and then the repository's normal handoff gate. Use full release certification before publication.
6. Record a reusable new lesson in the handbook only when it changes fleet policy or closes a real documentation gap. Do not add incident trivia to every repository.

For npm OIDC failures, compare the exact package, repository, workflow filename, environment, permission, source branch, and trust record. For Vercel failures, confirm the documented root directory and build contract from committed files rather than assuming every repository has the same source layout.

## Finish with evidence

Report:

- files and external settings changed;
- commands and user stories verified;
- current commit, PR, deployment, artifact, or registry evidence where relevant;
- remaining human gates with exact navigation or commands;
- known limitations and rollback path.

For a package release, use the handbook's Lazy Maintainer state names and
release-card fields. Do not replace missing evidence with a green summary.

Do not claim the repository is standard, secure, deployed, or released when evidence is missing. Leave generated repositories understandable through their own `AGENTS.md` and `MAINTAINING.md` even if this skill and the handbook checkout are unavailable.
