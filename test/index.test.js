"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { removeSync, removeAsync, pathExists } = require("../index");
const { generate, parseSize } = require("../bin/gen");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rmd-"));

let passed = 0;
function ok(name) {
  passed++;
  console.log("  ✓ " + name);
}

// 0. parseSize 辅助函数
{
  assert.strictEqual(parseSize("512"), 512);
  assert.strictEqual(parseSize("1k"), 1024);
  assert.strictEqual(parseSize("2m"), 2 * 1024 ** 2);
  assert.strictEqual(parseSize("1g"), 1024 ** 3);
  assert.strictEqual(parseSize("1.5k"), Math.floor(1.5 * 1024));
  ok("parseSize (b/k/m/g units)");
}

// 1. 生成测试数据并删除（数量 + 大小）
{
  const dir = path.join(tmp, "gen1");
  const r = generate({ dir, count: 50, size: 1024, prefix: "t" });
  assert.strictEqual(r.files, 50);
  assert.ok(fs.existsSync(path.join(dir, "t-000000.bin")));
  const sz = fs.statSync(path.join(dir, "t-000000.bin")).size;
  assert.strictEqual(sz, 1024);
  removeSync(dir);
  assert.ok(!fs.existsSync(dir), "generated dir should be removed");
  ok("generate 50 files @1k then removeSync");
}

// 2. 生成大文件（指定大小），校验实际写入字节数
{
  const dir = path.join(tmp, "gen2");
  const size = 2 * 1024 ** 2; // 2 MiB
  const r = generate({ dir, count: 5, size, prefix: "big" });
  assert.strictEqual(r.bytes, size * 5);
  const f = path.join(dir, "big-000000.bin");
  assert.strictEqual(fs.statSync(f).size, size);
  removeSync(dir);
  assert.ok(!fs.existsSync(dir));
  ok("generate 5 files @2m then removeSync (size verified)");
}

// 3. 嵌套目录（depth）+ 数量
{
  const dir = path.join(tmp, "gen3");
  const total = 333;
  const r = generate({ dir, count: total, size: 100, depth: 3, prefix: "n" });
  assert.strictEqual(r.files, total);
  // 统计实际生成的文件数
  let count = 0;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else count++;
    }
  })(dir);
  assert.strictEqual(count, total);
  removeSync(dir);
  assert.ok(!fs.existsSync(dir));
  ok(`generate ${total} files across depth=3 then removeSync`);
}

// 4. 只读文件混合（--readonly 行为）
{
  const dir = path.join(tmp, "gen4");
  const r = generate({ dir, count: 30, size: 256, readonly: true });
  // 约 1/3 为只读
  let ro = 0;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const mode = fs.statSync(p).mode;
        if ((mode & 0o200) === 0) ro++;
      }
    }
  })(dir);
  assert.ok(ro > 0, "some files should be read-only");
  removeSync(dir);
  assert.ok(!fs.existsSync(dir), "read-only files removed");
  ok(`generate ${r.files} files (${ro} read-only) then removeSync`);
}

// 5. 递归删除目录（原有核心用例，含符号链接）
{
  const root = path.join(tmp, "tree");
  fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
  fs.writeFileSync(path.join(root, "a", "file1.txt"), "hello");
  fs.writeFileSync(path.join(root, "a", "b", "file2.txt"), "world");
  const ro = path.join(root, "readonly.txt");
  fs.writeFileSync(ro, "ro");
  fs.chmodSync(ro, 0o444);
  removeSync(root);
  assert.ok(!fs.existsSync(root), "directory should be gone");
  ok("recursive directory removal (incl. read-only file)");
}

// 6. 删除单个文件
{
  const f = path.join(tmp, "single");
  fs.writeFileSync(f, "x");
  removeSync(f);
  assert.ok(!fs.existsSync(f));
  ok("single file removal");
}

// 7. 幂等
{
  const missing = path.join(tmp, "nope-" + Date.now());
  removeSync(missing);
  ok("idempotent removal of missing path");
}

// 8. 批量删除
{
  const r1 = path.join(tmp, "batch1");
  const r2 = path.join(tmp, "batch2");
  generate({ dir: r1, count: 10 });
  generate({ dir: r2, count: 10 });
  removeSync([r1, r2]);
  assert.ok(!fs.existsSync(r1) && !fs.existsSync(r2));
  ok("batch removal");
}

// 9. 符号链接：只删链接不删目标
{
  const targetFile = path.join(tmp, "link-target");
  fs.writeFileSync(targetFile, "keep me");
  const link = path.join(tmp, "link");
  fs.symlinkSync(targetFile, link);
  removeSync(link);
  assert.ok(!fs.existsSync(link), "symlink should be gone");
  assert.ok(fs.existsSync(targetFile), "symlink target must survive");
  ok("symlink removal keeps target intact");
}

// 10. pathExists helper
{
  const f = path.join(tmp, "ex");
  assert.strictEqual(pathExists(f), false);
  fs.writeFileSync(f, "x");
  assert.strictEqual(pathExists(f), true);
  removeSync(f);
  assert.strictEqual(pathExists(f), false);
  ok("pathExists helper");
}

// 11. 异步删除（含生成数据）
{
  const dir = path.join(tmp, "gen-async");
  generate({ dir, count: 20, size: 1024 });
  (async () => {
    await removeAsync(dir);
    assert.ok(!fs.existsSync(dir));
    ok("async removal (post generate)");
    console.log(`\nAll ${passed} tests passed.`);
  })().catch((e) => {
    console.error("Test failed:", e);
    process.exit(1);
  });
}
