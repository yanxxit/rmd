#!/usr/bin/env node
"use strict";

const { removeSync, removeAsync, existsSync } = require("../index");
const { existsSync: fsExists, readFileSync } = require("fs");
const { resolve, isAbsolute } = require("path");

function parseArgs(argv) {
  const opts = {
    targets: [],
    recursive: false,
    force: false,
    verbose: false,
    dryRun: false,
    async: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-r":
      case "-rf":
      case "-fr":
      case "--recursive":
        opts.recursive = true;
        break;
      case "-f":
      case "--force":
        opts.force = true;
        break;
      case "-v":
      case "--verbose":
        opts.verbose = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--async":
        opts.async = true;
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      default:
        if (a.startsWith("-") && a !== "-") {
          console.error(`Unknown option: ${a}`);
          process.exit(1);
        }
        opts.targets.push(a);
    }
  }
  return opts;
}

const HELP = `
tuari-rmd — fast cross-platform removal (rimraf alternative, written in Rust)

Usage:
  tuari-rmd [options] <path...>

Options:
  -r, --recursive   Allow recursive deletion of directories (always on for safety)
  -f, --force       No error if target does not exist
  -v, --verbose     Print each removed path
      --dry-run     Show what would be removed without deleting
      --async       Use async API
  -h, --help        Show this help

Examples:
  tuari-rmd dist
  tuari-rmd -rf node_modules .cache "*.tmp"
  tuari-rmd --dry-run build
`;

function expandGlob(p) {
  // 轻量 glob：支持 * 与 **
  if (!/[*?{}[\]]/.test(p)) return [p];
  try {
    const { globSync } = require("glob");
    return globSync(p, { nodir: false, dot: true });
  } catch {
    // 没有 glob 依赖时退化为直接路径
    return [p];
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (opts.targets.length === 0) {
    console.error("tuari-rmd: no path specified. Use -h for help.");
    process.exit(1);
  }

  // 安全保护：禁止直接删除根目录或当前目录
  const resolved = [];
  for (const t of opts.targets) {
    const base = isAbsolute(t) ? t : resolve(process.cwd(), t);
    const norm = base.replace(/[/\\]+$/, "");
    // 根目录保护（Unix 的 "/" 或 Windows 盘符根，如 "C:\"）
    const isRoot =
      norm === "/" ||
      norm === "" ||
      /^([A-Za-z]:)?[\\/]?$/.test(norm);
    if (isRoot) {
      console.error(`tuari-rmd: refusing to remove "${t}" (unsafe target)`);
      process.exit(1);
    }
    if (norm === resolve(process.cwd())) {
      console.error(
        `tuari-rmd: refusing to remove the current working directory`
      );
      process.exit(1);
    }
    for (const g of expandGlob(t)) {
      resolved.push(g);
    }
  }

  if (opts.dryRun) {
    for (const t of resolved) {
      const exists = existsSync(t);
      console.log(`${exists ? "would remove" : "not found"}: ${t}`);
    }
    return;
  }

  const toRemove = resolved;
  const doRemove = opts.async ? removeAsync : (p) => Promise.resolve(removeSync(p));

  // 移除"当前目录"保护后，处理不存在情况（force 模式下忽略）
  const missing = toRemove.filter((t) => !existsSync(t));
  if (missing.length && !opts.force) {
    for (const m of missing) console.error(`tuari-rmd: ${m}: No such file or directory`);
  }

  const errs = [];
  const run = async () => {
    try {
      await doRemove(toRemove);
      if (opts.verbose) {
        for (const t of toRemove) console.log(`removed: ${t}`);
      }
    } catch (e) {
      errs.push(e);
      console.error(`tuari-rmd: ${e.message || e}`);
      process.exitCode = 1;
    }
  };

  run();
}

main();
