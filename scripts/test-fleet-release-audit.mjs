import { evaluateGitHubSecurity, evaluatePackageProfile, evaluateRegistryPackage, evaluateReleaseIntent, evaluateReleaseWorkflows } from "./fleet-release-policy.mjs";

const action = "0123456789abcdef0123456789abcdef01234567";
const workflow = `
permissions: {}
jobs:
  build:
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@${action}
        with: { persist-credentials: false }
      - uses: actions/upload-artifact@${action}
  publish:
    environment: npm
    permissions: { contents: read, id-token: write }
    steps:
      - uses: actions/download-artifact@${action}
      - run: npm publish package.tgz --provenance
`;
const packages = [{ name: "@lupinum/one", version: "1.0.0" }, { name: "@lupinum/two", version: "1.0.0" }];

const fixed = evaluatePackageProfile("fixed-package-set", packages, [".changeset/config.json"]);
if (fixed.some((check) => check.status !== "PROVEN")) throw new Error("Valid fixed package profile failed.");
if (evaluatePackageProfile("single-package", packages, []).every((check) => check.status !== "FAILED")) throw new Error("Invalid single package profile passed.");
if (evaluateReleaseIntent("fixed-package-set", [".changeset/config.json"], "").status !== "PROVEN") throw new Error("Changeset intent failed.");

const workflows = evaluateReleaseWorkflows([{ path: ".github/workflows/release.yml", source: workflow }], "fixed-package-set");
if (workflows.some((check) => check.status !== "PROVEN")) throw new Error(workflows[0].evidence);
const tokenWorkflow = workflow.replace("permissions: {}", "permissions: {}\nenv:\n  NPM_TOKEN: x");
if (evaluateReleaseWorkflows([{ path: "release.yml", source: tokenWorkflow }], "single-package").every((check) => check.status !== "FAILED")) throw new Error("Credential workflow passed.");

const github = evaluateGitHubSecurity({ defaultBranch: "main", repositorySettings: true, mainSha: "abc", currentMainCi: true, actions: { default_workflow_permissions: "read", can_approve_pull_request_reviews: true }, mainProtected: true, tagsProtected: true, environment: { protected_branches: true, reviewers: 1 }, secretNames: [] }, "fixed-package-set");
if (github.some((check) => check.status === "FAILED")) throw new Error("Valid GitHub security state failed.");

const registry = evaluateRegistryPackage(packages[0], { tags: { latest: "1.0.0", next: "1.1.0-beta.1" }, versions: ["1.0.0", "1.1.0-beta.1"], provenance: { "1.0.0": true, "1.1.0-beta.1": true } }, { "1.0.0": { tag: "v1.0.0", release: "v1.0.0", changelog: "CHANGELOG" }, "1.1.0-beta.1": { tag: "v1.1.0-beta.1", release: "v1.1.0-beta.1", changelog: "CHANGELOG" } });
if (registry.some((check) => check.status !== "PROVEN")) throw new Error("Valid npm release state failed.");
const bootstrap = evaluateRegistryPackage(packages[0], { tags: { latest: "0.1.0-beta.1", next: "0.1.0-beta.1" }, versions: ["0.1.0-beta.1"], provenance: {} }, { "0.1.0-beta.1": { tag: "v0.1.0-beta.1", release: "v0.1.0-beta.1", changelog: "CHANGELOG" } });
if (bootstrap.find((check) => check.id.endsWith(":latest"))?.status !== "PROVEN" || bootstrap.find((check) => check.id.endsWith(":provenance"))?.status !== "HUMAN-ONLY") throw new Error("Bootstrap exception was classified incorrectly.");

console.log("Fleet release audit fixtures passed.");
