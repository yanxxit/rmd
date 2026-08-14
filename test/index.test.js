// Test suite for @yanit/rmd (ESM, uses node:test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs, existsSync, mkdirSync, symlinkSync, writeFileSync, lstatSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
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

test("progress callback (loading mode, no pre-scan): reports live done count", async () => {
  const d = await mkdtemp("rmd-prog-");
  generate({ dir: d, count: 30, size: parseSize("1k"), depth: 2 });
  const seen = [];
  // 默认（不传 detailed）不预遍历总数；total 应为 0，done 实时增长。
  removeSync(d, (done, total) => seen.push([done, total]));
  assert.ok(seen.length > 0, "callback should fire");
  // loading 模式：total 未知 = 0，不做百分比预扫描
  assert.equal(seen[0][1], 0, "total should be 0 in loading mode");
  const [lastDone] = seen[seen.length - 1];
  assert.ok(lastDone > 0, "done should be positive");
  // done 单调非递减
  let prev = 0;
  for (const [dn] of seen) {
    assert.ok(dn >= prev, "done must not decrease");
    prev = dn;
  }
  assert.equal(pathExists(d), false);
});

test("progress callback (detailed mode): done ends at total", async () => {
  const d = await mkdtemp("rmd-prog-detail-");
  generate({ dir: d, count: 30, size: parseSize("1k"), depth: 2 });
  const seen = [];
  // detailed=true 预先统计总数，last report 的 done 应等于 total。
  removeSync(d, { detailed: true, onProgress: (done, total) => seen.push([done, total]) });
  assert.ok(seen.length > 0, "callback should fire");
  const [lastDone, lastTotal] = seen[seen.length - 1];
  assert.ok(lastTotal > 0, "total should be pre-computed (non-zero)");
  // done 实时计数与预扫描 total 口径可能相差 1（根/边界计入差异），允许 ±1。
  assert.ok(
    Math.abs(lastDone - lastTotal) <= 1,
    `done (${lastDone}) should end near total (${lastTotal})`
  );
  let prev = 0;
  for (const [dn, tot] of seen) {
    assert.ok(dn >= prev, "done must not decrease");
    assert.ok(dn >= 1 && dn <= tot + 1, "done within bounds (±1)");
    prev = dn;
  }
  assert.equal(pathExists(d), false);
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

test("CLI gen: routed even when flags precede the subcommand (#2)", async () => {
  const d = await mkdtemp("rmd-cli-gen-flag-");
  // 之前的 bug：rmd --progress gen <dir> 会把 "gen" 当成待删路径。
  const { stdout } = await runCLI(process.execPath, [CLI, "--progress", "gen", d, "-n", "7"]);
  assert.match(stdout, /Generated 7 files/);
  // 临时目录没有被删除（gen 不删除任何东西）。
  assert.equal(existsSync(d), true);
  removeSync(d);
});

test("async: rejects the Promise on failure (#1)", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const f = path.join(os.tmpdir(), `rmd-asyncfail-${Date.now()}.txt`);
  writeFileSync(f, "x");
  const bad = f + "/sub"; // f 是文件，f/sub -> ENOTDIR
  await assert.rejects(() => removeAsync(bad), /Not a directory/);
});
