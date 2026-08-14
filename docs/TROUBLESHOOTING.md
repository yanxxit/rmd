# 异常处理与过程资产

本文档记录 `@yanit/rmd` 项目在开发与发布过程中遇到的真实问题、原因分析与处理
结果，作为后期维护的参考。状态分为：

- ✅ 已解决
- ⚠️ 部分解决 / 有临时方案
- ❌ 未解决（保留待查）

---

## 1. GitHub Actions 自动发布总是失败

- **现象**：`.github/workflows/CI.yml` 执行发布步骤失败，无法稳定发布到 npm。
- **原因**：CI 流程复杂（多 runner 构建 + 下载产物 + sub-package 模式发布），
  叠加 npm 2FA 限制后极易失败。
- **处理**：✅ 改为"CI 默认 + 本地 fallback"双路径。发布模式从 sub-package
  改为**主包内置全部 `.node` 二进制**；CI 失败时可本地用
  `npm login` + `npm publish --access public` 发布。详见
  [PUBLISHING.md](./PUBLISHING.md)。
- **遗留**：CI 发布路径本身是否仍可用未经本次验证（因改用本地发布）。

---

## 2. 删除 `package-lock.json` 是否影响发布

- **现象**：用户询问删除 `package-lock.json` 是否有影响。
- **分析**：项目未使用 `npm ci`（CI 用 `npm install`），lock 文件不参与发布
  产物（`files` 字段不含它）。删除后 `npm install` 会自动重建。
- **处理**：✅ 确认无破坏性影响。如需干净重建：`rm package-lock.json && npm install`。
- **注意**：删除会降低依赖版本可复现性（devDependency `@napi-rs/cli` 用 `^3`
  范围），但对发布无影响。

---

## 3. `git push origin v0.1.20` 报错 refspec 不匹配

- **现象**：
  ```
  error: src refspec v0.1.20 does not match any
  ```
- **原因**：本地不存在名为 `v0.1.20` 的 tag。版本号已在 `package.json` 改到
  `0.1.20` 并提交，但**没有打对应的 git tag**。本地最新 tag 停留在 `v0.1.18`，
  且存在一个孤儿 tag `v`（空名残留）。
- **处理**：⚠️ 已定位原因。后续发布改用本地 `npm run release`（不依赖 tag），
  或补打 tag：`git tag v0.1.20 && git push origin v0.1.20`。
- **遗留**：❌ 孤儿 tag `v` 未清理，建议 `git tag -d v`。

---

## 4. `npm publish` 403 — 普通 token 被 2FA 拦截

- **现象**：
  ```
  403 Forbidden - Two-factor authentication or granular access token with
  bypass 2fa enabled is required to publish packages.
  ```
- **原因**：npm 账号开启**强制 2FA 发布**，普通 NPM_TOKEN 无法通过。
- **处理**：✅ 改用交互式 `npm login`（登录会话已通过 2FA 校验，凭证缓存在
  `~/.npmrc`），之后 `npm publish --access public` 成功。详见
  [PUBLISHING.md](./PUBLISHING.md)。

---

## 5. `npm publish` 403 — 带 bypass 2fa 的 token 仍失败

- **现象**：生成的 granular token 已勾选 "bypass 2fa"，导出
  `NODE_AUTH_TOKEN` 后 `npm publish` 仍报同样的 403。
- **原因（推测，未验证）**：`@yanit/rmd` 当时在 npm 上**尚未创建**，granular
  token 创建时无法绑定到该包，导致 bypass 2fa 权限实际未生效。
- **处理**：❌ 未彻底解决。已验证可行的替代方案是 `npm login`（见第 4 条）。
- **后续建议**：若要用 token 发布，先去 npm 网页手动创建空的 `@yanit/rmd`
  占位包，再生成绑定该包且勾选 bypass 2fa 的 granular token，并配到 CI 的
  `NPM_TOKEN` secret。

---

## 6. `npm publish --otp <code>` 仍 403

- **现象**：传入 `--otp 260516` 后报与第 4 条完全相同的 403。
- **原因**：该账号的 2FA 策略**不接受交互式 OTP 验证码**，只认带 bypass 2fa
  权限的 token（或 `npm login` 会话）。
- **处理**：✅ 已明确 OTP 路径不通，改用 `npm login` 发布。

---

## 7. 跨平台二进制缺失

- **现象**：本地（macOS）`npm publish` 的 tarball 仅含：
  ```
  index.darwin-arm64.node
  index.darwin-x64.node
  ```
  缺少 Linux / Windows 共 6 个平台的 `.node`。
- **原因**：macOS 无法交叉编译 Linux（需 gcc-aarch64-linux-gnu / musl-tools）
  与 Windows（无法从非 Windows 交叉）。`scripts/build-all.mjs` 已对 macOS 上的
  Linux/Windows target 做跳过处理。
- **处理**：⚠️ 临时方案：当前 `0.1.20` 仅覆盖 macOS，供本机使用。
- **遗留**：❌ 全平台发布未完成。正式全平台需在 **Linux 机器**执行
  `npm run release`（Linux 可交叉编译 macOS + glibc/musl，仍不能编译 Windows）。
  Windows 2 平台需单独在 Windows 构建后合并。

---

## 8. 发布警告：`repository.url` 被 normalize

- **现象**：
  ```
  npm warn publish "repository.url" was normalized to
  "git+https://github.com/yanxxit/rmd.git"
  ```
- **原因**：`package.json` 的 `repository.url` 为
  `https://github.com/yanxxit/rmd`，npm 期望 `git+https` 形式。
- **处理**：⚠️ 仅 warning，不影响发布。CI 发布步骤已做该 normalize，本地发布
  未处理。
- **后续建议**：将 `package.json` 改为
  `"url": "git+https://github.com/yanxxit/rmd.git"` 以消除警告。

---

## 9. npm token 明文暴露

- **现象**：调试过程中用户将 NODE_AUTH_TOKEN 明文粘贴到对话中（两个 token）。
- **风险**：token 泄露可被用于发布/操作账号。
- **处理**：⚠️ 已提醒用户去 npm 后台 revoke 这两个 token 并重新生成。
  `@yanit/rmd` 当时从未成功发布，故包本身无泄露影响。
- **后续建议**：任何出现在对话/日志中的 token 都应视为已泄露，立即 revoke。

---

## 问题速查表

| # | 问题 | 状态 | 关键动作 |
| --- | --- | --- | --- |
| 1 | CI 发布失败 | ✅ | 改本地发布 fallback |
| 2 | 删 lock 文件 | ✅ | 无影响，自动重建 |
| 3 | push tag refspec 不匹配 | ⚠️ | 补打 tag / 用本地发布 |
| 4 | 普通 token 403 | ✅ | 改用 `npm login` |
| 5 | bypass token 仍 403 | ❌ | 疑似包未创建致权限未绑定 |
| 6 | `--otp` 仍 403 | ✅ | 账号不认 OTP，用 login |
| 7 | 跨平台二进制缺失 | ❌ | 需 Linux/Windows 机器构建 |
| 8 | repository.url 警告 | ⚠️ | 改 git+https 形式 |
| 9 | token 明文暴露 | ⚠️ | 已提醒 revoke |

---

## 维护检查清单（发布前）

- [ ] `npm whoami` 确认已登录（或已 `npm login`）
- [ ] `package.json` / `Cargo.toml` 版本号一致且已递增
- [ ] `npm run build` 产出当前平台 `index.*.node`
- [ ] （全平台）在对应系统构建 Linux/Windows 二进制
- [ ] 清理孤儿 git tag（如 `v`）
- [ ] 如需 token 发布，确认其为绑定 `@yanit/rmd` 且 bypass 2fa 的 granular token
- [ ] 切勿将 token 粘贴到对话 / 日志

---

## 10. 代码缺陷：删除"指向目录的符号链接"会误删目标内容

- **现象（历史 bug）**：`manual_remove_dir_all` 用 `entry.metadata()`（会跟随符号
  链接）判断是否为目录。对一个"指向目录的符号链接"，返回的是目标目录的
  metadata，被当真实子目录递归进入**目标**删除，导致用户数据被误删。
- **原因**：使用跟随链接的 `metadata()` 而非 `entry.file_type()`。
- **处理**：✅ 已修复（`src/remove.rs`）。
  - 改为用 `entry.file_type()`（不跟随链接）判断；
  - 符号链接单独走 `remove_file`（只删链接本身），绝不进入目标。
  - 并补充回归测试 `test/index.test.js` 第 9b 项（删除指向目录的符号链接后
    断言目标目录及内容完好），13 项测试全部通过。
- **状态**：✅ 已解决 + 有回归测试守护。

## 11. 代码改进：删除失败错误携带路径

- **现象**：多目标批量删除时，任一文件失败抛出的错误只有 `Permission denied`
  等通用信息，无法定位是哪个文件出错。
- **处理**：✅ 已修复（`src/remove.rs`）。`with_retry` 增加 `path` 参数，`read_dir` /
  `entry` / `file_type` / `symlink_metadata` 等错误均附带出错路径，例如：
  ```
  remove failed: /path/to/broken/sub/file.txt: Permission denied
  ```
  路径信息经 `lib.rs` 的 `to_err` 自动透传到 `removeSync` / `removeAsync` 异常。
- **状态**：✅ 已解决。

---

## 下一个优化方向（推荐）

按性价比排序，建议下一步做：

1. **【高优先级】并行删除提升性能 ✅ 已实现**（见优化分析 #4）
   `manual_remove_dir_all` 已用 `rayon` 对**同一目录层内的文件 / 符号链接**并行删除，
   目录删除仍严格后序（必须清空后才能删父目录，避免竞态）。实现要点：
   - 显式栈 + `phase` 标记（`false`=展开子项，`true`=删除空目录）保证后序且无重复
     `read_dir`；
   - 每层的文件/链接用 `leaves.par_iter().for_each(...)` 并发删除，首个错误通过
     `Mutex<Option<io::Error>>` 收集并向上传播；
   - 目录删除保持顺序、严格后序，符号链接用 `entry.file_type()`（不跟随）仅删链接本身。
   - 回归守护见 `test/index.test.js` 的 `#9c`（400 文件 / 深度 4 大目录树 + 树外符号链接）。

2. **【中优先级】`--dry-run` / 预览落到 Rust 侧**（见 #7）
   当前 CLI 的 `--dry-run` 在 JS 层实现，Rust 无"只收集待删路径"能力。可暴露
   `collect_paths` API，供 dry-run、进度条、测试复用，也避免 JS 重复遍历逻辑。

3. **【中优先级】`preserveRoot` 根目录守卫**（见 #10）
   `remove_sync` API 层无根目录保护，调用方传入 `/` 会真删。建议在 Rust 侧加
   对 `/`、挂载点、cwd 的守卫（CLI 已做，API 缺失）。

4. **【中优先级】`continueOnError` / 收集失败列表**（见 #8）
   当前任一文件失败即整体返回 Err，已删部分不回滚。可加 `continueOnError` 选项，
   返回 `failed_paths: string[]` 让用户决策，而非直接中断。

5. **【低优先级】可配置重试策略**（见 #6）
   `MAX_RETRIES=5` / 10s 上限对 NFS/SMB 网络盘不友好，可改为指数退避或配置项。

> 并行删除（#1）已实现，其 + 符号链接的集成测试 `#9c` 已作为回归守护。
