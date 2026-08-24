import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { verify as verifySigstore } from "sigstore";
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
import {
  evaluateRepositoryState,
  requiredContextsFromRulesets,
  rulesetsForRef,
  validateFleet,
} from "./audit-fleet.mjs";

const root = new URL("../", import.meta.url);
const run = (command, args) => {
  const completed = spawnSync(command, args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (completed.status !== 0) throw new Error((completed.stderr || completed.stdout).trim() || `${command} failed`);
  return completed.stdout;
};
const ghJson = (path) => JSON.parse(run("gh", ["api", path]));
const ghRaw = (path) => run("gh", ["api", "-H", "Accept: application/vnd.github.raw+json", path]);
const npmJson = (args) => JSON.parse(run("npm", ["view", ...args, "--json"]) || "null");
const encoded = (value) => encodeURIComponent(value);
const environmentName = (job) => typeof job?.environment === "string" ? job.environment : job?.environment?.name;

export function releaseCandidateArtifactNames(workflows) {
  const names = new Set();
  for (const { source } of workflows) {
    const workflow = parse(source);
    for (const job of Object.values(workflow.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        const runId = step.with?.["run-id"];
        const name = step.with?.name;
        if (String(step.uses ?? "").startsWith("actions/download-artifact@")
          && typeof runId === "string"
          && typeof name === "string"
          && !name.includes("${{")) {
          names.add(name);
        }
      }
    }
  }
  return [...names];
}

function repositoryRulesets(repository) {
  return ghJson(`repos/${repository}/rulesets?per_page=100`)
    .map((ruleset) => ghJson(`repos/${repository}/rulesets/${ruleset.id}`))
    .filter((ruleset) => ruleset.enforcement === "active");
}

function repositoryState(entry) {
  const metadata = ghJson(`repos/${entry.repository}`);
  const sha = ghJson(`repos/${entry.repository}/commits/${encoded(metadata.default_branch)}`).sha;
  const tree = ghJson(`repos/${entry.repository}/git/trees/${sha}?recursive=1`).tree ?? [];
  const paths = tree.filter((item) => item.type === "blob").map((item) => item.path);
  const manifests = paths.filter((path) => /(?:^|\/)package\.json$/u.test(path) && !/^(?:apps|demo|docs|examples|fixtures|playground|starters|test|tests)\//u.test(path));
  const manifestEntries = manifests.map((path) => ({ path, manifest: JSON.parse(ghRaw(`repos/${entry.repository}/contents/${path}?ref=${sha}`)) }));
  const packageManifests = manifestEntries.map((entry) => entry.manifest);
  const packages = manifestEntries
    .filter((entry) => entry.manifest.private !== true && entry.manifest.name && entry.manifest.version)
    .map((entry) => ({ ...entry.manifest, manifestPath: entry.path }));
  const workflowFiles = paths.filter((path) => /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(path));
  const workflows = workflowFiles.map((path) => ({ path, source: ghRaw(`repos/${entry.repository}/contents/${path}?ref=${sha}`) }));
  const candidateArtifactNames = releaseCandidateArtifactNames(workflows);
  const actions = ghJson(`repos/${entry.repository}/actions/permissions/workflow`);
  const successfulRuns = ghJson(`repos/${entry.repository}/actions/runs?head_sha=${sha}&status=success&per_page=100`).workflow_runs ?? [];
  const currentMainCi = successfulRuns.find((workflowRun) => workflowRun.event === "push"
    && workflowRun.head_branch === metadata.default_branch
    && workflowRun.head_sha === sha
    && workflowRun.conclusion === "success"
    && /(?:^|\/)ci\.ya?ml$/u.test(workflowRun.path ?? ""));
  const activeRulesets = repositoryRulesets(entry.repository);
  const mainRulesets = rulesetsForRef(activeRulesets, `refs/heads/${metadata.default_branch}`, metadata.default_branch);
  const releaseTagRefs = entry.releaseProfile === "independent-family"
    ? ["refs/tags/v0.0.0", "refs/tags/mcp-v0.0.0"]
    : ["refs/tags/v0.0.0"];
  const tagRulesets = releaseTagRefs.map((ref) => ({
    ref,
    rulesets: rulesetsForRef(activeRulesets, ref, metadata.default_branch),
  }));
  let environment;
  if (entry.releaseProfile !== "none") {
    const npmEnvironment = ghJson(`repos/${entry.repository}/environments/npm`);
    const policy = npmEnvironment.deployment_branch_policy;
    const branches = policy?.custom_branch_policies ? ghJson(`repos/${entry.repository}/environments/npm/deployment-branch-policies?per_page=100`).branch_policies ?? [] : [];
    const reviewerRules = (npmEnvironment.protection_rules ?? []).filter((rule) => rule.type === "required_reviewers");
    environment = {
      mainOnly: policy?.protected_branches === false
        && policy?.custom_branch_policies === true
        && branches.length === 1
        && branches[0].name === "main"
        && branches[0].type === "branch",
      policy: policy?.protected_branches === true
        ? "all protected branches"
        : branches.map((branch) => `${branch.type}:${branch.name}`).join(", ") || "no allowed branch",
      reviewers: reviewerRules.flatMap((rule) => rule.reviewers ?? []).length,
      preventSelfReview: reviewerRules.length === 1 && typeof reviewerRules[0].prevent_self_review === "boolean" ? reviewerRules[0].prevent_self_review : undefined,
    };
  }
  const secretNames = (ghJson(`repos/${entry.repository}/actions/secrets?per_page=100`).secrets ?? []).map((secret) => secret.name);
  const variableNames = (ghJson(`repos/${entry.repository}/actions/variables?per_page=100`).variables ?? []).map((variable) => variable.name);
  const tags = ghJson(`repos/${entry.repository}/git/matching-refs/tags/`).map((ref) => {
    let target = ref.object;
    for (let depth = 0; target?.type === "tag" && depth < 5; depth += 1) {
      target = ghJson(`repos/${entry.repository}/git/tags/${target.sha}`).object;
    }
    return {
      name: ref.ref.replace("refs/tags/", ""),
      sha: ref.object?.sha,
      type: ref.object?.type,
      targetSha: target?.sha,
    };
  });
  const releases = ghJson(`repos/${entry.repository}/releases?per_page=100`).map((release) => ({
    tag: release.tag_name,
    body: release.body ?? "",
    prerelease: release.prerelease,
    target: release.target_commitish,
    assets: (release.assets ?? []).map((asset) => ({ name: asset.name, url: asset.browser_download_url })),
  }));
  const changelogs = paths.filter((path) => /(?:^|\/)CHANGELOG\.md$/iu.test(path)).map((path) => ({ path, source: ghRaw(`repos/${entry.repository}/contents/${path}?ref=${sha}`) }));
  const previewWorkflow = ghRaw(`repos/${entry.repository}/contents/.github/workflows/vercel-preview.yml?ref=${sha}`);
  const vercel = JSON.parse(ghRaw(`repos/${entry.repository}/contents/docs/vercel.json?ref=${sha}`));
  return {
    metadata,
    sha,
    paths,
    packages,
    packageManifests,
    workflows,
    candidateArtifactNames,
    actions,
    environment,
    secretNames,
    variableNames,
    tags,
    releases,
    changelogs,
    mainRulesets,
    tagRulesets,
    requiredContexts: requiredContextsFromRulesets(activeRulesets, metadata.default_branch),
    currentMainCi: currentMainCi ? { sha, url: currentMainCi.html_url, path: currentMainCi.path } : undefined,
    previewWorkflow,
    vercel,
  };
}

function retainedCandidateForSource(state, sourceCommit) {
  state.retainedCandidateCache ??= new Map();
  if (state.retainedCandidateCache.has(sourceCommit)) return state.retainedCandidateCache.get(sourceCommit);
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit ?? "")) {
    const unavailable = { present: false, evidence: "verified provenance did not provide one source commit" };
    state.retainedCandidateCache.set(sourceCommit, unavailable);
    return unavailable;
  }
  if (state.candidateArtifactNames.length !== 1) {
    const unavailable = {
      present: false,
      evidence: `expected one source CI artifact name; found ${state.candidateArtifactNames.join(", ") || "none"}`,
    };
    state.retainedCandidateCache.set(sourceCommit, unavailable);
    return unavailable;
  }
  const runs = ghJson(`repos/${state.metadata.full_name}/actions/workflows/ci.yml/runs?head_sha=${sourceCommit}&event=push&status=completed&per_page=100`).workflow_runs ?? [];
  const expectedName = state.candidateArtifactNames[0];
  for (const run of runs.filter((candidate) => candidate.conclusion === "success"
    && candidate.event === "push"
    && candidate.head_branch === state.metadata.default_branch
    && candidate.head_sha === sourceCommit)) {
    const artifacts = ghJson(`repos/${state.metadata.full_name}/actions/runs/${run.id}/artifacts?per_page=100`).artifacts ?? [];
    const artifact = artifacts.find((candidate) => candidate.name === expectedName && candidate.expired === false);
    if (artifact) {
      const retained = {
        present: true,
        runId: run.id,
        url: run.html_url,
        artifactName: artifact.name,
        evidence: `${artifact.name} retained by successful CI ${run.id}`,
      };
      state.retainedCandidateCache.set(sourceCommit, retained);
      return retained;
    }
  }
  const unavailable = { present: false, evidence: `${expectedName} is not retained by successful source CI for ${sourceCommit}` };
  state.retainedCandidateCache.set(sourceCommit, unavailable);
  return unavailable;
}

export function evaluateVerifiedProvenanceStatement(statement, pkg, version, integrity, expectedWorkflow) {
  const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow;
  const dependencies = statement.predicate?.buildDefinition?.resolvedDependencies ?? [];
  const expectedSubject = `pkg:npm/${pkg.name.replaceAll("@", "%40")}@${version}`;
  const expectedSha512 = integrity?.startsWith("sha512-")
    ? Buffer.from(integrity.slice("sha512-".length), "base64").toString("hex")
    : undefined;
  const subjectMatches = statement.subject?.some((subject) => subject.name === expectedSubject
    && expectedSha512
    && subject.digest?.sha512 === expectedSha512);
  const expectedDependency = `git+https://github.com/${pkg.repository}@refs/heads/main`;
  const sourceCommit = dependencies.find((dependency) => dependency.uri === expectedDependency)?.digest?.gitCommit;
  const verified = statement.predicateType === "https://slsa.dev/provenance/v1"
    && subjectMatches
    && workflow?.repository === `https://github.com/${pkg.repository}`
    && workflow?.ref === "refs/heads/main"
    && workflow?.path === expectedWorkflow
    && /^[0-9a-f]{40}$/u.test(sourceCommit ?? "");
  return {
    present: true,
    verified,
    sourceCommit,
    workflowPath: workflow?.path,
    evidence: verified ? `${workflow.path} at ${sourceCommit}` : "SLSA subject, repository, main ref, workflow, or source commit differs",
  };
}

export async function verifyProvenanceDocument(document, pkg, version, integrity, expectedWorkflow, verifyBundle = verifySigstore) {
  const attestation = document.attestations?.find((item) => item.predicateType === "https://slsa.dev/provenance/v1");
  if (!attestation?.bundle?.dsseEnvelope?.payload) {
    return { present: true, verified: false, evidence: "SLSA statement is incomplete" };
  }
  const statement = JSON.parse(Buffer.from(attestation.bundle.dsseEnvelope.payload, "base64").toString("utf8"));
  const evaluated = evaluateVerifiedProvenanceStatement(statement, pkg, version, integrity, expectedWorkflow);
  if (!evaluated.verified) return evaluated;
  const identity = `https://github.com/${pkg.repository}/${expectedWorkflow}@refs/heads/main`;
  try {
    await verifyBundle(attestation.bundle, {
      certificateIssuer: "https://token.actions.githubusercontent.com",
      certificateIdentityURI: `^${identity.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`,
      certificateOIDs: {
        "1.3.6.1.4.1.57264.1.3": evaluated.sourceCommit,
        "1.3.6.1.4.1.57264.1.5": pkg.repository,
        "1.3.6.1.4.1.57264.1.6": "refs/heads/main",
      },
    });
  } catch {
    return { present: true, verified: false, evidence: "Sigstore signature, certificate identity, or transparency-log proof is invalid" };
  }
  return evaluated;
}

async function provenanceState(pkg, version, integrity, expectedWorkflow) {
  const metadata = npmJson([`${pkg.name}@${version}`, "dist.attestations"]);
  if (!metadata || (Array.isArray(metadata) && metadata.length === 0)) return false;
  const url = Array.isArray(metadata) ? metadata[0]?.url : metadata.url;
  if (!url) return { present: true, verified: false, evidence: "attestation metadata has no document URL" };
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`provenance lookup failed: HTTP ${response.status}`);
  return verifyProvenanceDocument(await response.json(), pkg, version, integrity, expectedWorkflow);
}

async function registryState(pkg, repository, expectedWorkflow, historyCutoff) {
  const metadata = npmJson([pkg.name, "dist-tags", "versions", "time"]);
  const tags = metadata["dist-tags"] ?? {};
  const versions = Array.isArray(metadata.versions) ? metadata.versions : [metadata.versions].filter(Boolean);
  const historicalExceptions = versions
    .filter((version) => metadata.time?.[version] && new Date(metadata.time[version]) < new Date(historyCutoff))
    .map((version) => ({ version, publishedAt: metadata.time[version] }));
  const provenance = {};
  const integrity = {};
  const relevantVersions = new Set(versions.filter((version) => !metadata.time?.[version]
    || new Date(metadata.time[version]) >= new Date(historyCutoff)));
  for (const version of relevantVersions) {
    try {
      integrity[version] = npmJson([`${pkg.name}@${version}`, "dist.integrity"]);
    } catch {
      integrity[version] = undefined;
    }
    try {
      provenance[version] = await provenanceState({ ...pkg, repository }, version, integrity[version], expectedWorkflow);
    } catch {
      provenance[version] = null;
    }
  }
  return { tags, versions, provenance, integrity, relevantVersions: [...relevantVersions], historicalExceptions, historyCutoff };
}

export function headingContainsVersion(source, pkg, version, profile) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const packageName = pkg.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const labels = profile === "independent-family"
    ? [/(?:^|-)mcp$/iu.test(pkg.name) ? `mcp-v${escaped}` : `v${escaped}`]
    : [`v?${escaped}`, `${packageName}@v?${escaped}`];
  return new RegExp(`^#{1,3}\\s+(?:${labels.join("|")})(?:\\s|$)`, "imu").test(source);
}

export function changelogForPackage(changelogs, pkg, version, profile) {
  const colocatedPath = pkg.manifestPath === "package.json"
    ? "CHANGELOG.md"
    : pkg.manifestPath?.replace(/package\.json$/u, "CHANGELOG.md");
  const colocated = changelogs.find((entry) => entry.path === colocatedPath);
  if (colocated) return headingContainsVersion(colocated.source, pkg, version, profile) ? colocated : undefined;
  return changelogs.find((entry) => headingContainsVersion(entry.source, pkg, version, profile));
}

async function assetIntegrity(asset) {
  if (!asset?.url) return undefined;
  const response = await fetch(asset.url, { redirect: "follow" });
  if (!response.ok) return undefined;
  return `sha512-${createHash("sha512").update(Buffer.from(await response.arrayBuffer())).digest("base64")}`;
}

async function releaseState(state, pkg, versions, profile, registry) {
  return Object.fromEntries(await Promise.all([...versions].map(async (version) => {
    const candidates = expectedTags(profile, pkg, version);
    const tag = state.tags.find((entry) => candidates.includes(entry.name));
    const release = state.releases.find((entry) => candidates.includes(entry.tag));
    const changelog = changelogForPackage(state.changelogs, pkg, version, profile);
    const expectedTarball = `${pkg.name.replace(/^@/u, "").replace("/", "-")}-${version}.tgz`;
    const asset = release?.assets.find((entry) => entry.name === expectedTarball);
    const sourceCommit = typeof registry.provenance[version] === "object" ? registry.provenance[version]?.sourceCommit : undefined;
    return [version, {
      tag: tag?.name,
      tagTarget: tag?.targetSha,
      release: release?.tag,
      prerelease: release?.prerelease,
      changelog: changelog ? `${changelog.path} has the exact ${version} heading` : undefined,
      sourceCommit,
      currentMainSha: state.sha,
      repository: state.metadata.full_name,
      retainedCandidate: retainedCandidateForSource(state, sourceCommit),
      assetName: asset?.name,
      assetIntegrity: await assetIntegrity(asset),
    }];
  })));
}

function repositorySettings(metadata) {
  return {
    "auto-merge": metadata.allow_auto_merge === true,
    "branch-cleanup": metadata.delete_branch_on_merge === true,
    dependabot: metadata.security_and_analysis?.dependabot_security_updates?.status === "enabled",
    "secret-scanning": metadata.security_and_analysis?.secret_scanning?.status === "enabled",
    "push-protection": metadata.security_and_analysis?.secret_scanning_push_protection?.status === "enabled",
  };
}

function normalizeDeploymentChecks(checks) {
  return checks.map((check) => ({ ...check, status: check.status.toUpperCase() }));
}

function printRepository(entry, state, checks, registries) {
  const card = deriveReleaseCard({
    repository: entry.repository,
    profile: entry.releaseProfile,
    sourceSha: state?.sha ?? "unverified",
    ciRun: state?.currentMainCi,
    packages: state?.packages ?? [],
    registries,
    checks,
  });
  console.log(`\n${entry.repository} [${entry.releaseProfile}]`);
  console.log(formatReleaseCard(card));
  console.log("\nEvidence:");
  for (const check of checks) console.log(`- ${check.status} ${check.id}: ${check.evidence}`);
}

async function main() {
  const fleet = JSON.parse(await readFile(new URL("fleet/libraries.json", root), "utf8"));
  const invalid = validateFleet(fleet);
  if (invalid.length) throw new Error(invalid.join("\n"));
  const canonicalWorkflow = await readFile(new URL("starters/_shared/vercel-preview.yml", root), "utf8");
  let exitCode = 0;
  for (const entry of fleet.repositories) {
    let state;
    const registries = {};
    let checks;
    try {
      state = repositoryState(entry);
      checks = [
        ...evaluatePackageProfile(entry.releaseProfile, state.packages, state.paths),
        evaluateReleaseIntent(entry.releaseProfile, state.paths, state.packageManifests),
        ...evaluateReleaseWorkflows(state.workflows, entry.releaseProfile),
        ...evaluateGitHubSecurity({
          defaultBranch: state.metadata.default_branch,
          repositorySettings: repositorySettings(state.metadata),
          actions: state.actions,
          environment: state.environment,
          secretNames: state.secretNames,
          mainSha: state.sha,
          currentMainCi: state.currentMainCi,
          mainRulesets: state.mainRulesets,
          tagRulesets: state.tagRulesets,
        }, entry.releaseProfile),
        ...normalizeDeploymentChecks(evaluateRepositoryState({
          defaultBranch: state.metadata.default_branch,
          workflow: state.previewWorkflow,
          vercel: state.vercel,
          secretNames: state.secretNames,
          variableNames: state.variableNames,
          requiredContexts: state.requiredContexts,
        }, canonicalWorkflow)).filter((check) => check.id !== "default-branch"),
      ];
      for (const pkg of state.packages) {
        try {
          const expectedWorkflow = state.workflows.find(({ source }) => Object.values(parse(source).jobs ?? {}).some((job) => environmentName(job) === "npm"))?.path;
          const registry = await registryState(pkg, entry.repository, expectedWorkflow, fleet.releaseHistoryCutoff);
          registries[pkg.name] = registry;
          const versions = new Set(registry.relevantVersions);
          checks.push(...evaluateRegistryPackage(pkg, registry, await releaseState(state, pkg, versions, entry.releaseProfile, registry), entry.releaseProfile));
        } catch (error) {
          checks.push({ status: "UNVERIFIED", id: `npm:${pkg.name}`, evidence: error.message });
        }
      }
    } catch (error) {
      checks = [{ status: "UNVERIFIED", id: "repository-audit", evidence: error.message }];
    }
    printRepository(entry, state, checks, registries);
    const repositoryExit = auditExitCode(checks);
    if (repositoryExit === 1 || (repositoryExit === 2 && exitCode === 0)) exitCode = repositoryExit;
  }
  process.exitCode = exitCode;
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) await main();
