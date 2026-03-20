use std::process::{Command, Stdio};

use crate::helpers::{
    extract_between_markers, openclaw_path_prefix, strip_ansi,
    REMOTE_PATH_SETUP,
};
#[cfg(target_os = "windows")]
use crate::helpers::{run_cmd, win_refresh_path_prefix};
use crate::ssh::{create_ssh_session, ssh_exec};
use ssh2::Session;

// ── Local / Remote OpenClaw CLI Wrappers ──────────

/// 检测本地 OpenClaw 安装版本（空字符串 = 未安装）
pub fn detect_openclaw_version() -> String {
    local_openclaw_cmd("--version").unwrap_or_default()
}

/// 在本地执行 openclaw 子命令，返回 stdout
#[cfg(unix)]
pub fn local_openclaw_cmd(args: &str) -> Result<String, String> {
    let marker = "~~OC~~";
    let path_prefix = openclaw_path_prefix();
    let cmd = format!(
        r#"export PATH="{path_prefix}:$PATH"; export NPM_CONFIG_REGISTRY=https://registry.npmmirror.com; __r=$(openclaw {args} 2>&1) && echo "{m}${{__r}}{m}" || echo "{m}${{__r}}{m}""#,
        path_prefix = path_prefix, args = args, m = marker,
    );
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let output = Command::new(&shell)
        .args(["-lc", &cmd])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("执行 shell 失败: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    extract_between_markers(&stdout, marker)
        .ok_or_else(|| "无法解析 openclaw 输出".into())
}

/// 在本地执行 openclaw 子命令，返回 stdout (Windows)
#[cfg(target_os = "windows")]
pub fn local_openclaw_cmd(args: &str) -> Result<String, String> {
    let ps_cmd = format!(
        "{}$env:NPM_CONFIG_REGISTRY='https://registry.npmmirror.com'; openclaw {} 2>&1",
        win_refresh_path_prefix(), args
    );
    run_cmd("powershell", &["-NoProfile", "-Command", &ps_cmd])
}

/// 在远程主机执行 openclaw 子命令
fn remote_openclaw_cmd(
    host: &str, port: u16, username: &str, password: &str, args: &str,
) -> Result<String, String> {
    let sess = create_ssh_session(host, port, username, password)?;
    let cmd = format!(
        "{}; openclaw {} 2>&1",
        REMOTE_PATH_SETUP, args
    );
    ssh_exec(&sess, &cmd)
}

// ── Unified Dispatch ──────────────────────────────

/// 统一分发：根据 target 在本地或远程执行 openclaw 子命令
pub fn run_openclaw(
    target: &str,
    host: &Option<String>, port: Option<u16>,
    username: &Option<String>, password: &Option<String>,
    args: &str,
) -> Result<String, String> {
    if target == "remote" {
        remote_openclaw_cmd(
            host.as_deref().unwrap_or_default(), port.unwrap_or(22),
            username.as_deref().unwrap_or_default(), password.as_deref().unwrap_or_default(),
            args,
        )
    } else {
        local_openclaw_cmd(args)
    }
}

// ── Tauri Commands ─────────────────────────────────

#[tauri::command]
pub async fn get_openclaw_version(
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<String, String> {
    run_openclaw(&target, &host, port, &username, &password, "--version")
}

#[tauri::command]
pub async fn check_openclaw_update(
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<String, String> {
    run_openclaw(&target, &host, port, &username, &password, "update status")
}

#[tauri::command]
pub async fn preview_openclaw_update(
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<String, String> {
    run_openclaw(&target, &host, port, &username, &password, "update --dry-run")
}

#[tauri::command]
pub async fn run_openclaw_update(
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<String, String> {
    run_openclaw(&target, &host, port, &username, &password, "update")
}

// ── Daemon Info ─────────────────────────────────

/// 从 openclaw daemon status 输出中解析信息
fn parse_daemon_status(raw: &str) -> serde_json::Value {
    // 去除 ANSI 转义码和 \r
    let clean = strip_ansi(raw);

    let mut runtime = "unknown".to_string();
    let mut config_path = String::new();
    let mut dashboard = String::new();
    let mut service = String::new();
    let mut gateway = String::new();
    let mut listening = String::new();
    let mut log_file = String::new();

    for line in clean.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Runtime:") {
            let val = trimmed.trim_start_matches("Runtime:").trim();
            // 先检查 stopped/inactive/dead（"inactive" 包含 "active" 子串，必须优先判断）
            if val.contains("stopped") || val.contains("inactive") || val.contains("dead") {
                runtime = "stopped".into();
            } else if val.contains("running") || val.contains("active") {
                runtime = "running".into();
            } else {
                runtime = val.split_whitespace().next().unwrap_or("unknown").to_string();
            }
        } else if trimmed.starts_with("Config (cli):") {
            config_path = trimmed
                .split(':')
                .skip(1)
                .collect::<Vec<_>>()
                .join(":")
                .trim()
                .to_string();
        } else if trimmed.starts_with("Dashboard:") {
            dashboard = trimmed
                .split(':')
                .skip(1)
                .collect::<Vec<_>>()
                .join(":")
                .trim()
                .to_string();
        } else if trimmed.starts_with("Service:") {
            service = trimmed.trim_start_matches("Service:").trim().to_string();
        } else if trimmed.starts_with("Gateway:") {
            gateway = trimmed.trim_start_matches("Gateway:").trim().to_string();
        } else if trimmed.starts_with("Listening:") {
            listening = trimmed.trim_start_matches("Listening:").trim().to_string();
        } else if trimmed.starts_with("File logs:") {
            log_file = trimmed.trim_start_matches("File logs:").trim().to_string();
        }
    }

    // Listening 有值说明端口在用、网关进程实际在运行（即使 systemd 显示 stopped）
    if !listening.is_empty() && runtime != "running" {
        runtime = "running".into();
    }

    serde_json::json!({
        "runtime": runtime,
        "configPath": config_path,
        "dashboard": dashboard,
        "service": service,
        "gateway": gateway,
        "listening": listening,
        "logFile": log_file,
    })
}

/// 使用已有 SSH 会话执行远程 openclaw 命令
fn remote_openclaw_on_sess(sess: &Session, args: &str) -> Result<String, String> {
    let cmd = format!("{}; openclaw {} 2>&1", REMOTE_PATH_SETUP, args);
    ssh_exec(sess, &cmd)
}

/// get_daemon_info 核心逻辑，接受一个执行器闭包
fn collect_daemon_info(run: &dyn Fn(&str) -> Result<String, String>) -> Result<String, String> {
    // 1) gateway status --json → 可靠的 running/installed 判断
    let mut json_running = false;
    let mut json_installed = false;
    if let Ok(json_raw) = run("gateway status --json") {
        if let Ok(j) = serde_json::from_str::<serde_json::Value>(&strip_ansi(&json_raw)) {
            json_running = j["running"].as_bool().unwrap_or(false)
                || j["status"].as_str().unwrap_or("") == "running"
                || j["state"].as_str().unwrap_or("") == "running";
            json_installed = j["installed"].as_bool().unwrap_or(false)
                || j["daemon_installed"].as_bool().unwrap_or(false)
                || j["service"].as_str().unwrap_or("") == "installed";
        }
    }

    // 2) gateway status（文本）→ 获取 dashboard / config / service 等展示信息
    let mut info = if let Ok(text_raw) = run("gateway status") {
        parse_daemon_status(&text_raw)
    } else if let Ok(text_raw) = run("daemon status") {
        parse_daemon_status(&text_raw)
    } else {
        serde_json::json!({
            "runtime": "unknown",
            "configPath": "",
            "dashboard": "",
            "service": "",
            "gateway": "",
            "listening": "",
            "logFile": "",
        })
    };

    // 3) 用 JSON 结果修正 runtime（JSON 比文本解析更可靠）
    if let Some(obj) = info.as_object_mut() {
        if json_running {
            obj.insert("runtime".into(), serde_json::json!("running"));
        }
        obj.insert("installed".into(), serde_json::json!(json_installed));
    }

    Ok(info.to_string())
}

#[tauri::command]
pub async fn get_daemon_info(
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<String, String> {
    if target == "remote" {
        // 远程：复用单个 SSH 会话执行所有命令
        let sess = create_ssh_session(
            host.as_deref().unwrap_or_default(), port.unwrap_or(22),
            username.as_deref().unwrap_or_default(), password.as_deref().unwrap_or_default(),
        )?;
        collect_daemon_info(&|args| remote_openclaw_on_sess(&sess, args))
    } else {
        collect_daemon_info(&|args| local_openclaw_cmd(args))
    }
}
