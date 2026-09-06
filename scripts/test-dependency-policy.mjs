import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { checkDependencyPolicy } from "./check-dependency-policy.mjs";

const root = new URL("../", import.meta.url);
const now = Date.parse("2026-09-06T12:00:00Z");
const base = "minimumReleaseAge: 1440\nminimumReleaseAgeStrict: true\nminimumReleaseAgeIgnoreMissingTime: false\n";
const metadata = { reason: "Reviewed incident fix", owner: "mat4m0", expires: "2026-09-06T13:00:00Z" };
const exclusion = (name = "@lupinum/example@1.2.3-rc.1", record = metadata) => `minimumReleaseAgeExclude:\n  - '${name}' # ${JSON.stringify(record)}\n`;
assert.deepEqual(checkDependencyPolicy(base, now), []);
assert.deepEqual(checkDependencyPolicy(base + exclusion(), now), []);
assert.deepEqual(checkDependencyPolicy(base + "minimumReleaseAgeExclude: []\n", now), []);
for (const [label, source, expected] of [
  ["expiry boundary", base + exclusion(undefined, { ...metadata, expires: "2026-09-06T12:00:00Z" }), /expired/],
  ["expired", base + exclusion(undefined, { ...metadata, expires: "2026-09-05T12:00:00Z" }), /expired/],
  ["invalid calendar date", base + exclusion(undefined, { ...metadata, expires: "2026-02-30T12:00:00Z" }), /valid UTC/],
  ["missing timezone", base + exclusion(undefined, { ...metadata, expires: "2026-09-06T13:00:00" }), /valid UTC/],
  ["long-lived", base + exclusion(undefined, { ...metadata, expires: "2027-09-06T13:00:00Z" }), /within 24 hours/],
  ["blank reason", base + exclusion(undefined, { ...metadata, reason: " " }), /reason, owner/],
  ["missing owner", base + exclusion(undefined, { ...metadata, owner: undefined }), /reason, owner/],
  ["missing metadata", base + "minimumReleaseAgeExclude: [foo@1.2.3]\n", /inline JSON/],
  ["range", base + exclusion("foo@^1.2.3"), /exact/],
  ["glob", base + exclusion("@lupinum/*"), /exact/],
  ["leading-zero semver", base + exclusion("foo@1.2.3-01"), /exact/],
  ["object exclusion", base + "minimumReleaseAgeExclude: {foo: bar}\n", /list/],
  ["duplicate setting", base + "minimumReleaseAge: 0\n", /unique/],
  ["commented setting", base.replace("minimumReleaseAge: 1440", "# minimumReleaseAge: 1440"), /must be 1440/],
  ["weakened policy", base.replace("minimumReleaseAge: 1440", "minimumReleaseAge: 0"), /must be 1440/],
  ["duplicate exception", base + exclusion() + `  - '@lupinum/example@1.2.3-rc.1' # ${JSON.stringify(metadata)}\n`, /duplicate quarantine/],
]) {
  assert.match(checkDependencyPolicy(source, now).join("\n"), expected, label);
}

// Run each repository-owned command against a real file, including generated installs.
const temporary = await mkdtemp(join(tmpdir(), "lupinum-dependency-policy-"));
try {
  for (const profile of ["root", "library", "library-monorepo", "app"]) {
    const destination = join(temporary, profile);
    const source = profile === "root" ? root : new URL(`starters/${profile}/`, root);
    const ci = parse(await readFile(new URL(".github/workflows/ci.yml", source), "utf8"));
    assert.ok(ci.on.schedule.some(({ cron }) => cron === "23 4 * * *"), `${profile}: daily expiry trigger`);
    for (const event of ["pull_request", "push", "23 4 * * *", ...(profile === "root" ? [] : ["17 3 * * 1"])]) {
      const steps = ci.jobs.verify.steps.filter((step) => {
        if (!step.if) return true;
        const condition = /^github\.event\.schedule (==|!=) '23 4 \* \* \*'$/.exec(step.if);
        assert.ok(condition, `${profile}: review new CI condition ${step.if}`);
        return condition[1] === "==" ? event === "23 4 * * *" : event !== "23 4 * * *";
      });
      const commands = steps.map((step) => step.run).filter(Boolean);
      if (event === "23 4 * * *") {
        assert.ok(commands.includes("pnpm install --frozen-lockfile --ignore-scripts"));
        assert.ok(commands.includes("pnpm check:dependencies"));
        if (profile === "root") assert.ok(commands.includes("pnpm starters:verify"));
        assert.ok(!commands.some((command) => /^pnpm (?:verify|release:verify)$/.test(command)));
        assert.ok(!steps.some((step) => step.uses?.startsWith("actions/upload-artifact@")));
      } else {
        assert.ok(commands.includes("pnpm install --frozen-lockfile"));
        assert.ok(commands.some((command) => /^pnpm (?:verify|release:verify)$/.test(command)));
      }
    }
    if (profile === "root") {
      await mkdir(join(destination, "scripts"), { recursive: true });
      await cp(new URL("scripts/check-dependency-policy.mjs", source), join(destination, "scripts/check-dependency-policy.mjs"));
      await cp(new URL("pnpm-workspace.yaml", source), join(destination, "pnpm-workspace.yaml"));
      await cp(new URL("package.json", source), join(destination, "package.json"));
    } else {
      const result = spawnSync(process.execPath, [new URL("setup.mjs", source).pathname,
        "--output", destination, "--name", `policy-${profile}`, "--title", "Policy test",
        "--description", "Dependency policy test", "--repository", `lupinum-dev/policy-${profile}`,
        "--domain", "policy.lupinum.com",
        ...(profile === "app" ? [] : ["--package", "@lupinum/policy-test"]),
        ...(profile === "library-monorepo" ? ["--package", "@lupinum/policy-two"] : [])], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    await symlink(new URL("node_modules", root).pathname, join(destination, "node_modules"));
    const manifest = JSON.parse(await readFile(join(destination, "package.json"), "utf8"));
    assert.ok(manifest.scripts.verify.startsWith("pnpm check:dependencies && "));
    const run = () => spawnSync("pnpm", ["check:dependencies"], { cwd: destination, encoding: "utf8" });
    assert.equal(run().status, 0, `${profile}: maintained configuration passes`);
    const config = join(destination, "pnpm-workspace.yaml");
    const original = await readFile(config, "utf8");
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    await writeFile(config, original + "\n" + exclusion(undefined, { ...metadata, expires: future }));
    assert.equal(run().status, 0, `${profile}: live exception passes`);
    await writeFile(config, original + "\n" + exclusion(undefined, { ...metadata, expires: "2020-01-01T00:00:00Z" }));
    const failed = run();
    assert.equal(failed.status, 1, `${profile}: expired actual install exception fails`);
    assert.match(failed.stderr + failed.stdout, /quarantine exception expired/);
    await writeFile(config, original);
    const generatedConfig = join(destination, "fixture-workspace.yaml");
    await writeFile(generatedConfig, original + "\n" + exclusion(undefined, { ...metadata, expires: "2020-01-01T00:00:00Z" }));
    const fixtureResult = spawnSync(process.execPath,
      [join(destination, "scripts/check-dependency-policy.mjs"), generatedConfig],
      { cwd: temporary, encoding: "utf8" });
    assert.equal(fixtureResult.status, 1, `${profile}: explicit generated install config fails`);
    assert.match(fixtureResult.stderr, /quarantine exception expired/);
    assert.equal(run().status, 0, `${profile}: removal restores verification`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log("Dependency policy positive, negative, and generated-repository tests passed.");
