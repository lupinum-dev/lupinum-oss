import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const failures = [];

const required = [
  ".github/CODEOWNERS",
  ".github/pull_request_template.md",
  ".github/workflows/ci.yml",
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
  const source = await readFile(path, "utf8");
  for (const match of source.matchAll(/\buses:\s*([^\s#]+)/g)) {
    const reference = match[1];
    if (!/@[0-9a-f]{40}$/.test(reference)) {
      failures.push(`${relative(repositoryRoot, path)} uses a mutable action reference: ${reference}`);
    }
  }
  if (source.includes("actions/checkout@") && !source.includes("persist-credentials: false")) {
    failures.push(`${relative(repositoryRoot, path)} persists checkout credentials.`);
  }
}

for (const path of await walk(repositoryRoot)) {
  const rel = relative(repositoryRoot, path);
  if (!/\.(?:md|json|ya?ml|mjs|ts|vue)$/.test(path)) continue;
  const source = await readFile(path, "utf8");
  if (/^\s*NPM_TOKEN\s*[:=]/m.test(source) || /secrets\.NPM_TOKEN\b/.test(source)) {
    failures.push(`${rel} configures a forbidden npm token.`);
  }
}

if (failures.length) {
  console.error(failures.map(failure => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("Lupinum OSS repository contract passed.");
