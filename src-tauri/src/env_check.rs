use crate::cli::detect_openclaw_version;
use crate::helpers::{parse_section, run_cmd, CheckResult};
#[cfg(not(target_os = "windows"))]
use crate::helpers::parse_disk_free_mb;
use crate::ssh::{create_ssh_session, ssh_exec};

// ── Platform-specific local metrics ────────────────

#[cfg(target_os = "macos")]
fn local_cpu_cores() -> i64 {
    run_cmd("sysctl", &["-n", "hw.ncpu"])
        .unwrap_or_default().trim().parse().unwrap_or(0)
}
#[cfg(target_os = "windows")]
fn local_cpu_cores() -> i64 {
    run_cmd("powershell", &["-NoProfile", "-Command",
        "(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum"])
        .unwrap_or_default().trim().parse().unwrap_or(0)
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn local_cpu_cores() -> i64 {
    run_cmd("nproc", &[]).unwrap_or_default().trim().parse().unwrap_or(0)
}

#[cfg(target_os = "macos")]
fn local_mem_mb() -> i64 {
    let bytes_str = run_cmd("sysctl", &["-n", "hw.memsize"]).unwrap_or_default();
    bytes_str.trim().parse::<i64>().unwrap_or(0) / 1024 / 1024
}
#[cfg(target_os = "windows")]
fn local_mem_mb() -> i64 {
    run_cmd("powershell", &["-NoProfile", "-Command",
        "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)"])
        .unwrap_or_default().trim().parse().unwrap_or(0)
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn local_mem_mb() -> i64 {
    let free_out = run_cmd("free", &["-m"]).unwrap_or_default();
    free_out.lines()
        .find(|l| l.starts_with("Mem:"))
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0)
}

#[cfg(target_os = "windows")]
fn local_disk_free_mb() -> i64 {
    run_cmd("powershell", &["-NoProfile", "-Command", "(Get-PSDrive C).Free / 1MB"])
        .unwrap_or_default().trim().parse::<f64>().unwrap_or(0.0) as i64
}
#[cfg(not(target_os = "windows"))]
fn local_disk_free_mb() -> i64 {
    parse_disk_free_mb(&run_cmd("df", &["-h", "/"]).unwrap_or_default())
}

// ── Local Environment Check ────────────────────────

#[tauri::command]
pub async fn check_local_environment() -> Result<Vec<CheckResult>, String> {
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
    let cpu_cores = local_cpu_cores();
    results.push(if cpu_cores >= 2 {
        CheckResult::pass("cpu_cores", "CPU 核心 ≥ 2", format!("{} 核心", cpu_cores))
    } else {
        CheckResult::fail("cpu_cores", "CPU 核心 ≥ 2", format!("{} 核心，不满足最低要求", cpu_cores))
    });

    // 4. 内存 ≥ 2GB（阻止安装）
    let mem_mb = local_mem_mb();
    let mem_gb = mem_mb as f64 / 1024.0;
    results.push(if mem_mb >= 2048 {
        CheckResult::pass("memory", "内存 ≥ 2GB", format!("{:.1} GB", mem_gb))
    } else {
        CheckResult::fail("memory", "内存 ≥ 2GB", format!("{:.1} GB，不满足最低要求", mem_gb))
    });

    // 5. 磁盘空间 ≥ 40GB（阻止安装）
    let disk_mb = local_disk_free_mb();
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
pub async fn check_remote_environment(
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
        r#"(source ~/.bash_profile 2>/dev/null; source ~/.bashrc 2>/dev/null; source ~/.zshrc 2>/dev/null; source ~/.profile 2>/dev/null; export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:$PATH"; openclaw --version 2>/dev/null) || "#,
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
