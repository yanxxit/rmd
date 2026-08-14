#!/usr/bin/env node
// rmd — fast recursive removal CLI (Rust core via @yanit/rmd).

import { resolve } from "node:path";
import { removeSync, removeAsync, pathExists } from "../index.js";
import { runGenCli } from "./gen.js";

function showHelp() {
  console.log(`rmd - fast recursive removal (rimraf alternative)

Usage:
  rmd [options] <path...>
  rmd gen <dir> [gen-options]   generate test data

Options:
  -r, --recursive   allow recursive deletion (default on)
  -f, --force       no error if target missing (default on)
  -v, --verbose     print each removed path
  --dry-run         show what would be removed (no removal)
  --async           use async API
  -h, --help        show this help

Examples:
  rmd dist
  rmd -rf node_modules .cache
  rmd --dry-run build
  rmd --async "*.tmp"`);
}

async function main() {
  const argv = process.argv.slice(2);

  // route to generator subcommand
  if (argv[0] === "gen") {
    runGenCli();
    return;
  }

  let verbose = false;
  let dryRun = false;
  let useAsync = false;
  const targets = [];
  for (const a of argv) {
    if (a === "-h" || a === "--help") return showHelp();
    if (a === "-v" || a === "--verbose") verbose = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--async") useAsync = true;
    else if (a === "-r" || a === "--recursive" || a === "-f" || a === "--force") {
      /* accepted, default behavior */
    } else if (a.startsWith("-") && a.length > 1 && !a.startsWith("--")) {
      // clustered short flags, e.g. -rf  ->  -r -f
      const flags = a.slice(1).split("");
      let known = true;
      for (const c of flags) {
        if (c === "r") { /* recursive */ }
        else if (c === "f") { /* force */ }
        else if (c === "v") verbose = true;
        else { known = false; }
      }
      if (!known) {
        console.error(`rmd: unknown flag ${a}`);
        process.exit(1);
      }
    } else if (a.startsWith("-") && a !== "-") {
      console.error(`rmd: unknown flag ${a}`);
      process.exit(1);
    } else targets.push(a);
  }

  if (targets.length === 0) {
    return showHelp();
  }

  if (dryRun) {
    let removed = 0;
    for (const t of targets) {
      const p = resolve(t);
      if (pathExists(p)) {
        console.log(`would remove: ${p}`);
        removed++;
      } else {
        console.log(`(not found) skip: ${p}`);
      }
    }
    console.log(`dry-run: ${removed} path(s) would be removed`);
    return;
  }

  const t0 = Date.now();
  if (useAsync) {
    for (const t of targets) {
      await removeAsync(resolve(t));
      if (verbose) console.log(`removed: ${resolve(t)}`);
    }
  } else {
    for (const t of targets) {
      removeSync(resolve(t));
      if (verbose) console.log(`removed: ${resolve(t)}`);
    }
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  if (verbose) console.log(`done in ${dt}s`);
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
