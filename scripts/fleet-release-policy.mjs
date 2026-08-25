import { parse } from "yaml";
import { checkWorkflow, containsNpmCredential } from "./workflow-policy.mjs";

const statuses = new Set(["PROVEN", "FAILED", "UNVERIFIED", "HUMAN-ONLY"]);
const releaseStates = new Set(["NO RELEASE", "VERSION REVIEW", "CERTIFYING", "AWAITING APPROVAL", "PUBLISHING", "PARTIAL FAILURE", "BLOCKED", "COMPLETE"]);

const result = (status, id, evidence, details = {}) => {
  if (!statuses.has(status)) throw new Error(`Unknown audit status: ${status}`);
  return { status, id, evidence, ...details };
};

const needs = (job) => Array.isArray(job?.needs) ? job.needs : [job?.needs].filter(Boolean);
const environmentName = (job) => typeof job?.environment === "string" ? job.environment : job?.environment?.name;
const permissionsFor = (workflow, job) => job.permissions ?? workflow.permissions ?? {};
const commandsFor = (job) => (job.steps ?? []).map((step) => step.run ?? "").join("\n");
const actionSteps = (job, action) => (job.steps ?? []).filter((step) => String(step.uses ?? "").startsWith(`${action}@`));
const artifactName = (step) => typeof step.with?.name === "string" && step.with.name.trim() ? step.with.name.trim() : undefined;
const isExpression = (value) => typeof value === "string" && value.includes("${{");
const betterConvexPackages = {
  mcp: "@lupinum/better-convex-mcp",
  nuxt: "@lupinum/better-convex-nuxt",
  vue: "@lupinum/better-convex-vue",
};

function ancestors(jobs, name, found = new Set()) {
  for (const parent of needs(jobs[name])) {
    if (found.has(parent) || !jobs[parent]) continue;
    found.add(parent);
    ancestors(jobs, parent, found);
  }
  return found;
}

function descendants(jobs, name) {
  return Object.keys(jobs).filter((candidate) => ancestors(jobs, candidate).has(name));
}

function isPublishCommand(commands) {
  return /(?:^|\s)(?:npm|pnpm)\s+publish\b/mu.test(commands)
    || /(?:^|\s)yarn\s+npm\s+publish\b/mu.test(commands)
    || /["']npm["']\s*,\s*\[\s*["']publish["']/u.test(commands)
    || /\brun\(\s*\[\s*["']publish["']/u.test(commands);
}

function publishesDownloadedArtifact(job) {
  const commands = commandsFor(job);
  const paths = actionSteps(job, "actions/download-artifact").map((step) => step.with?.path).filter((path) => typeof path === "string" && !isExpression(path));
  if (paths.length === 0) return false;
  if (/(?:^|\s)(?:curl|wget)\b|\bfetch\s*\(/mu.test(commands)) return false;
  if (paths.some((path) => mutatesRetainedTarball(job.steps ?? [], path))) return false;
  return paths.some((path) => {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const literalTarget = new RegExp(`(?:npm|pnpm)\\s+publish\\s+["']?${escaped}/`, "u").test(commands)
      || new RegExp(`["']publish["']\\s*,\\s*["']${escaped}/`, "u").test(commands);
    const templateTarget = [...commands.matchAll(/["']publish["']\s*,\s*`([^`]+)`/gu)]
      .some((match) => match[1].startsWith(`${path}/`) && !match[1].includes("../"));
    const boundVariables = [...commands.matchAll(new RegExp(`(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:join|resolve)\\(\\s*["']${escaped}["']`, "gu"))].map((match) => match[1]);
    const boundTarget = boundVariables.some((variable) => new RegExp(`["']publish["']\\s*,\\s*${variable}(?:\\s*[,\\]])`, "u").test(commands));
    return literalTarget || templateTarget || boundTarget;
  });
}

function releaseCoordinateInputs(workflow) {
  const dispatch = workflow.on?.workflow_dispatch;
  return Object.keys(dispatch?.inputs ?? {}).filter((name) =>
    /(?:^|[-_])(?:artifact|channel|dist[-_]?tag|package|run[-_]?id|source[-_]?sha|tag|target|version)(?:$|[-_])/iu.test(name));
}

function trustedCiTrigger(workflow, verifier) {
  const trigger = workflow.on?.workflow_run;
  const workflows = Array.isArray(trigger?.workflows) ? trigger.workflows : [trigger?.workflows].filter(Boolean);
  const types = Array.isArray(trigger?.types) ? trigger.types : [trigger?.types].filter(Boolean);
  const branches = Array.isArray(trigger?.branches) ? trigger.branches : [trigger?.branches].filter(Boolean);
  const guard = String(verifier?.if ?? "");
  const scripts = (verifier?.steps ?? []).map((step) => step.with?.script ?? step.run ?? "").join("\n");
  const eventGuard = /workflow_run\.conclusion\s*==\s*["']success["']/u.test(guard)
    && /workflow_run\.event\s*==\s*["']push["']/u.test(guard)
    && /workflow_run\.head_branch\s*==\s*["']main["']/u.test(guard);
  const runOutputs = scripts.match(/setOutput\(["'](?:run-id|run_id)["']/gu) ?? [];
  const shaOutputs = scripts.match(/setOutput\(["']sha["']/gu) ?? [];
  const dispatchBranch = /context\.eventName\s*===?\s*["']workflow_dispatch["']/u.test(scripts)
    || (/context\.eventName\s*===?\s*["']workflow_run["']/u.test(scripts) && /currentMain\.object\.sha/u.test(scripts));
  const dispatchDiscovery = dispatchBranch
    && /listWorkflowRuns/u.test(scripts)
    && /workflow_id\s*:\s*["'][^"']*ci\.ya?ml["']/iu.test(scripts)
    && (/(?:status|conclusion)\s*[:=]\s*["']success["']/u.test(scripts)
      || (/status\s*:\s*["']completed["']/u.test(scripts) && /\.conclusion\s*===?\s*["']success["']/u.test(scripts)))
    && (/event\s*:\s*["']push["']/u.test(scripts) || /\.event\s*===?\s*["']push["']/u.test(scripts))
    && (/branch\s*:\s*["']main["']/u.test(scripts)
      || /branch\s*:\s*repository\.default_branch/u.test(scripts)
      || /\.head_branch\s*===?\s*(?:["']main["']|repository\.default_branch)/u.test(scripts))
    && /listWorkflowRunArtifacts/u.test(scripts)
    && (/(?:expired\s*===?\s*false|!\s*artifact\.expired)/u.test(scripts))
    && /(?:candidates|incomplete|selected)\.length\s*(?:!==?|>)\s*1/u.test(scripts)
    && /setOutput\(["'](?:run-id|run_id)["']/u.test(scripts)
    && /setOutput\(["']sha["']/u.test(scripts)
    && /workflow_run\??\.(?:id|head_sha)/u.test(scripts)
    && runOutputs.length >= 1
    && shaOutputs.length >= 1;
  return workflows.some((name) => /(?:^|\b)ci(?:\b|$)/iu.test(String(name)))
    && types.includes("completed")
    && (branches.length === 0 || branches.includes("main"))
    && eventGuard
    && dispatchDiscovery;
}

function mutatesRetainedTarball(steps, path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return steps.some((step) => {
    const command = step.run ?? "";
    return new RegExp(`(?:>|>>)\\s*["']?${escaped}/[^\\n]*\\.tgz`, "u").test(command)
      || new RegExp(`(?:writeFile|appendFile|createWriteStream)\\w*\\s*\\([^\\n]*(?:${escaped}/|\\.tgz)`, "u").test(command)
      || /(?:npm|pnpm)\s+pack\b|\btar\s+(?:-[^\n]*c|--create)\b/mu.test(command);
  });
}

function artifactPathIsWithin(uploadPath, rootPath) {
  if (typeof uploadPath !== "string" || typeof rootPath !== "string" || isExpression(uploadPath) || isExpression(rootPath)) return false;
  const root = rootPath.replace(/\/+$/u, "");
  const paths = uploadPath.split("\n").map((path) => path.trim()).filter(Boolean);
  return paths.length > 0 && paths.every((path) => path === root || (path.startsWith(`${root}/`) && !path.includes("../")));
}

function checkPublishBoundary(path, workflow, protectedName) {
  const failures = [];
  const job = workflow.jobs[protectedName];
  const permissions = permissionsFor(workflow, job);
  if (permissions.actions !== "read" || permissions["id-token"] !== "write") {
    failures.push(`${path} job ${protectedName} must grant actions: read and id-token: write.`);
  }
  for (const [scope, level] of Object.entries(permissions)) {
    if (level === "write" && scope !== "id-token") failures.push(`${path} job ${protectedName} grants unexpected ${scope}: write.`);
  }
  const steps = job.steps ?? [];
  if (steps.some((step) => String(step.uses ?? "").startsWith("actions/checkout@"))) {
    failures.push(`${path} job ${protectedName} checks out repository code.`);
  }
  if (actionSteps(job, "actions/upload-artifact").length) {
    failures.push(`${path} job ${protectedName} uploads a replacement artifact.`);
  }
  const commands = commandsFor(job);
  if (/(?:pnpm|npm|yarn|bun)\s+(?:install|ci|run)|node\s+(?:\.\/)?scripts\//mu.test(commands)) {
    failures.push(`${path} job ${protectedName} rebuilds or runs repository code.`);
  }
  if (!isPublishCommand(commands)) failures.push(`${path} job ${protectedName} has no npm publication command.`);
  else if (!publishesDownloadedArtifact(job)) failures.push(`${path} job ${protectedName} is not bound to publishing a tarball under its retained-artifact path.`);
  if (!commands.includes("--provenance")) failures.push(`${path} job ${protectedName} does not require provenance.`);
  if (!commands.includes("--ignore-scripts")) failures.push(`${path} job ${protectedName} does not disable package scripts.`);
  if (actionSteps(job, "actions/download-artifact").length === 0) {
    failures.push(`${path} job ${protectedName} does not download a retained artifact.`);
  }
  return failures;
}

function checkArtifactHandoff(path, workflow, protectedName) {
  const failures = [];
  const jobs = workflow.jobs;
  const protectedDownloads = actionSteps(jobs[protectedName], "actions/download-artifact");
  const protectedNames = protectedDownloads.map(artifactName);
  if (protectedNames.some((name) => !name || isExpression(name))) {
    failures.push(`${path} job ${protectedName} must download explicitly named retained artifacts.`);
    return failures;
  }

  const ancestorNames = ancestors(jobs, protectedName);
  for (const [index, name] of protectedNames.entries()) {
    const protectedPath = protectedDownloads[index].with?.path;
    const verified = [...ancestorNames].some((ancestorName) => {
      const ancestor = jobs[ancestorName];
      if (environmentName(ancestor) === "npm" || permissionsFor(workflow, ancestor)["id-token"] === "write") return false;
      const upload = actionSteps(ancestor, "actions/upload-artifact").find((step) => artifactName(step) === name);
      if (!upload || !artifactPathIsWithin(upload.with?.path, protectedPath)) return false;
      const steps = ancestor.steps ?? [];
      const uploadIndex = steps.indexOf(upload);
      const verificationPattern = /(?:sha256sum\s+(?:--check|-c)|shasum\s+-a\s+256\s+(?:--check|-c)|createHash\(["']sha256["']\)|release:verify|verify-release-artifact|release-artifact[^\n]*(?:verify|check)|\bcmp\s)/iu;
      const verificationIndex = steps.findIndex((step, stepIndex) => stepIndex < uploadIndex
        && verificationPattern.test(`${step.name ?? ""}\n${step.run ?? ""}`));
      if (verificationIndex < 0 || mutatesRetainedTarball(steps.slice(verificationIndex + 1, uploadIndex), protectedPath)) return false;
      const downloads = actionSteps(ancestor, "actions/download-artifact");
      return downloads.some((step) => steps.indexOf(step) < verificationIndex
        && typeof artifactName(step) === "string"
        && !isExpression(artifactName(step))
        && artifactPathIsWithin(upload.with?.path, step.with?.path)
        && typeof step.with?.["run-id"] === "string"
        && /steps\.[^.]+\.outputs\.(?:run-id|run_id)/u.test(step.with["run-id"]));
    });
    if (!verified) failures.push(`${path} cannot bind protected artifact ${name} to an unprivileged ancestor verifier.`);
  }
  return failures;
}

function releaseArtifactHasVerifiedLineage(workflow, protectedName, releaseName, releaseDownload) {
  const jobs = workflow.jobs;
  const releaseArtifact = artifactName(releaseDownload);
  const releasePath = releaseDownload.with?.path;
  if (!releaseArtifact || typeof releasePath !== "string" || isExpression(releasePath)) return false;
  const protectedArtifacts = actionSteps(jobs[protectedName], "actions/download-artifact").map(artifactName).filter(Boolean);
  if (protectedArtifacts.includes(releaseArtifact)) return true;

  return [...ancestors(jobs, releaseName)].some((uploaderName) => {
    if (!ancestors(jobs, uploaderName).has(protectedName)) return false;
    const uploader = jobs[uploaderName];
    if (environmentName(uploader) === "npm" || permissionsFor(workflow, uploader)["id-token"] === "write") return false;
    const steps = uploader.steps ?? [];
    const upload = actionSteps(uploader, "actions/upload-artifact")
      .find((step) => artifactName(step) === releaseArtifact && step.with?.path === releasePath);
    if (!upload) return false;
    const uploadIndex = steps.indexOf(upload);
    const sourceDownload = actionSteps(uploader, "actions/download-artifact")
      .find((step) => protectedArtifacts.includes(artifactName(step)) && step.with?.path === releasePath && steps.indexOf(step) < uploadIndex);
    if (!sourceDownload) return false;
    const sourceIndex = steps.indexOf(sourceDownload);
    const verificationPattern = /(?:cryptographically verify|provenance|reconcile-release|registry[^\n]*(?:verify|verification)|sha(?:1|256|512))/iu;
    const verificationIndex = steps.findIndex((step, index) => index > sourceIndex && index < uploadIndex
      && verificationPattern.test(`${step.name ?? ""}\n${step.run ?? ""}`));
    return verificationIndex >= 0 && !mutatesRetainedTarball(steps.slice(sourceIndex + 1, uploadIndex), releasePath);
  });
}

function checkReleaseReconciliation(path, workflow, protectedName) {
  const failures = [];
  const jobs = workflow.jobs;
  const releaseNames = descendants(jobs, protectedName).filter((name) => permissionsFor(workflow, jobs[name]).contents === "write");
  if (releaseNames.length !== 1) return [`${path} must have one post-publication GitHub Release job.`];

  const releaseName = releaseNames[0];
  const releaseJob = jobs[releaseName];
  const permissions = permissionsFor(workflow, releaseJob);
  if (permissions["id-token"] === "write") failures.push(`${path} job ${releaseName} must not receive npm identity permission.`);
  if (environmentName(releaseJob) === "npm") failures.push(`${path} job ${releaseName} must not use the npm environment.`);
  if (actionSteps(releaseJob, "actions/checkout").length) failures.push(`${path} job ${releaseName} checks out repository code.`);
  const releaseDownloads = actionSteps(releaseJob, "actions/download-artifact");
  if (!releaseDownloads.some((step) => releaseArtifactHasVerifiedLineage(workflow, protectedName, releaseName, step))) {
    failures.push(`${path} job ${releaseName} does not consume the protected artifact or a provenance-verified descendant.`);
  }
  const commands = commandsFor(releaseJob);
  if (/(?:pnpm|npm|yarn|bun)\s+(?:install|ci|run)|node\s+(?:\.\/)?scripts\//mu.test(commands)) {
    failures.push(`${path} job ${releaseName} rebuilds or runs repository code.`);
  }
  if (!/gh\s+release\s+create\b/u.test(commands)) failures.push(`${path} job ${releaseName} cannot create a missing GitHub Release.`);
  if (!/gh\s+release\s+(?:view|edit)\b/u.test(commands)) failures.push(`${path} job ${releaseName} cannot reconcile an existing GitHub Release.`);
  if (!/gh\s+api[\s\S]*--method\s+POST[\s\S]*git\/refs/u.test(commands)) {
    failures.push(`${path} job ${releaseName} cannot create an exact-source lightweight tag before the GitHub Release.`);
  }
  if (!/git\/ref\/tags/u.test(commands) || !/SOURCE_SHA/u.test(commands)) {
    failures.push(`${path} job ${releaseName} does not read the release tag back and bind it to the certified source SHA.`);
  }
  if (!/HUMAN-ONLY/u.test(commands) || !/(?:HTTP\s+403|Resource not accessible by integration)/u.test(commands)) {
    failures.push(`${path} job ${releaseName} does not turn a historical-tag permission failure into one explicit human gate.`);
  }
  return failures;
}

function ruleTypes(rulesets) {
  return new Set(rulesets.flatMap((ruleset) => (ruleset.rules ?? []).map((rule) => rule.type)));
}

function bypassCount(rulesets) {
  return rulesets.reduce((total, ruleset) => total + (ruleset.bypass_actors ?? []).length, 0);
}

function requiredChecks(rulesets) {
  return rulesets.flatMap((ruleset) => ruleset.rules ?? []).filter((rule) => rule.type === "required_status_checks");
}

function expectedTags(profile, pkg, version) {
  if (profile === "independent-family" && /(?:^|-)mcp$/iu.test(pkg.name)) return [`mcp-v${version}`];
  return [`v${version}`];
}

export function deriveReleaseUnits(profile, packages) {
  if (profile !== "independent-family") return [];
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const coupledPackages = [betterConvexPackages.vue, betterConvexPackages.nuxt]
    .map((name) => byName.get(name))
    .filter(Boolean);
  const coupledVersions = new Set(coupledPackages.map((pkg) => pkg.version));
  const mcp = byName.get(betterConvexPackages.mcp);
  return [
    {
      id: "vue-nuxt",
      label: "Vue/Nuxt coupled unit",
      packages: coupledPackages,
      version: coupledVersions.size === 1 ? coupledPackages[0]?.version : undefined,
      tag: coupledVersions.size === 1 ? `v${coupledPackages[0]?.version}` : undefined,
      valid: coupledPackages.length === 2 && coupledVersions.size === 1,
    },
    {
      id: "mcp",
      label: "MCP independent unit",
      packages: mcp ? [mcp] : [],
      version: mcp?.version,
      tag: mcp ? `mcp-v${mcp.version}` : undefined,
      valid: Boolean(mcp),
    },
  ];
}

export function evaluateIndependentReleaseUnits({ packages, registries = {}, checks, intents }) {
  const units = deriveReleaseUnits("independent-family", packages);
  const intentSet = new Set(intents);
  const requiredSuffixes = ["manifest-channel", "provenance", "bytes-source", "tag", "github-release", "changelog"];
  const evaluated = units.map((unit) => {
    const hasIntent = unit.valid && intentSet.has(`${unit.id}@${unit.version}`);
    const complete = unit.valid && unit.packages.every((pkg) => {
      if (!registries[pkg.name]?.versions?.includes(unit.version)) return false;
      return requiredSuffixes.every((suffix) => checks.some((check) => check.id === `npm:${pkg.name}@${unit.version}:${suffix}` && check.status === "PROVEN"));
    });
    return { ...unit, hasIntent, complete, incomplete: hasIntent && !complete };
  });
  const incomplete = evaluated.filter((unit) => unit.incomplete);
  const status = incomplete.length > 1 ? "FAILED" : evaluated.every((unit) => unit.valid) ? "PROVEN" : "FAILED";
  const evidence = incomplete.length > 1
    ? `multiple incomplete release intents: ${incomplete.map((unit) => unit.tag).join(", ")}; finish the earlier unit before merging another intent`
    : incomplete.length === 1
      ? `one incomplete release intent: ${incomplete[0].tag}`
      : "no ambiguous incomplete release intents";
  return {
    units: evaluated,
    check: result(status, "independent-family-intents", evidence, incomplete.length > 1 ? { classification: "ambiguous-intents" } : {}),
  };
}

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
  const expected = [betterConvexPackages.mcp, betterConvexPackages.nuxt, betterConvexPackages.vue];
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const exactFamily = names.length === expected.length && expected.every((name) => byName.has(name));
  const coupled = byName.get(betterConvexPackages.nuxt)?.version
    === byName.get(betterConvexPackages.vue)?.version;
  const pass = profile === "independent-family" && exactFamily && coupled;
  return [
    result(pass ? "PROVEN" : "FAILED", "package-inventory", `${names.join(", ") || "no public packages"}`),
    result(coupled ? "PROVEN" : "FAILED", "release-unit:vue-nuxt", coupled ? `Nuxt and Vue are coupled at ${byName.get(betterConvexPackages.nuxt)?.version}` : "Nuxt and Vue versions differ"),
    result(byName.has(betterConvexPackages.mcp) ? "PROVEN" : "FAILED", "release-unit:mcp", byName.has(betterConvexPackages.mcp) ? `MCP is independently versioned at ${byName.get(betterConvexPackages.mcp).version}` : "MCP package missing"),
  ];
}

export function evaluateReleaseIntent(profile, paths, manifests) {
  if (profile === "none") return result("PROVEN", "release-intent", "not applicable");
  if (profile === "fixed-package-set") return result(paths.includes(".changeset/config.json") ? "PROVEN" : "FAILED", "release-intent", "reviewed Changesets");
  if (profile === "single-package") {
    const command = manifests.map((manifest) => manifest.scripts?.["release:prepare"] ?? "").find((script) => /(?:^|\s)changelogen(?:\s|$)/iu.test(script));
    const changelog = paths.some((path) => /(?:^|\/)CHANGELOG\.md$/iu.test(path));
    return result(command && changelog ? "PROVEN" : "FAILED", "release-intent", command && changelog ? "release:prepare uses Changelogen and a changelog exists" : "missing Changelogen release:prepare command or changelog");
  }
  const pass = paths.includes("RELEASING.md") && paths.some((path) => /(?:^|\/)CHANGELOG\.md$/iu.test(path));
  return result(pass ? "PROVEN" : "FAILED", "release-intent", pass ? "repository-owned family policy" : "missing RELEASING.md or changelog");
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
  const candidates = parsed.filter(({ workflow }) => Object.values(workflow?.jobs ?? {}).some((job) => environmentName(job) === "npm"));
  if (candidates.length !== 1) return [result("FAILED", "release-workflow-count", `found ${candidates.length} workflows with an npm environment job`)];

  const candidate = candidates[0];
  const jobs = candidate.workflow.jobs ?? {};
  const protectedNames = Object.keys(jobs).filter((name) => environmentName(jobs[name]) === "npm");
  const commonFailures = checkWorkflow(candidate.path, candidate.workflow);
  for (const file of parsed) {
    if (containsNpmCredential(file.source)) commonFailures.push(`${file.path} contains an npm credential path.`);
    if (file.path !== candidate.path && Object.values(file.workflow.jobs ?? {}).some((job) => isPublishCommand(commandsFor(job)))) {
      commonFailures.push(`${file.path} contains an unprotected npm publication path.`);
    }
  }
  if (candidate.workflow.concurrency?.["cancel-in-progress"] !== false) commonFailures.push(`${candidate.path} can cancel an active publication.`);

  const dispatchDefined = Object.hasOwn(candidate.workflow.on ?? {}, "workflow_dispatch");
  const inputs = releaseCoordinateInputs(candidate.workflow);
  const triggerFailures = [];
  const verifierNames = protectedNames.length === 1 ? [...ancestors(jobs, protectedNames[0])] : [];
  const verifier = verifierNames.map((name) => jobs[name]).find((job) => actionSteps(job, "actions/upload-artifact").length > 0);
  if (!trustedCiTrigger(candidate.workflow, verifier)) triggerFailures.push(`${candidate.path} does not bind successful push CI and input-free candidate discovery to its verifier.`);
  if (!dispatchDefined || inputs.length) triggerFailures.push(`${candidate.path} reconcile dispatch must be input-free; found ${inputs.join(", ") || "no dispatch"}.`);

  const boundaryFailures = [...commonFailures];
  if (protectedNames.length !== 1) boundaryFailures.push(`${candidate.path} must have exactly one npm environment job; found ${protectedNames.length}.`);
  if (protectedNames.length === 1) {
    boundaryFailures.push(...checkPublishBoundary(candidate.path, candidate.workflow, protectedNames[0]));
    for (const [name, job] of Object.entries(jobs)) {
      if (name !== protectedNames[0] && isPublishCommand(commandsFor(job))) {
        boundaryFailures.push(`${candidate.path} job ${name} contains an unprotected npm publication path.`);
      }
    }
  }

  const handoffFailures = protectedNames.length === 1 ? checkArtifactHandoff(candidate.path, candidate.workflow, protectedNames[0]) : [];
  const releaseFailures = protectedNames.length === 1 ? checkReleaseReconciliation(candidate.path, candidate.workflow, protectedNames[0]) : [];
  return [
    result(triggerFailures.length ? "FAILED" : "PROVEN", "release-workflow-trigger", triggerFailures.join(" ") || `${candidate.path} binds successful push CI and input-free retained-candidate discovery without typed release coordinates`),
    result(boundaryFailures.length ? "FAILED" : "PROVEN", "release-publish-boundary", boundaryFailures.join(" ") || `${candidate.path} keeps publication inert and least-privileged`),
    result(handoffFailures.length ? "FAILED" : "PROVEN", "release-artifact-handoff", handoffFailures.join(" ") || `${candidate.path} binds protected publication to an unprivileged retained artifact`),
    result(releaseFailures.length ? "FAILED" : "PROVEN", "release-history-reconciliation", releaseFailures.join(" ") || `${candidate.path} creates or repairs public history from the same artifact`),
  ];
}

export function evaluateGitHubSecurity(state, profile) {
  const checks = [];
  checks.push(result(state.defaultBranch === "main" ? "PROVEN" : "FAILED", "default-branch", state.defaultBranch));
  for (const [id, enabled] of Object.entries(state.repositorySettings)) {
    checks.push(result(enabled ? "PROVEN" : "FAILED", `repository-${id}`, enabled ? "enabled" : "disabled"));
  }
  checks.push(result(state.actions.default_workflow_permissions === "read" ? "PROVEN" : "FAILED", "actions-permissions", `default=${state.actions.default_workflow_permissions}`));
  const needsVersionPr = profile === "fixed-package-set";
  checks.push(result(state.actions.can_approve_pull_request_reviews === needsVersionPr ? "PROVEN" : "FAILED", "actions-pr-writes", `enabled=${state.actions.can_approve_pull_request_reviews}; expected=${needsVersionPr}`));
  checks.push(result(state.currentMainCi ? "PROVEN" : "FAILED", "current-main-ci", state.currentMainCi ? `${state.mainSha}; ${state.currentMainCi.url}` : `no successful ci run for ${state.mainSha}`));

  const mainTypes = ruleTypes(state.mainRulesets);
  const statusRules = requiredChecks(state.mainRulesets);
  const pullRequestRules = state.mainRulesets.flatMap((ruleset) => ruleset.rules ?? []).filter((rule) => rule.type === "pull_request");
  const contexts = statusRules.flatMap((rule) => rule.parameters?.required_status_checks ?? []).map((required) => required.context).filter(Boolean);
  const pullRequestPass = pullRequestRules.length > 0 && pullRequestRules.every((rule) => {
    const parameters = rule.parameters ?? {};
    return parameters.required_review_thread_resolution === true
      && Array.isArray(parameters.allowed_merge_methods)
      && parameters.allowed_merge_methods.length === 1
      && parameters.allowed_merge_methods[0] === "squash";
  });
  const mainPass = ["deletion", "non_fast_forward", "pull_request", "required_linear_history", "required_status_checks"].every((type) => mainTypes.has(type))
    && statusRules.length > 0
    && statusRules.every((rule) => rule.parameters?.strict_required_status_checks_policy === true)
    && contexts.length > 0
    && contexts.every((context) => !/^vercel(?:\b|$)/iu.test(context))
    && pullRequestPass
    && bypassCount(state.mainRulesets) === 0;
  checks.push(result(mainPass ? "PROVEN" : "FAILED", "protected-main", mainPass ? `pull requests, strict checks (${contexts.join(", ")}), deletion and force-push protection; no bypass` : `rules=${[...mainTypes].sort().join(", ") || "none"}; checks=${contexts.join(", ") || "none"}; bypass=${bypassCount(state.mainRulesets)}`));

  if (profile === "none") return checks;
  const tagEvidence = state.tagRulesets.map(({ ref, rulesets }) => {
    const types = ruleTypes(rulesets);
    const bypass = bypassCount(rulesets);
    return {
      ref,
      pass: ["deletion", "update"].every((type) => types.has(type)) && bypass === 0,
      types,
      bypass,
    };
  });
  const tagsPass = tagEvidence.length > 0 && tagEvidence.every((entry) => entry.pass);
  checks.push(result(
    tagsPass ? "PROVEN" : "FAILED",
    "protected-release-tags",
    tagEvidence.map((entry) => `${entry.ref}: rules=${[...entry.types].sort().join(", ") || "none"}; bypass=${entry.bypass}`).join("; ") || "no release-tag patterns inspected",
  ));

  const environment = state.environment;
  checks.push(result(environment?.mainOnly && environment.reviewers > 0 ? "PROVEN" : "FAILED", "npm-environment", environment ? `${environment.reviewers} reviewer(s); deployment policy=${environment.policy}` : "missing"));
  checks.push(result(typeof environment?.preventSelfReview === "boolean" ? "PROVEN" : "UNVERIFIED", "npm-environment-review-mode", typeof environment?.preventSelfReview === "boolean" ? environment.preventSelfReview ? "self-review prevented; independent reviewer required" : "self-review allowed; this is maintainer confirmation, not independent review" : "self-review setting unavailable"));
  checks.push(result(state.secretNames.some((name) => /^(?:NPM_TOKEN|NODE_AUTH_TOKEN|NPM_CONFIG_TOKEN)$/u.test(name)) ? "FAILED" : "PROVEN", "npm-token", "repository secret names inspected"));
  checks.push(result("HUMAN-ONLY", "npm-trusted-publisher", "an authorized maintainer must confirm the npm trust record"));
  return checks;
}

export function evaluateRegistryPackage(pkg, registry, releaseState, profile = "single-package") {
  if (!registry) return [result("UNVERIFIED", `npm:${pkg.name}`, "package metadata unavailable")];
  const checks = [];
  const latest = registry.tags.latest;
  const next = registry.tags.next;
  const stableVersions = registry.versions.filter((version) => !/-/u.test(version));
  const prereleaseOnly = registry.versions.length > 0 && stableVersions.length === 0;
  const highestStable = stableVersions.toSorted((left, right) => {
    const leftParts = left.split(".").map(Number);
    const rightParts = right.split(".").map(Number);
    for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
      if ((leftParts[index] ?? 0) !== (rightParts[index] ?? 0)) return (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    }
    return 0;
  }).at(-1);
  const latestStatus = highestStable && latest === highestStable
    ? "PROVEN"
    : prereleaseOnly && profile === "independent-family"
      ? "HUMAN-ONLY"
      : "FAILED";
  const latestEvidence = prereleaseOnly && profile === "independent-family"
    ? `${latest ?? "absent"}; no stable version exists, so changing prerelease-only latest requires maintainer approval`
    : `${latest ?? "absent"}; expected=${highestStable ?? "a stable version"}`;
  checks.push(result(latestStatus, `npm:${pkg.name}:latest`, latestEvidence));
  checks.push(result(!next || /-/u.test(next) ? "PROVEN" : "FAILED", `npm:${pkg.name}:next`, next ?? "absent"));
  for (const exception of registry.historicalExceptions ?? []) {
    checks.push(result("HUMAN-ONLY", `npm:${pkg.name}@${exception.version}:historical-exception`, `published ${exception.publishedAt}; fleet enforcement starts ${registry.historyCutoff}`));
  }

  const manifestPublished = registry.versions.includes(pkg.version);
  const expectedChannel = /-/u.test(pkg.version) ? "next" : "latest";
  const manifestChannel = registry.tags[expectedChannel];
  checks.push(result(
    !manifestPublished ? "UNVERIFIED" : manifestChannel === pkg.version ? "PROVEN" : "FAILED",
    `npm:${pkg.name}@${pkg.version}:manifest-channel`,
    !manifestPublished ? `manifest version is not published; retained candidate evidence is required` : `${expectedChannel}=${manifestChannel ?? "absent"}; expected=${pkg.version}`,
  ));

  const auditedVersions = registry.relevantVersions ?? [pkg.version, latest, next].filter((version) => version && registry.versions.includes(version));
  for (const version of new Set(auditedVersions)) {
    const provenance = registry.provenance[version];
    const release = releaseState[version];
    const provenancePresent = provenance === true || provenance?.present === true;
    const provenanceVerified = provenance === true || provenance?.verified === true;
    const provenanceStatus = provenance == null ? "UNVERIFIED" : provenanceVerified ? "PROVEN" : "FAILED";
    const provenanceEvidence = provenance == null
      ? "attestation lookup unavailable"
      : provenanceVerified
        ? provenance === true ? "attestation present" : `source-bound attestation: ${provenance.evidence}`
        : provenancePresent ? provenance.evidence ?? "attestation could not be source-bound" : "attestation missing after the fleet enforcement cutoff";
    checks.push(result(provenanceStatus, `npm:${pkg.name}@${version}:provenance`, provenanceEvidence));
    const bytesSourceProven = provenance?.verified === true
      && typeof provenance.sourceCommit === "string"
      && typeof registry.integrity[version] === "string";
    checks.push(result(
      bytesSourceProven ? "PROVEN" : provenance == null ? "UNVERIFIED" : "FAILED",
      `npm:${pkg.name}@${version}:bytes-source`,
      bytesSourceProven
        ? `${registry.integrity[version]} is bound by SLSA provenance to ${provenance.sourceCommit}`
        : "registry bytes are not bound to an exact source commit",
    ));

    const expected = expectedTags(profile, pkg, version);
    const expectedTag = expected[0];
    const retained = release?.retainedCandidate;
    const recoveryEvidenceProven = bytesSourceProven
      && retained?.present === true
      && Boolean(release?.changelog)
      && typeof release?.repository === "string";
    const historicalSource = typeof release?.sourceCommit === "string"
      && typeof release?.currentMainSha === "string"
      && release.sourceCommit !== release.currentMainSha;
    const historyIncomplete = !release?.tag || !release?.release || !release?.assetName;
    if (historyIncomplete) {
      checks.push(result(
        retained?.present === true ? "PROVEN" : "UNVERIFIED",
        `npm:${pkg.name}@${version}:retained-candidate`,
        retained?.evidence ?? "the expected certified source CI artifact is unavailable",
      ));
    }
    const tagAligned = release?.tag && typeof release.sourceCommit === "string" && release.tagTarget === release.sourceCommit;
    if (tagAligned) {
      checks.push(result(
        provenance?.verified === true ? "PROVEN" : "UNVERIFIED",
        `npm:${pkg.name}@${version}:tag`,
        `${release.tag} -> ${release.tagTarget}; provenance source ${release.sourceCommit}`,
      ));
    } else if (release?.tag) {
      checks.push(result(
        "FAILED",
        `npm:${pkg.name}@${version}:tag`,
        `${release.tag} targets ${release.tagTarget ?? "unknown"}; provenance source ${release.sourceCommit ?? "unknown"}`,
      ));
    } else if (recoveryEvidenceProven && historicalSource) {
      const command = `gh api --method POST repos/${release.repository}/git/refs -f ref=refs/tags/${expectedTag} -f sha=${release.sourceCommit}`;
      checks.push(result(
        "HUMAN-ONLY",
        `npm:${pkg.name}@${version}:tag`,
        `historical certified source ${release.sourceCommit}; expected ${expectedTag}; run: ${command}`,
        { classification: "historical-tag", nextAction: command },
      ));
    } else if (recoveryEvidenceProven) {
      checks.push(result(
        "FAILED",
        `npm:${pkg.name}@${version}:tag`,
        `missing ${expectedTag} for current certified source ${release.sourceCommit}`,
        { classification: "reconcile" },
      ));
    } else {
      checks.push(result(
        provenance == null || retained?.present !== true ? "UNVERIFIED" : "FAILED",
        `npm:${pkg.name}@${version}:tag`,
        `missing ${expectedTag}; source, retained candidate, or changelog evidence is incomplete`,
      ));
    }

    const expectedTarball = `${pkg.name.replace(/^@/u, "").replace("/", "-")}-${version}.tgz`;
    const expectedIntegrity = registry.integrity[version];
    const releaseHasAsset = release?.assetName === expectedTarball;
    const releaseBytesMatch = releaseHasAsset && typeof release.assetIntegrity === "string" && release.assetIntegrity === expectedIntegrity;
    if (releaseBytesMatch) {
      checks.push(result(
        provenance?.verified === true ? "PROVEN" : "UNVERIFIED",
        `npm:${pkg.name}@${version}:github-release`,
        `${release.release} contains ${expectedTarball} with registry integrity ${expectedIntegrity}`,
      ));
    } else if (releaseHasAsset && release.assetIntegrity == null) {
      checks.push(result("UNVERIFIED", `npm:${pkg.name}@${version}:github-release`, `${release.release} contains ${expectedTarball}, but its bytes could not be read`));
    } else if (releaseHasAsset) {
      checks.push(result("FAILED", `npm:${pkg.name}@${version}:github-release`, `${release.release} contains ${expectedTarball}, but its bytes differ from npm`));
    } else if (recoveryEvidenceProven && historicalSource && !release?.tag && !release?.release) {
      checks.push(result(
        "HUMAN-ONLY",
        `npm:${pkg.name}@${version}:github-release`,
        `wait for verified ${expectedTag}, then rerun only the GitHub Release repair job`,
        { classification: "historical-release" },
      ));
    } else if (recoveryEvidenceProven && (tagAligned || !historicalSource)) {
      checks.push(result(
        "FAILED",
        `npm:${pkg.name}@${version}:github-release`,
        release?.release ? `${release.release} is missing ${expectedTarball}` : `missing; expected ${expected.join(" or ")}`,
        { classification: "reconcile" },
      ));
    } else {
      checks.push(result(
        provenance == null || retained?.present !== true ? "UNVERIFIED" : "FAILED",
        `npm:${pkg.name}@${version}:github-release`,
        release?.release ? `${release.release} is missing ${expectedTarball}` : `missing; source, retained candidate, tag, or changelog evidence is incomplete`,
      ));
    }

    checks.push(result(release?.changelog ? "PROVEN" : "FAILED", `npm:${pkg.name}@${version}:changelog`, release?.changelog ?? `missing exact ${version} heading`));
    if (release?.release && typeof release.prerelease === "boolean") {
      const expectedPrerelease = /-/u.test(version);
      checks.push(result(release.prerelease === expectedPrerelease ? "PROVEN" : "FAILED", `npm:${pkg.name}@${version}:release-channel`, `GitHub prerelease=${release.prerelease}; expected=${expectedPrerelease}`));
    }
  }
  return checks;
}

export function auditExitCode(checks) {
  if (checks.some((check) => check.status === "FAILED")) return 1;
  if (checks.some((check) => check.status === "UNVERIFIED")) return 2;
  return 0;
}

function firstActionable(checks) {
  return checks.find((check) => check.status === "UNVERIFIED")
    ?? checks.find((check) => check.status === "FAILED" && check.id.startsWith("release-"))
    ?? checks.find((check) => check.status === "FAILED");
}

export function deriveReleaseCard({ repository, profile, sourceSha, ciRun, packages, registries = {}, checks, releaseUnit, hasIntent }) {
  const failed = checks.filter((check) => check.status === "FAILED");
  const unverified = checks.filter((check) => check.status === "UNVERIFIED");
  const historicalTag = checks.find((check) => check.classification === "historical-tag");
  const reconcile = checks.filter((check) => check.classification === "reconcile");
  const blockingFailed = failed.filter((check) => check.classification !== "reconcile");
  const currentPublished = packages.map((pkg) => registries[pkg.name]?.versions?.includes(pkg.version) === true);
  let state;
  if (hasIntent === false) state = "NO RELEASE";
  else if (unverified.length) state = "BLOCKED";
  else if (blockingFailed.length) state = "BLOCKED";
  else if (historicalTag || reconcile.length) state = "PARTIAL FAILURE";
  else if (profile === "none") state = "NO RELEASE";
  else if (currentPublished.some((published) => !published)) state = "BLOCKED";
  else state = "COMPLETE";
  if (!releaseStates.has(state)) throw new Error(`Unknown release state: ${state}`);

  const actionable = firstActionable(checks);
  const nextAction = state === "PARTIAL FAILURE"
    ? historicalTag?.nextAction ?? "Run the repository's input-free reconcile workflow."
    : state === "BLOCKED"
      ? actionable?.status === "UNVERIFIED"
        ? `Restore evidence for ${actionable.id} and rerun the fleet release audit.`
        : actionable
          ? `Resolve ${actionable.id} and rerun the fleet release audit.`
          : "Collect live retained-candidate evidence and rerun the fleet release audit."
      : "None.";
  const channels = new Set(packages.map((pkg) => /-/u.test(pkg.version) ? "next" : "latest"));
  const derivedReleaseUnit = releaseUnit ?? (profile === "single-package" ? packages[0]?.name ?? repository
    : profile === "fixed-package-set" ? `${packages.length}-package fixed set`
      : profile === "independent-family" ? `${packages.length}-package family`
        : repository);
  const packageLines = packages.map((pkg) => {
    const integrity = registries[pkg.name]?.integrity?.[pkg.version];
    return `${pkg.name}@${pkg.version} — ${integrity ? `registry integrity ${integrity}` : "candidate digest not observed by fleet audit"}`;
  });
  return {
    state,
    profile,
    releaseUnit: derivedReleaseUnit,
    sourceSha,
    ciRun: ciRun?.url ?? "unverified",
    channel: channels.size === 0 ? "none" : channels.size === 1 ? [...channels][0] : "per-package",
    packages: packageLines,
    confirmed: [`${checks.filter((check) => check.status === "PROVEN").length} objective controls proven`],
    blocked: checks.filter((check) => check.status !== "PROVEN" && check.status !== "HUMAN-ONLY")
      .concat(checks.filter((check) => check.classification === "historical-tag" || check.classification === "historical-release"))
      .map((check) => `${check.id}: ${check.evidence}`),
    nextAction,
  };
}

export function formatReleaseCard(card) {
  return [
    `RELEASE STATUS: ${card.state}`,
    "",
    `Profile: ${card.profile}`,
    `Release unit: ${card.releaseUnit}`,
    `Source SHA: ${card.sourceSha}`,
    `CI run: ${card.ciRun}`,
    `Channel: ${card.channel}`,
    "",
    "Packages:",
    ...(card.packages.length ? card.packages.map((pkg) => `- ${pkg}`) : ["- none"]),
    "",
    "Confirmed:",
    ...card.confirmed.map((item) => `- ${item}`),
    "",
    "Blocked:",
    ...(card.blocked.length ? card.blocked.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Next action:",
    card.nextAction,
  ].join("\n");
}

export { expectedTags };
