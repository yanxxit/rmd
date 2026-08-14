// Generator: create large amounts of test data and benchmark removal.
//
// Exposed both as a CLI (`rmd gen ...`) and as a reusable module
// (`import { generate, parseSize } from "@yanit/rmd/bin/gen"`).

import { mkdirSync, writeFileSync, openSync, closeSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const UNITS = { b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 };

/**
 * 解析人类可读的大小字符串，如 "1k" / "2m" / "512" / "1g"。
 * @param {string} str
 * @returns {number} 字节数
 */
export function parseSize(str) {
  if (str == null) return 1024;
  const m = String(str).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([bkmg]?)$/);
  if (!m) throw new Error(`invalid size: "${str}"`);
  const n = parseFloat(m[1]);
  const u = m[2] || "b";
  return Math.max(0, Math.floor(n * (UNITS[u] || 1)));
}

/**
 * 生成测试数据。
 * @param {object} opts
 * @param {string} opts.dir          目标目录（不存在则创建）
 * @param {number} [opts.count=100]  文件总数
 * @param {number} [opts.size=1024]  单个文件字节数
 * @param {number} [opts.depth=1]    目录层级（1 = 平铺；>1 会分桶到子目录）
 * @param {string} [opts.prefix="file"] 文件名前缀
 * @param {boolean} [opts.readonly=false] 是否把一部分文件设为只读
 * @returns {{files: number, bytes: number, dir: string}}
 */
export function generate({ dir, count = 100, size = 1024, depth = 1, prefix = "file", readonly = false } = {}) {
  mkdirSync(dir, { recursive: true });
  const total = Math.max(0, Math.floor(count));
  const chunkSize = 64 * 1024;
  const buf = Buffer.alloc(Math.min(chunkSize, Math.max(1, size)));
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + 7) & 0xff;

  let written = 0;
  let bytes = 0;
  for (let i = 0; i < total; i++) {
    let sub = dir;
    if (depth > 1) {
      // 按 i 分桶到 depth 层嵌套目录
      const parts = [];
      let v = i;
      for (let d = 0; d < depth; d++) {
        parts.push(String(d === 0 ? Math.floor(i / 10 ** (depth - 1)) % 100 : (v = Math.floor(v / 10)) % 100));
      }
      sub = join(dir, ...parts);
      mkdirSync(sub, { recursive: true });
    }
    const name = `${prefix}-${String(i).padStart(6, "0")}.bin`;
    const fp = join(sub, name);
    const fd = openSync(fp, "w");
    let remaining = size;
    while (remaining > 0) {
      const n = Math.min(buf.length, remaining);
      writeFileSync(fd, buf.subarray(0, n));
      remaining -= n;
    }
    closeSync(fd);
    if (readonly && i % 3 === 0) {
      try {
        chmodSync(fp, 0o444);
      } catch (_) {}
    }
    written++;
    bytes += size;
  }
  return { files: written, bytes, dir };
}

const GEN_CLI_HELP = `gen — generate test files

Usage: rmd gen <dir> [options]
  -n, --count <num>   number of files (default 100)
  -s, --size <str>    size per file, e.g. 1k 2m 512 (default 1k)
  -d, --depth <num>   nested directory depth (default 1)
  --prefix <str>      filename prefix (default "file")
  --readonly          mark 1/3 of files read-only
  -h, --help          show help`;

export function runGenCli(argv) {
  const args = argv || process.argv.slice(2);
  const opts = { dir: ".", count: 100, size: 1024, depth: 1, prefix: "file", readonly: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-n" || a === "--count") opts.count = parseInt(args[++i], 10);
    else if (a === "-s" || a === "--size") opts.size = parseSize(args[++i]);
    else if (a === "-d" || a === "--depth") opts.depth = parseInt(args[++i], 10);
    else if (a === "--prefix") opts.prefix = args[++i];
    else if (a === "--readonly") opts.readonly = true;
    else if (a === "-h" || a === "--help") {
      console.log(GEN_CLI_HELP);
      process.exit(0);
    } else if (!a.startsWith("-")) {
      opts.dir = a;
    }
  }
  const r = generate(opts);
  console.log(
    `Generated ${r.files} files (${(r.bytes / 1024 ** 2).toFixed(2)} MiB) in ${r.dir} ` +
      `[depth=${opts.depth}, readonly=${opts.readonly}]`
  );
}

// `rmd gen ...` invokes this module directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runGenCli();
}
