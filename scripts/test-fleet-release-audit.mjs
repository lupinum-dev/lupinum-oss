import assert from "node:assert/strict";
import {
  auditExitCode,
  deriveReleaseCard,
  evaluateGitHubSecurity,
  evaluatePackageProfile,
  evaluateRegistryPackage,
  evaluateReleaseIntent,
  evaluateReleaseWorkflows,
  expectedTags,
  formatReleaseCard,
} from "./fleet-release-policy.mjs";
import { changelogForPackage, evaluateVerifiedProvenanceStatement, headingContainsVersion, verifyProvenanceDocument } from "./audit-fleet-release.mjs";

const action = "0123456789abcdef0123456789abcdef01234567";
const packages = [{ name: "@lupinum/one", version: "1.0.0" }, { name: "@lupinum/two", version: "1.0.0" }];
const provenanceSha = "abcdef0123456789abcdef0123456789abcdef01";
const provenanceIntegrity = `sha512-${Buffer.from("ab".repeat(64), "hex").toString("base64")}`;
const provenanceStatement = {
  predicateType: "https://slsa.dev/provenance/v1",
  subject: [{ name: "pkg:npm/%40lupinum/one@1.0.0", digest: { sha512: "ab".repeat(64) } }],
  predicate: {
    buildDefinition: {
      externalParameters: { workflow: { repository: "https://github.com/lupinum-dev/one", ref: "refs/heads/main", path: ".github/workflows/publish.yml" } },
      resolvedDependencies: [{ uri: "git+https://github.com/lupinum-dev/one@refs/heads/main", digest: { gitCommit: provenanceSha } }],
    },
  },
};
const provenanceDocument = {
  attestations: [{
    predicateType: "https://slsa.dev/provenance/v1",
    signedAccessSignatureUrl: "",
    bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(provenanceStatement)).toString("base64") } },
  }],
};
assert.deepEqual(
  evaluateVerifiedProvenanceStatement(provenanceStatement, { name: "@lupinum/one", repository: "lupinum-dev/one" }, "1.0.0", provenanceIntegrity, ".github/workflows/publish.yml"),
  {
    present: true,
    verified: true,
    sourceCommit: provenanceSha,
    workflowPath: ".github/workflows/publish.yml",
    evidence: `.github/workflows/publish.yml at ${provenanceSha}`,
  },
  "A cryptographically verified SLSA statement must bind the expected package bytes and source.",
);
assert.equal(
  (await verifyProvenanceDocument(provenanceDocument, { name: "@lupinum/one", repository: "lupinum-dev/one" }, "1.0.0", provenanceIntegrity, ".github/workflows/publish.yml")).verified,
  false,
  "A syntactically valid but unsigned SLSA payload must not be accepted.",
);
let observedSigstoreOptions;
const injectedVerification = await verifyProvenanceDocument(
  provenanceDocument,
  { name: "@lupinum/one", repository: "lupinum-dev/one" },
  "1.0.0",
  provenanceIntegrity,
  ".github/workflows/publish.yml",
  async (_bundle, options) => { observedSigstoreOptions = options },
);
assert.equal(injectedVerification.verified, true);
assert.equal(observedSigstoreOptions.certificateIssuer, "https://token.actions.githubusercontent.com");
assert.match("https://github.com/lupinum-dev/one/.github/workflows/publish.yml@refs/heads/main", new RegExp(observedSigstoreOptions.certificateIdentityURI));
assert.deepEqual(observedSigstoreOptions.certificateOIDs, {
  "1.3.6.1.4.1.57264.1.3": provenanceSha,
  "1.3.6.1.4.1.57264.1.5": "lupinum-dev/one",
  "1.3.6.1.4.1.57264.1.6": "refs/heads/main",
});
const validWorkflow = `
name: Publish
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:
permissions: {}
concurrency:
  group: publish
  cancel-in-progress: false
jobs:
  verify:
    if: github.event_name == 'workflow_dispatch' || (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main')
    permissions: { actions: read, contents: read }
    steps:
      - id: candidate
        uses: actions/github-script@${action}
        with:
          script: |
            if (context.eventName === 'workflow_dispatch') {
              const runs = await github.rest.actions.listWorkflowRuns({ owner: context.repo.owner, repo: context.repo.repo, workflow_id: 'ci.yml', status: 'success', event: 'push', branch: 'main' })
              const candidates = []
              for (const run of runs.data.workflow_runs) {
                const artifacts = await github.rest.actions.listWorkflowRunArtifacts({ owner: context.repo.owner, repo: context.repo.repo, run_id: run.id })
                if (run.conclusion === 'success' && run.event === 'push' && run.head_branch === 'main' && artifacts.data.artifacts.some((artifact) => artifact.name === 'release-candidate' && artifact.expired === false)) candidates.push(run)
              }
              if (candidates.length !== 1) core.setFailed('Expected one retained candidate.')
              core.setOutput('run-id', String(candidates[0].id))
              core.setOutput('sha', candidates[0].head_sha)
            } else {
              core.setOutput('run-id', String(context.payload.workflow_run.id))
              core.setOutput('sha', context.payload.workflow_run.head_sha)
            }
      - uses: actions/download-artifact@${action}
        with: { name: release-candidate, path: candidate, run-id: "\${{ steps.candidate.outputs.run-id }}" }
      - run: sha256sum --check candidate/SHA256SUMS
      - uses: actions/upload-artifact@${action}
        with: { name: verified-release, path: candidate, retention-days: 14 }
  publish:
    needs: verify
    environment: npm
    permissions: { actions: read, contents: read, id-token: write }
    steps:
      - uses: actions/download-artifact@${action}
        with: { name: verified-release, path: candidate }
      - run: npm publish candidate/package.tgz --provenance --ignore-scripts
  github-release:
    needs: publish
    permissions: { actions: read, contents: write }
    steps:
      - uses: actions/download-artifact@${action}
        with: { name: verified-release, path: candidate }
      - run: |
          if gh release view v1.0.0; then
            gh release edit v1.0.0 --notes-file candidate/release-notes.md
          else
            gh release create v1.0.0 --notes-file candidate/release-notes.md
          fi
`;

function check(checks, id) {
  const found = checks.find((item) => item.id === id);
  assert.ok(found, `Missing check ${id}.`);
  return found;
}

function workflowChecks(source) {
  return evaluateReleaseWorkflows([{ path: ".github/workflows/publish.yml", source }], "single-package");
}

for (const fixture of [
  { profile: "none", packages: [], paths: [], status: "PROVEN" },
  { profile: "single-package", packages: [packages[0]], paths: [], status: "PROVEN" },
  { profile: "single-package", packages, paths: [], status: "FAILED" },
  { profile: "fixed-package-set", packages, paths: [".changeset/config.json"], status: "PROVEN" },
  { profile: "fixed-package-set", packages: [{ ...packages[0], version: "1.0.1" }, packages[1]], paths: [".changeset/config.json"], status: "FAILED" },
  {
    profile: "independent-family",
    packages: [
      { name: "@lupinum/better-convex-nuxt", version: "1.0.0" },
      { name: "@lupinum/better-convex-vue", version: "1.0.0" },
      { name: "@lupinum/better-convex-mcp", version: "0.2.0" },
    ],
    paths: [],
    status: "PROVEN",
  },
]) {
  assert.equal(evaluatePackageProfile(fixture.profile, fixture.packages, fixture.paths)[0].status, fixture.status, `${fixture.profile} package profile`);
}

for (const fixture of [
  { profile: "none", paths: [], manifests: [], status: "PROVEN" },
  { profile: "single-package", paths: ["CHANGELOG.md"], manifests: [{ scripts: { "release:prepare": "changelogen --bump" } }], status: "PROVEN" },
  { profile: "single-package", paths: ["CHANGELOG.md"], manifests: [{ scripts: { "release:prepare": "custom" }, devDependencies: { changelogen: "1.0.0" } }], status: "FAILED" },
  { profile: "fixed-package-set", paths: [".changeset/config.json"], manifests: [], status: "PROVEN" },
  { profile: "independent-family", paths: ["RELEASING.md", "CHANGELOG.md"], manifests: [], status: "PROVEN" },
]) {
  assert.equal(evaluateReleaseIntent(fixture.profile, fixture.paths, fixture.manifests).status, fixture.status, `${fixture.profile} release intent`);
}

const validWorkflowChecks = workflowChecks(validWorkflow);
assert.equal(check(validWorkflowChecks, "release-workflow-trigger").status, "UNVERIFIED", "Static trigger structure must not imply a live reconciliation succeeded.");
assert.ok(validWorkflowChecks.filter((item) => item.id !== "release-workflow-trigger").every((item) => item.status === "PROVEN"), "Valid structural workflow failed.");
const workflowMutations = [
  {
    name: "typed release coordinates",
    id: "release-workflow-trigger",
    mutate: (source) => source.replace("  workflow_dispatch:\n", "  workflow_dispatch:\n    inputs:\n      version: { required: true, type: string }\n"),
  },
  {
    name: "untrusted source trigger",
    id: "release-workflow-trigger",
    mutate: (source) => source.replace("workflows: [CI]", "workflows: [Preview]"),
  },
  {
    name: "cancelable publication",
    id: "release-publish-boundary",
    mutate: (source) => source.replace("cancel-in-progress: false", "cancel-in-progress: true"),
  },
  {
    name: "npm credential",
    id: "release-publish-boundary",
    mutate: (source) => source.replace("permissions: {}", "permissions: {}\nenv:\n  NPM_TOKEN: forbidden"),
  },
  {
    name: "missing identity permission",
    id: "release-publish-boundary",
    mutate: (source) => source.replace("id-token: write", "id-token: read"),
  },
  {
    name: "protected checkout",
    id: "release-publish-boundary",
    mutate: (source) => source.replace("    environment: npm\n    permissions: { actions: read, contents: read, id-token: write }\n    steps:\n", `    environment: npm\n    permissions: { actions: read, contents: read, id-token: write }\n    steps:\n      - uses: actions/checkout@${action}\n        with: { persist-credentials: false }\n`),
  },
  {
    name: "protected rebuild",
    id: "release-publish-boundary",
    mutate: (source) => source.replace("      - run: npm publish candidate/package.tgz", "      - run: npm ci && npm publish candidate/package.tgz"),
  },
  {
    name: "missing provenance",
    id: "release-publish-boundary",
    mutate: (source) => source.replace(" --provenance", ""),
  },
  {
    name: "scripts enabled",
    id: "release-publish-boundary",
    mutate: (source) => source.replace(" --ignore-scripts", ""),
  },
  {
    name: "different artifact",
    id: "release-artifact-handoff",
    mutate: (source) => source.replace("name: verified-release, path: candidate, retention-days", "name: different-release, path: candidate, retention-days"),
  },
  {
    name: "different protected path",
    id: "release-artifact-handoff",
    mutate: (source) => source.replace("name: verified-release, path: candidate }", "name: verified-release, path: unrelated }")
  },
  {
    name: "missing digest verification",
    id: "release-artifact-handoff",
    mutate: (source) => source.replace("      - run: sha256sum --check candidate/SHA256SUMS\n", ""),
  },
  {
    name: "fake digest verification",
    id: "release-artifact-handoff",
    mutate: (source) => source.replace("sha256sum --check candidate/SHA256SUMS", "echo digest"),
  },
  {
    name: "candidate mutation after verification",
    id: "release-artifact-handoff",
    mutate: (source) => source.replace("      - run: sha256sum --check candidate/SHA256SUMS\n", "      - run: sha256sum --check candidate/SHA256SUMS\n      - run: echo changed >> candidate/package.tgz\n"),
  },
  {
    name: "missing candidate download",
    id: "release-artifact-handoff",
    mutate: (source) => source.replace(`      - uses: actions/download-artifact@${action}\n        with: { name: release-candidate, path: candidate, run-id: "\${{ steps.candidate.outputs.run-id }}" }\n`, ""),
  },
  {
    name: "attacker-selected candidate",
    id: "release-workflow-trigger",
    mutate: (source) => source.replace("const candidates = []", "const candidates = [{ id: attackerId, head_sha: attackerSha }]")
      .replace("if (run.conclusion === 'success' && run.event === 'push' && run.head_branch === 'main' && artifacts.data.artifacts.some((artifact) => artifact.name === 'release-candidate' && artifact.expired === false)) candidates.push(run)", "void artifacts"),
  },
  {
    name: "create-only public history",
    id: "release-history-reconciliation",
    mutate: (source) => source.replace("gh release view", "gh api").replace("gh release edit", "gh api"),
  },
];
for (const fixture of workflowMutations) {
  assert.equal(check(workflowChecks(fixture.mutate(validWorkflow)), fixture.id).status, "FAILED", fixture.name);
}

const rogueWorkflow = `
name: Rogue
on: workflow_dispatch
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: npm publish package.tgz
`;
assert.equal(
  check(evaluateReleaseWorkflows([
    { path: ".github/workflows/publish.yml", source: validWorkflow },
    { path: ".github/workflows/rogue.yml", source: rogueWorkflow },
  ], "single-package"), "release-publish-boundary").status,
  "FAILED",
  "A second unprotected publisher must fail.",
);
const sameWorkflowRogue = validWorkflow.replace("  github-release:\n", `  rogue-publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm publish /tmp/evil.tgz\n  github-release:\n`);
assert.equal(
  check(workflowChecks(sameWorkflowRogue), "release-publish-boundary").status,
  "FAILED",
  "A sibling publisher in the canonical workflow must be rejected.",
);
const outsideArtifactPublish = validWorkflow.replace("npm publish candidate/package.tgz", "npm publish /tmp/evil.tgz");
assert.equal(
  check(workflowChecks(outsideArtifactPublish), "release-publish-boundary").status,
  "FAILED",
  "The protected job must publish only beneath its retained-artifact path.",
);
assert.equal(
  check(evaluateReleaseWorkflows([
    { path: ".github/workflows/publish.yml", source: validWorkflow },
    { path: ".github/workflows/rogue.yml", source: rogueWorkflow.replace("npm publish", "pnpm publish") },
  ], "single-package"), "release-publish-boundary").status,
  "FAILED",
  "A pnpm publication path must not evade the rogue-workflow scan.",
);

const mainRuleset = {
  bypass_actors: [],
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "required_linear_history" },
    { type: "pull_request", parameters: { required_approving_review_count: 0, required_review_thread_resolution: true, allowed_merge_methods: ["squash"] } },
    { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "CI gate" }, { context: "CodeQL" }] } },
  ],
};
const tagRuleset = { bypass_actors: [], rules: [{ type: "deletion" }, { type: "update" }] };
const githubState = {
  defaultBranch: "main",
  repositorySettings: { "auto-merge": true, "branch-cleanup": true, dependabot: true, "secret-scanning": true, "push-protection": true },
  mainSha: "abc",
  currentMainCi: { url: "https://github.example/runs/1" },
  actions: { default_workflow_permissions: "read", can_approve_pull_request_reviews: false },
  mainRulesets: [mainRuleset],
  tagRulesets: [{ ref: "refs/tags/v0.0.0", rulesets: [tagRuleset] }],
  environment: { mainOnly: true, policy: "branch:main", reviewers: 1, preventSelfReview: false },
  secretNames: [],
};
const validGitHub = evaluateGitHubSecurity(githubState, "single-package");
assert.ok(validGitHub.every((item) => item.status !== "FAILED" && item.status !== "UNVERIFIED"), "Valid GitHub state failed.");
assert.match(check(validGitHub, "npm-environment-review-mode").evidence, /confirmation, not independent review/u);

const securityMutations = [
  { name: "write by default", id: "actions-permissions", mutate: (state) => { state.actions.default_workflow_permissions = "write"; } },
  { name: "single-package PR writes enabled", id: "actions-pr-writes", mutate: (state) => { state.actions.can_approve_pull_request_reviews = true; } },
  { name: "current CI missing", id: "current-main-ci", mutate: (state) => { state.currentMainCi = undefined; } },
  { name: "main deletion allowed", id: "protected-main", mutate: (state) => { state.mainRulesets[0].rules = state.mainRulesets[0].rules.filter((rule) => rule.type !== "deletion"); } },
  { name: "main force push allowed", id: "protected-main", mutate: (state) => { state.mainRulesets[0].rules = state.mainRulesets[0].rules.filter((rule) => rule.type !== "non_fast_forward"); } },
  { name: "merge commits allowed", id: "protected-main", mutate: (state) => { state.mainRulesets[0].rules.find((rule) => rule.type === "pull_request").parameters.allowed_merge_methods.push("merge"); } },
  { name: "review threads optional", id: "protected-main", mutate: (state) => { state.mainRulesets[0].rules.find((rule) => rule.type === "pull_request").parameters.required_review_thread_resolution = false; } },
  { name: "main bypass", id: "protected-main", mutate: (state) => { state.mainRulesets[0].bypass_actors = [{ actor_id: 1 }]; } },
  { name: "non-strict checks", id: "protected-main", mutate: (state) => { state.mainRulesets[0].rules.find((rule) => rule.type === "required_status_checks").parameters.strict_required_status_checks_policy = false; } },
  { name: "tag update allowed", id: "protected-release-tags", mutate: (state) => { state.tagRulesets[0].rulesets[0].rules = [{ type: "deletion" }]; } },
  { name: "environment branch open", id: "npm-environment", mutate: (state) => { state.environment.mainOnly = false; state.environment.policy = "all protected branches"; } },
  { name: "environment reviewer absent", id: "npm-environment", mutate: (state) => { state.environment.reviewers = 0; } },
  { name: "npm token", id: "npm-token", mutate: (state) => { state.secretNames = ["NPM_TOKEN"]; } },
];
for (const fixture of securityMutations) {
  const state = structuredClone(githubState);
  fixture.mutate(state);
  assert.equal(check(evaluateGitHubSecurity(state, "single-package"), fixture.id).status, "FAILED", fixture.name);
}
const unknownReviewMode = structuredClone(githubState);
unknownReviewMode.environment.preventSelfReview = undefined;
assert.equal(check(evaluateGitHubSecurity(unknownReviewMode, "single-package"), "npm-environment-review-mode").status, "UNVERIFIED");
const independentReview = structuredClone(githubState);
independentReview.environment.preventSelfReview = true;
assert.match(check(evaluateGitHubSecurity(independentReview, "single-package"), "npm-environment-review-mode").evidence, /independent reviewer/u);
const fixedPackageWrites = structuredClone(githubState);
fixedPackageWrites.actions.can_approve_pull_request_reviews = true;
assert.equal(check(evaluateGitHubSecurity(fixedPackageWrites, "fixed-package-set"), "actions-pr-writes").status, "PROVEN");

const registry = {
  tags: { latest: "1.0.0", next: "1.1.0-beta.1" },
  versions: ["1.0.0", "1.1.0-beta.1"],
  provenance: {
    "1.0.0": { present: true, verified: true, sourceCommit: "a".repeat(40), evidence: "publish.yml at source" },
    "1.1.0-beta.1": { present: true, verified: true, sourceCommit: "b".repeat(40), evidence: "publish.yml at source" },
  },
  integrity: { "1.0.0": "sha512-stable", "1.1.0-beta.1": "sha512-next" },
  relevantVersions: ["1.0.0", "1.1.0-beta.1"],
  historicalExceptions: [],
};
const publicHistory = {
  "1.0.0": { tag: "v1.0.0", tagTarget: "a".repeat(40), sourceCommit: "a".repeat(40), release: "v1.0.0", prerelease: false, changelog: "CHANGELOG.md", assetName: "lupinum-one-1.0.0.tgz", assetIntegrity: "sha512-stable" },
  "1.1.0-beta.1": { tag: "v1.1.0-beta.1", tagTarget: "b".repeat(40), sourceCommit: "b".repeat(40), release: "v1.1.0-beta.1", prerelease: true, changelog: "CHANGELOG.md", assetName: "lupinum-one-1.1.0-beta.1.tgz", assetIntegrity: "sha512-next" },
};
assert.ok(evaluateRegistryPackage(packages[0], registry, publicHistory).every((item) => item.status === "PROVEN"), "Valid registry history failed.");

const unavailableProvenance = structuredClone(registry);
unavailableProvenance.provenance["1.0.0"] = null;
assert.equal(check(evaluateRegistryPackage(packages[0], unavailableProvenance, publicHistory), "npm:@lupinum/one@1.0.0:provenance").status, "UNVERIFIED");

const staleManifestChannel = structuredClone(registry);
staleManifestChannel.versions.push("1.1.0-beta.2");
assert.equal(
  check(evaluateRegistryPackage({ ...packages[0], version: "1.1.0-beta.2" }, staleManifestChannel, publicHistory), "npm:@lupinum/one@1.1.0-beta.2:manifest-channel").status,
  "FAILED",
);

const sourceBoundRegistry = structuredClone(registry);
sourceBoundRegistry.provenance["1.0.0"] = {
  present: true,
  verified: true,
  sourceCommit: "a".repeat(40),
  evidence: `.github/workflows/publish.yml at ${"a".repeat(40)}`,
};
const unrelatedDependencyStatement = structuredClone(provenanceStatement);
unrelatedDependencyStatement.predicate.buildDefinition.resolvedDependencies.unshift({ uri: "git+https://github.com/attacker/other@refs/heads/main", digest: { gitCommit: "f".repeat(40) } });
assert.equal(
  evaluateVerifiedProvenanceStatement(unrelatedDependencyStatement, { name: "@lupinum/one", repository: "lupinum-dev/one" }, "1.0.0", provenanceIntegrity, ".github/workflows/publish.yml").sourceCommit,
  provenanceSha,
  "The provenance source must come from the expected repository dependency, not an unrelated dependency.",
);
const wrongTargetHistory = structuredClone(publicHistory);
wrongTargetHistory["1.0.0"].sourceCommit = "a".repeat(40);
wrongTargetHistory["1.0.0"].tagTarget = "b".repeat(40);
assert.equal(
  check(evaluateRegistryPackage(packages[0], sourceBoundRegistry, wrongTargetHistory), "npm:@lupinum/one@1.0.0:tag").status,
  "FAILED",
);
const noSourceRegistry = structuredClone(registry);
noSourceRegistry.provenance["1.0.0"] = false;
assert.notEqual(
  check(evaluateRegistryPackage(packages[0], noSourceRegistry, publicHistory), "npm:@lupinum/one@1.0.0:tag").status,
  "PROVEN",
  "A tag without verified source provenance must not be proven.",
);

const wrongAssetHistory = structuredClone(publicHistory);
wrongAssetHistory["1.0.0"].assetIntegrity = "sha512-wrong";
assert.equal(
  check(evaluateRegistryPackage(packages[0], registry, wrongAssetHistory), "npm:@lupinum/one@1.0.0:github-release").status,
  "FAILED",
  "A same-name GitHub Release asset with different bytes must fail.",
);
const unreadableAssetHistory = structuredClone(publicHistory);
unreadableAssetHistory["1.0.0"].assetIntegrity = undefined;
assert.equal(
  check(evaluateRegistryPackage(packages[0], registry, unreadableAssetHistory), "npm:@lupinum/one@1.0.0:github-release").status,
  "UNVERIFIED",
  "An unreadable GitHub Release asset must remain unverified.",
);

const missingHistory = structuredClone(publicHistory);
missingHistory["1.1.0-beta.1"] = {};
for (const suffix of ["tag", "github-release", "changelog"]) {
  assert.equal(check(evaluateRegistryPackage(packages[0], registry, missingHistory), `npm:@lupinum/one@1.1.0-beta.1:${suffix}`).status, "FAILED");
}

const mcp = { name: "@lupinum/better-convex-mcp", version: "0.1.0-beta.2" };
assert.deepEqual(expectedTags("independent-family", mcp, mcp.version), ["mcp-v0.1.0-beta.2"]);
assert.equal(headingContainsVersion("## v0.1.0-beta.2", mcp, mcp.version, "independent-family"), false, "The coupled-family heading must not authorize MCP.");
assert.equal(headingContainsVersion("## mcp-v0.1.0-beta.2", mcp, mcp.version, "independent-family"), true, "MCP requires its exact target heading.");
assert.equal(headingContainsVersion("## 0.4.0-beta.1 - 2026-08-22", { name: "@lupinum/nuxt-pdf" }, "0.4.0-beta.1", "single-package"), true, "A repository-owned dated bare version heading must align with a single-package release.");
assert.equal(headingContainsVersion("## 1.0.0-beta.3", { name: "@lupinum/nuxt-photo" }, "1.0.0-beta.3", "fixed-version-set"), true, "A Changesets package changelog uses a bare version heading.");
assert.equal(headingContainsVersion("## @lupinum/nuxt-photo@1.0.0-beta.3", { name: "@lupinum/nuxt-photo" }, "1.0.0-beta.3", "fixed-version-set"), true, "A package-qualified version heading must align with that package.");
assert.equal(headingContainsVersion("## 1.0.0-beta.30", { name: "@lupinum/nuxt-photo" }, "1.0.0-beta.3", "fixed-version-set"), false, "A longer version must not satisfy the exact heading contract.");
const fixedChangelogs = [
  { path: "packages/nuxt/CHANGELOG.md", source: "## 1.0.0-beta.3" },
  { path: "packages/vue/CHANGELOG.md", source: "## 1.0.0-beta.2" },
];
assert.equal(changelogForPackage(fixedChangelogs, { name: "@lupinum/vue-photo", manifestPath: "packages/vue/package.json" }, "1.0.0-beta.3", "fixed-version-set"), undefined, "A sibling package changelog must not authorize a missing colocated entry.");
assert.equal(changelogForPackage([{ path: "CHANGELOG.md", source: "## v1.0.0-beta.3" }], { name: "@lupinum/vue-board", manifestPath: "packages/vue/package.json" }, "1.0.0-beta.3", "fixed-version-set")?.path, "CHANGELOG.md", "A repository-owned shared changelog remains valid when no colocated changelog exists.");
const mcpRegistry = { tags: { latest: mcp.version, next: mcp.version }, versions: [mcp.version], provenance: {}, integrity: {}, relevantVersions: [], historyCutoff: "2026-08-20T00:00:00.000Z", historicalExceptions: [{ version: mcp.version, publishedAt: "2026-08-19T00:00:00.000Z" }] };
const historicalChecks = evaluateRegistryPackage(mcp, mcpRegistry, {}, "independent-family");
assert.ok(historicalChecks.every((item) => item.status !== "FAILED"), "Explicit pre-contract history was falsely rejected.");
assert.equal(check(historicalChecks, `npm:${mcp.name}@${mcp.version}:historical-exception`).status, "HUMAN-ONLY");

const completeChecks = [{ status: "PROVEN", id: "complete", evidence: "ok" }];
const completeCard = deriveReleaseCard({ repository: "lupinum-dev/one", profile: "single-package", sourceSha: "abc", ciRun: { url: "https://github.example/runs/1" }, packages: [packages[0]], registries: { [packages[0].name]: registry }, checks: completeChecks });
assert.equal(completeCard.state, "COMPLETE");
assert.equal(completeCard.nextAction, "None.");
assert.equal((formatReleaseCard(completeCard).match(/^Next action:$/gmu) ?? []).length, 1, "Release card must contain exactly one next-action field.");

const noReleaseCard = deriveReleaseCard({ repository: "lupinum-dev/handbook", profile: "none", sourceSha: "abc", packages: [], checks: completeChecks });
assert.equal(noReleaseCard.state, "NO RELEASE");
const certifyingCard = deriveReleaseCard({ repository: "lupinum-dev/one", profile: "single-package", sourceSha: "abc", packages: [{ ...packages[0], version: "2.0.0" }], registries: { [packages[0].name]: registry }, checks: completeChecks });
assert.equal(certifyingCard.state, "BLOCKED");
assert.match(certifyingCard.nextAction, /live retained-candidate evidence/u);
const partialCard = deriveReleaseCard({ repository: "lupinum-dev/one", profile: "single-package", sourceSha: "abc", packages: [packages[0]], registries: { [packages[0].name]: registry }, checks: [{ status: "FAILED", id: "npm:@lupinum/one@1.0.0:github-release", evidence: "missing" }] });
assert.equal(partialCard.state, "BLOCKED");
assert.match(partialCard.nextAction, /Resolve/u);
const wrongTargetCard = deriveReleaseCard({ repository: "lupinum-dev/one", profile: "single-package", sourceSha: "abc", packages: [packages[0]], registries: { [packages[0].name]: registry }, checks: evaluateRegistryPackage(packages[0], registry, wrongTargetHistory) });
assert.equal(wrongTargetCard.state, "BLOCKED", "A wrong tag target must never be presented as repairable partial history.");
const missingChangelogHistory = structuredClone(publicHistory);
missingChangelogHistory["1.0.0"].changelog = undefined;
const missingChangelogCard = deriveReleaseCard({ repository: "lupinum-dev/one", profile: "single-package", sourceSha: "abc", packages: [packages[0]], registries: { [packages[0].name]: registry }, checks: evaluateRegistryPackage(packages[0], registry, missingChangelogHistory) });
assert.equal(missingChangelogCard.state, "BLOCKED", "Missing committed release intent must not be offered automatic reconciliation.");
const brokenForwardRegistry = structuredClone(registry);
brokenForwardRegistry.versions.push("1.2.0");
brokenForwardRegistry.relevantVersions.push("1.2.0");
brokenForwardRegistry.provenance["1.2.0"] = false;
brokenForwardRegistry.integrity["1.2.0"] = "sha512-forward";
const brokenForwardCard = deriveReleaseCard({ repository: "lupinum-dev/one", profile: "single-package", sourceSha: "abc", packages: [packages[0]], registries: { [packages[0].name]: brokenForwardRegistry }, checks: evaluateRegistryPackage(packages[0], brokenForwardRegistry, publicHistory) });
assert.equal(brokenForwardCard.state, "BLOCKED", "A broken version after the explicit enforcement cutoff must prevent completion.");
const blockedCard = deriveReleaseCard({ repository: "lupinum-dev/one", profile: "single-package", sourceSha: "abc", packages: [packages[0]], checks: [{ status: "UNVERIFIED", id: "npm:@lupinum/one", evidence: "offline" }] });
assert.equal(blockedCard.state, "BLOCKED");
assert.match(blockedCard.nextAction, /Restore evidence/u);

assert.equal(auditExitCode(completeChecks), 0);
assert.equal(auditExitCode([{ status: "FAILED" }]), 1);
assert.equal(auditExitCode([{ status: "UNVERIFIED" }]), 2);
assert.equal(auditExitCode([{ status: "FAILED" }, { status: "UNVERIFIED" }]), 1);

console.log("Fleet release audit fixtures passed.");
