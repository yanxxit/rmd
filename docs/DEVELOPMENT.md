# 开发 / 编译 / 发布指南

本文档覆盖 `@yanit/rmd` 的完整开发、本地编译与发布流程。

## 1. 项目结构

```
tuari-rmd/
├── Cargo.toml            # Rust crate（cdylib，产出 .node）
├── src/
│   ├── lib.rs            # napi 导出入口
│   └── remove.rs         # 删除核心逻辑
├── native.js             # napi 生成的原生加载器（按平台 require .node）
├── index.js              # 稳定 JS 入口（包装 native.js，兼作 CLI）
├── bin/
│   ├── rmd.js            # CLI 实现
│   └── gen.js            # 测试数据生成器
├── index.d.ts            # 类型声明
├── scripts/
│   ├── build-all.mjs     # 本地全平台编译
│   └── release.mjs       # 本地发布（版本自增 + 编译 + npm publish）
├── .github/workflows/
│   └── CI.yml            # 默认发布流程（tag 触发）
└── package.json
```

### 包结构说明

主包 `@yanit/rmd` **直接内置所有平台的预编译 `.node` 二进制**（不再拆分子包）。
`native.js` 在运行时按 `process.platform` / `process.arch` 优先加载仓库根目录下的
`index.<platform>.node` 文件（本地优先于 sub-package），因此用户 `npm install` 后
无需 Rust 工具链即可使用。

---

## 2. 环境准备

需要：

| 工具 | 版本 | 用途 |
| --- | --- | --- |
| Node.js | >= 14（开发用 24） | 构建脚本 / 测试 / 发布 |
| npm | 随 Node | 依赖与发布 |
| Rust | stable | 编译原生二进制 |
| rustup | 最新 | 管理交叉编译 target |
| `@napi-rs/cli` | ^3 | napi 构建工具（已为 devDependency） |

安装依赖：

```bash
npm install
```

确保 Rust 工具链就绪：

```bash
rustc --version
cargo --version
rustup target list --installed
```

---

## 3. 开发 / 调试

### 修改 Rust 代码后本地编译（仅当前平台）

```bash
npm run build        # release 构建，产出 index.<本平台>.node
# 或
npm run build:debug  # debug 构建（更快，带调试符号）
```

### 运行测试

```bash
npm test
```

测试会调用 `index.js`（最终走到 `native.js` 加载本地 `.node`），覆盖同步/异步删除、
符号链接、只读文件、嵌套目录、幂等等场景。

### 本地试运行 CLI

```bash
node bin/rmd.js -rf ./dist
node bin/rmd.js gen ./sandbox -n 1000 -s 1m -d 3
```

---

## 4. 编译（平台二进制）

### 4.1 仅当前平台

```bash
npm run build
```

产物：`index.<platform>.node`（如 `index.darwin-arm64.node`），落在仓库根目录。

### 4.2 全平台（本地）

```bash
npm run build:all
```

`scripts/build-all.mjs` 会：

1. 清理旧的 `*.node` 产物；
2. 对缺失的 Rust target 自动执行 `rustup target add`；
3. 逐个 `napi build --platform --release --target <triple>`；
4. 列出产物。

支持的目标（见 `TARGETS`）：

| target | 平台 | macOS 本地能否编译 |
| --- | --- | --- |
| `x86_64-apple-darwin` | macOS x64 | ✅ |
| `aarch64-apple-darwin` | macOS arm64 | ✅ |
| `x86_64-unknown-linux-gnu` | Linux x64 (glibc) | ❌ 需交叉链接器 |
| `aarch64-unknown-linux-gnu` | Linux arm64 (glibc) | ❌ 需交叉链接器 |
| `x86_64-unknown-linux-musl` | Linux x64 (musl) | ❌ 需 musl 工具链 |
| `aarch64-unknown-linux-musl` | Linux arm64 (musl) | ❌ 需交叉链接器 + musl |
| `x86_64-pc-windows-msvc` | Windows x64 | ❌ 无法从 macOS/Linux 交叉 |
| `aarch64-pc-windows-msvc` | Windows arm64 | ❌ 无法交叉 |

> ⚠️ **跨平台限制**：在 macOS 上 `build:all` 只会产出 2 个 macOS 二进制；
> Linux 目标需要在**装有对应交叉编译器的 Linux 机器**上构建；Windows 目标只能在
> Windows 上构建。若需要"一次产出全平台"，应在 Linux 机器执行发布（Linux 可交叉编译
> macOS + glibc/musl，但仍不能编译 Windows）。

### 4.3 在 Linux 上交叉编译（可选）

若在 Linux 构建机，先安装交叉工具链：

```bash
# glibc aarch64
sudo apt-get install -y gcc-aarch64-linux-gnu
# musl
sudo apt-get install -y musl-tools
```

再执行 `npm run build:all` 即可产出 macOS + Linux 共 6 个二进制（Windows 除外）。

---

## 5. 发布

发布有**两条路径**：默认走 CI（tag 触发），CI 失败时可本地手动发布。

### 5.1 路径 A：GitHub Actions（默认）

推一个 tag 即触发 `.github/workflows/CI.yml`：

```bash
git tag v0.1.21
git push origin v0.1.21
```

CI 会：

1. 在 6 个 runner 上分别 `napi build` 各平台；
2. 下载全部 `*.node` 到仓库根目录；
3. 将 `package.json` / `Cargo.toml` 版本同步为 tag 名；
4. `npm publish --access public`。

> CI 的 `NPM_TOKEN` secret 必须是**带 bypass 2fa 权限的 granular token**（见 5.3）。

### 5.2 路径 B：本地发布（CI 失败时的 fallback）

```bash
npm run release          # 版本 patch+1（0.1.20 -> 0.1.21），编译全平台，发布
npm run release 0.2.0    # 指定版本
npm run release:dry      # 预览，不发布
```

`scripts/release.mjs` 流程：

1. 读取当前版本，计算目标版本（默认 patch+1）；
2. 写入 `package.json` + `Cargo.toml`；
3. `npm install` 重建 lockfile；
4. `npm run build:all` 编译本机可编译的平台；
5. 校验至少产出当前平台的 `.node`；
6. `npm publish --access public`。

`release.mjs` 支持 `--no-publish`（只升级版本 + 编译，不发布）与 `--dry-run`。

### 5.3 路径 C：本地升级 + 提交 + 打 tag + 推送（触发 CI 发布）

```bash
npm run release:push          # 升级版本、构建、git 提交、创建 vX.Y.Z tag、推送
npm run release:push 0.2.0    # 指定版本
npm run release:push:dry      # 预览，不改动
```

`scripts/release-and-push.mjs` 流程：

1. `npm run release -- --no-publish`：自动升级版本 + 构建（**不发布到 npm**）；
2. `git add -A && git commit -m "chore: 发布 X.Y.Z 版本"`；
3. `git tag vX.Y.Z`；
4. `git push origin <branch>` 与 `git push origin vX.Y.Z`。

tag 推送到 origin 后会触发 `.github/workflows/CI.yml` 自动构建并发布到 npm，
因此该路径本地**不调用 `npm publish`**，避免重复发布。

> 注意：`release.mjs` 的 `npm publish` 当前**不带 `--otp`**。若账号开启 2FA 且
> 仅接受 OTP，需手动在脚本后追加 `--otp`，或改用 bypass-2fa token（推荐）。

### 5.3 npm 2FA（重要！）

本账号已开启 **强制 2FA 发布**，普通密码 / 普通 token / `--otp` 均可能失败，
**必须**使用带 **bypass 2fa** 的 token：

1. 登录 https://www.npmjs.com/settings/yanxxit/tokens
2. **Generate New Token → Granular access token**
3. 包范围选 `@yanit/rmd`，勾选 **Publish**
4. **务必勾选 "bypass 2fa"**（否则 403）
5. 复制 token，本地发布前导出：

```bash
export NODE_AUTH_TOKEN=npm_你的token
npm publish --access public
```

或在 `npm run release` 前导出同一变量。

> 若 `@yanit/rmd` 在 npm 上**尚未创建**，granular token 创建时可能选不到该包、
> 导致 bypass 权限无法绑定。此时先去 npm 网页手动创建一个空的 `@yanit/rmd` 占位包，
> 再生成绑定该包的 bypass-2fa token。

常见问题：

| 报错 | 原因 | 解决 |
| --- | --- | --- |
| `Two-factor authentication or ... bypass 2fa enabled is required` | token 没勾 bypass 2fa / 包不存在导致权限未绑定 | 用 bypass-2fa token，或先在网页建包 |
| `E403 ... already exists` | 版本已发布 | 升版本号再发 |
| `npm warn ... repository.url was normalized` | `repository.url` 非 `git+https` 形式 | 改成 `git+https://github.com/yanxxit/rmd.git` |

---

## 6. 版本与 Tag 约定

- `package.json` 的 `version` 与 `Cargo.toml` 的 `version` 必须保持一致。
- 本地 `npm run release` 会自动同步两者，无需手动打 tag。
- CI 路径下，tag 名 `vX.Y.Z` 即为发布版本（CI 读取 `github.ref_name`）。

---

## 7. 完整示例

### 在 macOS 上发布（仅 macOS 平台）

```bash
export NODE_AUTH_TOKEN=npm_带bypass2fa的token
npm run release          # 0.1.20 -> 0.1.21，含 macOS arm64/x64
```

### 全平台正式发布

在 Linux 构建机上：

```bash
export NODE_AUTH_TOKEN=npm_带bypass2fa的token
npm run release 0.1.21   # 含 macOS + Linux(glibc/musl) 共 6 平台
```

（Windows 2 平台仍需单独在 Windows 上构建后合并发布，或暂不包含。）

---

## 8. 故障排查

```bash
# 确认 npm 登录身份
npm whoami

# 查看 token 列表（确认 bypass 2fa 列）
npm token ls

# 预览将要发布的文件
npm pack --dry-run

# 确认产物齐全
ls -la *.node
```
