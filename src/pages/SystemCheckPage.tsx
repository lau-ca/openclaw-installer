import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useWizardStore } from "@/stores/wizard-store";
import { WizardStep } from "@/types/app";
import { Button } from "@/components/ui/button";
import type { CheckStatus } from "@/types/app";
import { motion } from "framer-motion";
import { fadeIn, staggerChild } from "@/lib/animations";
import { invoke } from "@tauri-apps/api/core";
import { addResource } from "@/lib/db";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Circle,
  Rocket,
} from "lucide-react";

interface CheckItemUI {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

const statusIcon: Record<CheckStatus, typeof CheckCircle2> = {
  pending: Circle,
  running: Loader2,
  pass: CheckCircle2,
  fail: XCircle,
  warn: AlertTriangle,
};

const statusColor: Record<CheckStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-primary animate-spin",
  pass: "text-green-400",
  fail: "text-red-400",
  warn: "text-yellow-400",
};

export default function SystemCheckPage() {
  const { installTarget, sshConfig, prevStep, nextStep, goToStep } = useWizardStore();
  const [checks, setChecks] = useState<CheckItemUI[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [savingStart, setSavingStart] = useState(false);

  const isRemote = installTarget === "remote";

  const runChecks = useCallback(async () => {
    setRunning(true);
    setDone(false);

    const placeholders = ["操作系统", "CPU 架构", "CPU 核心", "内存", "磁盘空间", "OpenClaw 状态"];
    setChecks(placeholders.map((label, i) => ({
      id: String(i), label, status: "running", detail: "检测中...",
    })));

    try {
      let results: { id: string; label: string; status: string; detail: string }[];

      if (isRemote) {
        results = await invoke("check_remote_environment", {
          host: sshConfig.host,
          port: sshConfig.port,
          username: sshConfig.username,
          password: sshConfig.password,
        });
      } else {
        results = await invoke("check_local_environment");
      }

      setChecks(results.map((r) => ({
        id: r.id,
        label: r.label,
        status: r.status as CheckStatus,
        detail: r.detail,
      })));
    } catch (err) {
      setChecks((prev) =>
        prev.map((c) =>
          c.status === "running"
            ? { ...c, status: "fail", detail: String(err) }
            : c
        )
      );
    }

    setRunning(false);
    setDone(true);
  }, [isRemote, sshConfig]);

  useEffect(() => {
    runChecks();
  }, [runChecks]);

  // 仅 CPU 核心、内存、磁盘空间的 fail 阻止下一步；其余项仅做显示
  const blockingIds = ["cpu_cores", "memory", "disk"];
  const hasBlockingFail = checks.some(
    (c) => blockingIds.includes(c.id) && c.status === "fail"
  );
  const canProceed = done && !hasBlockingFail;

  // OpenClaw 已安装时显示「开始使用」
  const openclawInstalled = checks.some(
    (c) => c.id === "openclaw" && c.status === "warn"
  );

  async function handleStartUse() {
    setSavingStart(true);
    try {
      await addResource({
        name: "默认资源",
        type: installTarget === "remote" ? "remote" : "local",
        ...(installTarget === "remote" ? {
          host: sshConfig.host,
          port: sshConfig.port,
          username: sshConfig.username,
          password: sshConfig.password,
        } : {}),
      });
    } catch (err) {
      console.error("保存设置失败:", err);
    } finally {
      setSavingStart(false);
      goToStep(WizardStep.START);
    }
  }

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto w-full">
      {/* Check list */}
      <div className="flex-1 overflow-auto space-y-5 p-3 -m-3 scroll-mask-y">
        <div className="py-2 space-y-5">
          {/* 安装要求 — blocking checks */}
          <div>
            <div className="text-[13px] font-semibold text-foreground mb-2 px-1">
              安装要求
            </div>
            <div className="space-y-2">
              {checks
                .filter((c) => blockingIds.includes(c.id))
                .map((check, i) => {
                  const Icon = statusIcon[check.status];
                  return (
                    <motion.div
                      key={check.id}
                      {...staggerChild(i)}
                      className={cn(
                        "flex items-start gap-3 px-4 py-3 rounded-xl border transition-colors",
                        check.status === "pass" && "border-green-500/20 bg-green-50/50",
                        check.status === "fail" && "border-red-500/20 bg-red-50/50",
                        (check.status === "pending" || check.status === "running") &&
                        "border-border bg-secondary/30"
                      )}
                    >
                      <Icon
                        className={cn("w-4 h-4 shrink-0 mt-0.5", statusColor[check.status])}
                        strokeWidth={2}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-foreground">
                          {check.label}
                        </div>
                        {check.detail && (
                          <div
                            className={cn(
                              "text-[12px] mt-0.5",
                              check.status === "fail"
                                ? "text-red-400/80"
                                : "text-muted-foreground"
                            )}
                          >
                            {check.detail}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
            </div>
          </div>

          {/* 系统信息 — display-only checks */}
          <div>
            <div className="text-[13px] font-semibold text-muted-foreground mb-2 px-1">
              系统信息
            </div>
            <div className="space-y-1.5">
              {checks
                .filter((c) => !blockingIds.includes(c.id))
                .map((check, i) => {
                  const Icon = statusIcon[check.status];
                  return (
                    <motion.div
                      key={check.id}
                      {...staggerChild(i + 3)}
                      className="flex items-start gap-3 px-4 py-2.5 rounded-xl border border-border/60 bg-white shadow-sm transition-colors"
                    >
                      <Icon
                        className={cn(
                          "w-3.5 h-3.5 shrink-0 mt-0.5",
                          check.status === "running"
                            ? "text-primary animate-spin"
                            : check.status === "warn"
                              ? "text-yellow-400"
                              : "text-muted-foreground"
                        )}
                        strokeWidth={2}
                      />
                      <div className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
                        <span className="text-[13px] text-muted-foreground">
                          {check.label}
                        </span>
                        {check.detail && check.status !== "running" && (
                          <span
                            className={cn(
                              "text-[12px]",
                              check.status === "warn"
                                ? "text-yellow-400/80"
                                : "text-muted-foreground/70"
                            )}
                          >
                            {check.detail}
                          </span>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <motion.div
        {...fadeIn(0.3)}
        className="flex justify-between mt-4 shrink-0"
      >
        <Button variant="ghost" onClick={prevStep}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          上一步
        </Button>
        {openclawInstalled && canProceed ? (
          <Button onClick={handleStartUse} disabled={savingStart}>
            {savingStart ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Rocket className="w-4 h-4 mr-2" />
            )}
            开始使用
          </Button>
        ) : (
          <Button onClick={nextStep} disabled={!canProceed}>
            {running ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : null}
            {running ? "检测中..." : "开始部署"}
            {!running && <ArrowRight className="w-4 h-4 ml-2" />}
          </Button>
        )}
      </motion.div>
    </div>
  );
}
