# ─────────────────────────────────────────────────
# OpenClaw Installer - Windows 打包脚本
# 构建 x86_64 NSIS (.exe) + MSI (.msi) 安装包
# 在 Windows 机器上执行：powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
# ─────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Version = (Get-Content "$ProjectRoot\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json).version
$OutputDir = "$ProjectRoot\dist-windows"

Write-Host "========================================="
Write-Host "  OpenClaw Installer - Windows Build"
Write-Host "  Version: $Version"
Write-Host "========================================="
Write-Host ""

# ── 检查依赖 ─────────────────────────────────────

# Rust
if (-not (Get-Command rustup -ErrorAction SilentlyContinue)) {
    Write-Host "[X] 未找到 rustup，请先安装 Rust: https://rustup.rs" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] rustup found" -ForegroundColor Green

# Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[X] 未找到 node，请先安装 Node.js 20+: https://nodejs.org" -ForegroundColor Red
    exit 1
}
$nodeVersion = (node -v)
Write-Host "[OK] Node.js $nodeVersion" -ForegroundColor Green

# npm
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[X] 未找到 npm" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] npm found" -ForegroundColor Green

# ── 确保 Rust target 已安装 ──────────────────────

Write-Host ""
Write-Host "> 检查 Rust target..."
rustup target add x86_64-pc-windows-msvc 2>$null

$rustVersion = (rustc --version)
Write-Host "[OK] $rustVersion" -ForegroundColor Green

# ── 安装前端依赖 ─────────────────────────────────

Write-Host ""
Write-Host "> 安装前端依赖..."
Push-Location $ProjectRoot
try {
    npm ci --prefer-offline 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  npm ci failed, falling back to npm install..." -ForegroundColor Yellow
        npm install
    }
} finally {
    Pop-Location
}
Write-Host "[OK] 前端依赖已安装" -ForegroundColor Green

# ── 构建 Windows x64 ────────────────────────────

Write-Host ""
Write-Host "========================================="
Write-Host "> 构建 Windows x64 (NSIS + MSI)..."
Write-Host "========================================="

Push-Location $ProjectRoot
try {
    npm run tauri build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[X] 构建失败" -ForegroundColor Red
        exit 1
    }
} finally {
    Pop-Location
}

# ── 收集产物 ─────────────────────────────────────

Write-Host ""
Write-Host "> 收集构建产物..."

if (Test-Path $OutputDir) {
    Remove-Item -Recurse -Force $OutputDir
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$BundleBase = "$ProjectRoot\src-tauri\target\release\bundle"
$Found = $false

# NSIS installer (.exe)
$NsisDir = "$BundleBase\nsis"
if (Test-Path $NsisDir) {
    Get-ChildItem "$NsisDir\*.exe" | ForEach-Object {
        Copy-Item $_.FullName $OutputDir
        Write-Host "  [OK] NSIS: $($_.Name)" -ForegroundColor Green
        $Found = $true
    }
}

# MSI installer
$MsiDir = "$BundleBase\msi"
if (Test-Path $MsiDir) {
    Get-ChildItem "$MsiDir\*.msi" | ForEach-Object {
        Copy-Item $_.FullName $OutputDir
        Write-Host "  [OK] MSI:  $($_.Name)" -ForegroundColor Green
        $Found = $true
    }
}

if (-not $Found) {
    Write-Host "  [!] 未找到构建产物，请检查构建日志" -ForegroundColor Yellow
}

# ── 完成 ─────────────────────────────────────────

Write-Host ""
Write-Host "========================================="
Write-Host "  构建完成！"
Write-Host "  输出目录: $OutputDir"
Write-Host "========================================="

if ($Found) {
    Get-ChildItem "$OutputDir\*" | ForEach-Object {
        $size = "{0:N1} MB" -f ($_.Length / 1MB)
        Write-Host "  $($_.Name)  ($size)"
    }
}

Write-Host ""
Write-Host "提示：NSIS (.exe) 为推荐的 Windows 安装格式" -ForegroundColor Cyan
Write-Host ""
