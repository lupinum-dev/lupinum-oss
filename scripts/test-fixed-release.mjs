import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

// Exercise the installed CLI in a disposable copy of the generated smoke project.
// This runs after installation in starter-smoke; the root contract check does not install starters.
if (process.argv.length !== 3) throw new Error("Pass the installed generated monorepo directory.");
const source = resolve(process.argv[2]);
const project = await mkdtemp(join(tmpdir(), "lupinum-fixed-release-"));
// Disposable commits and outputs must not inherit the enclosing workflow's identity or files.
const trialEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GITHUB_")));
const readJson = async (path) => JSON.parse(await readFile(join(project, path), "utf8"));
const writeJson = (path, value) => writeFile(join(project, path), `${JSON.stringify(value, null, 2)}\n`);
function run(command, args, expectedStatus = 0, env = {}) {
  const result = spawnSync(command, args, { cwd: project, env: { ...trialEnv, ...env }, encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  assert.ok(Number.isInteger(result.status), `${command} did not finish: ${result.error?.message ?? result.signal}`);
  if (expectedStatus === 0) assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  else assert.notEqual(result.status, 0, `${command} unexpectedly succeeded`);
  if (expectedStatus instanceof RegExp) assert.match(`${result.stdout}\n${result.stderr}`, expectedStatus);
  return result.stdout.trim();
}
function commit(message) {
  run("git", ["add", "."]);
  run("git", ["commit", "-m", message]);
}

try {
  await cp(source, project, { recursive: true, filter: (path) => ![".git", "node_modules", ".nuxt", ".output", "dist", "release-artifacts", ".preview-artifacts", ".npm-cache"].includes(basename(path)) });
  run("pnpm", ["install", "--frozen-lockfile", "--offline", "--ignore-scripts"]);
  console.log(`Trial uses installed Changesets ${(await readJson("node_modules/@changesets/cli/package.json")).version}.`);
  run("git", ["init", "-b", "main"]);
  run("git", ["config", "user.name", "Lupinum OSS trial"]);
  run("git", ["config", "user.email", "trial@example.invalid"]);
  const packagePaths = (await readdir(join(project, "packages"))).sort().map((name) => `packages/${name}/package.json`);
  const manifests = await Promise.all(packagePaths.map(readJson));
  assert.ok(manifests.length >= 2);
  // Include an internal dependency so packing must replace workspace:* with the candidate version.
  manifests[1].dependencies = { ...manifests[1].dependencies, [manifests[0].name]: "workspace:*" };
  await writeJson(packagePaths[1], manifests[1]);
  run("pnpm", ["install", "--lockfile-only", "--offline", "--ignore-scripts", "--no-frozen-lockfile"]);
  commit("feat: initialize fixed-set trial");

  const clean = () => assert.equal(run("git", ["status", "--porcelain"]), "", "Preparation rejection must preserve the worktree.");
  run("pnpm", ["release:prepare", "--version", "8.0.0"], 1);
  clean();
  run("pnpm", ["release:prepare"], 1);
  clean();
  await writeFile(join(project, "unreviewed.txt"), "Unreviewed change\n");
  run("pnpm", ["release:prepare"], 1);
  await rm(join(project, "unreviewed.txt"));
  clean();

  const config = await readJson(".changeset/config.json");
  await writeJson(".changeset/config.json", { ...config, fixed: [[manifests[0].name]] });
  commit("test: omit a fixed-set member");
  run("pnpm", ["release:prepare"], 1);
  clean();
  await writeJson(".changeset/config.json", config);
  commit("test: restore the complete fixed group");
  await writeJson(packagePaths[1], { ...manifests[1], version: "0.2.0" });
  commit("test: split package versions");
  run("pnpm", ["release:prepare"], 1);
  clean();
  await writeJson(packagePaths[1], manifests[1]);
  commit("test: restore coupled package versions");

  const changeset = (name, type, summary) => writeFile(join(project, ".changeset", `${name}.md`), `---\n"${manifests[0].name}": ${type}\n---\n\n${summary}\n`);
  async function certify(version, distTag) {
    const current = await Promise.all(packagePaths.map(readJson));
    assert.deepEqual(current.map((manifest) => manifest.version), current.map(() => version));
    assert.equal((await readJson("package.json")).version, "0.0.0", "Changelogen must not bump the private root version.");
    const changelog = await readFile(join(project, "CHANGELOG.md"), "utf8");
    assert.equal(changelog.split(`## v${version}\n`).length - 1, 1);
    assert.ok(changelog.includes("## v0.1.0\n"), "Earlier release notes must survive.");
    commit(`chore: prepare ${version}`);
    const sourceSha = run("git", ["rev-parse", "HEAD"]);
    const staleSha = run("git", ["rev-parse", "HEAD^"]);
    run("pnpm", ["build"]);
    run("pnpm", ["pack:release"], /The release source differs from GITHUB_SHA\./, { GITHUB_SHA: staleSha });
    await assert.rejects(readJson("release-artifacts/release.json"), { code: "ENOENT" });
    run("pnpm", ["pack:release"], 0, { GITHUB_SHA: sourceSha });
    run("node", ["scripts/verify-packed-consumer.mjs"]);
    const manifest = await readJson("release-artifacts/release.json");
    assert.equal(manifest.version, version);
    assert.equal(manifest.distTag, distTag);
    assert.equal(manifest.sourceSha, sourceSha);
    for (const record of manifest.packages) {
      const bytes = await readFile(join(project, "release-artifacts", record.filename));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), record.sha256);
      assert.equal(createHash("sha1").update(bytes).digest("hex"), record.shasum);
      const packed = JSON.parse(run("tar", ["-xOf", `release-artifacts/${record.filename}`, "package/package.json"]));
      assert.equal(packed.version, version);
      if (packed.name === manifests[1].name) assert.equal(packed.dependencies[manifests[0].name], version);
    }
    const checksums = await readFile(join(project, "release-artifacts/SHA256SUMS"), "utf8");
    for (const line of checksums.trim().split("\n")) {
      const [digest, filename] = line.split("  ");
      const bytes = await readFile(join(project, "release-artifacts", filename));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), digest);
    }
    clean();
    console.log(`Certified ${version}: ${manifest.packages.length} packages, ${distTag}, source ${sourceSha}; packed consumers and dependency ranges passed.`);
  }
  run("pnpm", ["changeset", "pre", "enter", "beta"]);
  await changeset("first-beta", "minor", "Add the reviewed fixed-set feature.");
  commit("feat: add a reviewed fixed-set feature");
  run("pnpm", ["release:prepare"]);
  await certify("0.2.0-beta.0", "next");
  run("pnpm", ["release:prepare"], 1);
  clean();

  await changeset("second-beta", "patch", "Correct the reviewed fixed-set behavior.");
  commit("fix: correct the fixed-set behavior");
  run("pnpm", ["release:prepare"]);
  await certify("0.2.0-beta.1", "next");
  run("pnpm", ["changeset", "pre", "exit"]);
  commit("chore: request the stable fixed-set version");
  run("pnpm", ["release:prepare"]);
  await certify("0.2.0", "latest");
  const remainingChangesets = (await readdir(join(project, ".changeset"))).filter((name) => name.endsWith(".md") || name === "pre.json");
  assert.deepEqual(remainingChangesets, [], "Stable preparation must consume the prerelease Changesets state.");
  assert.equal(run("git", ["tag", "--list"]), "", "Version preparation must not create release tags.");
  assert.equal(run("git", ["remote"]), "", "The disposable trial must have no remote.");
  console.log("Fixed-set trial passed: missing intent, manual versions, dirty worktree, incomplete group and split versions rejected; two prereleases and stable certification verified without publication.");
} finally {
  await rm(project, { recursive: true, force: true });
}
