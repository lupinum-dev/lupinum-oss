import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { evaluateRepositoryState, requiredContextsFromRulesets, rulesetTargetsRef, validateFleet } from "./audit-fleet.mjs";

const fleet = JSON.parse(await readFile(new URL("../fleet/libraries.json", import.meta.url), "utf8"));
const fleetFailures = validateFleet(fleet);
if (fleetFailures.length) throw new Error(fleetFailures.join("\n"));

const invalidFleetFailures = validateFleet({
  version: 2,
  repositories: [fleet.repositories[0], fleet.repositories[0]],
});
if (!invalidFleetFailures.some((failure) => failure.startsWith("Duplicate repository:"))) {
  throw new Error("Duplicate fleet repositories were not rejected.");
}
if (!invalidFleetFailures.includes("The library deployment policy must have exactly one canary.")) {
  throw new Error("Multiple fleet canaries were not rejected.");
}

const activeMain = {
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "CI gate" }] } }],
};
const activeTags = {
  enforcement: "active",
  conditions: { ref_name: { include: ["refs/tags/*"], exclude: [] } },
  rules: [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "Tag check" }] } }],
};
const inactiveMain = {
  ...activeMain,
  enforcement: "disabled",
  rules: [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "Disabled check" }] } }],
};
assert.equal(rulesetTargetsRef(activeMain, "refs/heads/main", "main"), true);
assert.equal(rulesetTargetsRef(activeMain, "refs/heads/feature", "main"), false);
assert.equal(rulesetTargetsRef(activeTags, "refs/tags/v1.0.0", "main"), true);
assert.deepEqual(requiredContextsFromRulesets([activeMain, activeTags, inactiveMain], "main"), ["CI gate"]);

const canonicalWorkflow = "canonical workflow\n";
const validState = {
  defaultBranch: "main",
  workflow: canonicalWorkflow,
  vercel: {
    git: { deploymentEnabled: { "**": false, main: true } },
    ignoreCommand: "node scripts/vercel-ignore.mjs",
  },
  secretNames: ["VERCEL_TOKEN"],
  variableNames: ["VERCEL_ORG_ID", "VERCEL_PROJECT_ID"],
  requiredContexts: ["CI gate", "CodeQL"],
};
const validChecks = evaluateRepositoryState(validState, canonicalWorkflow);
if (validChecks.some((check) => check.status !== "proven")) {
  throw new Error("Valid fleet state did not pass every policy check.");
}

const invalidState = {
  ...validState,
  defaultBranch: "develop",
  workflow: "drifted\n",
  vercel: { git: { deploymentEnabled: true } },
  secretNames: [],
  variableNames: [],
  requiredContexts: ["Vercel Preview"],
};
const invalidChecks = evaluateRepositoryState(invalidState, canonicalWorkflow);
const expectedFailures = new Set([
  "default-branch",
  "preview-workflow",
  "git-deployments",
  "ignore-command",
  "vercel-token",
  "variable-vercel_org_id",
  "variable-vercel_project_id",
  "optional-preview",
]);
for (const check of invalidChecks) {
  if (expectedFailures.has(check.id) !== (check.status === "failed")) {
    throw new Error(`Unexpected result for ${check.id}: ${check.status}`);
  }
}

console.log("Fleet deployment audit policy passed.");

const { evaluateDependencyPolicyState } = await import("./audit-fleet.mjs");
const checkerSource = await readFile(new URL("../starters/_shared/check-dependency-policy.mjs", import.meta.url), "utf8");
const policySource = "minimumReleaseAge: 1440\nminimumReleaseAgeStrict: true\nminimumReleaseAgeIgnoreMissingTime: false\n";
const manifestSource = JSON.stringify({ scripts: {
  "check:dependencies": "node scripts/check-dependency-policy.mjs",
  verify: "pnpm check:dependencies && pnpm test",
  "release:verify": "pnpm verify && pnpm build",
} });
const workflowSource = `on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: '23 4 * * *'
jobs:
  verify:
    steps:
      - if: github.event.schedule == '23 4 * * *'
        run: pnpm check:dependencies
      - if: github.event.schedule != '23 4 * * *'
        run: pnpm release:verify
`;
const dependencyState = {
  sha: "a".repeat(40),
  defaultBranch: "main",
  files: {
    "scripts/check-dependency-policy.mjs": { source: checkerSource },
    "pnpm-workspace.yaml": { source: policySource },
    "package.json": { source: manifestSource },
    ".github/workflows/ci.yml": { source: workflowSource },
  },
};
const auditTime = Date.parse("2026-09-06T12:00:00Z");
const dependencyChecks = (state) => evaluateDependencyPolicyState(state, checkerSource, auditTime);
const changedSource = (path, source) => ({
  ...dependencyState, files: { ...dependencyState.files, [path]: { source } },
});
const assertStatus = (state, id, status) => assert.equal(
  dependencyChecks(state).find((check) => check.id === `dependency-${id}`)?.status, status, id,
);
assert.ok(dependencyChecks(dependencyState).every((check) => check.status === "proven"));
assert.ok(dependencyChecks(changedSource(".github/workflows/ci.yml", workflowSource
  .replaceAll("github.event.schedule == '23 4 * * *'", "github.event_name == 'schedule'")
  .replaceAll("github.event.schedule != '23 4 * * *'", "github.event_name != 'schedule'")
  .replace("run: pnpm release:verify", "run: pnpm run release:verify"),
)).every((check) => check.status === "proven"));
const indirectScripts = {
  "check:dependencies": "node scripts/check-dependency-policy.mjs",
  verify: "pnpm verify:core && pnpm test:browser",
  "release:verify": "pnpm verify:core && pnpm build",
  "verify:core": "pnpm run quality && pnpm lint",
  quality: "pnpm run check:dependencies && pnpm test",
};
const indirectState = (changes) => changedSource("package.json", JSON.stringify({
  scripts: { ...indirectScripts, ...changes },
}));
assert.ok(dependencyChecks(indirectState({})).every((check) => check.status === "proven"));
for (const [changes, expected] of [
  [{ "verify:core": "pnpm verify" }, "failed"],
  [{ "verify:core": "pnpm verify:core" }, "failed"],
  [{ "verify:core": undefined }, "failed"],
  [{ quality: "pnpm run missing" }, "failed"],
  [{ quality: "pnpm check:dependencies || true" }, "unverified"],
  [{ quality: "echo check && pnpm check:dependencies" }, "unverified"],
  [{ quality: "node scripts/wrapper.mjs" }, "unverified"],
  [{ quality: "pnpm check:dependencies --ignore-errors" }, "unverified"],
  [{ quality: "pnpm exec", exec: "pnpm check:dependencies" }, "unverified"],
  [{ quality: "pnpm run --help", "--help": "pnpm check:dependencies" }, "unverified"],
  [{ "check:dependencies": "pnpm run another", another: "node scripts/check-dependency-policy.mjs" }, "unverified"],
]) {
  assertStatus(indirectState(changes), "local-wiring", expected);
  assertStatus(indirectState(changes), "push-wiring", expected);
}
// Test the real maintained workflow as well as the deliberately small fixture.
assert.ok(dependencyChecks(changedSource(".github/workflows/ci.yml",
  await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
)).every((check) => check.status === "proven"));
assertStatus(changedSource("scripts/check-dependency-policy.mjs", "throw new Error('remote code must never execute');"), "checker", "failed");
assertStatus(changedSource("pnpm-workspace.yaml", policySource.replace("1440", "0")), "configuration", "failed");
const exception = (expires) => `${policySource}minimumReleaseAgeExclude:\n  - 'foo@1.2.3' # ${JSON.stringify({ owner: "test", reason: "Disposable test", expires })}\n`;
assertStatus(changedSource("pnpm-workspace.yaml", exception("2026-09-06T11:00:00Z")), "configuration", "failed");
assertStatus(changedSource("pnpm-workspace.yaml", exception("2026-09-06T13:00:00Z")), "configuration", "proven");
assertStatus(changedSource("package.json", "{}"), "local-wiring", "failed");
assertStatus(changedSource("package.json", "{"), "local-wiring", "failed");
assertStatus(changedSource("package.json", manifestSource.replace("pnpm check:dependencies && pnpm test", "pnpm check:dependencies || true")), "local-wiring", "unverified");
assertStatus(changedSource("package.json", manifestSource.replace("node scripts/check-dependency-policy.mjs", "echo node scripts/check-dependency-policy.mjs")), "local-wiring", "unverified");
for (const replacement of [
  "# run: pnpm release:verify\n        run: pnpm test",
  "run: echo pnpm release:verify",
  "run: node scripts/wrapper.mjs",
  "run: pnpm release:verify || true",
  "run: pnpm release:verify\n        continue-on-error: true",
  "run: pnpm release:verify\n        working-directory: docs",
  "run: pnpm release:verify\n        shell: python",
]) {
  const state = changedSource(".github/workflows/ci.yml", workflowSource.replace("run: pnpm release:verify", replacement));
  assert.notEqual(dependencyChecks(state).find((check) => check.id === "dependency-push-wiring").status, "proven", replacement);
}
for (const options of [
  "--max-old-space-size=4096", "--require=./bypass.mjs", "--import=./bypass.mjs",
  "--loader=./loader.mjs", "--max-old-space-size=4096 --require=./bypass.mjs",
  "--max-old-space-size=0", "${{ vars.NODE_OPTIONS }}",
]) {
  const source = workflowSource.replace("run: pnpm release:verify",
    `run: pnpm run release:verify\n        env:\n          NODE_OPTIONS: '${options}'`);
  assertStatus(changedSource(".github/workflows/ci.yml", source), "push-wiring",
    options === "--max-old-space-size=4096" ? "proven" : "unverified");
}
assertStatus(changedSource(".github/workflows/ci.yml", workflowSource.replace("    steps:",
  "    env:\n      npm_config_minimum_release_age: '0'\n    steps:")), "push-wiring", "unverified");
for (const condition of ["false", "needs.classify.outputs.full == 'true'", "${{ github.event_name == 'push'"]) {
  const state = changedSource(".github/workflows/ci.yml", workflowSource.replace("github.event.schedule != '23 4 * * *'", condition));
  assertStatus(state, "push-wiring", condition === "false" ? "failed" : "unverified");
}
assertStatus(changedSource(".github/workflows/ci.yml", workflowSource.replace("  schedule:\n    - cron: '23 4 * * *'\n", "")), "schedule-wiring", "failed");
assertStatus(changedSource(".github/workflows/ci.yml", workflowSource.replace("run: pnpm check:dependencies", "run: pnpm test")), "schedule-wiring", "failed");
assertStatus(changedSource(".github/workflows/ci.yml", workflowSource.replace("- cron: '23 4 * * *'", "- cron: '23 4 * * 1'")), "schedule-wiring", "unverified");
assertStatus(changedSource(".github/workflows/ci.yml", workflowSource.replace("branches: [main]", "paths: ['docs/**']")), "push-wiring", "unverified");
assertStatus(changedSource(".github/workflows/ci.yml", workflowSource.replace("    steps:", "    needs: setup\n    steps:")), "push-wiring", "unverified");
assertStatus(changedSource(".github/workflows/ci.yml", workflowSource.replace("    steps:", "    uses: ./.github/workflows/reusable.yml\n    steps:")), "push-wiring", "unverified");
const missingChecker = structuredClone(dependencyState);
delete missingChecker.files["scripts/check-dependency-policy.mjs"];
assertStatus(missingChecker, "checker", "failed");
const unavailableChecker = structuredClone(dependencyState);
unavailableChecker.files["scripts/check-dependency-policy.mjs"] = { error: "HTTP 403" };
assertStatus(unavailableChecker, "checker", "unverified");
assertStatus(unavailableChecker, "configuration", "proven");
const unavailableWorkflow = structuredClone(dependencyState);
unavailableWorkflow.files[".github/workflows/ci.yml"] = { error: "HTTP 403" };
assertStatus(unavailableWorkflow, "push-wiring", "unverified");
for (const source of ["on: [", "on: {push: null}\njobs: {test: null}", "on: {schedule: [null]}"]) {
  assert.ok(dependencyChecks(changedSource(".github/workflows/ci.yml", source)).some((check) => check.status !== "proven"));
}
console.log("Fleet dependency source audit positive, negative, and unsupported-wiring fixtures passed.");
