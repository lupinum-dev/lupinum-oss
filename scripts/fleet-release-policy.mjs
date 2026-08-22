import { parse } from "yaml";
import { checkWorkflow, containsNpmCredential } from "./workflow-policy.mjs";

const statuses = new Set(["PROVEN", "FAILED", "UNVERIFIED", "HUMAN-ONLY"]);
const result = (status, id, evidence) => {
  if (!statuses.has(status)) throw new Error(`Unknown audit status: ${status}`);
  return { status, id, evidence };
};

export function evaluatePackageProfile(profile, packages, paths) {
  const names = packages.map((pkg) => pkg.name).sort();
  if (profile === "none") {
    return [result(packages.length === 0 ? "PROVEN" : "FAILED", "package-inventory", packages.length === 0 ? "no public npm package" : names.join(", "))];
  }
  if (profile === "single-package") {
    return [result(packages.length === 1 ? "PROVEN" : "FAILED", "package-inventory", names.join(", ") || "no public package")];
  }
  if (profile === "fixed-package-set") {
    const versions = new Set(packages.map((pkg) => pkg.version));
    const pass = packages.length > 1 && versions.size === 1 && paths.includes(".changeset/config.json");
    return [result(pass ? "PROVEN" : "FAILED", "package-inventory", `${names.join(", ") || "no public packages"}; ${versions.size === 1 ? "one version" : "versions differ"}; ${paths.includes(".changeset/config.json") ? "Changesets" : "Changesets missing"}`)];
  }
  const pass = profile === "independent-family" && packages.length > 1;
  return [result(pass ? "PROVEN" : "FAILED", "package-inventory", names.join(", ") || "no public packages")];
}

export function evaluateReleaseIntent(profile, paths, workflowSource) {
  if (profile === "none") return result("PROVEN", "release-intent", "not applicable");
  if (profile === "fixed-package-set") return result(paths.includes(".changeset/config.json") ? "PROVEN" : "FAILED", "release-intent", "reviewed Changesets");
  if (profile === "single-package") return result(/changelogen/iu.test(workflowSource) && paths.some((path) => /CHANGELOG\.md$/iu.test(path)) ? "PROVEN" : "FAILED", "release-intent", "Changelogen and changelog");
  return result(paths.includes("RELEASING.md") && paths.some((path) => /CHANGELOG\.md$/iu.test(path)) ? "PROVEN" : "FAILED", "release-intent", "repository-owned family policy");
}

function permissionsFor(workflow, job) {
  return job.permissions ?? workflow.permissions ?? {};
}

export function evaluateReleaseWorkflows(workflows, profile) {
  if (profile === "none") return [result("PROVEN", "release-workflow", "not applicable")];
  const parsed = [];
  for (const file of workflows) {
    try {
      parsed.push({ ...file, workflow: parse(file.source) });
    } catch (error) {
      return [result("FAILED", "release-workflow", `${file.path}: ${error.message}`)];
    }
  }
  const candidates = parsed.filter(({ source }) => /npm\s+publish\b/u.test(source));
  if (candidates.length !== 1) return [result("FAILED", "release-workflow", `found ${candidates.length} publishing workflows`)];

  const candidate = candidates[0];
  const failures = checkWorkflow(candidate.path, candidate.workflow);
  if (containsNpmCredential(candidate.source)) failures.push(`${candidate.path} contains an npm credential path.`);
  const protectedJobs = Object.entries(candidate.workflow.jobs ?? {}).filter(([, job]) => job.environment === "npm");
  if (protectedJobs.length === 0) failures.push(`${candidate.path} has no npm environment job.`);
  for (const [name, job] of protectedJobs) {
    if (permissionsFor(candidate.workflow, job)["id-token"] !== "write") failures.push(`${candidate.path} job ${name} lacks id-token: write.`);
    const steps = job.steps ?? [];
    if (steps.some((step) => String(step.uses ?? "").startsWith("actions/checkout@"))) failures.push(`${candidate.path} job ${name} checks out repository code.`);
    const commands = steps.map((step) => step.run ?? "").join("\n");
    if (/(?:pnpm|npm|yarn|bun)\s+(?:install|ci|run)|node\s+(?:\.\/)?scripts\//mu.test(commands)) failures.push(`${candidate.path} job ${name} rebuilds or runs repository code.`);
  }
  for (const token of ["actions/upload-artifact@", "actions/download-artifact@", "--provenance"]) {
    if (!candidate.source.includes(token)) failures.push(`${candidate.path} is missing ${token}.`);
  }
  return [result(failures.length ? "FAILED" : "PROVEN", "release-workflow", failures.join(" ") || candidate.path)];
}

export function evaluateGitHubSecurity(state, profile) {
  const checks = [];
  checks.push(result(state.defaultBranch === "main" ? "PROVEN" : "FAILED", "default-branch", state.defaultBranch));
  checks.push(result(state.repositorySettings ? "PROVEN" : "FAILED", "repository-security", state.repositorySettings ? "auto-merge, branch cleanup, Dependabot, secret scanning, and push protection" : "one or more settings disabled"));
  checks.push(result(state.actions.default_workflow_permissions === "read" ? "PROVEN" : "FAILED", "actions-permissions", `default=${state.actions.default_workflow_permissions}`));
  const needsVersionPr = profile === "fixed-package-set";
  checks.push(result(state.actions.can_approve_pull_request_reviews === needsVersionPr ? "PROVEN" : "FAILED", "actions-pr-writes", `enabled=${state.actions.can_approve_pull_request_reviews}; expected=${needsVersionPr}`));
  checks.push(result(state.currentMainCi ? "PROVEN" : "FAILED", "current-main-ci", state.currentMainCi ? state.mainSha : `no successful ci run for ${state.mainSha}`));
  if (profile === "none") return checks;
  checks.push(result(state.mainProtected ? "PROVEN" : "FAILED", "protected-main", state.mainProtected ? "ruleset active" : "no active ruleset"));
  checks.push(result(state.tagsProtected ? "PROVEN" : "FAILED", "protected-release-tags", state.tagsProtected ? "ruleset active" : "no active ruleset"));
  checks.push(result(state.environment?.protected_branches && state.environment.reviewers > 0 ? "PROVEN" : "FAILED", "npm-environment", state.environment ? `${state.environment.reviewers} reviewer(s); protected branches=${state.environment.protected_branches}` : "missing"));
  checks.push(result(state.secretNames.some((name) => /^(?:NPM_TOKEN|NODE_AUTH_TOKEN|NPM_CONFIG_TOKEN)$/u.test(name)) ? "FAILED" : "PROVEN", "npm-token", "repository secret names inspected"));
  checks.push(result("HUMAN-ONLY", "npm-trusted-publisher", "npm publisher settings require an authorized human to inspect"));
  return checks;
}

export function evaluateRegistryPackage(pkg, registry, releaseState) {
  if (!registry) return [result("UNVERIFIED", `npm:${pkg.name}`, "package metadata unavailable")];
  const checks = [];
  const latest = registry.tags.latest;
  const next = registry.tags.next;
  const soleBootstrap = registry.versions.length === 1 && latest === next && /-/u.test(latest ?? "");
  const laterProvenanceProvesPublishingPath = Object.values(registry.provenance).some(Boolean);
  checks.push(result(!latest || !/-/u.test(latest) || soleBootstrap ? "PROVEN" : "FAILED", `npm:${pkg.name}:latest`, soleBootstrap ? `${latest}; sole bootstrap prerelease` : latest ?? "absent"));
  checks.push(result(!next || /-/u.test(next) ? "PROVEN" : "FAILED", `npm:${pkg.name}:next`, next ?? "absent"));
  for (const version of new Set([latest, next].filter(Boolean))) {
    const historicalException = !registry.provenance[version] && (registry.versions.length === 1 || laterProvenanceProvesPublishingPath);
    checks.push(result(registry.provenance[version] ? "PROVEN" : historicalException ? "HUMAN-ONLY" : "FAILED", `npm:${pkg.name}@${version}:provenance`, registry.provenance[version] ? "attestation present" : historicalException ? "immutable historical release; record exception" : "attestation missing"));
    const release = releaseState[version];
    checks.push(result(release?.tag ? "PROVEN" : "FAILED", `npm:${pkg.name}@${version}:tag`, release?.tag ?? "missing"));
    checks.push(result(release?.release ? "PROVEN" : "FAILED", `npm:${pkg.name}@${version}:github-release`, release?.release ?? "missing"));
    checks.push(result(release?.changelog ? "PROVEN" : "FAILED", `npm:${pkg.name}@${version}:changelog`, release?.changelog ?? "missing"));
  }
  return checks;
}
