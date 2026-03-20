use crate::cli::local_openclaw_cmd;
use crate::helpers::REMOTE_PATH_SETUP;
use crate::ssh::{create_ssh_session, ssh_exec};

/// POSIX 单引号转义，防止文件路径中的特殊字符被 shell 解释
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// 构建 shell 安全的路径表达式。
/// ~/... 展开为 "$HOME"/'{rest}'（允许变量展开但保护特殊字符），
/// 其余路径直接使用 shell_quote。
fn shell_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        format!("\"$HOME\"/{}", shell_quote(rest))
    } else if path == "~" {
        "\"$HOME\"".to_string()
    } else {
        shell_quote(path)
    }
}

/// 将 ~/ 前缀展开为绝对路径（Rust std::fs 不会展开 ~）
fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".into());
        format!("{}/{}", home, rest)
    } else if path == "~" {
        std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".into())
    } else {
        path.to_string()
    }
}

/// 通过 SFTP 安全地写入远程文件（避免 shell 管道注入）
fn write_remote_file(sess: &ssh2::Session, path: &str, content: &str) -> Result<String, String> {
    // 先创建目录
    let dir = path.rsplit_once('/').map(|(d, _)| d).unwrap_or("~/.openclaw");
    ssh_exec(sess, &format!("mkdir -p {}", shell_path(dir)))?;

    // 使用 SFTP 写入文件（安全，无 shell 注入风险）
    let sftp = sess.sftp().map_err(|e| format!("SFTP 会话失败: {}", e))?;
    let mut file = sftp.create(std::path::Path::new(path))
        .map_err(|e| format!("创建文件失败 ({}): {}", path, e))?;
    use std::io::Write;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(format!("已写入 {} 字节", content.len()))
}

// ── Config Path Discovery ──────────────────────────

/// 通过 openclaw CLI 发现本地配置文件路径，失败时回退到默认路径
fn discover_local_config_path() -> String {
    // 尝试 openclaw config file
    if let Ok(output) = local_openclaw_cmd("config file") {
        // 从后向前查找第一行看起来像路径的内容（跳过 plugin 注册、doctor 警告等噪声）
        for line in output.lines().rev() {
            let trimmed = line.trim();
            if trimmed.is_empty() { continue; }
            if (trimmed.starts_with('/') || trimmed.starts_with('~') || trimmed.contains(":\\"))
                && !trimmed.contains(' ')
            {
                return expand_tilde(trimmed);
            }
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
    let cmd = format!("{}; openclaw config file 2>/dev/null", REMOTE_PATH_SETUP);
    if let Ok(output) = ssh_exec(sess, &cmd) {
        // 从后向前查找第一行看起来像路径的内容（跳过 plugin 注册、doctor 警告等噪声）
        for line in output.lines().rev() {
            let trimmed = line.trim();
            if trimmed.is_empty() { continue; }
            if (trimmed.starts_with('/') || trimmed.starts_with('~')) && !trimmed.contains(' ') {
                return trimmed.to_string();
            }
        }
    }
    "~/.openclaw/openclaw.json".into()
}

// ── Read / Write Config ────────────────────────────

/// 读取本地 openclaw 配置文件
fn read_local_openclaw_config(explicit_path: Option<&str>) -> Result<String, String> {
    let config_path = match explicit_path {
        Some(p) if !p.is_empty() => expand_tilde(p),
        _ => discover_local_config_path(),
    };
    std::fs::read_to_string(&config_path)
        .map_err(|e| format!("读取配置文件失败 ({}): {}", config_path, e))
}

#[tauri::command]
pub async fn read_openclaw_config(
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
        // 注意：ssh_exec 不检查 exit code，cat 失败时返回 Ok("")，
        // 需要过滤空结果以触发 fallback
        match ssh_exec(&sess, &format!("cat {} 2>/dev/null", shell_path(&cp))) {
            Ok(ref s) if !s.trim().is_empty() => Ok(s.trim().to_string()),
            _ => Ok("{}".into()),
        }
    } else {
        // 优先直接读文件（更快），文件不存在时返回空配置（全新安装场景）
        read_local_openclaw_config(config_path.as_deref())
            .or_else(|_| Ok("{}".into()))
    }
}

// ── Deep Merge (RFC 7396 JSON Merge Patch) ─────────

/// 深度合并两个 serde_json::Value (RFC 7396 JSON Merge Patch semantics:
/// patch value `null` deletes the key from base)
fn deep_merge(base: &mut serde_json::Value, patch: &serde_json::Value) {
    if let (Some(base_obj), Some(patch_obj)) = (base.as_object_mut(), patch.as_object()) {
        for (k, v) in patch_obj {
            if v.is_null() {
                base_obj.remove(k);
            } else if v.is_object() {
                let entry = base_obj.entry(k.clone()).or_insert(serde_json::Value::Object(serde_json::Map::new()));
                deep_merge(entry, v);
            } else {
                base_obj.insert(k.clone(), v.clone());
            }
        }
    } else {
        *base = patch.clone();
    }
}

#[tauri::command]
pub async fn patch_openclaw_config(
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
        let raw = ssh_exec(&sess, &format!("cat {} 2>/dev/null || echo '{{}}'", shell_path(&cp)))?;
        let mut config: serde_json::Value = serde_json::from_str(&raw)
            .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
        deep_merge(&mut config, &patch_value);
        let json_out = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("JSON 序列化失败: {}", e))?;
        write_remote_file(&sess, &cp, &json_out)?;
        Ok("配置已保存".into())
    } else {
        // 本地: 发现路径 -> 读取 -> 合并 -> 写回
        let cp = match &config_path {
            Some(p) if !p.is_empty() => expand_tilde(p),
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

// ── Config Sanitization ────────────────────────────

/// 清理配置中已知的无效字段，防止 gateway 启动时校验失败。
/// 返回 true 表示配置被修改过，需要写回。
fn sanitize_config(config: &mut serde_json::Value) -> bool {
    let mut changed = false;
    if let Some(obj) = config.as_object_mut() {
        // web.brave — OpenClaw 旧版残留，新版不识别
        if let Some(web) = obj.get_mut("web") {
            if let Some(web_obj) = web.as_object_mut() {
                if web_obj.remove("brave").is_some() {
                    changed = true;
                }
                // 如果 web 对象已空，整个删除
                if web_obj.is_empty() {
                    obj.remove("web");
                }
            }
        }
    }
    changed
}

/// 在 gateway start / restart 前清理本地配置
pub fn sanitize_local_config() {
    let cp = discover_local_config_path();
    let raw = match std::fs::read_to_string(&cp) {
        Ok(r) => r,
        Err(_) => return,
    };
    let mut config: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return,
    };
    if sanitize_config(&mut config) {
        if let Ok(json_out) = serde_json::to_string_pretty(&config) {
            let _ = std::fs::write(&cp, json_out);
        }
    }
}

/// 在 gateway start / restart 前清理远程配置
pub fn sanitize_remote_config(sess: &ssh2::Session) {
    let cp = discover_remote_config_path(sess);
    let raw = match ssh_exec(sess, &format!("cat {} 2>/dev/null", shell_path(&cp))) {
        Ok(r) => r,
        Err(_) => return,
    };
    let mut config: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return,
    };
    if sanitize_config(&mut config) {
        if let Ok(json_out) = serde_json::to_string_pretty(&config) {
            let _ = write_remote_file(sess, &cp, &json_out);
        }
    }
}
