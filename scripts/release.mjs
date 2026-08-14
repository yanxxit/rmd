#!/usr/bin/env node
// Local publish helper for @yanit/rmd
//
// Usage:
//   node scripts/release.mjs            # bump patch by 1 (0.1.3 -> 0.1.4), build all, publish
//   node scripts/release.mjs 0.2.0      # set an explicit version
//   node scripts/release.mjs --dry-run  # show what would change, do nothing
//   node scripts/release.mjs --no-publish  # bump + build, but skip `npm publish`
//                                        # (used by release-and-push.mjs which
//                                        #  commits, tags and pushes instead)
//
// This script:
//   1. reads current version from package.json
//   2. computes the next version (patch+1, or the one you pass)
//   3. updates package.json (version) + Cargo.toml (version)
//   4. regenerates package-lock.json via `npm install`
//   5. builds all platforms into the repo root (index.<platform>.node)
//   6. runs `npm publish --access public` (unless --no-publish)
//
// The main package now ships every prebuilt .node binary directly (no
// per-platform sub-packages), so publishing is a single local step — no
// GitHub Actions / git tags required.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
const runCapture = (cmd, args) =>
  execFileSync(cmd, args, { cwd: root, encoding: "utf8" }).trim();

// git wrapper: prints the exact command being run, for maintainability.
const git = (args) => {
  console.log(`  $ git ${args.join(" ")}`);
  return run("git", args);
};
const gitCapture = (args) => runCapture("git", args);

const DRY_RUN = process.argv.includes("--dry-run");
const NO_PUBLISH = process.argv.includes("--no-publish");
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
console.log("  $ git status --porcelain");
const status = gitCapture(["status", "--porcelain"]);
if (status && !DRY_RUN) {
  console.error("Working tree is not clean. Commit or stash your changes first:\n" + status);
  process.exit(1);
}

// --- update package.json ---
const updatedPkg = { ...pkg, version: target };
writeFileSync(pkgPath, JSON.stringify(updatedPkg, null, 2) + "\n");

// --- update Cargo.toml (version = "x.y.z") ---
const cargoPath = join(root, "Cargo.toml");
let cargo = readFileSync(cargoPath, "utf8");
cargo = cargo.replace(/^version = .*$/m, `version = "${target}"`);
writeFileSync(cargoPath, cargo);

// --- regenerate lockfile ---
if (!DRY_RUN) {
  run("npm", ["install"]);
} else {
  console.log("(dry-run) would run: npm install");
}

// --- build all platforms ---
if (DRY_RUN) {
  console.log("(dry-run) would run: npm run build:all");
} else {
  run("npm", ["run", "build:all"]);
}

// --- pre-publish sanity: at least the current platform's .node must exist ---
const platformNode = findLocalNode();
if (!platformNode && !DRY_RUN) {
  console.error(
    "No .node binary was produced by the build. Aborting publish."
  );
  process.exit(1);
}

if (DRY_RUN) {
  console.log(`\n[DRY RUN] would execute:`);
  console.log(`  npm publish --access public`);
  console.log(`\nNo changes published.`);
  process.exit(0);
}

// --- publish (unless skipped) ---
if (NO_PUBLISH) {
  console.log(
    `\n⏭️  Skipped npm publish (--no-publish). Version is now ${target}.`
  );
  process.exit(0);
}

run("npm", ["publish", "--access", "public"]);

console.log(`\n✅ Published @yanit/rmd@${target} to npm.`);
console.log(`   npm: https://www.npmjs.com/package/@yanit/rmd`);

function findLocalNode() {
  return readdirSync(root).find((f) => f.endsWith(".node"));
}
