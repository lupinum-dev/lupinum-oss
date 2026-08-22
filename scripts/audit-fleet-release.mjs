import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateGitHubSecurity, evaluatePackageProfile, evaluateRegistryPackage, evaluateReleaseIntent, evaluateReleaseWorkflows } from "./fleet-release-policy.mjs";
import { validateFleet } from "./audit-fleet.mjs";

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

function rules(repository) {
  return ghJson(`repos/${repository}/rulesets?per_page=100`)
    .map((rule) => ghJson(`repos/${repository}/rulesets/${rule.id}`))
    .filter((rule) => rule.enforcement === "active");
}

function matchesRule(rule, kind) {
  const include = rule.conditions?.ref_name?.include ?? [];
  return include.some((pattern) => kind === "main" ? /main|DEFAULT_BRANCH/u.test(pattern) : /tag|refs\/tags/u.test(pattern));
}

function repositoryState(entry) {
  const metadata = ghJson(`repos/${entry.repository}`);
  const sha = ghJson(`repos/${entry.repository}/commits/${encoded(metadata.default_branch)}`).sha;
  const tree = ghJson(`repos/${entry.repository}/git/trees/${sha}?recursive=1`).tree ?? [];
  const paths = tree.filter((item) => item.type === "blob").map((item) => item.path);
  const manifests = paths.filter((path) => /(?:^|\/)package\.json$/u.test(path) && !/^(?:apps|demo|docs|playground|starters|test|tests)\//u.test(path));
  const packages = manifests.map((path) => JSON.parse(ghRaw(`repos/${entry.repository}/contents/${path}?ref=${sha}`))).filter((pkg) => pkg.private !== true && pkg.name && pkg.version);
  const workflowFiles = paths.filter((path) => /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(path));
  const workflows = workflowFiles.map((path) => ({ path, source: ghRaw(`repos/${entry.repository}/contents/${path}?ref=${sha}`) }));
  const actions = ghJson(`repos/${entry.repository}/actions/permissions/workflow`);
  const successfulRuns = ghJson(`repos/${entry.repository}/actions/runs?head_sha=${sha}&status=success&per_page=100`).workflow_runs ?? [];
  const activeRules = rules(entry.repository);
  let environment;
  if (entry.releaseProfile !== "none") {
    const npmEnvironment = ghJson(`repos/${entry.repository}/environments/npm`);
    const policy = npmEnvironment.deployment_branch_policy;
    const branches = policy?.custom_branch_policies ? ghJson(`repos/${entry.repository}/environments/npm/deployment-branch-policies?per_page=100`).branch_policies ?? [] : [];
    environment = {
      protected_branches: policy?.protected_branches === true || (policy?.custom_branch_policies === true && branches.length === 1 && branches[0].name === "main"),
      reviewers: (npmEnvironment.protection_rules ?? []).filter((rule) => rule.type === "required_reviewers").flatMap((rule) => rule.reviewers ?? []).length,
    };
  }
  const secretNames = (ghJson(`repos/${entry.repository}/actions/secrets?per_page=100`).secrets ?? []).map((secret) => secret.name);
  const tags = ghJson(`repos/${entry.repository}/git/matching-refs/tags/`).map((ref) => ref.ref.replace("refs/tags/", ""));
  const releases = ghJson(`repos/${entry.repository}/releases?per_page=100`).map((release) => release.tag_name);
  const changelogs = paths.filter((path) => /(?:^|\/)CHANGELOG\.md$/iu.test(path)).map((path) => ghRaw(`repos/${entry.repository}/contents/${path}?ref=${sha}`));
  return { metadata, sha, paths, packages, workflows, actions, environment, secretNames, tags, releases, changelogs, currentMainCi: successfulRuns.some((run) => /(?:^|\/)ci\.ya?ml$/u.test(run.path ?? "")), mainProtected: activeRules.some((rule) => matchesRule(rule, "main")), tagsProtected: activeRules.some((rule) => matchesRule(rule, "tag")) };
}

function registryState(name) {
  const metadata = npmJson([name, "dist-tags", "versions"]);
  const tags = metadata["dist-tags"] ?? {};
  const versions = Array.isArray(metadata.versions) ? metadata.versions : [metadata.versions].filter(Boolean);
  const provenance = {};
  for (const version of new Set([tags.latest, tags.next].filter(Boolean))) {
    try {
      const attestations = npmJson([`${name}@${version}`, "dist.attestations"]);
      provenance[version] = Array.isArray(attestations) ? attestations.length > 0 : Boolean(attestations && Object.keys(attestations).length > 0);
    } catch { provenance[version] = false; }
  }
  return { tags, versions, provenance };
}

function releaseState(state, versions) {
  return Object.fromEntries([...versions].map((version) => {
    const versionPattern = new RegExp(`(?:^|@|v)${version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u");
    return [version, {
      tag: state.tags.find((tag) => versionPattern.test(tag)),
      release: state.releases.find((tag) => versionPattern.test(tag)),
      changelog: state.changelogs.some((source) => source.includes(version)) ? `CHANGELOG contains ${version}` : undefined,
    }];
  }));
}

async function main() {
  const fleet = JSON.parse(await readFile(new URL("fleet/libraries.json", root), "utf8"));
  const invalid = validateFleet(fleet);
  if (invalid.length) throw new Error(invalid.join("\n"));
  let failed = false;
  for (const entry of fleet.repositories) {
    console.log(`\n${entry.repository} [${entry.releaseProfile}]`);
    try {
      const state = repositoryState(entry);
      const checks = [
        ...evaluatePackageProfile(entry.releaseProfile, state.packages, state.paths),
        evaluateReleaseIntent(entry.releaseProfile, state.paths, state.workflows.map((workflow) => workflow.source).join("\n")),
        ...evaluateReleaseWorkflows(state.workflows, entry.releaseProfile),
        ...evaluateGitHubSecurity({ defaultBranch: state.metadata.default_branch, repositorySettings: state.metadata.allow_auto_merge === true && state.metadata.delete_branch_on_merge === true && state.metadata.security_and_analysis?.dependabot_security_updates?.status === "enabled" && state.metadata.security_and_analysis?.secret_scanning?.status === "enabled" && state.metadata.security_and_analysis?.secret_scanning_push_protection?.status === "enabled", actions: state.actions, environment: state.environment, secretNames: state.secretNames, mainSha: state.sha, currentMainCi: state.currentMainCi, mainProtected: state.mainProtected, tagsProtected: state.tagsProtected }, entry.releaseProfile),
      ];
      for (const pkg of state.packages) {
        const registry = registryState(pkg.name);
        checks.push(...evaluateRegistryPackage(pkg, registry, releaseState(state, new Set(Object.values(registry.tags).filter(Boolean)))));
      }
      for (const check of checks) {
        if (check.status === "FAILED") failed = true;
        console.log(`- ${check.status} ${check.id}: ${check.evidence}`);
      }
    } catch (error) {
      console.log(`- UNVERIFIED repository-audit: ${error.message}`);
    }
  }
  if (failed) process.exitCode = 1;
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) await main();
