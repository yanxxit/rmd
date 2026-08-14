# tuari-rmd

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
npm install tuari-rmd
# or
pnpm add tuari-rmd
yarn add tuari-rmd
```

The correct native binary is pulled in automatically via optional dependencies.

## CLI usage

```bash
# remove a directory or file (recursive by default)
tuari-rmd dist
tuari-rmd -rf node_modules .cache

# dry run — show what would be removed
tuari-rmd --dry-run build

# verbose
tuari-rmd -rfv tmp

# async API internally
tuari-rmd --async "*.tmp"
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

## Node.js API

```js
const { removeSync, removeAsync, existsSync } = require("tuari-rmd");

// Synchronous
removeSync("dist");
removeSync(["node_modules", ".cache"]);

// Asynchronous (returns a Promise)
await removeAsync("build");

// Check
if (existsSync("stale")) removeSync("stale");
```

### TypeScript

```ts
import { removeSync, removeAsync, existsSync } from "tuari-rmd";

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
    "clean": "tuari-rmd -rf dist node_modules/.cache"
  }
}
```

Or in JS code:

```js
// before: const rimraf = require('rimraf')
// after:
const { removeSync } = require("tuari-rmd");
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

Consumers then simply `npm install tuari-rmd` and the correct prebuilt
binary is fetched via `optionalDependencies` — no Rust toolchain required.

## License

MIT
