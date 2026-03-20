import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { fadeIn } from "@/lib/animations";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getResources, type ResourceWithId } from "@/lib/db";
import { useWizardStore } from "@/stores/wizard-store";
import { WizardStep } from "@/types/app";
import ConfigPanel, { checkConfigStatus, type ConfigStatus } from "@/pages/ConfigPanel";
import ControlPanel from "@/pages/ControlPanel";
import CommunicationPanel from "@/pages/CommunicationPanel";
import { Toast } from "@/components/ui/alert-dialog";
import {
  Play,
  Puzzle,
  Settings,
  MessageCircle,
  Construction,
  Server,
  Monitor,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  LayoutDashboard,
  RefreshCw,
} from "lucide-react";

interface NavItem {
  id: string;
  label: string;
  icon: typeof Play;
}

const navItems: NavItem[] = [
  { id: "dashboard", label: "控制台", icon: Play },
  { id: "skills", label: "技能", icon: Puzzle },
  { id: "communication", label: "通讯", icon: MessageCircle },
  { id: "config", label: "配置", icon: Settings },
];

export default function StartPage() {
  const { goToStep } = useWizardStore();
  const [activeNav, setActiveNav] = useState("dashboard");
  const [resource, setResource] = useState<ResourceWithId | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastKind, setToastKind] = useState<"success" | "error">("success");
  const [daemonRuntime, setDaemonRuntime] = useState<"running" | "stopped" | "unknown">("unknown");
  const [daemonInfo, setDaemonInfo] = useState<{
    dashboard?: string;
    service?: string;
    gateway?: string;
    listening?: string;
    logFile?: string;
  }>({});
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [httpsOriginUrl, setHttpsOriginUrl] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<ConfigStatus>({
    loaded: false, hasProvider: false, hasModel: false, isComplete: false,
  });

  // 必填未完成时仅显示配置菜单
  const visibleNavItems = configStatus.isComplete ? navItems : navItems.filter((n) => n.id === "config");
  const activeItem = visibleNavItems.find((n) => n.id === activeNav);

  // 当前选中的菜单不在可见列表中时，强制切到 config
  useEffect(() => {
    if (configStatus.loaded && !visibleNavItems.some((n) => n.id === activeNav)) {
      setActiveNav("config");
    }
  }, [configStatus.loaded, configStatus.isComplete, activeNav]);

  // 加载当前资源
  useEffect(() => {
    (async () => {
      try {
        const resources = await getResources();
        if (resources.length === 0) {
          goToStep(WizardStep.TARGET_SELECT);
          return;
        }
        setResource(resources[0]);
      } catch (err) {
        console.error("加载资源失败:", err);
        goToStep(WizardStep.TARGET_SELECT);
      }
    })();
  }, []);

  const [refreshing, setRefreshing] = useState(false);

  // 获取 daemon 信息
  const fetchDaemonInfo = useCallback(async (showSpinner = false) => {
    if (!resource) return;
    if (showSpinner) setRefreshing(true);
    try {
      const raw = await invoke<string>("get_daemon_info", {
        target: resource.type,
        host: resource.host ?? null,
        port: resource.port ?? null,
        username: resource.username ?? null,
        password: resource.password ?? null,
      });
      const info = JSON.parse(raw);
      if (info.runtime === "running" || info.runtime === "stopped") {
        setDaemonRuntime(info.runtime);
      } else {
        setDaemonRuntime("unknown");
      }
      if (info.configPath) {
        setConfigPath(info.configPath);
      }
      setDaemonInfo({
        dashboard: info.dashboard || undefined,
        service: info.service || undefined,
        gateway: info.gateway || undefined,
        listening: info.listening || undefined,
        logFile: info.logFile || undefined,
      });
    } catch { /* daemon 信息获取失败不影响使用 */ }
    if (showSpinner) setRefreshing(false);
  }, [resource]);

  // 资源加载后立即获取 + 20秒自动刷新
  useEffect(() => {
    if (!resource) return;
    fetchDaemonInfo();
    const timer = setInterval(() => fetchDaemonInfo(), 20_000);
    return () => clearInterval(timer);
  }, [resource, fetchDaemonInfo]);

  // 页面加载时检查基础配置
  useEffect(() => {
    if (!resource) return;
    invoke<string>("read_openclaw_config", {
      target: resource.type,
      host: resource.host ?? null,
      port: resource.port ?? null,
      username: resource.username ?? null,
      password: resource.password ?? null,
      config_path: configPath ?? undefined,
    })
      .then((raw) => {
        try {
          const parsed = JSON.parse(raw);
          setConfigStatus(checkConfigStatus(parsed));
          // 提取 auth token 用于 Dashboard 链接
          const token = parsed?.gateway?.auth?.token;
          if (token && typeof token === "string") {
            setAuthToken(token);
          }
          // 从 allowedOrigins 提取 HTTPS 源，用于仪表盘跳转
          const origins: string[] = parsed?.gateway?.controlUi?.allowedOrigins || [];
          const httpsOrigin = origins.find((o: string) => o.startsWith("https://"));
          if (httpsOrigin) {
            const basePath = parsed?.gateway?.controlUi?.basePath || "/openclaw";
            setHttpsOriginUrl(`${httpsOrigin}${basePath}/`);
          }
        } catch {
          setConfigStatus({ loaded: true, hasProvider: false, hasModel: false, isComplete: false });
        }
      })
      .catch(() => {
        setConfigStatus({ loaded: true, hasProvider: false, hasModel: false, isComplete: false });
      });
  }, [resource, configPath]);

  // 获取 openclaw 版本（失败则退回安装引导页）
  useEffect(() => {
    if (!resource) return;
    setVersionLoading(true);
    setVersion(null);
    invoke<string>("get_openclaw_version", {
      target: resource.type,
      host: resource.host ?? null,
      port: resource.port ?? null,
      username: resource.username ?? null,
      password: resource.password ?? null,
    })
      .then((v) => {
        const trimmed = v.trim();
        if (!trimmed || trimmed === "未知") {
          // 版本检测失败，OpenClaw 未安装或不可用，退回安装引导
          goToStep(WizardStep.TARGET_SELECT);
        } else {
          setVersion(trimmed);
        }
      })
      .catch(() => {
        // 版本检测失败，退回安装引导
        goToStep(WizardStep.TARGET_SELECT);
      })
      .finally(() => setVersionLoading(false));
  }, [resource]);

  // 版本加载成功后检查更新
  useEffect(() => {
    if (!resource || !version) return;
    setUpdateChecking(true);
    invoke<string>("check_openclaw_update", {
      target: resource.type,
      host: resource.host ?? null,
      port: resource.port ?? null,
      username: resource.username ?? null,
      password: resource.password ?? null,
    })
      .then((raw) => {
        // 去除 ANSI 转义码
        const clean = raw.replace(/\x1b\[[0-9;]*m/g, "");
        const lower = clean.toLowerCase();
        if (lower.includes("update") && lower.includes("available")) {
          setUpdateAvailable(true);
          // 提取版本号：匹配 "20xx.x.x" 格式（openclaw 版本格式）
          const vMatch = clean.match(/(\d{4}\.\d+\.\d+)/);
          if (vMatch) {
            setLatestVersion(vMatch[1]);
          }
        }
      })
      .catch(() => { /* 检查更新失败不影响使用 */ })
      .finally(() => setUpdateChecking(false));
  }, [resource, version]);

  async function openDashboard() {
    // 优先使用 allowedOrigins 中的 HTTPS 地址，否则回退到 daemon status 返回的 dashboard URL
    let url = httpsOriginUrl || daemonInfo.dashboard;
    if (!url) return;
    // token 认证模式：在 URL fragment 中附带 token（HTTPS 代理模式不需要 token）
    if (authToken && !httpsOriginUrl) {
      url += (url.includes("#") ? "&" : "#") + `token=${encodeURIComponent(authToken)}`;
    }
    try {
      await openUrl(url);
    } catch (err) {
      console.error("打开仪表盘失败:", err);
    }
  }

  async function handleUpdate() {
    if (!resource || updating) return;
    setUpdating(true);
    try {
      await invoke<string>("run_openclaw_update", {
        target: resource.type,
        host: resource.host ?? null,
        port: resource.port ?? null,
        username: resource.username ?? null,
        password: resource.password ?? null,
      });
      setUpdateAvailable(false);
      // 重新获取版本
      const v = await invoke<string>("get_openclaw_version", {
        target: resource.type,
        host: resource.host ?? null,
        port: resource.port ?? null,
        username: resource.username ?? null,
        password: resource.password ?? null,
      });
      setVersion(v.trim());
      setToastKind("success");
      setToastMessage("更新完成");
      setToastOpen(true);
    } catch (err) {
      setToastKind("error");
      setToastMessage(`更新失败: ${String(err)}`);
      setToastOpen(true);
    } finally {
      setUpdating(false);
    }
  }

  const handleConfigChange = useCallback((status: ConfigStatus) => {
    setConfigStatus(status);
    // 必填未完成时自动切换到配置页
    if (status.loaded && !status.isComplete) {
      setActiveNav("config");
    }
  }, []);

  // 右侧内容渲染
  function renderContent() {
    if (activeNav === "dashboard") {
      return <ControlPanel resource={resource} running={daemonRuntime} onRefresh={() => fetchDaemonInfo(true)} />;
    }
    if (activeNav === "config") {
      return (
        <ConfigPanel resource={resource} onConfigChange={handleConfigChange} configPath={configPath} />
      );
    }
    if (activeNav === "communication") {
      return <CommunicationPanel resource={resource} />;
    }
    // 其他 tab 显示占位
    return (
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center">
            <Construction className="w-6 h-6 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <h2 className="text-[15px] font-semibold text-foreground">
            {activeItem?.label}
          </h2>
          <p className="text-[13px] text-muted-foreground">
            此功能正在开发中，敬请期待
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full gap-4 -mt-2">
      {/* Left sidebar */}
      <motion.nav
        {...fadeIn(0.1)}
        className="w-44 shrink-0 flex flex-col pt-1"
      >
        {/* Nav items */}
        <div className="flex flex-col gap-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeNav;
            const isConfigItem = item.id === "config" && configStatus.loaded;
            const showWarning = isConfigItem && !configStatus.isComplete;
            const showComplete = isConfigItem && configStatus.isComplete;
            return (
              <button
                key={item.id}
                onClick={() => setActiveNav(item.id)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 text-left",
                  isActive
                    ? "bg-primary/10 text-primary shadow-sm"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                {item.label}
                {showWarning && (
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 ml-auto" strokeWidth={2} />
                )}
                {showComplete && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 ml-auto" strokeWidth={2} />
                )}
              </button>
            );
          })}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom: resource + version */}
        {resource && (
          <div className="border-t border-border/60 pt-3 mt-3 space-y-2.5 px-1">
            {/* 当前资源 + 更新按钮 */}
            <div className="flex items-center gap-2">
              {resource.type === "remote" ? (
                <Server className="w-3.5 h-3.5 text-muted-foreground shrink-0" strokeWidth={1.5} />
              ) : (
                <Monitor className="w-3.5 h-3.5 text-muted-foreground shrink-0" strokeWidth={1.5} />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-foreground truncate">
                  {resource.name}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {resource.type === "remote"
                    ? `${resource.host}:${resource.port}`
                    : "本机"}
                </div>
              </div>
              {/* 更新按钮 */}
              {updateAvailable && !updating && (
                <button
                  onClick={handleUpdate}
                  className="shrink-0 text-[10px] font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md px-1.5 py-0.5 transition-colors"
                >
                  更新{latestVersion ? ` ${latestVersion}` : ""}
                </button>
              )}
              {updating && (
                <Loader2 className="w-3 h-3 text-amber-500 animate-spin shrink-0" />
              )}
            </div>

            {/* OpenClaw 版本 + 状态 + 刷新 */}
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 shrink-0 flex items-center justify-center">
                {versionLoading ? (
                  <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
                ) : (
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    daemonRuntime === "running" ? "bg-green-400" :
                    daemonRuntime === "stopped" ? "bg-red-400" : "bg-gray-300"
                  )} />
                )}
              </div>
              <span className="text-[11px] text-muted-foreground truncate flex-1">
                {versionLoading
                  ? "获取版本中..."
                  : version
                    ? `${version}`
                    : "版本未知"}
              </span>
              {(updateChecking || refreshing) ? (
                <Loader2 className="w-2.5 h-2.5 text-muted-foreground animate-spin shrink-0" />
              ) : (
                <button
                  onClick={() => fetchDaemonInfo(true)}
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                  title="刷新状态"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                </button>
              )}
            </div>

            {/* 运行中的 daemon 信息 */}
            {daemonRuntime === "running" && (
              <div className="space-y-1 pl-5">
                {daemonInfo.dashboard && (
                  <button
                    onClick={openDashboard}
                    className="flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors mt-1"
                  >
                    <LayoutDashboard className="w-3 h-3" />
                    仪表盘
                    <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                  </button>
                )}
              </div>
            )}
            {daemonRuntime === "stopped" && (
              <p className="text-[10px] text-red-500 pl-5">服务未运行</p>
            )}

          </div>
        )}
      </motion.nav>

      <Toast
        open={toastOpen}
        onClose={() => setToastOpen(false)}
        title={toastKind === "success" ? "更新成功" : "更新失败"}
        message={toastMessage}
        kind={toastKind}
      />

      {/* Right content area */}
      <motion.div
        key={activeNav}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex-1 rounded-xl border border-border/60 bg-white shadow-sm flex flex-col p-5 overflow-hidden"
      >
        {renderContent()}
      </motion.div>
    </div>
  );
}
