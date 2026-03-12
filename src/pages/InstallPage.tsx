import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useWizardStore } from "@/stores/wizard-store";
import { WizardStep } from "@/types/app";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { fadeIn } from "@/lib/animations";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { addResource } from "@/lib/db";
import {
  ArrowLeft,
  Loader2,
  RotateCcw,
  Rocket,
} from "lucide-react";

type OverallStatus = "idle" | "running" | "success" | "error";

export default function InstallPage() {
  const { installTarget, sshConfig, prevStep, goToStep } = useWizardStore();
  const isRemote = installTarget === "remote";

  const [logs, setLogs] = useState<string[]>([]);
  const [overallStatus, setOverallStatus] = useState<OverallStatus>("running");
  const [resultMessage, setResultMessage] = useState("");
  const [savingStart, setSavingStart] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const unlisten = listen<{ line: string }>("install:log", (event) => {
      setLogs((prev) => [...prev, event.payload.line]);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    runInstall();
  }, []);

  async function runInstall() {
    setOverallStatus("running");
    setLogs([]);
    setResultMessage("");

    try {
      let result: string;
      if (isRemote) {
        result = await invoke<string>("install_remote", {
          host: sshConfig.host,
          port: sshConfig.port,
          username: sshConfig.username,
          password: sshConfig.password,
          installPath: "",
        });
      } else {
        result = await invoke<string>("install_local");
      }
      setOverallStatus("success");
      setResultMessage(result);
    } catch (err) {
      setOverallStatus("error");
      setResultMessage(err instanceof Error ? err.message : String(err));
    }
  }

  function handleRetry() {
    startedRef.current = false;
    setOverallStatus("running");
    setLogs([]);
    setResultMessage("");
    runInstall();
  }

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
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full">
      {/* Terminal log area */}
      <div className="flex-1 rounded-xl border border-border/80 bg-[#fbfbfb] overflow-hidden flex flex-col shadow-sm scroll-mask-y">
        <div className="flex-1 overflow-y-auto p-4 font-mono text-[13px] leading-relaxed text-[#5a5a5a]">
          {logs.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))}
          {overallStatus === "running" && (
            <div className="flex items-center gap-2 text-primary mt-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="text-[11px]">执行中...</span>
            </div>
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* Result banner */}
      {(overallStatus === "success" || overallStatus === "error") && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "mt-3 px-4 py-2.5 rounded-lg text-[13px]",
            overallStatus === "success"
              ? "bg-green-500/10 border border-green-500/20 text-green-400"
              : "bg-red-500/10 border border-red-500/20 text-red-400"
          )}
        >
          {resultMessage}
        </motion.div>
      )}

      {/* Actions */}
      <motion.div
        {...fadeIn(0.3)}
        className="flex justify-between mt-4 shrink-0"
      >
        <Button
          variant="ghost"
          onClick={prevStep}
          disabled={overallStatus === "running"}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          上一步
        </Button>

        <div className="flex gap-2">
          {overallStatus === "error" && (
            <Button variant="outline" onClick={handleRetry}>
              <RotateCcw className="w-4 h-4 mr-2" />
              重试
            </Button>
          )}

          {overallStatus === "success" && (
            <Button onClick={handleStartUse} disabled={savingStart}>
              {savingStart ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Rocket className="w-4 h-4 mr-2" />
              )}
              开始使用
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

