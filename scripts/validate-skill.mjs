import { readFile } from "node:fs/promises";

const skillRoot = new URL("../skill/lupinum-oss/", import.meta.url);
const failures = [];

async function load(path) {
  try {
    return await readFile(new URL(path, skillRoot), "utf8");
  } catch {
    failures.push(`Missing skill file: ${path}`);
    return "";
  }
}

const skill = await load("SKILL.md");
const metadata = await load("agents/openai.yaml");
if (!skill.startsWith("---\nname: lupinum-oss\ndescription:")) failures.push("Skill frontmatter is invalid.");
if (!skill.includes("read its `AGENTS.md` and `MAINTAINING.md` completely")) failures.push("Skill must prioritize repository-local instructions.");
if (!skill.includes("https://oss.lupinum.com")) failures.push("Skill must route detailed policy to the public handbook.");
if (skill.split("\n").length > 500) failures.push("SKILL.md must stay below 500 lines.");
if (!metadata.includes('display_name: "Lupinum OSS"')) failures.push("Skill UI metadata is missing its display name.");
if (!metadata.includes("$lupinum-oss")) failures.push("Skill UI prompt must name $lupinum-oss.");

if (failures.length) {
  console.error(failures.map(failure => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("Lupinum OSS skill contract passed.");
