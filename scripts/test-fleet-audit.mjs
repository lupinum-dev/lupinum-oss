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
