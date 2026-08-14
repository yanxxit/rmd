// Test suite for @yanit/rmd (ESM, uses node:test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs, existsSync, mkdirSync, symlinkSync, writeFileSync, lstatSync, chmodSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { removeSync, removeAsync, pathExists } from "../index.js";
import { generate, parseSize } from "../bin/gen.js";

const runCLI = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "bin", "rmd.js");

async function mkdtemp(prefix) {
  return fs.mkdtemp(join(tmpdir(), prefix));
}

function makeFile(p, content = "x") {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function symlinkSupported() {
  try {
    const d = join(tmpdir(), `rmd-symchk-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(d, { recursive: true });
    const t = join(d, "t");
    writeFileSync(t, "x");
    const l = join(d, "l");
    symlinkSync(t, l);
    const ok = existsSync(l);
    fs.rmSync(d, { recursive: true, force: true });
    return ok;
  } catch {
    return false;
  }
}

const HAVE_SYMLINKS = symlinkSupported();

// --------------------------------------------------------------------------
test("basics: remove a nested directory tree", async () => {
  const d = await mkdtemp("rmd-basic-");
  makeFile(join(d, "a.txt"), "hello");
  makeFile(join(d, "sub", "b.txt"), "world");
  assert.equal(pathExists(d), true);
  removeSync(d);
  assert.equal(pathExists(d), false);
});

test("idempotent: removing a missing path is a no-op", async () => {
  const d = await mkdtemp("rmd-idem-");
  const gone = join(d, "nope");
  assert.doesNotThrow(() => removeSync(gone));
});

test("single file removal", async () => {
  const d = await mkdtemp("rmd-file-");
  const f = join(d, "single.txt");
  makeFile(f, "123");
  removeSync(f);
  assert.equal(existsSync(f), false);
});

test("nested deep tree removal", async () => {
  const d = await mkdtemp("rmd-deep-");
  const r = generate({ dir: d, count: 50, size: parseSize("1k"), depth: 3 });
  assert.equal(r.files, 50);
  removeSync(d);
  assert.equal(pathExists(d), false);
});

test("readonly files are removed without error (best-effort)", async () => {
  const d = await mkdtemp("rmd-ro-");
  makeFile(join(d, "ro.txt"), "ro");
  try {
    await fs.chmod(join(d, "ro.txt"), 0o444);
  } catch (_) {}
  assert.doesNotThrow(() => removeSync(d));
  assert.equal(pathExists(d), false);
});

test("async variant removes a directory", async () => {
  const d = await mkdtemp("rmd-async-");
  makeFile(join(d, "a.txt"));
  await removeAsync(d);
  assert.equal(pathExists(d), false);
});

test("array of targets: both removed", async () => {
  const base = await mkdtemp("rmd-arr-");
  const d1 = join(base, "x");
  const d2 = join(base, "y");
  makeFile(join(d1, "a"));
  makeFile(join(d2, "b"));
  removeSync([d1, d2]);
  assert.equal(pathExists(d1), false);
  assert.equal(pathExists(d2), false);
});

test("removeAsync accepts an array of targets", async () => {
  const base = await mkdtemp("rmd-arr-async-");
  const d1 = join(base, "x");
  const d2 = join(base, "y");
  makeFile(join(d1, "a"));
  makeFile(join(d2, "b"));
  await removeAsync([d1, d2]);
  assert.equal(pathExists(d1), false);
  assert.equal(pathExists(d2), false);
});

test("empty array is a no-op", async () => {
  const d = await mkdtemp("rmd-empty-");
  makeFile(join(d, "a.txt"));
  assert.doesNotThrow(() => removeSync([]));
  assert.equal(pathExists(d), true);
  removeSync(d);
});

test("relative path removal respects cwd", async () => {
  const d = await mkdtemp("rmd-rel-");
  makeFile(join(d, "rel.txt"));
  const cwd = process.cwd();
  process.chdir(d);
  try {
    removeSync("rel.txt");
    assert.equal(existsSync(join(d, "rel.txt")), false);
  } finally {
    process.chdir(cwd);
  }
});

test("pathExists reports true for a symlink target", async () => {
  if (!HAVE_SYMLINKS) return; // skip where symlinks unsupported
  const base = await mkdtemp("rmd-pathex-");
  const target = join(base, "target");
  makeFile(target, "KEEP");
  const link = join(base, "link");
  symlinkSync(target, link);
  assert.equal(pathExists(link), true);
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  removeSync(base);
});

test("symlink: removes the link, preserves the target", async () => {
  if (!HAVE_SYMLINKS) return;
  const base = await mkdtemp("rmd-sym-");
  const target = join(base, "target");
  makeFile(target, "KEEP");
  const link = join(base, "link");
  symlinkSync(target, link);
  removeSync(link);
  assert.equal(existsSync(link), false);
  assert.equal(existsSync(target), true);
  removeSync(target);
});

test("symlink-to-directory: does NOT delete the directory contents", async () => {
  if (!HAVE_SYMLINKS) return;
  const base = await mkdtemp("rmd-symdir-");
  const realdir = join(base, "realdir");
  mkdirSync(realdir, { recursive: true });
  makeFile(join(realdir, "secret.txt"), "do-not-delete");
  const linkdir = join(base, "linkdir");
  symlinkSync(realdir, linkdir, "dir");
  removeSync(linkdir);
  assert.equal(existsSync(linkdir), false);
  assert.equal(existsSync(realdir), true);
  assert.equal(existsSync(join(realdir, "secret.txt")), true);
  removeSync(realdir);
});

test("integration: large parallel delete + out-of-tree symlinks", async () => {
  const base = await mkdtemp("rmd-parallel-");
  const tree = join(base, "tree");
  const outside = join(base, "outside");
  mkdirSync(outside, { recursive: true });
  makeFile(join(outside, "keep.txt"), "keep");
  const r = generate({ dir: tree, count: 400, size: parseSize("512"), depth: 4, prefix: "f" });
  assert.equal(r.files, 400);
  try {
    symlinkSync(join(outside, "keep.txt"), join(tree, "lnk_out_file"));
    symlinkSync(outside, join(tree, "lnk_out_dir"), "dir");
    symlinkSync(join(outside, "keep.txt"), join(tree, "deep", "lnk_deep"));
  } catch (_) {}
  removeSync(tree);
  assert.equal(pathExists(tree), false);
  assert.equal(existsSync(outside), true);
  assert.equal(existsSync(join(outside, "keep.txt")), true);
  removeSync(outside);
});

// --------------------------------------------------------------------------
// CLI coverage
// --------------------------------------------------------------------------
test("CLI: --help prints usage and exits 0", async () => {
  const { stdout } = await runCLI(process.execPath, [CLI, "--help"]);
  assert.match(stdout, /Usage/);
});

test("CLI: removes a directory via -rf", async () => {
  const d = await mkdtemp("rmd-cli-");
  makeFile(join(d, "a.txt"));
  await runCLI(process.execPath, [CLI, "-rf", d]);
  assert.equal(existsSync(d), false);
});

test("CLI: --dry-run does not remove but reports", async () => {
  const d = await mkdtemp("rmd-cli-dry-");
  makeFile(join(d, "a.txt"));
  const { stdout } = await runCLI(process.execPath, [CLI, "--dry-run", d]);
  assert.match(stdout, /would remove/);
  assert.equal(existsSync(d), true);
  removeSync(d);
});

test("CLI: --verbose lists removed paths", async () => {
  const d = await mkdtemp("rmd-cli-v-");
  makeFile(join(d, "a.txt"));
  const { stdout } = await runCLI(process.execPath, [CLI, "-rfv", d]);
  assert.match(stdout, /removed:/);
});

test("CLI: --async removes a directory", async () => {
  const d = await mkdtemp("rmd-cli-async-");
  makeFile(join(d, "a.txt"));
  await runCLI(process.execPath, [CLI, "--async", "-rf", d]);
  assert.equal(existsSync(d), false);
});

test("CLI gen: creates the requested number of files", async () => {
  const d = await mkdtemp("rmd-cli-gen-");
  await runCLI(process.execPath, [CLI, "gen", d, "-n", "30", "-s", "512", "-d", "2"]);
  let count = 0;
  const walk = (p) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const fp = join(p, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith(".bin")) count++;
    }
  };
  walk(d);
  assert.equal(count, 30);
  removeSync(d);
});
