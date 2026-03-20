use serde::Serialize;
use std::process::Command;
use tauri::Emitter;

// ── Check Result ───────────────────────────────────

#[derive(Serialize, Clone)]
pub struct CheckResult {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
}

impl CheckResult {
    pub fn pass(id: &str, label: &str, detail: impl Into<String>) -> Self {
        Self { id: id.into(), label: label.into(), status: "pass".into(), detail: detail.into() }
    }
    pub fn fail(id: &str, label: &str, detail: impl Into<String>) -> Self {
        Self { id: id.into(), label: label.into(), status: "fail".into(), detail: detail.into() }
    }
    pub fn warn(id: &str, label: &str, detail: impl Into<String>) -> Self {
        Self { id: id.into(), label: label.into(), status: "warn".into(), detail: detail.into() }
    }
}

// ── Install Log Event ──────────────────────────────

#[derive(Serialize, Clone)]
pub struct InstallLog {
    pub line: String,
}

pub fn emit_log(app: &tauri::AppHandle, line: &str) {
    let _ = app.emit("install:log", InstallLog { line: line.into() });
}

pub fn emit_gateway_log(app: &tauri::AppHandle, line: &str) {
    let _ = app.emit("gateway:log", InstallLog { line: line.into() });
}

// ── Blocking Install Pattern ───────────────────────

pub fn spawn_blocking_install<F>(f: F) -> std::sync::mpsc::Receiver<Result<String, String>>
where F: FnOnce() -> Result<String, String> + Send + 'static {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || { let _ = tx.send(f()); });
    rx
}

pub async fn poll_result(rx: std::sync::mpsc::Receiver<Result<String, String>>) -> Result<String, String> {
    loop {
        match rx.try_recv() {
            Ok(result) => return result,
            Err(std::sync::mpsc::TryRecvError::Empty) => {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                return Err("安装线程异常退出".into());
            }
        }
    }
}

// ── Utilities ──────────────────────────────────────

pub fn run_cmd(program: &str, args: &[&str]) -> Result<String, String> {
    Command::new(program)
        .args(args)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .map_err(|e| e.to_string())
}

/// 构建包含所有已知 OpenClaw 安装目录的 PATH 前缀。
/// macOS GUI 应用不继承用户 shell 的 PATH，需要显式补全。
pub fn openclaw_path_prefix() -> String {
    "/opt/homebrew/bin:/opt/homebrew/sbin\
     :/usr/local/bin:/usr/local/sbin\
     :$HOME/.local/node/bin:$HOME/.local/bin\
     :$HOME/.npm-global/bin".to_string()
}

/// Windows: 从注册表刷新 PATH 后执行 openclaw 命令的 PowerShell 前缀。
/// GUI 应用启动后 install.ps1 可能已修改注册表 PATH，需要重新读取。
#[cfg(target_os = "windows")]
pub fn win_refresh_path_prefix() -> &'static str {
    "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'); "
}

pub fn extract_between_markers(text: &str, marker: &str) -> Option<String> {
    let parts: Vec<&str> = text.split(marker).collect();
    if parts.len() >= 3 {
        let content = parts[1].trim();
        if !content.is_empty() {
            return Some(content.to_string());
        }
    }
    None
}

fn parse_size_to_mb(s: &str) -> i64 {
    let s = s.trim();
    let (num_part, unit) = s
        .char_indices()
        .find(|(_, c)| c.is_alphabetic())
        .map(|(i, _)| (&s[..i], &s[i..]))
        .unwrap_or((s, ""));
    let num: f64 = num_part.parse().unwrap_or(0.0);
    match unit {
        u if u.starts_with('T') => (num * 1024.0 * 1024.0) as i64,
        u if u.starts_with('G') => (num * 1024.0) as i64,
        u if u.starts_with('M') => num as i64,
        u if u.starts_with('K') || u.starts_with('k') => (num / 1024.0) as i64,
        _ => num as i64,
    }
}

pub fn parse_disk_free_mb(df_output: &str) -> i64 {
    let last_line = df_output.lines().last().unwrap_or("");
    let parts: Vec<&str> = last_line.split_whitespace().collect();
    if parts.len() >= 4 { parse_size_to_mb(parts[3]) } else { 0 }
}

/// 解析远程 compound 命令输出中的分段内容
pub fn parse_section(output: &str, tag: &str) -> String {
    let start = format!("---{}---", tag);
    let parts: Vec<&str> = output.split(&start).collect();
    if parts.len() < 2 {
        return String::new();
    }
    let after = parts[1];
    match after.find("---") {
        Some(pos) => after[..pos].trim().to_string(),
        None => after.trim().to_string(),
    }
}

/// 去除 ANSI 转义码
pub fn strip_ansi(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // 跳过 ESC[...m 序列
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&nc) = chars.peek() {
                    chars.next();
                    if nc.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else if c != '\r' {
            result.push(c);
        }
    }
    result
}

/// Remote SSH PATH prefix (used in multiple remote commands)
pub const REMOTE_PATH_SETUP: &str = "source ~/.bash_profile 2>/dev/null; source ~/.bashrc 2>/dev/null; source ~/.zshrc 2>/dev/null; source ~/.profile 2>/dev/null; export PATH=\"$HOME/.local/node/bin:$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:$PATH\"";
