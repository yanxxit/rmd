"use strict";

// 稳定入口：包装 napi 生成的 native.js，把单个字符串参数归一化为数组，
// 同时支持 require('./index') 作为 CLI 直接执行。
const native = require("./native");

function toArray(targets) {
  if (Array.isArray(targets)) return targets;
  if (typeof targets === "string") return [targets];
  if (targets == null) return [];
  throw new TypeError("targets must be a string or string[]");
}

function removeSync(targets) {
  return native.removeSync(toArray(targets));
}

function removeAsync(targets) {
  return native.removeAsync(toArray(targets));
}

function pathExists(target) {
  return native.pathExists(target);
}

module.exports = {
  removeSync,
  removeAsync,
  pathExists,
  // 底层原生绑定（高级用法）
  native,
};

// 直接执行时作为 CLI 运行
if (require.main === module) {
  require("./bin/tuari-rmd.js");
}
