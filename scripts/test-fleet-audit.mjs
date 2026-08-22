import { readFile } from "node:fs/promises";
import { evaluateRepositoryState, validateFleet } from "./audit-fleet.mjs";

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
