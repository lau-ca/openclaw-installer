#!/bin/bash
set -eo pipefail

echo "=== OpenClaw HTTPS 配置脚本 ==="

# -------- 0. sudo 权限处理 --------
if [ "$(id -u)" -eq 0 ]; then
  # 当前是 root 用户，直接执行无需 sudo
  do_sudo() { "$@"; }
  echo "✅ 当前为 root 用户，无需 sudo"
else
  # 非 root 用户，需要 sudo 密码
  # 平台通过环境变量 SUDO_PASS 传入密码，或脚本交互式询问
  if [ -z "$SUDO_PASS" ]; then
    printf "请输入 sudo 密码: "
    stty -echo 2>/dev/null || true
    read -r SUDO_PASS
    stty echo 2>/dev/null || true
    echo ""
  fi

  # 封装 sudo 命令：通过 stdin 传入密码
  do_sudo() {
    echo "$SUDO_PASS" | sudo -S "$@" 2>&1 | grep -v '^\[sudo\]' || true
  }

  # 验证 sudo 密码是否正确
  if ! echo "$SUDO_PASS" | sudo -S -v 2>/dev/null; then
    echo "❌ sudo 密码错误或当前用户无 sudo 权限"
    exit 1
  fi
fi

# -------- 1. 检测架构 --------
ARCH=$(uname -m)
case $ARCH in
  x86_64)      CADDY_ARCH="amd64" ;;
  aarch64)     CADDY_ARCH="arm64" ;;
  armv7l)      CADDY_ARCH="armv7" ;;
  armv6l)      CADDY_ARCH="armv6" ;;
  armv5l)      CADDY_ARCH="armv5" ;;
  riscv64)     CADDY_ARCH="riscv64" ;;
  ppc64le)     CADDY_ARCH="ppc64le" ;;
  s390x)       CADDY_ARCH="s390x" ;;
  loongarch64) echo "❌ 龙芯 LoongArch 架构暂无 Caddy 官方预编译包，请自行编译安装"; exit 1 ;;
  mips64el)    echo "❌ MIPS64LE 架构暂无 Caddy 官方预编译包，请自行编译安装"; exit 1 ;;
  mips64)      echo "❌ MIPS64 架构暂无 Caddy 官方预编译包，请自行编译安装"; exit 1 ;;
  sw_64)       echo "❌ 申威架构暂不支持，请手动配置 HTTPS"; exit 1 ;;
  *)           echo "❌ 不支持的架构: $ARCH"; exit 1 ;;
esac

# -------- 2. 检测/安装 Caddy --------
CADDY_BIN="$HOME/.openclaw/bin/caddy"
CADDY_TMP="${CADDY_BIN}.download"
mkdir -p "$HOME/.openclaw/bin"

CADDY_VER="2.11.2"

download_caddy() {
  echo "⬇️  正在下载 Caddy v${CADDY_VER} (${CADDY_ARCH})..."

  CADDY_TAR="${CADDY_TMP}.tar.gz"
  local downloaded=false
  local CADDY_RELEASE_FILE="caddy_${CADDY_VER}_linux_${CADDY_ARCH}.tar.gz"
  local GITHUB_RELEASE_URL="https://github.com/caddyserver/caddy/releases/download/v${CADDY_VER}/${CADDY_RELEASE_FILE}"

  # Mirror list: prioritize China-friendly CDNs, then proxies, then direct
  local MIRROR_URLS=(
    "https://cdn.npmmirror.com/binaries/caddy/v${CADDY_VER}/${CADDY_RELEASE_FILE}"
    "https://ghfast.top/${GITHUB_RELEASE_URL}"
    "${GITHUB_MIRROR:-https://gh-proxy.com}/${GITHUB_RELEASE_URL}"
    "${GITHUB_RELEASE_URL}"
  )

  # Try each mirror for tar.gz download
  local idx=0
  for mirror_url in "${MIRROR_URLS[@]}"; do
    idx=$((idx + 1))
    echo "  [${idx}/${#MIRROR_URLS[@]}] 尝试: ${mirror_url}"
    rm -f "$CADDY_TAR" 2>/dev/null
    if curl -fL "$mirror_url" -o "$CADDY_TAR" --connect-timeout 15 --max-time 120 2>&1; then
      EXTRACT_DIR=$(mktemp -d)
      if tar -xzf "$CADDY_TAR" -C "$EXTRACT_DIR" caddy 2>/dev/null; then
        mv -f "$EXTRACT_DIR/caddy" "$CADDY_TMP" && downloaded=true
      else
        echo "⚠️  tar 解压失败，文件可能无效"
      fi
      rm -rf "$EXTRACT_DIR" "$CADDY_TAR" 2>/dev/null
      if [ "$downloaded" = true ]; then
        break
      fi
    else
      echo "⚠️  下载失败"
      rm -f "$CADDY_TAR" 2>/dev/null
    fi
  done

  # Fallback: Caddy 官方 API（裸二进制，Cloudflare CDN）
  if [ "$downloaded" = false ]; then
    local CADDY_API_URL="https://caddyserver.com/api/download?os=linux&arch=${CADDY_ARCH}&version=v${CADDY_VER}"
    echo "  尝试 Caddy 官方 API: ${CADDY_API_URL}"
    if curl -fL "$CADDY_API_URL" -o "$CADDY_TMP" --connect-timeout 15 --max-time 120 2>&1; then
      downloaded=true
    else
      echo "⚠️  Caddy 官方 API 下载失败"
      rm -f "$CADDY_TMP" 2>/dev/null
    fi
  fi

  # 最终检查
  if [ "$downloaded" = false ] || [ ! -f "$CADDY_TMP" ]; then
    echo "❌ Caddy 下载失败，所有下载方式均未成功，请检查网络连接"
    exit 1
  fi

  chmod +x "$CADDY_TMP"
  mv -f "$CADDY_TMP" "$CADDY_BIN"
  echo "✅ Caddy 下载完成: $($CADDY_BIN version 2>/dev/null | awk '{print $1}' || echo '未知版本')"
}

if [ -f "$CADDY_BIN" ]; then
  echo "✅ Caddy 已存在: $CADDY_BIN"
else
  download_caddy
fi

# -------- 3. 读取 OpenClaw 端口 --------
# 优先通过 openclaw CLI 读取配置，失败则使用默认端口
OPENCLAW_PORT=$(openclaw config get gateway.port 2>/dev/null | grep -oE '[0-9]+' || echo "")
if [ -z "$OPENCLAW_PORT" ]; then
  OPENCLAW_PORT="18789"
  echo "⚠️  无法通过 openclaw config get 读取端口，使用默认端口 18789"
fi

# -------- 4. 获取局域网 IP，配置 HTTPS 端口 --------
LAN_IP=$(hostname -I | awk '{print $1}')
if [ -z "$LAN_IP" ]; then
  echo "❌ 无法获取局域网 IP"; exit 1
fi

# HTTPS 暴露端口：通过脚本参数 $1 传入，或交互式询问
HTTPS_PORT="${1:-}"
if [ -z "$HTTPS_PORT" ]; then
  printf "请输入 HTTPS 对外暴露端口 [默认: 18790]: "
  read -r HTTPS_PORT
  HTTPS_PORT="${HTTPS_PORT:-18790}"
fi
# 校验端口号
if ! echo "$HTTPS_PORT" | grep -qE '^[0-9]+$' || [ "$HTTPS_PORT" -lt 1 ] || [ "$HTTPS_PORT" -gt 65535 ]; then
  echo "❌ 无效端口号: $HTTPS_PORT"; exit 1
fi
if [ "$HTTPS_PORT" = "$OPENCLAW_PORT" ]; then
  echo "❌ HTTPS 端口不能与 OpenClaw 端口 ($OPENCLAW_PORT) 相同"; exit 1
fi

CADDYFILE="$HOME/.openclaw/Caddyfile"

if [ -f "$CADDYFILE" ]; then
  cp "$CADDYFILE" "${CADDYFILE}.bak"
fi

# 先停止已有的 Caddy 服务（释放 admin 端口），再检测空闲端口
do_sudo systemctl stop openclaw-caddy 2>/dev/null || true

# 自动寻找空闲的 admin 端口（从 2020 开始递增）
ADMIN_PORT=2020
while true; do
  if ! ss -tlnH 2>/dev/null | awk '{print $4}' | grep -q ":${ADMIN_PORT}$" && \
     ! netstat -tlnp 2>/dev/null | grep -q ":${ADMIN_PORT} "; then
    break
  fi
  ADMIN_PORT=$((ADMIN_PORT + 1))
  if [ "$ADMIN_PORT" -gt 2099 ]; then
    echo "❌ 端口 2020-2099 均被占用，无法分配 Caddy admin 端口"; exit 1
  fi
done

cat > "$CADDYFILE" <<EOF
{
    admin localhost:${ADMIN_PORT}
    auto_https disable_redirects
}

https://${LAN_IP}:${HTTPS_PORT} {
    tls internal
    reverse_proxy localhost:${OPENCLAW_PORT}
}
EOF
echo "✅ Caddyfile 已写入"

# -------- 5. 配置 systemd 开机自启 --------
# 注意：Caddy 仅做 TLS 终止 + 反向代理，OpenClaw 使用 token 认证（由 ConfigPanel 管理）
SERVICE_FILE="/etc/systemd/system/openclaw-caddy.service"

do_sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Caddy HTTPS Proxy for OpenClaw
After=network.target

[Service]
User=$USER
ExecStart=$CADDY_BIN run --config $CADDYFILE
ExecReload=$CADDY_BIN reload --config $CADDYFILE
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

do_sudo systemctl daemon-reload
do_sudo systemctl enable openclaw-caddy
do_sudo systemctl restart openclaw-caddy

# 验证服务是否启动成功（首次启动需要生成证书，等待稍长）
sleep 3
if do_sudo systemctl is-active openclaw-caddy | grep -q "^active$"; then
  echo "✅ 服务已启动并设置开机自启"
else
  echo "❌ 服务启动失败，请检查日志: sudo journalctl -u openclaw-caddy -n 20"
  exit 1
fi

# 清理密码变量
unset SUDO_PASS
