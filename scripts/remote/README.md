# Remote Install Scripts

These are the installation scripts served from `https://openclaw.ai/`:

- **`install.sh`** — macOS / Linux installer (bash)
- **`install.ps1`** — Windows installer (PowerShell)

## How to Update

When the upstream scripts change, follow this process:

1. **Get the new version** from upstream (the OpenClaw team)
2. **Diff against local** to see what changed:
   ```bash
   # Download upstream to a temp file and compare
   curl -fsSL https://openclaw.ai/install.sh > /tmp/upstream-install.sh
   diff scripts/remote/install.sh /tmp/upstream-install.sh
   ```
3. **Re-apply our patches** to the new version. The custom patches are:

### install.sh patches (search for these markers)

| Function | What we changed | Why |
|----------|----------------|-----|
| `setup_network_mirrors()` | **New function** — probes GitHub, then mirrors; sets `NO_NETWORK` flag if both unreachable | China network + offline machines |
| `ensure_brew_on_path()` | **New function** — searches 4 known brew locations + fallback | brew not found after install |
| `install_homebrew()` | Uses `ensure_brew_on_path` + `NONINTERACTIVE=1` + runs directly (not `run_quiet_step`) + `NO_NETWORK` early exit | Original hid sudo prompt; fragile PATH check |
| `install_node_from_binary()` | **New function** — downloads Node.js prebuilt binary from npmmirror CDN, extracts to `~/.local/node`, verifies SHA256, no sudo needed | Bypass Homebrew/admin requirement entirely |
| `install_node()` | Tries `install_node_from_binary` first, Homebrew as fallback on macOS; same for Linux (binary first, NodeSource fallback) | No sudo/Homebrew needed if binary download works |
| `is_gum_raw_mode_failure()` | Match `ioctl\|inappropriate` in addition to `setrawmode` | gum spinner failed silently on macOS SSH/remote sessions |
| `ensure_openclaw_bin_link()` | `chmod +x` on `entry.js` and the symlink after creating bin link | Symlink not executable → `resolve_openclaw_bin` `-x` check failed |
| `install_openclaw()` | Call `ensure_openclaw_bin_link` **before** `resolve_openclaw_bin` check; avoid unnecessary cleanup+retry | Previously deleted successful install just because bin link was missing |
| `resolve_openclaw_bin()` | Added `~/.local/bin/openclaw` as fallback check location | Finds compat shim created by `install_openclaw_compat_shim` |
| `main()` | Calls `setup_network_mirrors` after `detect_os_or_die`; removed separate `install_homebrew` (now inside `install_node`); added `NO_NETWORK` check before npm/git install | Mirror auto-detection + don't require Homebrew/admin when Node already exists + offline handling |

### install.ps1 patches

| Location | What we changed | Why |
|----------|----------------|-----|
| Top-level (after PS version check) | TLS 1.2+ enforcement | Secure downloads |
| `$script:NoNetwork` variable | **New** — tracks total network absence | Offline machine support |
| `Setup-NetworkMirrors` function | **New** — probes npmjs.org, then npmmirror; sets `$NoNetwork` if both unreachable | China network + offline machines |
| `Main` function | Calls `Setup-NetworkMirrors` before Node check; added `$NoNetwork` guards before Install-Node and Install-OpenClaw | Mirror auto-detection + offline handling |

### lib.rs patches (Tauri backend)

The `lib.rs` changes inject environment variables **before** these scripts run, providing a second layer of defense:

- `HOMEBREW_*` mirror env vars (TUNA)
- `npm_config_registry` (npmmirror)
- `HOMEBREW_NO_AUTO_UPDATE=1`
- `NONINTERACTIVE=1`
- PATH pre-seeded with `/opt/homebrew/bin`, `/usr/local/bin`, etc.
- stderr now captured (was `Stdio::null()`)
