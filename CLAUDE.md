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
  - `src/ssh.rs` - SSH connection management (ssh2 crate)
  - `src/install.rs` - Download, extract, deploy OpenClaw
  - `src/config.rs` - Configuration read/write/hot-reload
  - `src/env_check.rs` - System environment detection
  - `src/crypto.rs` - AES-256-GCM encryption for sensitive data
  - `src/gateway.rs` - Gateway management
  - `src/cli.rs` - CLI mode support
  - `src/helpers.rs` - Utility functions
  - `src/integration.rs` - Integration helpers
  - `Cargo.toml` - Rust dependencies
  - `tauri.conf.json` - Tauri configuration
  - `capabilities/` - Permission definitions
  - `icons/` - App icons
- `src/` - React frontend
  - `main.tsx` - React entry point (minimal, only renders App shell)
  - `index.css` - TailwindCSS v4 theme + design tokens
  - `types/app.ts` - App types (InstallTarget, SSHConfig, CheckItem, WizardStep)
  - `stores/wizard-store.ts` - Wizard state (Zustand): target, SSH config, navigation
  - `pages/StartPage.tsx` - Welcome/start page
  - `pages/TargetSelectPage.tsx` - Install target selection (local / remote)
  - `pages/SSHConfigPage.tsx` - SSH connection form + connectivity test
  - `pages/SystemCheckPage.tsx` - Auto environment detection + checklist
  - `pages/InstallPage.tsx` - Installation wizard with progress
  - `pages/ControlPanel.tsx` - Main control console (start/stop/monitor)
  - `pages/ConfigPanel.tsx` - Configuration management
  - `pages/CommunicationPanel.tsx` - Communication/settings panel
  - `components/StepIndicator.tsx` - Wizard step progress bar
  - `components/WizardShell.tsx` - Page router with AnimatePresence transitions
  - `components/ErrorBoundary.tsx` - Error boundary for graceful failures
  - `components/ui/*.tsx` - shadcn/ui components (Button, Input, Select, Checkbox, AlertDialog, Label, Tooltip)
  - `lib/utils.ts` - Utility functions (cn)
  - `lib/animations.ts` - Shared Framer Motion animation presets
  - `lib/db.ts` - SQLite database operations
  - `lib/tauri.ts` - Tauri invoke wrappers
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

| Data | Storage | Notes |
|------|---------|-------|
| Server list | tauri-plugin-sql (SQLite) | Host, SSH info, deployment path |
| OpenClaw logs | Real-time via Rust command | No persistence needed |
| OpenClaw status | Real-time via Rust command | running/stopped/error |
| OpenClaw resources | Real-time via Rust command | CPU / memory |
| Sensitive data | Encrypted (AES-256-GCM) | Passwords, SSH keys |

## Frontend State

- **Zustand store** (`stores/wizard-store.ts`): Wizard flow state, target selection, SSH config
- **React Query patterns** via Tauri invoke wrappers in `lib/tauri.ts`
- **Database** via `lib/db.ts` for SQLite operations

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
- **install_openclaw** — Download, extract, and deploy OpenClaw (local or remote)
- **start_openclaw** — Start OpenClaw service (local or via SSH)
- **stop_openclaw** — Stop OpenClaw service
- **get_openclaw_status** — Get running status (running/stopped/error)
- **get_openclaw_logs** — Stream logs from OpenClaw process
- **get_config** — Read OpenClaw configuration
- **update_config** — Update configuration with SIGHUP hot-reload
- **encrypt_data / decrypt_data** — AES-256-GCM encryption for sensitive storage

### Key Implementation Details

- **SSH**: Uses `ssh2` Rust crate with vendored OpenSSL — works on fresh macOS/Windows, no `sshpass` needed
- **OpenClaw Detection**: `detect_openclaw_version()` uses interactive login shell (`-ilc`) to inherit user's full PATH (npm global bin), with `~~OC~~` markers to isolate output from shell startup noise
- **Remote Checks**: Single SSH connection runs all checks in one compound command (section markers `---TAG---`), parsed by `parse_section()`
- **No Software Checks**: Only hardware/system checks shown; software (Node.js, deps) handled automatically by installer
- **Encryption**: Sensitive data (SSH passwords, keys) encrypted via `aes-gcm` crate with PBKDF2 key derivation

## Rust Module Overview

1. **ssh.rs** - SSH connection management (connect, test, exec, SFTP with resume)
2. **install.rs** - Download, extract, deploy OpenClaw
3. **config.rs** - Read/write/hot-reload config via SIGHUP
4. **env_check.rs** - System environment detection (local + remote)
5. **crypto.rs** - AES-256-GCM encryption for passwords/keys
6. **gateway.rs** - Gateway management
7. **cli.rs** - CLI mode support for non-GUI usage
8. **helpers.rs** - Utility functions
9. **integration.rs** - Integration helpers

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
