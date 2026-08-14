// Test suite for @yanit/rmd (ESM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { removeSync, removeAsync, pathExists } from "../index.js";
import { generate, parseSize } from "../bin/gen.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function ok(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

function section(t) {
  console.log(`\n# ${t}`);
}

async function mkdtemp(prefix) {
  return await fs.mkdtemp(join(tmpdir(), prefix));
}

function makeFile(p, content = "x") {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

// --------------------------------------------------------------------------
section("basics");
{
  const d = await mkdtemp("rmd-basic-");
  makeFile(join(d, "a.txt"), "hello");
  makeFile(join(d, "sub", "b.txt"), "world");
  ok("pathExists true before", pathExists(d));
  removeSync(d);
  ok("pathExists false after", !pathExists(d));
}

// #2 idempotent on missing path
{
  const d = await mkdtemp("rmd-idem-");
  const gone = join(d, "nope");
  let threw = false;
  try {
    removeSync(gone);
  } catch (e) {
    threw = true;
  }
  ok("removeSync missing path is no-op", !threw);
}

// #3 single file
{
  const d = await mkdtemp("rmd-file-");
  const f = join(d, "single.txt");
  makeFile(f, "123");
  removeSync(f);
  ok("single file removed", !existsSync(f));
}

// #4 nested deep tree
{
  const d = await mkdtemp("rmd-deep-");
  const r = generate({ dir: d, count: 50, size: parseSize("1k"), depth: 3 });
  ok("generated files", r.files === 50);
  removeSync(d);
  ok("deep tree removed", !pathExists(d));
}

// #5 readonly file handling (best-effort on this platform)
{
  const d = await mkdtemp("rmd-ro-");
  makeFile(join(d, "ro.txt"), "ro");
  try {
    await fs.chmod(join(d, "ro.txt"), 0o444);
  } catch (_) {}
  let threw = false;
  try {
    removeSync(d);
  } catch (e) {
    threw = true;
  }
  ok("readonly dir removed without error", !threw && !pathExists(d));
}

// #6 async variant
{
  const d = await mkdtemp("rmd-async-");
  makeFile(join(d, "a.txt"));
  await removeAsync(d);
  ok("removeAsync works", !pathExists(d));
}

// #7 array of targets
{
  const base = await mkdtemp("rmd-arr-");
  const d1 = join(base, "x");
  const d2 = join(base, "y");
  makeFile(join(d1, "a"));
  makeFile(join(d2, "b"));
  removeSync([d1, d2]);
  ok("array targets both removed", !pathExists(d1) && !pathExists(d2));
}

// #8 cwd+relative path
{
  const d = await mkdtemp("rmd-rel-");
  makeFile(join(d, "rel.txt"));
  const cwd = process.cwd();
  process.chdir(d);
  try {
    removeSync("rel.txt");
    ok("relative path removed", !existsSync(join(d, "rel.txt")));
  } finally {
    process.chdir(cwd);
  }
}

// #9 symlink handling (must remove link, NOT target)
{
  const base = await mkdtemp("rmd-sym-");
  const target = join(base, "target");
  makeFile(target, "KEEP");
  const link = join(base, "link");
  try {
    symlinkSync(target, link);
  } catch (e) {
    console.log("  (symlink unsupported on this platform, skipping)");
  }
  if (existsSync(link)) {
    removeSync(link);
    ok("symlink: link removed", !existsSync(link));
    ok("symlink: target preserved", existsSync(target));
    removeSync(target);
  } else {
    ok("symlink: link removed (skipped)", true);
    ok("symlink: target preserved (skipped)", true);
  }
  removeSync(base);
}

// #9b symlink-to-directory must NOT delete the directory's contents
{
  const base = await mkdtemp("rmd-symdir-");
  const realdir = join(base, "realdir");
  mkdirSync(realdir, { recursive: true });
  makeFile(join(realdir, "secret.txt"), "do-not-delete");
  const linkdir = join(base, "linkdir");
  try {
    symlinkSync(realdir, linkdir, "dir");
  } catch (e) {
    console.log("  (dir symlink unsupported, skipping #9b)");
  }
  if (existsSync(linkdir)) {
    removeSync(linkdir);
    ok("#9b linkdir removed", !existsSync(linkdir));
    ok("#9b realdir + content preserved", existsSync(realdir) && existsSync(join(realdir, "secret.txt")));
    removeSync(realdir);
  } else {
    ok("#9b linkdir removed (skipped)", true);
    ok("#9b realdir preserved (skipped)", true);
  }
  removeSync(base);
}

// #9c integration: large parallel delete + symlinks must not delete targets
// (Guard for the parallel-deletion feature — runs the same code path.)
{
  const base = await mkdtemp("rmd-parallel-");
  const tree = join(base, "tree");
  const outside = join(base, "outside");
  mkdirSync(outside, { recursive: true });
  makeFile(join(outside, "keep.txt"), "keep");
  // generate a big tree (400 files across 4 levels)
  const r = generate({ dir: tree, count: 400, size: parseSize("512"), depth: 4, prefix: "f" });
  ok("#9c generated big tree", r.files === 400);
  // create symlinks pointing OUTSIDE the tree (file, dir, deep-dir)
  try {
    symlinkSync(join(outside, "keep.txt"), join(tree, "lnk_out_file"));
    symlinkSync(outside, join(tree, "lnk_out_dir"), "dir");
    symlinkSync(join(outside, "keep.txt"), join(tree, "deep", "lnk_deep"));
  } catch (_) {}
  removeSync(tree);
  ok("#9c tree removed", !pathExists(tree));
  ok("#9c outside target preserved", existsSync(outside) && existsSync(join(outside, "keep.txt")));
  removeSync(outside);
  removeSync(base);
}

// --------------------------------------------------------------------------
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
