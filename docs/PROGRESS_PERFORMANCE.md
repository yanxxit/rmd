# 删除进度展示 vs 删除性能的平衡（过程文档）

> 适用范围：`tuari-rmd` 的删除进度 / loading / 总时间功能。
> 目的：记录"交互体验"与"删除性能"之间的取舍演进，方便后期维护与学习。
> 最后更新：2026-08-14

---

## 1. 背景与目标

`tuari-rmd` 是一个 rimraf 风格的递归删除工具（Rust + napi-rs 原生模块）。
在删除大目录（如 `node_modules`、构建产物）时，用户面临两个问题：

1. **无反馈**：删除是阻塞操作，终端长时间无任何输出，用户无法判断"卡住没 / 删了多少"。
2. **性能敏感**：删除本身是大 I/O 操作，任何额外的遍历都会显著拖慢速度。

我们希望在**尽量不干扰删除速度**的前提下，提供**实时反馈**。

---

## 2. 三个层次的"进度"概念（务必区分）

| 概念 | 含义 | 是否需要预遍历整树 | 成本 |
|------|------|-------------------|------|
| **已删数量 (done)** | 已经删除的条目数 | 否（删的时候顺便数） | 几乎为零 |
| **期望总数 (total)** | 将要删除的条目总数 | **是**（删除前先 `read_dir` 递归一遍） | 一次完整遍历，I/O 成本高 |
| **百分比 / 进度条** | `done / total` | 是（依赖 total） | 在 total 成本之上 |

**关键结论**：`done`（实时已删数量）可以"免费"获得，而 `total`（期望总数）必须预先遍历整棵树。
所谓"性能干扰"，**几乎全部来自"预先遍历整树来算 total"**，而不是来自 `done` 的计数。

---

## 3. 演进时间线

### 阶段一：最初的进度条（存在性能缺陷）

最初实现里，`removeSync` **无条件**调用 `count_entries(target)` 预遍历整棵树来算 `total`，
无论用户是否要进度条、`total` 是否为 0。

后果：
- 即使不加 `--progress`，也会先遍历一遍整树 → **默认就不快**。
- CLI 在 TTY 下还自动开启进度条，进一步放大开销。

### 阶段二：拆出 `track` 标志，关闭默认预遍历

把"是否统计"抽象为 `track: bool`：
- `track = false`（不加进度、非 TTY）：完全跳过 `count_entries` 预遍历与所有 `report` 回调 → 最快。
- `track = true`：才预遍历 + 回调。

效果：不加 `--progress` 时回到与裸 `fs.rmSync` 同量级（−20% 左右，纯属测量噪声）。

但遗留问题：`done` 的计数在 `std::fs::remove_dir_all` 的 **fast-path（一次性盲删整棵子树）** 里只能 `+1`，
导致"实时已删数量"严重失真（实际删了 361 个条目，却只显示 `removed 1`）。

### 阶段三：loading + 实时数量（当前方案）

用户明确诉求：**删除时支持 loading 效果 + 实时已删数量，但不预先遍历查询期望总数**。

决策：把"统计已删数量"与"预遍历期望总数"**彻底解耦**为两个独立标志：

- `track`：是否统计并实时上报 `done`（有回调即 true）。
- `count_total`：是否预遍历整树算 `total`（仅 `--progress` 详细模式为 true）。

并且：**任何"有统计需求"的模式（loading 或 detailed）都放弃 fast-path 盲删，改走 `manual` 逐条删除**，
从而每个条目的删除都精确 `+1` 并实时回调；只有"完全无统计的最快模式"才用 fast-path 盲删。

---

## 4. 当前模式矩阵（行为一览）

| 触发方式 | track | count_total | 删除路径 | 输出 | 预遍历整树? |
|---------|-------|-------------|---------|------|------------|
| 默认（不加参数） | ✓ | ✗ | manual 逐条 | `⠋ deleting… removed N` (loading + spinner) | **否** |
| `--progress` | ✓ | ✓ | manual 逐条 | `████ 100% (482/482)` 百分比进度条 | **是** |
| `--no-progress` | ✗ | ✗ | fast-path 盲删 | 仅最终 `done: removed N target(s) in Xs` | **否** |
| `--async`（当前不触发回调） | ✗ | ✗ | fast-path 盲删 | 同上 | **否** |

> 注：loading 与 detailed 都用 `manual` 逐条删除，区别仅在于 `count_total`
> （detailed 会先预遍历算 total 以显示百分比；loading 的 total 恒为 0，只显示已删数量）。

---

## 5. 为什么"有统计就放弃 fast-path"？

`std::fs::remove_dir_all` 由操作系统一次性递归删除整棵子树，速度极快，
**但它无法在删除过程中逐条回调**——要么删前不知道有多少、要么删后已无迹可寻。

两条路：

- **保留 fast-path + 预遍历补数**：为让 loading 数字准确，必须在删前/删后 `read_dir` 数一遍
  → 又回到"预遍历干扰性能"，违背用户诉求。
- **放弃 fast-path，走 manual 逐条**：每个文件/目录删除时精确 `+1`，spinner 持续跳动、
  数字真实；代价是删除稍慢。但 manual 内部对同层文件/链接用 rayon **并行删除**，开销可控。

用户诉求优先级是"实时反馈 + 不预遍历" > "极致删除速度"，所以选择后者。
**极致速度留给 `--no-progress` / `--async`**，它们仍走 fast-path 盲删，不受任何统计影响。

---

## 6. 实测数据（361~482 条目树，单目录）

| 模式 | 回调次数 | 末值(done) | 单调 | 耗时 |
|------|---------|-----------|------|------|
| loading（默认） | ~92 | ≈362 | ✓ | ~16ms |
| detailed (`--progress`) | ~92 | ≈362 | ✓ | ~19ms |
| `--no-progress`（最快） | 0 | — | — | ~15ms |

结论：
- loading 相比最快模式仅多 ~1ms（manual 逐条 + 回调开销），**未预遍历整树**。
- detailed 因预遍历 total，耗时略高且额外一次整树 I/O，但换取精确百分比。
- `done` 与预扫描 `total` 口径存在 **±1** 差异（根/边界计入差异），不影响体验
  （loading 不显示百分比；detailed 进度条已 `clamp` 到 100%）。

---

## 7. 关键代码位置

| 职责 | 文件 | 位置 |
|------|------|------|
| `track` / `count_total` 解耦、预遍历开关 | `src/lib.rs` | `remove_sync`（第 44 行附近） |
| `manual` 逐条删除 + 实时 `done += 1` | `src/remove.rs` | `manual_remove_dir_all` |
| fast-path 盲删（仅无 track 时） | `src/remove.rs` | `remove_dir_all` 的 `!track` 分支 |
| 模式路由（默认 / --progress / --no-progress） | `bin/rmd.js` | `main()` 参数解析与删除循环 |
| loading 渲染器（spinner + 实时数量） | `bin/rmd.js` | `createLoading()` |
| detailed 进度条渲染器 | `bin/rmd.js` | `createProgress()` |
| JS 层透传 `detailed` 选项 | `index.js` | `removeSync` / `removeAsync` |
| 类型声明 | `native.d.ts` / `index.d.ts` | `countTotal` / `detailed` |

---

## 8. 测试覆盖

`test/index.test.js` 中相关用例（共 22 项，全部通过）：
- `loading mode`：断言 `total === 0`、回调触发、`done` 单调非递减、`done > 0`。
- `detailed mode`：断言 `total > 0`、末值靠近 `total`（容差 ±1）、`done` 单调、边界 `dn <= tot + 1`。

> 容差说明：因为 `manual` 逐条计数与 `count_entries` 预遍历的口径可能有 ±1 差异，
> 断言使用 `Math.abs(done - total) <= 1` 而非严格相等，避免脆弱测试。

---

## 9. 维护者须知（踩坑清单）

1. **不要再把 `count_entries` 写死在 `remove_sync` 里**。它必须受 `count_total` 控制，
   否则"不加 --progress 也会预遍历"的缺陷会回归。
2. **不要为了 loading 数字"准确"而给 fast-path 加预遍历**。这会重新引入性能干扰。
   真实体验由 `manual` 逐条计数保证，而非靠预遍历补齐。
3. **新增统计维度时，先问：需要 total 吗？** 若只需"已删数量/已用时间"，绝不要预遍历。
4. **manual 与 count_entries 口径差异 ±1 是已知现象**，测试断言已容忍，勿强行对齐导致脆弱性。
5. **`--async` 当前不触发进度回调**（napi ThreadsafeFunction 回调复杂，已暂时忽略）。
   若日后要支持异步进度，需重新引入线程安全回调，并重新评估性能。

---

## 10. 一句话总结

> **"已删多少"免费送，"总共多少"要付费。**
> 所以默认只显示实时已删数量（loading，不预遍历），把"预遍历算总数"留给显式的 `--progress`，
> 把"极速盲删"留给 `--no-progress` / `--async`。三种诉求各得其所，互不干扰。
