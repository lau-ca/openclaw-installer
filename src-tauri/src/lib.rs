mod cli;
mod config;
mod crypto;
mod env_check;
mod gateway;
mod helpers;
mod install;
mod integration;
mod ssh;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

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

// ── App Setup ──────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(gateway::GatewayProcesses::default())
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
            ssh::test_ssh_connection,
            env_check::check_local_environment,
            env_check::check_remote_environment,
            install::install_local,
            install::install_remote,
            crypto::encrypt_text,
            crypto::decrypt_text,
            cli::get_openclaw_version,
            cli::check_openclaw_update,
            cli::preview_openclaw_update,
            cli::run_openclaw_update,
            cli::get_daemon_info,
            config::read_openclaw_config,
            config::patch_openclaw_config,
            gateway::gateway_status,
            gateway::gateway_control,
            gateway::start_log_stream,
            gateway::stop_log_stream,
            gateway::start_gateway_run,
            gateway::stop_gateway_run,
            integration::install_openclaw_integration,
            install::setup_remote_https,
        ])
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                let window = _app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
