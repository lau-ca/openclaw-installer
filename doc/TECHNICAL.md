# OpenClaw 一键部署工具 - 技术方案文档

## 1. 技术选型

### 1.1 整体架构

**架构说明**：部署工具本身（Tauri GUI）仅运行在 macOS / Windows 上，通过 SSH 协议连接远程 Linux 服务器执行部署。Linux 不需要安装任何客户端。

系统采用三层架构设计：

**用户界面层 (GUI)**
- 技术选型：React + TypeScript + TailwindCSS v4 + shadcn/ui
- 职责：提供跨平台的可视化用户界面（系统 WebView 渲染）

**应用框架层 (Runtime)**
- 技术选型：Tauri 2.0（Rust 后端 + 系统 WebView 前端）
- 职责：Rust commands + 前端 invoke 调用 + 权限管理

**核心逻辑层 (Core) — Rust**
- 系统检测模块（`sysinfo` crate）
- SSH 连接管理模块（`russh` crate）
- 安装管理模块（下载 + 解压 + 部署）
- 进程管理模块（`tokio::process`）
- 配置管理模块（`serde` + 文件系统）
- Skills 管理模块

### 1.2 技术栈对比与选择

| 方案 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| **Tauri 2.0 + Rust** | 体积极小（~10MB）、性能好、内存安全、权限模型 | Rust 学习曲线 | ✅ 选择 |
| Electron + React | 跨平台成熟、生态丰富 | 体积大（~200MB）、内存占用高 | 不选 |
| Qt + Python | 性能好、原生体验 | 打包复杂、Python 依赖 | 不选 |
| Flutter Desktop | Google 支持、UI 美观 | 桌面端生态待成熟 | 不选 |

### 1.3 Tauri 2.0 跨平台兼容性

| 平台 | 架构 | WebView | 支持情况 |
|------|------|------|------|
| macOS 11.0+ | Apple Silicon arm64 | WebKit (WKWebView) | ✅ 原生支持 |
| Windows 10+ | x64 | WebView2 (Chromium) | ✅ 原生支持 |
| Windows 10+ | ARM64 | WebView2 (Chromium) | ✅ 原生支持 |

### 1.4 最终技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 应用框架 | Tauri | 2.x | 轻量、安全、Rust 后端 |
| 后端语言 | Rust | 1.92+ | 内存安全、零成本抽象 |
| 前端框架 | React | 19.x | 最新稳定版 |
| 前端语言 | TypeScript | 5.x | 类型安全 |
| UI 组件库 | shadcn/ui + TailwindCSS v4 | 最新 | Raycast 风格深色主题 + Inter 字体 |
| 动画 | Framer Motion | 最新 | 页面过渡、卡片交互、弹簧动画 |
| 图标 | Lucide React | 最新 | 线性图标库 |
| 构建工具 | Vite | 7.x | 极速 HMR |
| 状态管理 | Zustand | 5.x | 轻量状态管理 |
| 结构化数据 | tauri-plugin-sql (SQLite) | 2.x | 服务端列表（Host、SSH、部署路径） |
| SSH 客户端 | russh（计划） | latest | Rust 原生 SSH/SFTP |
| 系统信息 | sysinfo（计划） | latest | 跨平台系统信息采集 |

---

## 2. 项目结构

**src-tauri/** - Tauri Rust 后端
- src/lib.rs：Rust commands + 应用配置
- src/main.rs：应用入口
- Cargo.toml：Rust 依赖
- tauri.conf.json：Tauri 配置（窗口、权限、打包）
- capabilities/：权限定义
- icons/：应用图标

**src/** - React 前端
- main.tsx：React 入口（最小化 App shell）
- index.css：TailwindCSS v4 主题 + 设计 Token
- types/app.ts：类型定义（InstallTarget、SSHConfig、CheckItem、WizardStep）
- stores/wizard-store.ts：向导状态（target、SSH config、navigation）
- pages/TargetSelectPage.tsx：安装目标选择页
- pages/SSHConfigPage.tsx：SSH 连接配置 + 连通性测试
- pages/SystemCheckPage.tsx：环境自动检测 + 结果展示
- components/StepIndicator.tsx：向导步骤进度条
- components/WizardShell.tsx：页面路由 + AnimatePresence 过渡
- components/PlaceholderPage.tsx：未实现页面占位
- components/ui/button.tsx、input.tsx：shadcn/ui 基础组件
- lib/utils.ts：工具函数（cn 样式合并）
- lib/animations.ts：共享 Framer Motion 动画预设

**index.html** - 前端 HTML 入口

**doc/** - 文档（需求、技术方案）

---

## 3. 模块详细设计

### 3.1 SSH 连接管理模块（已实现）

**职责**：统一管理到远程 Linux 服务器的 SSH 连接，供其他模块复用

**技术方案**：Tauri Rust 原生执行系统命令行调用 (暂未确定全平台打包方式)，或者考虑后续接入原生 ssh2/russh crate 封装通信，保证安全和轻量。

**核心函数**（定义在 `src-tauri/src/lib.rs`）：
- `create_ssh_session(host, port, username, auth_method, password, key_path)` → `Result<Session>`
  - TCP 连接 + SSH 握手 + 认证（密码 / 密钥文件）
  - 超时 15s，支持 `~` 路径展开
- `ssh_exec(session, cmd)` → `Result<String>` — 在会话上执行命令并返回 stdout
- `expand_tilde(path)` — 展开 `~` 为用户 home 目录

**Tauri Commands**：
- `test_ssh_connection(...)` — 建立 SSH 会话 + 执行 `echo __SSH_OK__` 验证
- `check_remote_environment(...)` — 单次 SSH 会话执行 compound 命令检测远程环境

**安全说明**：
- 私钥路径和密码通过加密存储（见 8.2 节），不明文落盘
- SSH 会话按需创建，检测完成后自动释放
- SSH 句柄仅在 Rust 后端持有，前端不可直接访问

---

### 3.2 SFTP 大文件上传（断点续传实现）

**方案**：ssh2 的 SFTP 不原生支持断点续传，采用以下方式自行实现：

1. 上传前在本地记录传输状态（文件路径、已传字节数、文件总大小、远端临时路径）
2. 上传时以追加模式（`flags: 'a'`）打开远端文件，从断点偏移处继续写入
3. 上传完成后校验远端文件 MD5 与本地一致，通过后重命名为最终路径
4. 失败时保留远端临时文件，下次重试直接续传

**进度显示**：每 512KB 触发一次进度回调，通过 IPC 推送到渲染进程更新进度条

---

### 3.3 系统检测模块 (System Check)

**本机检测项**：
- 操作系统版本（macOS / Windows）
- 磁盘空间（≥ 500MB）
- 网络连通性
- 写入 / 执行权限
- 已有安装版本冲突

**远程 Linux 检测项**（通过 SSH exec 执行）：
- SSH 连通性验证
- 远端 OS 版本（`cat /etc/os-release`）
- 远端磁盘空间（`df -h <安装目录>`）
- sudo 可用性（`sudo -n true`，无交互检测）

---

### 3.4 安装管理模块 (Installer)

**本机安装流程**：
下载（断点续传）→ 校验哈希 → 解压 → 安装 → 创建快捷方式

**远程 Linux 部署流程**：
下载到本机临时目录 → 校验哈希 → SFTP 上传（断点续传）→ SSH 执行解压 → SSH 执行安装脚本 → 注册 systemd service → 验证服务状态

**远端 Linux 快捷方式**：不创建桌面快捷方式，服务注册为 systemd 开机自启即可

---

### 3.5 远程进程管理方案（已确定）

**运行方式：systemd service 为主，nohup 为降级方案**

| 场景 | 方案 |
|------|------|
| 远端有 systemd（Ubuntu 20.04+ / Debian 11+ / CentOS 7+） | 注册为 systemd service，通过 `systemctl start/stop/status` 管理 |
| 远端无 systemd（极少见） | 使用 `nohup openclaw > /var/log/openclaw.log 2>&1 &` 启动，PID 文件跟踪 |

**systemd service 模板**（随安装包内置，部署时写入远端）：

```ini
[Unit]
Description=OpenClaw Service
After=network.target

[Service]
Type=simple
User={{USER}}
WorkingDirectory={{INSTALL_DIR}}
ExecStart={{INSTALL_DIR}}/openclaw
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**进程管理方法**（远程，均通过 SSH exec）：
- 启动：`sudo systemctl start openclaw`
- 停止：`sudo systemctl stop openclaw`
- 重启：`sudo systemctl restart openclaw`
- 状态：`sudo systemctl is-active openclaw`
- 开机自启：`sudo systemctl enable openclaw`
- 日志：`journalctl -u openclaw -f --lines=100`（实时流式输出）

---

### 3.6 配置管理模块 (Config Manager)

**热重载机制（已明确）**：

| 场景 | 热重载方式 |
|------|------|
| 本机 | 写入配置文件 → 发送 `SIGHUP` 信号给 OpenClaw 进程（`process.kill(pid, 'SIGHUP')`） |
| 远程 | SSH 写入配置文件 → SSH exec 发送 `kill -HUP <pid>` 或 `systemctl reload openclaw` |

**核心方法**：获取配置、更新配置、重置为默认、导出配置、导入配置、获取历史记录、回滚配置

---

### 3.7 远程监控方案（已明确）

**方案：SSH 定期轮询，间隔 3 秒**

> 不引入 Agent（Prometheus Node Exporter 等），避免远端依赖复杂化。3 秒间隔在已有 SSH 长连接的情况下开销可接受。

**采集方式**（单次 SSH 请求 / 本地 Sysinfo）：

```bash
echo "CPU:$(top -bn1 | grep 'Cpu(s)' | awk '{print $2}') \
MEM:$(free -m | awk 'NR==2{print $3"/"$2}') \
NET:$(cat /proc/net/dev | grep eth0)"
```

---

### 3.8 Skills 管理模块

**Skill 对象**包含：ID、名称、描述、版本、启用状态、运行状态、配置、依赖列表

**核心方法**：
- 获取 Skills 列表
- 启用 / 禁用 Skill（通过 SIGHUP 热重载，即时生效）
- 安装 / 卸载 Skill
- 更新 Skill 配置（保存后 SIGHUP 即时生效）
- 获取可用 Skills（远程市场）

---

## 4. IPC 通信设计

### 4.1 通道命名规范

- 主进程到渲染进程：`channel:result`
- 渲染进程到主进程：`channel:action`

### 4.2 IPC 通道列表

**SSH 连接**：`ssh:connect` / `ssh:disconnect` / `ssh:test` / `ssh:status`

**系统检测**：`system:check` / `system:check:result`

**安装**：`install:start` / `install:progress` / `install:complete` / `install:error`

**进程控制**：`process:start` / `process:stop` / `process:restart` / `process:status` / `process:logs`

**配置**：`config:get` / `config:update` / `config:reset` / `config:export` / `config:import`

**Skills**：`skills:list` / `skills:enable` / `skills:disable` / `skills:config`

**监控**：`monitor:start` / `monitor:stop` / `monitor:data`

---

## 5. UI 组件设计

### 5.1 设计 Token

**主题**：白色/浅色主题为默认，支持 `.dark` 类切换深色模式

**字体**：Inter（Google Fonts），降级链：-apple-system, BlinkMacSystemFont, Segoe UI, Roboto

**颜色**：

| 用途 | 值（Light） |
|------|------|
| 主色 | hsl(220 91% 54%) |
| 成功 | hsl(142 71% 45%) |
| 警告 | hsl(38 92% 50%) |
| 错误 | hsl(0 84% 60%) |
| 背景 | #ffffff |
| 前景 | hsl(224 71% 4%) |
| 边框 | hsl(220 13% 91%) |
| 次要文字 | hsl(220 9% 46%) |

**字号**：

| 级别 | 大小 | 用途 |
|------|------|------|
| 11px | font-semibold | 步骤指示器序号 |
| 13px | font-medium | 步骤标签、特性列表、辅助文字 |
| 14px | normal | 占位页描述 |
| 15px | normal | 页面副标题 |
| 16px (base) | font-semibold | 卡片标题 |
| 18px (lg) | font-semibold | 占位页标题 |
| 22px | font-semibold tracking-tight | 页面主标题 |

**间距**：基础单位 4px，常用值 8 / 12 / 16 / 24 / 32 / 48px

**圆角**：卡片 12px、按钮 8px、输入框 6px、标签 4px

**阴影**：卡片 `0 1px 3px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.2)`

### 5.2 核心组件

| 组件 | 说明 |
|------|------|
| Wizard | 向导容器，管理步骤流程 |
| Step | 向导步骤页面 |
| TargetSelector | 安装目标选择（本机 / 远程 Linux） |
| SSHConfigForm | SSH 连接信息填写表单（地址、端口、用户名、密码/私钥） |
| StatusCard | 状态显示卡片 |
| MetricGauge | 仪表盘组件（CPU / 内存） |
| LogViewer | 日志查看器（支持实时流、筛选、导出） |
| ConfigForm | 配置表单 |
| SkillCard | Skill 卡片 |
| ProgressBar | 进度条（支持分阶段标注） |

---

## 6. 打包与分发

### 6.1 Tauri CLI 配置要点 (`tauri.conf.json`)

macOS：
- 目标格式：dmg、app
- 架构：`universal` (支持 Apple Silicon & Intel)
- 配置了代码签名标识 (`identity`)

Windows：
- 目标格式：nsis、msi
- 架构：x64、arm64
- 需配置代码签名时间戳以确保长期有效

### 6.2 代码签名流程

**macOS**：Apple 开发者证书 (`Developer ID Application`) -> XCode `codesign` -> `notarytool` 提交 Apple 服务器公证 -> 成功后自动 `staple` 票据

**Windows**：准备 Authenticode PFX 证书及密码 -> `tauri build` 时注入签名环境变量 -> 自动使用 `signtool` 附加时间戳签名

---

## 7. 自动更新

采用 `tauri-plugin-updater` 插件实现：
- 启动时校验 `Tauri.toml` 中配置的 endpoints (e.g. GitHub Releases)
- 下载进度可以通过 Tauri RPC 通知到 React 前端组件中展示
- 下载完成后通过对话框询问用户是否立刻重启安装

---

## 8. 安全设计

### 8.1 依赖安全

| 依赖 | 安全说明 |
|------|----------|
| Tauri 2.0 | 已内置 CSP 和严格的本地通讯协议隔离 |
| Vite 6.x | 使用现代前端生态防范构建期风险 |
| ssh2 (Rust/russh) | Rust 原生实现，避免 Node.js `ssh2` 原生绑定库的内存溢出或 c-bindings 漏洞 |

### 8.2 敏感数据加密

- 算法：AES-256-GCM （可以通过 Tauri plugin store / stronghold 实现）
- 密钥管理：macOS Keychain / Windows DPAPI (via tauri-plugin-stronghold)
- 存储内容：API Key、密码、SSH 私钥路径及密码

### 8.3 持续安全维护

- `cargo audit` 检查 Rust 侧依赖漏洞
- `npm audit` 检查前端侧漏洞
- 定期更新 Tauri 核心库版本

### 8.4 权限模型最小化 (Capabilities)

- 前端严禁直接访问文件系统与执行 Shell 命令。
- 所有系统调用通过 Tauri 的 Capabilities (如 `tauri-plugin-fs`, `tauri-plugin-shell`) 精确声明。
- 在 `src-tauri/capabilities/` 中仅开放必须要用到的方法，白名单控制。
- SSH 连通和安装完全在 Rust 后端侧通过独立封装 Command 提供，避免前端注入。

---

## 9. 开发计划

### 9.1 阶段划分

| 阶段 | 内容 | 工期 |
|------|------|------|
| Phase 1 | 项目搭建、基础框架、安装目标选择 | 3 天 | ✅ 已完成 |
| Phase 2 | SSH 连接管理模块（含断点续传、重连、超时） | 3 天 |
| Phase 3 | 系统检测模块（本机 + 远程） | 2 天 |
| Phase 4 | 安装向导（本机 + 远程部署 + systemd 注册） | 4 天 |
| Phase 5 | 主控制台 + 监控（本机 + 远程轮询） | 3 天 |
| Phase 6 | 配置管理（含 SIGHUP 热重载） | 2 天 |
| Phase 7 | Skills 管理 | 3 天 |
| Phase 8 | 错误处理 & 边界场景（网络中断、SSH 断连、安装失败回滚） | 3 天 |
| Phase 9 | 打包、签名、测试 | 3 天 |
| **合计** | | **26 天** |  |

### 9.2 里程碑

Week 1：项目搭建 + SSH 模块 POC + 系统检测 + 安装向导原型
Week 2：主控制台 + 监控 + 配置管理 + Skills 管理
Week 3（+ 1 天缓冲）：错误处理 & 边界场景 + 打包签名 + 集成测试发布

---

## 10. 风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| OpenClaw 无稳定 API | 高 | 提前沟通接口规范，预留适配层 |
| macOS 公证失败 | 中 | 提前申请开发者账号，预留公证时间 |
| Windows 杀软误报 | 中 | 提前签名，添加白名单申请 |
| SSH 连接不稳定 | 中 | 断线自动重连、操作超时提示、关键步骤幂等设计 |
| 远端 Linux 无 systemd | 低 | nohup + PID 文件降级方案已内置 |
| SFTP 大文件上传失败 | 低 | 断点续传 + MD5 校验，失败保留临时文件可续传 |
| 跨平台兼容问题 | 中 | 多平台真机测试，CI 自动化 |

---

## 11. 依赖清单

**Rust 后端依赖**：

| 依赖 | 版本 | 说明 |
|------|------|------|
| tauri | ^2.0.0 | 应用框架核心 |
| tauri-build | ^2.0.0 | 构建工具集成 |
| tauri-plugin-dialog | ^2.0.0 | 原生对话框支持 |
| tauri-plugin-sql | ^2.0.0 | SQLite 数据库访问 |

**前端运行时依赖**：

| 依赖 | 版本 | 说明 |
|------|------|------|
| react、react-dom | ^19.1.0 | UI 框架 |
| zustand | ^5.0.0 | 状态管理 |
| lucide-react | ^0.577.0 | 图标库 |
| framer-motion | ^12.0.0 | 动画库 |
| clsx、tailwind-merge | 最新 | 样式合并工具 |

**前端构建依赖**：

| 依赖 | 版本 | 说明 |
|------|------|------|
| typescript | ~5.8.0 | 类型系统 |
| vite | ^7.0.0 | Vite 构建工具 |
| tailwindcss、@tailwindcss/vite | ^4.2.0 | Tailwind v4 原子类及插件 |
| @tauri-apps/cli | ^2.0.0 | Tauri CLI |

---

## 12. 下一步

1. **制作 UI 原型**：重点确认安装目标选择页、SSH 配置表单、远程部署进度页
2. **SSH 模块 POC**：验证 ssh2 断点续传、systemd service 注册、SIGHUP 热重载流程
3. **项目初始化**：搭建开发环境

---

*文档版本：v1.3*
*创建日期：2026-03-10*