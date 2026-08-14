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
  -r, --recursive     allow recursive deletion (default on)
  -f, --force         no error if target missing (default on)
  -v, --verbose       print each removed path
  --progress          show a detailed progress bar (pre-scans total count)
  --no-progress       disable the live counter / progress entirely
  --dry-run           show what would be removed (no removal)
  --async             use async API
  -h, --help          show this help

By default rmd shows a lightweight live counter (number of items removed so
far) without pre-scanning the tree. Use --progress for a percentage bar.

Examples:
  rmd dist
  rmd -rf node_modules .cache
  rmd --progress build
  rmd --no-progress build
  rmd --dry-run build
  rmd --async "*.tmp"`);
}

const PROGRESS_WIDTH = 30;

// 单行进度条（详细模式，需预遍历总数）：TTY 下用 \r 原地刷新百分比。
function createProgress(total) {
  const stream = process.stderr;
  const isTTY = Boolean(stream.isTTY);
  let lastPct = -1;

  function render(pct, done) {
    if (isTTY) {
      const filled = Math.round((pct / 100) * PROGRESS_WIDTH);
      const bar = "█".repeat(filled) + "░".repeat(PROGRESS_WIDTH - filled);
      stream.write(`\r  ${bar} ${String(pct).padStart(3)}% (${done}/${total})`);
    } else if (pct - lastPct >= 10) {
      lastPct = pct;
      console.error(`  progress: ${pct}% (${done}/${total})`);
    }
  }

  return {
    update(done) {
      const pct = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 100;
      render(pct, done);
    },
    finish(done) {
      if (isTTY) {
        const bar = "█".repeat(PROGRESS_WIDTH);
        stream.write(`\r  ${bar} 100% (${done}/${total})\n`);
      }
    },
  };
}

// 轻量 loading（默认模式）：实时显示「已删除 N 项」，不预遍历总数。
// total===0 时表示未知总数，仅展示已删计数 + 旋转 spinner，尽量不干扰删除速度。
const SPINNERS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
function createLoading() {
  const stream = process.stderr;
  const isTTY = Boolean(stream.isTTY);
  let frame = 0;
  let lastDone = 0;
  let lastLog = 0; // 非 TTY 节流

  return {
    update(done) {
      lastDone = done;
      if (isTTY) {
        const spin = SPINNERS[frame % SPINNERS.length];
        frame++;
        stream.write(`\r  ${spin} deleting… removed ${done}`);
      } else if (done - lastLog >= 500) {
        lastLog = done;
        console.error(`  deleting… removed ${done}`);
      }
    },
    finish(done) {
      if (isTTY) {
        stream.write(`\r  ✓ removed ${done} item(s)\n`);
      } else {
        console.error(`  done: removed ${done} item(s)`);
      }
    },
    get lastDone() {
      return lastDone;
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);

  // `gen` 是独立子命令：rmd gen <dir> [gen-options]。
  // 必须在解析全局 flag 之前识别，否则 `rmd --progress gen` 会把 "gen" 当成
  // 待删除路径而误删。任意位置的裸 "gen" token 都路由到生成器子命令。
  const genIdx = argv.indexOf("gen");
  if (genIdx !== -1) {
    // "gen" 及其之后的参数交给生成器；其前的全局 flag 对 gen 无意义，忽略。
    runGenCli(argv.slice(genIdx + 1));
    return;
  }

  let verbose = false;
  let dryRun = false;
  let useAsync = false;
  // 默认开启轻量 loading（实时已删数量，不预遍历）；--progress 升级为详细百分比。
  let mode = "loading"; // "loading" | "progress" | "none"
  const targets = [];
  for (const a of argv) {
    if (a === "-h" || a === "--help") return showHelp();
    if (a === "-v" || a === "--verbose") verbose = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--progress") mode = "progress";
    else if (a === "--no-progress") mode = "none";
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
        else if (c === "p") mode = "progress";
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

  // 是否预遍历总数（仅 --progress 详细模式需要）。默认 loading 不预遍历。
  const detailed = mode === "progress";
  const t0 = Date.now();

  if (useAsync) {
    // 异步模式在 libuv 线程执行，无法安全回调 JS，故进度回调不触发。
    // 没有进度回调时预扫描总量没有意义（白遍历一遍），直接走最快路径。
    for (const t of targets) {
      const rp = resolve(t);
      await removeAsync(rp, undefined, false);
      if (verbose) console.log(`removed: ${rp}`);
    }
  } else {
    for (const t of targets) {
      const rp = resolve(t);
      let ui = null;
      let lastDone = 0;
      removeSync(rp, {
        detailed,
        onProgress: (done, total) => {
          if (mode === "none") return;
          if (mode === "progress") {
            if (!ui) ui = createProgress(total);
            ui.update(done);
          } else {
            if (!ui) ui = createLoading();
            ui.update(done);
          }
          lastDone = done;
        },
      });
      if (ui) ui.finish(lastDone);
      if (verbose) console.log(`removed: ${rp}`);
    }
  }

  const dt = (Date.now() - t0) / 1000;
  console.log(`done: removed ${targets.length} target(s) in ${dt.toFixed(2)}s`);
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
