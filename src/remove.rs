//! 跨平台递归删除实现。
//! 设计目标与 rimraf 对齐：
//! - 支持删除文件、目录（含子目录与嵌套内容）
//! - 正确处理符号链接（不跟随链接删除目标，只删除链接本身）
//! - 处理只读文件：删除前尝试解除只读属性
//! - 处理 Windows 下 EACCES / EPERM（共享冲突、防病毒锁定）的重试逻辑
//! - 不存在的路径视为成功（幂等）

use std::io;
use std::path::Path;
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
    Err(e) => return Err(e),
  };

  if meta.is_dir() && !is_symlink(&meta) {
    remove_dir_all(target)
  } else {
    // 文件或符号链接：先尝试解除只读，再删除
    let _ = make_writable(target);
    with_retry(|| std::fs::remove_file(target))
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
  with_retry(|| std::fs::remove_dir(dir))
}

fn manual_remove_dir_all(dir: &Path) -> io::Result<()> {
  let mut stack = vec![dir.to_path_buf()];
  // 收集所有需要删除的目录，按后序处理
  let mut dirs: Vec<std::path::PathBuf> = Vec::new();

  while let Some(current) = stack.pop() {
    let _ = make_writable(&current);
    let entries = match std::fs::read_dir(&current) {
      Ok(e) => e,
      Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
      Err(e) => return Err(e),
    };
    let mut has_subdir = false;
    for entry in entries {
      let entry = entry?;
      let path = entry.path();
      let meta = match entry.metadata() {
        Ok(m) => m,
        Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
        Err(e) => return Err(e),
      };
      if meta.is_dir() && !meta.file_type().is_symlink() {
        has_subdir = true;
        stack.push(current.clone());
        stack.push(path);
        break;
      } else {
        let _ = make_writable(&path);
        with_retry(|| std::fs::remove_file(&path))?;
      }
    }
    if !has_subdir {
      dirs.push(current.clone());
    }
  }

  // 后序删除空目录
  for d in dirs {
    let _ = make_writable(&d);
    with_retry(|| std::fs::remove_dir(&d))?;
  }
  Ok(())
}

/// 对瞬时错误（Windows 下的 EACCES/EPERM 共享冲突、防病毒扫描等）进行有限重试。
fn with_retry<F>(mut op: F) -> io::Result<()>
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
        return Err(e);
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
