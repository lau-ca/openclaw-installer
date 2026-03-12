# OpenClaw Installer

OpenClaw 一键部署工具 - 跨平台（macOS / Windows）OpenClaw GUI 应用程序部署工具

基于 **Tauri 2.0** + **React** + **Rust** 构建，轻量、高性能、安全。

## 功能特性

- **本机安装** - 一键安装 OpenClaw 到当前电脑
- **远程部署** - 通过 SSH 部署到远程 Linux 服务器
- **可视化配置** - 图形化配置管理，支持热重载
- **实时监控** - CPU、内存、网络使用率监控
- **Skills 管理** - 插件安装、启用、禁用、配置

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 应用框架 | Tauri | 2.x |
| 后端 | Rust | 1.92+ |
| 前端框架 | React | 19.x |
| 语言 | TypeScript | 5.x |
| 构建工具 | Vite | 7.x |
| UI 组件 | shadcn/ui + TailwindCSS v4 + Inter 字体 | latest |
| 动画 | Framer Motion | latest |
| 图标 | Lucide React | latest |
| 状态管理 | Zustand | 5.x |
| 结构化数据 | tauri-plugin-sql (SQLite) | 2.x |

## 数据方案

| 数据 | 方式 | 说明 |
|------|------|------|
| 服务器列表 | SQLite | Host、SSH 信息、部署路径 |
| OpenClaw 日志 | 实时读取 | 通过 Rust command 实时获取 |
| OpenClaw 状态 | 实时读取 | 运行/停止/错误 |
| OpenClaw 资源占用 | 实时读取 | CPU / 内存 |

## 系统要求

**部署工具运行环境：**
- macOS 11.0+ (Apple Silicon M1/M2/M3)
- Windows 10+ (x64 / ARM64)
- Rust 1.75+（开发环境）

**OpenClaw 安装目标：**
- 本机：macOS (Apple Silicon), Windows (x64 / ARM64)
- 远程：Linux (Ubuntu 20.04+ / Debian 11+ / CentOS 7+)

## 快速开始

```bash
# 安装前端依赖
npm install

# 开发模式（Vite + Tauri 一起启动）
npm run tauri dev

# 仅前端开发（浏览器）
npm run dev            # http://localhost:1420

# 构建完整应用
npm run tauri build
```

## 项目结构

```
openclaw-installer/
├── index.html              # 前端 HTML 入口
├── src-tauri/              # Tauri Rust 后端
│   ├── src/
│   │   ├── lib.rs          # Rust commands + 应用配置
│   │   └── main.rs         # 应用入口
│   ├── Cargo.toml          # Rust 依赖
│   ├── tauri.conf.json     # Tauri 配置
│   ├── capabilities/       # 权限定义
│   └── icons/              # 应用图标
├── src/                    # React 前端
│   ├── main.tsx            # React 入口（最小化 App shell）
│   ├── index.css           # TailwindCSS v4 主题 + 设计 Token
│   ├── pages/
│   │   ├── TargetSelectPage.tsx  # 安装目标选择页
│   │   ├── SSHConfigPage.tsx     # SSH 连接配置 + 连通性测试
│   │   └── SystemCheckPage.tsx   # 环境自动检测 + 结果展示
│   ├── stores/
│   │   └── wizard-store.ts # 向导状态（target, SSH config, navigation）
│   ├── types/
│   │   └── app.ts          # 类型定义（InstallTarget, SSHConfig, CheckItem）
│   ├── components/         # UI 组件
│   │   ├── StepIndicator.tsx  # 向导步骤进度条
│   │   ├── WizardShell.tsx    # 页面路由 + 动画过渡
│   │   ├── PlaceholderPage.tsx# 未实现页面占位
│   │   └── ui/               # shadcn/ui 基础组件
│   │       ├── button.tsx
│   │       └── input.tsx
│   └── lib/
│       ├── utils.ts        # 工具函数（cn）
│       └── animations.ts   # 共享 Framer Motion 动画预设
├── doc/                    # 文档
├── vite.config.ts          # Vite 配置
├── tsconfig.json           # TypeScript 配置
└── package.json            # 前端依赖
```

## 文档

- [需求文档](REQUIREMENTS.md)
- [技术文档](TECHNICAL.md)

## License

MIT
