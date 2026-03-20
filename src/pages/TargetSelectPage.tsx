import { useState } from "react";
import { cn } from "@/lib/utils";
import { useWizardStore } from "@/stores/wizard-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { InstallTarget } from "@/types/app";
import { motion, AnimatePresence } from "framer-motion";
import { fadeIn, staggerChild, springScale } from "@/lib/animations";
import { safeInvoke } from "@/lib/tauri";
import { useToast, useSSHTest } from "@/lib/hooks";
import { Toast } from "@/components/ui/alert-dialog";
import {
  Monitor,
  Server,
  Check,
  ArrowRight,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";

interface TargetOption {
  id: InstallTarget;
  icon: typeof Monitor;
  title: string;
  description: string;
  features: string[];
}

const targets: TargetOption[] = [
  {
    id: "local",
    icon: Monitor,
    title: "本机安装",
    description: "在当前电脑上安装 OpenClaw",
    features: [
      "macOS (Apple Silicon M1/M2/M3/M4)",
      "Windows 10+ (x64 / ARM64)",
      "自动检测系统环境",
      "一键安装，开箱即用",
    ],
  },
  {
    id: "remote",
    icon: Server,
    title: "远程 Linux 安装",
    description: "通过 SSH 在远程 Linux 服务器上安装 OpenClaw",
    features: [
      "Ubuntu 20.04+ / Debian 11+ / CentOS 7+",
      "支持 x64 和 ARM64 架构",
      "SSH 密码认证",
      "自动注册 systemd 服务",
    ],
  },
];

export default function TargetSelectPage() {
  const {
    installTarget,
    setInstallTarget,
    sshConfig,
    setSSHConfig,
    setSSHTested,
    nextStep,
  } = useWizardStore();

  const { toast, showToast, closeToast } = useToast();
  const { testStatus, canTest: canTestSSH, runTest } = useSSHTest(sshConfig, setSSHTested);
  const [showPassword, setShowPassword] = useState(false);
  const [isNextLoading, setIsNextLoading] = useState(false);

  const isRemote = installTarget === "remote";

  const canProceed = installTarget
    ? isRemote
      ? canTestSSH
      : true
    : false;

  async function handleTestSSH() {
    const result = await runTest();
    showToast(
      result.success ? "success" : "error",
      result.message,
      result.success ? "SSH 连接成功" : "SSH 连接失败",
    );
  }

  async function handleNext() {
    if (!installTarget) return;

    if (!isRemote) {
      nextStep();
      return;
    }

    setIsNextLoading(true);
    try {
      await safeInvoke<string>("test_ssh_connection", {
        host: sshConfig.host,
        port: sshConfig.port,
        username: sshConfig.username,
        password: sshConfig.password,
      });
      setSSHTested(true);
      nextStep();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      showToast("error", errMsg, "SSH 连接失败");
      setSSHTested(false);
    } finally {
      setIsNextLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full">
      {/* Scrollable content area */}
      <div className={cn(
        "flex-1 overflow-auto p-3 -m-3 scroll-mask-y flex flex-col transition-all duration-500",
        !isRemote ? "justify-center" : "justify-start"
      )}>
        <div className="space-y-5 my-auto pb-4">
          {/* Selection cards */}
          <div className="py-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {targets.map((target, i) => {
              const isSelected = installTarget === target.id;
              const Icon = target.icon;

              return (
                <motion.button
                  key={target.id}
                  type="button"
                  {...staggerChild(i)}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => setInstallTarget(target.id)}
                  className="text-left"
                >
                  <div
                    className={cn(
                      "relative rounded-2xl p-5 sm:p-6 transition-all duration-300 cursor-pointer border",
                      isSelected
                        ? "bg-white border-primary shadow-[0_2px_12px_-4px_rgba(255,90,54,0.15)] ring-1 ring-primary/10"
                        : "bg-white border-border/40 hover:border-primary/40 hover:shadow-sm hover:bg-slate-50/30"
                    )}
                  >
                    {/* Icon + radio */}
                    <div className="flex items-start justify-between mb-4">
                      <div
                        className={cn(
                          "w-11 h-11 rounded-xl flex items-center justify-center transition-colors shadow-sm",
                          isSelected
                            ? "bg-primary/10 text-primary"
                            : "bg-secondary/60 text-muted-foreground border border-border/40"
                        )}
                      >
                        <Icon className="w-5 h-5" strokeWidth={1.5} />
                      </div>
                      <div
                        className={cn(
                          "w-5 h-5 rounded-full border flex items-center justify-center transition-all",
                          isSelected
                            ? "border-primary bg-primary"
                            : "border-border/60 bg-white"
                        )}
                      >
                        {isSelected && (
                          <motion.div {...springScale}>
                            <Check className="w-3 h-3 text-primary-foreground" strokeWidth={3} />
                          </motion.div>
                        )}
                      </div>
                    </div>

                    {/* Title */}
                    <div className="flex items-center h-[28px] mt-2">
                      <h3 className={cn(
                        "text-base font-semibold transition-colors",
                        isSelected ? "text-foreground" : "text-foreground/80"
                      )}>
                        {target.title}
                      </h3>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>

          {/* SSH Config Form - shown when remote is selected */}
          <AnimatePresence>
            {isRemote && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="rounded-2xl border border-border/30 bg-[#fbfbfb] p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Server className="w-4 h-4 text-primary" strokeWidth={1.5} />
                      <h3 className="text-[14px] font-semibold text-foreground">
                        SSH 连接配置
                      </h3>
                    </div>
                    <Button
                      onClick={handleTestSSH}
                      disabled={!canTestSSH || testStatus === "testing"}
                      variant="secondary"
                      size="sm"
                      className="h-7 text-xs px-3 bg-white border shadow-sm hover:bg-slate-50 transition-colors"
                    >
                      {testStatus === "testing" ? (
                        <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                      ) : (
                        <Server className="w-3 h-3 mr-1.5" strokeWidth={1.5} />
                      )}
                      {testStatus === "testing" ? "测试中..." : "测试连接"}
                    </Button>
                  </div>

                  {/* Host + Port */}
                  <div className="grid grid-cols-[1fr_100px] gap-3">
                    <div>
                      <label className="text-[13px] font-medium text-muted-foreground mb-1.5 block">
                        主机地址
                      </label>
                      <Input
                        placeholder="192.168.1.100 或 example.com"
                        value={sshConfig.host}
                        onChange={(e) => setSSHConfig({ host: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-[13px] font-medium text-muted-foreground mb-1.5 block">
                        端口
                      </label>
                      <Input
                        type="number"
                        value={sshConfig.port}
                        onChange={(e) =>
                          setSSHConfig({ port: Number(e.target.value) || 22 })
                        }
                      />
                    </div>
                  </div>

                  {/* Username + Password */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[13px] font-medium text-muted-foreground mb-1.5 block">
                        用户名
                      </label>
                      <Input
                        placeholder="root"
                        value={sshConfig.username}
                        onChange={(e) =>
                          setSSHConfig({ username: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="text-[13px] font-medium text-muted-foreground mb-1.5 block">
                        密码
                      </label>
                      <div className="relative">
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="输入 SSH 密码"
                          value={sshConfig.password}
                          onChange={(e) =>
                            setSSHConfig({ password: e.target.value })
                          }
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-0 top-0 h-full px-3 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer */}
      <motion.div
        {...fadeIn(0.3)}
        className="flex justify-end mt-4 shrink-0"
      >
        <Button
          onClick={handleNext}
          disabled={!canProceed || isNextLoading || testStatus === "testing"}
          size="default"
        >
          {isNextLoading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : null}
          {isNextLoading ? "连接中..." : "下一步"}
          {!isNextLoading && <ArrowRight className="w-4 h-4 ml-2" />}
        </Button>
      </motion.div>
      <Toast
        open={toast.open}
        onClose={closeToast}
        title={toast.title}
        message={toast.message}
        kind={toast.kind}
      />
    </div>
  );
}
