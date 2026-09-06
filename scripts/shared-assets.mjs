import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const root = new URL("../", import.meta.url);
const assets = {
  "starters/_shared/vercel-preview.yml": [
    ".github/workflows/vercel-preview.yml",
    "starters/library/.github/workflows/vercel-preview.yml",
    "starters/library-monorepo/.github/workflows/vercel-preview.yml",
  ],
  "starters/_shared/check-dependency-policy.mjs": [
    "scripts/check-dependency-policy.mjs",
    ...["library", "library-monorepo", "app"].map((profile) => `starters/${profile}/scripts/check-dependency-policy.mjs`),
  ],
};
const write = process.argv.slice(2).includes("--write");

if (process.argv.length > (write ? 3 : 2)) {
  throw new Error("Usage: node scripts/shared-assets.mjs [--write]");
}

const drift = [];
for (const [canonical, targets] of Object.entries(assets)) {
  const source = await readFile(new URL(canonical, root), "utf8");

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
}

if (drift.length) {
  console.error(drift.map((path) => `- ${path} differs from its canonical source`).join("\n"));
  console.error("Run `pnpm shared:sync` and review the generated copies.");
  process.exit(1);
}

console.log(write ? "Shared asset copies updated." : "Shared asset copies match the canonical source.");
