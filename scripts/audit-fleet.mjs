import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = new URL("../", import.meta.url);
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const vercelProjectPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const policy = "library-docs-on-demand";
const releaseProfiles = new Set(["none", "single-package", "fixed-package-set", "independent-family"]);

function globPattern(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replace(/\*\*/gu, "\u0000")
    .replace(/\*/gu, "[^/]*")
    .replace(/\?/gu, "[^/]")
    .replace(/\u0000/gu, ".*");
  return new RegExp(`^${escaped}$`, "u");
}

function patternMatchesRef(pattern, ref, defaultBranch) {
  if (pattern === "~ALL") return true;
  if (pattern === "~DEFAULT_BRANCH") return ref === `refs/heads/${defaultBranch}`;
  const candidate = pattern.startsWith("refs/") ? ref : ref.replace(/^refs\/(?:heads|tags)\//u, "");
  return globPattern(pattern).test(candidate);
}

export function rulesetTargetsRef(ruleset, ref, defaultBranch) {
  if (ruleset.enforcement !== "active") return false;
  const condition = ruleset.conditions?.ref_name;
  const include = condition?.include ?? [];
  const exclude = condition?.exclude ?? [];
  return include.some((pattern) => patternMatchesRef(pattern, ref, defaultBranch))
    && !exclude.some((pattern) => patternMatchesRef(pattern, ref, defaultBranch));
}

export function rulesetsForRef(rulesets, ref, defaultBranch) {
  return rulesets.filter((ruleset) => rulesetTargetsRef(ruleset, ref, defaultBranch));
}

export function requiredContextsFromRulesets(rulesets, defaultBranch) {
  const contexts = [];
  for (const ruleset of rulesetsForRef(rulesets, `refs/heads/${defaultBranch}`, defaultBranch)) {
    for (const rule of ruleset.rules ?? []) {
      if (rule.type !== "required_status_checks") continue;
      for (const required of rule.parameters?.required_status_checks ?? []) {
        if (required.context) contexts.push(required.context);
      }
    }
  }
  return [...new Set(contexts)].sort();
}

export function validateFleet(fleet) {
  const failures = [];
  if (fleet.version !== 2) failures.push("Fleet version must be 2.");
  if (typeof fleet.releaseHistoryCutoff !== "string" || !Number.isFinite(Date.parse(fleet.releaseHistoryCutoff))) {
    failures.push("Fleet release history cutoff must be an ISO date-time.");
  }
  if (!Array.isArray(fleet.repositories) || fleet.repositories.length === 0) {
    failures.push("Fleet must contain at least one repository.");
    return failures;
  }

  const repositories = new Set();
  const projects = new Set();
  let canaries = 0;
  for (const entry of fleet.repositories) {
    if (!repositoryPattern.test(entry.repository ?? "")) {
      failures.push(`Invalid repository: ${entry.repository ?? "missing"}`);
    }
    if (!vercelProjectPattern.test(entry.vercelProject ?? "")) {
      failures.push(`Invalid Vercel project for ${entry.repository ?? "unknown"}.`);
    }
    if (entry.policy !== policy) failures.push(`${entry.repository ?? "Unknown repository"} uses an unsupported policy.`);
    if (!releaseProfiles.has(entry.releaseProfile)) failures.push(`${entry.repository ?? "Unknown repository"} has an unsupported release profile.`);
    if (repositories.has(entry.repository)) failures.push(`Duplicate repository: ${entry.repository}`);
    if (projects.has(entry.vercelProject)) failures.push(`Duplicate Vercel project: ${entry.vercelProject}`);
    repositories.add(entry.repository);
    projects.add(entry.vercelProject);
    if (entry.canary === true) canaries += 1;
  }
  if (canaries !== 1) failures.push("The library deployment policy must have exactly one canary.");
  return failures;
}

export function evaluateRepositoryState(state, canonicalWorkflow) {
  const checks = [];
  const check = (id, pass, evidence) => checks.push({ id, status: pass ? "proven" : "failed", evidence });

  check("default-branch", state.defaultBranch === "main", `default branch: ${state.defaultBranch}`);
  check(
    "preview-workflow",
    state.workflow === canonicalWorkflow,
    state.workflow === canonicalWorkflow ? "exact canonical workflow" : "workflow differs from canonical source",
  );
  check(
    "git-deployments",
    state.vercel?.git?.deploymentEnabled?.["**"] === false
      && state.vercel.git.deploymentEnabled.main === true
      && Object.keys(state.vercel.git.deploymentEnabled).length === 2,
    `deploymentEnabled: ${JSON.stringify(state.vercel?.git?.deploymentEnabled ?? "missing")}`,
  );
  check(
    "ignore-command",
    state.vercel?.ignoreCommand === "node scripts/vercel-ignore.mjs",
    `ignore command: ${state.vercel?.ignoreCommand ?? "missing"}`,
  );
  check("vercel-token", state.secretNames.includes("VERCEL_TOKEN"), "VERCEL_TOKEN secret name");
  for (const name of ["VERCEL_ORG_ID", "VERCEL_PROJECT_ID"]) {
    check(`variable-${name.toLowerCase()}`, state.variableNames.includes(name), `${name} variable name`);
  }
  const requiredVercel = state.requiredContexts.filter((context) => /^vercel(?:\b|$)/iu.test(context));
  check(
    "optional-preview",
    requiredVercel.length === 0,
    requiredVercel.length ? `required Vercel contexts: ${requiredVercel.join(", ")}` : "no required Vercel context",
  );
  return checks;
}

function ghApi(arguments_) {
  const result = spawnSync("gh", ["api", ...arguments_], { encoding: "utf8" });
  if (result.status !== 0) {
    const error = new Error((result.stderr || result.stdout).trim() || "GitHub API request failed.");
    error.exitCode = result.status;
    throw error;
  }
  return result.stdout;
}

function ghJson(path) {
  return JSON.parse(ghApi([path]));
}

function ghRaw(path) {
  return ghApi(["-H", "Accept: application/vnd.github.raw+json", path]);
}

function repositoryRulesets(repository) {
  const summaries = ghJson(`repos/${repository}/rulesets?per_page=100`);
  return summaries.map((summary) => ghJson(`repos/${repository}/rulesets/${summary.id}`));
}

function readRemoteState(repository) {
  const metadata = ghJson(`repos/${repository}`);
  const ref = encodeURIComponent(metadata.default_branch);
  const workflow = ghRaw(`repos/${repository}/contents/.github/workflows/vercel-preview.yml?ref=${ref}`);
  const vercel = JSON.parse(ghRaw(`repos/${repository}/contents/docs/vercel.json?ref=${ref}`));
  const secrets = ghJson(`repos/${repository}/actions/secrets?per_page=100`);
  const variables = ghJson(`repos/${repository}/actions/variables?per_page=100`);
  const rulesets = repositoryRulesets(repository);
  return {
    defaultBranch: metadata.default_branch,
    workflow,
    vercel,
    secretNames: (secrets.secrets ?? []).map((secret) => secret.name),
    variableNames: (variables.variables ?? []).map((variable) => variable.name),
    requiredContexts: requiredContextsFromRulesets(rulesets, metadata.default_branch),
  };
}

async function main() {
  const fleet = JSON.parse(await readFile(new URL("fleet/libraries.json", root), "utf8"));
  const fleetFailures = validateFleet(fleet);
  if (fleetFailures.length) {
    console.error(fleetFailures.map((failure) => `- ${failure}`).join("\n"));
    process.exit(1);
  }

  const canonicalWorkflow = await readFile(new URL("starters/_shared/vercel-preview.yml", root), "utf8");
  let failed = false;
  for (const entry of fleet.repositories) {
    console.log(`\n${entry.repository} (${entry.vercelProject})`);
    try {
      const checks = evaluateRepositoryState(readRemoteState(entry.repository), canonicalWorkflow);
      for (const check of checks) {
        if (check.status === "failed") failed = true;
        console.log(`- ${check.status.toUpperCase()} ${check.id}: ${check.evidence}`);
      }
    } catch (error) {
      failed = true;
      console.log(`- UNVERIFIED github-state: ${error.message}`);
    }
    console.log("- UNVERIFIED vercel-project: inspect through the authenticated Vercel connection");
  }

  if (failed) process.exitCode = 1;
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) await main();
