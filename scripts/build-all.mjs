#!/usr/bin/env node
// Build prebuilt .node binaries for every supported platform, locally.
//
// It auto-installs any missing Rust cross-compilation targets, then runs
// `napi build` for each. Cross-compiling for Windows from macOS is NOT
// possible, so those two targets are skipped with a warning (they can be
// built on a Windows machine or left out — npm will still publish the
// platforms you did build).
//
// All artifacts land in the repo root as index.<platform>.node and are
// picked up by native.cjs (local file takes precedence over sub-packages).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
const runCapture = (cmd, args) =>
  execFileSync(cmd, args, { cwd: root, encoding: "utf8" }).trim();

// target triple -> napi build extras (env + flags)
const TARGETS = [
  { triple: "x86_64-apple-darwin", label: "macOS x64" },
  { triple: "aarch64-apple-darwin", label: "macOS arm64" },
  {
    triple: "x86_64-unknown-linux-gnu",
    label: "Linux x64 (glibc)",
    env: { CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER: "x86_64-linux-gnu-gcc" },
    apt: "gcc-x86-64-linux-gnu",
  },
  {
    triple: "aarch64-unknown-linux-gnu",
    label: "Linux arm64 (glibc)",
    env: { CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER: "aarch64-linux-gnu-gcc" },
    apt: "gcc-aarch64-linux-gnu",
  },
  {
    triple: "x86_64-unknown-linux-musl",
    label: "Linux x64 (musl)",
    apt: "musl-tools",
  },
  {
    triple: "aarch64-unknown-linux-musl",
    label: "Linux arm64 (musl)",
    env: { CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER: "aarch64-linux-gnu-gcc" },
    apt: "gcc-aarch64-linux-gnu musl-tools",
  },
  // Windows cannot be cross-compiled from macOS/Linux — skip locally.
  { triple: "x86_64-pc-windows-msvc", label: "Windows x64 (skip)", skip: true },
  { triple: "aarch64-pc-windows-msvc", label: "Windows arm64 (skip)", skip: true },
];

console.log("==> Cleaning old .node artifacts");
for (const f of readdirSync(root)) {
  if (f.endsWith(".node")) rmSync(join(root, f), { force: true });
}

const installed = new Set(
  runCapture("rustup", ["target", "list", "--installed"]).split("\n")
);
const isMac = process.platform === "darwin";

for (const t of TARGETS) {
  if (t.skip) {
    console.log(`\n-- skipping ${t.label} (${t.triple}): cross-compile unavailable locally`);
    continue;
  }
  // On macOS we cannot install Linux/Windows linkers; warn and skip the
  // cross targets that need a foreign linker unless the toolchain is present.
  if (isMac && (t.triple.includes("linux") || t.triple.includes("windows"))) {
    console.log(
      `\n-- skipping ${t.label} (${t.triple}): needs cross linker not available on macOS`
    );
    continue;
  }

  if (!installed.has(t.triple)) {
    console.log(`\n==> Installing rust target ${t.triple}`);
    run("rustup", ["target", "add", t.triple]);
  }

  console.log(`\n==> Building ${t.label} (${t.triple})`);
  const env = { ...process.env, ...(t.env || {}) };
  run(
    "npx",
    ["--yes", "napi", "build", "--platform", "--release", "--target", t.triple, "--js", "native.cjs"],
    { env }
  );
}

// Move generated index.<triple>.node files into repo root (napi emits them
// already named per platform; ensure they are at root for native.cjs to find).
console.log("\n==> Build complete. Artifacts in repo root:");
for (const f of readdirSync(root)) {
  if (f.endsWith(".node")) console.log("   " + f);
}
