use crate::cli::local_openclaw_cmd;
use crate::helpers::REMOTE_PATH_SETUP;
use crate::ssh::{create_ssh_session, ssh_exec};

/// 检查插件安装输出是否表示失败
fn check_plugin_output(output: &str, pkg: &str) -> Result<String, String> {
    let lower = output.to_lowercase();
    if lower.contains("error") || lower.contains("failed") || lower.contains("not found")
        || lower.contains("enoent") || lower.contains("404")
    {
        if lower.contains("already") || lower.contains("up to date") || lower.contains("已安装") {
            return Ok(output.to_string());
        }
        return Err(format!("插件 {} 安装失败: {}", pkg, output.trim()));
    }
    Ok(output.to_string())
}

/// Install the correct channel plugin for a given channel ID.
#[tauri::command]
pub async fn install_openclaw_integration(
    channel: String,
    target: String,
    host: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
) -> Result<String, String> {
    let pkg = match channel.as_str() {
        "dingtalk" => "@soimy/dingtalk",
        "wecom"    => "@openclaw-china/wecom",
        "feishu"   => return Ok("feishu is a built-in channel, no plugin needed".into()),
        _          => return Err(format!("unknown channel: {}", channel)),
    };

    let install_args = format!("plugins install {}", pkg);

    if target == "remote" {
        // 远程: 通过 SSH 设置 NPM_CONFIG_REGISTRY 后执行
        let sess = create_ssh_session(
            host.as_deref().unwrap_or_default(),
            port.unwrap_or(22),
            username.as_deref().unwrap_or_default(),
            password.as_deref().unwrap_or_default(),
        )?;
        let cmd = format!(
            "export NPM_CONFIG_REGISTRY=https://registry.npmmirror.com; \
             {}; openclaw {} 2>&1; echo \"EXIT:$?\"",
            REMOTE_PATH_SETUP, install_args
        );
        let output = ssh_exec(&sess, &cmd)?;
        if output.contains("EXIT:0") {
            Ok(output)
        } else {
            check_plugin_output(&output, pkg)
        }
    } else {
        // 本地: 复用 local_openclaw_cmd（已处理 PATH 和跨平台）
        match local_openclaw_cmd(&install_args) {
            Ok(output) => check_plugin_output(&output, pkg),
            Err(e) => Err(format!("插件 {} 安装失败: {}", pkg, e)),
        }
    }
}
