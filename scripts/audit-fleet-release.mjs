import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { verify as verifySigstore } from "sigstore";
import {
  auditExitCode,
  deriveReleaseUnits,
  deriveReleaseCard,
  evaluateIndependentReleaseUnits,
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
        artifactId: artifact.id,
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
  const firstVersion = firstRegistryVersion(versions, metadata.time);
  return { tags, versions, provenance, integrity, firstVersion, relevantVersions: [...relevantVersions], historicalExceptions, historyCutoff };
}

export function firstRegistryVersion(versions, time = {}) {
  // Include any older publication still recorded in npm's time map, even if
  // that version is no longer in the installable version list.
  const observed = new Set([...versions, ...Object.keys(time).filter((key) => !["created", "modified"].includes(key))]);
  const datedVersions = [...observed].map((version) => ({ version, time: Date.parse(time[version]) }));
  const ordered = datedVersions.toSorted((a, b) => a.time - b.time);
  return ordered.length && ordered.every((entry) => Number.isFinite(entry.time))
    && (ordered.length === 1 || ordered[0].time < ordered[1].time) ? ordered[0].version : undefined;
}

export function verifyBootstrapBytes({ pkg, version, firstVersion, manifest, retainedManifest, bytes, sourceCommit, integrity }) {
  const failed = (evidence) => ({ status: "FAILED", evidence });
  if (!firstVersion) return { status: "UNVERIFIED", evidence: "registry publication times do not establish one first version" };
  if (version !== firstVersion) return failed("bootstrap exception cannot apply to a later package version");
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit ?? "") || manifest?.sourceSha !== sourceCommit
    || !isDeepStrictEqual(manifest, retainedManifest)) return failed("bootstrap manifest differs from the retained source CI manifest");
  const records = manifest.packages?.filter((record) => record.name === pkg.name && record.version === version) ?? [];
  if (records.length !== 1) return failed("bootstrap manifest must contain one matching package record");
  const record = records[0];
  if (!/^[A-Za-z0-9._-]+\.tgz$/u.test(record.filename ?? "")) return failed("bootstrap tarball filename is unsafe");
  if (!Buffer.isBuffer(bytes) || typeof integrity !== "string") return { status: "UNVERIFIED", evidence: "bootstrap CI bytes or registry integrity are unavailable" };
  const sha512 = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (sha512 !== integrity || createHash("sha256").update(bytes).digest("hex") !== record.sha256
    || createHash("sha1").update(bytes).digest("hex") !== record.shasum) return failed("bootstrap CI tarball differs from its manifest or npm bytes");
  return { status: "PROVEN", sourceCommit, evidence: `recorded bootstrap at the earliest available registry version; retained CI bytes match npm at ${sourceCommit}; no OIDC provenance` };
}

export async function bootstrapState(state, pkg, version, registry, release, fetchManifest = fetch) {
  const declared = release?.body.match(/^> Bootstrap packages:\s*(.+)$/mu)?.[1].split(",").map((name) => name.trim()) ?? [];
  if (!declared.includes(pkg.name)) return undefined;
  if (!registry.firstVersion) return { status: "UNVERIFIED", evidence: "registry publication times do not establish one first version" };
  if (registry.firstVersion && registry.firstVersion !== version) return { status: "FAILED", evidence: "bootstrap notice refers to a later package version" };
  const directory = await mkdtemp(resolve(tmpdir(), "lupinum-bootstrap-"));
  try {
    const asset = release.assets.find((asset) => asset.name === "release.json");
    if (!asset) return { status: "UNVERIFIED", evidence: "bootstrap release has no supported release.json manifest" };
    const response = await fetchManifest(asset.url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`release manifest lookup failed: HTTP ${response.status}`);
    const manifest = await response.json();
    const sourceCommit = manifest.sourceSha;
    const retained = retainedCandidateForSource(state, sourceCommit);
    if (!retained.present) return { status: "UNVERIFIED", evidence: retained.evidence };
    const records = manifest.packages?.filter((record) => record.name === pkg.name && record.version === version) ?? [];
    if (records.length !== 1 || !/^[A-Za-z0-9._-]+\.tgz$/u.test(records[0].filename ?? "")) {
      return { status: "FAILED", evidence: "bootstrap manifest has no unique safe package filename" };
    }
    const archive = spawnSync("gh", ["api", `repos/${state.metadata.full_name}/actions/artifacts/${retained.artifactId}/zip`], { maxBuffer: 128 * 1024 * 1024, timeout: 60000 });
    if (archive.status !== 0) throw new Error("retained bootstrap CI archive could not be downloaded");
    const archivePath = resolve(directory, "candidate.zip");
    await writeFile(archivePath, archive.stdout);
    // Read exact members without extracting or executing archive content.
    const member = (name) => {
      const output = spawnSync("unzip", ["-p", archivePath, name], { maxBuffer: 128 * 1024 * 1024, timeout: 15000 });
      if (output.status !== 0) throw new Error(`retained bootstrap archive member ${name} is unavailable`);
      return output.stdout;
    };
    const proof = verifyBootstrapBytes({ pkg, version, firstVersion: registry.firstVersion, manifest,
      retainedManifest: JSON.parse(member("release.json").toString("utf8")), bytes: member(records[0].filename), sourceCommit, integrity: registry.integrity[version] });
    return { ...proof, evidence: `${proof.evidence}; source CI ${retained.url}` };
  } catch (error) {
    return { status: "UNVERIFIED", evidence: error.message };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

const assetIntegrities = new Map();

export async function assetIntegrity(asset, fetchAsset = fetch) {
  if (!asset?.url) return undefined;
  if (assetIntegrities.has(asset.url)) return assetIntegrities.get(asset.url);
  const integrity = (async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchAsset(asset.url, { redirect: "follow" });
        if (!response.ok) return undefined;
        return `sha512-${createHash("sha512").update(Buffer.from(await response.arrayBuffer())).digest("base64")}`;
      } catch {
        if (attempt === 1) return undefined;
      }
    }
    return undefined;
  })();
  assetIntegrities.set(asset.url, integrity);
  return integrity;
}

async function releaseState(state, pkg, versions, profile, registry) {
  return Object.fromEntries(await Promise.all([...versions].map(async (version) => {
    const candidates = expectedTags(profile, pkg, version);
    const tag = state.tags.find((entry) => candidates.includes(entry.name));
    const release = state.releases.find((entry) => candidates.includes(entry.tag));
    const changelog = changelogForPackage(state.changelogs, pkg, version, profile);
    const assets = await Promise.all((release?.assets ?? [])
      .filter((entry) => entry.name.endsWith(".tgz"))
      .map(async (entry) => ({ name: entry.name, integrity: await assetIntegrity(entry) })));
    const provenance = registry.provenance[version];
    const bootstrap = (provenance === false || provenance?.present === false) ? await bootstrapState(state, pkg, version, registry, release) : undefined;
    const sourceCommit = provenance?.verified === true
      ? provenance.sourceCommit
      : bootstrap?.status === "PROVEN"
        ? bootstrap.sourceCommit
        : version === pkg.version && !registry.versions.includes(version)
          ? state.sha
          : undefined;
    return [version, {
      tag: tag?.name,
      tagTarget: tag?.targetSha,
      release: release?.tag,
      prerelease: release?.prerelease,
      changelog: changelog ? `${changelog.path} has the exact ${version} heading` : undefined,
      sourceCommit,
      bootstrap,
      currentMainSha: state.sha,
      repository: state.metadata.full_name,
      retainedCandidate: retainedCandidateForSource(state, sourceCommit),
      assets,
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

function printRepository(entry, state, checks, registries, independentFamily) {
  if (entry.releaseProfile === "independent-family" && independentFamily) {
    console.log(`\n${entry.repository} [${entry.releaseProfile}]`);
    for (const unit of independentFamily.units) {
      const packagePrefixes = unit.packages.map((pkg) => `npm:${pkg.name}`);
      const unitChecks = checks.filter((check) => !check.id.startsWith("npm:")
        || packagePrefixes.some((prefix) => check.id === prefix || check.id.startsWith(`${prefix}:`) || check.id.startsWith(`${prefix}@`)));
      const card = deriveReleaseCard({
        repository: entry.repository,
        profile: entry.releaseProfile,
        sourceSha: state?.sha ?? "unverified",
        ciRun: state?.currentMainCi,
        packages: unit.packages,
        registries: Object.fromEntries(unit.packages.map((pkg) => [pkg.name, registries[pkg.name]])),
        checks: unitChecks,
        releaseUnit: unit.label,
        hasIntent: unit.valid ? unit.hasIntent : undefined,
      });
      console.log(`\n${formatReleaseCard(card)}`);
    }
    console.log("\nEvidence:");
    for (const check of checks) console.log(`- ${check.status} ${check.id}: ${check.evidence}`);
    return;
  }
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
    let independentFamily;
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
          const versions = new Set([...registry.relevantVersions, pkg.version]);
          checks.push(...evaluateRegistryPackage(pkg, registry, await releaseState(state, pkg, versions, entry.releaseProfile, registry), entry.releaseProfile));
        } catch (error) {
          checks.push({ status: "UNVERIFIED", id: `npm:${pkg.name}`, evidence: error.message });
        }
      }
      if (entry.releaseProfile === "independent-family") {
        const intents = deriveReleaseUnits(entry.releaseProfile, state.packages)
          .filter((unit) => unit.valid && unit.packages.every((pkg) => changelogForPackage(state.changelogs, pkg, unit.version, entry.releaseProfile)))
          .map((unit) => `${unit.id}@${unit.version}`);
        independentFamily = evaluateIndependentReleaseUnits({ packages: state.packages, registries, checks, intents });
        checks.push(independentFamily.check);
      }
    } catch (error) {
      checks = [{ status: "UNVERIFIED", id: "repository-audit", evidence: error.message }];
    }
    printRepository(entry, state, checks, registries, independentFamily);
    const repositoryExit = auditExitCode(checks);
    if (repositoryExit === 1 || (repositoryExit === 2 && exitCode === 0)) exitCode = repositoryExit;
  }
  process.exitCode = exitCode;
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) await main();
