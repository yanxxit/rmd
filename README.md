# rmd

A fast, cross-platform file / directory removal tool written in **Rust** — a
high-performance alternative to [`rimraf`](https://www.npmjs.com/package/rimraf).

- ⚡  Rust core, precompiled native binaries (no runtime dependencies)
- 🪟🐧🍎  Windows / Linux / macOS (x64 & arm64, glibc & musl)
- 🔗  Correctly handles symlinks (removes the link, not the target)
- 🔒  Handles read-only files and Windows file-lock / antivirus retries
- 🆔  Idempotent: removing a non-existent path is a no-op
- 🧰  Usable as a **CLI** or a **Node.js API**

## Install

```bash
npm install rmd
# or
pnpm add rmd
yarn add rmd
```

The correct native binary is pulled in automatically via optional dependencies.

## CLI usage

```bash
# remove a directory or file (recursive by default)
rmd dist
rmd -rf node_modules .cache

# dry run — show what would be removed
rmd --dry-run build

# verbose
rmd -rfv tmp

# async API internally
rmd --async "*.tmp"
```

Options:

| Flag | Description |
| --- | --- |
| `-r, --recursive` | Allow recursive deletion (default on) |
| `-f, --force` | No error if target is missing |
| `-v, --verbose` | Print each removed path |
| `--dry-run` | Show what would be removed |
| `--async` | Use the async API |
| `-h, --help` | Show help |

## Generate test data (the `gen` command)

`rmd` ships with a built-in generator so you can create large amounts of
test data and then benchmark / verify the removal:

```bash
# generate 1000 files of 1 MiB each in ./sandbox (flat layout)
rmd gen ./sandbox -n 1000 -s 1m

# generate 5000 files of 2 KiB across 3 nested directory levels
rmd gen ./sandbox -n 5000 -s 2k -d 3

# also mark 1/3 of files read-only (good for testing RO handling)
rmd gen ./sandbox -n 200 -s 1k --readonly

# then delete it
rmd -rf ./sandbox
# optional: time it
time rmd -rf ./sandbox
```

`gen` options:

| Flag | Description |
| --- | --- |
| `<dir>` | target directory (created if missing) |
| `-n, --count <num>` | number of files (default 100) |
| `-s, --size <str>` | size per file, e.g. `512` `1k` `2m` `1g` (default `1k`) |
| `-d, --depth <num>` | nested directory depth, `1` = flat (default 1) |
| `--prefix <str>` | filename prefix (default `file`) |
| `--readonly` | mark 1/3 of files read-only |
| `-h, --help` | show help |

The generator is also a reusable module:

```js
const { generate, parseSize } = require("rmd/bin/gen");
const r = generate({ dir: "./sandbox", count: 1000, size: parseSize("1m"), depth: 2 });
console.log(r.files, r.bytes); // 1000, 1048576000
```

## Node.js API

```js
const { removeSync, removeAsync, pathExists } = require("rmd");

// Synchronous
removeSync("dist");
removeSync(["node_modules", ".cache"]);

// Asynchronous (returns a Promise)
await removeAsync("build");

// Check
if (pathExists("stale")) removeSync("stale");
```

### TypeScript

```ts
import { removeSync, removeAsync, pathExists } from "rmd";

removeSync("./dist");
await removeAsync(["./build", "./.tmp"]);
```

## Build from source

Requires the Rust toolchain.

```bash
npm install
npm run build          # build for current platform
npm run build:all      # cross-compile all platforms (needs target triples installed)
npm test
```

## How it works

The deletion logic in [`src/remove.rs`](./src/remove.rs) mirrors `rimraf`'s
behavior:

1. If the path doesn't exist → succeed (idempotent).
2. If it's a symlink → remove only the link.
3. If it's a directory → walk bottom-up, removing children first.
4. For each item, strip the read-only bit before deleting.
5. On Windows, transient `EACCES`/`EPERM` (file-lock, antivirus) triggers
   bounded retries before giving up.

## Replacing `rimraf` in your scripts

```jsonc
// package.json
{
  "scripts": {
    "clean": "rmd -rf dist node_modules/.cache"
  }
}
```

Or in JS code:

```js
// before: const rimraf = require('rimraf')
// after:
const { removeSync } = require("rmd");
removeSync("dist");
```

## Publishing to npm

The native binaries for every platform are built and published
automatically by GitHub Actions (see `.github/workflows/CI.yml`):

```bash
# 1. bump version in Cargo.toml and package.json
# 2. commit & push a git tag
git tag v0.1.0
git push origin v0.1.0
# 3. CI builds all 7 platforms, packs them as optional deps,
#    and runs `npm publish` with NODE_AUTH_TOKEN
```

For a **local** publish of just the current platform (dev only):

```bash
npm install
npm run build        # builds index.<platform>.node + native.js
npm publish --access public
```

Consumers then simply `npm install rmd` and the correct prebuilt
binary is fetched via `optionalDependencies` — no Rust toolchain required.

## License

MIT
