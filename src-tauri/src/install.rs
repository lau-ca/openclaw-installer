use std::process::{Command, Stdio};

use base64::{engine::general_purpose::STANDARD as B64, Engine};

use crate::helpers::{
    emit_log, poll_result, spawn_blocking_install,
    REMOTE_PATH_SETUP,
};
#[cfg(unix)]
use crate::helpers::openclaw_path_prefix;
use crate::ssh::{create_ssh_session, ssh_exec, ssh_stream_lines};

/// Embedded install scripts (compiled into the binary)
#[cfg(unix)]
const INSTALL_SH: &str = include_str!("../../scripts/remote/install.sh");
#[cfg(target_os = "windows")]
const INSTALL_PS1: &str = include_str!("../../scripts/remote/install.ps1");
const SETUP_HTTPS_SH: &str = include_str!("../../scripts/remote/setup-https.sh");

// ── Install: Local (macOS / Linux / Windows) ──────

#[tauri::command]
pub async fn install_local(app: tauri::AppHandle) -> Result<String, String> {
    let app_handle = app.clone();
    let rx = spawn_blocking_install(move || install_local_blocking(&app_handle));
    poll_result(rx).await
}

/// 准备本地安装脚本命令 (Unix)
#[cfg(unix)]
fn prepare_local_install() -> Result<(String, Vec<String>), String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let tmp_dir = std::env::temp_dir();
    let script_path = tmp_dir.join("openclaw-install.sh");
    std::fs::write(&script_path, INSTALL_SH)
        .map_err(|e| format!("写入安装脚本失败: {}", e))?;
    let path_prefix = openclaw_path_prefix();
    let cmd = format!(
        "export PATH=\"{path_prefix}:$PATH\"; bash {} --no-onboard 2>&1",
        script_path.display(), path_prefix = path_prefix,
    );
    Ok((shell, vec!["-lc".into(), cmd]))
}

/// 准备本地安装脚本命令 (Windows)
#[cfg(target_os = "windows")]
fn prepare_local_install() -> Result<(String, Vec<String>), String> {
    let tmp_dir = std::env::temp_dir();
    let script_path = tmp_dir.join("openclaw-install.ps1");
    std::fs::write(&script_path, INSTALL_PS1)
        .map_err(|e| format!("写入安装脚本失败: {}", e))?;
    let ps_cmd = format!(
        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; \
$env:npm_config_registry = 'https://registry.npmmirror.com'; \
& '{}' -NoOnboard 2>&1",
        script_path.display()
    );
    Ok(("powershell".into(), vec![
        "-NoProfile".into(), "-ExecutionPolicy".into(), "Bypass".into(), "-Command".into(),
        ps_cmd,
    ]))
}

fn install_local_blocking(app: &tauri::AppHandle) -> Result<String, String> {
    let (program, args) = prepare_local_install()?;
    emit_log(app, &format!("[{}] 开始执行安装脚本...", std::env::consts::OS));

    let mut cmd_builder = Command::new(&program);
    cmd_builder.args(&args);

    // ── Environment ─────────────────────────────────────────
    cmd_builder.env("npm_config_registry", "https://registry.npmmirror.com");
    cmd_builder.env("HOMEBREW_NO_AUTO_UPDATE", "1");
    cmd_builder.env("NONINTERACTIVE", "1");

    let mut child = cmd_builder
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动安装脚本失败: {}", e))?;

    // Read both stdout and stderr so no diagnostic output is lost
    let stderr = child.stderr.take();
    if let Some(stderr) = stderr {
        let app_clone = app.clone();
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stderr);
            use std::io::BufRead;
            for line in reader.lines().flatten() {
                emit_log(&app_clone, &line);
            }
        });
    }

    if let Some(stdout) = child.stdout.take() {
        let reader = std::io::BufReader::new(stdout);
        use std::io::BufRead;
        for line in reader.lines() {
            if let Ok(line) = line {
                emit_log(app, &line);
            }
        }
    }

    let status = child.wait().map_err(|e| format!("等待安装进程失败: {}", e))?;
    if status.success() {
        emit_log(app, "安装完成");
        Ok("安装完成".into())
    } else {
        let msg = format!("安装脚本退出码: {:?}", status.code());
        emit_log(app, &msg);
        Err(msg)
    }
}

// ── Install: Remote Linux (via SSH) ───────────────

#[tauri::command]
pub async fn install_remote(
    app: tauri::AppHandle,
    host: String, port: u16, username: String, password: String,
) -> Result<String, String> {
    let app_handle = app.clone();
    let rx = spawn_blocking_install(move || {
        install_remote_blocking(&app_handle, &host, port, &username, &password)
    });
    poll_result(rx).await
}

fn install_remote_blocking(
    app: &tauri::AppHandle,
    host: &str, port: u16, username: &str, password: &str,
) -> Result<String, String> {
    emit_log(app, &format!("正在连接 {}:{}...", host, port));
    let sess = create_ssh_session(host, port, username, password)?;
    sess.set_timeout(600_000); // 10 分钟超时
    emit_log(app, "SSH 连接成功");

    let cmd = format!(
        "set -o pipefail; \
         export npm_config_registry=https://registry.npmmirror.com; \
         export HOMEBREW_NO_AUTO_UPDATE=1; \
         export NONINTERACTIVE=1; \
         {}; \
         curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install.sh | bash -s -- --no-onboard 2>&1",
        REMOTE_PATH_SETUP,
    );

    let app_clone = app.clone();
    let exit_code = ssh_stream_lines(&sess, &cmd, |line| {
        emit_log(&app_clone, line);
        true
    })?;

    if exit_code == 0 {
        emit_log(app, "安装完成");
        Ok("安装完成".into())
    } else {
        let msg = format!("安装脚本退出码: {}", exit_code);
        emit_log(app, &msg);
        Err(msg)
    }
}

// ── Setup Remote HTTPS (Caddy) ────────────────────

#[tauri::command]
pub async fn setup_remote_https(
    app: tauri::AppHandle,
    host: String, port: u16, username: String, password: String,
    https_port: String,
) -> Result<String, String> {
    let app_handle = app.clone();
    let rx = spawn_blocking_install(move || {
        setup_remote_https_blocking(&app_handle, &host, port, &username, &password, &https_port)
    });
    poll_result(rx).await
}

fn setup_remote_https_blocking(
    app: &tauri::AppHandle,
    host: &str, _port: u16, username: &str, password: &str,
    https_port: &str,
) -> Result<String, String> {
    // 校验 https_port 为纯数字且在有效范围内 (1-65535)
    let port: u16 = https_port.parse()
        .map_err(|_| format!("无效的 HTTPS 端口: {}", https_port))?;
    if port == 0 {
        return Err("端口号不能为 0".into());
    }
    emit_log(app, "正在配置 HTTPS 代理 (Caddy)...");
    let sess = create_ssh_session(host, port, username, password)?;
    sess.set_timeout(300_000); // 5 分钟超时

    // 1) 通过 base64 上传脚本（避免 heredoc 转义问题）
    let b64_script = B64.encode(SETUP_HTTPS_SH.as_bytes());
    let upload_cmd = format!(
        "echo '{}' | base64 -d > /tmp/openclaw-setup-https.sh && chmod +x /tmp/openclaw-setup-https.sh",
        b64_script
    );
    ssh_exec(&sess, &upload_cmd)
        .map_err(|e| format!("上传 HTTPS 配置脚本失败: {}", e))?;
    emit_log(app, "脚本已上传");

    // 2) 执行脚本：使用 sudo -S 从 stdin 读取密码（避免环境变量泄露）
    // 将密码写入临时文件并通过 stdin 传递
    let pw_file = "/tmp/openclaw-sudo-pass";
    let b64_pw = B64.encode(password.as_bytes());
    ssh_exec(&sess, &format!("echo '{}' | base64 -d > {} && chmod 600 {}", b64_pw, pw_file, pw_file))
        .map_err(|e| format!("上传 sudo 密码失败: {}", e))?;

    let exec_cmd = format!(
        "cat {} | sudo -S {}; __exit=$?; rm -f {}; exit $__exit",
        pw_file, REMOTE_PATH_SETUP, pw_file,
    );

    let app_clone = app.clone();
    let exit_code = ssh_stream_lines(&sess, &exec_cmd, |line| {
        emit_log(&app_clone, line);
        true
    })?;

    if exit_code == 0 {
        emit_log(app, "HTTPS 代理配置完成");
        Ok("HTTPS 代理配置完成".into())
    } else {
        let msg = format!("HTTPS 配置脚本失败 (exit {})", exit_code);
        emit_log(app, &msg);
        Err(msg)
    }
}
