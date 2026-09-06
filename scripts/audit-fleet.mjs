import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseDocument } from "yaml";
import { checkDependencyPolicy } from "../starters/_shared/check-dependency-policy.mjs";

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

// This recognizes source declarations, not arbitrary shell programs or hosted execution.
function scriptGate(scripts, name) {
  const visited = new Set();
  while (!visited.has(name)) {
    visited.add(name);
    const command = scripts?.[name];
    if (!command) return "failed";
    if (name === "check:dependencies") {
      return command === "node scripts/check-dependency-policy.mjs" ? "proven" : "unverified";
    }
    if (typeof command !== "string" || !/^[\w./:@ -]+(?: && [\w./:@ -]+)*$/u.test(command)) return "unverified";
    const invocation = /^pnpm (run )?([A-Za-z0-9_][\w.:-]*)$/u.exec(command.split(" && ")[0]);
    if (!invocation) return "unverified";
    // Explicit run avoids pnpm built-in commands shadowing a manifest script.
    // Bare calls retain the existing verify gate and namespaced script convention.
    if (!invocation[1] && invocation[2] !== "verify" && !invocation[2].includes(":")) return "unverified";
    name = invocation[2];
  }
  return "failed";
}

function conditionApplies(condition, event, cron) {
  if (condition === undefined || condition === true) return true;
  if (condition === false) return false;
  if (typeof condition !== "string") return undefined;
  const expression = condition.startsWith("${{") && condition.endsWith("}}") ? condition.slice(3, -2).trim() : condition;
  const match = /^github\.event(_name|\.schedule) (==|!=) '([^']+)'$/u.exec(expression);
  if (!match) return undefined;
  const actual = match[1] === "_name" ? event : cron;
  return match[2] === "==" ? actual === match[3] : actual !== match[3];
}

function supportedEnvironment(environment) {
  if (environment === undefined) return true;
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) return false;
  return Object.entries(environment).every(([name, value]) => name === "NODE_OPTIONS"
    && typeof value === "string" && /^--max-old-space-size=[1-9]\d*$/u.test(value));
}

function workflowGate(workflow, event, cron, scripts, defaultBranch) {
  if (typeof workflow.on !== "object" || workflow.on === null) return "unverified";
  const trigger = Array.isArray(workflow.on)
    ? (workflow.on.includes(event) ? null : undefined)
    : workflow.on?.[event];
  if (trigger === undefined) return "failed";
  if (event !== "schedule" && trigger !== null
    && !(event === "push" && JSON.stringify(trigger) === JSON.stringify({ branches: [defaultBranch] }))) return "unverified";
  let uncertain = false;
  for (const job of Object.values(workflow.jobs ?? {})) {
    if (!job || typeof job !== "object" || (job.steps !== undefined && !Array.isArray(job.steps))) { uncertain = true; continue; }
    const jobApplies = conditionApplies(job.if, event, cron);
    if (jobApplies === false) continue;
    if (job.uses || jobApplies === undefined || job.needs || job.strategy
      || job["continue-on-error"] || job.defaults || workflow.defaults) {
      uncertain = true;
      continue;
    }
    for (const step of job.steps ?? []) {
      if (!step || typeof step !== "object") { uncertain = true; continue; }
      const applies = conditionApplies(step.if, event, cron);
      if (applies === false) continue;
      const invocation = /^pnpm (?:run )?(check:dependencies|verify|release:verify)$/u.exec(step.run ?? "");
      if (!invocation) {
        // Unknown wrappers may invoke the policy. Do not infer their behavior from text.
        if (step.run && !/^(?:corepack enable|pnpm install(?: --[\w-]+)*|pnpm (?:test|audit:all))$/u.test(step.run)) uncertain = true;
        continue;
      }
      if (applies === undefined || step["continue-on-error"] || step["working-directory"]
        || step.shell || ![step.env, job.env, workflow.env].every(supportedEnvironment)) {
        uncertain = true;
        continue;
      }
      const status = scriptGate(scripts, invocation[1]);
      if (status === "proven") return "proven";
      if (status === "unverified") uncertain = true;
    }
  }
  return uncertain ? "unverified" : "failed";
}

export function evaluateDependencyPolicyState(state, canonicalChecker, now = Date.now()) {
  const checks = [];
  const add = (id, status, evidence) => checks.push({ id: `dependency-${id}`, status, evidence });
  const source = (path, id) => {
    const file = state.files[path];
    if (!file) add(id, "failed", `${path} is missing at ${state.sha}`);
    else if (file.error) add(id, "unverified", `${path}: ${file.error}`);
    return file?.source;
  };
  const checker = source("scripts/check-dependency-policy.mjs", "checker");
  if (checker !== undefined) add("checker", checker === canonicalChecker ? "proven" : "failed",
    checker === canonicalChecker ? "exact canonical checker bytes" : "checker differs from the canonical shared source");
  const workspace = source("pnpm-workspace.yaml", "configuration");
  if (workspace !== undefined) {
    const failures = checkDependencyPolicy(workspace, now);
    add("configuration", failures.length ? "failed" : "proven", failures.join("; ") || "root workspace YAML passes the canonical validator at audit time");
  }
  let scripts;
  const manifest = source("package.json", "local-wiring");
  if (manifest !== undefined) {
    try {
      scripts = JSON.parse(manifest).scripts;
      const checkerGate = scriptGate(scripts, "check:dependencies");
      const verifyGate = scriptGate(scripts, "verify");
      const status = [checkerGate, verifyGate].includes("failed") ? "failed"
        : [checkerGate, verifyGate].includes("unverified") ? "unverified" : "proven";
      add("local-wiring", status, `root command declarations: check:dependencies ${checkerGate}; verify ${verifyGate}`);
    } catch (error) { add("local-wiring", "failed", `invalid package.json: ${error.message}`); }
  }
  const workflows = [];
  let unavailableWorkflow = false;
  for (const [path, file] of Object.entries(state.files).filter(([path]) => /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(path))) {
    if (file.error) { unavailableWorkflow = true; continue; }
    const document = parseDocument(file.source);
    if (document.errors.length) {
      add("workflow-yaml", "failed", `${path}: ${document.errors.map((error) => error.message).join("; ")}`);
      unavailableWorkflow = true;
      continue;
    }
    try { workflows.push({ path, workflow: document.toJS() }); }
    catch { unavailableWorkflow = true; }
  }
  for (const event of ["pull_request", "push", "schedule"]) {
    const statuses = [];
    for (const { workflow } of workflows) {
      if (!workflow || typeof workflow !== "object") { statuses.push("unverified"); continue; }
      if (event !== "schedule") {
        statuses.push(workflowGate(workflow, event, undefined, scripts, state.defaultBranch));
        continue;
      }
      const schedules = workflow.on?.schedule;
      if (schedules === undefined) continue;
      if (!Array.isArray(schedules)) { statuses.push("unverified"); continue; }
      for (const schedule of schedules) {
        const cron = schedule?.cron;
        // A single fixed time every day is the supported daily schedule contract.
        if (typeof cron !== "string" || !/^(?:[0-5]?\d) (?:[01]?\d|2[0-3]) \* \* \*$/u.test(cron)) {
          statuses.push("unverified");
          continue;
        }
        statuses.push(workflowGate(workflow, event, cron, scripts, state.defaultBranch));
      }
    }
    const status = statuses.includes("proven") ? "proven"
      : unavailableWorkflow || statuses.includes("unverified") || manifest === undefined ? "unverified" : "failed";
    add(`${event}-wiring`, status, `${event === "schedule" ? "daily schedule" : event}: supported parsed source wiring only; hosted execution and generated installs are not assessed`);
  }
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

function readRemoteState(repository, metadata, sha) {
  const ref = encodeURIComponent(sha);
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

function readDependencySources(repository, metadata, sha) {
  const tree = ghJson(`repos/${repository}/git/trees/${sha}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error("Repository tree is incomplete.");
  const paths = tree.tree.filter((item) => item.type === "blob" && (
    ["scripts/check-dependency-policy.mjs", "pnpm-workspace.yaml", "package.json"].includes(item.path)
    || /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(item.path)
  )).map((item) => item.path);
  const files = Object.fromEntries(paths.map((path) => {
    try { return [path, { source: ghRaw(`repos/${repository}/contents/${path}?ref=${sha}`) }]; }
    catch (error) { return [path, { error: error.message }]; }
  }));
  return { sha, defaultBranch: metadata.default_branch, files };
}

async function main() {
  const fleet = JSON.parse(await readFile(new URL("fleet/libraries.json", root), "utf8"));
  const fleetFailures = validateFleet(fleet);
  if (fleetFailures.length) {
    console.error(fleetFailures.map((failure) => `- ${failure}`).join("\n"));
    process.exit(1);
  }

  const canonicalWorkflow = await readFile(new URL("starters/_shared/vercel-preview.yml", root), "utf8");
  const canonicalChecker = await readFile(new URL("starters/_shared/check-dependency-policy.mjs", root), "utf8");
  const now = Date.now();
  let failed = false;
  for (const entry of fleet.repositories) {
    console.log(`\n${entry.repository} (${entry.vercelProject})`);
    try {
      const metadata = ghJson(`repos/${entry.repository}`);
      const sha = ghJson(`repos/${entry.repository}/commits/${encodeURIComponent(metadata.default_branch)}`).sha;
      if (!/^[0-9a-f]{40}$/u.test(sha ?? "")) throw new Error("Default branch did not resolve to an immutable commit SHA.");
      console.log(`- SOURCE ${sha}`);
      const checks = [];
      try {
        checks.push(...evaluateDependencyPolicyState(readDependencySources(entry.repository, metadata, sha), canonicalChecker, now));
      } catch (error) {
        checks.push({ id: "dependency-source", status: "unverified", evidence: error.message });
      }
      try {
        checks.push(...evaluateRepositoryState(readRemoteState(entry.repository, metadata, sha), canonicalWorkflow));
      } catch (error) {
        checks.push({ id: "github-state", status: "unverified", evidence: error.message });
      }
      for (const check of checks) {
        if (check.status !== "proven") failed = true;
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
