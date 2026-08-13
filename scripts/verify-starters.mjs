import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    "template.json",
  ];
  if (profile !== "app") required.push(".github/workflows/package-preview.yml", ".github/workflows/publish.yml");
  for (const path of required) {
    if (!(await exists(new URL(path, base)))) failures.push(`${profile} is missing ${path}`);
  }
  if (!(await exists(new URL("package.json", base)))) continue;
  const manifest = JSON.parse(await readFile(new URL("package.json", base), "utf8"));
  for (const command of ["verify", "docs:build", "audit:all", "release:verify"]) {
    if (!manifest.scripts?.[command]) failures.push(`${profile} is missing command ${command}`);
  }
  const workspace = await readFile(new URL("pnpm-workspace.yaml", base), "utf8");
  for (const setting of ["minimumReleaseAge: 1440", "minimumReleaseAgeStrict: true", "minimumReleaseAgeIgnoreMissingTime: false"]) {
    if (!workspace.includes(setting)) failures.push(`${profile} is missing ${setting}`);
  }
  if (!workspace.includes("esbuild: 0.28.2")) failures.push(`${profile} is missing the reviewed esbuild security override`);

  const readme = await readFile(new URL("README.md", base), "utf8");
  for (const contract of ['width="128"', "## Why use ", "## Requirements", "## Installation", "## Quick start", "## Documentation", "## Support and security", "## License"]) {
    if (!readme.includes(contract)) failures.push(`${profile} README is missing ${contract}`);
  }
  if ((readme.match(/<h1\b/g) ?? []).length !== 1) failures.push(`${profile} README must contain one H1`);

  if (profile !== "app") {
    const changelog = await readFile(new URL("CHANGELOG.md", base), "utf8");
    if (!/^## v0\.1\.0\s*$/m.test(changelog)) failures.push(`${profile} needs an initial v0.1.0 changelog entry`);
  }
  for (const path of await walk(base.pathname)) {
    if (!path.endsWith(".yml") && !path.endsWith(".yaml")) continue;
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(/\buses:\s*([^\s#]+)/g)) {
      if (!/@[0-9a-f]{40}$/.test(match[1])) failures.push(`${profile} uses mutable action ${match[1]}`);
    }
    if (source.includes("actions/checkout@") && !source.includes("persist-credentials: false")) {
      failures.push(`${profile} persists checkout credentials in ${path.slice(base.pathname.length)}`);
    }
    if (/secrets\.(?:NPM_TOKEN|NODE_AUTH_TOKEN|GH_TOKEN)|^\s*(?:NPM_TOKEN|NODE_AUTH_TOKEN)\s*:/m.test(source)) {
      failures.push(`${profile} configures a long-lived publication token in ${path.slice(base.pathname.length)}`);
    }
  }


  if (profile === "app") {
    const plausible = await readFile(new URL("app/composables/usePlausible.ts", base), "utf8");
    if ((plausible.match(/useScriptPlausibleAnalytics/g) ?? []).length !== 1 || plausible.includes("useHead(")) {
      failures.push("app must load Plausible exactly once through the Nuxt Scripts registry");
    }
  } else {
    const preview = await readFile(new URL(".github/workflows/package-preview.yml", base), "utf8");
    if (!preview.includes("github.event.pull_request.head.repo.full_name == github.repository")) failures.push(`${profile} preview must reject automatic fork execution`);
    if (!preview.includes("permissions:") || !preview.includes("contents: read")) failures.push(`${profile} preview must be read-only`);

    const publish = await readFile(new URL(".github/workflows/publish.yml", base), "utf8");
    for (const boundary of ["environment: npm", "id-token: write", "actions/download-artifact@", "--provenance", "--ignore-scripts", "dist.shasum"]) {
      if (!publish.includes(boundary)) failures.push(`${profile} publish workflow is missing ${boundary}`);
    }
    const privilegedPublish = publish.split(/\n  publish:\s*\n/)[1]?.split(/\n  github-release:\s*\n/)[0] ?? "";
    if (privilegedPublish.includes("actions/checkout@") || privilegedPublish.includes("pnpm install")) {
      failures.push(`${profile} privileged publish job executes repository setup`);
    }
    const packer = await readFile(new URL("scripts/pack-release.mjs", base), "utf8");
    for (const field of ["sha256", "shasum", "distTag", "sourceSha"]) {
      if (!packer.includes(field)) failures.push(`${profile} release manifest is missing ${field}`);
    }
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
  if (profile === "library-monorepo") common.push("--package", "@lupinum/test-core", "--package", "@lupinum/test-nuxt");
  const generated = spawnSync(process.execPath, common, { encoding: "utf8" });
  if (generated.status !== 0) {
    failures.push(`${profile} setup failed: ${(generated.stderr || generated.stdout).trim()}`);
    continue;
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

await rm(materializedRoot, { recursive: true, force: true });

if (failures.length) {
  console.error(failures.map(failure => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("All Lupinum OSS starter contracts passed.");
