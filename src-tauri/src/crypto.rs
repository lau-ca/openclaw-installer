use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use sha2::Sha256;

use zeroize::Zeroizing;

use crate::helpers::run_cmd;

/// 获取机器唯一标识作为密钥种子 (macOS: IOPlatformUUID)
#[cfg(target_os = "macos")]
fn get_machine_seed() -> Result<String, String> {
    let output = run_cmd("ioreg", &["-rd1", "-c", "IOPlatformExpertDevice"])
        .map_err(|e| format!("获取机器标识失败: {}", e))?;
    output.lines()
        .find(|l| l.contains("IOPlatformUUID"))
        .and_then(|l| l.split('"').nth(3))
        .map(|s| s.to_string())
        .ok_or_else(|| "无法解析 IOPlatformUUID".into())
}

/// 获取机器唯一标识作为密钥种子 (Windows: MachineGuid)
#[cfg(target_os = "windows")]
fn get_machine_seed() -> Result<String, String> {
    let output = run_cmd("powershell", &["-NoProfile", "-Command",
        "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid"])
        .map_err(|e| format!("获取机器标识失败: {}", e))?;
    let trimmed = output.trim();
    if trimmed.is_empty() {
        Err("无法获取 MachineGuid".into())
    } else {
        Ok(trimmed.to_string())
    }
}

/// 获取机器唯一标识作为密钥种子 (Linux: /etc/machine-id)
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn get_machine_seed() -> Result<String, String> {
    let output = std::fs::read_to_string("/etc/machine-id")
        .map_err(|e| format!("读取 machine-id 失败: {}", e))?;
    let trimmed = output.trim();
    if trimmed.is_empty() {
        Err("machine-id 为空".into())
    } else {
        Ok(trimmed.to_string())
    }
}

/// 使用 PBKDF2 从机器种子派生 AES-256 密钥（返回 Zeroizing 包装，drop 时自动清零）
fn derive_key() -> Result<Zeroizing<[u8; 32]>, String> {
    let seed = Zeroizing::new(get_machine_seed()?);
    let salt = b"openclaw-installer-v1";
    let mut key = Zeroizing::new([0u8; 32]);
    pbkdf2::pbkdf2_hmac::<Sha256>(seed.as_bytes(), salt, 100_000, &mut *key);
    Ok(key)
}

#[tauri::command]
pub async fn encrypt_text(plaintext: String) -> Result<String, String> {
    let key = derive_key()?;
    let cipher = Aes256Gcm::new_from_slice(&*key)
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
pub async fn decrypt_text(encrypted: String) -> Result<String, String> {
    let key = derive_key()?;
    let cipher = Aes256Gcm::new_from_slice(&*key)
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
