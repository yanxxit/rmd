// 基准：测量"新增功能"（进度条/总量统计）带来的额外耗时百分比。
// 对比两组：
//   A. 带进度：removeSync(target, cb)  —— 内部 count_entries 预遍历整棵树 +
//      每删一个条目调用一次 JS 回调（新增功能）。
//   B. 原功能基线：fs.rmSync(target, {recursive:true, force:true})
//      —— 不预遍历、无回调（代表"没有新增功能"的纯删除）。
import { removeSync } from "../index.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTree(root, depth, width, filesPerDir) {
  mkdirSync(root, { recursive: true });
  for (let i = 0; i < filesPerDir; i++) {
    writeFileSync(join(root, `f${i}.txt`), "x".repeat(64));
  }
  if (depth === 0) return;
  for (let i = 0; i < width; i++) {
    makeTree(join(root, `d${i}`), depth - 1, width, filesPerDir);
  }
}

const scenarios = [
  { name: "小 (~数百文件)", depth: 3, width: 4, files: 6 },
  { name: "中 (~5千文件)", depth: 4, width: 4, files: 6 },
  { name: "大 (~2.5万文件)", depth: 5, width: 3, files: 6 },
];

const RUNS = 5;

for (const sc of scenarios) {
  const base = join(tmpdir(), `rmd-bench-${sc.name.replace(/\W/g, "")}`);
  const aPath = join(base, "A");
  const bPath = join(base, "B");

  // 预热
  rmSync(aPath, { recursive: true, force: true });
  rmSync(bPath, { recursive: true, force: true });
  makeTree(aPath, sc.depth, sc.width, sc.files);
  makeTree(bPath, sc.depth, sc.width, sc.files);

  // B: 原功能基线（纯 fs.rmSync，无 count / 无回调）
  let bTotal = 0;
  for (let r = 0; r < RUNS; r++) {
    makeTree(bPath, sc.depth, sc.width, sc.files);
    const t = performance.now();
    rmSync(bPath, { recursive: true, force: true });
    bTotal += performance.now() - t;
  }
  const bAvg = bTotal / RUNS;

  // A: 带进度（count_entries 预遍历 + 每条目 JS 回调）
  let aTotal = 0;
  for (let r = 0; r < RUNS; r++) {
    makeTree(aPath, sc.depth, sc.width, sc.files);
    const t = performance.now();
    removeSync(aPath, () => {}); // 空回调，仅测量 count + 回调跨界开销
    aTotal += performance.now() - t;
  }
  const aAvg = aTotal / RUNS;

  // C: 不加 --progress（track=false，跳过预遍历与回调）—— 即默认 CLI 行为
  let cTotal = 0;
  for (let r = 0; r < RUNS; r++) {
    makeTree(aPath, sc.depth, sc.width, sc.files);
    const t = performance.now();
    removeSync(aPath); // 不传回调 -> track=false
    cTotal += performance.now() - t;
  }
  const cAvg = cTotal / RUNS;

  const overheadMs = aAvg - bAvg;
  const pct = bAvg > 0 ? (overheadMs / bAvg) * 100 : (aAvg > 0 ? Infinity : 0);
  const pctStr = Number.isFinite(pct) ? `+${pct.toFixed(1)}%` : "(基线≈0，无法按比例计算)";
  const cOverhead = cAvg - bAvg;
  const cPct = bAvg > 0 ? (cOverhead / bAvg) * 100 : 0;
  console.log(
    `${sc.name.padEnd(16)} | 基线 ${bAvg.toFixed(1)}ms | 带进度 ${aAvg.toFixed(1)}ms(+${pct.toFixed(1)}%) | ` +
    `无进度 ${cAvg.toFixed(1)}ms(+${cPct.toFixed(1)}%)`
  );
}
