import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { checkWorkflow, containsNpmCredential, readWorkflow } from "./workflow-policy.mjs";

const root = new URL("../", import.meta.url);
const failures = [];

const required = [
  ".github/CODEOWNERS",
  ".github/pull_request_template.md",
  ".github/workflows/codeql.yml",
  ".github/workflows/ci.yml",
  ".coderabbit.yaml",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "MAINTAINING.md",
  "README.md",
  "SECURITY.md",
  "docs/WRITING.md",
  "package.json",
  "pnpm-workspace.yaml",
  "renovate.json",
  "scripts/verify-action-shas.mjs",
  "scripts/workflow-policy.mjs",
  "vercel.json",
];

async function text(path) {
  return readFile(new URL(path, root), "utf8");
}

async function exists(path) {
  try {
    await stat(new URL(path, root));
    return true;
  } catch {
    return false;
  }
}

for (const path of required) {
  if (!(await exists(path))) failures.push(`Missing required file: ${path}`);
}

const packageJson = JSON.parse(await text("package.json"));
for (const command of ["verify", "docs:build", "audit:all", "release:verify"]) {
  if (!packageJson.scripts?.[command]) failures.push(`Missing root command: ${command}`);
}
if (packageJson.private !== true) failures.push("The handbook workspace must stay private to npm.");
if (packageJson.devDependencies?.changelogen !== "0.6.2") failures.push("Changelogen must be pinned to 0.6.2.");

const workspace = await text("pnpm-workspace.yaml");
for (const setting of [
  "minimumReleaseAge: 1440",
  "minimumReleaseAgeStrict: true",
  "minimumReleaseAgeIgnoreMissingTime: false",
]) {
  if (!workspace.includes(setting)) failures.push(`Missing dependency policy: ${setting}`);
}
if (!workspace.includes('"fontless>esbuild": 0.28.2')) {
  failures.push("The handbook must keep the reviewed esbuild floor narrow to fontless.");
}
if (/^\s+esbuild:\s+0\.28\.2\s*$/mu.test(workspace)) {
  failures.push("The handbook must not override esbuild for the complete dependency graph.");
}

const readme = await text("README.md");
const headings = [
  "## Why use Lupinum OSS?",
  "## When to use it",
  "## Requirements",
  "## Installation",
  "## Quick start",
  "## Documentation",
  "## Contributing and development",
  "## Support and security",
  "## License",
];
let last = -1;
for (const heading of headings) {
  const index = readme.indexOf(heading);
  if (index === -1) failures.push(`README is missing: ${heading}`);
  if (index < last) failures.push(`README section is out of order: ${heading}`);
  last = index;
}
if ((readme.match(/<h1\b/g) ?? []).length !== 1) failures.push("README must contain one H1.");
if (!readme.includes('width="128"')) failures.push("README icon must use width 128.");
if (!readme.includes("https://oss.lupinum.com")) failures.push("README must link to the canonical site.");

const appConfig = await text("docs/app/app.config.ts");
if (!appConfig.includes('analytics: { plausible: { scriptId: "5fyE8fD6AUwglXv86unjX" } }')) {
  failures.push("The handbook must use the verified oss.lupinum.com Plausible script ID.");
}
if (!appConfig.includes("feedback: { enabled: true }")) {
  failures.push("The handbook must enable documentation feedback.");
}

async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", ".nuxt", ".output", ".vercel"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(path)));
    else paths.push(path);
  }
  return paths;
}

const repositoryRoot = new URL(".", root).pathname;
for (const path of await walk(join(repositoryRoot, ".github", "workflows"))) {
  const rel = relative(repositoryRoot, path);
  try {
    const { workflow } = await readWorkflow(path);
    failures.push(...checkWorkflow(rel, workflow));
  } catch (error) {
    failures.push(`${rel} is invalid YAML: ${error.message}`);
  }
}

for (const path of await walk(repositoryRoot)) {
  const rel = relative(repositoryRoot, path);
  let source;
  try { source = await readFile(path, "utf8"); } catch { continue; }
  if (source.includes("\0")) continue;
  if (containsNpmCredential(source)) failures.push(`${rel} configures a forbidden npm credential.`);
}

if (failures.length) {
  console.error(failures.map(failure => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("Lupinum OSS repository contract passed.");
