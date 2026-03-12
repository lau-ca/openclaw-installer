use serde::Serialize;
use ssh2::Session;
use std::io::Read;
use std::net::TcpStream;
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use sha2::Sha256;

// ── Platform ───────────────────────────────────────

#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

/// 获取本机局域网 IP 地址（首个非 loopback 的 IPv4 地址）
#[tauri::command]
fn get_local_lan_ip() -> Result<String, String> {
    // 通过连接一个外部地址来确定本机出口 IP（不会实际发送数据）
    let socket = std::net::UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("绑定 UDP 失败: {}", e))?;
    socket.connect("8.8.8.8:80")
        .map_err(|e| format!("无法确定出口 IP: {}", e))?;
    let local_addr = socket.local_addr()
        .map_err(|e| format!("获取本地地址失败: {}", e))?;
    Ok(local_addr.ip().to_string())
}

// ── SSH (native via ssh2 — no external tools) ──────

fn create_ssh_session(
    host: &str, port: u16, username: &str, password: &str,
) -> Result<Session, String> {
    let addr = format!("{}:{}", host, port);
    let tcp = TcpStream::connect(&addr)
        .map_err(|e| format!("TCP 连接失败 ({}): {}", addr, e))?;
    tcp.set_read_timeout(Some(std::time::Duration::from_secs(15))).ok();
    tcp.set_write_timeout(Some(std::time::Duration::from_secs(15))).ok();

    let mut sess = Session::new()
        .map_err(|e| format!("创建 SSH 会话失败: {}", e))?;
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("SSH 握手失败: {}", e))?;

    sess.userauth_password(username, password)
        .map_err(|e| format!("密码认证失败: {}", e))?;

    if !sess.authenticated() {
        return Err("认证失败".into());
    }
    Ok(sess)
}

fn ssh_exec(sess: &Session, cmd: &str) -> Result<String, String> {
    let mut channel = sess.channel_session()
        .map_err(|e| format!("创建通道失败: {}", e))?;
    channel.exec(cmd)
        .map_err(|e| format!("执行命令失败: {}", e))?;
    let mut stdout = String::new();
    channel.read_to_string(&mut stdout)
        .map_err(|e| format!("读取输出失败: {}", e))?;
    channel.wait_close().ok();
    Ok(stdout.trim().to_string())
}

#[tauri::command]
async fn test_ssh_connection(
    host: String, port: u16, username: String, password: String,
) -> Result<String, String> {
    let sess = create_ssh_session(&host, port, &username, &password)?;
    let result = ssh_exec(&sess, "echo __SSH_OK__")?;
    if result.contains("__SSH_OK__") {
        Ok("连接成功".into())
    } else {
        Err(format!("连接异常: {}", result))
    }
}

// ── Check Result ───────────────────────────────────

#[derive(Serialize, Clone)]
struct CheckResult {
    id: String,
    label: String,
    status: String,
    detail: String,
}

impl CheckResult {
    fn pass(id: &str, label: &str, detail: impl Into<String>) -> Self {
        Self { id: id.into(), label: label.into(), status: "pass".into(), detail: detail.into() }
    }
    fn fail(id: &str, label: &str, detail: impl Into<String>) -> Self {
        Self { id: id.into(), label: label.into(), status: "fail".into(), detail: detail.into() }
    }
    fn warn(id: &str, label: &str, detail: impl Into<String>) -> Self {
        Self { id: id.into(), label: label.into(), status: "warn".into(), detail: detail.into() }
    }
}

// ── Utilities ──────────────────────────────────────

fn run_cmd(program: &str, args: &[&str]) -> Result<String, String> {
    Command::new(program)
        .args(args)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .map_err(|e| e.to_string())
}

/// 检测本地 OpenClaw 安装。
/// 使用 interactive login shell (-ilc) 继承用户完整 PATH（含 npm 全局 bin），
/// 并通过 marker 隔离输出，避免 shell 启动脚本的干扰。
fn detect_openclaw_version() -> String {
    let marker = "~~OC~~";
    let cmd = format!(
        r#"__v=$(openclaw --version 2>/dev/null) && echo "{m}${{__v}}{m}" || echo "{m}NONE{m}""#,
        m = marker,
    );

    // macOS / Linux: 交互式登录 shell（sources ~/.zshrc / ~/.bashrc）
    if cfg!(unix) {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        if let Ok(output) = Command::new(&shell)
            .args(["-ilc", &cmd])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(ver) = extract_between_markers(&stdout, marker) {
                if ver != "NONE" {
                    return ver;
                }
            }
        }
    }

    // Windows: cmd.exe
    if cfg!(target_os = "windows") {
        if let Ok(ver) = run_cmd("cmd", &["/c", "openclaw --version 2>NUL"]) {
            if !ver.is_empty() {
                return ver;
            }
        }
    }

    // 最终兜底：直接调用（已在系统 PATH 中）
    run_cmd("openclaw", &["--version"]).unwrap_or_default()
}

fn extract_between_markers(text: &str, marker: &str) -> Option<String> {
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

fn parse_disk_free_mb(df_output: &str) -> i64 {
    let last_line = df_output.lines().last().unwrap_or("");
    let parts: Vec<&str> = last_line.split_whitespace().collect();
    if parts.len() >= 4 { parse_size_to_mb(parts[3]) } else { 0 }
}

/// 解析远程 compound 命令输出中的分段内容
fn parse_section(output: &str, tag: &str) -> String {
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

// ── Local Environment Check ────────────────────────

#[tauri::command]
async fn check_local_environment() -> Result<Vec<CheckResult>, String> {
    let mut results = Vec::new();
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    // 1. 操作系统（仅显示，不阻止安装）
    let os_detail = match os {
        "macos" => run_cmd("sw_vers", &["-productVersion"]).unwrap_or_default(),
        "windows" => run_cmd("cmd", &["/c", "ver"]).unwrap_or_default(),
        _ => run_cmd("uname", &["-r"]).unwrap_or_default(),
    };
    results.push(CheckResult::pass(
        "os", "操作系统", format!("{} {} ({})", os, os_detail, arch),
    ));

    // 2. CPU 架构（仅显示，不阻止安装）
    let arch_ok = matches!(arch, "aarch64" | "x86_64");
    results.push(if arch_ok {
        CheckResult::pass("arch", "CPU 架构", arch)
    } else {
        CheckResult::warn("arch", "CPU 架构", format!("{} — 建议 x86_64 或 aarch64", arch))
    });

    // 3. CPU 核心 ≥ 2（阻止安装）
    let cpu_cores: i64 = if cfg!(target_os = "macos") {
        run_cmd("sysctl", &["-n", "hw.ncpu"])
            .unwrap_or_default().trim().parse().unwrap_or(0)
    } else if cfg!(target_os = "windows") {
        run_cmd("powershell", &["-Command",
            "(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum"])
            .unwrap_or_default().trim().parse().unwrap_or(0)
    } else {
        run_cmd("nproc", &[]).unwrap_or_default().trim().parse().unwrap_or(0)
    };
    results.push(if cpu_cores >= 2 {
        CheckResult::pass("cpu_cores", "CPU 核心 ≥ 2", format!("{} 核心", cpu_cores))
    } else {
        CheckResult::fail("cpu_cores", "CPU 核心 ≥ 2", format!("{} 核心，不满足最低要求", cpu_cores))
    });

    // 4. 内存 ≥ 2GB（阻止安装）
    let mem_mb: i64 = if cfg!(target_os = "macos") {
        let bytes_str = run_cmd("sysctl", &["-n", "hw.memsize"]).unwrap_or_default();
        bytes_str.trim().parse::<i64>().unwrap_or(0) / 1024 / 1024
    } else if cfg!(target_os = "windows") {
        run_cmd("powershell", &["-Command",
            "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)"])
            .unwrap_or_default().trim().parse().unwrap_or(0)
    } else {
        let free_out = run_cmd("free", &["-m"]).unwrap_or_default();
        free_out.lines()
            .find(|l| l.starts_with("Mem:"))
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0)
    };
    let mem_gb = mem_mb as f64 / 1024.0;
    results.push(if mem_mb >= 2048 {
        CheckResult::pass("memory", "内存 ≥ 2GB", format!("{:.1} GB", mem_gb))
    } else {
        CheckResult::fail("memory", "内存 ≥ 2GB", format!("{:.1} GB，不满足最低要求", mem_gb))
    });

    // 5. 磁盘空间 ≥ 40GB（阻止安装）
    let disk_mb = if cfg!(target_os = "windows") {
        run_cmd("powershell", &["-Command", "(Get-PSDrive C).Free / 1MB"])
            .unwrap_or_default().trim().parse::<f64>().unwrap_or(0.0) as i64
    } else {
        parse_disk_free_mb(&run_cmd("df", &["-h", "/"]).unwrap_or_default())
    };
    let disk_gb = disk_mb as f64 / 1024.0;
    results.push(if disk_mb >= 40960 {
        CheckResult::pass("disk", "磁盘空间 ≥ 40GB", format!("可用 {:.1} GB", disk_gb))
    } else {
        CheckResult::fail("disk", "磁盘空间 ≥ 40GB", format!("可用 {:.1} GB，不满足最低要求", disk_gb))
    });

    // 6. OpenClaw 安装状态（仅显示，不阻止安装）
    let oc_ver = detect_openclaw_version();
    results.push(if oc_ver.is_empty() {
        CheckResult::pass("openclaw", "OpenClaw 安装状态", "未安装，可以继续")
    } else {
        CheckResult::warn("openclaw", "OpenClaw 安装状态", format!("已安装: {}", oc_ver))
    });

    Ok(results)
}

// ── Remote Environment Check (single SSH session) ──

#[tauri::command]
async fn check_remote_environment(
    host: String, port: u16, username: String, password: String,
) -> Result<Vec<CheckResult>, String> {
    let sess = create_ssh_session(&host, port, &username, &password)?;

    let compound_cmd = concat!(
        r#"echo "---OS---"; "#,
        r#"cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '"' || uname -s -r; "#,
        r#"echo "---ARCH---"; "#,
        r#"uname -m; "#,
        r#"echo "---CPUCORES---"; "#,
        r#"nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 0; "#,
        r#"echo "---MEM---"; "#,
        r#"free -m 2>/dev/null | awk '/Mem:/ {print $2}' || echo 0; "#,
        r#"echo "---DISK---"; "#,
        r#"df -BM / 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'M'; "#,
        r#"echo "---OC---"; "#,
        r#"(source ~/.bashrc 2>/dev/null; openclaw --version 2>/dev/null) || "#,
        r#"(source ~/.profile 2>/dev/null; openclaw --version 2>/dev/null) || "#,
        r#"(NPM_G=$(npm prefix -g 2>/dev/null) && test -x "$NPM_G/bin/openclaw" && "$NPM_G/bin/openclaw" --version 2>/dev/null) || "#,
        r#"echo NOTFOUND; "#,
        r#"echo "---END---""#,
    );

    let output = ssh_exec(&sess, compound_cmd)
        .map_err(|e| format!("远程命令执行失败: {}", e))?;

    let mut results = Vec::new();

    // 1. 操作系统（仅显示，不阻止安装）
    let os_name = parse_section(&output, "OS");
    results.push(if os_name.is_empty() {
        CheckResult::warn("os", "操作系统", "无法获取系统信息")
    } else {
        CheckResult::pass("os", "操作系统", os_name)
    });

    // 2. CPU 架构（仅显示，不阻止安装）
    let arch = parse_section(&output, "ARCH");
    let arch_ok = arch == "x86_64" || arch == "aarch64";
    results.push(if arch.is_empty() {
        CheckResult::warn("arch", "CPU 架构", "无法获取")
    } else if arch_ok {
        CheckResult::pass("arch", "CPU 架构", arch)
    } else {
        CheckResult::warn("arch", "CPU 架构", format!("{} — 建议 x86_64 或 aarch64", arch))
    });

    // 3. CPU 核心 ≥ 2（阻止安装）
    let cpu_cores: i64 = parse_section(&output, "CPUCORES").parse().unwrap_or(0);
    results.push(if cpu_cores >= 2 {
        CheckResult::pass("cpu_cores", "CPU 核心 ≥ 2", format!("{} 核心", cpu_cores))
    } else if cpu_cores > 0 {
        CheckResult::fail("cpu_cores", "CPU 核心 ≥ 2", format!("{} 核心，不满足最低要求", cpu_cores))
    } else {
        CheckResult::fail("cpu_cores", "CPU 核心 ≥ 2", "无法获取 CPU 核心数")
    });

    // 4. 内存 ≥ 2GB（阻止安装）
    let mem_mb: i64 = parse_section(&output, "MEM").parse().unwrap_or(0);
    let mem_gb = mem_mb as f64 / 1024.0;
    results.push(if mem_mb >= 2048 {
        CheckResult::pass("memory", "内存 ≥ 2GB", format!("{:.1} GB", mem_gb))
    } else if mem_mb > 0 {
        CheckResult::fail("memory", "内存 ≥ 2GB", format!("{:.1} GB，不满足最低要求", mem_gb))
    } else {
        CheckResult::fail("memory", "内存 ≥ 2GB", "无法获取内存信息")
    });

    // 5. 磁盘空间 ≥ 40GB（阻止安装）
    let disk_mb: i64 = parse_section(&output, "DISK").parse().unwrap_or(0);
    let disk_gb = disk_mb as f64 / 1024.0;
    results.push(if disk_mb >= 40960 {
        CheckResult::pass("disk", "磁盘空间 ≥ 40GB", format!("可用 {:.1} GB", disk_gb))
    } else if disk_mb > 0 {
        CheckResult::fail("disk", "磁盘空间 ≥ 40GB", format!("可用 {:.1} GB，不满足最低要求", disk_gb))
    } else {
        CheckResult::fail("disk", "磁盘空间 ≥ 40GB", "无法获取磁盘信息")
    });

    // 6. OpenClaw 安装状态（仅显示，不阻止安装）
    let oc = parse_section(&output, "OC");
    let installed = !oc.is_empty() && oc != "NOTFOUND";
    results.push(if installed {
        CheckResult::warn("openclaw", "OpenClaw 安装状态", format!("已安装: {}", oc))
    } else {
        CheckResult::pass("openclaw", "OpenClaw 安装状态", "未安装，可以继续")
    });

    Ok(results)
}

// ── Install Log Event ──────────────────────────────

#[derive(Serialize, Clone)]
struct InstallLog {
    line: String,
}

fn emit_log(app: &tauri::AppHandle, line: &str) {
    let _ = app.emit("install:log", InstallLog { line: line.into() });
}

// ── Install: 异步包装 ─────────────────────────────

fn spawn_blocking_install<F>(app: &tauri::AppHandle, f: F) -> std::sync::mpsc::Receiver<Result<String, String>>
where F: FnOnce() -> Result<String, String> + Send + 'static {
    let (tx, rx) = std::sync::mpsc::channel();
    let _ = app;
    std::thread::spawn(move || { let _ = tx.send(f()); });
    rx
}

async fn poll_result(rx: std::sync::mpsc::Receiver<Result<String, String>>) -> Result<String, String> {
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

// ── Install: Local (macOS / Linux / Windows) ──────
// 依据 https://docs.openclaw.ai/install
// Mac/Linux: curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard
// Windows:   & ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -NoOnboard

#[tauri::command]
async fn install_local(app: tauri::AppHandle) -> Result<String, String> {
    let app_handle = app.clone();
    let rx = spawn_blocking_install(&app, move || install_local_blocking(&app_handle));
    poll_result(rx).await
}

fn install_local_blocking(app: &tauri::AppHandle) -> Result<String, String> {
    let os = std::env::consts::OS;

    let (program, args): (String, Vec<String>) = if cfg!(unix) {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        (shell, vec![
            "-lc".into(),
            "curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard 2>&1".into(),
        ])
    } else if os == "windows" {
        ("powershell".into(), vec![
            "-NoProfile".into(), "-ExecutionPolicy".into(), "Bypass".into(), "-Command".into(),
            "& ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -NoOnboard 2>&1".into(),
        ])
    } else {
        return Err(format!("不支持的操作系统: {}", os));
    };

    emit_log(app, &format!("[{}] 开始执行安装脚本...", os));

    let mut child = Command::new(&program)
        .args(&args)
        .env("npm_config_registry", "https://registry.npmmirror.com")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动安装脚本失败: {}", e))?;

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
async fn install_remote(
    app: tauri::AppHandle,
    host: String, port: u16, username: String, password: String,
    install_path: String,
) -> Result<String, String> {
    let _ = install_path;
    let app_handle = app.clone();
    let rx = spawn_blocking_install(&app, move || {
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

    let cmd = "export npm_config_registry=https://registry.npmmirror.com; curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard 2>&1";

    let mut channel = sess.channel_session()
        .map_err(|e| format!("创建通道失败: {}", e))?;
    channel.exec(cmd)
        .map_err(|e| format!("执行命令失败: {}", e))?;

    let mut buf = [0u8; 4096];
    let mut partial = String::new();
    loop {
        match channel.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                partial.push_str(&String::from_utf8_lossy(&buf[..n]));
                while let Some(pos) = partial.find('\n') {
                    let line = partial[..pos].to_string();
                    emit_log(app, &line);
                    partial = partial[pos + 1..].to_string();
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => continue,
            Err(_) => break,
        }
    }
    if !partial.is_empty() {
        emit_log(app, &partial);
    }

    channel.wait_close().ok();
    let exit_code = channel.exit_status().unwrap_or(-1);

    if exit_code == 0 {
        emit_log(app, "安装完成");
        Ok("安装完成".into())
    } else {
        let msg = format!("安装脚本退出码: {}", exit_code);
        emit_log(app, &msg);
        Err(msg)
    }
}

// ── OpenClaw CLI Commands ─────────────────────────

/// 在本地执行 openclaw 子命令，返回 stdout
fn local_openclaw_cmd(args: &str) -> Result<String, String> {
    let marker = "~~OC~~";
    let cmd = format!(
        r#"__r=$(openclaw {args} 2>&1) && echo "{m}${{__r}}{m}" || echo "{m}${{__r}}{m}""#,
        args = args, m = marker,
    );

    if cfg!(unix) {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        if let Ok(output) = Command::new(&shell)
            .args(["-ilc", &cmd])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(result) = extract_between_markers(&stdout, marker) {
                return Ok(result);
            }
        }
    }

    if cfg!(target_os = "windows") {
        let win_cmd = format!("openclaw {} 2>&1", args);
        return run_cmd("cmd", &["/c", &win_cmd]);
    }

    Err("无法执行 openclaw 命令".into())
}

/// 在远程主机执行 openclaw 子命令
fn remote_openclaw_cmd(
    host: &str, port: u16, username: &str, password: &str, args: &str,
) -> Result<String, String> {
    let sess = create_ssh_session(host, port, username, password)?;
    let cmd = format!(
        "source ~/.bashrc 2>/dev/null; source ~/.profile 2>/dev/null; openclaw {} 2>&1",
        args
    );
    ssh_exec(&sess, &cmd)
}

#[tauri::command]
async fn get_openclaw_version(
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<String, String> {
    if target == "remote" {
        remote_openclaw_cmd(
            &host.unwrap_or_default(), port.unwrap_or(22),
            &username.unwrap_or_default(), &password.unwrap_or_default(),
            "--version",
        )
    } else {
        local_openclaw_cmd("--version")
    }
}

#[tauri::command]
async fn check_openclaw_update(
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<String, String> {
    if target == "remote" {
        remote_openclaw_cmd(
            &host.unwrap_or_default(), port.unwrap_or(22),
            &username.unwrap_or_default(), &password.unwrap_or_default(),
            "update status",
        )
    } else {
        local_openclaw_cmd("update status")
    }
}

#[tauri::command]
async fn preview_openclaw_update(
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<String, String> {
    if target == "remote" {
        remote_openclaw_cmd(
            &host.unwrap_or_default(), port.unwrap_or(22),
            &username.unwrap_or_default(), &password.unwrap_or_default(),
            "update --dry-run",
        )
    } else {
        local_openclaw_cmd("update --dry-run")
    }
}

#[tauri::command]
async fn run_openclaw_update(
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<String, String> {
    if target == "remote" {
        remote_openclaw_cmd(
            &host.unwrap_or_default(), port.unwrap_or(22),
            &username.unwrap_or_default(), &password.unwrap_or_default(),
            "update",
        )
    } else {
        local_openclaw_cmd("update")
    }
}

// ── Daemon Info ─────────────────────────────────

/// 去除 ANSI 转义码
fn strip_ansi(s: &str) -> String {
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

#[tauri::command]
async fn get_daemon_info(
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<String, String> {
    let h = host.unwrap_or_default();
    let p = port.unwrap_or(22);
    let u = username.unwrap_or_default();
    let pw = password.unwrap_or_default();

    // 辅助闭包：执行 openclaw 命令
    let run = |cmd: &str| -> Result<String, String> {
        if target == "remote" {
            remote_openclaw_cmd(&h, p, &u, &pw, cmd)
        } else {
            local_openclaw_cmd(cmd)
        }
    };

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

// ── OpenClaw Config ──────────────────────────────

/// 通过 openclaw CLI 发现本地配置文件路径，失败时回退到默认路径
fn discover_local_config_path() -> String {
    // 尝试 openclaw config path
    if let Ok(path) = local_openclaw_cmd("config path") {
        let trimmed = path.trim().to_string();
        if !trimmed.is_empty() && !trimmed.contains(' ') {
            return trimmed;
        }
    }
    // 回退到默认路径（使用 PathBuf 正确处理 Windows 路径分隔符）
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| "~".into());
    let mut path = std::path::PathBuf::from(home);
    path.push(".openclaw");
    path.push("openclaw.json");
    path.to_string_lossy().to_string()
}

/// 通过 SSH 发现远程配置文件路径，失败时回退到默认路径
fn discover_remote_config_path(
    sess: &ssh2::Session,
) -> String {
    if let Ok(path) = ssh_exec(sess, "source ~/.bashrc 2>/dev/null; source ~/.profile 2>/dev/null; openclaw config path 2>/dev/null") {
        let trimmed = path.trim().to_string();
        if !trimmed.is_empty() && !trimmed.contains(' ') {
            return trimmed;
        }
    }
    "~/.openclaw/openclaw.json".into()
}

/// 读取本地 openclaw 配置文件
fn read_local_openclaw_config(explicit_path: Option<&str>) -> Result<String, String> {
    let config_path = match explicit_path {
        Some(p) if !p.is_empty() => p.to_string(),
        _ => discover_local_config_path(),
    };
    std::fs::read_to_string(&config_path)
        .map_err(|e| format!("读取配置文件失败 ({}): {}", config_path, e))
}

#[tauri::command]
async fn read_openclaw_config(
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
    config_path: Option<String>,
) -> Result<String, String> {
    if target == "remote" {
        let sess = create_ssh_session(
            &host.unwrap_or_default(), port.unwrap_or(22),
            &username.unwrap_or_default(), &password.unwrap_or_default(),
        )?;
        let cp = match &config_path {
            Some(p) if !p.is_empty() => p.clone(),
            _ => discover_remote_config_path(&sess),
        };
        // 优先直接读文件，失败时用 CLI
        ssh_exec(&sess, &format!("cat {} 2>/dev/null", cp))
            .or_else(|_| {
                ssh_exec(&sess, "source ~/.bashrc 2>/dev/null; source ~/.profile 2>/dev/null; openclaw config get --json 2>/dev/null")
            })
            .or_else(|_| Ok("{}".into()))
    } else {
        // 优先直接读文件（更快），失败时用 CLI
        read_local_openclaw_config(config_path.as_deref())
            .or_else(|_| local_openclaw_cmd("config get --json"))
    }
}

/// 深度合并两个 serde_json::Value
fn deep_merge(base: &mut serde_json::Value, patch: &serde_json::Value) {
    if let (Some(base_obj), Some(patch_obj)) = (base.as_object_mut(), patch.as_object()) {
        for (k, v) in patch_obj {
            let entry = base_obj.entry(k.clone()).or_insert(serde_json::Value::Null);
            if v.is_object() && entry.is_object() {
                deep_merge(entry, v);
            } else {
                *entry = v.clone();
            }
        }
    } else {
        *base = patch.clone();
    }
}

#[tauri::command]
async fn patch_openclaw_config(
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
    patch: String,
    config_path: Option<String>,
) -> Result<String, String> {
    let patch_value: serde_json::Value = serde_json::from_str(&patch)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    if target == "remote" {
        // 远程: 发现路径 -> 读取 -> 合并 -> 写回 via SSH
        let sess = create_ssh_session(
            &host.unwrap_or_default(), port.unwrap_or(22),
            &username.unwrap_or_default(), &password.unwrap_or_default(),
        )?;
        let cp = match &config_path {
            Some(p) if !p.is_empty() => p.clone(),
            _ => discover_remote_config_path(&sess),
        };
        let raw = ssh_exec(&sess, &format!("cat {} 2>/dev/null || echo '{{}}'", cp))?;
        let mut config: serde_json::Value = serde_json::from_str(&raw)
            .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
        deep_merge(&mut config, &patch_value);
        let json_out = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("JSON 序列化失败: {}", e))?;
        // 确保目录存在，然后写入到发现的路径
        let config_dir = cp.rsplit_once('/').map(|(d, _)| d).unwrap_or("~/.openclaw");
        let write_cmd = format!(
            "mkdir -p {} && cat > {} << 'OPENCLAW_EOF'\n{}\nOPENCLAW_EOF",
            config_dir, cp, json_out
        );
        ssh_exec(&sess, &write_cmd)?;
        Ok("配置已保存".into())
    } else {
        // 本地: 发现路径 -> 读取 -> 合并 -> 写回
        let cp = match &config_path {
            Some(p) if !p.is_empty() => p.clone(),
            _ => discover_local_config_path(),
        };
        let raw = std::fs::read_to_string(&cp).unwrap_or_else(|_| "{}".into());
        let mut config: serde_json::Value = serde_json::from_str(&raw)
            .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
        deep_merge(&mut config, &patch_value);
        let json_out = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("JSON 序列化失败: {}", e))?;
        // 确保目录存在
        if let Some(parent) = std::path::Path::new(&cp).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建配置目录失败: {}", e))?;
        }
        std::fs::write(&cp, &json_out)
            .map_err(|e| format!("写入配置文件失败 ({}): {}", cp, e))?;
        Ok("配置已保存".into())
    }
}

#[allow(dead_code)]
fn shell_escape(s: &str) -> String {
    if cfg!(target_os = "windows") {
        // Windows cmd.exe: use double quotes, escape inner double quotes
        if s.contains(' ') || s.contains('"') || s.contains('&') || s.contains('|') {
            format!("\"{}\"", s.replace('"', "\\\""))
        } else {
            s.to_string()
        }
    } else {
        // Unix: use single quotes
        if s.contains(' ') || s.contains('"') || s.contains('\'') || s.contains('\\') {
            format!("'{}'", s.replace('\'', "'\\''"))
        } else {
            s.to_string()
        }
    }
}

// ── Crypto: AES-256-GCM ───────────────────────────

/// 获取机器唯一标识作为密钥种子
fn get_machine_seed() -> String {
    // macOS: IOPlatformUUID; Linux: /etc/machine-id; Windows: MachineGuid
    if cfg!(target_os = "macos") {
        run_cmd("ioreg", &["-rd1", "-c", "IOPlatformExpertDevice"])
            .unwrap_or_default()
            .lines()
            .find(|l| l.contains("IOPlatformUUID"))
            .and_then(|l| l.split('"').nth(3))
            .unwrap_or("openclaw-fallback-seed")
            .to_string()
    } else if cfg!(target_os = "windows") {
        run_cmd("powershell", &["-Command",
            "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid"])
            .unwrap_or_else(|_| "openclaw-fallback-seed".into())
    } else {
        std::fs::read_to_string("/etc/machine-id")
            .unwrap_or_else(|_| "openclaw-fallback-seed".into())
            .trim().to_string()
    }
}

/// 使用 PBKDF2 从机器种子派生 AES-256 密钥
fn derive_key() -> [u8; 32] {
    let seed = get_machine_seed();
    let salt = b"openclaw-installer-v1";
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(seed.as_bytes(), salt, 100_000, &mut key);
    key
}

#[tauri::command]
async fn encrypt_text(plaintext: String) -> Result<String, String> {
    let key = derive_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("创建加密器失败: {}", e))?;

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("加密失败: {}", e))?;

    // 格式: base64(nonce + ciphertext)
    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);
    Ok(B64.encode(&combined))
}

#[tauri::command]
async fn decrypt_text(encrypted: String) -> Result<String, String> {
    let key = derive_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("创建解密器失败: {}", e))?;

    let combined = B64.decode(&encrypted)
        .map_err(|e| format!("Base64 解码失败: {}", e))?;

    if combined.len() < 12 {
        return Err("加密数据格式无效".into());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("解密失败: {}", e))?;

    String::from_utf8(plaintext)
        .map_err(|e| format!("UTF-8 解码失败: {}", e))
}

// ── Gateway Control ─────────────────────────────────

use std::sync::Mutex as StdMutex;

struct GatewayProcesses {
    log_child: StdMutex<Option<std::process::Child>>,
    fg_child: StdMutex<Option<std::process::Child>>,
}

impl Default for GatewayProcesses {
    fn default() -> Self {
        Self {
            log_child: StdMutex::new(None),
            fg_child: StdMutex::new(None),
        }
    }
}

fn emit_gateway_log(app: &tauri::AppHandle, line: &str) {
    let _ = app.emit("gateway:log", InstallLog { line: line.into() });
}

/// 获取网关状态
#[tauri::command]
async fn gateway_status(
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<String, String> {
    if target == "remote" {
        remote_openclaw_cmd(
            &host.unwrap_or_default(), port.unwrap_or(22),
            &username.unwrap_or_default(), &password.unwrap_or_default(),
            "gateway status --json",
        )
    } else {
        local_openclaw_cmd("gateway status --json")
    }
}

/// 网关控制操作 (start / stop / restart / install)
#[tauri::command]
async fn gateway_control(
    action: String,
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<String, String> {
    let args = format!("gateway {}", action);
    if target == "remote" {
        remote_openclaw_cmd(
            &host.unwrap_or_default(), port.unwrap_or(22),
            &username.unwrap_or_default(), &password.unwrap_or_default(),
            &args,
        )
    } else {
        local_openclaw_cmd(&args)
    }
}

/// 启动实时日志流（本地）
fn start_local_log_stream(_app: &tauri::AppHandle) -> Result<std::process::Child, String> {
    let marker = "~~OC~~";
    let cmd = format!(
        r#"__p=$(command -v openclaw) && echo "{m}FOUND{m}" && "$__p" logs --follow 2>&1 || echo "{m}ERR{m}""#,
        m = marker,
    );

    if cfg!(unix) {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        let child = Command::new(&shell)
            .args(["-lc", &cmd])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("启动日志流失败: {}", e))?;
        return Ok(child);
    }

    if cfg!(target_os = "windows") {
        let win_cmd = "openclaw logs --follow 2>&1";
        let child = Command::new("cmd")
            .args(["/c", win_cmd])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("启动日志流失败: {}", e))?;
        return Ok(child);
    }

    Err("不支持的操作系统".into())
}

#[tauri::command]
async fn start_log_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcesses>,
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<(), String> {
    // 先停止已有日志流
    if let Ok(mut guard) = state.log_child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    if target == "remote" {
        // 远程: SSH 流式读取
        let app_clone = app.clone();
        let h = host.unwrap_or_default();
        let p = port.unwrap_or(22);
        let u = username.unwrap_or_default();
        let pw = password.unwrap_or_default();
        std::thread::spawn(move || {
            if let Ok(sess) = create_ssh_session(&h, p, &u, &pw) {
                let cmd = "source ~/.bashrc 2>/dev/null; source ~/.profile 2>/dev/null; openclaw logs --follow 2>&1";
                if let Ok(mut channel) = sess.channel_session() {
                    if channel.exec(cmd).is_ok() {
                        let mut buf = [0u8; 4096];
                        let mut partial = String::new();
                        loop {
                            match channel.read(&mut buf) {
                                Ok(0) => break,
                                Ok(n) => {
                                    partial.push_str(&String::from_utf8_lossy(&buf[..n]));
                                    while let Some(pos) = partial.find('\n') {
                                        let line = partial[..pos].to_string();
                                        emit_gateway_log(&app_clone, &line);
                                        partial = partial[pos + 1..].to_string();
                                    }
                                }
                                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                    std::thread::sleep(std::time::Duration::from_millis(50));
                                    continue;
                                }
                                Err(_) => break,
                            }
                        }
                        if !partial.is_empty() {
                            emit_gateway_log(&app_clone, &partial);
                        }
                    }
                }
            }
        });
    } else {
        // 本地: 子进程流式读取
        let mut child = start_local_log_stream(&app)?;
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
async fn stop_log_stream(
    state: tauri::State<'_, GatewayProcesses>,
) -> Result<(), String> {
    if let Ok(mut guard) = state.log_child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    Ok(())
}

/// 前台启动网关 (仅本地, daemon 未安装时使用)
#[tauri::command]
async fn start_gateway_run(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcesses>,
    target: String, host: Option<String>, port: Option<u16>,
    username: Option<String>, password: Option<String>,
) -> Result<(), String> {
    // 先停止已有前台进程
    if let Ok(mut guard) = state.fg_child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    if target == "remote" {
        // 远程前台启动
        let app_clone = app.clone();
        let h = host.unwrap_or_default();
        let p = port.unwrap_or(22);
        let u = username.unwrap_or_default();
        let pw = password.unwrap_or_default();
        std::thread::spawn(move || {
            if let Ok(sess) = create_ssh_session(&h, p, &u, &pw) {
                sess.set_timeout(0); // 不超时
                let cmd = "source ~/.bashrc 2>/dev/null; source ~/.profile 2>/dev/null; openclaw gateway run 2>&1";
                if let Ok(mut channel) = sess.channel_session() {
                    if channel.exec(cmd).is_ok() {
                        let mut buf = [0u8; 4096];
                        let mut partial = String::new();
                        loop {
                            match channel.read(&mut buf) {
                                Ok(0) => break,
                                Ok(n) => {
                                    partial.push_str(&String::from_utf8_lossy(&buf[..n]));
                                    while let Some(pos) = partial.find('\n') {
                                        let line = partial[..pos].to_string();
                                        emit_gateway_log(&app_clone, &line);
                                        partial = partial[pos + 1..].to_string();
                                    }
                                }
                                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                    std::thread::sleep(std::time::Duration::from_millis(50));
                                    continue;
                                }
                                Err(_) => break,
                            }
                        }
                        if !partial.is_empty() {
                            emit_gateway_log(&app_clone, &partial);
                        }
                    }
                }
            }
        });
        return Ok(());
    }

    // 本地前台启动
    let cmd = if cfg!(unix) {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        Command::new(&shell)
            .args(["-lc", "openclaw gateway run 2>&1"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
    } else {
        Command::new("cmd")
            .args(["/c", "openclaw gateway run 2>&1"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
    };

    let mut child = cmd.map_err(|e| format!("启动网关失败: {}", e))?;
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
async fn stop_gateway_run(
    state: tauri::State<'_, GatewayProcesses>,
) -> Result<(), String> {
    if let Ok(mut guard) = state.fg_child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    Ok(())
}

// ── App Setup ──────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(GatewayProcesses::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:openclaw.db", vec![
                    Migration {
                        version: 1,
                        description: "create_settings_and_resources",
                        sql: "CREATE TABLE IF NOT EXISTS settings (
                            key   TEXT PRIMARY KEY,
                            value TEXT NOT NULL
                        );
                        CREATE TABLE IF NOT EXISTS resources (
                            id          INTEGER PRIMARY KEY AUTOINCREMENT,
                            name        TEXT NOT NULL,
                            type        TEXT NOT NULL,
                            host        TEXT,
                            port        INTEGER,
                            username    TEXT,
                            password    TEXT,
                            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
                        );",
                        kind: MigrationKind::Up,
                    },
                    Migration {
                        version: 2,
                        description: "drop_settings_table",
                        sql: "DROP TABLE IF EXISTS settings;",
                        kind: MigrationKind::Up,
                    },
                ])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_platform,
            get_local_lan_ip,
            test_ssh_connection,
            check_local_environment,
            check_remote_environment,
            install_local,
            install_remote,
            encrypt_text,
            decrypt_text,
            get_openclaw_version,
            check_openclaw_update,
            preview_openclaw_update,
            run_openclaw_update,
            get_daemon_info,
            read_openclaw_config,
            patch_openclaw_config,
            gateway_status,
            gateway_control,
            start_log_stream,
            stop_log_stream,
            start_gateway_run,
            stop_gateway_run,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
