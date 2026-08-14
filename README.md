# rmd

A fast, cross-platform file / directory removal tool written in **Rust** — a
high-performance alternative to [`rimraf`](https://www.npmjs.com/package/rimraf).

- ⚡  Rust core, precompiled native binaries (no runtime dependencies)
- 🪟🐧🍎  Windows / Linux / macOS (x64 & arm64, glibc & musl)
- 🔗  Correctly handles symlinks (removes the link, not the target)
- 🔒  Handles read-only files and Windows file-lock / antivirus retries
- 🆔  Idempotent: removing a non-existent path is a no-op
- 🧰  Usable as a **CLI** or a **Node.js API**

## Documentation

- [使用指南（中文）](./docs/USAGE.md) — 全局安装、CLI 与 Node.js / TypeScript API 用法
- [开发 / 编译 / 发布指南](./docs/DEVELOPMENT.md)
- [发布到 npm](./docs/PUBLISHING.md)
- [异常处理与过程资产](./docs/TROUBLESHOOTING.md) — 历史问题与处理记录

## Install

推荐全局安装（作为命令行工具 `rmd` 使用）：

```bash
npm install -g @yanit/rmd
# or
pnpm add -g @yanit/rmd
```

仅在代码中引用时，作为项目依赖安装：

```bash
npm install @yanit/rmd
# or
pnpm add @yanit/rmd
yarn add @yanit/rmd
```

所有平台的预编译 `.node` 二进制已直接内置在主包中，安装时自动按当前平台加载，
无需 optional dependencies，也无需 Rust 工具链。

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
const { generate, parseSize } = require("@yanit/rmd/bin/gen");
const r = generate({ dir: "./sandbox", count: 1000, size: parseSize("1m"), depth: 2 });
console.log(r.files, r.bytes); // 1000, 1048576000
```

## Node.js API

```js
const { removeSync, removeAsync, pathExists } = require("@yanit/rmd");

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
import { removeSync, removeAsync, pathExists } from "@yanit/rmd";

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
const { removeSync } = require("@yanit/rmd");
removeSync("dist");
```

## Publishing to npm

This package ships **all** prebuilt `.node` binaries directly in the main
package (no per-platform sub-packages).

### Default: GitHub Actions (CI)

Pushing a git tag triggers `.github/workflows/CI.yml`, which builds all
platforms and publishes `@yanit/rmd@<tag>` automatically:

```bash
# bump version + tag + push (CI takes over from the tag)
npm run release           # bumps version, but NOTE: see local path below
```

> On CI the tag drives the version. Just `git tag vX.Y.Z && git push origin vX.Y.Z`.

### Fallback: local publish

If CI fails, publish manually from your machine:

```bash
# bump version (patch+1 by default), build all platforms, publish
npm run release

# or set an explicit version
npm run release 0.2.0

# preview without publishing
npm run release:dry
```

`npm run release` will:

1. bump the version in `package.json` + `Cargo.toml`,
2. regenerate `package-lock.json`,
3. build every supported platform via `npm run build:all`
   (auto-installing any missing Rust targets; Windows targets are skipped
   locally since they can't be cross-compiled from macOS/Linux),
4. run `npm publish --access public`.

The correct binary for the consumer's platform is loaded at runtime by
`native.js` (it prefers the local `index.<platform>.node` file).

Consumers simply `npm install @yanit/rmd` — no Rust toolchain required.

## License

MIT
