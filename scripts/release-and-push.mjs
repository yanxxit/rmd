#!/usr/bin/env node
// Release + push helper for @yanit/rmd
//
// Flow:
//   1. `npm run release -- --no-publish`  -> auto-bump version, update
//      package.json + Cargo.toml, build all platforms (no npm publish)
//   2. git add + commit the version bump (package.json, Cargo.toml, lock, .node)
//   3. create a git tag  vX.Y.Z  pointing at that commit
//   4. push the branch AND the tag to origin
//
// After the tag is pushed, .github/workflows/CI.yml takes over and publishes
// the package to npm (so local flow never calls `npm publish`).
//
// Usage:
//   node scripts/release-and-push.mjs            # bump patch+1, commit, tag, push
//   node scripts/release-and-push.mjs 0.2.0      # explicit version
//   node scripts/release-and-push.mjs --dry-run  # show plan, change nothing

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
const runCapture = (cmd, args) =>
  execFileSync(cmd, args, { cwd: root, encoding: "utf8" }).trim();

const DRY_RUN = process.argv.includes("--dry-run");
const explicit = process.argv.slice(2).find((a) => !a.startsWith("--"));

// --- 1. bump + build (no publish) ---
const versionArgs = explicit ? [explicit] : [];

console.log("==> Step 1: bump version + build (no publish)");
run("npm", [
  "run",
  "release",
  "--",
  "--no-publish",
  ...versionArgs,
  ...(DRY_RUN ? ["--dry-run"] : []),
]);

if (DRY_RUN) {
  console.log("\n[DRY RUN] would then:");
  console.log("  git add -A && git commit -m \"chore: 发布 X.Y.Z 版本\"");
  console.log("  git tag vX.Y.Z");
  console.log("  git push origin <branch> && git push origin vX.Y.Z");
  console.log("\nNothing committed or pushed.");
  process.exit(0);
}

// --- read the bumped version from package.json ---
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const newVersion = pkg.version;
const tag = `v${newVersion}`;
const branch = runCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);

// --- 2. commit ---
console.log(`\n==> Step 2: commit version ${newVersion}`);
const status = runCapture("git", ["status", "--porcelain"]);
if (!status) {
  console.log("Working tree already clean — nothing to commit.");
} else {
  run("git", ["add", "-A"]);
  run("git", ["commit", "-m", `chore: 发布 ${newVersion} 版本`]);
}

// --- 3. tag ---
console.log(`\n==> Step 3: create tag ${tag}`);
const existingTags = runCapture("git", ["tag"]).split("\n");
if (existingTags.includes(tag)) {
  console.error(`Tag ${tag} already exists. Aborting to avoid duplicate push.`);
  process.exit(1);
}
run("git", ["tag", tag]);

// --- 4. push branch + tag ---
console.log(`\n==> Step 4: push ${branch} and ${tag} to origin`);
run("git", ["push", "origin", branch]);
run("git", ["push", "origin", tag]);

console.log(`\n✅ Released ${newVersion} and pushed tag ${tag} to origin.`);
console.log(`   CI will now build & publish @yanit/rmd@${newVersion} to npm.`);
