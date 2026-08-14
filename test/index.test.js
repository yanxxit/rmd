"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { removeSync, pathExists, removeAsync } = require("../index");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tuari-rmd-"));

function makeTree() {
  const root = path.join(tmp, "tree-" + Date.now() + "-" + Math.floor(Math.random() * 1e6));
  fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
  fs.writeFileSync(path.join(root, "a", "file1.txt"), "hello");
  fs.writeFileSync(path.join(root, "a", "b", "file2.txt"), "world");
  // 只读文件
  const ro = path.join(root, "readonly.txt");
  fs.writeFileSync(ro, "ro");
  fs.chmodSync(ro, 0o444);
  return root;
}

let passed = 0;
function ok(name) {
  passed++;
  console.log("  ✓ " + name);
}

// 1. 递归删除目录
{
  const root = makeTree();
  assert.ok(fs.existsSync(root));
  removeSync(root);
  assert.ok(!fs.existsSync(root), "directory should be gone");
  ok("recursive directory removal (incl. read-only file)");
}

// 2. 删除单个文件
{
  const f = path.join(tmp, "single-" + Date.now());
  fs.writeFileSync(f, "x");
  removeSync(f);
  assert.ok(!fs.existsSync(f));
  ok("single file removal");
}

// 3. 幂等：删除不存在路径不报错
{
  const missing = path.join(tmp, "does-not-exist-" + Date.now());
  removeSync(missing);
  ok("idempotent removal of missing path");
}

// 4. 批量删除
{
  const r1 = makeTree();
  const r2 = makeTree();
  removeSync([r1, r2]);
  assert.ok(!fs.existsSync(r1) && !fs.existsSync(r2));
  ok("batch removal");
}

// 5. 符号链接：只删除链接本身，不删除目标
{
  const targetFile = path.join(tmp, "link-target-" + Date.now());
  fs.writeFileSync(targetFile, "keep me");
  const link = path.join(tmp, "link-" + Date.now());
  fs.symlinkSync(targetFile, link);
  removeSync(link);
  assert.ok(!fs.existsSync(link), "symlink should be gone");
  assert.ok(fs.existsSync(targetFile), "symlink target must survive");
  ok("symlink removal keeps target intact");
}

// 6. pathExists helper
{
  const f = path.join(tmp, "ex-" + Date.now());
  assert.strictEqual(pathExists(f), false);
  fs.writeFileSync(f, "x");
  assert.strictEqual(pathExists(f), true);
  removeSync(f);
  assert.strictEqual(pathExists(f), false);
  ok("pathExists helper");
}

// 7. 异步删除
(async () => {
  const root = makeTree();
  await removeAsync(root);
  assert.ok(!fs.existsSync(root));
  ok("async removal");
  console.log(`\nAll ${passed + 1} tests passed.`);
})().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
