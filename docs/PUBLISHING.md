# 发布到 npm

本包 `@yanit/rmd` 直接内置所有平台的预编译 `.node` 二进制，发布为单个 npm 包。

## 推荐发布方式：`npm login` + `npm publish`

经实测，本账号开启强制 2FA，普通 token / `--otp` 方式会报 403，使用交互式
`npm login` 登录后可正常发布（登录会话已通过 2FA 校验，凭证缓存在本地
`~/.npmrc`，后续 `npm publish` 直接复用）。

### 步骤

```bash
# 1. 交互式登录（按提示输入 npm 用户名/密码/邮箱/2FA 动态码）
npm login

# 2. 确认登录身份
npm whoami

# 3. 构建当前平台二进制（macOS 仅产出 darwin-arm64 / darwin-x64）
npm run build

# 如需要全平台（受跨平台限制，见下），执行：
# npm run build:all

# 4. 发布
npm publish --access public
```

发布成功后可在 https://www.npmjs.com/package/@yanit/rmd 查看。

## 跨平台说明

- 在 **macOS** 上 `npm run build:all` 仅能产出 2 个 macOS 二进制
  （`index.darwin-arm64.node`、`index.darwin-x64.node`）；
- **Linux** 目标需在装有交叉编译器的 Linux 机器上构建；
- **Windows** 目标只能在 Windows 上构建。

若要发布覆盖全部平台的正式版本，请在 **Linux 机器**执行同样的
`npm login` + `npm run build:all` + `npm publish --access public`
（Linux 可交叉编译 macOS + glibc/musl，但仍不能编译 Windows）。

## 版本号

发布版本取自 `package.json` 的 `version` 字段。发布前请先手动改好版本号，
（保持与 `Cargo.toml` 的 `version` 一致），再执行 `npm publish`。

## 备选：CI 自动发布

推送 git tag 会触发 `.github/workflows/CI.yml` 自动构建并发布，前提是仓库
`NPM_TOKEN` secret 为带 **bypass 2fa** 权限的 granular token。CI 失败时可回退
到上面的本地 `npm login` + `npm publish` 方式。
