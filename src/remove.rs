//! 跨平台递归删除实现。
//! 设计目标与 rimraf 对齐：
//! - 支持删除文件、目录（含子目录与嵌套内容）
//! - 正确处理符号链接（不跟随链接删除目标，只删除链接本身）
//! - 处理只读文件：删除前尝试解除只读属性
//! - 处理 Windows 下 EACCES / EPERM（共享冲突、防病毒锁定）的重试逻辑
//! - 不存在的路径视为成功（幂等）

use rayon::prelude::*;
use std::io;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MAX_RETRIES: u32 = 5;
const RETRY_DELAY: Duration = Duration::from_millis(100);

/// 删除给定路径（文件、目录或符号链接）。
/// 路径不存在时直接返回 Ok（幂等行为）。
pub fn remove_path(target: &Path) -> io::Result<()> {
  let meta = match std::fs::symlink_metadata(target) {
    Ok(m) => m,
    // 不存在 -> 幂等成功
    Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
    Err(e) => {
      return Err(io::Error::new(
        e.kind(),
        format!("{}: {}", target.display(), e),
      ))
    }
  };

  if meta.is_dir() && !is_symlink(&meta) {
    remove_dir_all(target)
  } else {
    // 文件或符号链接：先尝试解除只读，再删除
    let _ = make_writable(target);
    with_retry(target, || std::fs::remove_file(target))
  }
}

fn is_symlink(meta: &std::fs::Metadata) -> bool {
  meta.file_type().is_symlink()
}

#[cfg(windows)]
fn make_writable(path: &Path) -> io::Result<()> {
  use std::os::windows::fs::MetadataExt;
  use std::os::windows::fs::OpenOptionsExt;
  use std::os::windows::io::AsRawHandle;
  const FILE_ATTRIBUTE_READONLY: u32 = 0x1;

  let attrs = path.metadata()?.file_attributes();
  if attrs & FILE_ATTRIBUTE_READONLY != 0 {
    let new_attrs = attrs & !FILE_ATTRIBUTE_READONLY;
    // 通过 SetFileAttributes 移除只读位
    #[link(name = "kernel32")]
    extern "system" {
      fn SetFileAttributesW(lpFileName: *const u16, dwFileAttributes: u32) -> i32;
    }
    let wide: Vec<u16> = path
      .as_os_str()
      .encode_wide()
      .chain(std::iter::once(0))
      .collect();
    unsafe {
      if SetFileAttributesW(wide.as_ptr(), new_attrs) == 0 {
        return Err(io::Error::last_os_error());
      }
    }
  }
  let _ = OpenOptionsExt::default(); // keep import used on some toolchains
  Ok(())
}

#[cfg(unix)]
fn make_writable(path: &Path) -> io::Result<()> {
  use std::os::unix::fs::PermissionsExt;
  let meta = std::fs::symlink_metadata(path)?;
  let mut perms = meta.permissions();
  let mode = perms.mode();
  // 确保 owner 有写权限
  if mode & 0o200 == 0 {
    perms.set_mode(mode | 0o200);
    std::fs::set_permissions(path, perms)?;
  }
  Ok(())
}

/// 递归删除目录，采用自底向上的方式（先删子项再删自身），
/// 对每一层都尝试解除只读属性并对临时性错误重试。
fn remove_dir_all(dir: &Path) -> io::Result<()> {
  // 先尝试标准的 remove_dir_all（大多数情况足够快）
  match std::fs::remove_dir_all(dir) {
    Ok(()) => return Ok(()),
    Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
    // 否则回退到手动递归（处理只读/权限问题）
    _ => {}
  }

  manual_remove_dir_all(dir)?;
  with_retry(dir, || std::fs::remove_dir(dir))
}

fn manual_remove_dir_all(dir: &Path) -> io::Result<()> {
  // 显式栈实现后序遍历：每个栈元素携带 phase。
  //   phase = false：首次访问，需展开子项（并行删本层文件/链接，子目录入栈）。
  //   phase = true ：子项已处理完，当前目录已为空，可删除。
  // 用 Vec<(PathBuf, bool)> 既避免重复 read_dir，又能严格保证后序。
  let mut stack: Vec<(std::path::PathBuf, bool)> = vec![(dir.to_path_buf(), false)];
  let mut dirs: Vec<std::path::PathBuf> = Vec::new();
  let first_err: Mutex<Option<io::Error>> = Mutex::new(None);

  while let Some((current, visited)) = stack.pop() {
    let _ = make_writable(&current);

    if visited {
      // 子项已全部清空，删除空目录（目录删除必须顺序、严格后序）。
      dirs.push(current);
      continue;
    }

    let entries = match std::fs::read_dir(&current) {
      Ok(e) => e,
      Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
      Err(e) => {
        return Err(io::Error::new(
          e.kind(),
          format!("{}: {}", current.display(), e),
        ))
      }
    };

    // 拆分本层条目：子目录稍后递归，文件/符号链接并行删除。
    let mut subdirs: Vec<std::path::PathBuf> = Vec::new();
    let mut leaves: Vec<std::path::PathBuf> = Vec::new();
    for entry in entries {
      let entry = entry.map_err(|e| {
        io::Error::new(e.kind(), format!("{}: {}", current.display(), e))
      })?;
      let path = entry.path();
      // 用 entry.file_type()（不跟随符号链接）判断，避免把"指向目录的
      // 符号链接"误判为真实子目录而递归进其目标去删除。
      let file_type = match entry.file_type() {
        Ok(ft) => ft,
        Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
        Err(e) => {
          return Err(io::Error::new(
            e.kind(),
            format!("{}: {}", path.display(), e),
          ))
        }
      };
      if file_type.is_symlink() {
        // 符号链接：只删除链接本身，绝不跟随进目标删除
        leaves.push(path);
      } else if file_type.is_dir() {
        subdirs.push(path);
      } else {
        leaves.push(path);
      }
    }

    // 并行删除本层所有文件与符号链接（彼此无依赖，可并发）。
    if !leaves.is_empty() {
      leaves.par_iter().for_each(|path| {
        let _ = make_writable(path);
        if let Err(e) = with_retry(path, || std::fs::remove_file(path)) {
          let mut guard = first_err.lock().unwrap();
          if guard.is_none() {
            *guard = Some(e);
          }
        }
      });
      if let Some(e) = first_err.lock().unwrap().take() {
        return Err(e);
      }
    }

    // 标记当前目录稍后需删除，并压入未处理的子目录（后序）。
    stack.push((current.clone(), true));
    for s in subdirs {
      stack.push((s, false));
    }
  }

  // 顺序删除空目录（已为后序顺序）。
  for d in dirs {
    let _ = make_writable(&d);
    with_retry(&d, || std::fs::remove_dir(&d))?;
  }
  Ok(())
}

/// 对瞬时错误（Windows 下的 EACCES/EPERM 共享冲突、防病毒扫描等）进行有限重试。
/// 重试耗尽返回的错误会附带出错路径，便于调用方定位失败文件。
fn with_retry<F>(path: &Path, mut op: F) -> io::Result<()>
where
  F: FnMut() -> io::Result<()>,
{
  let start = Instant::now();
  let mut attempt: u32 = 0;
  loop {
    match op() {
      Ok(()) => return Ok(()),
      Err(e) => {
        let retryable = is_retryable(&e);
        if retryable && attempt < MAX_RETRIES && start.elapsed() < Duration::from_secs(10) {
          attempt += 1;
          std::thread::sleep(RETRY_DELAY);
          continue;
        }
        // 已不存在也视为成功
        if e.kind() == io::ErrorKind::NotFound {
          return Ok(());
        }
        // 附带出错路径，便于定位失败文件
        return Err(io::Error::new(
          e.kind(),
          format!("{}: {}", path.display(), e),
        ));
      }
    }
  }
}

#[cfg(windows)]
fn is_retryable(e: &io::Error) -> bool {
  matches!(e.kind(), io::ErrorKind::PermissionDenied | io::ErrorKind::Other)
}

#[cfg(not(windows))]
fn is_retryable(e: &io::Error) -> bool {
  // Unix 下通常不需要重试；少数情况（挂载点占用）下出现 PermissionDenied
  matches!(e.kind(), io::ErrorKind::PermissionDenied)
}
