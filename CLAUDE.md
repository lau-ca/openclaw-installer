# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenClaw Installer - A cross-platform (macOS / Windows) one-click deployment tool for the OpenClaw GUI application. Built with Tauri 2.0 + React + TypeScript.

**Deployment Targets:**
- **Local** - Install directly on the machine running the installer (macOS / Windows)
- **Remote** - Deploy to a remote Linux server via SSH (no client installation required on Linux)

## Architecture

**Three-layer architecture:**
1. **GUI Layer** - React + TypeScript + TailwindCSS v4 + shadcn/ui + Framer Motion + Lucide React
2. **Runtime Layer** - Tauri 2.0 (Rust backend + system WebView frontend)
3. **Core Layer** - Rust modules (planned: SSH, system check, installer, config, process manager)

**Project Structure:**
- `src-tauri/` - Tauri Rust backend
  - `src/lib.rs` - Rust commands and app setup
  - `src/main.rs` - Application entry point
  - `Cargo.toml` - Rust dependencies
  - `tauri.conf.json` - Tauri configuration
  - `capabilities/` - Permission definitions
  - `icons/` - App icons
- `src/` - React frontend
  - `main.tsx` - React entry point (minimal, only renders App shell)
  - `index.css` - TailwindCSS v4 theme + design tokens
  - `types/app.ts` - App types (InstallTarget, SSHConfig, CheckItem, WizardStep)
  - `stores/wizard-store.ts` - Wizard state (Zustand): target, SSH config, navigation
  - `pages/TargetSelectPage.tsx` - Install target selection (local / remote)
  - `pages/SSHConfigPage.tsx` - SSH connection form + connectivity test
  - `pages/SystemCheckPage.tsx` - Auto environment detection + checklist
  - `components/StepIndicator.tsx` - Wizard step progress bar
  - `components/WizardShell.tsx` - Page router with AnimatePresence transitions
  - `components/PlaceholderPage.tsx` - Placeholder for unimplemented pages
  - `components/ui/button.tsx` - shadcn/ui Button
  - `components/ui/input.tsx` - shadcn/ui Input
  - `lib/utils.ts` - Utility functions (cn)
  - `lib/animations.ts` - Shared Framer Motion animation presets
- `index.html` - Frontend HTML entry
- `doc/` - Documentation

## Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Framework | Tauri | 2.x |
| Backend | Rust | 1.92+ |
| Frontend | React | 19.x |
| Language | TypeScript | 5.x |
| Build | Vite | 7.x |
| UI | shadcn/ui + TailwindCSS v4 + Inter font | latest |
| Animation | Framer Motion | latest |
| Icons | Lucide React | latest |
| State | Zustand | 5.x |
| Structured Data | tauri-plugin-sql (SQLite) | 2.x |

## Common Commands

```bash
# Install dependencies
npm install

# Development (starts Vite + Tauri together)
npm run tauri dev

# Build
npm run build              # Build frontend only
npm run tauri build        # Build full app (frontend + Rust)

# Frontend only (browser dev)
npm run dev                # Vite dev server at http://localhost:1420
```

## Tauri Command Pattern

Frontend calls Rust via `@tauri-apps/api`:
```typescript
import { invoke } from "@tauri-apps/api/core";
const platform = await invoke<string>("get_platform");
```

Rust commands defined in `src-tauri/src/lib.rs`:
```rust
get_platform()                  // → String (os name)
test_ssh_connection(...)         // → Result<String, String>
check_local_environment()       // → Result<Vec<CheckResult>, String>
check_remote_environment(...)   // → Result<Vec<CheckResult>, String>
```

## Data Approach

| 数据 | 方式 | 说明 |
|------|------|------|
| 服务器列表 | tauri-plugin-sql (SQLite) | Host、SSH 信息、部署路径 |
| OpenClaw 日志 | 实时读取 (Rust command) | 无需持久化 |
| OpenClaw 状态 | 实时读取 (Rust command) | 运行/停止/错误 |
| OpenClaw 资源占用 | 实时读取 (Rust command) | CPU / 内存 |

## UI Design

- **Theme**: Raycast-style dark (#0a0a0a background, glassmorphism cards, blue glow accents)
- **Font**: Inter (Google Fonts)
- **Animations**: Framer Motion — shared presets in `lib/animations.ts`
- **Icons**: Lucide React
- **Components**: shadcn/ui (Button) with custom dark theme tokens

## Implemented Rust Commands

- **test_ssh_connection** — Native SSH connectivity test via `ssh2` crate (password + key auth, no external tools)
- **check_local_environment** — Hardware checks: OS, arch, disk ≥500MB, network (openclaw.ai), OpenClaw status
- **check_remote_environment** — Same checks via single SSH session compound command with section markers

### Key Implementation Details

- **SSH**: Uses `ssh2` Rust crate with vendored OpenSSL — works on fresh macOS/Windows, no `sshpass` needed
- **OpenClaw Detection**: `detect_openclaw_version()` uses interactive login shell (`-ilc`) to inherit user's full PATH (npm global bin), with `~~OC~~` markers to isolate output from shell startup noise
- **Remote Checks**: Single SSH connection runs all checks in one compound command (section markers `---TAG---`), parsed by `parse_section()`
- **No Software Checks**: Only hardware/system checks shown; software (Node.js, deps) handled automatically by installer

## Planned Rust Modules

1. **Installer** - Download, extract, deploy OpenClaw
2. **Process Manager** - Start/stop OpenClaw
3. **Config Manager** - Read/write/hot-reload config
4. **Skills Manager** - Plugin management

## Security

- Rust backend: memory-safe, no GC
- Tauri permissions model (capabilities/default.json)
- Sensitive data encrypted via Rust crypto crates
- Code signing required for distribution

## Documentation

- `doc/REQUIREMENTS.md` - Functional and non-functional requirements
- `doc/TECHNICAL.md` - Detailed technical design and specifications
- `doc/README.md` - Project README

## Target Platforms

**Installer runs on:**
- macOS 11.0+ (Apple Silicon M1/M2/M3 only)
- Windows 10+ (x64 + ARM64)

**OpenClaw deployment targets:**
- Local: macOS (Apple Silicon), Windows (x64 / ARM64)
- Remote: Linux (Ubuntu 20.04+ / Debian 11+ / CentOS 7+, x64 / ARM64)
