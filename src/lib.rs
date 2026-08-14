#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

mod remove;

use napi::bindgen_prelude::{AsyncTask, Error, Result, Status};
use napi::Task;
use std::path::PathBuf;

fn to_err(e: std::io::Error) -> Error {
  Error::new(Status::GenericFailure, format!("remove failed: {e}"))
}

pub struct RemoveTask {
  targets: Vec<PathBuf>,
}

impl Task for RemoveTask {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> Result<Self::Output> {
    for t in &self.targets {
      remove::remove_path(t.as_path()).map_err(to_err)?;
    }
    Ok(())
  }

  fn resolve(&mut self, _env: napi::Env, _output: Self::Output) -> Result<Self::JsValue> {
    Ok(())
  }
}

/// 同步删除一个或多个路径（文件、目录或符号链接）。
/// 路径不存在时视为成功（幂等）。
#[napi]
pub fn remove_sync(targets: Vec<String>) -> Result<()> {
  for t in targets {
    let path = PathBuf::from(&t);
    remove::remove_path(path.as_path()).map_err(to_err)?;
  }
  Ok(())
}

/// 异步删除一个或多个路径（在 libuv 线程池中执行）。
#[napi]
pub fn remove_async(targets: Vec<String>) -> AsyncTask<RemoveTask> {
  let paths: Vec<PathBuf> = targets.into_iter().map(PathBuf::from).collect();
  AsyncTask::new(RemoveTask { targets: paths })
}

/// 判断路径是否存在（不跟随符号链接）。
#[napi(js_name = "pathExists")]
pub fn exists_sync(target: String) -> bool {
  std::fs::symlink_metadata(target).is_ok()
}
