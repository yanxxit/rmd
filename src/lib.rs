#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

mod remove;

use napi::bindgen_prelude::{AsyncTask, Error, Function, Result, Status};
use napi::Task;
use std::path::PathBuf;

fn to_err(e: std::io::Error) -> Error {
  Error::new(Status::GenericFailure, format!("remove failed: {e}"))
}

pub struct RemoveTask {
  targets: Vec<PathBuf>,
  track: bool,
  count_total: bool,
}

impl Task for RemoveTask {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> Result<Self::Output> {
    let mut done: u64 = 0;
    let total: u64 = if self.count_total {
      self.targets
        .iter()
        .map(|t| remove::count_entries(t.as_path()))
        .sum()
    } else {
      0
    };
    let report = |d: u64, t: u64| {
      // async 模式下暂无 JS 进度回调（compute 运行在 libuv 线程，无法安全回调 JS），
      // 此处占位保持与同步接口一致的删除逻辑。
      let _ = (d, t);
    };
    for t in &self.targets {
      remove::remove_path(t.as_path(), &mut done, total, self.track, self.count_total, &report)
        .map_err(to_err)?;
    }
    Ok(())
  }

  fn resolve(&mut self, _env: napi::Env, _output: Self::Output) -> Result<Self::JsValue> {
    Ok(())
  }
}

/// 同步删除一个或多个路径（文件、目录或符号链接）。
/// 路径不存在时视为成功（幂等）。
/// `progress` 为可选回调 (done: number, total: number)，每删除一个条目调用一次。
///   - total > 0 表示已预先统计出期望总数（详细进度条模式）。
///   - total == 0 表示未知总数（轻量 loading 模式，不预遍历，仅实时统计已删数量）。
/// `count_total`：是否预先遍历整树以估算 total。默认 false（不预遍历，避免干扰删除速度）。
#[napi]
pub fn remove_sync(
  targets: Vec<String>,
  progress: Option<Function<(f64, f64), ()>>,
  count_total: Option<bool>,
) -> Result<()> {
  let mut done: u64 = 0;
  // track=true 时统计并上报已删数量（只要有进度回调）。
  let track = progress.is_some();
  // 仅显式要求详细进度条时才预遍历统计总量；否则 total=0（不预遍历）。
  let count_total = count_total.unwrap_or(false);
  let total: u64 = if count_total {
    targets
      .iter()
      .map(|t| remove::count_entries(std::path::Path::new(t)))
      .sum()
  } else {
    0
  };
  let report = |d: u64, t: u64| {
    if let Some(f) = &progress {
      let _ = f.call((d as f64, t as f64));
    }
  };
  for t in targets {
    let path = PathBuf::from(&t);
    remove::remove_path(path.as_path(), &mut done, total, track, count_total, &report)
      .map_err(to_err)?;
  }
  Ok(())
}

/// 异步删除一个或多个路径（在 libuv 线程池中执行）。
/// 与同步接口对齐：`count_total` 控制是否预先统计总数（详细进度条需要）。
/// 注意：异步模式下 `progress` 回调暂不触发（compute 运行在 libuv 线程，
/// 无法安全回调 JS）；进度反馈仅在同步模式提供。错误会通过 Promise reject 传播。
#[napi]
pub fn remove_async(
  targets: Vec<String>,
  _progress: Option<Function<(f64, f64), ()>>,
  count_total: Option<bool>,
) -> Result<AsyncTask<RemoveTask>> {
  let paths: Vec<PathBuf> = targets.into_iter().map(PathBuf::from).collect();
  // async 在 libuv 线程执行，无法安全回调 JS，故 track 恒为 false（无进度上报）。
  let track = false;
  // 没有进度回调时预扫描总量没有意义（白遍历一遍），强制关闭，走最快路径。
  let count_total = if track { count_total.unwrap_or(false) } else { false };
  Ok(AsyncTask::new(RemoveTask {
    targets: paths,
    track,
    count_total,
  }))
}

/// 判断路径是否存在（不跟随符号链接）。
#[napi(js_name = "pathExists")]
pub fn exists_sync(target: String) -> bool {
  std::fs::symlink_metadata(target).is_ok()
}
