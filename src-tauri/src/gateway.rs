use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use zeroize::Zeroizing;

use crate::cli::run_openclaw;
use crate::config::{sanitize_local_config, sanitize_remote_config};
use crate::helpers::{
    emit_gateway_log, openclaw_path_prefix, REMOTE_PATH_SETUP,
};
#[cfg(target_os = "windows")]
use crate::helpers::win_refresh_path_prefix;
use crate::ssh::{create_ssh_session, ssh_exec, ssh_stream_lines};

// ── State ──────────────────────────────────────────

pub struct GatewayProcesses {
    log_child: StdMutex<Option<std::process::Child>>,
    fg_child: StdMutex<Option<std::process::Child>>,
    /// 远程日志流取消标志
    log_cancel: StdMutex<Option<Arc<AtomicBool>>>,
    /// 远程前台网关取消标志
    fg_cancel: StdMutex<Option<Arc<AtomicBool>>>,
}

impl Default for GatewayProcesses {
    fn default() -> Self {
        Self {
            log_child: StdMutex::new(None),
            fg_child: StdMutex::new(None),
            log_cancel: StdMutex::new(None),
            fg_cancel: StdMutex::new(None),
        }
    }
}

/// 终止并回收一个 Mutex 保护的子进程
fn kill_child(guard: &StdMutex<Option<std::process::Child>>) {
    if let Ok(mut g) = guard.lock() {
        if let Some(mut child) = g.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// 设置远程取消标志，使 SSH 流式读取线程退出
fn cancel_remote(guard: &StdMutex<Option<Arc<AtomicBool>>>) {
    if let Ok(mut g) = guard.lock() {
        if let Some(flag) = g.take() {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

// ── Gateway Status ─────────────────────────────────

#[tauri::command]
pub async fn gateway_status(
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<String, String> {
    run_openclaw(&target, &host, port, &username, &password, "gateway status --json")
}

// ── Gateway Control ────────────────────────────────

/// 网关控制操作 (start / stop / restart / install)
#[tauri::command]
pub async fn gateway_control(
    action: String,
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<String, String> {
    // 白名单校验，防止 shell 注入
    const ALLOWED: &[&str] = &["start", "stop", "restart", "install"];
    if !ALLOWED.contains(&action.as_str()) {
        return Err(format!("不支持的操作: {}", action));
    }

    if target == "remote" {
        // 远程: 复用单个 SSH 会话（sanitize + 执行命令）
        let sess = create_ssh_session(
            host.as_deref().unwrap_or_default(), port.unwrap_or(22),
            username.as_deref().unwrap_or_default(), password.as_deref().unwrap_or_default(),
        )?;
        if action == "start" || action == "restart" {
            sanitize_remote_config(&sess);
        }
        let cmd = format!("{}; openclaw gateway {} 2>&1", REMOTE_PATH_SETUP, action);
        ssh_exec(&sess, &cmd)
    } else {
        if action == "start" || action == "restart" {
            sanitize_local_config();
        }
        run_openclaw(&target, &host, port, &username, &password, &format!("gateway {}", action))
    }
}

// ── Log Stream ─────────────────────────────────────

/// 启动实时日志流（本地 Unix）
#[cfg(unix)]
fn start_local_log_stream() -> Result<std::process::Child, String> {
    let marker = "~~OC~~";
    let path_prefix = openclaw_path_prefix();
    let cmd = format!(
        r#"export PATH="{path_prefix}:$PATH"; __p=$(command -v openclaw) && echo "{m}FOUND{m}" && "$__p" logs --follow 2>&1 || echo "{m}ERR{m}""#,
        path_prefix = path_prefix, m = marker,
    );
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    Command::new(&shell)
        .args(["-lc", &cmd])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动日志流失败: {}", e))
}

/// 启动实时日志流（本地 Windows）
#[cfg(target_os = "windows")]
fn start_local_log_stream() -> Result<std::process::Child, String> {
    let ps_cmd = format!("{}openclaw logs --follow 2>&1", win_refresh_path_prefix());
    Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_cmd])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动日志流失败: {}", e))
}

#[tauri::command]
pub async fn start_log_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcesses>,
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<(), String> {
    kill_child(&state.log_child);
    cancel_remote(&state.log_cancel);

    if target == "remote" {
        // 远程: SSH 流式读取（支持取消）
        let cancel = Arc::new(AtomicBool::new(false));
        if let Ok(mut g) = state.log_cancel.lock() {
            *g = Some(cancel.clone());
        }
        let app_clone = app.clone();
        let h = host.unwrap_or_default();
        let p = port.unwrap_or(22);
        let u = username.unwrap_or_default();
        let pw = Zeroizing::new(password.unwrap_or_default());
        std::thread::spawn(move || {
            match create_ssh_session(&h, p, &u, &pw) {
                Ok(sess) => {
                    let cmd = format!("{}; openclaw logs --follow 2>&1", REMOTE_PATH_SETUP);
                    let _ = ssh_stream_lines(&sess, &cmd, |line| {
                        if cancel.load(Ordering::Relaxed) { return false; }
                        emit_gateway_log(&app_clone, line);
                        true
                    });
                }
                Err(e) => emit_gateway_log(&app_clone, &format!("SSH 连接失败: {}", e)),
            }
        });
    } else {
        // 本地: 子进程流式读取
        let mut child = start_local_log_stream()?;
        let stdout = child.stdout.take()
            .ok_or("无法获取日志流输出")?;

        // 存储 child 以便后续 stop
        if let Ok(mut guard) = state.log_child.lock() {
            *guard = Some(child);
        }

        let app_clone = app.clone();
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stdout);
            use std::io::BufRead;
            for line in reader.lines() {
                if let Ok(line) = line {
                    // 过滤掉 marker 行
                    if !line.contains("~~OC~~") {
                        emit_gateway_log(&app_clone, &line);
                    }
                }
            }
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_log_stream(
    state: tauri::State<'_, GatewayProcesses>,
) -> Result<(), String> {
    kill_child(&state.log_child);
    cancel_remote(&state.log_cancel);
    Ok(())
}

// ── Foreground Gateway Run ─────────────────────────

/// 本地前台启动网关子进程 (Unix)
#[cfg(unix)]
fn spawn_local_gateway_run() -> Result<std::process::Child, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let path_prefix = openclaw_path_prefix();
    let run_cmd = format!("export PATH=\"{path_prefix}:$PATH\"; openclaw gateway run 2>&1", path_prefix = path_prefix);
    Command::new(&shell)
        .args(["-lc", &run_cmd])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动网关失败: {}", e))
}

/// 本地前台启动网关子进程 (Windows)
#[cfg(target_os = "windows")]
fn spawn_local_gateway_run() -> Result<std::process::Child, String> {
    let ps_cmd = format!("{}openclaw gateway run 2>&1", win_refresh_path_prefix());
    Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_cmd])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动网关失败: {}", e))
}

/// 前台启动网关 (仅本地, daemon 未安装时使用)
#[tauri::command]
pub async fn start_gateway_run(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcesses>,
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<(), String> {
    kill_child(&state.fg_child);
    cancel_remote(&state.fg_cancel);

    if target == "remote" {
        // 远程前台启动（支持取消）
        let cancel = Arc::new(AtomicBool::new(false));
        if let Ok(mut g) = state.fg_cancel.lock() {
            *g = Some(cancel.clone());
        }
        let app_clone = app.clone();
        let h = host.unwrap_or_default();
        let p = port.unwrap_or(22);
        let u = username.unwrap_or_default();
        let pw = Zeroizing::new(password.unwrap_or_default());
        std::thread::spawn(move || {
            match create_ssh_session(&h, p, &u, &pw) {
                Ok(sess) => {
                    sess.set_timeout(0); // 不超时
                    let cmd = format!("{}; openclaw gateway run 2>&1", REMOTE_PATH_SETUP);
                    let _ = ssh_stream_lines(&sess, &cmd, |line| {
                        if cancel.load(Ordering::Relaxed) { return false; }
                        emit_gateway_log(&app_clone, line);
                        true
                    });
                }
                Err(e) => emit_gateway_log(&app_clone, &format!("SSH 连接失败: {}", e)),
            }
        });
        return Ok(());
    }

    // 本地前台启动
    let mut child = spawn_local_gateway_run()?;
    let stdout = child.stdout.take()
        .ok_or("无法获取网关输出")?;

    if let Ok(mut guard) = state.fg_child.lock() {
        *guard = Some(child);
    }

    let app_clone = app.clone();
    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(stdout);
        use std::io::BufRead;
        for line in reader.lines() {
            if let Ok(line) = line {
                emit_gateway_log(&app_clone, &line);
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_gateway_run(
    state: tauri::State<'_, GatewayProcesses>,
) -> Result<(), String> {
    kill_child(&state.fg_child);
    cancel_remote(&state.fg_cancel);
    Ok(())
}
