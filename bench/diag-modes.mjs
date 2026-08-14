import { removeSync } from "../index.js";
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

function bench(label, opts) {
  rmSync("/tmp/demo", { recursive: true, force: true });
  execSync("node bin/gen.js /tmp/demo -n 300 -s 1k -d 2");
  const seq = [];
  const t = Date.now();
  if (opts.detailed) {
    removeSync("/tmp/demo", { detailed: true, onProgress: (d) => seq.push(d) });
  } else if (opts.none) {
    removeSync("/tmp/demo");
  } else {
    removeSync("/tmp/demo", (d) => seq.push(d));
  }
  const ms = Date.now() - t;
  const mono = seq.every((v, i, a) => i === 0 || v >= a[i - 1]);
  console.log(
    `${label}: 回调${seq.length}次, 末值${seq[seq.length - 1]}, 单调=${mono}, ${ms}ms`
  );
}

bench("loading(默认)", {});
bench("detailed(--progress)", { detailed: true });
bench("none(--no-progress)", { none: true });
