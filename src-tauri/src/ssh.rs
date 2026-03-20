use ssh2::Session;
use std::io::Read;
use std::net::TcpStream;

pub fn create_ssh_session(
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

pub fn ssh_exec(sess: &Session, cmd: &str) -> Result<String, String> {
    let mut channel = sess.channel_session()
        .map_err(|e| format!("创建通道失败: {}", e))?;
    channel.exec(cmd)
        .map_err(|e| format!("执行命令失败: {}", e))?;
    let mut stdout = String::new();
    channel.read_to_string(&mut stdout)
        .map_err(|e| format!("读取输出失败: {}", e))?;
    channel.close().ok();
    channel.wait_close().ok();
    Ok(stdout.trim().to_string())
}

/// 通过 SSH 流式读取命令输出，每行回调。
/// 回调返回 `false` 时提前终止流（用于取消操作）。
pub fn ssh_stream_lines<F>(
    sess: &Session, cmd: &str, mut on_line: F,
) -> Result<i32, String>
where
    F: FnMut(&str) -> bool,
{
    let mut channel = sess.channel_session()
        .map_err(|e| format!("创建通道失败: {}", e))?;
    channel.exec(cmd)
        .map_err(|e| format!("执行命令失败: {}", e))?;

    let mut buf = [0u8; 4096];
    let mut partial = String::new();
    let mut cancelled = false;
    loop {
        match channel.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                partial.push_str(&String::from_utf8_lossy(&buf[..n]));
                while let Some(pos) = partial.find('\n') {
                    let line = partial[..pos].to_string();
                    if !on_line(&line) {
                        cancelled = true;
                        break;
                    }
                    partial = partial[pos + 1..].to_string();
                }
                if cancelled { break; }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                || e.kind() == std::io::ErrorKind::TimedOut => {
                std::thread::sleep(std::time::Duration::from_millis(50));
                continue;
            }
            Err(_) => break,
        }
    }
    if !cancelled && !partial.is_empty() {
        on_line(&partial);
    }

    channel.close().ok();
    channel.wait_close().ok();
    Ok(channel.exit_status().unwrap_or(-1))
}

#[tauri::command]
pub async fn test_ssh_connection(
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
