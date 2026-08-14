# 使用指南

`@yanit/rmd` 是一个用 Rust 编写的高性能跨平台文件/目录删除工具，可作为
**命令行工具**或 **Node.js / TypeScript API** 使用（rimraf 的替代方案）。

## 1. 全局安装（命令行）

```bash
npm install -g @yanit/rmd
# or
pnpm add -g @yanit/rmd
```

安装后即可在终端使用 `rmd` 命令：

```bash
# 删除目录（递归，默认开启）
rmd dist

# 递归 + 强制（目标不存在也不报错）
rmd -rf node_modules .cache

# 预览将要删除的内容（不真正删除）
rmd --dry-run build

# 异步模式删除
rmd --async ./sandbox

# 生成测试数据，然后清空
rmd gen ./sandbox -n 2000 -s 1m -d 3
rmd -rf ./sandbox
```

命令帮助：

```bash
rmd -h
```

### CLI 选项

| 选项 | 说明 |
| --- | --- |
| `-r, --recursive` | 允许递归删除目录（出于安全默认始终开启） |
| `-f, --force` | 目标不存在时不报错 |
| `-v, --verbose` | 打印每个被删除的路径 |
| `--dry-run` | 只显示将要删除的内容，不真正删除 |
| `--async` | 使用异步 API |
| `-h, --help` | 显示帮助 |

> 安全保护：CLI 会拒绝删除根目录（`/`）或当前工作目录，避免误操作。

## 2. 在代码中引用（Node.js / TypeScript）

本包支持在代码中引用。通过 `require('@yanit/rmd')` 或 ESM `import` 即可使用
同步 / 异步删除与路径存在性检查 API。

### CommonJS

```js
const { removeSync, removeAsync, pathExists } = require("@yanit/rmd");

// 同步删除（接受字符串或字符串数组）
removeSync("./dist");
removeSync(["./build", "./.cache"]);

// 异步删除
await removeAsync("./node_modules");

// 检查路径是否存在
if (pathExists("./tmp")) {
  removeSync("./tmp");
}
```

### ESM (TypeScript)

```ts
import { removeSync, removeAsync, pathExists } from "@yanit/rmd";

removeSync("dist");
await removeAsync(["build", ".cache"]);

if (pathExists("tmp")) {
  removeSync("tmp");
}
```

### API 说明

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `removeSync` | `(targets: string \| string[]) => void` | 同步删除一个或多个路径 |
| `removeAsync` | `(targets: string \| string[]) => Promise<void>` | 异步删除一个或多个路径 |
| `pathExists` | `(target: string) => boolean` | 判断路径是否存在 |

> 不传参数或传入 `null` 时返回空操作；传入非字符串/非数组类型会抛出
> `TypeError`。删除支持符号链接、只读文件、嵌套目录，并对不存在的目标
> 幂等（不抛错）。

## 3. 作为项目依赖

```bash
npm install @yanit/rmd
```

```js
// 在构建脚本 / 清理任务中调用
const { removeSync } = require("@yanit/rmd");
removeSync("coverage");
```

## 4. 平台支持说明

预编译二进制内置在主包中，覆盖以下平台（用户无需安装 Rust 工具链）：

- macOS：`darwin-x64`、`darwin-arm64`
- Linux：`x86_64/arm64` (glibc / musl)，需在 Linux 构建机产出
- Windows：需在 Windows 构建机产出

`native.js` 会在运行时按当前平台自动加载对应的 `.node` 二进制。
