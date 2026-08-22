import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCiWorkflow, checkPreviewWorkflow, checkPublishWorkflow, checkWorkflow, containsNpmCredential, readWorkflow } from "./workflow-policy.mjs";

const root = new URL("../starters/", import.meta.url);
const profiles = ["library", "library-monorepo", "app"];
const failures = [];
const materializedRoot = await mkdtemp(join(tmpdir(), "lupinum-oss-starters-"));

async function exists(url) {
  try {
    await stat(url);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

try {
for (const profile of profiles) {
  const base = new URL(`${profile}/`, root);
  const required = [
    ".github/workflows/ci.yml",
    ".github/pull_request_template.md",
    "AGENTS.md",
    "CLAUDE.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "MAINTAINING.md",
    "README.md",
    "SECURITY.md",
    "package.json",
    "pnpm-workspace.yaml",
    "setup.mjs",
  ];
  required.push(profile === "app" ? "vercel.json" : "docs/vercel.json");
  required.push(profile === "app" ? "scripts/vercel-ignore.mjs" : "docs/scripts/vercel-ignore.mjs");
  if (profile !== "app") {
    required.push(
      ".github/workflows/package-preview.yml",
      ".github/workflows/publish.yml",
      ".github/workflows/vercel-preview.yml",
      "scripts/verify-packed-consumer.mjs",
    );
  }
  const missingRequired = [];
  for (const path of required) {
    if (!(await exists(new URL(path, base)))) {
      failures.push(`${profile} is missing ${path}`);
      missingRequired.push(path);
    }
  }
  if (missingRequired.length) continue;
  const manifest = JSON.parse(await readFile(new URL("package.json", base), "utf8"));
  if (manifest.devDependencies?.yaml !== "2.9.0") {
    failures.push(`${profile} must declare the workflow parser directly`);
  }
  for (const command of ["verify", "docs:build", "audit:all", "release:verify"]) {
    if (!manifest.scripts?.[command]) failures.push(`${profile} is missing command ${command}`);
  }
  const workspace = await readFile(new URL("pnpm-workspace.yaml", base), "utf8");
  const renovate = JSON.parse(await readFile(new URL("renovate.json", base), "utf8"));
  if (renovate.minimumReleaseAge !== "1 day") failures.push(`${profile} Renovate must match the 24-hour pnpm quarantine`);
  for (const setting of ["minimumReleaseAge: 1440", "minimumReleaseAgeStrict: true", "minimumReleaseAgeIgnoreMissingTime: false"]) {
    if (!workspace.includes(setting)) failures.push(`${profile} is missing ${setting}`);
  }
  const esbuildOverridePaths = ["fontless>esbuild", "vite>esbuild"];
  if (profile !== "app") esbuildOverridePaths.push("tsup>esbuild", "bundle-require>esbuild");
  for (const dependencyPath of esbuildOverridePaths) {
    if (!workspace.includes(`'${dependencyPath}': 0.28.2`)) failures.push(`${profile} is missing the narrow ${dependencyPath} security override`);
  }
  if (/^\s+esbuild:\s+0\.28\.2\s*$/mu.test(workspace)) failures.push(`${profile} must not override esbuild for the complete dependency graph`);

  const readme = await readFile(new URL("README.md", base), "utf8");
  for (const contract of ['width="128"', "## Why use ", "## Requirements", "## Installation", "## Quick start", "## Documentation", "## Support and security", "## License"]) {
    if (!readme.includes(contract)) failures.push(`${profile} README is missing ${contract}`);
  }
  if ((readme.match(/<h1\b/g) ?? []).length !== 1) failures.push(`${profile} README must contain one H1`);

  if (profile !== "app") {
    if (!manifest.scripts["release:verify"].includes("verify-packed-consumer.mjs")) failures.push(`${profile} release verification does not test the packed consumer boundary`);
    const changelog = await readFile(new URL("CHANGELOG.md", base), "utf8");
    if (!/^## v0\.1\.0\s*$/m.test(changelog)) failures.push(`${profile} needs an initial v0.1.0 changelog entry`);
  }
  for (const path of await walk(base.pathname)) {
    let source;
    try { source = await readFile(path, "utf8"); } catch { continue; }
    if (source.includes("\0")) continue;
    if (containsNpmCredential(source)) failures.push(`${profile} configures a long-lived npm credential in ${path.slice(base.pathname.length)}`);
    if (!path.includes(`${join(".github", "workflows")}/`) || (!path.endsWith(".yml") && !path.endsWith(".yaml"))) continue;
    try {
      const { workflow } = await readWorkflow(path);
      failures.push(...checkWorkflow(`${profile}/${path.slice(base.pathname.length)}`, workflow));
    } catch (error) {
      failures.push(`${profile}/${path.slice(base.pathname.length)} is invalid YAML: ${error.message}`);
    }
  }


  if (profile === "app") {
    const plausible = await readFile(new URL("app/composables/usePlausible.ts", base), "utf8");
    if ((plausible.match(/useScriptPlausibleAnalytics/g) ?? []).length !== 1 || plausible.includes("useHead(")) {
      failures.push("app must load Plausible exactly once through the Nuxt Scripts registry");
    }
  } else {
    const previewPath = new URL(".github/workflows/package-preview.yml", base).pathname;
    const publishPath = new URL(".github/workflows/publish.yml", base).pathname;
    const vercelPreviewPath = new URL(".github/workflows/vercel-preview.yml", base).pathname;
    const { workflow: preview } = await readWorkflow(previewPath);
    const { source: publishSource, workflow: publish } = await readWorkflow(publishPath);
    const vercelPreviewSource = await readFile(vercelPreviewPath, "utf8");
    failures.push(...checkPreviewWorkflow(`${profile}/.github/workflows/package-preview.yml`, preview));
    failures.push(...checkPublishWorkflow(`${profile}/.github/workflows/publish.yml`, publish));
    for (const boundary of [
      "checks: write",
      "cancel-in-progress: false",
      "github.event.comment.body == '/vercel'",
      "'/v13/deployments'",
      "gitSource:",
      "name: 'Vercel Preview'",
      "getCollaboratorPermissionLevel",
      "AbortSignal.timeout",
      "ignored-build-step",
      "reusedExistingPreview",
    ]) {
      if (!vercelPreviewSource.includes(boundary)) failures.push(`${profile} Vercel preview workflow is missing ${boundary}`);
    }
    const unsafePreviewStep = /actions\/checkout@|vercel build|vercel deploy|pnpm install|^\s*(?:-\s*)?run:/mu;
    if (unsafePreviewStep.test(vercelPreviewSource)) failures.push(`${profile} Vercel preview workflow executes untrusted code`);
    if (!unsafePreviewStep.test("      - run: pnpm test")) failures.push(`${profile} Vercel preview policy misses YAML list-item run steps`);
    for (const boundary of [
      "actions/download-artifact@",
      "head_sha=$GITHUB_SHA",
      "release-candidate",
      "verified-release",
      "--provenance",
      "--ignore-scripts",
      "dist.shasum",
      "dist.attestations",
      "versions.length !== 1",
      "bootstrap-packages",
      "modes=",
      "This first npm version was created from the exact CI-certified artifact",
      "dist-tags",
      "sourceSha",
    ]) {
      if (!publishSource.includes(boundary)) failures.push(`${profile} publish workflow is missing ${boundary}`);
    }
    if (publishSource.includes("pnpm install") || publishSource.includes("pnpm release:verify")) {
      failures.push(`${profile} publish workflow rebuilds instead of consuming the retained main CI candidate`);
    }
    if (profile === "library-monorepo") {
      if (!publishSource.includes("const verifiedPackages = new Set()")) {
        failures.push("library-monorepo must share one registry polling budget");
      }
      if (publishSource.includes("let verified = false")) {
        failures.push("library-monorepo must not restart registry polling for each package");
      }
      if (!publishSource.includes("if (attempt + 1 < maxAttempts)")) {
        failures.push("library-monorepo must not sleep after its final registry attempt");
      }
    }
    const packer = await readFile(new URL("scripts/pack-release.mjs", base), "utf8");
    for (const field of ["sha256", "shasum", "distTag", "sourceSha", "GITHUB_SHA"]) {
      if (!packer.includes(field)) failures.push(`${profile} release manifest is missing ${field}`);
    }
  }

  const ciPath = new URL(".github/workflows/ci.yml", base).pathname;
  const { workflow: ci } = await readWorkflow(ciPath);
  failures.push(...checkCiWorkflow(`${profile}/.github/workflows/ci.yml`, ci));
  const vercelPath = profile === "app" ? "vercel.json" : "docs/vercel.json";
  const wrongVercelPath = profile === "app" ? "docs/vercel.json" : "vercel.json";
  if (await exists(new URL(wrongVercelPath, base))) failures.push(`${profile} keeps Vercel configuration outside its deployment root`);
  const vercel = JSON.parse(await readFile(new URL(vercelPath, base), "utf8"));
  if (profile === "app" && vercel.git?.deploymentEnabled !== true) {
    failures.push("app must report a Vercel status for every pull-request commit");
  }
  if (
    profile !== "app"
    && (
      vercel.git?.deploymentEnabled?.["**"] !== false
      || vercel.git.deploymentEnabled.main !== true
      || Object.keys(vercel.git.deploymentEnabled).length !== 2
    )
  ) {
    failures.push(`${profile} must deploy main automatically and require /vercel for previews`);
  }
  const expectedIgnoreCommand = "node scripts/vercel-ignore.mjs";
  if (vercel.ignoreCommand !== expectedIgnoreCommand) {
    failures.push(`${profile} must skip Vercel builds that cannot affect the deployed site`);
  }
  for (const scenario of [
    { sha: "0000000000000000000000000000000000000000", status: 1, name: "missing baseline" },
    { sha: "HEAD", status: 0, name: "unchanged baseline" },
  ]) {
    const result = spawnSync("sh", ["-c", vercel.ignoreCommand], {
      cwd: new URL(profile === "app" ? "./" : "docs/", base),
      env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: scenario.sha },
    });
    if (result.status !== scenario.status) {
      failures.push(`${profile} Vercel filter failed the ${scenario.name} fixture`);
    }
  }
  if (profile === "app") {
    if (vercel.buildCommand !== "pnpm build") failures.push("app Vercel build must run from the repository root");
  } else if (vercel.buildCommand !== "pnpm --dir .. docs:build" || vercel.outputDirectory !== null) {
    failures.push(`${profile} Vercel build must use the parent workspace command from docs/`);
  }

  const output = join(materializedRoot, profile);
  const common = [
    new URL("setup.mjs", base).pathname,
    "--output", output,
    "--name", `test-${profile}`,
    "--title", `Test ${profile}`,
    "--description", "A generated contract test.",
    "--repository", `lupinum-dev/test-${profile}`,
    "--domain", `test-${profile}.lupinum.com`,
    "--plausible", "test-script-id",
  ];
  if (profile === "library") common.push("--package", "@lupinum/test-library");
  if (profile === "library-monorepo") common.push(
    "--package", "@lupinum/test-core",
    "--package", "@lupinum/test-vue",
    "--package", "@lupinum/test-nuxt",
    "--primary", "@lupinum/test-vue",
  );
  const generated = spawnSync(process.execPath, common, { encoding: "utf8" });
  if (generated.status !== 0) {
    failures.push(`${profile} setup failed: ${(generated.stderr || generated.stdout).trim()}`);
    continue;
  }
  if (!(await exists(join(output, "scripts/verify-action-shas.mjs")))) {
    failures.push(`${profile} generated project is missing upstream Action SHA verification`);
  }
  const generatedCi = await readFile(join(output, ".github/workflows/ci.yml"), "utf8");
  if (!generatedCi.includes("node scripts/verify-action-shas.mjs")) {
    failures.push(`${profile} CI does not verify that pinned Action commits exist upstream`);
  }
  if (generatedCi.includes("GITHUB_TOKEN")) {
    failures.push(`${profile} CI must keep Action verification tokenless`);
  }
  for (const forbidden of ["setup.mjs", "template.json"]) {
    if (await exists(new URL(`${profile}/${forbidden}`, new URL(`file://${materializedRoot}/`)))) failures.push(`${profile} generated ${forbidden}`);
  }
  for (const path of await walk(output)) {
    if (!/\.(?:json|md|mjs|ts|vue|ya?ml)$/.test(path)) continue;
    const source = await readFile(path, "utf8");
    if (/\{\{[A-Z0-9_]+\}\}/.test(source)) failures.push(`${profile} left a template token in ${path.slice(output.length + 1)}`);
  }
}

const hostileOutput = join(materializedRoot, "hostile-library");
const hostileTitle = "Bob's App";
const hostileDescription = `He said "ship": now\nGrüß 日本語 🌱 <safe>`;
const hostile = spawnSync(process.execPath, [
  new URL("library/setup.mjs", root).pathname,
  "--output", hostileOutput,
  "--name", "hostile-library",
  "--title", hostileTitle,
  "--description", hostileDescription,
  "--repository", "lupinum-dev/hostile-library",
  "--domain", "hostile-library.lupinum.com",
  "--package", "@lupinum/hostile-library",
], { encoding: "utf8" });
if (hostile.status !== 0) failures.push(`hostile library setup failed: ${(hostile.stderr || hostile.stdout).trim()}`);
else {
  try {
    const packageJson = JSON.parse(await readFile(join(hostileOutput, "package.json"), "utf8"));
    if (packageJson.description !== hostileDescription) failures.push("JSON generation did not preserve hostile input");
    const readme = await readFile(join(hostileOutput, "README.md"), "utf8");
    if (readme.includes("<safe>") || !readme.includes("Grüß 日本語 🌱")) failures.push("hostile Markdown input was not encoded safely");
    const appConfig = await readFile(join(hostileOutput, "docs/app/app.config.ts"), "utf8");
    if (!appConfig.includes("name: { en: 'Bob\\'s App' }") || !appConfig.includes("scriptId: ''")) failures.push("TypeScript generation or optional analytics is invalid");
    const markdown = await readFile(join(hostileOutput, "docs/content/docs/1.getting-started/1.index.md"), "utf8");
    const frontmatterDescription = markdown.split("\n").find(line => line.startsWith("description: "))?.slice("description: ".length);
    if (!frontmatterDescription || JSON.parse(frontmatterDescription) !== "Install Bob's App and use its first API.") failures.push("Markdown frontmatter did not preserve the title");
  } catch (error) {
    failures.push(`hostile output is invalid: ${error.message}`);
  }
}

const retryOutput = join(materializedRoot, "retry-library");
const invalid = spawnSync(process.execPath, [
  new URL("library/setup.mjs", root).pathname,
  "--output", retryOutput,
  "--name", "retry-library",
  "--title", "{{UNRESOLVED}}",
  "--description", "Must fail atomically.",
  "--repository", "lupinum-dev/retry-library",
  "--domain", "retry-library.lupinum.com",
], { encoding: "utf8" });
if (invalid.status === 0) failures.push("unresolved hostile token must fail generation");
if (await exists(retryOutput)) failures.push("failed generation left its final output behind");
if ((await readdir(materializedRoot)).some(name => name.startsWith(".retry-library.tmp-"))) failures.push("failed generation left a temporary directory behind");
const retry = spawnSync(process.execPath, [
  new URL("library/setup.mjs", root).pathname,
  "--output", retryOutput,
  "--name", "retry-library",
  "--title", "Retry Library",
  "--description", "The retry succeeds.",
  "--repository", "lupinum-dev/retry-library",
  "--domain", "retry-library.lupinum.com",
], { encoding: "utf8" });
if (retry.status !== 0) failures.push(`retry after atomic failure failed: ${(retry.stderr || retry.stdout).trim()}`);

const existingOutput = join(materializedRoot, "existing-output");
await mkdir(existingOutput);
await writeFile(join(existingOutput, "keep.txt"), "keep\n");
const existing = spawnSync(process.execPath, [
  new URL("app/setup.mjs", root).pathname,
  "--output", existingOutput,
  "--name", "existing-app",
  "--title", "Existing App",
  "--description", "Must not overwrite output.",
  "--repository", "lupinum-dev/existing-app",
  "--domain", "existing-app.lupinum.com",
], { encoding: "utf8" });
if (existing.status === 0 || await readFile(join(existingOutput, "keep.txt"), "utf8") !== "keep\n") failures.push("existing non-empty output was not preserved");

const rejectionCases = [
  ["duplicate flag", "library/setup.mjs", ["--name", "one", "--name", "two"]],
  ["duplicate package", "library-monorepo/setup.mjs", ["--package", "@lupinum/same", "--package", "@lupinum/same"]],
  ["package directory collision", "library-monorepo/setup.mjs", ["--package", "@lupinum/same", "--package", "@other/same"]],
];
for (const [label, setup, extra] of rejectionCases) {
  const output = join(materializedRoot, `reject-${label.replaceAll(" ", "-")}`);
  const baseArguments = [
    new URL(setup, root).pathname,
    "--output", output,
    "--name", "reject-case",
    "--title", "Reject Case",
    "--description", "This input must be rejected.",
    "--repository", "lupinum-dev/reject-case",
    "--domain", "reject-case.lupinum.com",
  ];
  const result = spawnSync(process.execPath, [...baseArguments, ...extra], { encoding: "utf8" });
  if (result.status === 0 || await exists(output)) failures.push(`${label} was not rejected atomically`);
}

const generatedMonorepo = join(materializedRoot, "library-monorepo");
for (const directory of ["test-core", "test-vue", "test-nuxt"]) {
  if (!(await exists(join(generatedMonorepo, "packages", directory, "package.json")))) failures.push(`three-package monorepo is missing packages/${directory}`);
}
try {
  const docsManifest = JSON.parse(await readFile(join(generatedMonorepo, "docs/package.json"), "utf8"));
  for (const name of ["@lupinum/test-core", "@lupinum/test-vue", "@lupinum/test-nuxt"]) {
    if (docsManifest.dependencies[name] !== "workspace:*") failures.push(`documentation manifest is missing ${name}`);
  }
  const monorepoReadme = await readFile(join(generatedMonorepo, "README.md"), "utf8");
  if (!monorepoReadme.includes("pnpm add @lupinum/test-vue")) failures.push("explicit primary package is not used by documentation");
} catch (error) {
  failures.push(`cannot verify three-package monorepo: ${error.message}`);
}

} catch (error) {
  failures.push(`Starter verification stopped: ${error.message}`);
} finally {
  await rm(materializedRoot, { recursive: true, force: true });
}

if (failures.length) {
  console.error(failures.map(failure => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("All Lupinum OSS starter contracts passed.");
