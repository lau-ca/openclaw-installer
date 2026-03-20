#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────
# OpenClaw Installer - Mac 打包脚本
# 构建 Apple Silicon (aarch64) + Intel (x86_64) DMG
# ─────────────────────────────────────────────────

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(grep '"version"' "$PROJECT_ROOT/src-tauri/tauri.conf.json" | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
OUTPUT_DIR="$PROJECT_ROOT/dist-mac"

echo "========================================="
echo "  OpenClaw Installer - Mac Build"
echo "  Version: $VERSION"
echo "========================================="

# 检查依赖
command -v rustup >/dev/null 2>&1 || { echo "❌ 未找到 rustup，请先安装 Rust"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "❌ 未找到 node，请先安装 Node.js"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "❌ 未找到 npm"; exit 1; }

# 确保两个 target 都已安装
echo ""
echo "▶ 检查 Rust targets..."
rustup target add aarch64-apple-darwin 2>/dev/null || true
rustup target add x86_64-apple-darwin 2>/dev/null || true

# 安装前端依赖
echo ""
echo "▶ 安装前端依赖..."
cd "$PROJECT_ROOT"
npm ci --prefer-offline 2>/dev/null || npm install

# 构建 Apple Silicon
echo ""
echo "========================================="
echo "▶ 构建 Apple Silicon (aarch64)..."
echo "========================================="
npm run tauri build -- --target aarch64-apple-darwin

# 构建 Intel
echo ""
echo "========================================="
echo "▶ 构建 Intel (x86_64)..."
echo "========================================="
npm run tauri build -- --target x86_64-apple-darwin

# 收集产物到 dist-mac 目录
echo ""
echo "▶ 收集构建产物..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

AARCH64_DMG="$PROJECT_ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/OpenClaw Installer_${VERSION}_aarch64.dmg"
X64_DMG="$PROJECT_ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/OpenClaw Installer_${VERSION}_x64.dmg"

# aarch64 可能在默认 target 目录
if [ ! -f "$AARCH64_DMG" ]; then
  AARCH64_DMG="$PROJECT_ROOT/src-tauri/target/release/bundle/dmg/OpenClaw Installer_${VERSION}_aarch64.dmg"
fi

if [ -f "$AARCH64_DMG" ]; then
  cp "$AARCH64_DMG" "$OUTPUT_DIR/"
  echo "  ✅ Apple Silicon: $(basename "$AARCH64_DMG")"
else
  echo "  ⚠️  Apple Silicon DMG 未找到"
fi

if [ -f "$X64_DMG" ]; then
  cp "$X64_DMG" "$OUTPUT_DIR/"
  echo "  ✅ Intel:         $(basename "$X64_DMG")"
else
  echo "  ⚠️  Intel DMG 未找到"
fi

echo ""
echo "========================================="
echo "  构建完成！"
echo "  输出目录: $OUTPUT_DIR"
echo "========================================="
ls -lh "$OUTPUT_DIR"/*.dmg 2>/dev/null || echo "  (无 DMG 文件)"
echo ""
echo "⚠️  未签名应用提示："
echo "  安装后如遇「无法验证开发者」，请执行："
echo "  xattr -cr \"/Applications/OpenClaw Installer.app\""
echo "  或右键点击 app → 打开"
echo ""
