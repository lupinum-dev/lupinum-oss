import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const root = new URL("../", import.meta.url);
const canonical = new URL("starters/_shared/vercel-preview.yml", root);
const targets = [
  ".github/workflows/vercel-preview.yml",
  "starters/library/.github/workflows/vercel-preview.yml",
  "starters/library-monorepo/.github/workflows/vercel-preview.yml",
];
const write = process.argv.slice(2).includes("--write");

if (process.argv.length > (write ? 3 : 2)) {
  throw new Error("Usage: node scripts/shared-assets.mjs [--write]");
}

const source = await readFile(canonical, "utf8");
const drift = [];

for (const path of targets) {
  const target = new URL(path, root);
  if (write) {
    await mkdir(dirname(target.pathname), { recursive: true });
    await writeFile(target, source);
    continue;
  }

  try {
    if (await readFile(target, "utf8") !== source) drift.push(path);
  } catch {
    drift.push(path);
  }
}

if (drift.length) {
  console.error(drift.map((path) => `- ${path} differs from ${canonical.pathname}`).join("\n"));
  console.error("Run `pnpm shared:sync` and review the generated copies.");
  process.exit(1);
}

console.log(write ? "Shared workflow copies updated." : "Shared workflow copies match the canonical source.");
