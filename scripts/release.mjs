#!/usr/bin/env node
// Release helper for @yanit/rmd
//
// Usage:
//   node scripts/release.mjs            # bump patch by 1 (0.1.3 -> 0.1.4), commit, tag, push
//   node scripts/release.mjs 0.2.0      # set an explicit version, commit, tag, push
//   node scripts/release.mjs --dry-run  # show what would change, do nothing
//
// This script:
//   1. reads current version from package.json
//   2. computes the next version (patch+1, or the one you pass)
//   3. updates package.json (version + all optionalDependencies), Cargo.toml (version)
//   4. regenerates package-lock.json via `npm install` (keeps `npm ci` in CI happy)
//   5. commits, creates tag vX.Y.Z, pushes master + tag
//
// CI takes over from the tag: it syncs the publish version from the tag name,
// builds the 6 platforms and publishes @yanit/rmd@X.Y.Z with its platform sub-packages.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
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

const VERSION_RE = /^\d+\.\d+\.\d+$/;

function nextPatch(v) {
  const [maj, min, pat] = v.split(".").map(Number);
  return `${maj}.${min}.${pat + 1}`;
}

// --- read current version ---
const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;

if (!VERSION_RE.test(current)) {
  console.error(`Current version "${current}" is not in x.y.z form.`);
  process.exit(1);
}

const target = explicit ?? nextPatch(current);

if (!VERSION_RE.test(target)) {
  console.error(`Target version "${target}" is not in x.y.z form.`);
  process.exit(1);
}
if (explicit && target === current) {
  console.error(`Target version equals current (${current}). Bump it.`);
  process.exit(1);
}
if (!explicit) {
  const cur = current.split(".").map(Number);
  const tgt = target.split(".").map(Number);
  if (
    tgt[0] < cur[0] ||
    (tgt[0] === cur[0] && tgt[1] < cur[1]) ||
    (tgt[0] === cur[0] && tgt[1] === cur[1] && tgt[2] <= cur[2])
  ) {
    console.error(`Target ${target} must be greater than current ${current}.`);
    process.exit(1);
  }
}

console.log(`Release plan: ${current}  ->  ${target}`);

// --- safety: clean working tree ---
const status = runCapture("git", ["status", "--porcelain"]);
if (status && !DRY_RUN) {
  console.error("Working tree is not clean. Commit or stash your changes first:\n" + status);
  process.exit(1);
}
// make sure we are on the default branch and up to date enough
const branch = runCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
console.log(`Current branch: ${branch}`);

// --- update package.json ---
const updatedPkg = {
  ...pkg,
  version: target,
  optionalDependencies: Object.fromEntries(
    Object.entries(pkg.optionalDependencies || {}).map(([k]) => [k, target])
  ),
};
writeFileSync(pkgPath, JSON.stringify(updatedPkg, null, 2) + "\n");

// --- update Cargo.toml (version = "x.y.z") ---
const cargoPath = join(root, "Cargo.toml");
let cargo = readFileSync(cargoPath, "utf8");
cargo = cargo.replace(/^version = .*$/m, `version = "${target}"`);
writeFileSync(cargoPath, cargo);

// --- regenerate lockfile so `npm ci` in CI stays happy ---
if (!DRY_RUN) {
  run("npm", ["install"]);
} else {
  console.log("(dry-run) would run: npm install  # to resync package-lock.json");
}

// --- git commit + tag + push ---
const tag = `v${target}`;
const commitMsg = `chore: release ${target}`;
const tagMsg = `Release ${target}`;

if (DRY_RUN) {
  console.log(`\n[DRY RUN] would execute:`);
  console.log(`  git add package.json Cargo.toml package-lock.json`);
  console.log(`  git commit -m "${commitMsg}"`);
  console.log(`  git tag -a ${tag} -m "${tagMsg}"`);
  console.log(`  git push origin ${branch}`);
  console.log(`  git push origin ${tag}`);
  console.log(`\nNo changes made.`);
  process.exit(0);
}

run("git", ["add", "package.json", "Cargo.toml", "package-lock.json"]);
run("git", ["commit", "-m", commitMsg]);
run("git", ["tag", "-a", tag, "-m", tagMsg]);
run("git", ["push", "origin", branch]);
run("git", ["push", "origin", tag]);

console.log(`\n✅ Released ${target}. Tag ${tag} pushed — CI will build & publish @yanit/rmd@${target}.`);
console.log(`   Watch it at: https://github.com/yanxxit/rmd/actions`);
