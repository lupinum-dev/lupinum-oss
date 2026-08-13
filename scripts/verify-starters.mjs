import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../starters/", import.meta.url);
const profiles = ["library", "library-monorepo", "app"];
const failures = [];

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
  for (const path of await walk(base.pathname)) {
    if (!path.endsWith(".yml") && !path.endsWith(".yaml")) continue;
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(/\buses:\s*([^\s#]+)/g)) {
      if (!/@[0-9a-f]{40}$/.test(match[1])) failures.push(`${profile} uses mutable action ${match[1]}`);
    }
    if (source.includes("actions/checkout@") && !source.includes("persist-credentials: false")) {
      failures.push(`${profile} persists checkout credentials in ${path.slice(base.pathname.length)}`);
    }
  }
}

if (failures.length) {
  console.error(failures.map(failure => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("All Lupinum OSS starter contracts passed.");
