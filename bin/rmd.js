#!/usr/bin/env node
"use strict";

const { removeSync, removeAsync, pathExists } = require("../index");
const { resolve, isAbsolute } = require("path");

const GEN_HELP = `
rmd gen — generate test files/directories

Usage:
  rmd gen <dir> [options]

Options:
  -n, --count <num>     number of files to create (default 100)
  -s, --size <str>      size per file, e.g. 1k / 2m / 512 (default 1k)
  -d, --depth <num>     nested directory depth, 1 = flat (default 1)
  --prefix <str>        filename prefix (default "file")
  --readonly            mark 1/3 of files read-only (to test rmd on RO files)
  -h, --help            show this help

Examples:
  rmd gen ./sandbox -n 1000 -s 1m
  rmd gen ./sandbox -n 5000 -s 2k -d 3 --readonly
`;

const HELP = `
rmd — fast cross-platform removal (rimraf alternative, written in Rust)

Usage:
  rmd gen <dir> [options]          generate test files
  rmd [options] <path...>          remove files/directories

Remove options:
  -r, --recursive   Allow recursive deletion of directories (always on for safety)
  -f, --force       No error if target does not exist
  -v, --verbose     Print each removed path
      --dry-run     Show what would be removed without deleting
      --async       Use async API
  -h, --help        Show this help

Examples:
  rmd dist
  rmd -rf node_modules .cache "*.tmp"
  rmd --dry-run build
  rmd gen ./sandbox -n 2000 -s 1m && rmd -rf ./sandbox
`;

function parseRemoveArgs(argv) {
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

function runRemove() {
  const opts = parseRemoveArgs(process.argv.slice(3));
  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (opts.targets.length === 0) {
    console.error("rmd: no path specified. Use -h for help.");
    process.exit(1);
  }

  // 安全保护：禁止直接删除根目录或当前目录
  const resolved = [];
  for (const t of opts.targets) {
    const base = isAbsolute(t) ? t : resolve(process.cwd(), t);
    const norm = base.replace(/[/\\]+$/, "");
    const isRoot =
      norm === "/" ||
      norm === "" ||
      /^([A-Za-z]:)?[\\/]?$/.test(norm);
    if (isRoot) {
      console.error(`rmd: refusing to remove "${t}" (unsafe target)`);
      process.exit(1);
    }
    if (norm === resolve(process.cwd())) {
      console.error(`rmd: refusing to remove the current working directory`);
      process.exit(1);
    }
    for (const g of expandGlob(t)) {
      resolved.push(g);
    }
  }

  if (opts.dryRun) {
    for (const t of resolved) {
      const exists = pathExists(t);
      console.log(`${exists ? "would remove" : "not found"}: ${t}`);
    }
    return;
  }

  const toRemove = resolved;
  const doRemove = opts.async
    ? removeAsync
    : (p) => Promise.resolve(removeSync(p));

  const missing = toRemove.filter((t) => !pathExists(t));
  if (missing.length && !opts.force) {
    for (const m of missing)
      console.error(`rmd: ${m}: No such file or directory`);
  }

  const run = async () => {
    try {
      const t0 = Date.now();
      await doRemove(toRemove);
      const dt = ((Date.now() - t0) / 1000).toFixed(2);
      if (opts.verbose) {
        for (const t of toRemove) console.log(`removed: ${t}`);
      }
      console.error(`rmd: removed ${toRemove.length} target(s) in ${dt}s`);
    } catch (e) {
      console.error(`rmd: ${e.message || e}`);
      process.exitCode = 1;
    }
  };

  run();
}

function main() {
  const sub = process.argv[2];
  if (sub === "gen" || sub === "generate") {
    require("./gen.js").runGenCli(process.argv.slice(3));
    return;
  }
  if (sub === "-h" || sub === "--help" || sub === undefined) {
    console.log(HELP);
    return;
  }
  runRemove();
}

main();
